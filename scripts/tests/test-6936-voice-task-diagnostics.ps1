<#
  #6936. Run the actual voice harness try/catch with scheduled-task stand-ins.
  No real tasks are registered, removed or started. Injected operations must
  remain failures and report their stage, safe alias, location and error code.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tokens = $null; $errors = $null
$harness = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'test-voice-stray-tasks.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$runtime = @($harness.FindAll({ param($n) $n -is [Management.Automation.Language.TryStatementAst] }, $true))
$add = @($harness.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Add-Task' }, $true))
if ($runtime.Count -ne 1 -or $add.Count -ne 1) { throw 'Expected one actual runtime block and Add-Task helper' }
$installer = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'scripts/deploy/Install-Voice.ps1'), [ref]$tokens, [ref]$errors)
$sent = @($installer.FindAll({ param($n) $n -is [Management.Automation.Language.ExpandableStringExpressionAst] -and $n.Value -match 'function StartIt' }, $true))
$inner = [Management.Automation.Language.Parser]::ParseInput($sent[0].Value, [ref]$tokens, [ref]$errors)
$fn = @($inner.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'RemoveStrayTasks' }, $true))

function Run-Case([string]$kind, [string]$alias) {
    $base = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-stray-diag-' + [Guid]::NewGuid().ToString('N'))
    $resolved = [IO.Path]::GetFullPath($base)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected stand-in path' }
    $Root = Join-Path $base 'Thornswood-Voice'; $otherRoot = Join-Path $base 'Thornswood-Voice-Dev'
    $TaskName = 'stand-in own'
    $names = [ordered]@{stray='stand-in stray';byPath='stand-in byPath';own=$TaskName;other='stand-in other'}
    $node = 'stand-in node'; $me = 'stand-in principal'
    $tasks = [ordered]@{}; $calls = [Collections.Generic.List[string]]::new()
    $state = @{injected=$false;pass=0;fail=0;failure='';enumerations=0;queryErrorAction='';foreignActionReads=0}
    function Yes([string]$what, [bool]$condition) {
        if ($condition) { $state.pass++ } else { $state.fail++; $state.failure=$what }
    }
    function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) [pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory} }
    function New-ScheduledTaskPrincipal { param($UserId,$LogonType) [pscustomobject]@{} }
    function New-ScheduledTaskSettingsSet { [pscustomobject]@{} }
    function Register-ScheduledTask {
        [CmdletBinding()]param($TaskName,$Action,$Principal,$Settings)
        $calls.Add('register:' + $TaskName)
        if ($kind -eq 'register' -and $TaskName -eq $names[$alias] -and -not $state.injected) {
            $state.injected=$true
            Write-Error -Exception ([IO.IOException]::new('injected sharing probe', -2147024864)) -Message 'injected sharing probe'
            return
        }
        $tasks[$TaskName]=[pscustomobject]@{TaskName=$TaskName;TaskPath='\';Actions=@($Action)}
    }
    function Get-ScheduledTask {
        [CmdletBinding()]param($TaskName)
        if ($TaskName) { return $tasks[$TaskName] }
        $state.enumerations++
        $state.queryErrorAction = [string]$PSBoundParameters.ErrorAction
        if ($kind -eq 'enumeration-error') { Write-Error 'private enumeration failure' -ErrorId 'FixtureEnumerationUnavailable'; return }
        if ($kind -eq 'path-spelling') {
            $from = [string][IO.Path]::DirectorySeparatorChar
            $to = if ($from -eq '\') { '/' } else { '\' }
            foreach ($task in $tasks.Values) {
                $task.Actions[0].Arguments = $task.Actions[0].Arguments.Replace($from, $to)
                $task.Actions[0].WorkingDirectory = $task.Actions[0].WorkingDirectory.Replace($from, $to)
            }
        }
        # The real removal reads this action once; the diagnostic must not
        # inspect or publish metadata for an unrelated task.
        $foreign = [pscustomobject]@{TaskName='private unrelated task';TaskPath='private unrelated folder'}
        $foreign | Add-Member -MemberType ScriptProperty -Name Actions -Value {
            $state.foreignActionReads++
            @([pscustomobject]@{Execute='private executable';Arguments='private arguments';WorkingDirectory='private working folder'})
        }
        $foreign
        @($tasks.Values)
    }
    function Stop-ScheduledTask { [CmdletBinding()]param($TaskName,$TaskPath) $calls.Add('stop:' + $TaskName) }
    function Unregister-ScheduledTask {
        [CmdletBinding()]param($TaskName,$TaskPath,[switch]$Confirm)
        $calls.Add('unregister:' + $TaskName)
        if ($kind -eq 'remove' -and $TaskName -eq $names[$alias] -and -not $state.injected) {
            $state.injected=$true
            Write-Error -Exception ([IO.IOException]::new('injected sharing probe', -2147024864)) -Message 'injected sharing probe'
            return
        }
        $tasks.Remove($TaskName)
    }
    $captured = @(& {
        . ([scriptblock]::Create($add[0].Extent.Text))
        & ([scriptblock]::Create($runtime[0].Extent.Text))
    } 6>&1)
    $events = @($captured | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('VOICE_TASK_FAILURE ') } | ForEach-Object { $_.ToString().Substring(19) | ConvertFrom-Json })
    $enumerations = @($captured | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('VOICE_TASK_ENUMERATION ') } | ForEach-Object { $_.ToString().Substring(23) | ConvertFrom-Json })
    [pscustomobject]@{pass=$state.pass;fail=$state.fail;failure=$state.failure;events=$events;calls=@($calls);injected=$state.injected;
        enumerations=$enumerations;queryCount=$state.enumerations;queryErrorAction=$state.queryErrorAction;foreignActionReads=$state.foreignActionReads}
}
$pass=0; $fail=0
function Check([string]$what,[bool]$condition) {
    if ($condition) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}
$ok=Run-Case '' ''
Check 'actual runtime block retains all five successful behavior checks' ($ok.pass -eq 5 -and $ok.fail -eq 0 -and $ok.events.Count -eq 0)
Check 'actual installer removes both strays and keeps own and adjacent-root tasks' (@($ok.calls | Where-Object { $_ -like 'stop:*' }).Count -eq 2 -and $ok.calls -contains 'stop:stand-in stray' -and $ok.calls -contains 'stop:stand-in byPath')
foreach ($case in @(@('register','stray'),@('register','byPath'),@('remove','stray'))) {
    $result=Run-Case $case[0] $case[1]
    Check ('injected operation remains one original harness failure: ' + ($case -join '/')) ($result.injected -and $result.fail -eq 1 -and $result.failure -match 'injected sharing probe')
    Check ('failure identifies the actual stage: ' + ($case -join '/')) ($result.events.Count -eq 1 -and $result.events[0].stage -eq $(if ($case[0] -eq 'register') {'register'} else {'remove-strays'}))
    if ($result.events.Count -eq 1) {
        $event=$result.events[0]
        Check 'failure records location stack and original exception HResult' ($event.position.Length -gt 0 -and $event.stack.Length -gt 0 -and $event.hResult -eq -2147024864 -and $event.message -match 'injected sharing probe')
        Check 'only a safe alias is reported, with unknown identity left explicit' ($event.taskAlias -in @('stray','byPath','own','other','unavailable') -and ($case[0] -ne 'register' -or $event.taskAlias -eq $case[1]))
        Check 'diagnostic record omits principal and complete task definitions' (($event | ConvertTo-Json -Compress) -notmatch 'stand-in principal|WorkingDirectory|Actions')
    }
}
# #7321: no real Scheduler calls. Observe the actual single enumeration,
# without turning a silent query failure or a path mismatch into success.
Check 'one original query retains its explicit silent error action' ($ok.queryCount -eq 1 -and $ok.queryErrorAction -eq 'SilentlyContinue')
Check 'the actual enumeration emits one structured fixture observation' ($ok.enumerations.Count -eq 1)
if ($ok.enumerations.Count -eq 1) {
    $sample=$ok.enumerations[0]
    Check 'the observation contains exactly the four fixture aliases' (($sample.tasks.alias -join ',') -eq 'stray,byPath,own,other' -and @($sample.tasks | Where-Object {$_.count -eq 1}).Count -eq 4)
    Check 'owned action metadata and expected root can distinguish path spelling' ($sample.tasks[0].actions[0].workingDirectory -eq $sample.root -and $sample.tasks[1].actions[0].arguments.Contains($sample.root) -and $sample.errorIds.Count -eq 0)
    Check 'unrelated identity action metadata and principal are never published' (($sample | ConvertTo-Json -Depth 8 -Compress) -notmatch 'private unrelated|private executable|private arguments|private working folder|stand-in principal')
}
Check 'the diagnostic adds no unrelated action read to the original removal' ($ok.foreignActionReads -eq 1)
$unavailable=Run-Case 'enumeration-error' ''
Check 'a suppressed query error keeps all original refusal assertions failed' ($unavailable.pass -eq 2 -and $unavailable.fail -eq 3 -and $unavailable.events.Count -eq 0)
Check 'the same suppressed query error identifies absent owned rows without its private message' ($unavailable.enumerations.Count -eq 1 -and $unavailable.enumerations[0].errorIds.Count -eq 1 -and $unavailable.enumerations[0].errorIds[0] -match '^FixtureEnumerationUnavailable' -and @($unavailable.enumerations[0].tasks | Where-Object {$_.count -eq 0}).Count -eq 4 -and ($unavailable.enumerations[0] | ConvertTo-Json -Depth 8 -Compress) -notmatch 'private enumeration failure')
$spelling=Run-Case 'path-spelling' ''
Check 'changed returned paths keep the original three failures and all owned rows' ($spelling.pass -eq 2 -and $spelling.fail -eq 3 -and $spelling.enumerations.Count -eq 1 -and @($spelling.enumerations[0].tasks | Where-Object {$_.count -eq 1}).Count -eq 4 -and $spelling.enumerations[0].errorIds.Count -eq 0)
Write-Host ("{0} passed, {1} failed" -f $pass,$fail)
if ($fail) { exit 1 }
