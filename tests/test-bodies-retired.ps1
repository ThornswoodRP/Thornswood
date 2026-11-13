<#
  test-bodies-retired.ps1

      pwsh -NoProfile -File .\tests\test-bodies-retired.ps1

  Add-Bodies.ps1 refuses to run, and nothing still runs it.

  WHY THIS EXISTS. Issue #405 (entry 221 on the To Do List): the female body
  in the game folder is the fully nude 3BA mesh, and the script that put it
  there puts it back every time it runs. MEASURED 24 SEPTEMBER:
  femalebody_0.nif and femalebody_1.nif in C:\Thornswood\Game\Data hold the
  shapes 3BA, 3BA_Vagina and 3BA_Anus and no Bra or Panty. The script poured
  CBBE's "00 Required" and 3BA's "00 Base" straight over those two files, and
  they are Vortex hard links now (Profile\OwnGame\files.txt records them as
  L|V), so a run also wrote into Vortex's own staging copy, which the settled
  design forbids. It was still a step in Run-Everything.ps1.

  The covered body arrives the way every other mesh does, through the Nexus
  collection, which is Patrick's. What the repository can do is make sure no
  script of ours undoes it, and that is what this holds: the script throws a
  STOP before it touches anything, a run against a scratch game folder leaves
  that folder byte for byte as it was, and Run-Everything.ps1 no longer calls
  it. Pattern from #735 Add-TempleRespawn, #768 Add-JContainers and
  Add-Characters.ps1, whose refusals tests\test-sunhelm-gone.js holds.

  On a machine with the game built it also reads the shape names out of
  femalebody_1.nif, the check the issue gives, and fails on anything but a
  covered body: the launcher builds it covered since #3715, so a nude body, a
  mesh that will not read or a check that breaks is a fault there (#4233).

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$GameRoot = 'C:\Thornswood')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Shell = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the scripts in scripts\<area> since issue #440.
$Repo = Split-Path -Parent $Here
$Bodies = Join-Path $Repo 'scripts\mods\Add-Bodies.ps1'
$RunAll = Join-Path $Repo 'scripts\oneoff\Run-Everything.ps1'
$Index = Join-Path $Repo 'scripts\README.md'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }

$Utf8 = New-Object Text.UTF8Encoding($false)

# ============================================================ the refusal

Yes 'Add-Bodies.ps1 is there' (Test-Path -LiteralPath $Bodies)
$text = [IO.File]::ReadAllText($Bodies, $Utf8)
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $Bodies, [ref]$tokens, [ref]$errors)
Yes 'it parses' (@($errors).Count -eq 0)

# The first statement after the param block has to be the throw. Anything
# above it runs, and the dot source of Close-Launcher.ps1 would stop the
# launcher before the refusal said a word.
$first = $null
if ($ast.EndBlock -and @($ast.EndBlock.Statements).Count) { $first = $ast.EndBlock.Statements[0] }
Yes 'its first statement is a throw' ($first -is [System.Management.Automation.Language.ThrowStatementAst])
$said = ''
if ($first -is [System.Management.Automation.Language.ThrowStatementAst]) { $said = $first.Extent.Text }
Yes 'and the throw says STOP' ($said -match "\('STOP\.")
Yes 'and names the issue' ($said -match '#405')
Yes 'and says why: the nude body goes back over the build' ($said -match '(?i)nude' -and $said -match 'Game\\Data')
Yes "and that the meshes there are Vortex's" ($said -match 'Vortex')
Yes 'and where the body comes from instead, the collection' ($said -match '(?i)collection')

$stopAt = $text.IndexOf("throw ('STOP.")
foreach ($later in "Set-StrictMode", ". (Join-Path `$Here '..\dev\Close-Launcher.ps1')", "Head 'Making room'",
                   "Remove-Item `$work", "Copy-Item -LiteralPath") {
    $at = $text.IndexOf($later)
    Yes ("the throw comes before " + $later) ($stopAt -ge 0 -and $at -gt $stopAt)
}

$headEnd = $text.IndexOf('#>')
$header = if ($headEnd -gt 0) { $text.Substring(0, $headEnd) } else { '' }
Yes 'the header opens with RETIRED. DO NOT RUN.' ($header -match '(?s)Add-Bodies\.ps1\s+RETIRED\. DO NOT RUN\.')
Yes 'and names the issue' ($header -match '#405')
Yes 'and keeps what it used to do, for the history' ($header -match 'What it used to do')

# ============================================ a run touches nothing at all

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-bodies-' + [Guid]::NewGuid().ToString('N'))
try {
    $root = Join-Path $work 'Thornswood'
    $mesh = Join-Path $root 'Game\Data\meshes\actors\character\character assets\femalebody_1.nif'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $mesh)
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $root 'Profile\Default')
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work 'Downloads')
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work 'temp')
    # A covered body, as far as the shape names go, and a plugin list.
    $meshBytes = [Text.Encoding]::ASCII.GetBytes('Gamebryo File Format 3BA Bra Panty 3BA_Vagina 3BA_Anus')
    [IO.File]::WriteAllBytes($mesh, $meshBytes)
    $plug = Join-Path $root 'Profile\Default\plugins.txt'
    [IO.File]::WriteAllText($plug, "*Skyrim Unbound.esp`r`n", $Utf8)
    # An archive by the name it looks for, so a script that got past the
    # throw would find something to unpack.
    [IO.File]::WriteAllText((Join-Path $work 'Downloads\XP32 Maximum Skeleton Special Extended.7z'), 'x', $Utf8)
    $before = @(Get-ChildItem -LiteralPath $root -Recurse -Force |
                ForEach-Object { $_.FullName + '|' + $(if ($_.PSIsContainer) { 'dir' } else { $_.Length }) } | Sort-Object)

    $pwsh = (Get-Process -Id $PID).Path
    $oldTemp = $env:TEMP
    $env:TEMP = Join-Path $work 'temp'
    try {
        $out = & $pwsh -NoProfile -ExecutionPolicy Bypass -File $Bodies -Root $root `
                   -Downloads (Join-Path $work 'Downloads') -NoShip -NoPause 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $env:TEMP = $oldTemp }

    Yes ("a run exits non-zero (exit code {0})" -f $code) ($code -ne 0)
    Yes 'and says STOP and the issue' ($out -match 'STOP\. Add-Bodies\.ps1 is retired' -and $out -match '#405')
    $after = @(Get-ChildItem -LiteralPath $root -Recurse -Force |
               ForEach-Object { $_.FullName + '|' + $(if ($_.PSIsContainer) { 'dir' } else { $_.Length }) } | Sort-Object)
    Yes 'the scratch game folder has the same files afterwards' (($before -join "`n") -eq ($after -join "`n"))
    $now = [IO.File]::ReadAllBytes($mesh)
    Yes 'and femalebody_1.nif is byte for byte the body that was there' (
        [Convert]::ToBase64String($now) -eq [Convert]::ToBase64String($meshBytes))
    Yes 'and plugins.txt is untouched' ([IO.File]::ReadAllText($plug, $Utf8) -eq "*Skyrim Unbound.esp`r`n")
    Yes 'and it made no unpack folder' (-not (Test-Path -LiteralPath (Join-Path $work 'temp\Bodies-install')))
} catch {
    Yes ('the run ran: ' + $_.Exception.Message) $false
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ================================================= nothing still calls it

Yes 'Run-Everything.ps1 is there' (Test-Path -LiteralPath $RunAll)
$all = [IO.File]::ReadAllText($RunAll, $Utf8)
$rt = $null; $re = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($all, $RunAll, [ref]$rt, [ref]$re)
Yes 'it parses' (@($re).Count -eq 0)
Yes 'it no longer runs Add-Bodies as a step' ($all -notmatch "Script\s*=\s*'Add-Bodies\.ps1'")
Yes 'and no longer wants the files that step left' ($all -notmatch 'cbp\.dll' -and $all -notmatch "'XPMSE\.esp'")
Yes 'and its release note no longer promises new bodies' ($all -notmatch '(?i)new bodies for everyone')

$callers = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Include '*.ps1', '*.cmd' |
             Where-Object { $_.Name -ne 'Add-Bodies.ps1' -and $_.Name -ne 'New-ScriptIndex.ps1' } |
             Where-Object {
                 $body = [IO.File]::ReadAllText($_.FullName, $Utf8)
                 # A call, not a mention in a comment. Remove-FomodLeftovers.ps1
                 # names it in its header, to say what it cleans up after.
                 if ($_.Extension -eq '.ps1') {
                     $tk = $null; $pe = $null
                     [void][System.Management.Automation.Language.Parser]::ParseInput($body, $_.FullName, [ref]$tk, [ref]$pe)
                     @($tk | Where-Object { $_.Kind -ne 'Comment' -and $_.Text -match 'Add-Bodies' }).Count -gt 0
                 } else {
                     @($body -split "\r?\n" | Where-Object { $_ -notmatch '^\s*(rem\b|::)' -and $_ -match 'Add-Bodies' }).Count -gt 0
                 }
             } | ForEach-Object { $_.Name })
Yes ('no other script under scripts runs it' + $(if ($callers.Count) { ': ' + ($callers -join ', ') } else { '' })) ($callers.Count -eq 0)

$row = @([IO.File]::ReadAllText($Index, $Utf8) -split "\r?\n" | Where-Object { $_.StartsWith('| [mods/Add-Bodies.ps1]') })
Yes 'scripts\README.md lists it as RETIRED' ($row.Count -eq 1 -and $row[0] -match '\| RETIRED\. DO NOT RUN\.')

# ======================================================== this machine

# Through Check-CoveredBodies.ps1, which reads the mesh's shape names. The
# byte search this used to do was wrong both ways: "Bra" is in malebody_1.nif
# by chance, and bone names carry the anatomy words on covered bodies too.
# Join-Path stops on a drive this machine does not have (C: off Windows),
# so whether the folder is here at all is asked first.
$live = $(if (Test-Path -LiteralPath $GameRoot) { Join-Path $GameRoot 'Game\Data\meshes\actors\character\character assets\femalebody_1.nif' } else { '' })
if ($live -and (Test-Path -LiteralPath $live)) {
    $check = Join-Path $Repo 'scripts\mods\Check-CoveredBodies.ps1'
    $out = & $Shell -NoProfile -ExecutionPolicy Bypass -File $check `
               -Game (Join-Path $GameRoot 'Game') 2>&1 | Out-String
    $code = $LASTEXITCODE
    $line = @($out -split "\r?\n" | Where-Object { $_ -match '^\s+\S+\s+femalebody_1\.nif' } | ForEach-Object { $_.Trim() }) -join ''
    # The launcher builds the bodies covered on every computer since #3715,
    # so on a machine with the game anything but covered is a failure: 2 is a
    # nude body, 1 a folder or mesh the check could not read, and anything
    # else the check itself breaking (#4233).
    $why = switch ($code) { 0 { 'covered' } 2 { 'nude' } 1 { 'not read' } default { 'the check broke, exit ' + $code } }
    Yes ('the female body in the game folder is the covered one: ' + $why + ' (' + $line + ')') ($code -eq 0)
} elseif (Test-Path -LiteralPath $GameRoot) {
    Yes ('femalebody_1.nif is present in the game folder at ' + $GameRoot) $false
} elseif ($PSBoundParameters.ContainsKey('GameRoot')) {
    Yes ('the requested game folder exists at ' + $GameRoot) $false
} else {
    Skip ('no game folder at ' + $GameRoot)
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
