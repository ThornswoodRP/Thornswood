<#
  Nexus-Run.ps1

  Runs one of the Nexus scripts with Patrick's Nexus API key from a session
  that does not hold the key, a cloud thread included (#2841):

      pwsh scripts/release/Nexus-Run.ps1 -Line 'Set-NexusKey'
      pwsh scripts/release/Nexus-Run.ps1 -Line 'Send-NexusFile -Mod 192001 -Version 1.3 -PackRoot game/content -Pack Thornswood-Content.esp -PackName Thornswood-Content-1.3.zip -WhatIf'
      pwsh scripts/release/Nexus-Run.ps1 -Line 'New-NexusRevision -Mod 192001 -FileId 830000 -DropPatch 192001:Thornswood-Content.esp -WhatIf'
      pwsh scripts/release/Nexus-Run.ps1 -Line 'Install-NexusRevision -Revision 6'
      pwsh scripts/release/Nexus-Run.ps1 -Line 'Set-NexusDescription -Mod 192001,192762 -AddLine "A line." -WhatIf'
      pwsh scripts/release/Nexus-Run.ps1 -Run 1234567890     read an earlier run again

  WHY. Patrick, 25 Oct 2026, on #2841: the Nexus API key moves out of the
  default cloud environment, the same way the box key does. Until then every
  cloud session held THORNSWOOD_NEXUS_API_KEY, the key to his own Nexus
  account, whatever it was working on. Now the key is the secret
  NEXUS_API_KEY of the GitHub environment "desk", which only main may use
  (Set-NexusKey.ps1 -ToEnvironment desk puts it there from One), and only
  .github\workflows\nexus-run.yml reads it.

  WHAT RUNS. scripts\release\nexus-verbs.json is the whole list: the script,
  and every parameter it takes this way. A line outside it is refused here
  before anything starts, and again on the runner, with the rules the deploy
  gate holds a line to (scripts\vps\gate\GateRules.ps1). What runs is always
  that script of main, as the run checks it out, never this checkout.

  FILES. A run takes no file from the session. What a script would read from
  a file comes from main or from Nexus:
    - Send-NexusFile's archive is zipped on the runner from files of main:
      -PackRoot is a folder of the repository, -Pack the files or folders in
      it, by commas, and -PackName the zip's name. Each entry's path in the
      zip is its path under -PackRoot.
    - New-NexusRevision's -Archive is never given: each -FileId is downloaded
      from Nexus, which is the archive that was uploaded as that file. Its
      -Add names a JSON file of main under records\, and each mod's archive
      is downloaded by its fileId the same way.
      Its -Rule names a JSON file of main under docs\ (plugin rules, such
      as docs\COLLECTION-REVISION-6-RULE.json), read as main holds it.
    - Install-NexusRevision always runs with -Record, into a folder of the
      run's own, which comes back with the output.
  Anything else that reads a file of the machine it runs on (-From, -Layout,
  -CollectionArchive, -Game, an archive built elsewhere such as the Client
  Runtime's) runs on One, which keeps the key in its own file.

  WHAT COMES BACK, AND TO WHOM. The run's log carries only the verb, main's
  commit and the exit code. What the script printed and the files it wrote
  are sealed on the runner to a key made here for this run alone
  (scripts\ops\Sealed.ps1) and uploaded as the run's artifact; this opens
  them, prints the output and puts the files in nexus-run\<run>\ in the
  scratch folder.

  Exit code: the script's own, or 1 when it was refused or the answer could
  not be read.
#>
param(
    [string]$Line = '',
    [long]$Run = 0,
    [switch]$OnTheRunner,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path $Repo 'scripts/vps/gate/GateRules.ps1')
. (Join-Path $Repo 'scripts/ops/WorkflowRun.ps1')
. (Join-Path $Repo 'scripts/ops/Sealed.ps1')
$Workflow = 'nexus-run.yml'
$VerbsPath = Join-Path $Here 'nexus-verbs.json'
$OwnParams = @('PackRoot', 'Pack', 'PackName')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Note([string]$level, [string]$m) { Write-ThornswoodAnnotation $level 'Nexus-Run' $m }
function Die($m) { Note 'error' $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# The line against nexus-verbs.json. Returns the request, or throws why not.
function Test-NexusRunLine([string]$Line, $Verbs) {
    $req = Test-ThornswoodGateRequest -Line $Line -Verbs $Verbs
    if (-not $req.Ok) { throw $req.Why }
    if ($req.Verb -eq 'ping') { throw 'Nexus-Run has no ping: Set-NexusKey checks the key. Nothing was run.' }
    return $req
}

# The request's words as the parameters the script is given, and Nexus-Run's
# own (-PackRoot, -Pack, -PackName) apart. A list parameter is split on its
# commas. Values never start with a hyphen (GateRules refuses them), so a
# word after a parameter is its value and a parameter with none is a switch.
function ConvertTo-NexusRunParams($Req, $Verbs) {
    $v = $Verbs.verbs.($Req.Verb)
    $lists = @($v.lists | Where-Object { $_ })
    $params = [ordered]@{}
    $own = @{}
    $words = @($Req.Args)
    $i = 0
    while ($i -lt $words.Count) {
        if ($words[$i] -notmatch '^-([A-Za-z]{1,40})$') { throw ('the word ' + $words[$i] + ' is not a parameter') }
        $name = $Matches[1]
        $value = $true
        if ($i + 1 -lt $words.Count -and -not $words[$i + 1].StartsWith('-')) { $value = [string]$words[$i + 1]; $i++ }
        $i++
        if ($OwnParams -ccontains $name) { $own[$name] = [string]$value; continue }
        if ($lists -ccontains $name) { $value = [string[]]@(([string]$value) -split ',') }
        $params[$name] = $value
    }
    $packs = @($OwnParams | Where-Object { $own.ContainsKey($_) })
    if ($packs.Count -and $packs.Count -ne 3) { throw '-PackRoot, -Pack and -PackName go together: the folder, the files in it, and the zip''s name. Nothing was run.' }
    if ($Req.Verb -eq 'Send-NexusFile' -and -not $packs.Count) { throw 'Send-NexusFile uploads an archive zipped from files of main: give -PackRoot, -Pack and -PackName. An archive built anywhere else is uploaded from One. Nothing was run.' }
    $fileIds = if ($params.Contains('FileId')) { @($params['FileId']).Count } else { 0 }
    if ($params.Contains('Mod') -and $Req.Verb -eq 'New-NexusRevision' -and @($params['Mod']).Count -ne $fileIds) {
        throw '-Mod and -FileId go together, one file id for each mod. Nothing was run.'
    }
    return [pscustomobject]@{ Params = $params; Own = $own }
}

# A path of the repository as a line gives it: forward slashes, no empty,
# "." or ".." part, nothing outside the repository.
function Test-NexusRunPath([string]$Rel) {
    if (-not $Rel -or $Rel.StartsWith('/') -or $Rel.Contains('\')) { return $false }
    foreach ($part in $Rel.Split('/')) { if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part.Trim() -ne $part) { return $false } }
    return $true
}

# Ordinary files git tracks at $Rel (a file, or every file under a folder),
# as paths from the repository's root. A link is refused: its bytes would be
# whatever it points at.
function Get-NexusRunTracked([string]$RepoRoot, [string]$Rel) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& git -C $RepoRoot ls-files -s -- $Rel 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { throw ('git could not list ' + $Rel + ': ' + ($o -join ' ')) }
    $files = @()
    foreach ($l in $o) {
        if ($l -notmatch '^(\d{6}) [0-9a-f]+ \d+\t(.+)$') { continue }
        if ($Matches[1] -ne '100644' -and $Matches[1] -ne '100755') { throw ($Matches[2] + ' is not an ordinary file in git (mode ' + $Matches[1] + '), so it is not packed. Nothing was run.') }
        $files += $Matches[2]
    }
    return $files
}

# The zip Send-NexusFile uploads, from files of main alone. Entries in
# ordinal order, each with the commit's time, so the same commit packs the
# same bytes. Returns @{ Path; Entries }.
function New-NexusRunPack([string]$RepoRoot, [string]$Root, [string[]]$Items, [string]$Name, [string]$Into, [DateTimeOffset]$When) {
    if (-not (Test-NexusRunPath $Root)) { throw ('-PackRoot ' + $Root + ' is not a folder of the repository. Nothing was run.') }
    $entries = @{}
    foreach ($it in $Items) {
        $it = $it.Trim()
        if (-not (Test-NexusRunPath $it)) { throw ('-Pack ' + $it + ' is not a path under -PackRoot. Nothing was run.') }
        $got = @(Get-NexusRunTracked $RepoRoot ($Root + '/' + $it))
        if (-not $got.Count) { throw ($Root + '/' + $it + ' is no file of main. Nothing was run.') }
        foreach ($f in $got) { $entries[$f.Substring($Root.Length + 1)] = $f }
    }
    Add-Type -AssemblyName System.IO.Compression
    New-Item -ItemType Directory -Path $Into -Force | Out-Null
    $zipPath = Join-Path $Into $Name
    $fs = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
    $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($e in @($entries.Keys | Sort-Object -Culture ([Globalization.CultureInfo]::InvariantCulture) { $_ } -CaseSensitive)) {
            $z = $zip.CreateEntry($e, [IO.Compression.CompressionLevel]::Optimal)
            $z.LastWriteTime = $When
            $w = $z.Open()
            try { $b = [IO.File]::ReadAllBytes((Join-Path $RepoRoot $entries[$e])); $w.Write($b, 0, $b.Length) } finally { $w.Dispose() }
        }
    }
    finally { $zip.Dispose(); $fs.Dispose() }
    return [pscustomobject]@{ Path = $zipPath; Entries = @($entries.Keys | Sort-Object) }
}

# ===================================================== the runner's half ====
if ($OnTheRunner) {
    $verbs = Read-ThornswoodGateVerbs $VerbsPath
    try { $req = Test-NexusRunLine ([string]$env:NEXUS_LINE) $verbs } catch { Die $_.Exception.Message }
    if (-not $env:THORNSWOOD_NEXUS_API_KEY -and -not $env:THORNSWOOD_NEXUS_STANDIN) {
        Die 'THORNSWOOD_NEXUS_API_KEY is not set. In nexus-run.yml it is the NEXUS_API_KEY secret of the "desk" environment, which .\scripts\release\Set-NexusKey.ps1 -ToEnvironment desk puts there from One. Nothing was run.'
    }
    . (Join-Path $Here 'Nexus.ps1')
    $recipient = ([string]$env:NEXUS_RECIPIENT).Trim()
    $base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
    $work = Join-Path $base ('thornswood-nexus-run-' + [Guid]::NewGuid().ToString('N'))
    $outDir = Join-Path $work 'out'
    $filesDir = Join-Path $outDir 'files'
    $outText = Join-Path $outDir 'output.txt'
    $utf8 = New-Object Text.UTF8Encoding($false)
    $main = ''
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $main = [string](& git -C $Repo rev-parse HEAD 2>$null)
    $when = [string](& git -C $Repo log -1 --format=%ct 2>$null)
    $ErrorActionPreference = $old
    $code = 1
    try {
        New-Item -ItemType Directory -Path $filesDir -Force | Out-Null
        function Tell([string]$m) { [IO.File]::AppendAllText($outText, 'nexus-run: ' + $m + "`n", $utf8) }
        $stop = ''
        try {
            $cv = ConvertTo-NexusRunParams $req $verbs
            $p = $cv.Params
            $game = if ($p.Contains('Game')) { [string]$p['Game'] } else { 'skyrimspecialedition' }
            if ($cv.Own.Count) {
                $at = if ($when -match '^\d+$') { [DateTimeOffset]::FromUnixTimeSeconds([long]$when) } else { [DateTimeOffset]::new(2020, 1, 1, 0, 0, 0, [TimeSpan]::Zero) }
                $pack = New-NexusRunPack $Repo $cv.Own['PackRoot'] ($cv.Own['Pack'] -split ',') $cv.Own['PackName'] (Join-Path $work 'pack') $at
                $sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($pack.Path)))).Replace('-', '').ToLowerInvariant()
                Tell ('packed ' + $cv.Own['PackName'] + ' from ' + $cv.Own['PackRoot'] + ' of main at ' + $main + ': ' + ($pack.Entries -join ', ') + '; ' + (Get-Item -LiteralPath $pack.Path).Length + ' bytes, sha256 ' + $sha)
                $p['Archive'] = $pack.Path
            }
            if ($req.Verb -eq 'New-NexusRevision' -and $p.Contains('FileId')) {
                $arcs = @()
                foreach ($fid in @($p['FileId'])) {
                    $got = Get-NexusFileArchive $game $fid (Join-Path $work 'archives')
                    Tell ('downloaded file ' + $fid + ' from Nexus: ' + $got.Name + ', ' + $got.Size + ' bytes, md5 ' + $got.Md5Hex)
                    $arcs += $got.Path
                }
                $p['Archive'] = [string[]]$arcs
            }
            if ($req.Verb -eq 'New-NexusRevision' -and $p.Contains('Add')) {
                $rel = [string]$p['Add']
                if (-not (Test-NexusRunPath $rel) -or -not @(Get-NexusRunTracked $Repo $rel).Count) { throw ('-Add ' + $rel + ' is no file of main. Nothing was run.') }
                $mods = @([IO.File]::ReadAllText((Join-Path $Repo $rel)) | ConvertFrom-Json)
                foreach ($m in $mods) {
                    $fid = [string]$m.fileId
                    if ($fid -notmatch '^[0-9]{1,12}$') { throw ($rel + ' has a mod with no fileId, so there is nothing to download for it. Nothing was run.') }
                    $got = Get-NexusFileArchive $game $fid (Join-Path $work 'archives')
                    Tell ('downloaded file ' + $fid + ' from Nexus for -Add: ' + $got.Name + ', ' + $got.Size + ' bytes, md5 ' + $got.Md5Hex)
                    $m | Add-Member -NotePropertyName archive -NotePropertyValue $got.Path -Force
                }
                $addFile = Join-Path $work 'add.json'
                [IO.File]::WriteAllText($addFile, (ConvertTo-Json -InputObject @($mods) -Depth 12), $utf8)
                $p['Add'] = $addFile
            }
            if ($req.Verb -eq 'New-NexusRevision' -and $p.Contains('Rule')) {
                $rel = [string]$p['Rule']
                if (-not (Test-NexusRunPath $rel) -or -not @(Get-NexusRunTracked $Repo $rel).Count) { throw ('-Rule ' + $rel + ' is no file of main. Nothing was run.') }
                $p['Rule'] = Join-Path $Repo $rel
            }
            if ($req.Out) { $p[$req.Out.TrimStart('-')] = (Join-Path $filesDir ($req.Out.TrimStart('-').ToLowerInvariant())) }
        }
        catch { $stop = $_.Exception.Message }
        if ($stop) { Tell ('STOP. ' + $stop) }
        else {
            # The script runs in a pwsh of its own, given its parameters as a
            # hashtable: the values reach it as they are, never through a
            # command line a shell or PowerShell would read.
            $b64 = [Convert]::ToBase64String($utf8.GetBytes(($p | ConvertTo-Json -Depth 5 -Compress)))
            $scriptPath = (Join-Path $Repo $req.Script).Replace("'", "''")
            $cmd = "`$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$b64')) | ConvertFrom-Json -AsHashtable; & '$scriptPath' @p; exit `$LASTEXITCODE"
            $psi = New-Object Diagnostics.ProcessStartInfo
            $psi.FileName = (Get-Process -Id $PID).Path
            foreach ($a in @('-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd)))) { $psi.ArgumentList.Add($a) }
            $psi.WorkingDirectory = $Repo
            $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
            $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
            $psi.EnvironmentVariables['NO_COLOR'] = '1'
            Say ('  running ' + $req.Verb + ' from main at ' + $main) 'White'
            $proc = [Diagnostics.Process]::Start($psi)
            $proc.StandardInput.Close()
            $so = $proc.StandardOutput.ReadToEndAsync()
            $se = $proc.StandardError.ReadToEndAsync()
            if (-not $proc.WaitForExit([int]$req.Minutes * 60000)) {
                $proc.Kill($true)
                $proc.WaitForExit()
                Tell ('STOP. ' + $req.Verb + ' ran past its ' + $req.Minutes + ' minutes and was ended.')
                $code = 124
            } else {
                $proc.WaitForExit()
                $code = $proc.ExitCode
            }
            [IO.File]::AppendAllText($outText, $so.Result, $utf8)
            if ($se.Result.Trim()) { [IO.File]::AppendAllText($outText, "`nwhat it wrote to stderr:`n" + $se.Result, $utf8) }
        }

        # The seal, to the session that asked, or nothing leaves the runner.
        if ($recipient) {
            $to = if ($env:NEXUS_RUN_SEALED) { $env:NEXUS_RUN_SEALED } else { Join-Path $base 'nexus-run.sealed' }
            $n = Save-ThornswoodSealed $outDir $recipient $to
            Say "  the output and $n file(s), sealed to the session that asked" 'Green'
        } else {
            Say '  no recipient key was given, so the output is not kept' 'Yellow'
        }
        if ($stop) { Die ('REFUSED ' + $stop) }
    }
    finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    $end = 'ENDED ' + $code + ' ' + $req.Verb + $(if ($main) { ' main ' + $main } else { '' })
    if ($code -eq 0) { Note 'notice' $end; Say $end 'Green' } else { Note 'error' $end; Say $end 'Red' }
    exit $code
}

# ==================================================== the session's half ====
$minutes = 30
if (-not $Run) {
    try { $req = Test-NexusRunLine $Line (Read-ThornswoodGateVerbs $VerbsPath); [void](ConvertTo-NexusRunParams $req (Read-ThornswoodGateVerbs $VerbsPath)) }
    catch { Die $_.Exception.Message }
    if ($req.Minutes) { $minutes = $req.Minutes }
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die "there is no gh here to start $Workflow with. Nothing was run." }
$scratch = & (Join-Path $Here 'Get-ScratchDir.ps1') 'nexus-run'
if (-not $Run) {
    # A key for this run alone. Its public half goes with the run; its
    # private half stays here.
    $k = New-ThornswoodSealKey
    Say "  asking nexus-run for: $Line" 'White'
    try { $s = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $Workflow -Inputs ([ordered]@{ line = $Line; recipient = $k.Public }) }
    catch { Die ($_.Exception.Message + ' Nothing was run.') }
    if (-not $s.Run) { Die ("GitHub started $Workflow but named no run, so its answer cannot be read here. It is under " + $s.Url) }
    $Run = $s.Run
    . (Join-Path $Repo 'scripts/vps/Vps.ps1')
    Write-ThornswoodPrivateFile -Path (Join-Path $scratch "$Run.key") -Text $k.Private
    $k = $null
    Say "  run $Run, $($s.Url)" 'DarkGray'
}

$a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow $Workflow -Run $Run -Title 'Nexus-Run' -WaitMinutes ($minutes + 20) -Started -Say { param($m) Say $m 'DarkGray' }
if ($a.State -eq 'waiting' -or $a.State -eq 'unread') { Die ("run $Run has no answer yet (" + $a.Text + '). Read it later: pwsh scripts/release/Nexus-Run.ps1 -Run ' + $Run) }

$keyPath = Join-Path $scratch "$Run.key"
$dir = Join-Path $scratch "$Run"
if (Test-Path -LiteralPath $keyPath) {
    $o = Open-ThornswoodSealedRun -Repo $GitHubRepo -Run $Run -Artifact 'nexus-run-sealed' -File 'nexus-run.sealed' -KeyPath $keyPath -Into $dir
    if ($o.Ok) {
        $txt = Join-Path $dir 'output.txt'
        if (Test-Path -LiteralPath $txt) { Get-Content -LiteralPath $txt | ForEach-Object { Write-Host $_ } }
        $files = @(Get-ChildItem -LiteralPath (Join-Path $dir 'files') -Recurse -File -ErrorAction SilentlyContinue)
        if ($files.Count) { Say ''; Say "  $($files.Count) file(s) in $(Join-Path $dir 'files')" 'Green' }
    } else {
        Say ('  the run left no sealed output (' + $o.Why + ')') 'Yellow'
    }
} else {
    Say "  this machine has no key for run $Run ($keyPath), so only its end can be read here" 'Yellow'
}

switch ($a.State) {
    'answer' {
        Say ''; Say ('  ' + $a.Text) 'Green'
        if ($a.Text -match '^ENDED (-?[0-9]+)') { exit [int]$Matches[1] }
        exit 0
    }
    'stopped' {
        Say ''; Say ('  ' + $a.Text) 'Red'
        if ($a.Text -match '^ENDED (-?[0-9]+)') { exit [Math]::Max(1, [int]$Matches[1]) }
        exit 1
    }
    default { Die ("run $Run ended with no answer: " + $a.Text + ' ' + $a.Url) }
}
