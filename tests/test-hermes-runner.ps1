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
    5. the box admin App stays off Thornswood-Hermes in the record;
    6. it goes out through the box runners' way out (#5495, Patrick's A on
       3 Nov 2026): its rules block every address but loopback, its .env
       names the proxy before its service first starts, -NetworkOnly writes
       the .env before the rules and starts the service again after them,
       and the proxy's list holds its allowHost and the token host GitHub
       gave it;
    7. its Python goes into its tool cache as the box's administrator
       (#5495: actions/setup-python's own install needs one, and the
       runner's account holds none): the record pins the build by version,
       actions/python-versions url and SHA-256; the install puts it there
       before its service first starts, and -Hermes -Python alone does it
       and nothing else; the zip is held to the hash and the installer to
       python.org's signature, nothing else is fetched, no launcher, file
       type or shortcut goes on the box, a copy of the same minor version
       for all users elsewhere stops it, and -Status names what is there;
    8. now that it is retired (#5565: Thornswood-Hermes went public as
       TWHermesAgents and its checks run on GitHub's runners), the record
       says so, and -Hermes installs nothing, sets no rules and no Python;
       -Status still reads it; -Remove asks GitHub for a removal token
       first, uninstalls its Python before its folder goes, takes its rules
       off, and reads GitHub back; through the gate only Remove-HermesRunner
       says -Remove, and the script refuses it from the gate for a runner
       whose record does not retire it.

  Checks 2 to 7 run against a copy of scripts and records whose Hermes
  record is as it was before it retired, so the install it would still
  make for an unretired record stays held.

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
    # The copy with the record as it was before it retired (the header).
    $copy = Join-Path $work 'repo'
    New-Item -ItemType Directory -Force -Path $copy | Out-Null
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts'), (Join-Path $Repo 'records') -Destination $copy -Recurse
    $unretired = Get-Content -LiteralPath (Join-Path $copy 'records/hermes-runner.json') -Raw | ConvertFrom-Json
    $unretired.PSObject.Properties.Remove('retired')
    [IO.File]::WriteAllText((Join-Path $copy 'records/hermes-runner.json'), ($unretired | ConvertTo-Json -Depth 10))
    $live = Join-Path $copy 'scripts/deploy/Install-Runner.ps1'
    function RunAt([string]$at, [string[]]$more) {
        $out = @(& $ps -NoProfile -File $at -VpsHost 203.0.113.1 -VpsUser tester -NoPause @more 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
    }
    function Run([string[]]$more) { return RunAt $live $more }
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

    # ---- 6. the way out --------------------------------------------------------------
    $eg = Get-Content -LiteralPath (Join-Path $Repo 'records/runner-egress.json') -Raw | ConvertFrom-Json
    Yes 'the record sends it through the way out' ($rec.egress -eq $true)
    Yes "  which listens on loopback ($($eg.listen))" ($eg.listen -match '^127\.0\.0\.1:\d+$')
    Yes '  and whose list takes the token host GitHub gave it by pattern' (@($eg.allow) -contains '*.actions.githubusercontent.com' -and @($eg.allow) -contains 'github.com' -and @($eg.allow) -contains 'api.github.com')
    $port = $eg.listen.Split(':')[1]
    Yes '  and the install tells the guard where the proxy is' ($sent.Contains("`$grdProxy = $port"))
    $blocks = [regex]::Match($sent, '\$grdBlocks = (@\([^\n]*\))').Groups[1].Value
    Yes "  whose rules leave loopback alone open ($blocks)" ($blocks -eq "@('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::', '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')")
    $svc = 'actions.runner.' + $rec.organization + '.' + $rec.name
    $iTemp = $sent.IndexOf("Set-RunnerTemp `$root '" + $svc + "'")
    $iProxy = $sent.IndexOf("Set-RunnerProxy `$root '" + $svc + "' 'http://" + $eg.listen + "'")
    $iCfg = $sent.IndexOf('.\config.cmd --unattended')
    Yes '  and its .env names the proxy before config.cmd starts its service' ($iTemp -gt 0 -and $iProxy -gt $iTemp -and $iCfg -gt $iProxy)

    $n = Join-Path $work 'net.txt'
    $r = Run @('-Hermes', '-NetworkOnly', '-DryRunTo', $n)
    $net = $(if (Test-Path -LiteralPath $n) { [IO.File]::ReadAllText($n) } else { '' })
    Yes "-Hermes -NetworkOnly's dry run ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and $net.Length -gt 0)
    $iBusy = $net.IndexOf("'BUSY: '")
    $iProxy = $net.IndexOf("Set-RunnerProxy '" + $rec.root + "' `$svc 'http://" + $eg.listen + "'")
    $iRules = $net.IndexOf("`nSet-RunnerFirewall `$grdAcct")
    $iStart = $net.IndexOf('Restart-Service -Name $svc')
    Yes '  it stops for a running job, then writes the .env, then the rules, then starts the service again' ($iBusy -gt 0 -and $iProxy -gt $iBusy -and $iRules -gt $iProxy -and $iStart -gt $iRules)
    Yes '  and asks for no published address list' ($r.Out -notmatch '-AllowHost' -and $net -notmatch '140\.82\.112\.0')

    $o = Join-Path $work 'other.txt'
    $r = Run @('-Number', '2', '-NetworkOnly', '-DryRunTo', $o)
    $other = $(if (Test-Path -LiteralPath $o) { [IO.File]::ReadAllText($o) } else { '' })
    Yes "a runner with no egress keeps its rules by address and no proxy (exit $($r.Code))" ($r.Code -eq 0 -and $other.Contains('$grdProxy = 0') -and $other -notmatch "(?m)^Set-RunnerProxy " -and $other -match "\`$grdBlocks = @\('0\.0\.0\.0-4\.147\.255\.255'")

    # Set-RunnerProxy itself, on a scratch folder: the runner's own lines stay,
    # an old proxy line goes, and a second run changes nothing.
    $lib = [regex]::Match($text, '(?ms)^function Set-RunnerProxy\(.*?^\}\r?$').Value
    if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) { function Get-CimInstance { $null } }
    . ([scriptblock]::Create($lib))
    $root = Join-Path $work 'runner'
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    [IO.File]::WriteAllText((Join-Path $root '.env'), "TEMP=C:\x`r`nHTTPS_PROXY=http://old:1`r`n")
    $said1 = Set-RunnerProxy $root 'svc' 'http://127.0.0.1:8431'
    $env1 = @(Get-Content -LiteralPath (Join-Path $root '.env'))
    Yes 'Set-RunnerProxy keeps the runner''s own lines and takes an old proxy line off' (($env1 -join '|') -eq 'TEMP=C:\x|https_proxy=http://127.0.0.1:8431|http_proxy=http://127.0.0.1:8431|no_proxy=localhost,127.0.0.1,::1')
    $said2 = Set-RunnerProxy $root 'svc' 'http://127.0.0.1:8431'
    Yes '  and says so when there is nothing to change' ($said1 -match 'now sends' -and $said2 -match 'already')

    # Ask-Egress, the question the install and -Status ask the proxy.
    . (Join-Path $Repo 'scripts/deploy/RunnerEgress.ps1')
    . ([scriptblock]::Create((Get-ThornswoodEgressAskScript)))
    $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $free = $l.LocalEndpoint.Port; $l.Stop()
    Yes 'Ask-Egress says nothing answered when no proxy listens' ((Ask-Egress $free 'github.com') -like 'no answer on 127.0.0.1:*')
    $ins = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Install-Runner.ps1'))
    Yes 'the install and -NetworkOnly stop before any change when the proxy does not answer github.com with 200' ($ins.Contains('function Assert-RunnerEgress') -and $ins.Contains("Head 'The way out'; Assert-RunnerEgress") -and ([regex]::Matches($ins, '(?m)^\s+Assert-RunnerEgress\s*$')).Count -eq 1)

    # ---- 7. its Python -------------------------------------------------------------
    $py = $rec.python
    Yes "the record pins its Python by version, actions/python-versions url and SHA-256 ($($py.version))" ($py.version -match '^3\.13\.\d+$' -and $py.url -match ('^https://github\.com/actions/python-versions/releases/download/' + [regex]::Escape($py.version) + '-\d+/python-' + [regex]::Escape($py.version) + '-win32-x64\.zip$') -and $py.sha256 -match '^[0-9a-f]{64}$')
    $call = "Install-RunnerPython `$root `$acct '" + $py.version + "' '" + $py.url + "' '" + $py.sha256 + "'"
    $iPy = $sent.IndexOf($call)
    $iProxy = $sent.IndexOf("Set-RunnerProxy `$root '" + $svc + "'")
    Yes '  and the install puts it in the tool cache before config.cmd starts its service' ($iPy -gt $iProxy -and $iCfg -gt $iPy -and $sent.Contains('function Install-RunnerPython('))
    $t = Join-Path $work 'python.txt'
    $r = Run @('-Hermes', '-Python', '-DryRunTo', $t)
    $one = $(if (Test-Path -LiteralPath $t) { [IO.File]::ReadAllText($t) } else { '' })
    Yes "-Hermes -Python's dry run ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and $one.Contains("Install-RunnerPython '" + $rec.root + "' '" + $rec.account + "' '" + $py.version + "' '" + $py.url + "' '" + $py.sha256 + "'"))
    Yes '  and sends nothing else: no registration, rules, proxy or service change' ($one -notmatch 'config\.cmd --unattended|Set-RunnerFirewall \$grdAcct|(?m)^Set-RunnerProxy |Restart-Service' -and $r.Out -notmatch 'Registration token')
    foreach ($bad in @(@('-Python'), @('-Hermes', '-Python', '-Status'), @('-Hermes', '-Python', '-NetworkOnly'), @('-Number', '2', '-Python'))) {
        $g = Join-Path $work ('bad-' + [Guid]::NewGuid().ToString('N') + '.txt')
        $b = Run (@('-DryRunTo', $g) + $bad)
        Yes ((($bad -join ' ')) + ' is refused and writes nothing') ($b.Code -eq 1 -and $b.Out -match 'Nothing was changed' -and -not (Test-Path -LiteralPath $g))
    }
    $lib = [regex]::Match($text, "(?ms)^\`$toolLib = @'.*?^'@").Value
    Yes 'Install-RunnerPython holds the zip to the record''s SHA-256 and the installer to python.org''s signature' ($lib.Contains("Get-FileHash -LiteralPath `$zip -Algorithm SHA256") -and $lib.Contains("if (`$got -ne `$sha256) { throw") -and $lib.Contains('Get-AuthenticodeSignature') -and $lib.Contains("'O=Python Software Foundation'"))
    Yes '  fetches the record''s url alone, and never pip' (([regex]::Matches($lib, 'Invoke-WebRequest')).Count -eq 1 -and $lib.Contains('Invoke-WebRequest -Uri $url ') -and $lib -notmatch 'pip install|ensurepip')
    Yes '  installs for all users into the tool cache with no launcher, file type, shortcut or PATH change' ($lib.Contains("'InstallAllUsers=1', ('DefaultAllUsersTargetDir=") -and $lib.Contains("'Include_launcher=0', 'InstallLauncherAllUsers=0', 'AssociateFiles=0', 'Shortcuts=0', 'PrependPath=0'") -and $lib.Contains("Join-Path `$root '_work\_tool\Python'"))
    Yes '  stops when the same minor version is installed for all users elsewhere, and never takes another''s registry entries off' ($lib.Contains("'HKLM:\SOFTWARE\Python\PythonCore\' + `$mm + '\InstallPath'") -and $lib -notmatch 'Remove-Item[^\n]*Registry::|Remove-Item -Path HK')
    Yes '  and marks it complete only once the account may run it, the way setup-python looks for it' ($lib.IndexOf("if (-not `$may.Count) { throw") -gt 0 -and $lib.IndexOf("New-Item -ItemType File -Path `$done") -gt $lib.IndexOf("if (-not `$may.Count) { throw") -and $lib.Contains("Join-Path `$verDir 'x64.complete'"))
    Yes 'the gate''s Install-Runner verb takes -Python as a switch' ($verbs.verbs.'Install-Runner'.params.Python -eq 'switch')
    $st = Join-Path $work 'status.txt'
    $r = Run @('-Hermes', '-Status', '-DryRunTo', $st)
    $stat = $(if (Test-Path -LiteralPath $st) { [IO.File]::ReadAllText($st) } else { '' })
    Yes "-Hermes -Status names the Pythons in its tool cache (exit $($r.Code))" ($r.Code -eq 0 -and $stat.Contains("Get-Item -Path '" + $rec.root + "\_work\_tool\Python\*\x64.complete'"))

    # ---- 8. retired ----------------------------------------------------------------
    Yes 'the record says the runner is retired, when and why' ($rec.retired.on -eq '2026-11-08' -and [string]$rec.retired.why -match 'TWHermesAgents')
    foreach ($bad in @(@(), @('-NetworkOnly'), @('-Python'), @('-NetworkOnly', '-Remove'))) {
        $g = Join-Path $work ('retired-' + [Guid]::NewGuid().ToString('N') + '.txt')
        $b = RunAt $script (@('-Hermes', '-DryRunTo', $g) + $bad)
        Yes ('a retired -Hermes ' + ($bad -join ' ') + ' is refused and writes nothing') ($b.Code -eq 1 -and $b.Out -match 'is retired' -and $b.Out -match 'Nothing was changed' -and -not (Test-Path -LiteralPath $g))
    }
    $st = Join-Path $work 'retired-status.txt'
    $r = RunAt $script @('-Hermes', '-Status', '-DryRunTo', $st)
    Yes "  but -Hermes -Status still reads it (exit $($r.Code))" ($r.Code -eq 0 -and (Test-Path -LiteralPath $st))
    $rm = Join-Path $work 'retired-remove.txt'
    $r = RunAt $script @('-Hermes', '-Remove', '-DryRunTo', $rm)
    $gone = $(if (Test-Path -LiteralPath $rm) { [IO.File]::ReadAllText($rm) } else { '' })
    Yes "-Hermes -Remove's dry run ends 0 and reads GitHub back (exit $($r.Code))" ($r.Code -eq 0 -and $r.Out -match ('GitHub lists no runner called ' + [regex]::Escape($rec.name)))
    $iIdle = $gone.IndexOf("Assert-RunnerIdle '" + $rec.root + "'")
    $iCfg = $gone.IndexOf('& .\config.cmd remove')
    $iStop = $gone.IndexOf("Stop-RunnerHere '" + $rec.root + "'")
    $iPy = $gone.IndexOf("Remove-RunnerPython '" + $rec.root + "' '" + $rec.python.version + "'")
    $iUser = $gone.IndexOf("Remove-LocalUser -Name '" + $rec.account + "'")
    $iDir = $gone.IndexOf("Remove-Item -LiteralPath '" + $rec.root + "' -Recurse")
    Yes '  idle first, then GitHub told, the service stopped, its Python uninstalled, then the account and the folder' ($iIdle -gt 0 -and $iCfg -gt $iIdle -and $iStop -gt $iCfg -and $iPy -gt $iStop -and $iUser -gt $iPy -and $iDir -gt $iUser -and $gone.Contains('function Remove-RunnerPython('))
    Yes '  and its outbound rules come off' ($gone.Contains('Remove-RunnerFirewall $grdGroup') -and $gone.Contains("`$grdAcct = '" + $rec.account + "'"))
    Yes 'a removal stops before changing anything when GitHub gives no removal token' ($text.Contains("catch { Die ('GitHub gave no removal token for ") -and $text -notmatch 'GitHub is left to forget')
    $lib = [regex]::Match($text, '(?ms)^function Remove-RunnerPython\(.*?^\}\r?$').Value
    Yes 'Remove-RunnerPython touches only a Python whose PythonCore entry is in the runner''s tool cache' ($lib.Contains("if (-not `$there.StartsWith(`$cache, [StringComparison]::OrdinalIgnoreCase)) { return (") -and $lib.Contains("'HKLM:\SOFTWARE\Python\PythonCore\' + `$mm + '\InstallPath'"))
    Yes '  runs the bundle''s own quiet uninstall, and checks PythonCore after' ($lib.Contains('QuietUninstallString') -and $lib.Contains('Start-Process -FilePath $q.Groups[1].Value') -and $lib.Contains("if (Test-Path -LiteralPath `$reg) { throw"))
    Yes 'the gate''s Remove-HermesRunner verb is held to -FromGate -Hermes -Remove and takes nothing else' ((@($verbs.verbs.'Remove-HermesRunner'.fixed) -join ' ') -eq '-FromGate -Hermes -Remove -NoPause' -and $verbs.verbs.'Remove-HermesRunner'.script -eq 'scripts/deploy/Install-Runner.ps1' -and @($verbs.verbs.'Remove-HermesRunner'.params.PSObject.Properties).Count -eq 0)
    Yes '  and Install-Runner takes no -Remove' ($null -eq $verbs.verbs.'Install-Runner'.params.Remove)
    # As the gate starts it: no -VpsHost or -VpsUser, which it refuses.
    function Gate([string]$at, [string[]]$more) {
        $out = @(& $ps -NoProfile -File $at -NoPause @more 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
    }
    $env:THORNSWOOD_GATE = '1'
    try {
        $b = Gate $script @('-FromGate', '-Number', '2', '-Remove')
        Yes 'from the gate, -Remove of a runner no record retires is refused' ($b.Code -eq 1 -and $b.Out -match 'only when its record says it is retired')
        $b = Gate $live @('-FromGate', '-Hermes', '-Remove')
        Yes '  and so is -Hermes -Remove while its record does not retire it' ($b.Code -eq 1 -and $b.Out -match 'only when its record says it is retired')
        $b = Gate $script @('-FromGate', '-Hermes', '-Remove')
        Yes '  while the retired one passes that rule and goes on to ask for its token' ($b.Out -notmatch 'only when its record says it is retired' -and $b.Out -notmatch 'is retired \(')
    } finally { Remove-Item Env:\THORNSWOOD_GATE -ErrorAction SilentlyContinue }
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
