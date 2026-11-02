<#
  test-5180-deploy-agent.ps1

  The box deploy agent's pieces outside its C# code (#5180), and its tests
  (tools/DeployAgent.Tests) when the .NET SDK is on this machine.

  WHAT IT CHECKS.
    - New-SignedManifest.ps1 writes the manifest the agent reads
      (tools/DeployAgent/ReleaseFetch.cs): schema 1, repo, commit, tag,
      version, parts with name, sha256 and size, an array even for one file,
      and refuses a tag that is not build-<...> or agent-v<a.b.c>. With
      -ServerZip it adds the server part: the zip and the record it carries,
      as server-build.json, each with its sha256 (#5219).
    - merge-release.yml runs when the records change (the server build
      record among them), fetches CI's build of the pin and puts its zip on
      the Release.
    - The gate has the verbs Deploy-Release (-Tag build-<...> and
      -Environment dev, site or discord only) and Install-DeployAgent
      (-Status, -Pass, -Tag, -NoBotPass, -EndHung, -Main and -NoMain only). -Main
      has agent.json name main (#5181) and -NoMain takes it off; with
      neither it is kept.
    - Deploy-Release.ps1 and Install-DeployAgent.ps1 send the box scripts that
      parse; the install one carries the signer read from Updater.cs, the
      launcher's own Signature.cs and the repository it was given, and no
      account name is written into either script or the agent. The install
      script's choice of Release, run against a stand-in GitHub that answers
      with one array, takes the newest agent-v tag by version.
    - The agent compiles launcher/app/Signature.cs in from where it lives,
      and keeps no copy of its own.
    - The agent's Deployments use "Dev" on both sides (#5179 retired the
      release records Record-Deployment.ps1 wrote there), never Main.
    - Both workflows sign through Sign-OnRunner.ps1 in the release
      environment and publish from a draft (releases are immutable).
    - runner-isolation.json keeps runner accounts out of the agent's folder.
    - The bot pass (#5196): the install script registers its task as LOCAL
      SERVICE with a SID of its own, never SYSTEM, below normal priority, on
      demand, after the fail-safe, and names its folder in agent.json only
      then; -NoBotPass leaves it off; New-SignedManifest.ps1 -BotFiles adds
      the bot part merge-release.yml puts in every Release, with
      the same files the agent asks for.
    - After a dev Deployment (#5180): the load order line and Check-ProdParity
      are lines main's gate takes, the load order verb fits the agent's wait,
      the REVIEW rows are printed as the agent reads them, each file the
      agent watches is one Deploy-DevGamemode -LoadOrder -FromRecord reads,
      and only the service takes these steps.
    - dotnet test on tools/DeployAgent.Tests, from the locked packages, when
      dotnet is on PATH; SKIP otherwise (the Deploy agent workflow runs them
      on every pull request that touches it).

  Writes only under its own temp folder, and the agent's bin and obj folders
  when it runs dotnet test. Exit 1 when any check fails.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('test-5180-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    # ---- the manifest ---------------------------------------------------------
    $exe = Join-Path $tmp 'thornswood-agent.exe'
    [IO.File]::WriteAllBytes($exe, [byte[]](77, 90, 1, 2, 3))
    $commit = 'a' * 40
    $out = Join-Path $tmp 'rel'
    & pwsh -NoProfile -File (Join-Path $Repo 'scripts\release\New-SignedManifest.ps1') -Out $out -Tag 'agent-v1.0.7' -Commit $commit -Part agent -Files $exe -Version '1.0.7' -Repo 'O/R' -NoCatalog | Out-Null
    Yes 'New-SignedManifest.ps1 writes an agent manifest' ($LASTEXITCODE -eq 0)
    $raw = [IO.File]::ReadAllText((Join-Path $out 'files\manifest.json'))
    $m = $raw | ConvertFrom-Json
    Yes '  schema 1, repo, commit, tag and version as given' ($m.schema -eq 1 -and $m.repo -eq 'O/R' -and $m.commit -eq $commit -and $m.tag -eq 'agent-v1.0.7' -and $m.version -eq '1.0.7')
    Yes '  one file is still a list under its part' ($raw -match '"agent":\[\{')
    $f = @($m.parts.agent)[0]
    Yes '  the file has its name, sha256 and size' ($f.name -eq 'thornswood-agent.exe' -and $f.sha256 -eq (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -and $f.size -eq 5)
    Yes '  the files are copied beside the manifest' ((Test-Path (Join-Path $out 'assets\thornswood-agent.exe')) -and (Test-Path (Join-Path $out 'assets\manifest.json')))
    $null = & pwsh -NoProfile -File (Join-Path $Repo 'scripts\release\New-SignedManifest.ps1') -Out $out -Tag 'v1.2.3' -Commit $commit -Part gamemode -Files $exe -NoCatalog 2>&1
    Yes '  a tag that is neither build-<...> nor agent-v<a.b.c> is refused' ($LASTEXITCODE -ne 0)
    $null = & pwsh -NoProfile -File (Join-Path $Repo 'scripts\release\New-SignedManifest.ps1') -Out $out -Tag 'agent-v1.0.8' -Commit $commit -Part agent -Files $exe -Version '1.0.7' -NoCatalog 2>&1
    Yes '  an agent tag that does not say its version is refused' ($LASTEXITCODE -ne 0)

    # The server build beside the gamemode (#5219): the zip as ServerArtifact.ps1 names it.
    $zdir = Join-Path $tmp 'zip'
    New-Item -ItemType Directory -Force -Path $zdir | Out-Null
    $recText = '{"source":{"commit":"' + ('b' * 40) + '"}}'
    [IO.File]::WriteAllText((Join-Path $zdir 'server-build.json'), $recText)
    [IO.File]::WriteAllText((Join-Path $zdir 'scam_native.node'), 'native')
    $zip = Join-Path $tmp 'server-bbbbbbbbbbbb-0123456789abcdef.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($zdir, $zip)
    $gmf = Join-Path $tmp 'gamemode.js'
    [IO.File]::WriteAllText($gmf, '// gm')
    $out2 = Join-Path $tmp 'rel2'
    & pwsh -NoProfile -Command "& '$(Join-Path $Repo 'scripts\release\New-SignedManifest.ps1')' -Out '$out2' -Tag 'build-20261101.3' -Commit '$commit' -Part gamemode -Files '$gmf' -ServerZip '$zip' -Repo 'O/R' -NoCatalog" | Out-Null
    Yes 'New-SignedManifest.ps1 -ServerZip writes a build manifest' ($LASTEXITCODE -eq 0)
    if ($LASTEXITCODE -eq 0) {
        $m2 = [IO.File]::ReadAllText((Join-Path $out2 'files\manifest.json')) | ConvertFrom-Json
        $sv = @($m2.parts.server)
        Yes '  with a server part of the record and the zip' ((@($sv | ForEach-Object { $_.name }) -join ',') -eq 'server-build.json,server-bbbbbbbbbbbb-0123456789abcdef.zip')
        Yes '  the record is the one inside the zip, by its sha256' ($sv[0].sha256 -eq (Get-FileHash -LiteralPath (Join-Path $zdir 'server-build.json') -Algorithm SHA256).Hash.ToLowerInvariant())
        Yes '  and both are copied beside the manifest' ((Test-Path (Join-Path $out2 'assets\server-build.json')) -and (Test-Path (Join-Path $out2 'assets\server-bbbbbbbbbbbb-0123456789abcdef.zip')))
    }
    $bad = Join-Path $tmp 'server.zip'
    Copy-Item -LiteralPath $zip -Destination $bad
    $null = & pwsh -NoProfile -Command "& '$(Join-Path $Repo 'scripts\release\New-SignedManifest.ps1')' -Out '$out2' -Tag 'build-20261101.4' -Commit '$commit' -Part gamemode -Files '$gmf' -ServerZip '$bad' -NoCatalog" 2>&1
    Yes '  a zip not named as ServerArtifact.ps1 names one is refused' ($LASTEXITCODE -ne 0)

    # ---- the gate verbs ---------------------------------------------------------
    $verbs = Get-Content -Raw (Join-Path $Repo 'scripts\vps\gate\verbs.json') | ConvertFrom-Json
    $d = $verbs.verbs.'Deploy-Release'
    Yes 'the gate has Deploy-Release' ($null -ne $d -and $d.script -eq 'scripts/deploy/Deploy-Release.ps1')
    # The site and the Discord bot are rolled back by tag too (#5190, #5187); never main (#5181).
    Yes '  with -Tag and -Environment dev, site or discord only, and -NoPause fixed' ((@($d.params.PSObject.Properties.Name) -join ',') -eq 'Tag,Environment' -and $d.params.Environment -eq '^(dev|site|discord)$' -and (@($d.fixed) -join ',') -eq '-NoPause')
    Yes '  -Tag takes build-<...> and nothing else' (('build-20261101.12' -match $d.params.Tag) -and -not ('build-1; rm' -match $d.params.Tag) -and -not ('agent-v1.0.1' -match $d.params.Tag))
    $v = $verbs.verbs.'Install-DeployAgent'
    Yes 'the gate has Install-DeployAgent' ($null -ne $v -and $v.script -eq 'scripts/deploy/Install-DeployAgent.ps1')
    Yes '  with -Status, -Pass, -Tag, -NoBotPass, -EndHung, -Main and -NoMain only, and -NoPause fixed' ((@($v.params.PSObject.Properties.Name) -join ',') -eq 'Status,Pass,Tag,NoBotPass,EndHung,Main,NoMain' -and (@($v.fixed) -join ',') -eq '-NoPause' -and
        $v.params.NoBotPass -eq 'switch' -and $v.params.EndHung -eq 'switch' -and $v.params.Main -eq 'switch' -and $v.params.NoMain -eq 'switch')
    Yes '  -Tag takes agent-v<a.b.c> and nothing else' (('agent-v1.0.12' -match $v.params.Tag) -and -not ('agent-v1.0.12; rm' -match $v.params.Tag) -and -not ('build-1' -match $v.params.Tag))

    # ---- the scripts they send the box ---------------------------------------------
    # Each script's one Remote is stood in for by one that keeps what it was
    # handed and answers the line the script looks for.
    function Probe([string]$name, [string]$answer, [string[]]$more) {
        $src = [IO.File]::ReadAllText((Join-Path $Repo ('scripts\deploy\' + $name)))
        # The probe lives in this harness's own temp folder, never in scripts\:
        # other harnesses read that folder while this one runs, and a file that
        # comes and goes under them breaks them (test-local-accounts on #5420).
        # It is told the real scripts\deploy folder, so it loads what the script does.
        $probe = Join-Path $tmp ('_probe-5180-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.ps1')
        $hook = 'function Remote($script) { [IO.File]::WriteAllText($env:PROBE_OUT, $script); return @("' + $answer + '") }'
        $hereLine = '$Here = ''' + (Join-Path $Repo 'scripts\deploy').Replace("'", "''") + ''''
        $probeSrc = [regex]::Replace($src, '(?m)^function Remote\(\$script\) \{.*$', $hook.Replace('$', '$$'))
        if ($probeSrc -eq $src) { return $null }
        $placed = [regex]::Replace($probeSrc, '(?m)^\$Here = \$PSScriptRoot\s*$', $hereLine.Replace('$', '$$'))
        if ($placed -eq $probeSrc) { return $null }
        $probeSrc = $placed
        [IO.File]::WriteAllText($probe, $probeSrc)
        $sent = Join-Path $tmp ('sent-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.ps1')
        try {
            $env:PROBE_OUT = $sent
            & pwsh -NoProfile -File $probe -NoPause -VpsHost box -VpsUser u @more *> $null
            $code = $LASTEXITCODE
        } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue; Remove-Item Env:\PROBE_OUT -ErrorAction SilentlyContinue }
        $text = if (Test-Path $sent) { [IO.File]::ReadAllText($sent) } else { '' }
        $errs = $null
        [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs)
        return [pscustomobject]@{ Text = $text; Parses = ($text -and @($errs).Count -eq 0); Code = $code }
    }
    foreach ($mode in @('install', 'Status', 'Remove')) {
        $more = @('-Repo', 'O/R')
        if ($mode -ne 'install') { $more += ('-' + $mode) }
        $r = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' $more
        Yes ("Install-DeployAgent.ps1: the $mode script it sends the box parses") ($null -ne $r -and $r.Parses)
        if ($mode -eq 'install' -and $r) {
            $updater = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Updater.cs'))
            $signer = [regex]::Match($updater, 'ExpectedSigner\s*=\s*"([^"]+)"').Groups[1].Value
            $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Repo 'launcher\app\Signature.cs')))
            Yes '  and carries the signer Updater.cs names' ($r.Text.Contains("'" + $signer + "'"))
            Yes '  and the launcher''s own Signature.cs' ($r.Text.Contains($b64))
            Yes '  and writes the repository it was given into agent.json' ($r.Text.Contains("-NotePropertyName repo -NotePropertyValue 'O/R'"))
            Yes '  and runs the service as LocalSystem with restart on an error exit' ($r.Text.Contains('obj= LocalSystem') -and $r.Text.Contains('failureflag'))
            Yes '  and refuses a service stuck stopping unless -EndHung is given' ($r.Text.Contains("`$endHung = ''") -and $r.Text.Contains("'StopPending' -and -not `$endHung) { Refuse"))
            $h = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-EndHung')
            Yes '  and with -EndHung ends only a stuck service''s own process' ($null -ne $h -and $h.Parses -and $h.Text.Contains("`$endHung = '1'") -and $h.Text.Contains("Win32_Service -Filter `"Name='`$agentSvc'`"") -and $h.Text.Contains("`$svc.Status -eq 'StopPending' -and `$endHung"))
            # The bot pass (#5196): its own task, never SYSTEM.
            $t = $r.Text
            Yes '  and registers the bot pass task as LOCAL SERVICE with its own SID, never SYSTEM' (
                $t.Contains('Register-ScheduledTask -TaskName $passTask -Action $action -Settings $settings -Principal (New-ThornswoodServicePrincipal) |') -and
                -not ($t -match 'TaskName \$passTask[^\r\n]*-AsSystem') -and $t.Contains('function New-ThornswoodServicePrincipal') -and
                $t.Contains('Set-ThornswoodTaskOwner -TaskName $passTask'))
            Yes '  at below normal priority, on demand, with a time limit' ($t.Contains('-Priority 7') -and $t.Contains('-ExecutionTimeLimit (New-TimeSpan -Minutes 40)') -and -not ($t -match 'TaskName \$passTask[^\r\n]*-Trigger'))
            $safe = $t.IndexOf('Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own $passRoot')
            Yes '  and the fail-safe on what no service may read comes first' ($safe -gt 0 -and $safe -lt $t.IndexOf('Register-ScheduledTask -TaskName $passTask'))
            $st = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-Status')
            Yes '  and -Status prints where the last pass got to, its own lines and the copy server''s, addresses taken out' (
                $null -ne $st -and $st.Parses -and $st.Text.Contains("'C:\Thornswood-BotPass\run'") -and $st.Text.Contains("'bot-pass.log'") -and
                $st.Text.Contains('server\bot-pass-server.log') -and $st.Text.Contains("'<address>'") -and $st.Text.Contains('C:\Thornswood-BotPass\passes'))
            $kp = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-Status', '-Pass', '20261101-234130-unnamed')
            Yes '  and -Status -Pass prints that kept pass from passes\' ($null -ne $kp -and $kp.Parses -and $kp.Text.Contains("'C:\Thornswood-BotPass\passes\20261101-234130-unnamed'"))
            $bad = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-Status', '-Pass', '..\..\Windows')
            Yes '  and -Pass that is not a kept pass''s name sends nothing' ($null -eq $bad -or -not $bad.Text)
            Yes '  and only once dev''s engine has the bot client (skymp #137)' ($t.Contains("Contains('createBotClient')") -and $t.IndexOf("Contains('createBotClient')") -lt $t.IndexOf('Register-ScheduledTask -TaskName $passTask'))
            Yes '  and names the folder in agent.json only once the task is set up' ($t.Contains('-NotePropertyName botPassRoot') -and $t.Contains('$noPass = [bool]0'))
            $off = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-NoBotPass')
            Yes '  -NoBotPass sends a script that parses and leaves the bot pass off' ($null -ne $off -and $off.Parses -and $off.Text.Contains('$noPass = [bool]1'))
            Yes '  without -Main or -NoMain, main in agent.json is kept as it is' ($t.Contains('if ([bool]0) {') -and $t.Contains('elseif ([bool]0) {') -and $t.Contains("'main: kept, as agent.json said'"))
            $mn = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-Main')
            Yes '  -Main has agent.json name main, with the live server''s resources port for its logs' ($null -ne $mn -and $mn.Parses -and $mn.Text.Contains('if ([bool]1) {') -and $mn.Text -match "-NotePropertyName main -NotePropertyValue \(\[pscustomobject\]@\{ logBase = 'http://[A-Za-z0-9.-]+:3000/' \}\)")
            $nm = Probe 'Install-DeployAgent.ps1' 'INSTALLED: probe' @('-Repo', 'O/R', '-NoMain')
            Yes '  -NoMain takes it off' ($null -ne $nm -and $nm.Parses -and $nm.Text.Contains('elseif ([bool]1) {') -and $nm.Text.Contains("Properties.Remove('main')"))
            # How it picks the Release, run against a stand-in GitHub that hands
            # each JSON array back as one object, the way Invoke-RestMethod does:
            # the box once refused agent-v1.0.6 because the list was read whole.
            $at = $r.Text.IndexOf('$tag = $want'); $end = $r.Text.IndexOf('function Fetch(')
            $picked = ''
            if ($at -ge 0 -and $end -gt $at) {
                $pick = Join-Path $tmp 'pick.ps1'
                [IO.File]::WriteAllText($pick, @'
function Invoke-RestMethod { param($Uri, $Headers)
  if ($Uri -like '*/git/matching-refs/tags/agent-v') {
    $list = @('agent-v1.0.9', 'agent-v1.0.10', 'agent-v1.0.2', 'agent-v2.0.0-rc') | ForEach-Object { [pscustomobject]@{ ref = 'refs/tags/' + $_ } }
    Write-Output -NoEnumerate @($list) }
  elseif ($Uri -match '/releases/tags/(.+)$') { [pscustomobject]@{ tag_name = $Matches[1]; draft = $false } }
  else { throw "no such address in the stand-in: $Uri" } }
function Refuse($w) { 'REFUSED: ' + $w; exit 1 }
$h = @{}; $want = ''

'@ + $r.Text.Substring($at, $end - $at))
                $picked = (& pwsh -NoProfile -File $pick 2>&1 | Out-String).Trim()
            }
            Yes ('  and takes the newest agent-v tag''s Release when GitHub answers with one array: ' + $picked) ($picked -eq 'release agent-v1.0.10')
        }
    }

    # ---- the bot pass part of a gamemode Release (#5196) -------------------------
    $gmf = Join-Path $tmp 'gamemode.js'; [IO.File]::WriteAllText($gmf, '// g')
    $bpf = Join-Path $tmp 'Bot-Pass.js'; [IO.File]::WriteAllText($bpf, '// p')
    $bjf = Join-Path $tmp 'bot.js'; [IO.File]::WriteAllText($bjf, '// b')
    $out2 = Join-Path $tmp 'rel2'
    & pwsh -NoProfile -Command "& '$(Join-Path $Repo 'scripts\release\New-SignedManifest.ps1')' -Out '$out2' -Tag build-1.2 -Commit $commit -Part gamemode -Files '$gmf' -BotFiles '$bpf','$bjf' -Repo O/R -NoCatalog" | Out-Null
    $m2 = [IO.File]::ReadAllText((Join-Path $out2 'files\manifest.json')) | ConvertFrom-Json
    Yes 'New-SignedManifest.ps1 -BotFiles adds a bot part beside the gamemode' ($LASTEXITCODE -eq 0 -and @($m2.parts.gamemode).Count -eq 1 -and (@($m2.parts.bot | ForEach-Object { $_.name }) -join ',') -eq 'Bot-Pass.js,bot.js')
    $null = & pwsh -NoProfile -Command "& '$(Join-Path $Repo 'scripts\release\New-SignedManifest.ps1')' -Out '$out2' -Tag build-1.3 -Commit $commit -Part gamemode -Files '$gmf' -BotFiles '$gmf' -Repo O/R -NoCatalog" 2>&1
    Yes '  and refuses two files of one name, which the agent puts in one folder' ($LASTEXITCODE -ne 0)
    $wf = [IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\merge-release.yml'))
    Yes 'merge-release.yml puts the bot pass in every Release' ($wf.Contains('-BotFiles $bot') -and $wf.Contains("@('Bot-Pass.js', 'bot.js', 'character.js', 'relay.js')") -and $wf.Contains("@('voice-server.js', 'headlines.js') | ForEach-Object { Join-Path 'voice' `$_ }") -and $wf.Contains("- 'scripts/bot/relay.js'") -and $wf.Contains("- 'scripts/bot/Bot-Pass.js'"))
    $cs = [IO.File]::ReadAllText((Join-Path $Repo 'tools\DeployAgent\BotPass.cs'))
    Yes '  and the agent takes that part whole, needing only the file the task runs' ($cs.Contains('public const string Runs = "Bot-Pass.js";') -and $cs.Contains('foreach (var n in bot) Files.Copy(files[n], Path.Combine(BotDir, n));') -and -not $cs.Contains('BotFiles ='))
    $r = Probe 'Deploy-Release.ps1' 'DEPLOYED: probe' @('-Tag', 'build-20261101.3')
    Yes 'Deploy-Release.ps1: the script it sends the box parses and runs the agent''s deploy for dev' ($null -ne $r -and $r.Parses -and $r.Code -eq 0 -and $r.Text.Contains("deploy --environment 'dev' --tag 'build-20261101.3'"))
    $r = Probe 'Deploy-Release.ps1' 'DEPLOYED: probe' @('-Tag', 'v1.2.3')
    Yes '  a tag that is not build-<...> is refused before anything is sent' ($null -ne $r -and $r.Code -ne 0 -and -not $r.Text)
    $named = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'tools\DeployAgent') -Filter *.cs -File) +
        @(Get-Item -LiteralPath (Join-Path $Repo 'scripts\deploy\Install-DeployAgent.ps1'), (Join-Path $Repo 'scripts\deploy\Deploy-Release.ps1'))
    $owners = @($named | Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'EvilPatrick06' } | ForEach-Object { $_.Name })
    Yes ('no account name is written into the agent or its scripts (the move to an organization, #5184)' + $(if ($owners) { ': ' + ($owners -join ', ') } else { '' })) ($owners.Count -eq 0)

    # ---- one check, one environment ---------------------------------------------
    $proj = [IO.File]::ReadAllText((Join-Path $Repo 'tools\DeployAgent\DeployAgent.csproj'))
    Yes 'the agent compiles launcher\app\Signature.cs in from where it lives' ($proj.Contains('<Compile Include="..\..\launcher\app\Signature.cs" Link="Signature.cs" />'))
    Yes '  and keeps no copy of its own' (@(Get-ChildItem -LiteralPath (Join-Path $Repo 'tools\DeployAgent') -Filter 'Signature*.cs' -File).Count -eq 0)
    $cfg = [IO.File]::ReadAllText((Join-Path $Repo 'tools\DeployAgent\AgentConfig.cs'))
    $gw = [IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\merge-release.yml'))
    Yes 'the agent watches "Dev" and the workflow asks "Dev"' ($cfg.Contains('GitHubEnvironment = "Dev"') -and $gw.Contains("environment = 'Dev'"))
    Yes '  and nothing records a second Deployment there (Record-Deployment is retired)' (-not ([IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\release-files.yml'))).Contains('deployments: write'))
    Yes 'merge-release.yml runs when the server build record changes (an engine pin)' ($gw -match "(?m)^\s+- 'records/(server-build\.json|\*\*)'\s*$")
    Yes '  fetches CI''s build of the pin and puts its zip on the Release' ($gw.Contains('./scripts/release/Get-EngineArtifact.ps1 -NoPause') -and $gw.Contains('-ServerZip $env:SERVER_ZIP'))
    $aw = [IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\deploy-agent.yml'))
    foreach ($w in @(@{ N = 'deploy-agent.yml'; T = $aw }, @{ N = 'merge-release.yml'; T = $gw })) {
        Yes ("$($w.N) signs through Sign-OnRunner.ps1 in the release environment") ($w.T.Contains('Sign-OnRunner.ps1') -and $w.T -match '(?m)^\s+environment: release\s*$')
        Yes ("  and publishes from a draft, never as latest") ($w.T.Contains('--draft') -and $w.T.Contains('--draft=false') -and $w.T.Contains('--latest=false'))
    }
    $iso = Get-Content -Raw (Join-Path $Repo 'records\runner-isolation.json') | ConvertFrom-Json
    Yes 'runner-isolation.json keeps every runner account out of C:\Thornswood-Agent' (@($iso.noReach) -contains 'C:\Thornswood-Agent')

    # ---- what the agent asks the gate for after a dev Deployment ------------------
    . (Join-Path $Repo 'scripts\vps\gate\GateRules.ps1')
    $agentCs = [IO.File]::ReadAllText((Join-Path $Repo 'tools\DeployAgent\Agent.cs'))
    $verbs = Read-ThornswoodGateVerbs (Join-Path $Repo 'scripts\vps\gate\verbs.json')
    $lo = [regex]::Match($agentCs, 'LoadOrderLine = "([^"]+)"').Groups[1].Value
    # The rules read verbs.json the way the broker does, which is not strict.
    function Ask([string]$line) { Set-StrictMode -Off; Test-ThornswoodGateRequest -Line $line -Verbs $verbs }
    $req = Ask $lo
    Yes "the agent's load order line is one the gate takes: $lo" ($lo -ne '' -and $req.Ok -and $req.Verb -eq 'Deploy-DevGamemode' -and -not $req.Build)
    Yes '  and it runs no longer than the 50 minutes the agent waits for the gate' ($req.Minutes -le 50 -and $agentCs.Contains('Gate!.Run(LoadOrderLine, TimeSpan.FromMinutes(50)'))
    $req = Ask 'Check-ProdParity'
    Yes 'the gate takes the parity line the agent sends, Check-ProdParity' ($req.Ok -and $agentCs.Contains('Gate!.Run("Check-ProdParity"'))
    $parity = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\vps\Check-ProdParity.ps1'))
    Yes '  and it prints the REVIEW rows the agent reads' ($parity.Contains('"REVIEW  {0} {1}: expected {2}, found {3}"') -and $agentCs.Contains('^REVIEW  (\S+) (.+?): expected (.*?), found (.*)$'))
    $dg = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Deploy-DevGamemode.ps1'))
    foreach ($f in 'records/collection-plugins.json', 'records/collection-dropped.json', 'game/data/last-plugin.json', 'game/data/last-plugin.recipe', 'game/content/Thornswood-Content.esp') {
        $win = $f.Replace('/', '\')
        Yes "  the agent moves the order when $f changes, a file -LoadOrder -FromRecord reads" ($agentCs.Contains('"' + $f + '"') -and ($dg.Contains($f) -or $dg.Contains($win) -or $dg.Contains("'" + (Split-Path -Leaf $win) + "'")))
    }
    $prog = [IO.File]::ReadAllText((Join-Path $Repo 'tools\DeployAgent\Program.cs'))
    Yes 'only the service takes the gate steps, never a deploy by tag inside a gate verb' ($prog -match '(?s)if \(verb == "service"\)\s*\{\s*agent\.Gate = new GatePipe\(\);')

    # ---- the C# code ----------------------------------------------------------------
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if (-not $dotnet) { Skip 'dotnet test on tools/DeployAgent.Tests: the .NET SDK is not on this machine (the Deploy agent workflow runs it)' }
    else {
        $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
        $tests = Join-Path $Repo 'tools\DeployAgent.Tests'
        $rs = & dotnet restore $tests --locked-mode 2>&1
        Yes 'dotnet restore from the locked packages' ($LASTEXITCODE -eq 0)
        if ($LASTEXITCODE -ne 0) { $rs | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" } }
        else {
            $t = & dotnet test $tests --no-restore 2>&1
            Yes 'dotnet test on tools/DeployAgent.Tests' ($LASTEXITCODE -eq 0)
            if ($LASTEXITCODE -ne 0) { $t | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" } }
        }
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
