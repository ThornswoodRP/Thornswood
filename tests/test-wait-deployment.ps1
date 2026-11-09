<#
  test-wait-deployment.ps1

      pwsh -NoProfile -File .\tests\test-wait-deployment.ps1

  A release counts only once the box runs it. On 9 Nov the Main Deployments
  of build-20261108.5, build-1.3.0 and build-1.3.4 sat with no status at all,
  because the box deploy agent was never told to look after main, and
  promote-main.yml finished green every time. scripts/release/Wait-Deployment.ps1
  now ends those runs, and merge-release.yml's, on the agent's own status.

  What this proves, against a stand-in gh (a function of that name wins over
  the program), so nothing leaves the machine:
    1. success from the agent ends 0, and so does inactive (a newer
       Deployment of that environment was applied instead);
    2. failure ends 1 with the agent's own words;
    3. no status at all past the limit ends 1 and says the agent is not
       looking after that environment: the 9 Nov case;
    4. several Deployments end 0 only when every one is done, 1 when any fails;
    5. both workflows run it on the Deployments they make;
    6. the agent's success line names main on main, not dev (9 Nov).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Wait = Join-Path $Repo 'scripts/release/Wait-Deployment.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

# $global:TwPlan (global: the stand-in gh runs inside Wait-Deployment.ps1, whose script scope is its own): deployment id -> list of answers, one per ask, the last one
# repeating. Each answer is $null (no status yet) or @(state, description).
$global:TwPlan = @{}
$global:TwAsks = @{}
function gh {
    $url = [string]$args[1]
    $m = [regex]::Match($url, 'deployments/(\d+)/statuses')
    if (-not $m.Success) { $global:LASTEXITCODE = 1; return }
    $id = [long]$m.Groups[1].Value
    $n = [int]$global:TwAsks[[int]$id]; $global:TwAsks[[int]$id] = $n + 1
    $list = $global:TwPlan[[int]$id]
    $a = $list[[Math]::Min($n, $list.Count - 1)]
    $global:LASTEXITCODE = 0
    if ($null -eq $a) { return '[]' }
    return (ConvertTo-Json -Compress -InputObject @([ordered]@{ state = $a[0]; description = $a[1]; creator = @{ login = 'thornswood-box-admin[bot]' } }))
}
function Run([long[]]$ids, [int]$minutes = 1) {
    $global:TwAsks = @{}
    $out = & $Wait -Repo 'ThornswoodRP/Thornswood' -Id $ids -Minutes $minutes -EverySeconds 0 *>&1 | ForEach-Object { "$_" }
    return @{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
}

$global:TwPlan[1] = @($null, @('in_progress', 'the deploy agent on the box is applying this'), @('success', 'build-1.3.4: dev runs gamemode blob b011cb209405'))
$r = Run @(1)
Yes ('1. success from the agent ends 0 (exit ' + $r.Code + ')') ($r.Code -eq 0 -and $r.Text -match 'deployment 1: success by thornswood-box-admin')
$global:TwPlan[2] = @(,@('inactive', 'not applied: deployment 9 came after it and is applied instead'))
$r = Run @(2)
Yes '   inactive (a newer one applied instead) ends 0 too' ($r.Code -eq 0 -and $r.Text -match 'a newer one of its environment was applied instead')

$global:TwPlan[3] = @(,@('failure', 'not applied: the stage check refused gamemode.js'))
$r = Run @(3)
Yes '2. failure ends 1 with the agent''s words' ($r.Code -eq 1 -and $r.Text -match 'deployment 3: failure by thornswood-box-admin\[bot\]: not applied: the stage check refused gamemode\.js')

# No status at all, ever: -Minutes 0 makes the limit already passed on the first look.
$global:TwPlan[4] = @($null)
$r = Run @(4) 0
Yes '3. no status past the limit ends 1 (the 9 Nov case)' ($r.Code -eq 1 -and $r.Text -match 'deployment 4 has no status at all after 0 minutes')
Yes '   and says the agent is not looking after that environment' ($r.Text -match 'not looking after its environment' -and $r.Text -match 'agent\.json')

$global:TwPlan[5] = @($null, @('success', 'site build-1.3.4'))
$global:TwPlan[6] = @($null, $null, @('success', 'bot build-1.3.4'))
$r = Run @(5, 6)
Yes '4. several end 0 once every one is done' ($r.Code -eq 0 -and $r.Text -match 'deployment 5: success' -and $r.Text -match 'deployment 6: success')
$r = Run @(5, 3)
Yes '   and 1 when any one fails' ($r.Code -eq 1 -and $r.Text -match 'deployment 3: failure')

$mr = Get-Content -LiteralPath (Join-Path $Repo '.github/workflows/merge-release.yml') -Raw
$pm = Get-Content -LiteralPath (Join-Path $Repo '.github/workflows/promote-main.yml') -Raw
Yes '5. merge-release.yml waits on its Deployments to Dev, Site and Discord bot' ($mr.Contains('name: The box ran it') -and $mr.Contains('steps.devdeploy.outputs.id') -and $mr.Contains('steps.appdeploy.outputs.ids') -and $mr.Contains('./scripts/release/Wait-Deployment.ps1'))
Yes '   and promote-main.yml on its Deployment to Main' ($pm.Contains('name: The live server ran it') -and $pm.Contains('steps.deploy.outputs.id') -and $pm.Contains('./scripts/release/Wait-Deployment.ps1'))
$srv = Get-Content -LiteralPath (Join-Path $Repo 'tools/DeployAgent/Server.cs') -Raw
Yes '6. the agent''s success line names the server it ran on, not "dev" on main too' ($srv.Contains('string Which => env.GitHubEnvironment.ToLowerInvariant();') -and $srv.Contains('$"{Which} runs gamemode blob') -and $srv.Contains('$"{Which} runs server build') -and -not $srv.Contains('$"dev runs '))
Done
