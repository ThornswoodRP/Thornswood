<#
  Box-Run.ps1

  Runs one verb of the deploy gate on the box (#2841), from any session gh
  is signed in on, a cloud thread included, with no key to the box:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-DevGamemode -Restart'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-Docs -Site'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Get-Logs -Dev -Lines 2000'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Rebuild-ContentTables -Server dev'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-Server -GamemodeOnly -Build <main's full commit>'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Watch-Services -Install'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Hold-Server -Service dev -Why "swapping the ledger" -Minutes 45'
      pwsh scripts/vps/Box-Run.ps1 -Line 'ping'
      pwsh scripts/vps/Box-Run.ps1 -Run 1234567890     read an earlier run again

  scripts\vps\gate\verbs.json is the whole list of verbs and the switches
  each takes; a line outside it is refused here before anything starts, and
  again on the box. What runs is always that script of main as main is on
  GitHub when the box reads it, never this checkout. A live verb
  (Deploy-Server, Publish-Server-Main) names the commit of main Patrick gave
  his word for with -Build, and the box refuses it once main is anywhere
  else.

  HOW. It starts box-run.yml on main of the private ops repository,
  ThornswoodRP/Thornswood-Ops, where the VPS runners are registered since
  this repository went public (#4013), with the line. That run checks out
  this repository's main, takes a box runner and the desk's deploy key out
  of the ops repository's "desk" environment, which only main may use
  (Grant-BoxAccess.ps1 -Deploy puts it there), and asks the gate over the box's own sshd on 127.0.0.1 with
  this script's -OnTheBox half. The key logs in as thornswood-deploy and can
  only hand the gate a line (scripts\vps\gate\Gate.ps1).

  WHAT COMES BACK, AND TO WHOM. A deploy prints paths and a Get-Logs run
  brings back the servers' logs, and a run's log and files are readable by
  everyone who can read the repository it runs in. So the run's log carries only the
  verb, main's commit and the exit code. Everything the verb printed and
  every file it wrote is sealed on the runner to a key made here for this
  run alone (RSA-OAEP over an AES-GCM key) and written into the run's log
  as TWSEAL-LOG lines (scripts\ops\Sealed.ps1 says why the log and not an
  artifact). Only the private half, kept in this machine's scratch folder
  (box-run\<run>.key, readable by this account only), opens it, and this
  prints the output and puts the files in box-run\<run>\.

  Exit code: the verb's own, or 1 when it was refused, or the answer could
  not be read.
#>
param(
    [string]$Line = '',
    [long]$Run = 0,
    [switch]$OnTheBox,
    # Where box-run.yml and the VPS runners are (#4013).
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'gate\GateRules.ps1')
. (Join-Path (Join-Path (Split-Path -Parent $Here) 'ops') 'WorkflowRun.ps1')
. (Join-Path (Join-Path (Split-Path -Parent $Here) 'ops') 'Sealed.ps1')
$Workflow = 'box-run.yml'
$GateUser = 'thornswood-deploy'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
# The title of its annotations. One run of a workflow with more than one gate
# job (the Ops tunnel.yml, #5334) gives the jobs before the last another
# title, so the run's answer is the last job's ENDED line.
$NoteTitle = if ([string]$env:BOX_RUN_TITLE -match '^[A-Za-z][A-Za-z -]{0,39}$') { [string]$env:BOX_RUN_TITLE } else { 'Box-Run' }
function Note([string]$level, [string]$m) { Write-ThornswoodAnnotation $level $NoteTitle $m }
function Die($m) { Note 'error' $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# The Microsoft-signed ssh client, by its full path: a runner account runs
# pull request code too, which could put an ssh.exe of its own earlier on
# PATH (docs\RUNNER-ISOLATION.md in the ops repo), and that one would be
# handed the desk's key.
function Get-SignedSsh {
    foreach ($p in @((Join-Path $env:ProgramFiles 'OpenSSH\ssh.exe'), (Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'))) {
        if (-not (Test-Path -LiteralPath $p)) { continue }
        $sig = Get-AuthenticodeSignature -LiteralPath $p
        if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'O=Microsoft Corporation') { return $p }
    }
    return ''
}

# ======================================================== the box half ====
if ($OnTheBox) {
    $Line = [string]$env:BOX_LINE
    $req = Test-ThornswoodGateRequest -Line $Line -Verbs (Read-ThornswoodGateVerbs (Join-Path $Here 'gate\verbs.json'))
    if (-not $req.Ok) { Die $req.Why }
    $keyB64 = [string]$env:THORNSWOOD_DESK_KEY_B64
    if (-not $keyB64) { Die 'THORNSWOOD_DESK_KEY_B64 is not set. In box-run.yml it is the DESK_KEY_B64 secret of the ops repository''s "desk" environment, which .\scripts\vps\Grant-BoxAccess.ps1 -Name desk -Deploy -MakeKey -ToEnvironment desk puts there from One. Nothing was run.' }
    $recipient = ([string]$env:BOX_RECIPIENT).Trim()
    $sshExe = Get-SignedSsh
    if (-not $sshExe) { Die 'there is no Microsoft-signed ssh.exe in Program Files\OpenSSH or System32\OpenSSH on this runner. Nothing was run.' }
    $base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
    $work = Join-Path $base ('thornswood-box-run-' + [Guid]::NewGuid().ToString('N'))
    if ($work -match '\s') { Die "the temp folder ($work) has a space in it, which ssh would read as two files. Nothing was run." }
    $code = 1; $refused = ''; $main = ''; $lines = 0
    try {
        New-Item -ItemType Directory -Path (Join-Path $work 'out\files') -Force | Out-Null
        $keyText = ''
        try { $keyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($keyB64 -replace '\s', ''))) } catch { $keyText = '' }
        if (-not $keyText.Trim()) { Die 'THORNSWOOD_DESK_KEY_B64 is not a base64 key. Make it again with Grant-BoxAccess.ps1 -Deploy -MakeKey on One. Nothing was run.' }
        $keyFile = Join-Path $work 'desk_ed25519'
        Write-ThornswoodPrivateFile -Path $keyFile -Text ($keyText.Replace("`r`n", "`n").TrimEnd() + "`n")
        $keyText = $null
        # The box's own sshd, its host keys held to the checkout's vps.json
        # pins in a known_hosts of this run's own, as staff-notice.yml does.
        $pinned = Get-ThornswoodVpsCommitted
        $knownHosts = Join-Path $work 'known_hosts'
        try { $null = Add-ThornswoodKnownHost -Address '127.0.0.1' -KnownHosts $knownHosts -Pinned @($pinned.hostKeys) }
        catch { Die ('the box''s own sshd on 127.0.0.1: ' + $_.Exception.Message) }
        $sshArgs = @('-F', 'none', '-i', $keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                     '-o', "UserKnownHostsFile=$knownHosts", '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-n')
        $out = Join-Path $work 'out\output.txt'
        $parts = @{}
        $utf8 = New-Object Text.UTF8Encoding($false)
        # One line to the gate. What the verb prints goes into the sealed
        # output as it comes; its "| " lines also come back, for the gate's
        # own check below.
        function Invoke-GateLine([string]$GateLine) {
            $r = [pscustomobject]@{ Code = 1; Refused = ''; Main = ''; Said = (New-Object System.Collections.Generic.List[string]) }
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            & $sshExe @sshArgs ($GateUser + '@127.0.0.1') $GateLine 2>&1 | ForEach-Object {
                $l = "$_"
                if ($l -match '^\| (.*)$') {
                    [IO.File]::AppendAllText($out, $Matches[1] + "`n", $utf8); $script:lines++; $r.Said.Add($Matches[1])
                    if ($Matches[1] -match '^main at ([0-9a-f]{40})$') { $r.Main = $Matches[1] }
                }
                elseif ($l -match '^@FILE (\S+) ([A-Za-z0-9+/=]+)$') { if (-not $parts.ContainsKey($Matches[1])) { $parts[$Matches[1]] = New-Object Text.StringBuilder }; [void]$parts[$Matches[1]].Append($Matches[2]) }
                elseif ($l -match '^@FILEEND (\S+) ([0-9a-f]{64})$') {
                    $name = $Matches[1]; $sha = $Matches[2]
                    $rel = $name -replace '\.\.', '_'
                    $bytes = [Convert]::FromBase64String($(if ($parts.ContainsKey($name)) { $parts[$name].ToString() } else { '' }))
                    $got = ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($bytes))).Replace('-', '').ToLowerInvariant()
                    if ($got -ne $sha) { [IO.File]::AppendAllText($out, "box-run: $name arrived broken (sha256 $got, the box said $sha) and was left out`n", $utf8) }
                    else {
                        $dest = Join-Path (Join-Path $work 'out\files') $rel
                        New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
                        [IO.File]::WriteAllBytes($dest, $bytes)
                    }
                    $parts.Remove($name)
                }
                elseif ($l -match '^@REFUSED (.*)$') { $r.Refused = $Matches[1] }
                elseif ($l -match '^@END (-?[0-9]+)$') { $r.Code = [int]$Matches[1] }
                elseif ($l -and $l -notmatch 'post-quantum|store now, decrypt later|openssh\.com/pq\.html') { [IO.File]::AppendAllText($out, 'ssh: ' + $l + "`n", $utf8) }
            }
            $sshCode = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($sshCode -eq 255) { $r.Code = 1; if (-not $r.Refused) { $r.Refused = 'ssh could not log in to the gate as ' + $GateUser + ' (exit 255); the sealed output has its words' } }
            return $r
        }

        # THE GATE FOLLOWS MAIN. The broker runs its own installed copies of
        # Gate.ps1, GateBroker.ps1 and GateRules.ps1, and everything else from
        # main. So before any verb, its ping says which copies it runs, and when
        # they are not main's (this checkout is main's), Update-Gate puts main's
        # in first. A merged gate fix then reaches the box with the next run,
        # and nobody installs it on One (31 Oct 2026: the #5166 fix sat merged
        # while every verb refused, until Install-Gate ran by hand on One).
        $verbsHere = Read-ThornswoodGateVerbs (Join-Path $Here 'gate\verbs.json')
        if ($req.Verb -cne 'ping' -and $req.Verb -cne 'Update-Gate') {
            $want = Get-ThornswoodGateFileLine (Join-Path $Here 'gate')
            $p = Invoke-GateLine 'ping'
            if ($p.Code -ne 0) { $refused = 'the gate did not answer its ping (' + $p.Refused + '), so ' + $req.Verb + ' was not sent'; $code = 1 }
            else {
                $have = (@($p.Said | Where-Object { $_ -like 'GATE FILES *' }) | Select-Object -First 1)
                $have = if ($have) { $have.Substring(11) } else { 'unknown (a broker from before #5178 prints no GATE FILES line)' }
                if ($have -ne $want) {
                    [IO.File]::AppendAllText($out, "box-run: the gate runs $have, and main has $want, so Update-Gate goes first`n", $utf8)
                    if (-not $verbsHere.verbs.PSObject.Properties['Update-Gate']) { $refused = 'the gate runs older copies of its files than main''s, and main''s verbs.json has no Update-Gate verb to bring them up, so ' + $req.Verb + ' was not sent'; $code = 1 }
                    else {
                        $u = Invoke-GateLine 'Update-Gate'
                        if ($u.Code -ne 0) { $refused = 'Update-Gate ended ' + $u.Code + $(if ($u.Refused) { ' (' + $u.Refused + ')' } else { '' }) + ', so ' + $req.Verb + ' was not sent'; $code = 1 }
                        else {
                            # Update-Gate answers, then the broker that ran it ends without
                            # opening the pipe again (GateBroker.ps1, "handing over") and
                            # Update-Gate's task starts the new one, while Gate.ps1 waits
                            # 20 seconds for the pipe; so this ping reaches the new broker.
                            # If it still reports other copies, nothing else is sent: that
                            # is a fault to fix in Update-Gate, never something to ask
                            # again. (The one broker that cannot hand over is the one
                            # installed before #5178; the first Update-Gate after it is
                            # sent alone, and a ping after update\restart.log says it
                            # started.)
                            $p = Invoke-GateLine 'ping'
                            $now = (@($p.Said | Where-Object { $_ -like 'GATE FILES *' }) | Select-Object -First 1)
                            if ($p.Code -ne 0 -or -not $now -or $now.Substring(11) -ne $want) { $refused = 'after Update-Gate the gate reports ' + $(if ($now) { $now.Substring(11) } else { 'no GATE FILES line' }) + ', not main''s ' + $want + ', so ' + $req.Verb + ' was not sent'; $code = 1 }
                        }
                    }
                }
            }
        }
        if (-not $refused) {
            $r = Invoke-GateLine $Line
            $code = $r.Code; $refused = $r.Refused; $main = $r.Main
            # The box's public seal key, when the verb printed one and the
            # workflow asked for it as a step output (BOX_SEAL_KEY_OUTPUT): the
            # next job of the same run seals a secret to it, so no key comes in
            # from whoever started the run (#5334). Nothing else the verb said
            # leaves the runner unsealed, and the key is public.
            $outName = [string]$env:BOX_SEAL_KEY_OUTPUT
            if ($code -eq 0 -and $outName -match '^[a-z_]{1,32}$' -and $env:GITHUB_OUTPUT) {
                $k = @($r.Said | ForEach-Object { [regex]::Match($_, '^SEAL KEY (<RSAKeyValue><Modulus>[A-Za-z0-9+/=]+</Modulus><Exponent>[A-Za-z0-9+/=]+</Exponent></RSAKeyValue>)$') } | Where-Object { $_.Success }) | Select-Object -Last 1
                if ($k) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT, $outName + '=' + $k.Groups[1].Value + "`n", $utf8) }
                else { $refused = 'the verb printed no SEAL KEY line, so there is no key for the next job'; $code = 1 }
            }
        }

        # The seal, to the session that asked, or nothing leaves the runner.
        if ($recipient) {
            $to = if ($env:BOX_RUN_SEALED) { $env:BOX_RUN_SEALED } else { Join-Path $base 'box-run.sealed' }
            $n = Save-ThornswoodSealed (Join-Path $work 'out') $recipient $to
            Say "  $lines line(s) and $n file(s), sealed to the session that asked" 'Green'
        } else {
            Say '  no recipient key was given, so the output stays on the box (C:\Thornswood-Gate\runs) and nothing is uploaded' 'Yellow'
        }
    }
    finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    if ($refused -and $code -ne 0) { Die ("REFUSED " + $refused) }
    $end = 'ENDED ' + $code + ' ' + $req.Verb + $(if ($main) { ' main ' + $main } else { '' })
    if ($code -eq 0) { Note 'notice' $end; Say $end 'Green' } else { Note 'error' $end; Say $end 'Red' }
    exit $code
}

# ==================================================== the session half ====
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to start box-run.yml with. Nothing was run.' }
$scratch = & (Join-Path (Join-Path (Split-Path -Parent $Here) 'release') 'Get-ScratchDir.ps1') 'box-run'
$minutes = 30

if (-not $Run) {
    $req = Test-ThornswoodGateRequest -Line $Line -Verbs (Read-ThornswoodGateVerbs (Join-Path $Here 'gate\verbs.json'))
    if (-not $req.Ok) { Die $req.Why }
    if ($req.Minutes) { $minutes = $req.Minutes }
    # A key for this run alone. Its public half goes with the run; its
    # private half stays here.
    $k = New-ThornswoodSealKey
    $pub = $k.Public
    $priv = $k.Private
    Say "  asking the gate for: $Line" 'White'
    try { $s = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $Workflow -Inputs ([ordered]@{ line = $Line; recipient = $pub }) }
    catch { Die ($_.Exception.Message + ' Nothing was run.') }
    if (-not $s.Run) { Die ("GitHub started $Workflow but named no run, so its answer cannot be read here. It is under " + $s.Url) }
    $Run = $s.Run
    Write-ThornswoodPrivateFile -Path (Join-Path $scratch "$Run.key") -Text $priv
    $priv = $null
    Say "  run $Run, $($s.Url)" 'DarkGray'
}

$a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow $Workflow -Run $Run -Title 'Box-Run' -WaitMinutes ($minutes + 20) -Started -Say { param($m) Say $m 'DarkGray' }
if ($a.State -eq 'waiting' -or $a.State -eq 'unread') { Die ("run $Run has no answer yet (" + $a.Text + '). Read it later: pwsh scripts/vps/Box-Run.ps1 -Run ' + $Run) }

$keyPath = Join-Path $scratch "$Run.key"
$dir = Join-Path $scratch "$Run"
$read = $false
if (Test-Path -LiteralPath $keyPath) {
    $o = Open-ThornswoodSealedRun -Repo $GitHubRepo -Run $Run -Artifact 'box-run-sealed' -File 'box-run.sealed' -KeyPath $keyPath -Into $dir -FromLog
    if ($o.Ok) {
        $read = $true
        $txt = Join-Path $dir 'output.txt'
        if (Test-Path -LiteralPath $txt) { Get-Content -LiteralPath $txt | ForEach-Object { Write-Host $_ } }
        $files = @(Get-ChildItem -LiteralPath (Join-Path $dir 'files') -Recurse -File -ErrorAction SilentlyContinue)
        if ($files.Count) { Say ''; Say "  $($files.Count) file(s) in $(Join-Path $dir 'files')" 'Green' }
    } else {
        Say ('  the run''s sealed output could not be read (' + $o.Why + ')') 'Red'
    }
} else {
    Say "  this machine has no key for run $Run ($keyPath), so its sealed output cannot be read here" 'Red'
}

# Header, exit code: the verb's own, and never 0 when its answer was not read.
$code = Get-ThornswoodRunExit $a $read
if ($code -lt 0) { Die ("run $Run ended with no answer: " + $a.Text + ' ' + $a.Url) }
Say ''; Say ('  ' + $a.Text) $(if ($code -eq 0) { 'Green' } else { 'Red' })
if (-not $read) { Say "  what the verb printed was not read, so this ends $code" 'Red' }
exit $code
