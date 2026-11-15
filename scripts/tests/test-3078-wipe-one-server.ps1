<#
  test-3078-wipe-one-server.ps1

  Wipe-Saves.ps1 -Server dev wipes the dev server and leaves main as it is.

  WHY THIS EXISTS. Issue #3078: containers start empty from the engine fix
  on, and the ones opened before keep what was saved in them. Patrick chose to
  wipe dev with that release and leave main to its next wipe. Wipe-Saves took
  every server folder on the box at once, so -Server picks one by the name its
  own server-settings.json gives it (thornswoodServer).

  This lifts the part of Wipe-Saves that reads the box's survey into the list
  of folders to move, and runs it over a survey of two servers: with -Server
  dev only the dev folder, its task and its files are taken; with -Server main
  only main's; with none, both, as before; and a name no folder carries stops
  with nothing taken. The box half that writes the NAME line is checked in the
  survey's text, and so is the line that says a folder's settings could not
  be read, which stops -Server rather than guess.

  Read only.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\ops\Wipe-Saves.ps1'.Replace('\', [IO.Path]::DirectorySeparatorChar))).Replace("`r`n", "`n")
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
Yes 'Wipe-Saves.ps1 parses' (@($errors).Count -eq 0)
$param = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Server' })
Yes 'it takes -Server' ($param.Count -eq 1)
Yes 'the survey says each folder''s thornswoodServer on a NAME line' (
    $text.Contains("'NAME|' + ``" + '$r') -and $text.Contains('.thornswoodServer)'))

$from = $text.IndexOf('$roots  = @()')
$to = $text.IndexOf('if ($items.Count -eq 0)')
Yes 'the survey reader is in the script' ($from -ge 0 -and $to -gt $from)
$reader = $text.Substring($from, $to - $from)

$survey = @(
    'ROOT|C:\Thornswood-Server',
    'NAME|C:\Thornswood-Server|main',
    'TASK|C:\Thornswood-Server|Thornswood Server',
    'ITEM|C:\Thornswood-Server\world|100|3',
    'ITEM|C:\Thornswood-Server\private\characters.json|10|1',
    'CHARS|4',
    'ROOT|C:\Thornswood-Server-Dev',
    'NAME|C:\Thornswood-Server-Dev|dev',
    'TASK|C:\Thornswood-Server-Dev|Thornswood Dev Server',
    'ITEM|C:\Thornswood-Server-Dev\world|50|2',
    'NONE|private\characters.json'
)

function Read-Survey([string]$server) {
    $sb = [scriptblock]::Create(@"
param(`$lines, `$Server)
function Say(`$m, `$c) { }
function Die(`$m) { throw ('DIE ' + `$m) }
$reader
return @{ roots = `$roots; tasks = `$taskOf; items = `$items }
"@)
    try { return (& $sb $survey $server) } catch { return @{ died = "$($_.Exception.Message)" } }
}

$dev = Read-Survey 'dev'
Yes 'D1 -Server dev takes only the dev folder' ((@($dev.roots) -join ',') -eq 'C:\Thornswood-Server-Dev')
Yes 'D2 and only its task' ((@($dev.tasks.Keys) -join ',') -eq 'C:\Thornswood-Server-Dev')
Yes 'D3 and only its files' ((@($dev.items) -join ',') -eq 'C:\Thornswood-Server-Dev\world')

$main = Read-Survey 'main'
Yes 'M1 -Server main takes only main''s folder' ((@($main.roots) -join ',') -eq 'C:\Thornswood-Server')
Yes 'M2 and its two files' (@($main.items).Count -eq 2 -and @($main.items | Where-Object { $_ -like 'C:\Thornswood-Server-Dev*' }).Count -eq 0)

$all = Read-Survey ''
Yes 'A1 with no -Server both go, as before' (@($all.roots).Count -eq 2 -and @($all.items).Count -eq 3 -and @($all.tasks.Keys).Count -eq 2)

$none = Read-Survey 'staging'
Yes 'N1 a name no folder carries stops with nothing taken' ($none.ContainsKey('died') -and $none.died -like 'DIE No server*')

# Settings the box could not read are said with why, never passed over: with
# -Server that folder might be the one asked for, so nothing is taken.
Yes 'U1 the survey says settings it could not read on a NAMEERR line, with why' (
    $text.Contains("'NAMEERR|' + ``" + '$r') -and $text.Contains('Exception.Message'))
$survey = @($survey | ForEach-Object { if ($_ -eq 'NAME|C:\Thornswood-Server|main') { 'NAMEERR|C:\Thornswood-Server|Invalid JSON primitive' } else { $_ } })
$bad = Read-Survey 'dev'
Yes 'U2 with -Server an unreadable folder stops the run with nothing taken, naming it' (
    $bad.ContainsKey('died') -and $bad.died -like '*C:\Thornswood-Server *could not be read*Invalid JSON primitive*')
$badAll = Read-Survey ''
Yes 'U3 with no -Server every folder still goes, as before' (-not $badAll.ContainsKey('died') -and @($badAll.roots).Count -eq 2)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
