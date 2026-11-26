<#
  test-voice-stray-tasks.ps1

      pwsh -NoProfile -File .\scripts\tests\test-voice-stray-tasks.ps1

  Installing voice takes off any other task that starts voice-server.js from
  the root it installs, and leaves another root's alone (#2008).

  WHY. scripts\oneoff\Fix-Voice.ps1 registered ThornswoodVoice on the VPS on
  13 September: at boot, node "C:\Thornswood-Voice\voice-server.js" in
  C:\Thornswood-Voice, with none of the environment Install-Voice's task
  sets, so no auth and no loopback bind. It was still there, Ready, on
  5 October, beside Thornswood Voice, and after a reboot whichever of the two
  got port 7778 first was live voice.

  HOW. Install-Voice builds its task on the VPS in a script it sends there, a
  here-string. That here-string is found and read as the script the box runs,
  and its RemoveStrayTasks function taken out of it and run here, with the
  installer's own $Root and $TaskName, against three tasks registered for the
  person running this (no elevation needed):
    a stray one that starts voice-server.js from the root, by working folder;
    the install's own task, also in the root;
    another root's, whose folder only begins like this one.
  The stray goes, the other two stay. A second stray, named by its full path
  with another working folder, goes too.

  -InstallVoice reads another copy, so the same test runs on the one from
  before this change:

      git show 54b5c92f:scripts/deploy/Install-Voice.ps1 > $env:TEMP\voice-before.ps1
      pwsh -NoProfile -File .\scripts\tests\test-voice-stray-tasks.ps1 -InstallVoice $env:TEMP\voice-before.ps1

  Registers and removes tasks named Thornswood stray harness <guid> ... (not
  'Thornswood Test...', which other harnesses clear away, #1135). Nothing is
  started; writes nothing else.
#>
[CmdletBinding()]
param([string]$InstallVoice)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $InstallVoice) { $InstallVoice = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Install-Voice.ps1') }

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

# ---- read, not run -------------------------------------------------------------
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath($InstallVoice), [ref]$t, [ref]$e)
Yes 'Install-Voice.ps1 parses' (-not $e -or $e.Count -eq 0)
# Value is the text with its escapes taken out and nothing expanded: the script
# the box runs, but for the installer's own variables, still written as names.
$sent = @($ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Value -match 'function StartIt' }, $true))
Yes ('it sends one script that starts the task (' + $sent.Count + ')') ($sent.Count -eq 1)
if ($sent.Count -ne 1) { Done }
$t2 = $null; $e2 = $null
$inner = [System.Management.Automation.Language.Parser]::ParseInput($sent[0].Value, [ref]$t2, [ref]$e2)
Yes 'the script it sends parses' (-not $e2 -or $e2.Count -eq 0)
$fn = @($inner.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'RemoveStrayTasks' }, $true))
Yes 'it has a step that takes off another task starting voice from its root' ($fn.Count -eq 1)
$start = @($inner.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'StartIt' }, $true))
Yes '  and StartIt runs it when it registers the task' ($start.Count -eq 1 -and $start[0].Body.Extent.Text -match '(?m)^\s*RemoveStrayTasks\s*$')
if ($fn.Count -ne 1) { Done }

# ---- run, through Task Scheduler ----------------------------------------------
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')   # $OnWindows (#2957)
if (-not $onWindows) { Write-Host 'SKIP  the task part needs Windows and its Task Scheduler'; Done }
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { Write-Host 'SKIP  the ScheduledTasks module did not load'; Done }

$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$base = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-stray-' + $id)
$Root = Join-Path $base 'Thornswood-Voice'
$otherRoot = Join-Path $base 'Thornswood-Voice-Dev'
$TaskName = "Thornswood stray harness $id own"
$names = [ordered]@{
    stray    = "Thornswood stray harness $id stray"
    byPath   = "Thornswood stray harness $id by path"
    own      = $TaskName
    other    = "Thornswood stray harness $id other root"
}
$node = 'C:\Program Files\nodejs\node.exe'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
function Add-Task([string]$name, [string]$args2, [string]$dir) {
    $a = New-ScheduledTaskAction -Execute $node -Argument $args2 -WorkingDirectory $dir
    $p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive
    Register-ScheduledTask -TaskName $name -Action $a -Principal $p -Settings (New-ScheduledTaskSettingsSet) | Out-Null
}
try {
    $taskStage = 'create-folders'; $taskAlias = 'unavailable'
    New-Item -ItemType Directory -Force -Path $Root, $otherRoot | Out-Null
    # As Fix-Voice.ps1 made it: the full path, and the root as its folder.
    $taskStage = 'register'; $taskAlias = 'stray'
    Add-Task $names.stray ('"' + $Root + '\voice-server.js"') $Root
    # The full path only, from somewhere else.
    $taskAlias = 'byPath'
    Add-Task $names.byPath ('"' + $Root + '\voice-server.js"') $base
    # The install's own, as Install-Voice's cmd starts it: a bare name in the root.
    $taskAlias = 'own'
    Add-Task $names.own 'voice-server.js' $Root
    # Dev's, beside live's, whose folder begins with live's.
    $taskAlias = 'other'
    Add-Task $names.other ('"' + $otherRoot + '\voice-server.js"') $otherRoot

    # The installer expands its own $Root and $TaskName before it sends the
    # script; the box's own variables are escaped and stay. Case matters:
    # $rootDir is the box's.
    $taskStage = 'prepare-removal'; $taskAlias = 'unavailable'
    $text = $fn[0].Extent.Text.Replace('$Root', $Root).Replace('$TaskName', $TaskName)
    $box = [scriptblock]::Create($text + "`nRemoveStrayTasks")
    $taskStage = 'remove-strays'
    $said = @(& $box | ForEach-Object { "$_" })
    $said | ForEach-Object { Write-Host ('      ' + $_) }
    $left = @{}
    $taskStage = 'read-results'
    foreach ($k in $names.Keys) {
        $taskAlias = $k
        $left[$k] = [bool](Get-ScheduledTask -TaskName $names[$k] -ErrorAction SilentlyContinue)
    }
    Yes 'the stray task in the root is taken off' (-not $left.stray)
    Yes '  and so is one that names the root''s voice-server.js from another folder' (-not $left.byPath)
    Yes '  and it says which, by name' (($said -join "`n") -match [regex]::Escape($names.stray) -and ($said -join "`n") -match [regex]::Escape($names.byPath))
    Yes 'the install''s own task stays' ($left.own)
    Yes 'another root''s task stays, though its folder begins with this one''s' ($left.other)
}
catch {
    $taskError = $_
    # A removal error may identify a particular task. Report only its fixture
    # alias when the error proves that identity; otherwise leave it unknown.
    if ($taskError.InvocationInfo -and $taskError.InvocationInfo.BoundParameters -and $taskError.InvocationInfo.BoundParameters.ContainsKey('TaskName')) {
        $boundName = $taskError.InvocationInfo.BoundParameters['TaskName']
        foreach ($entry in $names.GetEnumerator()) {
            if ($entry.Value -eq $boundName) { $taskAlias = $entry.Key; break }
        }
    }
    Write-Host ('VOICE_TASK_FAILURE ' + ([ordered]@{
        stage = $taskStage; taskAlias = $taskAlias
        message = $taskError.Exception.Message; hResult = $taskError.Exception.HResult
        errorId = $taskError.FullyQualifiedErrorId
        position = if ($taskError.InvocationInfo) { [string]$taskError.InvocationInfo.PositionMessage } else { '' }
        stack = [string]$taskError.ScriptStackTrace
    } | ConvertTo-Json -Compress))
    Yes ('the harness ran to the end without an error: ' + $_.Exception.Message) $false
}
finally {
    foreach ($n in $names.Values) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
Done
