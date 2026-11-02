<#
  test-3247-server-folder-turn.ps1

      pwsh -NoProfile -File .\tests\test-3247-server-folder-turn.ps1
      powershell -NoProfile -File .\tests\test-3247-server-folder-turn.ps1

  Issue #3247. On 22 Oct 2026 at 2:21 AM a dev Publish-Server stopped dev and
  was refused the rename of C:\Thornswood-Server-Dev, because the nightly
  backup, started 2:15 AM, was still reading it (its log: game-dev\world
  taken 2:19:33 to 2:22:00 AM). Nothing made the two take turns. Since #3247
  both take the server folders' turn first, scripts\deploy\ServerFolderTurn.ps1:
  a file in the backup's folder opened with no sharing. This proves:

    1. ServerFolderTurn.ps1 is plain ASCII, parses, and defines
       Enter-ThornswoodServerFolderTurn; the server installer and the nightly
       backup each carry an exact copy of it below its header.
    2. Each takes the turn before it touches the server folders: the
       installer before it stops the server, refusing with nothing stopped
       when the turn does not come; Swap.ps1's game server swap before
       StopOurs, refusing the same way and leaving a put-back's .prev folder
       where it is, as its other refusals before the swap now do; the backup
       around the servers' Grab lines only, given back in a finally, and a
       run that did not get it ends non-zero saying so.
    3. Run for real, here and in second processes of PowerShell 7, the
       box's:
       with no backup folder there is no turn ($null); the turn is taken and
       says who has it; a second run waits, says once who it waits for, and
       is refused naming them when its time is up; it gets the turn the
       moment the first ends its run, and at once after one that was killed;
       and a turn file that cannot be opened for another reason is thrown at
       once, not waited on. The run after starts 4 s late and the turn is
       given back only once it says it waits, so a slow start (a runner's
       first build, #4342) does not decide the result.

  Read only apart from files under its own temp folder, and the PowerShell
  processes it starts and ends there.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function P([string[]]$parts) { $p = $Repo; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }
function Text([string]$path) { return [IO.File]::ReadAllText($path).Replace("`r`n", "`n") }
function FunctionText([string]$code, [string]$name) {
    $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$e)
    $f = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    if ($f.Count -ne 1) { return '' }
    return $f[0].Extent.Text
}
# Where $b is in $s after $a, both found; -1 when either is missing.
function After([string]$s, [string]$a, [string]$b) {
    $i = $s.IndexOf($a)
    if ($i -lt 0) { return -1 }
    return $s.IndexOf($b, $i + $a.Length)
}

# ---- 1. the helper and its copies ------------------------------------------
$libPath = P 'scripts', 'deploy', 'ServerFolderTurn.ps1'
Yes 'scripts\deploy\ServerFolderTurn.ps1 is there' (Test-Path -LiteralPath $libPath)
if (-not (Test-Path -LiteralPath $libPath)) { Done }
$lib = Text $libPath
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($lib, [ref]$null, [ref]$e)
Yes 'it parses, and is plain ASCII' (@($e).Count -eq 0 -and $lib -notmatch '[^\x00-\x7F]')
$turnFn = FunctionText $lib 'Enter-ThornswoodServerFolderTurn'
Yes '  and defines Enter-ThornswoodServerFolderTurn, which opens its file with no sharing' (
    $turnFn -match '\[IO\.FileShare\]::None' -and $turnFn -match '\[IO\.FileMode\]::OpenOrCreate')
Yes '  and waits only on "another process has it open", throwing anything else' (
    $turnFn -match '0x80070020, 0x80070021, 11' -and $turnFn -match '-notcontains \$e\.HResult\) \{ throw \}')
$body = $lib.Substring($lib.IndexOf("#>`n") + 3)
$stopAndMove = Text (P 'scripts', 'deploy', 'StopAndMove.ps1')
Yes 'StopAndMove.ps1 does not carry it, and keeps its rule of no sleep (#2928)' (
    $stopAndMove -notmatch 'Enter-ThornswoodServerFolderTurn' -and $stopAndMove -notmatch 'Start-Sleep')

$inst = Text (P 'scripts', 'deploy', 'Install-ThornswoodServer.ps1')
$m = [regex]::Match($inst, '(?s)# ---- ServerFolderTurn\.ps1 \(copy\) ----\n(.*?)# ---- end ServerFolderTurn\.ps1 ----')
Yes 'the server installer carries an exact copy of ServerFolderTurn.ps1 below its header' ($m.Success -and $m.Groups[1].Value -eq $body)
$backup = Text (P 'scripts', 'vps', 'vps-nightly-backup.ps1')
$m = [regex]::Match($backup, '(?s)# ---- ServerFolderTurn\.ps1 \(copy\) ----\n(.*?)# ---- end ServerFolderTurn\.ps1 ----')
Yes 'the nightly backup carries an exact copy too' ($m.Success -and $m.Groups[1].Value -eq $body)
foreach ($p in @(@('scripts', 'vps', 'vps-nightly-backup.ps1'), @('scripts', 'deploy', 'Install-ThornswoodServer.ps1'), @('scripts', 'deploy', 'Swap.ps1'))) {
    $t = Text (P $p)
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$e)
    Yes ('  ' + $p[-1] + ' parses and is plain ASCII') (@($e).Count -eq 0 -and $t -notmatch '[^\x00-\x7F]')
}

# ---- 2. each takes it before the server folders ----------------------------
$swapAt = $inst.IndexOf('# ---- the swap ----')
$swapPart = ''
if ($swapAt -ge 0) { $swapPart = $inst.Substring($swapAt) }
$enter = $swapPart.IndexOf("Enter-ThornswoodServerFolderTurn (Join-Path `$parent 'Thornswood-Backup')")
$stop = $swapPart.IndexOf('StopServer $Root')
Yes 'the installer takes the turn, in the folder beside the server folders, before it stops the server' (
    $swapPart.IndexOf('if ($hadRoot) {') -ge 0 -and $swapPart.IndexOf('if ($hadRoot) {') -lt $enter -and $enter -ge 0 -and $enter -lt $stop -and
    $swapPart -match '\$script:serverTurn = Enter-ThornswoodServerFolderTurn')
$refuse = $swapPart.Substring([Math]::Max(0, $enter))
$refuse = $refuse.Substring(0, [Math]::Max(0, $refuse.IndexOf('StopServer $Root')))
Yes '  and when it does not come, refuses with nothing stopped, keeping a put-back''s folder' (
    $refuse -match "Finish 'INSTALL REFUSED' 1" -and $refuse -match 'nothing was stopped or swapped' -and
    $refuse -match 'if \(-not \$PutBack\) \{ Remove-Item -LiteralPath \$stageDir')

$swap = Text (P 'scripts', 'deploy', 'Swap.ps1')
Yes 'Swap.ps1 puts it in front of the game server swap' (
    $swap.Contains("`$ThornswoodServerFolderTurnText = [IO.File]::ReadAllText((Join-Path `$PSScriptRoot 'ServerFolderTurn.ps1'))") -and
    $swap.Contains('$swapBlock = $ThornswoodServerFolderTurnText + $swapBlock'))
$a = $swap.IndexOf('# ==== deploy-server remote blocks ====')
$b = $swap.IndexOf('# ==== end deploy-server remote blocks ====')
$blk = ''
if ($a -ge 0 -and $b -gt $a) { $blk = $swap.Substring($a, $b - $a) }
$enter = $blk.IndexOf("Enter-ThornswoodServerFolderTurn (Join-Path (Split-Path -Parent `$Root.TrimEnd('\')) 'Thornswood-Backup')")
$stopCall = [regex]::Match($blk, '(?m)^StopOurs\s*$')
Yes '  which takes the turn before StopOurs, once' (
    $enter -ge 0 -and $stopCall.Success -and $enter -lt $stopCall.Index -and
    ([regex]::Matches($blk, '= Enter-ThornswoodServerFolderTurn')).Count -eq 1)
$refuse = ''
if ($enter -ge 0 -and $stopCall.Success) { $refuse = $blk.Substring($enter, $stopCall.Index - $enter) }
Yes '  and when it does not come, refuses with nothing stopped' ($refuse -match "'SWAP REFUSED'" -and $refuse -match 'so nothing was stopped' -and $refuse -match 'exit 1')
$swapBody = ''
$sb = [regex]::Match($blk, "(?s)\`$swapBlock = @'\n(.*?)\n'@")
if ($sb.Success) { $swapBody = $sb.Groups[1].Value }
$clears = [regex]::Matches($swapBody, '(?m)^(.*)Remove-Item -LiteralPath \$stageDir -Recurse -Force -EA SilentlyContinue')
$bare = @($clears | Where-Object { $_.Groups[1].Value -notmatch 'if \(-not \$KeepStage\) \{' })
# The one bare clear left is after PASS, where a put-back's .prev has been
# swapped back in and is empty.
$passAt = $swapBody.IndexOf("'PASS: the server is answering on '")
Yes 'every refusal before the swap leaves a put-back''s .prev folder where it is ($KeepStage)' (
    $clears.Count -ge 4 -and $bare.Count -eq 1 -and $passAt -ge 0 -and $bare[0].Index -gt $passAt)

$grabGame = $backup.IndexOf("Grab (Join-Path `$sv.Root 'world')")
$enter = $backup.IndexOf("`$serverTurn = Enter-ThornswoodServerFolderTurn `$Out 'the nightly backup'")
$give = After $backup "Grab (Join-Path `$sv.Root 'gamemode.js')" 'finally {'
$given = After $backup "Grab (Join-Path `$sv.Root 'gamemode.js')" '$serverTurn.Dispose()'
$site = $backup.IndexOf("Grab (Join-Path `$SiteRoot 'data')")
Yes 'the backup takes the turn in its own folder before the server folders' ($enter -ge 0 -and $grabGame -gt $enter)
Yes '  and gives it back in a finally, before the site and the rest' ($give -gt $grabGame -and $given -gt $give -and $site -gt $given)
Yes '  and a run that did not get it says so and ends non-zero' (
    $backup -match "Note \('  SERVERS NOT TAKEN: ' \+ \`$serversNotTaken\)" -and
    $backup -match 'if \(\$serversNotTaken\) \{\s*throw \("The game servers were not taken')

# ---- 3. run for real -------------------------------------------------------
. $libPath
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3247-' + [Guid]::NewGuid().ToString('N'))
$folder = Join-Path $work 'Thornswood-Backup'
[void](New-Item -ItemType Directory -Path $folder -Force)
# The second runs are PowerShell 7, which runs the backup and the installs
# on the box.
$shell = Get-BoxPowerShell
Write-Host ('second runs: ' + $shell)
$started = @()
$held = $null
# A second run of the same PowerShell, which takes the turn, says how it
# went in a file, holds the turn $Hold seconds and ends.
$childPath = Join-Path $work 'child.ps1'
[IO.File]::WriteAllText($childPath, @'
param([string]$Lib, [string]$Folder, [string]$Who, [int]$Wait, [int]$Hold, [string]$Said, [int]$Late = 0)
# -Late stands in for a slow start, as on a runner's first build (#4342).
Start-Sleep -Seconds $Late
. $Lib
# Each file is written whole under another name and then renamed into place,
# so the test, which reads a file the moment it is there, never opens one
# this run is still writing (a run on 1 Nov was refused the read, "being
# used by another process", by WriteAllText still holding it).
function Say([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path + '.part', $text)
  [IO.File]::Move($path + '.part', $path)
}
$heard = New-Object System.Collections.ArrayList
try {
  # The first time it is told it waits, it says so in a file of its own, so
  # the test gives the turn back only once it is waiting, not after a guess.
  $t = Enter-ThornswoodServerFolderTurn $Folder $Who $Wait { param($m) if (-not $heard.Count) { Say ($Said + '.waiting') $m }; [void]$heard.Add($m) }
  Say $Said ('TAKEN' + "`n" + ($heard -join "`n"))
  Start-Sleep -Seconds $Hold
  $t.Dispose()
} catch {
  Say $Said ('REFUSED ' + $_.Exception.Message + "`n" + ($heard -join "`n"))
}
'@)
function Child([string]$who, [int]$wait, [int]$hold, [string]$said, [int]$late = 0) {
    # -WindowStyle is Windows only.
    $hide = @{}
    if ($OnWindows) { $hide = @{ WindowStyle = 'Hidden' } }
    $c = Start-Process -FilePath $shell -PassThru @hide -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $childPath + '"'),
        '-Lib', ('"' + $libPath + '"'), '-Folder', ('"' + $folder + '"'), '-Who', ('"' + $who + '"'),
        '-Wait', $wait, '-Hold', $hold, '-Said', ('"' + $said + '"'), '-Late', $late)
    $script:started += $c
    return $c
}
function WaitFor([string]$path, [int]$seconds) {
    $until = (Get-Date).AddSeconds($seconds)
    while (-not (Test-Path -LiteralPath $path) -and (Get-Date) -lt $until) { [Threading.Thread]::Sleep(100) }
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return [IO.File]::ReadAllText($path)
}
try {
    $heard = New-Object System.Collections.ArrayList
    $tell = { param($m) [void]$heard.Add($m) }

    $none = Enter-ThornswoodServerFolderTurn (Join-Path $work 'no-such-folder') 'a test' 5 $tell
    Yes 'with no backup folder beside the server folders there is no turn to take ($null)' ($null -eq $none -and $heard.Count -eq 0)

    $held = Enter-ThornswoodServerFolderTurn $folder 'the test that holds it' 5 $tell
    $who = [IO.File]::ReadAllText((Join-Path $folder 'server-folders.turn.who'))
    Yes 'the turn is taken at once when nobody has it' ($null -ne $held -and $held -is [IO.FileStream] -and $heard.Count -eq 0)
    Yes ('  and says who has it: ' + $who) ($who -match ('^the test that holds it, pid ' + $PID + ', since '))

    $said = Join-Path $work 'refused.txt'
    $w = Get-Date
    $c = Child 'the second run' 3 0 $said
    $got = WaitFor $said 60
    $took = ((Get-Date) - $w).TotalSeconds
    $lines = @($got -split "`n")
    Yes ('a second run while it is held waits its time and is refused naming who has it: ' + $lines[0]) (
        $lines[0] -match '^REFUSED the server folders are still taken after 3 s, by the test that holds it, pid ' -and $took -ge 3)
    Yes ('  having said once who it waits for: ' + $lines[1]) (
        $lines.Count -eq 2 -and $lines[1] -match '^waiting for the server folders, which the test that holds it, pid [0-9]+, since .* has$')
    $null = $c.WaitForExit(30000)

    $said = Join-Path $work 'after-release.txt'
    $c = Child 'the run after' 60 0 $said 4
    # Give it back once the run after says it is waiting, however slowly it
    # started (#4342: a runner's first build took longer than a fixed 3 s).
    $waiting = WaitFor ($said + '.waiting') 60
    $early = Test-Path -LiteralPath $said
    $held.Dispose()
    $held = $null
    $w = Get-Date
    $got = WaitFor $said 30
    $took = ((Get-Date) - $w).TotalSeconds
    $lines = @($got -split "`n")
    Yes ('a run that waits gets the turn once the one before gives it back, ' + [Math]::Round($took, 1) + ' s after') (
        $waiting -and -not $early -and $lines[0] -eq 'TAKEN' -and $took -lt 10)
    Yes '  having said once that it was waiting' ($lines.Count -eq 2 -and $lines[1] -match '^waiting for the server folders, which the test that holds it')
    $null = $c.WaitForExit(30000)

    $said = Join-Path $work 'killed.txt'
    $c = Child 'a run that is killed' 5 600 $said
    $got = WaitFor $said 60
    Yes 'a run that takes the turn and holds it' ($got.StartsWith('TAKEN'))
    $heard.Clear()
    $tooSoon = $false
    try { $x = Enter-ThornswoodServerFolderTurn $folder 'this test' 0 $tell; if ($x) { $x.Dispose(); $tooSoon = $true } } catch { }
    Stop-Process -Id $c.Id -Force
    $null = $c.WaitForExit(30000)
    $heard.Clear()
    $x = Enter-ThornswoodServerFolderTurn $folder 'this test, after the kill' 0 $tell
    Yes '  leaves no turn taken once it is killed: the next takes it at once' (-not $tooSoon -and $null -ne $x -and $heard.Count -eq 0)
    if ($x) { $x.Dispose() }

    $odd = Join-Path $work 'odd'
    [void](New-Item -ItemType Directory -Path (Join-Path $odd 'server-folders.turn') -Force)
    $w = Get-Date
    $threw = ''
    try { $x = Enter-ThornswoodServerFolderTurn $odd 'this test' 30 $tell; if ($x) { $x.Dispose() } } catch { $threw = $_.Exception.GetType().Name + ': ' + $_.Exception.Message }
    Yes ('a turn file that cannot be opened for another reason is thrown at once, not waited on: ' + $threw) (
        $threw -and ((Get-Date) - $w).TotalSeconds -lt 5)
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    if ($held) { $held.Dispose() }
    foreach ($p in $started) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -EA SilentlyContinue; $null = $p.WaitForExit(30000) } }
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}
Done
