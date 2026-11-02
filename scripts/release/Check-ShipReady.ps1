<#
  Check-ShipReady.ps1

  Whether THIS machine can run a release, and what is missing if it cannot.

      .\scripts\release\Check-ShipReady.ps1              the main channel
      .\scripts\release\Check-ShipReady.ps1 -Channel dev the dev channel
      .\scripts\release\Check-ShipReady.ps1 -NoVps       skip the two checks that ask the VPS
      .\scripts\release\Check-ShipReady.ps1 -Channel dev -Root C:\Thornswood-Repo\local\release-devbuild
                                                    a folder this machine has not recorded

  WHICH FOLDER (#1692). The one this machine builds the channel's release
  from, as Ship takes it: -Root, or else what Where.ps1 ShipRoot or ShipRootDev
  answers (the folder Setup-ShipMachine.ps1 -Root recorded, or the launcher
  install, and for dev that with -DevBuild on the end). A folder Vortex
  deploys into is a gap, because Ship refuses it before anything is built.

  A SHIP ROOT IS NOT AN INSTALL (#2603). Since #2019 that folder is a ship
  root: Update-ShipRoot.ps1, the step every Ship runs first, makes or
  refreshes its game folder, and its launcher is never started. So no fix
  here says to install Thornswood or to open a launcher in it. A main Ship
  puts the launcher it builds into the folder itself, so a main root with
  none yet is not a gap; only a dev Ship refuses a folder with no Launcher
  folder, and only the install rule's dev folder has a step that makes one.

  WHY IT EXISTS. Ship.ps1 has fourteen ways to refuse, and every one of them is
  found by running Ship and being stopped, usually after the launcher has
  already been compiled and the version already bumped. That is fine on the one
  machine where everything has been in place for months. It is the whole
  problem on a second machine, where the answer to "can I ship" was: try it and
  read whichever refusal comes first, fix that, try again. Djinn has never
  shipped, and nothing written down says what he would need.

  This asks every question Ship asks, before Ship does, and changes nothing.
  Each gap prints the exact command that closes it. It does not ship, publish,
  deploy, push or write anything outside its own output.

  NOT READY means something that would stop a Ship, and nothing else. A Ship
  never builds the engine, so the fork in engine\skymp is a note, not a check:
  what it needs is the game folder holding the recorded client, or a build
  that matches records\client-build.json for it to copy in (issue #946),
  which is CI's build of the pin, fetched by the Ship itself on a machine
  that takes it (Setup-ShipMachine.ps1 -EngineBuild ci, issue #3047). What
  only a main release asks for, the server build the live deploys send
  (issue #932), prints as WARN on main and leaves the verdict alone.

  It is deliberately not part of Ship. Ship's refusals stay where they are:
  they are the gate, and a gate that can be satisfied by a different script is
  not a gate. This is the map, not the key.
#>
[CmdletBinding()]
param(
  [ValidateSet('main','dev')]
  [string]$Channel = 'main',
  [switch]$NoVps,
  # The folder the release is built from, as Ship.ps1 -Root takes it (#1692).
  # Left out, Where.ps1 ShipRoot or ShipRootDev: see WHICH FOLDER above.
  [string]$Root = '',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\deploy\ServerBuild.ps1')
. (Join-Path $Here '..\deploy\Fresh-Checkout.ps1')
. (Join-Path $Here '..\mods\LoadOrder.ps1')
. (Join-Path $Here 'Assert-PublishSigned.ps1')
. (Join-Path $Here 'Feed-Store.ps1')
# Each check below is a row, not a stop: what fails is said, and the rest are still asked.
$ErrorActionPreference = 'Continue'
$script:VpsAddress = Get-ThornswoodVpsAddress
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
$Dev = ($Channel -eq 'dev')

$script:rows = New-Object Collections.Generic.List[object]

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

# One answer. $fix is the command that closes the gap, or $null when it is
# somebody's decision rather than a command. $who is who runs it. $level is
# 'need' for what would stop a Ship, and 'warn' for what does not stop one but
# gets in the way of something around it (the live deploys); a warn
# never changes the verdict. tests\test-ship-ready.ps1 lifts this and the
# functions below out of the script and runs them.
function New-Row([string]$what, [bool]$ok, [string]$detail, [string]$fix, [string]$who = 'either', [string]$level = 'need') {
  return [pscustomobject]@{ What = $what; Ok = $ok; Detail = $detail; Fix = $fix; Who = $who; Level = $level }
}

function Show-Row($r) {
  $script:rows.Add($r)
  $tail = $(if ($r.Detail) { '  (' + $r.Detail + ')' } else { '' })
  if ($r.Ok) { Say ('  yes   ' + $r.What + $tail) 'Green' }
  elseif ($r.Level -eq 'warn') { Say ('  WARN  ' + $r.What + $tail) 'Yellow' }
  else { Say ('  NO    ' + $r.What + $tail) 'Red' }
}

function Ready([string]$what, [bool]$cond, [string]$detail, [string]$fix, [string]$who = 'either') {
  Show-Row (New-Row $what $cond $detail $fix $who 'need')
}

# NOT READY only for a 'need' that failed.
function Get-ShipVerdict($rows) {
  # A loop, not @($rows): on the List this script keeps, @() throws
  # "Argument types do not match" in PowerShell 7.
  $all = @(foreach ($r in $rows) { $r })
  $gaps = @($all | Where-Object { -not $_.Ok -and $_.Level -ne 'warn' })
  $warns = @($all | Where-Object { -not $_.Ok -and $_.Level -eq 'warn' })
  return [pscustomobject]@{
    Ready  = ($gaps.Count -eq 0)
    Passed = @($all | Where-Object { $_.Ok }).Count
    Gaps   = $gaps
    Warns  = $warns
  }
}

# WHAT A SHIP NEEDS OF THE CLIENT, and it is not the fork (issue #946). Ship
# never builds the engine. It runs Go.ps1, which runs Sync-Client.ps1 to copy
# the recorded client from the build output into the game folder, and then
# Sync-Client.ps1 -Check, which refuses unless the game folder holds all six
# recorded files. So the question is only whether the game folder holds the
# recorded client already (exit 0), or a build that matches the record is here
# for Go.ps1 to copy in (exit 2). Until 28 Sep this asked whether
# engine\skymp was a clone of the fork, and said NOT READY on two fresh Ship
# worktrees whose Ships then ran to the end and published.
#
# CI'S BUILD (#3047). The build that matches a record is the one it was made
# from, and since #459 that is CI's: a build made here never is, so the fix
# names CI's and never a rebuild. On a machine that takes it, ClientDist is
# CI's build of the pin, and when that folder is not here yet Sync-Client
# fetches it as a Ship starts. $Ci is then what Get-EngineArtifact.ps1 -Check
# said (Code 2: GitHub keeps it, so the Ship gets it; else why not).
function Get-ClientRows([string]$SyncClient, [string]$Record, [string]$Game, [string]$ClientDist, $Ci = $null) {
  $rows = @()
  $hasRec = Test-Path -LiteralPath $Record
  $rows += New-Row 'the client build record is in the repo' $hasRec 'records\client-build.json' 'It is tracked in git, so git pull brings it'
  if (-not $hasRec -or -not $Game -or -not (Test-Path -LiteralPath $Game)) { return $rows }

  # global:, never a bare assignment, and 6>&1 as well as 2>&1: Sync-Client
  # reports with Write-Host, which is the information stream, so without it
  # its whole listing lands in the middle of this report. The same
  # LASTEXITCODE trap Ship.ps1 records applies here: a child script's exit
  # lands in the global one.
  # Do not pipe through Out-String: under Windows PowerShell 5.1 that wraps
  # InformationRecord host text to the window width, so a long STOP. line
  # splits and the Detail loses "N of M in place" (issue #1237). Read
  # MessageData (and plain / error strings) instead, joined on newlines.
  $global:LASTEXITCODE = 0
  $chunks = & $SyncClient -Check -NoPause -Game $Game -Dist $ClientDist -Record $Record 6>&1 2>&1
  $parts = foreach ($o in @($chunks)) {
    if ($o -is [System.Management.Automation.InformationRecord]) { [string]$o.MessageData }
    elseif ($o -is [System.Management.Automation.ErrorRecord]) { [string]$o }
    else { [string]$o }
  }
  $said = $parts -join [Environment]::NewLine
  $code = $global:LASTEXITCODE
  $stop = [regex]::Match($said, '(?m)^STOP\. (.+)$')
  $detail = switch ($code) {
    0       { 'the game folder holds it' }
    2       { 'a build that matches is at ' + $ClientDist + ', and Ship copies it in' }
    default { $(if ($stop.Success) { $stop.Groups[1].Value.Trim() } else { "Sync-Client -Check exit $code" }) }
  }
  $ok = ($code -eq 0) -or ($code -eq 2)
  if ($null -ne $Ci -and -not $ok -and -not (Test-Path -LiteralPath $ClientDist)) {
    if ($Ci.Code -eq 2) {
      $ok = $true
      $detail = 'CI''s build of the pin is not at ' + $ClientDist + ' yet; GitHub keeps it, and the Ship fetches it first'
    } else {
      $detail = 'CI''s build of the pin is not at ' + $ClientDist + ', and cannot be fetched: ' + $Ci.Said
    }
    $fix = '.\scripts\release\Get-EngineArtifact.ps1 says why, and what makes it again (engine\README.md, A Ship machine takes CI''s build)'
  } else {
    $fix = 'Take CI''s build of the pin, the one records\client-build.json names: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci' +
           ' (engine\README.md, A Ship machine takes CI''s build). A build made on this machine matches only a record made from it;' +
           ' .\scripts\release\Sync-Client.ps1 -Check -Dist <a folder> says whether another build matches'
  }
  $rows += New-Row 'the recorded client is in the game folder, or here to copy in' $ok $detail $fix
  return $rows
}

# WHAT ONLY A MAIN RELEASE ASKS FOR (issue #932), as a warning: it does not
# stop Ship.ps1 itself.
#   The server build. Deploy-Gamemode and Deploy-Server follow a main Ship,
#   and Deploy-Server refuses any server file (the binary, the JavaScript
#   half, the rest ServerBuild.ps1 names) that is not the build
#   records\server-build.json names (#1214). They read the fork's
#   build\dist\server unless given -Dist; out\_payload holds the one the last
#   release sent.
function Get-MainOnlyRows([string]$Channel, [string]$ServerRecord, [string[]]$ServerDists) {
  if ($Channel -ne 'main') { return @() }
  $rows = @()

  if (-not (Test-Path -LiteralPath $ServerRecord)) {
    $rows += New-Row 'the server build record is in the repo' $false 'records\server-build.json' 'git pull brings it' 'either' 'warn'
    return $rows
  }
  # A record that does not read is its own answer, not "no build matches": the
  # fix is the record, not a build.
  $rec = $null
  try { $rec = [IO.File]::ReadAllText($ServerRecord) | ConvertFrom-Json }
  catch {
    $rows += New-Row 'the server build record reads' $false ('records\server-build.json does not read: ' + $_.Exception.Message) 'git checkout -- records\server-build.json, or record the build again with .\scripts\release\New-ServerBuildRecord.ps1' 'either' 'warn'
    return $rows
  }
  $first = $ServerDists[0]
  $match = $null
  foreach ($d in $ServerDists) {
    if ((Test-Path -LiteralPath $d) -and -not @(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $d)).Count) { $match = $d; break }
  }
  $what = 'a server build that matches records\server-build.json, for Deploy-Gamemode and Deploy-Server after the Ship'
  if ($match -eq $first) {
    $rows += New-Row $what $true $first $null 'either' 'warn'
  } elseif ($match) {
    $rows += New-Row $what $false ($first + ' does not match; ' + $match + ' does') `
      ('Copy ' + $match + ' to a scratch folder and pass it as -Dist to Deploy-Gamemode.ps1 and Deploy-Server.ps1 (Deploy-Gamemode writes into the folder it is given)') 'either' 'warn'
  } else {
    $rows += New-Row $what $false ('none in ' + ($ServerDists -join ' or ')) `
      '.\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci puts CI''s server build of the pin under ServerDist (a build made here never matches); or deploy from the store with Deploy-Server.ps1 -FromStore' 'either' 'warn'
  }
  return $rows
}

# THE LAUNCHER IN THE RELEASE FOLDER (#2603). What Ship.ps1 does with
# <root>\Launcher, read from the code:
#   - main: nothing is asked of it before the build. A Ship that builds a
#     launcher takes the exe CI built for main's tag, signs it, and puts it
#     there with Install-Launcher.ps1, which makes the folder. A Ship that
#     keeps the feed's launcher publishes none, so it never reads the folder
#     either. Until 17 Oct this asked for Launcher\Thornswood.exe on main too,
#     and its fix was a person's install from the site, which is wrong for a
#     ship root (its launcher is never started) and asked for something no main
#     Ship needs: main's own root, local\release-main, made on 16 Oct by
#     Update-ShipRoot.ps1, has no Launcher folder and was NOT READY on it.
#   - dev: "No dev build at <root>" unless <root>\Launcher is there, the folder,
#     not the exe, before anything else, but only when the folder is the
#     install rule's (#2662): no -Root, and ship-roots.json records no dev
#     folder (Get-DevRootRefusal). The main launcher's Settings page (The dev
#     build) makes it, and only in <its own folder>-DevBuild (DevBuild.Root),
#     the install rule's dev folder. A folder named by -Root or recorded with
#     Setup-ShipMachine.ps1 -Root is made by Update-ShipRoot.ps1, which makes
#     no Launcher folder, and a dev Ship does not ask it for one: its launcher
#     step makes it. Publish-Update.ps1 asks only when it is given no -Root,
#     and Ship always gives it one. Until 18 Oct both refused every folder.
# One row, a need, as Ship asks it. $Named: the folder came from -Root or
# ship-roots.json, not from the install rule.
function Get-LauncherRows([string]$Channel, [string]$Root, [bool]$Named = $false) {
  $launchDir = $(if ($Root) { Join-Path $Root 'Launcher' } else { '' })
  if ($Channel -ne 'dev') {
    $exe = $(if ($launchDir) { Join-Path $launchDir 'Thornswood.exe' } else { '' })
    $has = [bool]($exe -and (Test-Path -LiteralPath $exe -PathType Leaf))
    $detail = $(if ($has) { $exe + ', which a main Ship that builds a launcher replaces' }
                else { 'none yet: a main Ship that builds a launcher puts the one CI built for main''s tag there itself, in its own install step, and asks for none before that' })
    return @(New-Row 'the launcher in it, which a main Ship puts there itself' $true $detail $null)
  }
  $has = [bool]($launchDir -and (Test-Path -LiteralPath $launchDir -PathType Container))
  if (-not $has -and $Root -and $Named) {
    return @(New-Row 'its Launcher folder, which a dev Ship makes itself for a folder it was named' $true `
      ('none yet in ' + $Root + ': the folder was named (-Root or Setup-ShipMachine.ps1 -Root), so a dev Ship asks for none before the build, ' +
       'and its launcher step makes it, as it makes it on main; one that keeps the feed''s launcher publishes no exe') $null)
  }
  $detail = $(if ($has) { $launchDir } else { 'no Launcher folder in ' + $Root + ', and a dev Ship stops on that ("No dev build at")' })
  # The main install whose dev build would go here: <root> less -DevBuild,
  # when a main launcher is installed there. One's dev root,
  # local\release-devbuild, ends the same way and has none beside it.
  $main = $(if ($Root -match '-DevBuild$') { $Root.Substring(0, $Root.Length - '-DevBuild'.Length) } else { '' })
  if ($main -and (Test-Path -LiteralPath (Join-Path $main 'Launcher\Thornswood.exe') -PathType Leaf)) {
    $fix = 'In the main launcher installed at ' + $main + ': Settings, The dev build, Install it; it installs into ' + $Root
  } else {
    $fix = 'The main launcher''s dev build makes it only in <its own folder>-DevBuild' +
           $(if ($main) { ', and no main launcher is installed at ' + $main } else { '' }) +
           '. Or build dev from a folder of your own: .\scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root <folder> records it, ' +
           'Update-ShipRoot.ps1 makes it, and a dev Ship asks it for no Launcher folder'
  }
  return @(New-Row 'it has the Launcher folder a dev Ship asks for' $has $detail $fix)
}

# WHAT SHIP ASKS OF THE CHECKOUT, from the same answer Ship gets (#2981).
# Ship refuses, on both channels, unless Fresh-Checkout.ps1 says the checkout
# is exactly origin/main (or the pushed branch a dev Ship may come from) with
# nothing tracked changed. This map used to ask its own questions instead: on
# dev it skipped behind altogether and called an uncommitted change a note,
# saying a dev Ship builds from the working tree, which stopped being true
# when #2118 put the freshness gate in front of every Ship. So on 20 Oct
# it said READY on One's shared clone two minutes before Ship refused it for
# engine\skymp sitting behind main's pin. $State is Get-FreshCheckoutState's
# answer, asked with the -AnyBranch Ship would pass, so the row is a gap
# exactly when Ship would refuse, with the line that closes it.
function Get-CheckoutRows($State) {
  $rows = @()
  $rows += New-Row 'the checkout is current and clean, as Ship asks (Fresh-Checkout.ps1)' ([bool]$State.Ok) ([string]$State.Message) `
    $(if ($State.Ok) { $null } else { [string]$State.Fix })
  return $rows
}

# WHETHER THIS MACHINE SIGNS (issue #458). Ship refuses every release, dev and
# mods only included, when records\signing\signing.json is missing, disabled or names a
# profile that is not filled in (Get-SigningConfigRefusal, Assert-PublishSigned.ps1),
# and a launcher build stops at Sign-Artifact.ps1 when the dlib or metadata it
# names is not there or signtool is not installed. This map asked none of it,
# so a second machine found out at the end of a Ship. $Refuse is what
# Get-SigningConfigRefusal said ('' when it accepts), so this stays testable
# without dot-sourcing anything.
function Get-SigningRows([string]$ConfigPath, [string]$RepoRoot, [string]$Refuse, [string]$Signtool) {
  $setup = '.\scripts\release\Setup-ShipMachine.ps1     fetches the signing client and writes records\signing\signing.json from records\signing\signing.template.json'
  $rows = @()
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    $rows += New-Row 'this machine signs (records\signing\signing.json)' $false 'there is none' $setup
    return $rows
  }
  $rows += New-Row 'this machine signs (records\signing\signing.json)' (-not $Refuse) $Refuse $setup
  $missing = @()
  try {
    $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($k in 'dlib', 'metadata') {
      $v = ''
      if ($cfg.PSObject.Properties[$k]) { $v = [string]$cfg.$k }
      if ($v -and -not [IO.Path]::IsPathRooted($v)) { $v = Join-Path $RepoRoot $v }
      if (-not $v -or -not (Test-Path -LiteralPath $v)) { $missing += $k }
    }
  } catch { $missing += 'the file itself, which is not valid JSON' }
  $rows += New-Row 'the signing client and metadata it names are here' ($missing.Count -eq 0) $(if ($missing.Count) { 'missing: ' + ($missing -join ', ') } else { '' }) `
    'Move records\signing\signing.json aside and run .\scripts\release\Setup-ShipMachine.ps1, which writes one naming what this machine has'
  $rows += New-Row 'signtool, from the Windows SDK' ([bool]$Signtool) $Signtool 'winget install --id Microsoft.WindowsSDK.10.0.26100 -e'
  return $rows
}

Write-Host ''
Write-Host ("  THORNSWOOD  -  can this machine ship? (" + $Channel + " channel)") -ForegroundColor White

# ---------------------------------------------------------------- the repo --
Head 'This repository'
$isClone = Test-Path (Join-Path $RepoDir '.git')
Ready 'this is a git clone' $isClone $RepoDir 'git clone https://github.com/ThornswoodRP/Thornswood.git'

if ($isClone) {
  $branch = (& git -C $RepoDir rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  if ($Dev) {
    Say ("  note  a dev release may ship from any pushed branch. This is " + $branch + ".") 'DarkGray'
  } else {
    Ready 'on main' ($branch -eq 'main') ("on " + $branch) 'git checkout main' 'either'
  }
  # Behind, ahead, diverged and uncommitted, each a gap on both channels,
  # because Ship refuses each on both (Get-CheckoutRows above).
  $fresh = Get-FreshCheckoutState -RepoDir $RepoDir -AnyBranch:(Test-FreshAnyBranch -RepoDir $RepoDir -Channel $Channel)
  foreach ($r in @(Get-CheckoutRows $fresh)) { Show-Row $r }
}

# ------------------------------------------------------------ GitHub --
# No releases clone any more: the feed and its baseline are on the VPS (#907),
# checked under The VPS below. GitHub is still where the source is, and where a
# main Ship downloads the launcher CI built for its tag.
Head 'GitHub'
$ghOk = $false
$ghWho = ''
try {
  $st = & gh auth status 2>&1 | Out-String
  $ghOk = ($LASTEXITCODE -eq 0)
  $m = [regex]::Match($st, 'account\s+(\S+)')
  if ($m.Success) { $ghWho = $m.Groups[1].Value }
} catch { $ghOk = $false }
Ready 'signed in to GitHub' $ghOk $ghWho 'gh auth login'

# ------------------------------------------------------ the release folder --
Head 'The release folder'
# The folder Ship would build from (#1692): -Root, or what Where.ps1 answers.
$rootSaid = ''
$rootGiven = [bool]$Root
# Named: -Root, or what ship-roots.json records, as Ship tells them from the
# install rule's folder (#2662).
$rootNamed = $rootGiven
if (-not $Root) {
  try {
    $Root = [string](& (Join-Path $Here 'Where.ps1') $(if ($Dev) { 'ShipRootDev' } else { 'ShipRoot' }))
    $rootNamed = [bool][string](& (Join-Path $Here 'Where.ps1') $(if ($Dev) { 'ShipRootNamedDev' } else { 'ShipRootNamed' }))
  }
  catch { $rootSaid = $_.Exception.Message; $Root = '' }
}
# What the fix lines below add, so a command names the folder this checked
# when it is not the one the scripts find for themselves.
$rootArg = $(if ($rootGiven) { ' -Root "' + $Root + '"' } else { '' })
Ready 'which folder the release is built from is known' (-not $rootSaid) $(if ($rootSaid) { $rootSaid } else { $Root }) `
  ('.\scripts\release\Setup-ShipMachine.ps1 -Channel ' + $Channel + ' -Root <the release folder>   (writes the file Where.ps1 ShipRoots names)')
foreach ($r in @(Get-LauncherRows $Channel $Root $rootNamed)) { Show-Row $r }
# Ship refuses a folder Vortex deploys into before anything is built (#1692).
$vortexHere = [bool]($Root -and (Test-Path -LiteralPath (Join-Path $Root 'Game\Data\vortex.deployment.json')))
Ready 'it is not a folder Vortex deploys into' (-not $vortexHere) $(if ($vortexHere) { 'Game\Data\vortex.deployment.json is there' } else { '' }) `
  ('.\scripts\release\Setup-ShipMachine.ps1 -Channel ' + $Channel + ' -Root <the release folder, not Vortex''s>   (docs\COLLECTION-REVISION-2.md step 8)')

$GameDir = $(if ($Root) { Join-Path $Root 'Game' } else { '' })
$hasGame = [bool]($GameDir -and (Test-Path $GameDir))

# The collection this machine would build a release from.
#
# Asked here because this is the question that went unasked for a week: the
# server's load order and the reference plugin list are both derived from
# what Vortex has deployed here, and nothing checked whether that deployment
# was current. Vortex knew all along and wrote it in its own state.
try {
    # No config.json is the launcher's own collection (Get-CollectionSlug's
    # default). One that is there and does not read could name another, so
    # the revision is not asked of the default in its place.
    $colUrl = ''
    $colWhy = ''
    $colCfg = $(if ($Root) { Join-Path $Root 'config.json' } else { '' })
    if ($colCfg -and (Test-Path -LiteralPath $colCfg)) {
        try { $colUrl = [string](Get-Content -LiteralPath $colCfg -Raw | ConvertFrom-Json).CollectionUrl }
        catch { $colWhy = $_.Exception.Message }
    }
    $cs = $(if ($colWhy) { $null } else { Get-CollectionState $colUrl })
    if ($colWhy) {
        Say ('  note  ' + $colCfg + ' does not read (' + $colWhy + '), so which collection it names, and its revision, were not checked') 'Yellow'
    } elseif ($cs.Known) {
        Ready 'the collection here is the newest Vortex knows of' (-not $cs.Behind) `
            ("revision {0}, newest {1}" -f $cs.Have, $cs.Newest) `
            'Update the collection in Vortex, let it deploy, then Deploy-Gamemode and ship. A release built from a stale collection turns away everybody who installed the current one.' 'patrick'
    } else {
        Say '  note  could not read the collection revision from Vortex, so it was not checked' 'DarkGray'
    }
} catch { Say ('  note  the collection revision check did not run: ' + $_.Exception.Message) 'DarkGray' }
# Ship stops on this too (Assert-VortexProfile, #557): it reads the load order
# from the Vortex profile named Thornswood and no other.
$vpDir = $null
try { $vpDir = Get-VortexProfileDir 'Thornswood' } catch { $vpDir = $null }
Ready 'Vortex has a profile named Thornswood' ([bool]$vpDir) $(if ($vpDir) { $vpDir } else { '' }) `
  'In Vortex: Profiles, add one named Thornswood, switch to it, install the Thornswood collection and let it deploy'
# A ship root's launcher is never started (#2603), so the folder is made the
# way a Ship makes it first, by Update-ShipRoot.ps1. The animation and body
# files are not built there: no release carries them (#3715).
Ready 'it has its own game folder' $hasGame $(if ($hasGame) { $GameDir } else { $GameDir + ' is not there yet; a Ship makes it first' }) `
  ('.\scripts\release\Update-ShipRoot.ps1 -Channel ' + $Channel + $rootArg + '   makes it from what Vortex has deployed, as a Ship does first' +
   ' (add -SkyrimFrom <a folder holding Skyrim 1.6.1170''s own files> where the Steam copy is not on 1.6.1170)')

if ($hasGame) {
  $record = Join-Path $Root 'Profile\OwnGame\files.txt'
  $recLines = 0
  if (Test-Path -LiteralPath $record) { $recLines = @(Get-Content -LiteralPath $record).Count }
  Ready 'the record of what came from Vortex exists' ($recLines -gt 0) ("$recLines lines") `
    (".\scripts\release\Update-ShipRoot.ps1 -Channel $Channel$rootArg, which brings the folder up to date with what Vortex has deployed and writes the record")
}

# ------------------------------------------------------------- the compiler --
Head 'The build'
# The launcher and the ship root tool build with the .NET 10 SDK (#4823).
$sdk10 = ''
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
  $sdk10 = [string](@(& dotnet --list-sdks 2>$null | Where-Object { $_ -match '^10\.' }) | Select-Object -Last 1)
}
Ready 'the .NET 10 SDK is here' ([bool]$sdk10) $sdk10 `
  'winget install --id Microsoft.DotNet.SDK.10 -e   (docs/guide/set-up-a-machine.md "Setting up a machine" has the C++ build tools Native AOT needs)'

$node = $null
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nodeCmd) { $node = $nodeCmd.Source }
Ready 'node is on the path' ($null -ne $node) $(if ($node) { (& node --version 2>$null) } else { '' }) `
  'Install Node from nodejs.org; the gamemode and the site are checked with it, and Ship refuses a game folder without it because SkyUI''s menus are read with it (#1913)'

# ------------------------------------------------------------- the signing --
Head 'Signing'
$signCfg = Join-Path $RepoDir 'records\signing\signing.json'
$signRefuse = ''
if (Test-Path -LiteralPath $signCfg) { $signRefuse = Get-SigningConfigRefusal -ConfigPath $signCfg -RepoRoot $RepoDir }
$signtool = ''
foreach ($sr in @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")) {
  if ($signtool -or -not (Test-Path -LiteralPath $sr)) { continue }
  $st = Get-ChildItem -LiteralPath $sr -Recurse -Filter 'signtool.exe' -EA SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if ($st) { $signtool = $st.FullName }
}
foreach ($r in @(Get-SigningRows $signCfg $RepoDir $signRefuse $signtool)) { Show-Row $r }
Say '  note  the Azure sign in behind it is asked by .\scripts\release\Setup-ShipMachine.ps1 -Check' 'DarkGray'

# ------------------------------------------------------------- the plugins --
Head 'The game plugins'
if ($hasGame) {
  $plugSrc = Join-Path $Here '..\..\game\plugins'
  $plugDst = Join-Path $GameDir 'Data\Platform\Plugins'
  $seen = 0; $stale = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $plugSrc -Filter '*.js' -File -EA SilentlyContinue)) {
    $seen++
    $dst = Join-Path $plugDst $f.Name
    if (-not (Test-Path -LiteralPath $dst)) { $stale += ($f.Name + ' never arrived'); continue }
    $a = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($a -ne $b) { $stale += ($f.Name + ' in the game folder is not this source') }
  }
  Ready 'game\plugins has plugins to ship' ($seen -gt 0) "$seen file(s)" 'Nothing to do; the repo is missing its plugins'
  # A note, not a gap (issue #946): Ship runs Go.ps1, which copies the plugins
  # in, before it checks them, so a stale copy here does not stop a Ship.
  if ($stale.Count) {
    Say ('  note  ' + $stale[0] + $(if ($stale.Count -gt 1) { ' (and ' + ($stale.Count - 1) + ' more)' } else { '' }) + '. Ship copies the plugins in first (Go.ps1).') 'DarkGray'
  } else {
    Say ("  note  the game folder holds this source ($seen match)") 'DarkGray'
  }
} else {
  Say '  skip  no own game folder, so there is nothing to compare the plugins against' 'DarkGray'
}

# -------------------------------------------------------- required data --
Head 'Required data'
$reqSrc = Join-Path $Here '..\..\game\required-data'
$reqFiles = @()
if (Test-Path -LiteralPath $reqSrc) {
  $reqFiles = @(Get-ChildItem -LiteralPath $reqSrc -File -EA SilentlyContinue | Where-Object { $_.Name -ne 'README.md' })
}
# Empty is the usual case: a file is here only while the collection does not
# deploy it under the name the load order uses (#690 took the last one out).
Ready 'game\required-data is in the repo' (Test-Path -LiteralPath $reqSrc) ("$($reqFiles.Count) plugin(s) to place") `
  'Nothing to do; the repo is missing its game\required-data folder'
if ($hasGame -and $reqFiles.Count -gt 0) {
  $stale = @()
  foreach ($f in $reqFiles) {
    $dst = Join-Path $GameDir ('Data\' + $f.Name)
    if (-not (Test-Path -LiteralPath $dst)) { $stale += ($f.Name + ' never arrived'); continue }
    $a = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($a -ne $b) { $stale += ($f.Name + ' in the game folder is not this source') }
  }
  # A note for the same reason as the plugins: Go.ps1 copies these in first.
  if ($stale.Count) {
    Say ('  note  ' + $stale[0] + '. Ship copies game\required-data in first (Go.ps1).') 'DarkGray'
  } else {
    Say ("  note  the game folder holds required-data ($($reqFiles.Count) match)") 'DarkGray'
  }
} elseif (-not $hasGame) {
  Say '  skip  no own game folder, so there is nothing to compare required-data against' 'DarkGray'
}

# -------------------------------------------------------- the client build --
Head 'The client runtime'
$where = Join-Path $Here 'Where.ps1'
$clientDist = (& $where ClientDist)
# CI's build of the pin, when it is the one this machine reads and is not
# here yet: whether GitHub keeps it for the Ship to fetch (#3047). Read only.
$ci = $null
$ciDist = ''
try { $ciDist = Join-Path ([string](& $where EngineArtifact)) 'build\dist\client' } catch { $ciDist = '' }
if ($hasGame -and $ciDist -and ([IO.Path]::GetFullPath($clientDist).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($ciDist).TrimEnd('\', '/')) -and -not (Test-Path -LiteralPath $clientDist)) {
  $global:LASTEXITCODE = 0
  $chunks = & (Join-Path $Here 'Get-EngineArtifact.ps1') -Check -NoPause 6>&1 2>&1
  $ciCode = $global:LASTEXITCODE
  $ciText = @(foreach ($o in @($chunks)) { if ($o -is [System.Management.Automation.InformationRecord]) { [string]$o.MessageData } else { [string]$o } }) -join [Environment]::NewLine
  $ciStop = [regex]::Match($ciText, '(?m)^STOP\. (.+)$')
  $ci = [pscustomobject]@{ Code = $ciCode; Said = $(if ($ciStop.Success) { $ciStop.Groups[1].Value.Trim() } else { 'Get-EngineArtifact -Check exit ' + $ciCode }) }
}
foreach ($r in @(Get-ClientRows (Join-Path $Here 'Sync-Client.ps1') (Join-Path $Here '..\..\records\client-build.json') `
                   $(if ($hasGame) { $GameDir } else { '' }) $clientDist $ci)) { Show-Row $r }
if (-not $hasGame) {
  Say '  skip  no own game folder, so the client in it was not checked' 'DarkGray'
}

# The fork itself is a note, never a gap: a Ship does not build the engine.
$fork = (& $where Engine)
if (Test-Path -LiteralPath (Join-Path $fork '.git')) {
  $forkBranch = (& git -C $fork rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  Say ('  note  the skymp fork is at ' + $fork + ', on ' + $forkBranch + '. A Ship does not build it.') 'DarkGray'
} else {
  Say '  note  no clone of the skymp fork here. A Ship does not build the engine, so it is not needed;' 'DarkGray'
  Say '        only an engine change is, and its build is CI''s (engine\README.md, The engine built in CI).' 'DarkGray'
}

# ------------------------------------------------ what only main asks for --
if (-not $Dev) {
  Head 'For the live deploys'
  foreach ($r in @(Get-MainOnlyRows $Channel `
                     (Join-Path $RepoDir 'records\server-build.json') `
                     @((& $where ServerDist), (& $where Payload)))) { Show-Row $r }
}

# ---------------------------------------------------------------- the VPS ---
Head 'The VPS'
if ($NoVps) {
  Say '  skip  -NoVps was given' 'DarkGray'
} else {
  $sshOk = $false
  try {
    $out = Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$(Get-ThornswoodVpsUser)@$($script:VpsAddress)" 'echo THORNSWOOD_OK' } 2>&1 | Out-String
    $sshOk = ($out -match 'THORNSWOOD_OK')
  } catch { $sshOk = $false }
  Ready 'ssh to the VPS works without a password' $sshOk $script:VpsAddress `
    '.\scripts\vps\Setup-SshKey.ps1        then Patrick runs .\scripts\vps\Grant-BoxAccess.ps1 with the line it prints (BOX-ACCESS.md in the ops repo)' 'either'
  Say '  note  a Ship needs ssh: the feed, its baseline and every download go to the VPS (#897, #907).' 'DarkGray'
  # The feed store beside the feed the site serves (Feed-Store.ps1, #907).
  # Read only: asks what is there, sends nothing.
  if ($sshOk) {
    $storeOk = $false; $storeSaid = ''
    try {
      $there = Get-FeedStoreThere $Channel
      $storeOk = [bool]$there['version.json'] -and [bool]$there['published.json']
      $storeSaid = $(if ($storeOk) { 'version.json and published.json' } else { 'missing ' + ((@('version.json', 'published.json') | Where-Object { -not $there[$_] }) -join ' and ') })
    } catch { $storeSaid = $_.Exception.Message }
    Ready ("the $Channel feed and its baseline are on the VPS") $storeOk $storeSaid `
      'scripts\oneoff\Move-FeedStore-ToVps.ps1 put them there once; if one is gone, Patrick looks at C:\Thornswood-Docs\feed on the VPS' 'patrick'
  }
}

# --------------------------------------------------------------- the verdict --
Write-Host ''
Write-Host ('  ' + ('=' * 68)) -ForegroundColor DarkGray
$verdict = Get-ShipVerdict $script:rows
if ($verdict.Ready) {
  Say ("  READY. {0} checks passed. This machine can run a {1} release." -f $verdict.Passed, $Channel) 'Green'
  Write-Host ''
  if ($Dev) {
    Say '      .\scripts\release\Ship.ps1 -Channel dev "what changed"' 'White'
    Say '  There is one dev feed, and the last dev Ship wins.' 'DarkGray'
  } else {
    Say '      .\scripts\release\Ship.ps1 "what changed"' 'White'
    Say '  That publishes to everybody. Only run it from main, with the pull done.' 'DarkGray'
  }
} else {
  Say ("  NOT READY. {0} passed, {1} in the way." -f $verdict.Passed, $verdict.Gaps.Count) 'Red'
  Write-Host ''
  $i = 0
  foreach ($g in $verdict.Gaps) {
    $i++
    Say ("  {0}. {1}" -f $i, $g.What) 'Yellow'
    if ($g.Fix) {
      $tag = if ($g.Who -eq 'patrick') { '   (Patrick runs this one)' } else { '' }
      Say ("       " + $g.Fix + $tag) 'White'
    }
  }
}
if ($verdict.Warns.Count) {
  Write-Host ''
  Say '  Not in the way of the Ship itself, but worth putting right first:' 'Yellow'
  foreach ($w in $verdict.Warns) {
    Say ('  -  ' + $w.What) 'Yellow'
    if ($w.Fix) { Say ('       ' + $w.Fix) 'White' }
  }
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if (-not $verdict.Ready) { exit 1 }
