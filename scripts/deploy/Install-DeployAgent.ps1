<#
  Install-DeployAgent.ps1

  Puts the box deploy agent on the VPS (#5180): the Windows service
  ThornswoodDeployAgent, C:\Thornswood-Agent\thornswood-agent.exe, from the
  newest signed agent-v<version> Release that .github\workflows\deploy-agent.yml
  published. After this the agent updates itself from each newer signed
  Release, so this runs once, and again only to put it back.
  docs\DEPLOY-AGENT.md says what the agent does.

      .\scripts\deploy\Install-DeployAgent.ps1            install, or move to the newest Release
      .\scripts\deploy\Install-DeployAgent.ps1 -Status    what is there, its check and its log
      .\scripts\deploy\Install-DeployAgent.ps1 -Status -Pass <kept pass>
                                                         one kept bot pass's logs (#5196)
      .\scripts\deploy\Install-DeployAgent.ps1 -Remove    take it off again (not a gate verb)

  From a cloud thread, which has no ssh, the deploy gate runs the first two
  with main's script (scripts\vps\gate\verbs.json):

      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-DeployAgent'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Install-DeployAgent -Status'

  WHAT IT CHECKS BEFORE ANYTHING IS STOPPED. On the box, in Windows
  PowerShell 5.1: the Release's manifest.cat passes launcher\app\Signature.cs
  (the check every installed launcher holds an update to, #912) for the
  ExpectedSigner launcher\app\Updater.cs names, both sent from this checkout,
  so the name and the check live in one place; Test-FileCatalog says the
  catalog holds manifest.json; the manifest names this Release and the
  program's sha256 and size; and the program itself passes the same
  signature check. Any one wrong and nothing is stopped or changed.

  WHAT IT RUNS AS. LocalSystem, the account the deploy gate's broker runs as:
  the agent replaces files in the dev server's folder, takes the server
  folders' turn with the nightly backup (#3247), and mints its own short
  GitHub token from the box admin App's key, which only SYSTEM,
  Administrators and the admin service can read (Install-AdminService.ps1,
  #4076). The token it asks for carries Deployments write and Contents read
  on this repository and nothing else, and Actions read once -Main is on. Its folder takes nothing from C:\: SYSTEM
  and Administrators only.

  WHEN IT ENDS. The service manager starts it again when it ends with an error
  code (sc failure, failureflag 1): that is how a self-update starts the new
  program (it ends with 3 once the new one is in place). Not a loop on a
  failure: a program that will not start is three restarts and then stopped,
  for a day, and this script's -Status says so.

  THE BOT PASS (#5196). It also sets up the task every dev Deployment's bot
  pass runs as: "Thornswood Bot Pass", on demand only, node running
  Bot-Pass.js in C:\Thornswood-BotPass\run, as LOCAL SERVICE, Limited, with
  a SID of its own (NT TASK\Thornswood Bot Pass) and rights in that folder
  only, below normal priority, the way the game servers run
  (ServiceAccount.ps1, #2578, #4077). It never goes on SYSTEM: when the SID
  or the rules cannot be set, or LOCAL SERVICE could read what no service
  may, the bot pass is left off and this says why, and Deployments go in
  without one. Once it is set up, agent.json names the folder and every dev
  Deployment waits on a pass (tools\DeployAgent\BotPass.cs). -NoBotPass
  takes it off again.

  THE SITE AND THE DISCORD BOT (#5190, #5187). agent.json names them, each
  only where its full install has set it up (the task Thornswood Docs, the
  service ThornswoodBot), and the agent then applies every Deployment to
  Site and to Discord bot: the Release's site.zip or discord.zip swapped in
  the way Deploy-Docs.ps1 and Install-Bot.ps1 -CodeOnly swap the app, with
  the logs in the dev server's data folder. Where the bot is, it also makes
  C:\Thornswood-Deploys\for-bot, which only SYSTEM, Administrators and the
  bot's account read, for the release news the agent leaves after each
  Deployment and the bot posts. Where dev voice is set up (the task
  Thornswood Dev Voice, Install-Voice.ps1), a Release's voice goes in with
  dev's Deployment, before the gamemode that pushes positions to it.

  MAIN (#5181). -Main has agent.json name main too, so the agent applies the
  Main environment's Deployments to the live server, each one only after
  Patrick approved the promote-main.yml run that made it and only for a
  Release dev ran (tools\DeployAgent\Agent.cs, NotApproved). Its token then
  also asks Actions: read, to see who approved, which the box admin App
  holds (Actions read and write since 30 Oct, #5006). -NoMain takes main
  off again; with neither, what agent.json says is kept.

  WHAT IT CANNOT DO YET. Until the box admin App holds Deployments: Read and
  write (its permissions page, then Accept on its installation, an owner's
  step), the agent runs and every pass says GitHub gave it no token; -Status
  shows that line. Nothing is applied meanwhile.

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads what is sent as
  ANSI.
#>
[CmdletBinding()]
param(
    [string]$VpsHost = '',
    [string]$VpsUser = '',
    [string]$Root    = 'C:\Thornswood-Agent',
    # owner/name of the repository whose Deployments and Releases the agent
    # reads. Left out, it is this checkout's origin, so no account is built in
    # and the move to an organization (#5184) needs no edit here.
    [string]$Repo    = '',
    # A Release to install instead of the newest, agent-v<a.b.c>.
    [string]$Tag     = '',
    [switch]$Status,
    # With -Status: one bot pass the agent kept, by its folder's name under
    # C:\Thornswood-BotPass\passes, which -Status lists.
    [string]$Pass    = '',
    [switch]$Remove,
    # Leave the bot pass off (#5196): no task, and agent.json names no folder.
    [switch]$NoBotPass,
    # Ends the service's process when the service is stuck stopping
    # (StopPending), and only then, before the new agent goes in. Agents
    # up to 1.0.21 called Stop() from inside their own work at a self-update
    # and waited on themselves for good (1 Nov, #5180); such a process
    # never ends by itself, and the service manager will not start it again
    # while it is there. Without this switch the install refuses on a stuck
    # service and changes nothing.
    [switch]$EndHung,
    # Look after the live server as well (#5181): approved Main Deployments only.
    [switch]$Main,
    [switch]$NoMain,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = (Resolve-Path (Join-Path $Here '..\..')).Path
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if ($Main -and $NoMain) { Die '-Main and -NoMain each do one thing, so pass one of them. Nothing was sent.' }
if ($Status -and $Remove) { Die '-Status and -Remove each do one thing, so pass one of them. Nothing was sent.' }
if ($Tag -and $Tag -notmatch '^agent-v\d+\.\d+\.\d+$') { Die "-Tag $Tag is not agent-v<a.b.c>. Nothing was sent." }
if ($Pass -and -not $Status) { Die '-Pass names a kept bot pass for -Status to print, so it goes with -Status. Nothing was sent.' }
if ($Pass -and $Pass -notmatch '^\d{8}-\d{6}-[A-Za-z0-9-]{1,64}$') { Die "-Pass $Pass is not a kept pass's name (<yyyyMMdd-HHmmss>-<deployment>), as -Status lists them. Nothing was sent." }
if ($Root -notmatch '^[A-Za-z]:\\[A-Za-z0-9._\\-]+$') { Die "-Root $Root is not a plain folder on the box. Nothing was sent." }
if (-not $Repo) {
    # The gate's checkout reads ssh://git@ssh.github.com:443/<owner>/<name>.git
    # (Install-Gate.ps1); a port is not part of owner/name (Ship.ps1 Get-SourceRepo).
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is not on the path, so this checkout cannot say which repository it is; pass -Repo owner/name. Nothing was sent.' }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $remote = [string](@(& git -C $RepoDir remote get-url origin 2>$null) | Select-Object -First 1) }
    finally { $ErrorActionPreference = $old }
    if ($remote -match 'github\.com(?::\d+(?=/))?[:/](.+?)(?:\.git)?\s*$') { $Repo = $Matches[1] }
    else { Die "this checkout's origin ($remote) is not a GitHub repository; pass -Repo owner/name. Nothing was sent." }
}
if ($Repo -notmatch '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$') { Die "-Repo $Repo is not owner/name. Nothing was sent." }
# Where a Deployment's log link points: the dev server's resources port on
# the box's public name, from vps.json, the one place the address is kept.
$publicName = Get-ThornswoodVpsAddress
if ($publicName -notmatch '^[A-Za-z0-9.-]+$') { Die "vps.json's address ($publicName) is not a plain host name. Nothing was sent." }
$logBase = 'http://' + $publicName + ':7788/'
# The live server's resources port, for main's log links.
$mainLogBase = 'http://' + $publicName + ':3000/'

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
function Remote($script) { return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script }

$agentSvc = 'ThornswoodDeployAgent'
$exe = $Root.TrimEnd('\') + '\thornswood-agent.exe'
$passTask = 'Thornswood Bot Pass'
$passRoot = 'C:\Thornswood-BotPass'

# ------------------------------------------------------------------ status --
if ($Status) {
    $out = @(Remote @"
`$s = Get-Service -Name '$agentSvc' -ErrorAction SilentlyContinue
if (-not `$s) { 'NOT INSTALLED: there is no service $agentSvc'; exit 0 }
'service $agentSvc is ' + `$s.Status + ', start ' + `$s.StartType
if (Test-Path -LiteralPath '$exe') { & '$exe' version 2>&1 | ForEach-Object { "`$_" } }
'--- the agent''s own check ---'
& '$exe' check 2>&1 | ForEach-Object { "`$_" }
'--- the bot pass (#5196) ---'
`$t = Get-ScheduledTask -TaskName '$passTask' -ErrorAction SilentlyContinue
if (`$t) { `$i = `$t | Get-ScheduledTaskInfo; 'task $passTask is ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last run ' + `$i.LastRunTime + ', last result ' + `$i.LastTaskResult }
else { 'no task ${passTask}: dev Deployments go in without a bot pass' }
`$res = '$passRoot\run\result.json'
if (Test-Path -LiteralPath `$res) { try { `$r = [IO.File]::ReadAllText(`$res) | ConvertFrom-Json; 'last pass ' + `$r.ended + ': ' + `$(if (`$r.ok) { 'OK' } else { 'FAILED' }); foreach (`$l in @(`$r.lines)) { '  ' + `$(if (`$l.ok) { 'PASS' } else { 'FAIL' }) + '  ' + `$l.step + ': ' + `$l.detail } } catch { 'its result.json does not read: ' + `$_.Exception.Message } }
# Where a pass got to, as the agent says it in a Deployment's log when a
# pass runs out (#5196): its own lines and the copy's server's. The last
# pass's are in the run folder; the agent keeps each earlier one's under
# passes\ when the next pass empties it (-Pass prints one of those).
# Addresses never leave the box.
`$from = if ('$Pass') { '$passRoot\passes\$Pass' } else { '$passRoot\run' }
if ('$Pass' -and -not (Test-Path -LiteralPath `$from)) { 'no kept pass ' + `$from }
foreach (`$tail in @(@((Join-Path `$from 'bot-pass.log'), 40), @((Join-Path `$from `$(if ('$Pass') { 'bot-pass-server.log' } else { 'server\bot-pass-server.log' })), 80))) {
  if (Test-Path -LiteralPath `$tail[0]) {
    '--- ' + `$tail[0] + ', last ' + `$tail[1] + ', written ' + (Get-Item -LiteralPath `$tail[0]).LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm:ss') + 'Z ---'
    Get-Content -LiteralPath `$tail[0] -Tail `$tail[1] | ForEach-Object { `$_ -replace '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b', '<address>' }
  } else { 'no ' + `$tail[0] }
}
`$kept = @(Get-ChildItem -LiteralPath '$passRoot\passes' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 10)
if (`$kept.Count) { '--- kept passes, newest 10 (-Status -Pass <name> prints one) ---'; foreach (`$k in `$kept) { '  ' + `$k.Name } } else { 'no kept passes yet in $passRoot\passes' }
'--- agent.log, last 30 ---'
`$log = '$Root\logs\agent.log'
if (Test-Path -LiteralPath `$log) { Get-Content -LiteralPath `$log -Tail 30 } else { 'no log yet' }
"@)
    foreach ($l in $out) { Say ("  $l") }
    exit 0
}

# ------------------------------------------------------------------ remove --
if ($Remove) {
    $out = @(Remote @"
`$s = Get-Service -Name '$agentSvc' -ErrorAction SilentlyContinue
if (`$s) {
  if (`$s.Status -ne 'Stopped') { Stop-Service -Name '$agentSvc' -Force; `$s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60)) }
  & sc.exe delete '$agentSvc' | Out-Null
  'REMOVED the service $agentSvc; $Root is left with its logs'
  if (Get-ScheduledTask -TaskName '$passTask' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '$passTask' -Confirm:`$false; 'REMOVED the task $passTask; $passRoot is left with the last pass' }
} else { 'NOT INSTALLED' }
"@)
    foreach ($l in $out) { Say ("  $l") }
    exit 0
}

# ----------------------------------------------------------------- install --
# The signer and the check, from this checkout, sent with the script.
$updater = [IO.File]::ReadAllText((Join-Path $RepoDir 'launcher\app\Updater.cs'))
$m = [regex]::Match($updater, 'ExpectedSigner\s*=\s*"([^"]+)"')
if (-not $m.Success) { Die 'ExpectedSigner is not in launcher\app\Updater.cs. Nothing was sent.' }
$signer = $m.Groups[1].Value.Trim()
if ($signer -notmatch '^[A-Za-z0-9 .,-]+$') { Die 'ExpectedSigner holds characters this script will not send. Nothing was sent.' }
$sigCs = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $RepoDir 'launcher\app\Signature.cs')))

Say "Installing the deploy agent on $VpsHost from the newest signed Release..." Cyan
$out = @(Remote @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
`$root = '$Root'
`$exe = '$exe'
`$agentSvc = '$agentSvc'
`$want = '$Tag'
`$endHung = '$(if ($EndHung) { '1' } else { '' })'
`$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
`$stage = Join-Path `$root ('.stage-' + `$stamp)
`$h = @{ 'User-Agent' = 'thornswood-install-deploy-agent'; Accept = 'application/vnd.github+json' }

function Refuse([string]`$why) { 'REFUSED: ' + `$why + '. Nothing was stopped or changed.'; if (Test-Path -LiteralPath `$stage) { Remove-Item -LiteralPath `$stage -Recurse -Force }; exit 1 }

# A service stuck stopping is said before anything changes (see -EndHung).
`$was = Get-Service -Name `$agentSvc -ErrorAction SilentlyContinue
if (`$was -and `$was.Status -eq 'StopPending' -and -not `$endHung) { Refuse ('the service ' + `$agentSvc + ' is stuck stopping (StopPending) and will not end by itself; run this with -EndHung to end its process and put the new agent in') }

# The folder: nothing from C:\, SYSTEM and Administrators only.
if (-not (Test-Path -LiteralPath `$root)) { New-Item -ItemType Directory -Path `$root | Out-Null }
& icacls.exe `$root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if (`$LASTEXITCODE -ne 0) { Refuse ('icacls could not set the rules on ' + `$root) }
New-Item -ItemType Directory -Force -Path (Join-Path `$stage 'files') | Out-Null

# Which Release. The newest agent-v tag of all of them (GitHub's list of
# Releases is one page in its own order, a Release's created_at being its
# commit's date), then its Release by the tag, which answers with a published
# Release only. Windows PowerShell 5.1 hands a JSON array back as one object
# holding it, so the list is spread through ForEach-Object before it is read
# (#3686); without that every tag name was tested at once and none matched.
`$tag = `$want
if (-not `$tag) {
  try { `$refs = @(Invoke-RestMethod -Uri 'https://api.github.com/repos/$Repo/git/matching-refs/tags/agent-v' -Headers `$h | ForEach-Object { `$_ }) }
  catch { Refuse ('GitHub would not list the agent-v tags: ' + `$_.Exception.Message) }
  `$bestV = `$null
  foreach (`$r in `$refs) {
    if ([string]`$r.ref -cnotmatch '^refs/tags/(agent-v(\d+\.\d+\.\d+))`$') { continue }
    `$v = [version]`$Matches[2]
    if (-not `$bestV -or `$v -gt `$bestV) { `$tag = `$Matches[1]; `$bestV = `$v }
  }
  if (-not `$tag) { Refuse 'there is no agent-v tag yet: deploy-agent.yml makes one, with its Release, when its change reaches main' }
}
try { `$best = Invoke-RestMethod -Uri ('https://api.github.com/repos/$Repo/releases/tags/' + `$tag) -Headers `$h }
catch { Refuse ('there is no published Release ' + `$tag + ' (GitHub said: ' + `$_.Exception.Message + ')') }
if ([string]`$best.tag_name -cne `$tag -or `$best.draft) { Refuse ('GitHub answered for ' + `$tag + ' with ' + `$best.tag_name) }
'release ' + `$best.tag_name

function Fetch([string]`$name, [string]`$to) {
  `$a = @(`$best.assets | Where-Object { `$_.name -eq `$name })
  if (`$a.Count -ne 1) { Refuse ('release ' + `$best.tag_name + ' carries no ' + `$name) }
  Invoke-WebRequest -Uri `$a[0].browser_download_url -Headers @{ 'User-Agent' = 'thornswood-install-deploy-agent' } -OutFile `$to -UseBasicParsing
  if ((Get-Item -LiteralPath `$to).Length -ne `$a[0].size) { Refuse (`$name + ' did not come down whole') }
}
`$man = Join-Path `$stage 'files\manifest.json'
`$cat = Join-Path `$stage 'manifest.cat'
`$new = Join-Path `$stage 'thornswood-agent.exe'
Fetch 'manifest.json' `$man
Fetch 'manifest.cat' `$cat
Fetch 'thornswood-agent.exe' `$new

# The launcher's own check (Signature.cs), on the catalog and on the program.
`$src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$sigCs'))
`$sha = [Security.Cryptography.SHA256]::Create()
`$hash = -join (`$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(`$src)) | Select-Object -First 8 | ForEach-Object { `$_.ToString('x2') })
`$ns = 'ThornswoodSign' + `$hash
if (-not ((`$ns + '.Signature') -as [type])) { Add-Type -TypeDefinition ([regex]::Replace(`$src, '(?m)^namespace Thornswood\s*`$', ('namespace ' + `$ns))) -Language CSharp }
`$t = (`$ns + '.Signature') -as [type]
foreach (`$f in `$cat, `$new) {
  `$said = ''
  `$why = `$t::Refusal(`$f, '$signer', [ref]`$said)
  if (`$why) { Refuse ((Split-Path -Leaf `$f) + ' ' + `$why) }
}
`$st = [string](Test-FileCatalog -CatalogFilePath `$cat -Path (Join-Path `$stage 'files'))
if (`$st -ne 'Valid') { Refuse ('the signed catalog does not hold manifest.json (Test-FileCatalog said ' + `$st + ')') }
`$m = [IO.File]::ReadAllText(`$man) | ConvertFrom-Json
if (`$m.tag -ne `$best.tag_name -or ('agent-v' + `$m.version) -ne `$best.tag_name) { Refuse ('the signed manifest says ' + `$m.tag + ', not ' + `$best.tag_name) }
`$entry = @(`$m.parts.agent | Where-Object { `$_.name -eq 'thornswood-agent.exe' })
if (`$entry.Count -ne 1) { Refuse 'the signed manifest lists no thornswood-agent.exe' }
`$got = (Get-FileHash -LiteralPath `$new -Algorithm SHA256).Hash.ToLowerInvariant()
if (`$got -ne `$entry[0].sha256 -or (Get-Item -LiteralPath `$new).Length -ne `$entry[0].size) { Refuse 'the program is not the one the signed manifest lists' }
'signed and held to its manifest: ' + `$best.tag_name + ', sha256 ' + `$got.Substring(0, 12)

# agent.json names the repository; anything else in it is kept.
`$cfgPath = Join-Path `$root 'agent.json'
`$cfg = New-Object PSObject
if (Test-Path -LiteralPath `$cfgPath) { try { `$cfg = [IO.File]::ReadAllText(`$cfgPath) | ConvertFrom-Json } catch { Refuse (`$cfgPath + ' does not read as JSON: ' + `$_.Exception.Message) } }
`$cfg | Add-Member -NotePropertyName repo -NotePropertyValue '$Repo' -Force
`$cfg | Add-Member -NotePropertyName home -NotePropertyValue `$root -Force
if (-not `$cfg.environments) { `$cfg | Add-Member -NotePropertyName environments -NotePropertyValue (New-Object PSObject) -Force }
if (-not `$cfg.environments.dev) { `$cfg.environments | Add-Member -NotePropertyName dev -NotePropertyValue (New-Object PSObject) -Force }
`$cfg.environments.dev | Add-Member -NotePropertyName logBase -NotePropertyValue '$logBase' -Force
'agent.json names $Repo'
# Main (#5181): only on -Main, taken off on -NoMain, otherwise kept.
if ([bool]$([int][bool]$Main)) {
  `$cfg.environments | Add-Member -NotePropertyName main -NotePropertyValue ([pscustomobject]@{ logBase = '$mainLogBase' }) -Force
  'main: approved Main Deployments go on the live server'
} elseif ([bool]$([int][bool]$NoMain)) {
  `$cfg.environments.PSObject.Properties.Remove('main')
  'main: off; the live server takes nothing from the agent'
} elseif (`$cfg.environments.main) { 'main: kept, as agent.json said' }

# The site and the Discord bot (#5190, #5187): the agent swaps in each
# Deployment to Site and to Discord bot. Their logs go in the dev server's
# data folder beside dev's, the one folder on the box served to the outside.
# Named only where the app is set up, by its full install (Deploy-Docs.ps1,
# Install-Bot.ps1); a box without one gets no Deployments applied for it.
foreach (`$app in @(
    @{ name = 'site'; there = [bool](Get-ScheduledTask -TaskName 'Thornswood Docs' -ErrorAction SilentlyContinue); what = 'the site''s task Thornswood Docs' },
    @{ name = 'discord'; there = [bool](Get-Service -Name 'ThornswoodBot' -ErrorAction SilentlyContinue); what = 'the bot''s service ThornswoodBot' })) {
  `$cfg.environments.PSObject.Properties.Remove(`$app.name)
  if (-not `$app.there) { 'apps: ' + `$app.name + ' left out, ' + `$app.what + ' is not on this box'; continue }
  `$e = New-Object PSObject
  `$e | Add-Member -NotePropertyName logDir -NotePropertyValue 'C:\Thornswood-Server-Dev\data'
  `$e | Add-Member -NotePropertyName logBase -NotePropertyValue '$logBase'
  `$cfg.environments | Add-Member -NotePropertyName `$app.name -NotePropertyValue `$e -Force
  'apps: ' + `$app.name + ' named; the agent applies its Deployments'
}

# Dev voice (#5187): a Release's voice part goes in with dev's Deployment,
# into the folder Install-Voice.ps1 set up, under its task.
`$cfg.environments.dev.PSObject.Properties.Remove('voice')
if (Get-ScheduledTask -TaskName 'Thornswood Dev Voice' -ErrorAction SilentlyContinue) {
  `$cfg.environments.dev | Add-Member -NotePropertyName voice -NotePropertyValue (New-Object PSObject) -Force
  'voice: dev voice named; a Release''s voice goes in with dev''s Deployment'
} else { 'voice: dev voice left out, its task Thornswood Dev Voice is not on this box' }

# The release news (#5187): after a Deployment goes in, the agent leaves its
# Release's notes in for-bot for the bot to post (tools\DeployAgent\News.cs).
# Only the bot's own account reads there besides SYSTEM and Administrators.
`$newsDir = 'C:\Thornswood-Deploys\for-bot'
if (Get-Service -Name 'ThornswoodBot' -ErrorAction SilentlyContinue) {
  New-Item -ItemType Directory -Force -Path `$newsDir | Out-Null
  & icacls.exe `$newsDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\ThornswoodBot:(OI)(CI)RX' | Out-Null
  if (`$LASTEXITCODE -eq 0) { 'news: ' + `$newsDir + ' is there, readable by the bot; the agent leaves each Release''s news in it' }
  else { 'NEWS: icacls could not set the rules on ' + `$newsDir + ', so the bot may not read the news there' }
} else { 'news: the bot''s service ThornswoodBot is not on this box, so no news is left for it' }

# The bot pass (#5196): its folder, its task, and agent.json naming the
# folder only once the task runs as its own SID with rights there alone.
`$passTask = '$passTask'
`$passRoot = '$passRoot'
`$noPass = [bool]$([int][bool]$NoBotPass)
`$passWhy = ''
`$cfg.environments.dev.PSObject.Properties.Remove('botPassRoot')
if (`$noPass) {
  if (Get-ScheduledTask -TaskName `$passTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName `$passTask -Confirm:`$false }
  'bot pass: off (-NoBotPass); dev Deployments go in without one'
} else {
$(Get-ThornswoodServiceAccountScript)
  `$cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own `$passRoot -Box 'C:\'))
  if (`$cannot.Count) { `$passWhy = 'LOCAL SERVICE could read what no service may: ' + (`$cannot -join '; ') + ' (scripts\vps\Lock-VpsFolders.ps1 locks them)' }
  `$node = Get-Command node -ErrorAction SilentlyContinue
  `$nodeExe = if (`$node) { `$node.Source } elseif (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe') { 'C:\Program Files\nodejs\node.exe' } else { '' }
  if (-not `$passWhy -and -not `$nodeExe) { `$passWhy = 'node is not installed on this machine' }
  # The bot connects through dev's own engine (createBotClient, skymp fork
  # #137). With an engine older than that every pass would fail, so the pass
  # waits for a dev release that carries it, and this says so.
  `$devEngine = 'C:\Thornswood-Server-Dev\scam_native.node'
  if (-not `$passWhy) {
    try { `$hasBot = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes(`$devEngine)).Contains('createBotClient') } catch { `$hasBot = `$false; `$passWhy = 'dev''s engine could not be read: ' + `$_.Exception.Message }
    if (-not `$passWhy -and -not `$hasBot) { `$passWhy = 'dev''s engine has no createBotClient (skymp fork #137); run this again once a dev release carries it' }
  }
  if (-not `$passWhy) {
    try {
      foreach (`$d in `$passRoot, (Join-Path `$passRoot 'run'), (Join-Path `$passRoot 'plugins')) { if (-not (Test-Path -LiteralPath `$d)) { New-Item -ItemType Directory -Path `$d | Out-Null } }
      & icacls.exe `$passRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
      if (`$LASTEXITCODE -ne 0) { throw ('icacls could not set the rules on ' + `$passRoot) }
      `$run = Join-Path `$passRoot 'run'
      `$action = New-ScheduledTaskAction -Execute `$nodeExe -Argument ('"' + `$run + '\bot\Bot-Pass.js" --root "' + `$run + '\server" --out "' + `$run + '\result.json"') -WorkingDirectory `$run
      # On demand only (the agent starts it), below normal priority (7), and
      # a time limit past the agent's own 30 minutes.
      `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -Priority 7
      if (Get-ScheduledTask -TaskName `$passTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName `$passTask -Confirm:`$false }
      Register-ScheduledTask -TaskName `$passTask -Action `$action -Settings `$settings -Principal (New-ThornswoodServicePrincipal) | Out-Null
      `$sid = Get-ThornswoodTaskSid `$passTask
      if (-not `$sid) { throw ('the task SID NT TASK\' + `$passTask + ' could not be looked up') }
      Grant-ThornswoodServiceFolder -Root `$passRoot -Sid `$sid -Writable 'run' | ForEach-Object { 'bot pass: ' + `$_ }
      Set-ThornswoodTaskOwner -TaskName `$passTask -Sid `$sid -Action `$action -Roots `$passRoot | ForEach-Object { 'bot pass: ' + `$_ }
      `$p = (Get-ScheduledTask -TaskName `$passTask).Principal
      if (`$p.UserId -notmatch 'LOCAL SERVICE' -or [string]`$p.RunLevel -ne 'Limited') { throw ('the task reads back as ' + `$p.UserId + ', ' + `$p.RunLevel) }
    } catch {
      `$passWhy = `$_.Exception.Message
      # Never left on SYSTEM or half set up: no task means no bot pass.
      if (Get-ScheduledTask -TaskName `$passTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName `$passTask -Confirm:`$false }
    }
  }
  if (`$passWhy) { 'BOT PASS NOT SET UP: ' + `$passWhy + '. Dev Deployments go in without one until it is.' }
  else {
    `$cfg.environments.dev | Add-Member -NotePropertyName botPassRoot -NotePropertyValue `$passRoot -Force
    'bot pass: the task ' + `$passTask + ' runs node ' + `$nodeExe + ' as LOCAL SERVICE, Limited, NT TASK\' + `$passTask + ', below normal priority; every dev Deployment waits on it'
  }
}
[IO.File]::WriteAllText(`$cfgPath, (`$cfg | ConvertTo-Json -Depth 10))

# In place, with the one it replaces kept beside it until the new one runs.
`$svc = Get-Service -Name `$agentSvc -ErrorAction SilentlyContinue
if (`$svc -and `$svc.Status -eq 'StopPending' -and `$endHung) {
  `$hung = [int](Get-CimInstance -ClassName Win32_Service -Filter "Name='`$agentSvc'").ProcessId
  if (`$hung -gt 0) { Stop-Process -Id `$hung -Force; 'ENDED the stuck process ' + `$hung + ' of ' + `$agentSvc + ' (-EndHung)' }
  `$svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
} elseif (`$svc -and `$svc.Status -ne 'Stopped') {
  Stop-Service -Name `$agentSvc -Force
  `$svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(120))
}
`$prev = `$exe + '.prev'
if (Test-Path -LiteralPath `$exe) { Move-Item -LiteralPath `$exe -Destination `$prev -Force }
Move-Item -LiteralPath `$new -Destination `$exe -Force
Remove-Item -LiteralPath `$stage -Recurse -Force

if (-not `$svc) {
  # The path has no spaces (-Root is held to that), so it needs no quotes of
  # its own, which Windows PowerShell 5.1 would not pass through whole.
  & sc.exe create `$agentSvc binPath= (`$exe + ' service') start= delayed-auto obj= LocalSystem DisplayName= 'Thornswood deploy agent' | Out-Null
  if (`$LASTEXITCODE -ne 0) { 'COULD NOT MAKE the service ' + `$agentSvc; exit 1 }
  & sc.exe description `$agentSvc 'Applies Thornswood Deployments from signed GitHub Releases (#5180). Outbound only.' | Out-Null
}
& sc.exe failure `$agentSvc reset= 86400 actions= restart/10000/restart/10000/restart/60000 | Out-Null
& sc.exe failureflag `$agentSvc 1 | Out-Null

# A start that fails or does not finish in time is said here and answered
# below, where the agent it replaced goes back.
`$svc = Get-Service -Name `$agentSvc
try { Start-Service -Name `$agentSvc; `$svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(60)) }
catch { 'the service did not reach Running: ' + `$_.Exception.Message }
`$svc.Refresh()
if (`$svc.Status -ne 'Running') {
  'the new agent did not start (' + `$svc.Status + ')'
  if (Test-Path -LiteralPath `$prev) {
    Stop-Service -Name `$agentSvc -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath `$prev -Destination `$exe -Force
    Start-Service -Name `$agentSvc -ErrorAction SilentlyContinue
    'PUT BACK: the agent it replaced is in place again'
  }
  exit 1
}
Remove-Item -LiteralPath `$prev -Force -ErrorAction SilentlyContinue
& `$exe version 2>&1 | ForEach-Object { "`$_" }
'--- the agent''s own check ---'
& `$exe check 2>&1 | ForEach-Object { "`$_" }
'INSTALLED: ' + `$agentSvc + ' runs ' + `$best.tag_name
"@)
foreach ($l in $out) { Say ("  $l") }
if ($out -match '^INSTALLED: ') { Say 'The deploy agent is installed and running.' Green; exit 0 }
Die 'The deploy agent is not installed; the lines above say why.'
