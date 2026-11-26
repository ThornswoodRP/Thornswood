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
    $state = @{injected=$false;pass=0;fail=0;failure=''}
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
    [pscustomobject]@{pass=$state.pass;fail=$state.fail;failure=$state.failure;events=$events;calls=@($calls);injected=$state.injected}
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
Write-Host ("{0} passed, {1} failed" -f $pass,$fail)
if ($fail) { exit 1 }
