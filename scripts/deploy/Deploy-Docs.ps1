<#
  Deploy-Docs.ps1

  Puts the Thornswood docs site on the VPS and keeps it running.

  The site is a small node server holding six markdown documents and whatever
  is in its files folder. Patrick and the testers edit the documents in the
  browser, and Claude edits the same files over ssh. The setup program is not
  in it: since #4824 the site serves it from GitHub Releases.

  Run once to install, and again whenever the site itself changes. The
  documents are NOT overwritten by a redeploy: only the app is. Anything typed
  into the site survives.

    .\Deploy-Docs.ps1          the app only, documents untouched
    .\Deploy-Docs.ps1 -Site    also the public pages, which nobody edits in
                               the browser, so this is safe
    .\Deploy-Docs.ps1 -Boards  also board.json, which DOES overwrite anything
                               typed into a board on the site
    .\Deploy-Docs.ps1 -Board active
                               replaces just the named board inside the live
                               board.json with the repo's, .bak first, and
                               leaves every other board as it was typed. A
                               board the repo marks "seeded" goes in once by
                               itself, on the first deploy that finds the
                               live copy without that mark (#2414)
    .\Deploy-Docs.ps1 -SeedDocs
                               flattens every document with the repo copy.
                               First install only. Takes a .bak of each first.
    .\Deploy-Docs.ps1 -Docs help
                               replaces just the named documents with the
                               repo copy, .bak first. For a page rewritten
                               here on purpose, when -SeedDocs is too much.
    .\Deploy-Docs.ps1 -PutBack puts the app the last deploy replaced back,
                               checked the same way, and sends nothing
    .\Deploy-Docs.ps1 -Password
                               asks for a new member password without
                               showing it, and sets it. Never type the
                               password on the command line.
    .\Deploy-Docs.ps1 -RunAs SYSTEM
                               the way back, and the only way the site runs
                               as SYSTEM (#2613). Without -RunAs the site
                               runs as LOCAL SERVICE, with its own folder and
                               nothing else to write in, and one privilege,
                               the one for walking folders; a task still on
                               SYSTEM is moved onto it at the next deploy.
                               A task put on SYSTEM with -RunAs SYSTEM goes
                               back to LOCAL SERVICE at the next plain deploy.

  ONCE THE DEPLOY AGENT HAS THE SITE (#5190), the app (server.js and
  public) and the public pages (data\site) come only from each merge's
  Release: merge-release.yml zips them (App-Part.ps1) and the box deploy
  agent swaps them in when they changed (docs\DEPLOY-AGENT.md). This asks
  the box whether the agent's agent.json names the site. When it does, a
  plain run sends no app and no public pages, -Site is refused before
  anything is sent, and the documents, the boards, -Password, -RunAs, the
  task and the firewall go on as below. Two senders of the same files would
  each put back what the other put in. -PutBack still puts back the newest
  .prev folder, which the agent's swap leaves the same way. Before the agent
  names it (a new box), this sends the app as it always did.

  THE APP IS STAGED, CHECKED, THEN SWAPPED (issue #446). server.js and the
  public files that changed go into $Root\.stage-<stamp> while the site runs,
  the box checks them there (each file by its hash, server.js through
  node --check), and nothing else happens if that fails. server.js is compared
  by hash the same way the public files are (issue #1118): when the app is
  unchanged the stage is cleared and the site is not stopped. The task is set
  up, and only then is the site stopped, the files renamed in (what they
  replace goes to $Root\.prev-<stamp>, the newest two kept), started, and
  asked for its front page. If it does not answer, the old files go back and
  are started again, and this exits 1. It used to copy server.js and public\
  over the running site, restart it, and print DOCS DID NOT START with nothing
  put back. The documents and the public pages under data are content, not the
  app, and go up as they always did.

  The password crosses the wire in clear, because this is plain HTTP on an IP.
  Do not reuse one that matters. That improves the day a real domain and a
  certificate go on it.
#>
[CmdletBinding()]
param(
  [string]$Vps      = '',
  [string]$User     = '',
  [string]$Root     = 'C:/Thornswood-Docs',
  [string]$Task     = 'Thornswood Docs',
  [int]$Port        = 3001,
  # Asks for a new member password for the site, without showing it, and
  # sets it. A switch, never a value typed after it (issue #1069): a typed
  # value stays in the shell's history file and in the command line of the
  # process running this.
  [switch]$Password,
  # Where -Password reads the site password on the box (#2116), so nobody
  # types it. Missing: the hidden prompt, as before. See DocsPasswordFile.ps1.
  [string]$PasswordFile = '',
  # Flattens EVERY document on the VPS with the repo copy, including the ones
  # people have been typing into on the site. It is for a first install and for
  # nothing else. It now takes a backup and says what it stood on.
  [switch]$SeedDocs,
  # Just the boards. -SeedDocs would also flatten every markdown document up
  # there, which is too big a hammer when only the runbook moved.
  [switch]$Boards,
  # One board out of board.json, by its key (active), put in place of the
  # live one while every other board stays exactly as typed on the site
  # (#2414). -Boards flattens them all. The live board.json goes to .bak
  # first, and the board's revision moves on, so a hub page still open on the
  # old copy is told to reload rather than saving over the new one. A board
  # the repo marks "seeded" does not need it: see BOARDS THE REPO SEEDS.
  [string[]]$Board,
  # Just the public pages under data\site. Those are not editable in the
  # browser, so pushing them overwrites nobody's work. This is what you want
  # nine times out of ten when the wording on the public site changed.
  [switch]$Site,
  # Named documents under data, by name with or without .md: help, tests.
  # Only those are replaced, each after a .bak of the live copy, so a page
  # rewritten in the repo can go up without -SeedDocs flattening the rest.
  [string[]]$Docs,
  # The account the site's scheduled task runs as. Entry 219 on the To Do
  # List: the site has run as SYSTEM since it was first installed, which is
  # every right on the box for a node process that answers the internet.
  # LOCAL SERVICE is built in and needs no password kept anywhere, which a
  # named local user would.
  #
  # Left out, the site runs as LOCAL SERVICE (#2613): a new task is made on
  # it, and a task still on SYSTEM is moved onto it, the way #2578 moved the
  # game, voice and Caddy tasks. Until #2613 a task made for the first time
  # was SYSTEM and a plain deploy kept whatever the task had, so the switch
  # only ever happened if someone remembered -RunAs 'LOCAL SERVICE', and the
  # VPS site stayed SYSTEM. -RunAs SYSTEM is the way back, for one deploy;
  # the principal comes from New-ThornswoodServicePrincipal -AsSystem in
  # ServiceAccount.ps1, the same fallback the installers have. An account
  # set on the task by hand is still left as it is. No default on the
  # parameter itself, so the block can tell "left out" from "asked for".
  [ValidateSet('SYSTEM', 'LOCAL SERVICE')]
  [string]$RunAs,
  # How long the new site has to answer before the old files go back.
  [int]$Wait = 30,
  # Put the app the last deploy replaced back in, and send nothing.
  [switch]$PutBack,
  # The box deploy agent's settings. Once they name the site (#5190), each
  # merge's Release puts the app and the public pages in, and this sends
  # neither. A harness points it at a planted copy.
  [string]$AgentConfig = 'C:\Thornswood-Agent\agent.json',
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    [switch]$AllowStaleCheckout
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
. (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1'); Assert-FreshCheckout -RepoDir (Join-Path $PSScriptRoot '..\..') -What 'Deploy-Docs' -Target $Vps -AllowStale:$AllowStaleCheckout

$ssh  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The service account helpers (#2578), sent up as text in front of the setup
# script (#2613), so the site's principal and fail-safe are the installers'.
. (Join-Path $Here 'ServiceAccount.ps1')
# Where the box keeps its firewall rules, and the refresh that makes the
# firewall take a change to them (#3896).
. (Join-Path $Here '..\vps\BoxFirewall.ps1')
$siteAccountHelpers = (Get-ThornswoodServiceAccountScript) + "`n"
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
. (Join-Path $Here 'DocsPasswordFile.ps1')
. (Join-Path $Here 'SiteConfigSet.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
. (Join-Path $Here 'Swap.ps1')
$App  = Join-Path $Here '..\..\site'

if (-not (Test-Path -LiteralPath $App)) { throw "not found: $App" }
if ($PutBack -and ($Password -or $SeedDocs -or $Boards -or $Board -or $Site -or $Docs -or $RunAs)) {
  throw '-PutBack puts the last app back and sends nothing else, so it takes none of -Password, -SeedDocs, -Boards, -Board, -Site, -Docs or -RunAs.'
}
if ($Board -and ($Boards -or $SeedDocs)) {
  throw '-Board replaces one board and keeps the rest; -Boards and -SeedDocs replace all of board.json. Use one of them.'
}

# Asked before anything is sent, so a deploy never stops halfway for it.
# The box's locked-down password file comes first (#2116): nobody types the
# password or keeps a copy. The probe sends nothing secret and prints one
# line. Only a missing file falls back to the hidden prompt; a file that is
# there but readable by anybody else, or empty, stops here.
$newPassword = ''
$pwFromBox = $false
if ($Password) {
  if (-not $PasswordFile) { $PasswordFile = Get-ThornswoodDocsPasswordFile }
  $probe = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script (Get-ThornswoodDocsPasswordProbe $PasswordFile) |
    Where-Object { $_ -is [string] -and $_ -like 'PWFILE *' })
  $pwState = if ($probe.Count) { [string]$probe[-1] } else { 'PWFILE (no answer)' }
  if ($pwState -eq 'PWFILE OK') {
    $pwFromBox = $true
    Write-Host "  The site password comes from $PasswordFile on the box. Nothing to type."
  } elseif ($pwState -eq 'PWFILE MISSING') {
    Write-Host "  No $PasswordFile on the box, so it is asked for here."
    $newPassword = Read-ThornswoodSecret '  New site password (it is not shown)'
    if (-not $newPassword) { throw 'No password was given, so nothing was sent.' }
  } else {
    throw ("The password file on the box is not one to use ($pwState). Nothing was sent. " +
           "It has to be $PasswordFile, owned by and open only to BUILTIN\Administrators and the deploy account, with inheritance off.")
  }
}

# -Docs names have to be documents this repo actually has, or a typo would
# quietly send nothing and report nothing.
$docNames = @()
foreach ($d in @($Docs)) {
  if (-not $d) { continue }
  $n = if ($d -match '[.](md|json)$') { $d } else { "$d.md" }
  if (-not (Test-Path -LiteralPath (Join-Path $App "data/$n"))) { throw "no such document in the repo: data/$n" }
  $docNames += $n
}

# -Board names have to be boards the repo's board.json has, for the same
# reason, and only the plain names a board key is made of.
$boardNames = @()
if ($Board) {
  $repoBoards = Get-Content -Raw -LiteralPath (Join-Path $App 'data/board.json') | ConvertFrom-Json
  foreach ($b in @($Board)) {
    if (-not $b) { continue }
    if ($b -notmatch '^[a-z]+$') { throw "-Board takes a board's key, such as active: $b" }
    if (-not ($repoBoards.PSObject.Properties.Name -contains $b)) { throw "no board named $b in the repo's data/board.json" }
    $boardNames += $b
  }
}

# Whether the box deploy agent has the site (header, ONCE THE DEPLOY AGENT
# HAS THE SITE). A settings file that is there and does not read stops this:
# guessing either way would send the app over the agent's or leave it out.
$agentSite = $false
if (-not $PutBack) {
  $agentPath = $AgentConfig.Replace("'", "''")
  $agentSaid = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script @"
`$p = '$agentPath'
if (-not (Test-Path -LiteralPath `$p -PathType Leaf)) { 'AGENT SITE: no' }
else {
  try {
    `$c = [IO.File]::ReadAllText(`$p) | ConvertFrom-Json
    if (`$c.environments -and `$c.environments.PSObject.Properties['site']) { 'AGENT SITE: yes' } else { 'AGENT SITE: no' }
  } catch { 'AGENT SITE: unreadable, ' + `$_.Exception.Message }
}
"@ | Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_ -like 'AGENT SITE:*' })
  if ($agentSaid.Count -ne 1 -or $agentSaid[0] -notin 'AGENT SITE: yes', 'AGENT SITE: no') {
    throw ("the box did not say whether the deploy agent has the site (" + $AgentConfig + "): " + $(if ($agentSaid.Count) { $agentSaid -join '; ' } else { 'no answer' }) + '. Nothing was sent.')
  }
  $agentSite = ($agentSaid[0] -eq 'AGENT SITE: yes')
  if ($agentSite -and $Site) {
    throw '-Site sends the public pages, and the deploy agent puts them in from each merge''s Release now (#5190). A page that changed goes out with its merge; an older one goes back with: pwsh scripts/vps/Box-Run.ps1 -Line ''Deploy-Release -Environment site -Tag <tag>''. Nothing was sent.'
  }
  if ($agentSite) { Write-Host 'The deploy agent has the site: the app and the public pages come from each merge''s Release, and this sends neither.' }
}

# What goes up is the site artifact (issue #459, Artifact.ps1): server.js,
# its modules in lib (#5357), public and data as the commit holds them, in
# one zip named by commit and hash. Everything below sends from its folder,
# not from the working tree, and the zip itself goes to the box's store
# first, but only after the expanded tree has been checked against the
# commit (Assert-ThornswoodSourceIntegrity, issue #1335). A file that is not
# that commit stops the deploy here, and nothing is sent. The box is told
# the site runs it at the end, once the files are in place and answering
# (issue #446).
# -PutBack builds and sends nothing.
. (Join-Path $Here 'Artifact.ps1')
$artifact = $null
if (-not $PutBack) {
$artifact = New-ThornswoodArtifact -Component site -RepoDir (Join-Path $Here '..\..') -Paths 'site/server.js', 'site/lib', 'site/public', 'site/data'
Write-Host ('Artifact ' + (Format-ThornswoodArtifact $artifact))
$App = Join-Path $artifact.Folder 'site'
Assert-ThornswoodSourceIntegrity -Artifact $artifact -RepoDir (Join-Path $Here '..\..')
Send-ThornswoodArtifact -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh
}

# Runs a command up there and hands back what it said.
#
# 2>&1 means anything ssh writes to stderr comes back in the same stream as the
# output, as an ErrorRecord rather than a string. Callers that only print are
# fine with that. Callers that treat the result as text are not: until the
# box's OpenSSH 10.4 (#1043, 26 Oct 2026) ssh warned about post-quantum key
# exchange on every connection, that warning arrived among the filenames, and $_.Trim() stopped the deploy with "does not
# contain a method named 'Trim'" after the files had already gone up. The two
# places that build a list from this take only the strings.
function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

function Push($local, $remote) {
  Invoke-ThornswoodNative { & scp @ssh $local "$User@${Vps}:$remote" }
  if ($LASTEXITCODE -ne 0) { throw "scp failed: $local" }
}

$rootWin   = $Root.Replace('/','\')
# The folder the Thornswood folders sit side by side in, C: on the box, with
# no backslash at the end. The fail-safe and the site's grants name the other
# folders from it, so a deploy into a scratch box never reaches the real ones
# (#1273).
# It is taken as text by Windows rules: Split-Path here is this machine's,
# and off Windows it made C:\Thornswood-Docs's parent C:/ and every grant
# C:/\Thornswood-Server (#2989).
$boxWin    = $rootWin.TrimEnd('\')
$boxWin    = if ($boxWin.LastIndexOf('\') -ge 0) { $boxWin.Substring(0, $boxWin.LastIndexOf('\')) } else { '' }
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageName = '.stage-' + $stamp
$prevName  = '.prev-' + $stamp
$stageFar  = ($Root -replace '\\', '/') + '/' + $stageName
$hashes    = [ordered]@{}
$appUnchanged = $false
$gone = @()

if ($agentSite) { $appUnchanged = $true }
if (-not $PutBack -and -not $agentSite) {
Write-Host 'Making room...'
# A stage a run that died part way left is cleared first; it was never
# swapped in.
Remote @"
foreach (`$d in @('$rootWin','$rootWin\lib','$rootWin\public','$rootWin\data','$rootWin\files','$rootWin\uploads')) {
  if (-not (Test-Path `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null }
}
Get-ChildItem -LiteralPath '$rootWin' -Directory -Force -EA SilentlyContinue |
  Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Path '$rootWin\$stageName\public' -Force | Out-Null
New-Item -ItemType Directory -Path '$rootWin\$stageName\lib' -Force | Out-Null
'ready'
"@ | ForEach-Object { "  $_" }

Write-Host ''
Write-Host "Staging the site in $rootWin\$stageName..."
# Into the stage, never over the running site. What goes is listed in $send
# so the box can hold every file to its hash before anything is swapped.
$send = [ordered]@{}
# server.js by hash, the same way public files are (issue #1118). A document
# update used to stop the site every time because this always went up.
$serverLocal = Join-Path $App 'server.js'
$serverHash = (Get-FileHash -LiteralPath $serverLocal -Algorithm SHA256).Hash
$serverThere = ''
$hashedServer = Remote @"
if (Test-Path -LiteralPath '$rootWin\server.js') {
  (Get-FileHash -LiteralPath '$rootWin\server.js' -Algorithm SHA256 -EA SilentlyContinue).Hash
}
"@
foreach ($l in @($hashedServer)) {
  if ($l -is [string] -and $l.Trim() -match '^[0-9A-Fa-f]{64}$') { $serverThere = $l.Trim().ToUpper() }
}
if ($serverThere -eq $serverHash) {
  Write-Host '  server.js already the same up there, not sent'
} else {
  Push $serverLocal "$stageFar/server.js"
  $send['server.js'] = $serverLocal
  Write-Host '  server.js'
}
# Its modules in lib (#5357), each by hash the same way, and the ones the
# repository no longer has taken out by the swap, so a module the site
# dropped is not left beside the ones it loads.
$libThere = @{}
$hashedLib = Remote @"
Get-ChildItem '$rootWin\lib' -File -Filter *.js -EA SilentlyContinue | ForEach-Object {
  `$_.Name + '|' + (Get-FileHash -LiteralPath `$_.FullName -Algorithm SHA256 -EA SilentlyContinue).Hash
}
"@
foreach ($l in @($hashedLib)) {
  if ($l -is [string] -and $l.Trim() -match '^(.+)\|([0-9A-Fa-f]{64})$') { $libThere[$Matches[1]] = $Matches[2].ToUpper() }
}
$sentLib = @()
$sameLib = 0
Get-ChildItem (Join-Path $App 'lib') -File -Filter *.js -EA SilentlyContinue | ForEach-Object {
  if ($libThere[$_.Name] -eq (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash) { $sameLib++; return }
  Push $_.FullName "$stageFar/lib/$($_.Name)"
  $send['lib/' + $_.Name] = $_.FullName
  $sentLib += $_.Name
}
if ($sentLib.Count) { Write-Host ('  lib: ' + ($sentLib -join ', ')) }
Write-Host ('  ' + $sameLib + ' module(s) in lib already the same up there, not sent')
$repoLib = @(Get-ChildItem (Join-Path $App 'lib') -File -Filter *.js -EA SilentlyContinue | ForEach-Object Name)
$goneLib = @($libThere.Keys | Where-Object { $repoLib -notcontains $_ } | Sort-Object | ForEach-Object { 'lib/' + $_ })
# Everything in public\, by listing the folder rather than by a list kept here.
# robots.txt was added and did not go up, because this was six named files and
# a seventh is invisible to it.
#
# And only what differs from the copy already up there. Every file went every
# time, and on 25 September -Site and -Docs known both stopped here with
# "scp.exe: dest open C:/Thornswood-Docs/public/banner.mp4: Failure", after
# server.js and banner.jpg had gone. banner.mp4 had not changed since #91, so
# there was nothing to send, and the throw left the public pages and the
# restart below undone. A file whose hash matches is left alone; one that
# cannot be hashed up there, or is not there, still goes.
$publicThere = @{}
$hashed = Remote @"
Get-ChildItem '$rootWin\public' -File -EA SilentlyContinue | ForEach-Object {
  `$_.Name + '|' + (Get-FileHash -LiteralPath `$_.FullName -Algorithm SHA256 -EA SilentlyContinue).Hash
}
"@
foreach ($l in @($hashed)) {
  if ($l -is [string] -and $l.Trim() -match '^(.+)\|([0-9A-Fa-f]{64})$') { $publicThere[$Matches[1]] = $Matches[2].ToUpper() }
}
$sentPublic = @()
$samePublic = 0
Get-ChildItem (Join-Path $App 'public') -File -EA SilentlyContinue | ForEach-Object {
  if ($publicThere[$_.Name] -eq (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash) { $samePublic++; return }
  Push $_.FullName "$stageFar/public/$($_.Name)"
  $send['public/' + $_.Name] = $_.FullName
  $sentPublic += $_.Name
}
if ($sentPublic.Count) { Write-Host ('  ' + ($sentPublic -join ', ')) }
Write-Host ('  ' + $samePublic + ' public file(s) already the same up there, not sent')
# And the ones the repository no longer has, which the swap takes out
# (Swap.ps1, $Gone), with the modules gone from lib above. Only files at the
# top of public: the folders in it, such as downloads, are filled by other
# scripts.
$repoPublic = @(Get-ChildItem (Join-Path $App 'public') -File -EA SilentlyContinue | ForEach-Object Name)
$gonePublic = @($publicThere.Keys | Where-Object { $repoPublic -notcontains $_ } | Sort-Object | ForEach-Object { 'public/' + $_ })
$gone = @(@($goneLib) + @($gonePublic))
if ($gone.Count) { Write-Host ('  to take out, no longer in the repository: ' + ($gone -join ', ')) }

# When nothing in the app changed, skip the stage, the stop and the swap
# (issue #1118). Documents and the task step still run below.
$appUnchanged = ($send.Count -eq 0 -and $gone.Count -eq 0)
if ($appUnchanged) {
  Remote "Remove-Item -LiteralPath '$rootWin\$stageName' -Recurse -Force -EA SilentlyContinue" | Out-Null
  Write-Host '  nothing in the app changed, so the site will not be stopped'
} else {
# The box checks the stage while the old site still runs: every file as it
# left here, and server.js and each module through node --check when it was
# sent. A refusal clears the stage and this stops, with the documents, the
# password and the task untouched.
$hashes = Get-SwapHashes $send
$parse = @()
if ($send.Contains('server.js')) { $parse = @('server.js') }
$parse += @($send.Keys | Where-Object { $_ -like 'lib/*.js' })
$checkOut = @(Remote ((ServiceSwapVars $Root $stageName $prevName $Wait $hashes $parse) + $serviceCheckBlock) |
              ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
if ($checkOut -notcontains 'STAGE OK') {
  Write-Host ''
  Write-Host '  THE STAGE DID NOT CHECK OUT, so nothing was stopped or changed.' -ForegroundColor Red
  Write-Host '  The site is still running exactly as it was. The lines above say why.' -ForegroundColor Red
  exit 1
}
}

# The public pages are markdown like everything else, so they can be edited
# from the site rather than redeployed. Same rule: only the missing ones go.
# Once the agent has the site, every Release carries them and this sends none.
if (-not $agentSite) {
Remote "if (-not (Test-Path '$rootWin\data\site')) { New-Item -ItemType Directory -Path '$rootWin\data\site' -Force | Out-Null }" | Out-Null
$siteThere = @((Remote "Get-ChildItem '$rootWin\data\site' -File -EA SilentlyContinue | ForEach-Object Name") |
               Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Get-ChildItem (Join-Path $App 'data/site') -Filter *.md -EA SilentlyContinue | ForEach-Object {
  if ($SeedDocs -or $Site -or ($siteThere -notcontains $_.Name)) {
    Push $_.FullName "$Root/data/site/$($_.Name)"
    Write-Host "  sent site/$($_.Name)"
  }
}
}

# Documents are only sent on the first install, or when asked for outright.
# A redeploy that quietly overwrote them would throw away whatever anybody had
# typed since, which is the whole point of the site.
# File by file, because a new document added later still has to arrive while
# the ones people have been typing in are left exactly as they are. Only what
# is missing goes, unless -SeedDocs says to overwrite the lot.
Write-Host ''
Write-Host 'Documents...'
if ($SeedDocs -or $Boards -or $docNames.Count -or $boardNames.Count) {
  # Every document on the VPS goes to .bak first. Both of these have thrown
  # away an evening of edits before now: -SeedDocs flattens the lot, -Boards
  # flattens board.json, and a board is the thing most likely to have been
  # typed into five minutes ago.
  #
  # The \* matters. -Include filters only what a wildcard or -Recurse has
  # already gathered, so on the bare folder it matched nothing and this said
  # "backed up 0 document(s)" on every run: no -Docs, -Boards or -SeedDocs
  # ever left the .bak the messages below promise. Measured 24 September on
  # Windows PowerShell 5.1: 0 files without it, every .md and .json with it.
  Remote @"
`$n = 0
foreach (`$f in Get-ChildItem '$rootWin\data\*' -File -Include *.md,*.json -EA SilentlyContinue) {
  Copy-Item `$f.FullName (`$f.FullName + '.bak') -Force -EA SilentlyContinue
  `$n++
}
'backed up ' + `$n + ' document(s) to .bak before overwriting'
"@ | ForEach-Object { "  $_" }
}
$there = @((Remote "Get-ChildItem '$rootWin\data' -File -EA SilentlyContinue | ForEach-Object Name") |
           Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$sent = 0
Get-ChildItem (Join-Path $App 'data') | Where-Object { $_.Extension -in '.md','.json' } |
  ForEach-Object {
    $force = $SeedDocs -or ($Boards -and $_.Name -eq 'board.json') -or ($docNames -contains $_.Name)
    if ($force -or ($there -notcontains $_.Name)) {
      Push $_.FullName "$Root/data/$($_.Name)"
      Write-Host "  sent $($_.Name)"
      $sent++
    }
  }
if (-not $sent) {
  Write-Host '  all present, nothing overwritten (use -SeedDocs to replace them)'
}
# BOARDS THE REPO SEEDS, AND -Board (#2414). Every deploy puts a board from
# the repo into the live board.json when it carries a "seeded" mark the live
# copy does not have yet: the first deploy after it lands seeds it, whatever
# that deploy was for, and every later one leaves it as typed on the site,
# because hub saves keep the mark. -Board puts the named boards in whatever
# the live copy says. Nothing else in the file moves. The repo's board.json
# goes up beside it, node on the box (the site's own) swaps the keys and moves
# each one's _rev on, so a hub page still open on the old copy reloads rather
# than saving over it, and the result replaces the file in one rename, after a
# board.json.bak of what was there.
$seedNames = @()
$repoBoardFile = Join-Path $App 'data/board.json'
if (-not $SeedDocs -and -not $Boards -and (Test-Path -LiteralPath $repoBoardFile)) {
  $repoAll = Get-Content -Raw -LiteralPath $repoBoardFile | ConvertFrom-Json
  foreach ($bp in $repoAll.PSObject.Properties) {
    if ($bp.Name -match '^[a-z]+$' -and $boardNames -notcontains $bp.Name -and
        $bp.Value -is [System.Management.Automation.PSCustomObject] -and
        $bp.Value.PSObject.Properties.Name -contains 'seeded') { $seedNames += $bp.Name }
  }
}
$boardArgs = @($boardNames | ForEach-Object { $_ + '=force' }) + @($seedNames | ForEach-Object { $_ + '=seed' })
if ($boardArgs.Count) {
  Push (Join-Path $App 'data/board.json') "$Root/data/board.json.from-repo"
  $boardOut = @(Remote @"
`$node = (Get-Command node -EA SilentlyContinue).Source
if (-not `$node) { 'BOARD NOT REPLACED: node is not on this machine'; return }
`$js = Join-Path `$env:TEMP ('ts-board-' + [guid]::NewGuid().ToString('N') + '.js')
Set-Content -LiteralPath `$js -Encoding ASCII -Value @'
var fs = require('fs');
var a = process.argv.slice(2), live = a[0], repo = a[1], asks = a.slice(2);
var BOM = String.fromCharCode(0xFEFF);
function read(f) { var t = fs.readFileSync(f, 'utf8'); return JSON.parse(t.charAt(0) === BOM ? t.slice(1) : t); }
var L = read(live), R = read(repo), moved = 0;
var rev = (L._rev && typeof L._rev === 'object') ? L._rev : {};
for (var i = 0; i < asks.length; i++) {
  var n = asks[i].split('=')[0], how = asks[i].split('=')[1];
  if (!R[n] || typeof R[n] !== 'object') { console.log('BOARD NOT REPLACED: the repo has no board ' + n); process.exit(1); }
  if (how === 'seed' && L[n] && typeof L[n] === 'object' && L[n].seeded === R[n].seeded) {
    console.log('BOARD KEPT ' + n + ', already seeded ' + R[n].seeded + ', as typed on the site');
    continue;
  }
  L[n] = R[n];
  rev[n] = (typeof rev[n] === 'number' ? rev[n] : 0) + 1;
  moved++;
  console.log('BOARD REPLACED ' + n + ', now at revision ' + rev[n]);
}
if (moved) {
  L._rev = rev;
  fs.copyFileSync(live, live + '.bak');
  fs.writeFileSync(live + '.new', JSON.stringify(L, null, 2) + '\n', 'utf8');
  fs.renameSync(live + '.new', live);
}
'@
& `$node `$js '$rootWin\data\board.json' '$rootWin\data\board.json.from-repo' $($boardArgs -join ' ')
Remove-Item -LiteralPath `$js, '$rootWin\data\board.json.from-repo' -Force -EA SilentlyContinue
"@ | Where-Object { $_ -is [string] } | ForEach-Object { "$_".Trim() })
  $boardOut | ForEach-Object { Write-Host "  $_" }
  $answered = @($boardOut | Where-Object { $_ -like 'BOARD REPLACED *' -or $_ -like 'BOARD KEPT *' }).Count
  $forced = @($boardOut | Where-Object { $_ -like 'BOARD REPLACED *' }).Count
  if ($answered -ne $boardArgs.Count -or $forced -lt $boardNames.Count) {
    Write-Host ''
    Write-Host '  THE BOARDS WERE NOT PUT IN PLACE. The live board.json is as it was.' -ForegroundColor Red
    Write-Host '  The lines above say why. Nothing after this step was done.' -ForegroundColor Red
    exit 1
  }
}
if ($Boards -and -not $SeedDocs) {
  Write-Host ''
  Write-Host '  -Boards replaced board.json with the repo copy.' -ForegroundColor Yellow
  Write-Host '  Anything typed into a board on the site since the last deploy is now' -ForegroundColor Yellow
  Write-Host '  only in board.json.bak on the VPS. Plain Deploy-Docs never does this.' -ForegroundColor Yellow
}
if ($docNames.Count -and -not $SeedDocs) {
  Write-Host ''
  Write-Host "  -Docs replaced $($docNames -join ', ') with the repo copy." -ForegroundColor Yellow
  Write-Host '  Anything typed into those on the site since the last deploy is in the' -ForegroundColor Yellow
  Write-Host '  .bak file beside each on the VPS. The other documents were not touched.' -ForegroundColor Yellow
}
if ($SeedDocs -and $sent) {
  Write-Host ''
  Write-Host "  -SeedDocs overwrote $sent document(s) with the repo copy." -ForegroundColor Yellow
  Write-Host '  Anything typed into the site since the last deploy is now in the .bak' -ForegroundColor Yellow
  Write-Host '  file beside it on the VPS. Use -Site next time if you only meant the' -ForegroundColor Yellow
  Write-Host '  public pages, or -Boards if you only meant the runbook.' -ForegroundColor Yellow
}
}

if ($Password) {
  Write-Host ''
  Write-Host 'Setting the password...'
  # Read, set, write: only the password changes. This used to write
  # {"password": ...} over the whole of config.json, which took the Discord
  # client id and secret, the bot token, the bot key, the admins, the server
  # password and the cookie secret with it. With no client id, discordReady()
  # in server.js is false, and isMember and /api/login take the password
  # again, so a wipe reopened the door Discord had shut.
  #
  # The read, the check and the write are SiteConfigSet.ps1, the one block
  # Rotate-ServerPassword uses too (#2317): a file that is there and will not
  # parse is left exactly as it is, which is server.js's own rule
  # (unreadable is not empty, and the difference is somebody's client
  # secret), it reads as UTF-8 and writes with no byte order mark, and the
  # order of the settings is kept. That file says why each of those matters.
  #
  # The password goes on ssh's standard input (Send-Secret.ps1, issue #451),
  # so it is on no command line on either machine and in no file. Until then
  # it was base64'd into this script, which put it on the command line of ssh
  # here and of powershell on the VPS for the length of the call.
  # The value comes either from the box's own file (#2116), read there, or on
  # ssh's standard input from the prompt. What writes it is the same.
  $setTail = Get-ThornswoodSiteConfigSet -ConfigPath "$rootWin\config.json" -Key 'password' -What 'password'
  if ($pwFromBox) {
    Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ((Get-ThornswoodDocsPasswordSetHead $PasswordFile) + $setTail) |
      Where-Object { $_ -is [string] } | ForEach-Object { "  $_" }
  } else {
    $setHead = @"
`$ErrorActionPreference = 'Stop'
`$pw = `$ThornswoodSecret; `$ThornswoodSecret = `$null
if (-not `$pw) { 'NOTHING ARRIVED on standard input. Nothing written, the password is unchanged.'; return }
"@
    Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $newPassword -Script ($setHead + "`n" + $setTail) | ForEach-Object { "  $_" }
  }
  $newPassword = $null
}

if (-not $PutBack) {
Write-Host ''
Write-Host 'Opening the port and setting up the task...'
# The firewall, the account and the task definition. It stops and starts
# nothing: the swap below does that, once this has said it is all in place.
$setup = @(Remote @"
$siteAccountHelpers
`$ErrorActionPreference = 'Continue'

# The site answers on loopback only unless THORNSWOOD_DOCS_EXPOSE=1 (#2185),
# and Caddy holds 80 and 443. Opening 3001 would put a plain HTTP way straight
# past the certificate, so the rule is opened only for a box that asked for a
# plain listener on purpose, and torn down otherwise if a previous run left one.
# The rule lives in the box's own policy store, the only one the firewall
# takes rules from, and Group Policy is refreshed after a change
# (scripts\vps\BoxFirewall.ps1, #3896).
$(Get-ThornswoodFirewallScript)
`$local = [Environment]::GetEnvironmentVariable('THORNSWOOD_DOCS_LOCAL','Machine')
`$expose = [Environment]::GetEnvironmentVariable('THORNSWOOD_DOCS_EXPOSE','Machine')
`$fwHas = [bool](Get-NetFirewallRule -PolicyStore localhost -DisplayName '$Task' -EA SilentlyContinue)
if (`$local -eq '1' -or `$expose -ne '1') {
  if (`$fwHas) { Remove-NetFirewallRule -PolicyStore localhost -DisplayName '$Task'; Sync-ThornswoodFirewall; 'firewall rule on $Port taken away' }
  'loopback only, $Port left shut'
}
elseif (-not `$fwHas) {
  New-NetFirewallRule -PolicyStore localhost -DisplayName '$Task' -Direction Inbound -Protocol TCP ``
    -LocalPort $Port -Action Allow | Out-Null
  Sync-ThornswoodFirewall
  'firewall opened on $Port'
} else { 'firewall rule already there' }

# ==== thornswood site account ====
# Who the site runs as, from -RunAs. Worked out before anything is stopped,
# so an account that does not resolve leaves the running site alone.
#
# Without -RunAs it is LOCAL SERVICE (#2613). A box with no task yet gets a
# LOCAL SERVICE task, and a task still on SYSTEM is moved onto it. Until #2613
# no -RunAs meant SYSTEM for a new task and "keep what it has" for an old one,
# so nothing ever took the VPS site off SYSTEM. An account this script did
# not make, set on the task by hand, is handed back to the task as it is and
# granted nothing, because nothing here knows what it was set up to reach.
#
# -RunAs SYSTEM is the manual way back: New-ThornswoodServicePrincipal
# -AsSystem, Highest and no grants, as the installers' -AsSystem (#2578). The
# next deploy without -RunAs moves it to LOCAL SERVICE again.
#
# THE FAIL-SAFE (#2578). Before the site is moved off SYSTEM, or made for the
# first time, Test-ThornswoodServiceCannotReach reads the places no service
# may read, and when LOCAL SERVICE or a broad group could read one, the block
# ends here with nothing stopped or changed and says to lock them or pass
# -RunAs SYSTEM. A task already on LOCAL SERVICE is not asked again.
#
# LOCAL SERVICE is cut down to one privilege. -RunLevel Limited alone takes
# nothing away from a built-in service account, because it has no split
# token to lower. Windows gives LOCAL SERVICE "Impersonate a client" and
# "Replace a process level token" by default, and public tools turn either
# of those into SYSTEM from inside whatever holds them. A task given no
# privilege list is not kept from starting with them, so -RequiredPrivilege
# names the one node needs, SeChangeNotifyPrivilege, which lets it reach a
# file through folders it has no rights on. -ProcessTokenSidType
# Unrestricted, in Microsoft's words, adds a SID made from the task name to
# the process token and changes the token's default DACL "to allow only the
# task SID and local system full control and the account SID read control",
# which leaves every other service on the box that runs as LOCAL SERVICE
# able to read the site's own objects and not change them. Neither was tried
# on a registered task here, and the read-back after registering says what
# the box kept.
#
# THE GRANTS NAME THE TASK, NOT LOCAL SERVICE (#4077). Until 27 Oct 2026 the
# rules below went to LOCAL SERVICE, which every service on the box runs as,
# so the dev server's gamemode could change the site's code and read what
# the site reads. They go to NT TASK\<the site's task> now, its SID worked
# out from the task's name, and each run takes the LOCAL SERVICE rules it
# made before off, on every copy of those folders on the box. Windows maps
# that SID only once the task is registered, so the grants are made after
# the task is registered or updated, in the site grants block below (#4973),
# and a grant still refused there stops the deploy. The task starts through the launcher
# (ServiceAccount.ps1), so what the site writes is owned by that SID and not
# by LOCAL SERVICE, and once the site is stopped, the files LOCAL SERVICE
# owns in its folder are given to it (StartIt below).
#
# It is also given what the site touches and no more: Modify on its own
# folder, where it writes config.json, data, uploads and site.log, and Read
# on the five places outside it that server.js reads, measured on 24 Sep:
# onlineFile, the main and dev SERVER_LOGS, and the main and dev CHAT_DIRS;
# and since #459 the deploy records /api/deploys lists, DEPLOYS_DIR.
# Granted on the folder rather than the file, because server.log is deleted
# and made again at every server start and a grant on the file would go with
# it. (NP) keeps each one to the files directly in that folder and out of the
# world data below it. In C:\Thornswood-Server that still includes
# server-settings.json. Given again at every deploy while the site is not
# SYSTEM, which icacls adds to the rule already there rather than doubling,
# so a dev folder made after the switch is reached at the next deploy.
`$runAs = '$RunAs'
`$principal = `$null
`$sid = ''
`$own = ''
`$already = `$false
if (-not `$runAs) {
  `$runAs = 'LOCAL SERVICE'
  `$was = (Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue).Principal
  if (`$was) {
    try { `$sid = (New-Object Security.Principal.NTAccount([string]`$was.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { 'the task runs as ' + `$was.UserId + ', which does not translate to an account here (' + `$_.Exception.Message + ')' }
    if (`$sid -eq 'S-1-5-19') { `$already = `$true; 'no -RunAs, so the task keeps the account it has: LOCAL SERVICE' }
    elseif (`$sid -eq 'S-1-5-18') { 'no -RunAs, and the task ran as SYSTEM: it moves to LOCAL SERVICE (#2613). -RunAs SYSTEM is the way back.' }
    else { `$runAs = [string]`$was.UserId; `$principal = `$was }
  } else { 'no -RunAs and no task yet: a new task runs as LOCAL SERVICE (#2613)' }
}
if (`$principal) {
  'an account this script did not set up: left as it is, nothing granted'
} elseif (`$runAs -eq 'SYSTEM') {
  `$sid = 'S-1-5-18'
  `$principal = New-ThornswoodServicePrincipal -AsSystem
} else {
  `$sid = ''
  try { `$sid = (New-Object Security.Principal.NTAccount('NT AUTHORITY', `$runAs)).Translate([Security.Principal.SecurityIdentifier]).Value }
  catch { 'NO SUCH ACCOUNT HERE: ' + `$runAs + ' (' + `$_.Exception.Message + '). Nothing was stopped or changed.'; return }
  if (-not `$already) {
    `$cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own '$rootWin' -Box '$boxWin'))
    if (`$cannot.Count) {
      'LOCAL SERVICE COULD READ WHAT NO SERVICE MAY, so the site is not moved onto it:'
      foreach (`$c in `$cannot) { '  ' + `$c }
      'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -RunAs SYSTEM. Nothing was stopped or changed.'
      return
    }
  }
  `$principal = New-ThornswoodServicePrincipal
  `$own = Get-ThornswoodTaskSidFromName '$Task'
}
# ==== end thornswood site account ====

`$node = (Get-Command node -EA SilentlyContinue).Source
if (-not `$node) { 'NODE NOT FOUND ON THIS MACHINE'; return }

# server.js goes in by its full path rather than by name. The path is what puts
# 'Thornswood-Docs' on the command line, and the command line is the only way
# to tell this node from any other one later.
`$a = New-ScheduledTaskAction -Execute `$node -Argument '$rootWin\server.js' -WorkingDirectory '$rootWin'
# Built once and used by both branches below.
#
# No execution time limit, because a task that is meant to run until the box
# goes down is stopped after three days by the default and nobody would
# connect the site vanishing to a deploy seventy two hours earlier.
#
# Ten restarts rather than three. Three was enough for one bored scanner to
# take the site off the internet for the rest of the day: a request for /%
# used to end the process, and once the three were spent nothing brought it
# back, which also took the launcher's login with it. The handler answers 400
# now so this should never be reached, but a service that stops trying to
# come back is not a thing to leave lying around.
#
# Priority 4, normal, not Task Scheduler's default of 7 (#1968). A task
# registered without -Priority starts node below normal, with I/O priority 1
# (low) and memory priority 2: measured on the VPS on 5 October for this
# site and for Caddy, while the build runners, the bot and lsass ran Normal,
# 2 and 5. Low I/O priority is what held the game server's reads back
# (#1931, Install-ThornswoodServer.ps1). 4 gives I/O priority 2 and memory
# priority 5 as well. tests\test-service-task-priority.ps1 measures all three.
`$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries ``
      -DontStopIfGoingOnBatteries -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) ``
      -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -Priority 4
`$have = Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue
# Through the launcher when the site is on its own SID (#4077, the account
# block above). OWNER NEW tells the deploy the running site still makes its
# files as LOCAL SERVICE, so it is restarted even when no file changed.
if (`$own) {
  `$launcher = ''
  try { `$launcher = Install-ThornswoodOwnerLaunch }
  catch { 'COULD NOT BUILD THE LAUNCHER, so nothing was stopped or changed: ' + `$_.Exception.Message; return }
  `$a = New-ThornswoodOwnedAction -Launcher `$launcher -Sid `$own -Execute `$node -Argument '$rootWin\server.js' -WorkingDirectory '$rootWin'
  if (-not `$have -or [string]@(`$have.Actions)[0].Execute -ne `$launcher) { 'OWNER NEW' }
  'OWNER ' + `$own
}
if (-not `$have) {
  `$t = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName '$Task' -Action `$a -Trigger `$t -Settings `$s ``
    -Principal `$principal | Out-Null
  'scheduled task created'
} else {
  # The settings as well as the action. Without them an existing task keeps
  # whatever it was first registered with, which is how the three restart cap
  # survived every deploy that was meant to change it. The principal for the
  # same reason: without it -RunAs would never reach the task already on the
  # box, and nor would going back to SYSTEM. Without -RunAs the principal is
  # the account the task already had, so this keeps it rather than resetting
  # it.
  #
  # On the task object and handed back whole, not as Set-ScheduledTask
  # -Principal. That parameter merges the new principal into the old one and
  # keeps the old privilege list, and a SYSTEM principal carrying one is not
  # a valid task. So -RunAs SYSTEM on a task that had been LOCAL SERVICE
  # failed with "The task XML contains an unexpected node ...
  # Privilege:SeChangeNotifyPrivilege" (0x80041316), the task stayed LOCAL
  # SERVICE, and this deploy's action and settings were lost with it. Found in
  # review on 24 Sep and measured the same day on a scratch task under Windows
  # PowerShell 5.1 and pwsh 7: the object replaces the principal outright, in
  # both directions, and leaves the trigger alone.
  `$have.Actions = `$a
  `$have.Settings = `$s
  `$have.Principal = `$principal
  # Said in capitals when it fails. This script runs with Continue, so the
  # line after a failed update used to say "scheduled task updated" anyway.
  try {
    `$have | Set-ScheduledTask -ErrorAction Stop | Out-Null
    'scheduled task updated'
  } catch {
    'COULD NOT UPDATE THE SCHEDULED TASK, it keeps what it had: ' + `$_.Exception.Message
  }
}
# ==== thornswood site grants ====
# After the task is registered or updated, and not before (#4973). The grants
# name NT TASK\$Task by its SID, and Windows maps a task's SID only once
# that task is registered: on a box with no such task yet, icacls refused
# every grant with "No mapping between account names and security IDs"
# (#4968), the deploy carried on, and the new task ran with none of the
# access below until a second deploy. LOCAL SERVICE's old rules come off
# only once the grants are made. `$own is set only when the site runs on its
# own SID: not for SYSTEM, and not for an account set by hand.
if (`$own) {
  `$refused = @()
  foreach (`$g in @(
      @('$rootWin', '(OI)(CI)M'),
      @('$boxWin\Thornswood-Server\data', '(OI)(NP)R'),
      @('$boxWin\Thornswood-Server', '(OI)(NP)R'),
      @('$boxWin\Thornswood-Server-Dev', '(OI)(NP)R'),
      @('$boxWin\Thornswood-Voice\chat', '(OI)(NP)R'),
      @('$boxWin\Thornswood-Voice-Dev\chat', '(OI)(NP)R'),
      @('$boxWin\Thornswood-Deploys\current', '(OI)(NP)R'))) {
    if (-not (Test-Path -LiteralPath `$g[0])) { 'not here, nothing granted: ' + `$g[0]; continue }
    `$said = & icacls `$g[0] /grant ('*' + `$own + ':' + `$g[1]) 2>&1
    if (`$LASTEXITCODE -eq 0) { 'granted NT TASK\$Task ' + `$g[1] + ' on ' + `$g[0] }
    else {
      `$why = ((`$said | Out-String).Trim())
      'COULD NOT GRANT NT TASK\$Task ' + `$g[1] + ' on ' + `$g[0] + ': ' + `$why
      `$refused += `$g[1] + ' on ' + `$g[0] + ': ' + `$why
    }
  }
  # A grant still refused stops the deploy (#4973): the site would start
  # without what it needs and nothing would turn red. LOCAL SERVICE's old
  # rules stay on, and SETUP DONE is never said, so nothing is swapped.
  if (`$refused.Count) {
    'GRANTS REFUSED to NT TASK\$Task, so the deploy stops here and nothing is swapped. Refused:'
    foreach (`$x in `$refused) { '  ' + `$x }
    'LOCAL SERVICE keeps its old rules. The task is registered; deploy again once the refusal above is mended.'
    return
  }
  # The rules these grants gave LOCAL SERVICE before #4077, off every copy of
  # those folders on the box: the ones an install moved aside keep them
  # otherwise. The bot's and the runners' rules, and every other, stay.
  `$was = @('$rootWin')
  `$was += '$boxWin\Thornswood-Deploys\current'
  foreach (`$d in @(Get-ChildItem -LiteralPath '$boxWin\' -Directory -Force -EA SilentlyContinue | Where-Object { `$_.Name -like 'Thornswood-Server*' })) {
    `$was += `$d.FullName
    `$was += (Join-Path `$d.FullName 'data')
  }
  foreach (`$d in @(Get-ChildItem -LiteralPath '$boxWin\' -Directory -Force -EA SilentlyContinue | Where-Object { `$_.Name -like 'Thornswood-Voice*' })) {
    `$was += (Join-Path `$d.FullName 'chat')
  }
  foreach (`$p in `$was) {
    if (-not (Test-Path -LiteralPath `$p)) { continue }
    `$named = @((Get-Acl -LiteralPath `$p).GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]) | Where-Object { `$_.IdentityReference.Value -eq 'S-1-5-19' })
    if (-not `$named.Count) { continue }
    `$said = & icacls `$p /remove:g '*S-1-5-19' 2>&1
    if (`$LASTEXITCODE -eq 0) { 'LOCAL SERVICE no longer has a rule on ' + `$p }
    else { 'COULD NOT TAKE LOCAL SERVICE OFF ' + `$p + ': ' + ((`$said | Out-String).Trim()) }
  }

  # #913, approved by Patrick on 28 Sep. The site reads the update feed and
  # never writes it: only Remirror-Site-Feed and Publish-Update do, over scp
  # as Administrator. So the site account is denied writing and deleting in
  # feed and feed-dev, and keeps the read it inherits from the Modify above.
  # The deny names the write rights one by one and is built in .NET, NOT with
  # icacls (W,D,DC): icacls' W is FILE_GENERIC_WRITE, which carries
  # SYNCHRONIZE, node opens every file asking for SYNCHRONIZE, and that deny
  # took both feeds off the site for about four minutes on 28 Sep. A Deny rule
  # built here leaves SYNCHRONIZE out, and adding the same rule twice keeps one.
  `$fsr = [Security.AccessControl.FileSystemRights]
  `$noWrite = `$fsr::WriteData -bor `$fsr::AppendData -bor `$fsr::WriteExtendedAttributes -bor ``
    `$fsr::WriteAttributes -bor `$fsr::Delete -bor `$fsr::DeleteSubdirectoriesAndFiles
  `$who = New-Object Security.Principal.SecurityIdentifier(`$own)
  foreach (`$n in 'feed', 'feed-dev') {
    `$f = Join-Path '$rootWin' `$n
    if (-not (Test-Path -LiteralPath `$f)) { 'not here, nothing denied: ' + `$f; continue }
    try {
      `$acl = Get-Acl -LiteralPath `$f
      `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$who, `$noWrite,
        [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny)))
      # The deny that named LOCAL SERVICE before #4077 goes with its grant.
      foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]) | Where-Object { `$_.IdentityReference.Value -eq 'S-1-5-19' })) { [void]`$acl.RemoveAccessRuleSpecific(`$r) }
      Set-Acl -LiteralPath `$f -AclObject `$acl -ErrorAction Stop
      'denied NT TASK\$Task writing and deleting in ' + `$f
    } catch { 'COULD NOT DENY NT TASK\$Task writing in ' + `$f + ': ' + `$_.Exception.Message }
  }

  # BUILTIN\Users inherits read and create on C:\ and so on the whole site
  # folder, config.json included; nothing here runs as a plain user. The
  # folder stops inheriting, keeping a copy of what it had, and every Users
  # rule goes. SYSTEM, Administrators and the site account above stay.
  # Only the access rules are written back, through .NET: Set-Acl also tried
  # to write the audit part here, which needs SeSecurityPrivilege, and an
  # account without it (the build runner's) was refused (issue #1120).
  function SetAccess(`$p, `$a) {
    `$item = Get-Item -LiteralPath `$p -Force
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]`$item, [Security.AccessControl.DirectorySecurity]`$a)
  }
  try {
    `$users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
    `$acl = Get-Acl -LiteralPath '$rootWin'
    `$acl.SetAccessRuleProtection(`$true, `$true)
    SetAccess '$rootWin' `$acl
    `$acl = Get-Acl -LiteralPath '$rootWin'
    `$acl.PurgeAccessRules(`$users)
    SetAccess '$rootWin' `$acl
    'BUILTIN\Users no longer reaches $rootWin'
  } catch { 'COULD NOT TAKE BUILTIN\Users OFF ' + '$rootWin' + ': ' + `$_.Exception.Message }
}
# ==== end thornswood site grants ====

# Read back rather than assumed. Set-ScheduledTask is quiet about settings
# it did not apply.
`$chk = (Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue).Settings
if (`$chk) {
  'task settings: restart count ' + `$chk.RestartCount +
  ', execution time limit ' + (`$(if (`$chk.ExecutionTimeLimit -eq 'PT0S') { 'none' } else { `$chk.ExecutionTimeLimit })) +
  ', priority ' + `$chk.Priority
}
# And the account, compared by SID, because the task says SYSTEM or LOCAL
# SERVICE where -RunAs may have said it with NT AUTHORITY in front.
`$who = (Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue).Principal
if (`$who) {
  `$got = ''
  `$gotWhy = ''
  try { `$got = (New-Object Security.Principal.NTAccount(`$who.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
  catch { `$gotWhy = `$_.Exception.Message }
  if (`$gotWhy) { 'THE TASK RUNS AS ' + `$who.UserId + ', WHICH DOES NOT TRANSLATE TO AN ACCOUNT HERE (' + `$gotWhy + '), NOT ' + `$runAs }
  elseif (`$got -eq `$sid) { 'task runs as ' + `$who.UserId + ', run level ' + `$who.RunLevel }
  else { 'THE TASK RUNS AS ' + `$who.UserId + ', NOT ' + `$runAs }
  # The privilege cut too, because the account alone is not what makes it low
  # privilege, and a box that dropped the list would otherwise pass as done.
  if (`$runAs -ne 'SYSTEM') {
    `$privs = (@(`$who.RequiredPrivilege) | Where-Object { `$_ }) -join ','
    `$sidType = [string]`$who.ProcessTokenSidType
    if (`$privs -eq 'SeChangeNotifyPrivilege' -and `$sidType -eq 'Unrestricted') {
      'task privileges: ' + `$privs + ' only, token SID type ' + `$sidType
    } else {
      # No list at all is the worst case: the task starts with every
      # privilege the account has, which is what this block is here to stop.
      `$shown = `$privs
      if (-not `$shown) { `$shown = 'every one ' + `$runAs + ' has' }
      'THE TASK KEEPS MORE THAN IT SHOULD: privileges ' + `$shown + ', token SID type ' + `$sidType +
      '. It should be SeChangeNotifyPrivilege only, Unrestricted.'
    }
  }
}

'SETUP DONE'
"@ | ForEach-Object { "$_" })
foreach ($l in $setup) { Write-Host "  $l" }
# An account that does not resolve, or no node, ends that block early. Nothing
# has been stopped, so the stage goes and the site keeps running as it was.
# The site's own SID when it starts through the launcher (#4077), and whether
# the running site still writes as LOCAL SERVICE.
$owner = ''
foreach ($l in $setup) { if ($l -match '^\s*OWNER (S-1-[0-9-]+)\s*$') { $owner = $Matches[1] } }
$ownerNew = @($setup | Where-Object { $_.Trim() -eq 'OWNER NEW' }).Count -gt 0
if ($setup -notcontains 'SETUP DONE') {
  Remote "Remove-Item -LiteralPath '$rootWin\$stageName' -Recurse -Force -EA SilentlyContinue" | Out-Null
  Write-Host ''
  Write-Host '  The task could not be set up, so nothing was stopped or swapped. The lines' -ForegroundColor Red
  Write-Host '  above say why. The site is still running exactly as it was.' -ForegroundColor Red
  exit 1
}
}

# ==== thornswood site hooks ====
# What is particular to the site, for Swap.ps1's service swap: stopped by its
# own folder on node's command line, and by its port, because older installs
# ran it as plain 'server.js', which no command line filter can see. Found and
# opened before the task is asked to stop, then waited for until each has
# exited (StopAndMove.ps1, #2928); until 20 Oct this waited for the port to
# close instead, up to ten seconds, and the renames were tried ten times over.
# Started by its task. Healthy when its front page answers, not merely when
# something listens: a server.js that throws on its first request is not up.
$siteHooks = @'
function StopIt {
  $ids = @()
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue)) {
    if ($p.CommandLine -and $p.CommandLine.IndexOf($Root + '\', [StringComparison]::OrdinalIgnoreCase) -ge 0) { $ids += $p.ProcessId }
  }
  $ids += @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
  $held = @(Get-ThornswoodProcessHeld $ids)
  $ThornswoodNotHeld
  Stop-ScheduledTask -TaskName $Task -EA SilentlyContinue
  foreach ($p in $held) { 'stopped pid ' + $p.Id }
  Stop-ThornswoodProcessHeld $held
}
# With the site stopped, what LOCAL SERVICE made in its folder is given to
# the site's own SID before it starts through the launcher (#4077, the
# account block). Said in capitals when it cannot be, naming why; the site
# still starts, because a site left stopped takes the launcher's sign-in
# down with it.
function StartIt {
  if ($Owner) {
    try { Repair-ThornswoodServiceOwner -Root $Root -Sid $Owner }
    catch { 'COULD NOT GIVE THE SITE WHAT LOCAL SERVICE MADE IN ' + $Root + ': ' + $_.Exception.Message }
  }
  Start-ScheduledTask -TaskName $Task
}
function Healthy {
  $until = (Get-Date).AddSeconds($Wait)
  while ($true) {
    $code = 0
    try {
      $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/') -UseBasicParsing -TimeoutSec 5
      $code = [int]$r.StatusCode
    } catch {
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    }
    if ($code -gt 0 -and $code -lt 500) { return $true }
    if ((Get-Date) -gt $until) { return $false }
    Start-Sleep -Milliseconds 700
  }
}
function Answer {
  $l = @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue)
  $by = ''
  if ($l.Count) { $by = ', pid ' + $l[0].OwningProcess }
  'the site answers on ' + $Port + $by
  # Where it listens (#2185): loopback only, unless the box asked for a plain
  # listener with THORNSWOOD_DOCS_EXPOSE=1. Said, not fatal: the site is up.
  $open = @($l | Where-Object { $_.LocalAddress -notmatch '^(127\.|::1$)' } | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
  if ($open.Count -and [Environment]::GetEnvironmentVariable('THORNSWOOD_DOCS_EXPOSE','Machine') -ne '1') {
    'EXPOSED: the site listens on ' + ($open -join ', ') + ' port ' + $Port + ', not loopback only. Plain HTTP past the certificate (#2185).'
  } elseif ($l.Count) { 'listening on ' + ((@($l | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)) -join ', ') }
  # Whether the files play and identity rest on read (#2180). Said, not
  # fatal: the swap carries the app, not those files, so putting the old app
  # back would mend nothing. A broken one is repaired from the backup.
  try {
    $null = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/api/ready') -UseBasicParsing -TimeoutSec 5
    'state ready'
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $said = $null
    if ($code -eq 503 -and $_.ErrorDetails -and $_.ErrorDetails.Message) { $said = $_.ErrorDetails.Message | ConvertFrom-Json }
    if ($said) {
      'STATE BROKEN: ' + ((@($said.broken) | ForEach-Object { $_.file + ' ' + $_.why + $(if ($_.play) { ', nobody can play' } else { '' }) }) -join '; ') + '. Repair it from the backup.'
    } else { 'could not ask the site whether its state reads (' + $code + '): ' + $_.Exception.Message }
  }
}
# Run by hand, to see why: a task swallows what node prints.
function Why {
  $node = (Get-Command node -EA SilentlyContinue).Source
  if (-not $node) { 'NODE NOT FOUND ON THIS MACHINE'; return }
  'DOCS DID NOT START. Running it by hand to see why:'
  $o = Join-Path $env:TEMP 'tw-docs-out.txt'
  $e = Join-Path $env:TEMP 'tw-docs-err.txt'
  Remove-Item $o, $e -Force -EA SilentlyContinue
  $h = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $Root `
        -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -NoNewWindow
  Start-Sleep -Seconds 4
  if ($h -and -not $h.HasExited) {
    'it runs fine by hand, so the scheduled task is what is wrong. Look first for a file its account cannot reach.'
    Stop-Process -Id $h.Id -Force -EA SilentlyContinue
  }
  Get-Content $o, $e -EA SilentlyContinue | Select-Object -First 25
  (Get-ScheduledTask -TaskName $Task -EA SilentlyContinue | Get-ScheduledTaskInfo).LastTaskResult |
    ForEach-Object { 'task last result: ' + $_ }
}

'@
# ==== end thornswood site hooks ====

Write-Host ''
if ($PutBack) { Write-Host "Putting back the newest .prev folder in $rootWin..." }
elseif ($appUnchanged -and $ownerNew) { Write-Host 'Nothing in the app to swap, but the site starts through the launcher now: restarting it.' }
elseif ($appUnchanged) { Write-Host 'Nothing in the app to swap; site left running.' }
else { Write-Host 'Stopping, swapping in and starting...' }
# The site's own SID for StartIt (#4077), and the account helpers it uses.
$ownerVars = $siteAccountHelpers + "`$Owner = '" + $owner + "'`r`n"
# Nothing to swap and the site still writes as LOCAL SERVICE (OWNER NEW):
# stopped, given what LOCAL SERVICE made in its folder, and started through
# the launcher, the way the swap does it, so nothing it writes from here on
# is every service's.
if ($appUnchanged -and $ownerNew -and -not $PutBack) {
  $restartVars = "`$Root = '" + $Root.Replace('/', '\').Replace("'", "''") + "'`r`n`$Wait = " + $Wait + "`r`n" +
                 "`$Task = '" + $Task.Replace("'", "''") + "'`r`n`$Port = " + $Port + "`r`n" +
                 "`$HoldBy = '" + (Get-ThornswoodHoldBy 'Deploy-Docs.ps1').Replace("'", "''") + "'`r`n"
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $restartOut = @(Remote ($ownerVars + $restartVars + $ThornswoodHoldText + $ThornswoodStopAndMoveText + $siteHooks + @'
# Held while it is stopped (#5155, ServerHold.ps1), so the watchdog leaves it.
Set-ThornswoodHold -Target $Task -Why 'restarting the site to start it through its launcher' -By $HoldBy
StopIt
StartIt
$ok = Healthy
Clear-ThornswoodHold -Target $Task
if ($ok) { 'PASS: ' + (Answer); 'RESTART OK' } else { 'FAIL: it did not answer within ' + $Wait + ' seconds'; Why }
'@) | ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
  } finally { $ErrorActionPreference = $eap }
  if ($restartOut -notcontains 'RESTART OK') {
    Write-Host ''
    Write-Host '  THE SITE DID NOT ANSWER AFTER ITS RESTART. The lines above say why.' -ForegroundColor Red
    exit 1
  }
}
if ($PutBack -or -not $appUnchanged) {
$vars = (ServiceSwapVars $Root $stageName $prevName $Wait $hashes @() $Task) +
        ("`$Task = '" + $Task.Replace("'", "''") + "'`r`n`$Port = " + $Port + "`r`n") +
        ('$Gone = @(' + ((@($gone) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ') + ")`r`n")
$pick = ''
if ($PutBack) { $pick = $putBackPick }
$eap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $swapOut = @(Remote ($ownerVars + $vars + $siteHooks + $pick + $serviceSwapBlock) |
               ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
} finally { $ErrorActionPreference = $eap }
if (-not (Show-SwapResult $swapOut "$rootWin\.prev-<stamp>")) { exit 1 }

# The site's files are in place and it answers: the box records that it runs
# this artifact, read back at /api/deploys (Artifact.ps1), and the record it
# had goes into .prev with the files it describes (Swap.ps1). After -PutBack
# the record that came back with the files is the one recorded.
if ($PutBack) { Restore-SwapRecord "$User@$Vps" $ssh $Root $swapOut '' 'site' }
else {
  Save-SwapPreviousRecord "$User@$Vps" $ssh $Root $prevName
  $null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh -Root $Root
}
}

Write-Host ''
Write-Host "  http://${Vps}:$Port" -ForegroundColor Green
