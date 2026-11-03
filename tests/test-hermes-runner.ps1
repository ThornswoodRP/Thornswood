<#
  test-hermes-runner.ps1

      pwsh -NoProfile -File tests\test-hermes-runner.ps1

  Thornswood-Hermes's Windows guard rail check runs on one runner of the box
  (Patrick's A on q-hermes-ci-free-runners, 2 Nov 2026: the free private
  minutes were spent and the limit stays at $0). It is an organization runner
  (q-hermes-box-runner-token): the box admin App is never on
  Thornswood-Hermes, so the token that registers it is the organization's
  Self-hosted runners write, and nothing of that repository. This holds:
    1. records\hermes-runner.json gives it names the box's locks already
       cover: a C:\Thornswood-Runner* folder, a thornswood-runner* account
       of at most 20 characters, its own label and none of the box's;
    2. Install-Runner.ps1 -Hermes registers it to the organization with that
       label alone, as that account in that folder, and asks GitHub through
       the organization's runner endpoints;
    3. -Hermes takes no name, -Number, -OffBox, -Migrate or -Lock beside it,
       and changes nothing when given one;
    4. through the gate it asks ops-access.js for hermes-runners, never the
       ops repository's runners token, and the gate's verb takes -Hermes;
    5. the box admin App stays off Thornswood-Hermes in the record.

  HOW. Reads the files, and runs the script with -DryRunTo, which writes
  the scripts it would send and runs none of them; every gh call gets a
  stand-in. Runs anywhere pwsh does.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$script = Join-Path $Repo 'scripts/deploy/Install-Runner.ps1'
$ps = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$rec = Get-Content -LiteralPath (Join-Path $Repo 'records/hermes-runner.json') -Raw | ConvertFrom-Json
$build = Get-Content -LiteralPath (Join-Path $Repo 'records/build-runners.json') -Raw | ConvertFrom-Json
$pr = Get-Content -LiteralPath (Join-Path $Repo 'records/pr-build-runners.json') -Raw | ConvertFrom-Json

# ---- 1. the record ---------------------------------------------------------------
Yes 'the record names the organization and the repository it is for' ($rec.organization -eq 'ThornswoodRP' -and $rec.for -eq 'ThornswoodRP/Thornswood-Hermes')
Yes "its folder is one the box's lock takes as a runner's ($($rec.root))" ($rec.root -match '^C:\\Thornswood-Runner[A-Za-z0-9]+$')
Yes "its account is a thornswood-runner* account of at most 20 characters ($($rec.account))" ($rec.account -like 'thornswood-runner*' -and $rec.account.Length -le 20)
Yes "its label is its own, none of the box's ($($rec.label))" ($rec.label -and $rec.label -notmatch 'thornswood' -and $rec.label -ne $build.label -and $rec.label -ne $pr.label)
Yes '  and the runner is named for it' ($rec.name -eq $rec.label)
Yes 'the hosts a job may reach are plain names, PyPI and GitHub''s asset hosts' ((@($rec.allowHost) -join ',') -eq 'pypi.org,files.pythonhosted.org,objects.githubusercontent.com,release-assets.githubusercontent.com')

# ---- 2. what the install sends ---------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-hermes-runner-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    function Run([string[]]$more) {
        $out = @(& $ps -NoProfile -File $script -VpsHost 203.0.113.1 -VpsUser tester -NoPause @more 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
    }
    $f = Join-Path $work 'dry.txt'
    $r = Run @('-Hermes', '-DryRunTo', $f)
    $sent = $(if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { '' })
    Yes "the dry run of -Hermes ends 0 and writes what it would send (exit $($r.Code))" ($r.Code -eq 0 -and $sent.Length -gt 0)
    $cfg = [regex]::Match($sent, "config\.cmd --unattended --url '([^']+)' --name '([^']+)' --labels '([^']+)'")
    Yes ("it registers to the organization, not a repository (" + $cfg.Groups[1].Value + ")") ($cfg.Success -and $cfg.Groups[1].Value -eq 'https://github.com/ThornswoodRP')
    Yes ("  under the record's name with its label alone (" + $cfg.Groups[2].Value + ', ' + $cfg.Groups[3].Value + ")") ($cfg.Groups[2].Value -eq $rec.name -and $cfg.Groups[3].Value -eq $rec.label)
    Yes '  as the record''s account in the record''s folder' ($sent.Contains("`$acct = '" + $rec.account + "'") -and $sent.Contains("`$root = '" + $rec.root + "'"))
    Yes '  with the network guard on that account' ($sent.Contains("`$grdAcct = '" + $rec.account + "'"))
    Yes '  and no thornswood-vps or build label anywhere it registers' ($cfg.Groups[3].Value -notmatch 'thornswood')

    $text = [IO.File]::ReadAllText($script)
    Yes 'it asks GitHub through the organization''s runner endpoints for -Hermes' ($text -match [regex]::Escape("`$RunnerApi = `$(if (`$Hermes) { 'orgs/' + `$Repo } else { 'repos/' + `$Repo })"))
    Yes '  and every runner call goes through that one place' ($text -notmatch 'repos/\$Repo/actions/runners')
    Yes '-Status reads the newest listener logs by name, the runner service''s lines and the service manager''s, so an offline runner says why' ($text.Contains("-Filter 'Runner_*.log' | Sort-Object Name") -and $text.Contains("ProviderName = 'ActionsRunnerService'") -and $text.Contains("ProviderName = 'Service Control Manager'"))
    Yes '-NetworkOnly -Status says, for each host a runner itself has to reach, whether the account''s rules block it' ($text.Contains("`$grdNeeds = @('github.com', 'api.github.com'") -and $text.Contains("'vstoken.actions.githubusercontent.com'") -and $text.Contains('Test-RunnerReach $r'))
    Yes '-Status says which host each of the runner''s settings files names, and whether it took the newer settings, without reading an id or key' ($text.Contains("@('.runner', '.runner_migrated', '.credentials', '.credentials_migrated')") -and $text.Contains('([uri]`$_.Value).Host') -and -not $text.Contains('clientId'))
    Yes '  and lists only this runner''s own processes' ($text.Contains("-like '`$Root\bin\Runner*'") -and -not $text.Contains('Get-Process Runner.Listener, Runner.Worker'))

    # ---- 3. nothing beside it ------------------------------------------------------
    foreach ($bad in @(@('-Number', '2'), @('-RunnerName', 'x'), @('-Account', 'x'), @('-Root', 'C:\Thornswood-RunnerX'), @('-Label', 'x'), @('-Repo', 'ThornswoodRP/Thornswood-Ops'), @('-OffBox'), @('-Lock'))) {
        $g = Join-Path $work ('bad-' + [Guid]::NewGuid().ToString('N') + '.txt')
        $b = Run (@('-Hermes', '-DryRunTo', $g) + $bad)
        Yes ("-Hermes " + ($bad -join ' ') + ' is refused and writes nothing') ($b.Code -eq 1 -and $b.Out -match 'Nothing was changed' -and -not (Test-Path -LiteralPath $g))
    }

    # ---- 4. through the gate ---------------------------------------------------------
    Yes 'through the gate -Hermes asks for the hermes-runners token' ($text -match [regex]::Escape("-For `$(if (`$Hermes) { 'hermes-runners' } else { 'runners' })"))
    Yes '  and the ops repository is put in only without it' ($text -match [regex]::Escape("if (-not `$Hermes) { `$Repo = 'ThornswoodRP/Thornswood-Ops' }"))
    Yes '  and the renew only rule counts it as written down' ($text -match [regex]::Escape('$named = $Hermes -or'))
    $g = Run @('-Hermes', '-FromGate')
    Yes 'outside the gate -FromGate -Hermes is refused like any -FromGate' ($g.Code -eq 1 -and $g.Out -match 'Nothing was changed')
    $verbs = Get-Content -LiteralPath (Join-Path $Repo 'scripts/vps/gate/verbs.json') -Raw | ConvertFrom-Json
    Yes 'the gate''s Install-Runner verb takes -Hermes as a switch' ($verbs.verbs.'Install-Runner'.params.Hermes -eq 'switch')
    $sa = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/vps/admin/ShipAccess.ps1'))
    Yes 'Get-ThornswoodOpsAccess takes hermes-runners' ($sa -match [regex]::Escape("[ValidateSet('runners', 'keys', 'hermes-runners')]"))
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. the App stays off the repository -------------------------------------------
$apps = Get-Content -LiteralPath (Join-Path $Repo 'records/github-apps.json') -Raw | ConvertFrom-Json
$box = @($apps.apps | Where-Object { $_.slug -eq 'thornswood-box-admin' })[0]
Yes 'the box admin App is never on Thornswood-Hermes' (@($box.never_on) -contains 'ThornswoodRP/Thornswood-Hermes' -and @($box.installed_on) -notcontains 'ThornswoodRP/Thornswood-Hermes')
Yes '  and holds the organization''s Self-hosted runners write for this runner' ($box.permissions.organization_self_hosted_runners -eq 'write' -and $box.why.organization_self_hosted_runners -match 'hermes-runner\.json')

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
