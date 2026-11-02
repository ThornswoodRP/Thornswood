<#
.SYNOPSIS
  Checks and prepares a Windows machine to Ship dev, and says what is left
  for a person to do.

.DESCRIPTION
  WHY IT EXISTS. Issue #458, "If One dies, the release process does not
  survive". Since #907 the feed and the Ship baseline live on the VPS and the
  release webhooks are read from there too, so most of what a Ship needs is
  already off Patrick's machine (One). What was still only on One, measured on
  29 September: the signing setup (records\signing\signing.json, which names a metadata
  file outside the repository, Microsoft's signing client, and the az sign in
  behind it) and the client runtime build the record names. No copy of the
  recorded client sat anywhere on One but the dev game folder; the site's feed
  had the only other one.

  This does the parts a script can do and names the rest:

    1. The tools a Ship calls: git, gh signed in, PowerShell 7, node, ssh,
       the .NET Framework 4 compiler, signtool from the Windows SDK, az, and
       the .NET 8 runtime Microsoft's signing client runs on.
    2. Microsoft's signing client in records\signing\client. When it is not
       there it is fetched from nuget.org at the version pinned below and
       refused unless its sha256 is the pinned one.
    3. records\signing\signing.json. When there is none it is written from
       records\signing\signing.template.json, which holds paths and "enabled": true, no key. An
       existing one is never changed: it is read, and anything wrong with it
       is said.
    4. The az sign in. Each person who ships signs in as themselves, with an
       account of their own in the signing tenant that holds the Certificate
       Profile Signer role on the ThornswoodRelease profile, which Patrick
       makes once (docs/guide/set-up-a-machine.md "Your own signing sign in"; Patrick,
       4 Oct, #1740; until then only his account signed, #1121). A device
       code sign in is refused by the tenant (AADSTS530035). It asks the signing service, with this
       machine's sign in, what identity the profile carries, and checks it is
       the one the launcher pins (launcher\app\Signature.cs). A sign in that
       cannot reach the profile says so here instead of at the end of a Ship.
    5. The client runtime records\client-build.json names. On a machine
       that takes CI's engine build (below), Get-EngineArtifact.ps1 fetches
       the fork's own build of the pin and holds every file to the records.
       Otherwise, when neither the game folder nor the build folder holds
       it, the zip of that exact commit is fetched from the site's feed (the
       clientRuntime entry in /feed-dev/version.json or /feed/version.json),
       checked against the feed's sha256 and size, unpacked, and each of the
       six files checked against the record's sha256 before anything is put
       in the build folder. A build made here is never offered: a rebuild is
       not the same bytes, so it cannot match a record CI made (#3047).
    6. Then Check-ShipReady.ps1 for the channel, which asks every other
       question Ship asks (the dev build, its game folder, the Vortex profile,
       the VPS and the feed store) and gives the verdict.

  WHICH FOLDER A RELEASE IS BUILT FROM (#1692). -Root records the folder
  this machine builds the channel's release from, in the file Where.ps1
  ShipRoots names (this machine's own data, beside its copies of the feeds),
  and Ship, Check-ShipReady, this and Build-Generated read it back through
  Where.ps1 ShipRoot and ShipRootDev. Needed where that is not the launcher
  install (main) or the install with -DevBuild on the end (dev): on a machine
  whose Vortex deploys into C:\Thornswood-DevBuild, the dev release folder is
  another one (docs\COLLECTION-REVISION-2.md step 8). A folder Vortex
  deploys into is never recorded. Since #2019 the folder is then made, or
  brought up to date, by Update-ShipRoot.ps1, the step every Ship runs
  first: the launcher's own OwnGame makes its game folder from Vortex's
  deployment (a new root takes Thornswood's own files of the channel's
  release from its feed, as an install does), and the recorded client goes
  in from the engine build. So a main root of its own, such as
  local\release-main in the repository, is one command, and no main Ship
  packs C:\Thornswood, the install Patrick plays from. A new root takes the
  game's own files from the Steam copy when it is on 1.6.1170; on a machine
  whose Steam copy is not, -SkyrimFrom names a folder that holds them, such
  as the other channel's root's Game (#2603).

  WHICH ENGINE BUILD (#2019). -EngineBuild records the fork folder whose
  build\dist is this machine's engine build, in the file Where.ps1
  EngineBuilds names, beside ShipRoots. Where.ps1 ClientDist, ServerDist,
  ServerSettings and ChangeForms are then under it for every clone and
  worktree, instead of each checkout's own engine\skymp\build, which on
  15 October was a stale 12 October build in the worktree a dev Ship ran
  from (engine\README.md "One engine": each engine change is built in a
  worktree of the fork). A folder with no build\dist in it is not recorded.

  CI'S ENGINE BUILD (#3047). -EngineBuild ci records {"ci": true} instead:
  the engine build is then CI's build of the pin, the fork's own build,
  which Get-EngineArtifact.ps1 puts in a folder named for the commit
  (Where.ps1 EngineArtifact) after holding every file to the records. It is
  the only build that matches a record CI made, and a pin move needs a fetch,
  not a build, so it is what a Ship machine takes. A machine that records no
  engine build and has none in its checkout is given it without asking: a
  build of its own could not match the record either.

  WHAT IT NEVER DOES. It writes no secret anywhere, never turns signing off
  or writes "enabled": false, never edits an existing records\signing\signing.json,
  never ships, publishes or deploys, and does not sign anything. The only
  files it writes are the signing client under records\signing\client, a new
  records\signing\signing.json, the six client files in the build folder
  (Where.ps1 ClientDist), and its downloads under out\ship-machine, all
  ignored by git, with -Root the file Where.ps1 ShipRoots names, outside
  the repository, and the root's own folder (Update-ShipRoot.ps1), and with
  -EngineBuild the file Where.ps1 EngineBuilds names, beside it.

  Any developer may run a main Ship from a machine that can sign
  (Developer-Guide.md): -Channel main checks that machine.

.PARAMETER Channel
  dev (the default) or main: which channel Check-ShipReady asks about, and
  which game folder the client is checked in (the channel's release folder,
  Where.ps1 ShipRoot or ShipRootDev, and its Game).

.PARAMETER Root
  The folder this machine builds the channel's release from, recorded for
  Ship, Check-ShipReady and Build-Generated to read (see WHICH FOLDER), then
  made or brought up to date by Update-ShipRoot.ps1. With -Check it is only
  used, not recorded, and only asked whether it is current.

.PARAMETER EngineBuild
  ci for CI's build of the pin (see CI'S ENGINE BUILD), or the fork folder
  whose build\dist is this machine's engine build (see WHICH ENGINE BUILD),
  recorded for Where.ps1. With -Check it is only shown.

.PARAMETER SkyrimFrom
  With -Root, for a root that has no game folder yet: the folder Skyrim
  1.6.1170's own files are copied from instead of the Steam copy, passed to
  Update-ShipRoot.ps1 (#2603). Every file the new folder takes is checked
  against records\skyrim-files.json first, and the root is not made when
  one is not the build's. A root that is made already does not use it.

.PARAMETER Check
  Report only. Nothing is fetched or written; each step says what it would do.

.PARAMETER NoVps
  Passed to Check-ShipReady.ps1, which then skips the two questions that ask
  the VPS over ssh.

.PARAMETER NoPause
  Exits without waiting for Enter.

.PARAMETER Site
  Where the feeds are read from. https://thornswood.net unless a harness says
  otherwise.

.EXAMPLE
  .\scripts\release\Setup-ShipMachine.ps1 -Check
  Says what this machine has and what it would fetch or write, and changes
  nothing.

.EXAMPLE
  .\scripts\release\Setup-ShipMachine.ps1
  Prepares what it can for a dev Ship, then runs Check-ShipReady -Channel dev.

.EXAMPLE
  .\scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root C:\Thornswood-Repo\local\release-devbuild
  The same, and records that a dev release on this machine is built from
  local\release-devbuild in the repository, One's dev release folder since
  5 October. Give the whole path: it is recorded for every clone and
  worktree.

.EXAMPLE
  .\scripts\release\Setup-ShipMachine.ps1 -Channel main -Root C:\Thornswood-Repo\local\release-main -EngineBuild ci
  Gives main a release folder of its own, made by Update-ShipRoot.ps1 from
  Vortex's deployment and the main feed's release, and records CI's build of
  the pin as this machine's engine build (#3047), fetched now.

.EXAMPLE
  .\scripts\release\Setup-ShipMachine.ps1 -Channel main -Root C:\Thornswood-Repo\local\release-main -SkyrimFrom C:\Thornswood-Repo\local\release-devbuild\Game
  The same on a machine whose Steam copy is not on 1.6.1170, as One's is
  not since 16 Oct: the game's own files are copied from the dev root's
  Game, each checked against records\skyrim-files.json first (#2603).
#>
[CmdletBinding()]
param(
  [ValidateSet('dev', 'main')]
  [string]$Channel = 'dev',
  [switch]$Check,
  [switch]$NoVps,
  [switch]$NoPause,
  [string]$Site = 'https://thornswood.net',
  [string]$Root = '',
  [string]$EngineBuild = '',
  [string]$SkyrimFrom = ''
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)

# ------------------------------------------------------------ the helpers --
# tests\test-ship-machine.ps1 lifts these out of the script and runs them.

# Microsoft's signing client, pinned. The sha256 is the one nuget.org served
# for this version on 29 September 2026, and the same bytes One signs with.
# A new version is a deliberate change: move the three together.
function Get-SigningClientPin {
  return [pscustomobject]@{
    Id      = 'Microsoft.ArtifactSigning.Client'
    Version = '1.0.128'
    Sha256  = '74bd7d27e6ce1051409c38d9b46bc8df0400ecd643d51ffbf2ac00869061e40b'
    Url     = 'https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.128/microsoft.artifactsigning.client.1.0.128.nupkg'
  }
}

function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# The default way a file is fetched. The harness passes its own.
function Save-Url([string]$Url, [string]$Path) {
  $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
  try { Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing -TimeoutSec 600 }
  finally { $ProgressPreference = $old }
}

# The signing client's dlib under records\signing\client, x64, as a path
# relative to the repository, or ''. Any layout: nuget.exe's (client\client\
# <id>\bin\x64, what One has) and this script's (<id>\bin\x64) both count.
function Find-SigningDlib([string]$Repo) {
  $top = Join-Path $Repo 'records\signing\client'
  if (-not (Test-Path -LiteralPath $top)) { return '' }
  $hit = @(Get-ChildItem -LiteralPath $top -Recurse -File -Filter 'Azure.CodeSigning.Dlib.dll' -EA SilentlyContinue |
           Where-Object { $_.FullName -match '[\\/]x64[\\/]' } | Sort-Object FullName) | Select-Object -First 1
  if (-not $hit) { return '' }
  # Named relative to the repository with \, as signing.json names it, on any
  # machine: off Windows the found path is written with / (#2989).
  $sep = [string][IO.Path]::DirectorySeparatorChar
  return $hit.FullName.Substring($Repo.TrimEnd($sep).Length).TrimStart($sep).Replace($sep, '\')
}

# Fetches the pinned signing client and unpacks it into
# records\signing\client\<id>. '' when it is there, else why not. Nothing is
# unpacked unless the package is the pinned bytes.
function Save-SigningClient([string]$Repo, $Pin, [scriptblock]$Fetch, [string]$Work) {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  $pkg = Join-Path $Work ($Pin.Id + '.' + $Pin.Version + '.nupkg')
  if (Test-Path -LiteralPath $pkg) { Remove-Item -LiteralPath $pkg -Force }
  try { & $Fetch $Pin.Url $pkg } catch { return ('the signing client could not be fetched from ' + $Pin.Url + ': ' + $_.Exception.Message) }
  if (-not (Test-Path -LiteralPath $pkg)) { return ('nothing came back from ' + $Pin.Url) }
  $have = Get-Sha256 $pkg
  if ($have -ne $Pin.Sha256) {
    Remove-Item -LiteralPath $pkg -Force -EA SilentlyContinue
    return ('the signing client from nuget.org is not the pinned one (sha256 ' + $have + ', pinned ' + $Pin.Sha256 + '). Nothing was unpacked.')
  }
  $dest = Join-Path $Repo ('records\signing\client\' + $Pin.Id)
  $stage = $dest + '.part'
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($pkg, $stage)
  if (-not (Test-Path -LiteralPath (Join-Path $stage 'bin\x64\Azure.CodeSigning.Dlib.dll'))) {
    Remove-Item -LiteralPath $stage -Recurse -Force -EA SilentlyContinue
    return 'the signing client has no bin\x64\Azure.CodeSigning.Dlib.dll in it. Nothing was put in place.'
  }
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  Move-Item -LiteralPath $stage -Destination $dest
  return ''
}

# Writes records\signing\signing.json from the template when there is none. Never
# touches one that exists, and never writes one that turns signing off: a
# template whose "enabled" is anything but true is refused. The key is there
# at all because Ship runs under Set-StrictMode -Version Latest, where
# Assert-PublishSigned.ps1 and Sign-Artifact.ps1 reading a missing "enabled"
# throws (measured 29 Sep). $DlibRel, when given, replaces the template's dlib
# so the file names the client this machine actually has.
function New-SigningConfig([string]$Template, [string]$Target, [string]$DlibRel) {
  if (Test-Path -LiteralPath $Target) { return [pscustomobject]@{ Wrote = $false; Why = 'there is one already, left as it is' } }
  if (-not (Test-Path -LiteralPath $Template)) { return [pscustomobject]@{ Wrote = $false; Why = ('the template is missing: ' + $Template) } }
  $cfg = Get-Content -LiteralPath $Template -Raw | ConvertFrom-Json
  $keys = @($cfg.PSObject.Properties.Name | Sort-Object)
  if (($keys -join ',') -ne 'dlib,enabled,metadata,method,timestampUrl') {
    return [pscustomobject]@{ Wrote = $false; Why = ('the template has keys it should not, or lacks one: ' + ($keys -join ', ')) }
  }
  if ($cfg.enabled -ne $true) {
    return [pscustomobject]@{ Wrote = $false; Why = 'the template turns signing off; a signing.json from it would be refused by Ship' }
  }
  if ($DlibRel) { $cfg.dlib = $DlibRel }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  $json = $cfg | ConvertTo-Json
  [IO.File]::WriteAllText($Target, $json + "`r`n", (New-Object Text.UTF8Encoding($false)))
  return [pscustomobject]@{ Wrote = $true; Why = '' }
}

# The dlib and metadata a signing.json names, resolved the way Sign-Artifact
# resolves them (relative means the repository's). Returns the ones missing.
function Get-SigningPathsMissing([string]$ConfigPath, [string]$Repo) {
  $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $missing = @()
  foreach ($k in 'dlib', 'metadata') {
    $v = ''
    if ($cfg.PSObject.Properties[$k]) { $v = [string]$cfg.$k }
    if (-not $v) { $missing += ($k + ' is not named'); continue }
    if (-not [IO.Path]::IsPathRooted($v)) { $v = Join-Path $Repo $v }
    if (-not (Test-Path -LiteralPath $v)) { $missing += ($k + ' ' + $v) }
  }
  return $missing
}

# The durable identities the launcher accepts, read out of Signature.cs.
function Get-SignatureIdentities([string]$SignatureCs) {
  if (-not (Test-Path -LiteralPath $SignatureCs)) { return @() }
  $sig = [IO.File]::ReadAllText($SignatureCs)
  $block = [regex]::Match($sig, 'Identities\s*=\s*\{([^}]*)\}').Groups[1].Value
  return @([regex]::Matches($block, '"([0-9.]+)"') | ForEach-Object { $_.Groups[1].Value })
}

# Asks the signing service, with this machine's az sign in, which identity
# the profile carries. The token stays in memory and is never printed.
function Test-SigningReach([string]$MetadataPath, [string[]]$Identities) {
  $az = Get-Command az -EA SilentlyContinue
  if (-not $az) { return [pscustomobject]@{ Ok = $false; Why = 'az is not on this machine' } }
  $meta = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & $az.Source account get-access-token --resource https://codesigning.azure.net --query accessToken -o tsv 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  $t = ('' + (@($out) | Select-Object -Last 1)).Trim()
  $out = $null
  if ($code -ne 0 -or $t -notmatch '^ey') { return [pscustomobject]@{ Ok = $false; Why = 'az has no Azure sign in on this machine' } }
  $url = ([string]$meta.Endpoint).TrimEnd('/') + '/codesigningaccounts/' + $meta.CodeSigningAccountName +
         '/certificateprofiles/' + $meta.CertificateProfileName + '/sign/eku?api-version=2022-06-15-preview'
  $status = 0; $body = ''
  try {
    $r = Invoke-WebRequest -Uri $url -Headers @{ Authorization = ('Bearer ' + $t); Accept = 'application/json' } -UseBasicParsing -TimeoutSec 30
    $status = [int]$r.StatusCode; $body = [string]$r.Content
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { try { $status = [int]$resp.StatusCode } catch { $status = 0 } }
    if (-not $status) { $t = $null; return [pscustomobject]@{ Ok = $false; Why = ('the signing service could not be reached: ' + $_.Exception.Message) } }
  }
  $t = $null
  if ($status -eq 200) {
    # An answer that is not the list of identities is not "answered without
    # the identity": it says so, and why it did not read (#2711).
    $ekus = @()
    try { $ekus = @($body | ConvertFrom-Json) }
    catch { return [pscustomobject]@{ Ok = $false; Why = ('profile ' + $meta.CertificateProfileName + ' answered HTTP 200 with something that is not a list of identities: ' + $_.Exception.Message) } }
    if (@($ekus | Where-Object { $Identities -contains $_ }).Count) {
      return [pscustomobject]@{ Ok = $true; Why = ('profile ' + $meta.CertificateProfileName + ' answers this sign in with the identity the launcher pins') }
    }
    return [pscustomobject]@{ Ok = $false; Why = ('profile ' + $meta.CertificateProfileName + ' answered without the identity the launcher pins, so every installed launcher would refuse what it signs') }
  }
  if ($status -eq 401 -or $status -eq 403) {
    return [pscustomobject]@{ Ok = $false; Why = ('the signing service refused this sign in (HTTP ' + $status + '): it has no signer role on profile ' + $meta.CertificateProfileName + '. Patrick gives the role to an account of your own once (docs/guide/set-up-a-machine.md, Your own signing sign in)') }
  }
  return [pscustomobject]@{ Ok = $false; Why = ('the signing service answered HTTP ' + $status) }
}

# The clientRuntime entry, on any of the feeds given, whose forkCommit is the
# record's. $Feeds is a list of @{ Name; Doc }. $null when no feed has it.
function Find-ClientRuntime($Feeds, [string]$Commit) {
  if (-not $Commit) { return $null }
  foreach ($f in @($Feeds)) {
    if ($null -eq $f -or $null -eq $f.Doc) { continue }
    $d = $f.Doc
    if (-not $d.PSObject.Properties['clientRuntime'] -or $null -eq $d.clientRuntime) { continue }
    $c = $d.clientRuntime
    $fc = ''; if ($c.PSObject.Properties['forkCommit']) { $fc = [string]$c.forkCommit }
    if ($fc -ne $Commit) { continue }
    $u = ''; if ($c.PSObject.Properties['url']) { $u = [string]$c.url }
    $s = ''; if ($c.PSObject.Properties['sha256']) { $s = ([string]$c.sha256).ToLowerInvariant() }
    $b = [long]0; if ($c.PSObject.Properties['bytes']) { $b = [long]$c.bytes }
    if (-not $u -or $s -notmatch '^[0-9a-f]{64}$') { continue }
    return [pscustomobject]@{ Feed = $f.Name; Url = $u; Sha256 = $s; Bytes = $b; Commit = $fc }
  }
  return $null
}

# How many of the record's files a folder holds as recorded.
function Get-ClientMatch([string]$Record, [string]$Folder) {
  $rec = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $Record -Raw) $Record
  $n = 0
  if (-not $Folder -or -not (Test-Path -LiteralPath $Folder)) { return 0 }
  foreach ($p in $rec.files.PSObject.Properties) {
    $f = Join-Path $Folder $p.Name
    if ((Test-Path -LiteralPath $f) -and ((Get-Sha256 $f) -eq ([string]$p.Value.sha256).ToLowerInvariant())) { $n++ }
  }
  return $n
}

# Unpacks a client runtime zip and puts the record's files in $Dist. '' when
# they are all there as recorded, else why not. Checked twice: the zip against
# the feed's sha256 and size, then each file against the record. Nothing goes
# into $Dist unless every file passed, so a half placed build is not a state
# this can leave behind.
function Install-ClientRuntime([string]$Zip, [string]$Sha256, [long]$Bytes, [string]$Record, [string]$Dist, [string]$Stage) {
  if (-not (Test-Path -LiteralPath $Zip)) { return ('no zip at ' + $Zip) }
  $have = Get-Sha256 $Zip
  if ($have -ne $Sha256.ToLowerInvariant()) { return ('the zip is not the one the feed names (sha256 ' + $have + ', the feed says ' + $Sha256 + '). Nothing was put in place.') }
  if ($Bytes -gt 0 -and (Get-Item -LiteralPath $Zip).Length -ne $Bytes) { return 'the zip is not the size the feed names. Nothing was put in place.' }
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Stage)
  $rec = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $Record -Raw) $Record
  $plan = @()
  try {
    foreach ($p in $rec.files.PSObject.Properties) {
      $src = Join-Path $Stage $p.Name
      if (-not (Test-Path -LiteralPath $src)) { return ('the zip has no ' + $p.Name + '. Nothing was put in place.') }
      $h = Get-Sha256 $src
      if ($h -ne ([string]$p.Value.sha256).ToLowerInvariant()) { return ($p.Name + ' in the zip is not the recorded build (sha256 ' + $h + '). Nothing was put in place.') }
      $plan += [pscustomobject]@{ Src = $src; Dst = (Join-Path $Dist $p.Name); Want = ([string]$p.Value.sha256).ToLowerInvariant(); Rel = $p.Name }
    }
    foreach ($x in $plan) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $x.Dst) | Out-Null
      Copy-Item -LiteralPath $x.Src -Destination $x.Dst -Force
      if ((Get-Sha256 $x.Dst) -ne $x.Want) { return ('the copy of ' + $x.Rel + ' in ' + $Dist + ' does not hash as the record; the folder may be in use') }
    }
  } finally {
    Remove-Item -LiteralPath $Stage -Recurse -Force -EA SilentlyContinue
  }
  return ''
}

# Records $Root as the folder a $Channel release is built from, in $File (the
# one Where.ps1 ShipRoots names, #1692), keeping what it says for the other
# channel. A file that does not read as JSON is left as it is and throws.
function Save-ShipRoot([string]$File, [string]$Channel, [string]$Root) {
  $rec = [ordered]@{}
  if (Test-Path -LiteralPath $File) {
    $old = $null
    try { $old = [IO.File]::ReadAllText($File) | ConvertFrom-Json } catch { $old = $null }
    if ($null -eq $old) { throw ($File + ' does not read as JSON, so it was left as it is. Fix it or delete it, then run this again.') }
    foreach ($p in @($old.PSObject.Properties)) { $rec[$p.Name] = $p.Value }
  }
  $rec[$Channel] = $Root
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $File) | Out-Null
  [IO.File]::WriteAllText($File, (ConvertTo-Json -InputObject $rec), (New-Object Text.UTF8Encoding($false)))
}

# Records $Fork as this machine's engine build, in $File (the one Where.ps1
# EngineBuilds names, #2019): ci for CI's build of the pin (#3047), else a
# fork folder. '' when it was written, else why not: a fork folder with no
# build\dist in it is not an engine build, and recording it would only move
# the stop to the next script that reads it.
function Save-EngineBuild([string]$File, [string]$Fork) {
  if ($Fork -eq 'ci') { $rec = [ordered]@{ ci = $true } }
  elseif (-not (Test-Path -LiteralPath (Join-Path $Fork 'build\dist'))) {
    return ($Fork + ' has no build\dist in it, so it is not an engine build. Record CI''s build of the pin instead, the one the records name: -EngineBuild ci (engine\README.md, A Ship machine takes CI''s build).')
  }
  else { $rec = [ordered]@{ fork = $Fork } }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $File) | Out-Null
  [IO.File]::WriteAllText($File, (ConvertTo-Json -InputObject $rec), (New-Object Text.UTF8Encoding($false)))
  return ''
}

# Whether $File (Where.ps1 EngineBuilds) records CI's build of the pin (#3047).
function Test-EngineBuildIsCi([string]$File) {
  if (-not (Test-Path -LiteralPath $File)) { return $false }
  $rec = $null
  try { $rec = [IO.File]::ReadAllText($File) | ConvertFrom-Json } catch { return $false }
  $p = $rec.PSObject.Properties['ci']
  return ($null -ne $p -and $p.Value -eq $true)
}

# signtool the way Sign-Artifact.ps1 looks for it: newest x64 in the SDK.
function Find-Signtool {
  foreach ($r in @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    $f = Get-ChildItem -LiteralPath $r -Recurse -Filter 'signtool.exe' -EA SilentlyContinue |
         Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  $c = Get-Command signtool.exe -EA SilentlyContinue
  if ($c) { return $c.Source }
  return ''
}

# ---------------------------------------------------------------- the run --
$script:gaps = New-Object Collections.Generic.List[object]
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Row([string]$what, [bool]$ok, [string]$detail, [string]$fix, [string]$who = 'you') {
  $tail = $(if ($detail) { '  (' + $detail + ')' } else { '' })
  if ($ok) { Say ('  yes   ' + $what + $tail) 'Green' }
  else {
    Say ('  NO    ' + $what + $tail) 'Red'
    $script:gaps.Add([pscustomobject]@{ What = $what; Fix = $fix; Who = $who })
  }
}
function Plan([string]$what) { Say ('  would ' + $what) 'Yellow' }

Write-Host ''
Write-Host ('  THORNSWOOD  -  get this machine ready to Ship (' + $Channel + ' channel)' + $(if ($Check) { ', checking only' } else { '' })) -ForegroundColor White
if ($Channel -eq 'main') {
  Say '  A main Ship is any developer''s, from a machine that can sign (Developer-Guide.md). This checks that machine.' 'Yellow'
}

$Work = Join-Path (& (Join-Path $Here 'Where.ps1') Out) 'ship-machine'

# ------------------------------------------------------- the engine build --
# See WHICH ENGINE BUILD above (#2019). First, because the client steps
# below read Where.ps1 ClientDist, which is under it.
Head 'The engine build this machine uses'
$engineFile = & (Join-Path $Here 'Where.ps1') EngineBuilds
# A machine that records none and has no build in its checkout takes CI's
# (CI'S ENGINE BUILD above): one built here could not match the record.
if (-not $EngineBuild -and -not (Test-Path -LiteralPath $engineFile) -and
    -not (Test-Path -LiteralPath (Join-Path (& (Join-Path $Here 'Where.ps1') Engine) 'build\dist'))) {
  Say '  this machine records no engine build and its checkout has none, so it takes CI''s build of the pin' 'DarkGray'
  $EngineBuild = 'ci'
}
if ($EngineBuild -eq 'ci') {
  if ($Check) { Plan ('record CI''s build of the pin as this machine''s engine build, in ' + $engineFile) }
  else {
    $why = Save-EngineBuild $engineFile 'ci'
    if ($why) { Say ('  ' + $why) 'Red' } else { Say ('  recorded CI''s build of the pin in ' + $engineFile + '; Where.ps1 EngineBuild is ' + (& (Join-Path $Here 'Where.ps1') EngineArtifact)) 'Green' }
  }
} elseif ($EngineBuild) {
  $EngineBuild = [IO.Path]::GetFullPath($EngineBuild).TrimEnd('\')
  $hasBuild = Test-Path -LiteralPath (Join-Path $EngineBuild 'build\dist')
  Row 'it has a build in it' $hasBuild $EngineBuild $(if (-not $hasBuild) { 'Give -EngineBuild ci, CI''s build of the pin, which is the one the records name (engine\README.md, A Ship machine takes CI''s build)' } else { '' })
  if ($Check -and $hasBuild) { Plan ('record ' + $EngineBuild + ' as this machine''s engine build, in ' + $engineFile) }
  elseif ($hasBuild) {
    $why = Save-EngineBuild $engineFile $EngineBuild
    if ($why) { Say ('  ' + $why) 'Red' } else { Say ('  recorded in ' + $engineFile) 'Green' }
  }
} else {
  $eb = ''
  try { $eb = [string](& (Join-Path $Here 'Where.ps1') EngineBuild) } catch { $eb = $_.Exception.Message }
  Say ('  ' + $eb + $(if (Test-Path -LiteralPath $engineFile) { ', as ' + $engineFile + ' says' } else { ', this checkout''s own engine; -EngineBuild records another' })) 'DarkGray'
}

# ------------------------------------------ the folder a release is built from --
# See WHICH FOLDER above (#1692). -Root is recorded for this channel, beside
# whatever the file already says for the other one, unless it is a folder
# Vortex deploys into, which Ship refuses.
Head ('The folder a ' + $Channel + ' release is built from')
$rootsFile = & (Join-Path $Here 'Where.ps1') ShipRoots
if ($Root) {
  $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $vortexRoot = Test-Path -LiteralPath (Join-Path $Root 'Game\Data\vortex.deployment.json')
  Row ('it is not a folder Vortex deploys into') (-not $vortexRoot) $Root `
    $(if ($vortexRoot) { 'Game\Data\vortex.deployment.json is there: give -Root the release folder, not Vortex''s (docs\COLLECTION-REVISION-2.md step 8)' } else { '' })
  if ($Check -and -not $vortexRoot) { Plan ('record ' + $Root + ' as the folder a ' + $Channel + ' release is built from, in ' + $rootsFile) }
  elseif (-not $vortexRoot) {
    Save-ShipRoot $rootsFile $Channel $Root
    Say ('  recorded in ' + $rootsFile) 'Green'
  }
  $shipRoot = $Root
} else {
  $shipRoot = [string](& (Join-Path $Here 'Where.ps1') $(if ($Channel -eq 'dev') { 'ShipRootDev' } else { 'ShipRoot' }))
  Say ('  ' + $shipRoot + $(if (Test-Path -LiteralPath $rootsFile) { ', as ' + $rootsFile + ' says or the install rule gives' } else { ', the install rule; -Root records another' })) 'DarkGray'
}

# ------------------------------------------------------------ 1. the tools --
Head '1. The tools a Ship calls'
function Has([string]$n) { return [bool](Get-Command $n -EA SilentlyContinue) }
Row 'git' (Has 'git') '' 'winget install --id Git.Git -e'
$ghOk = $false
if (Has 'gh') {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & gh auth status *> $null; $ghOk = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $old
  Row 'gh, signed in to GitHub' $ghOk '' 'gh auth login   (an account that is a collaborator on ThornswoodRP/Thornswood)'
} else { Row 'gh, signed in to GitHub' $false 'gh is not installed' 'winget install --id GitHub.cli -e, then gh auth login' }
Row 'PowerShell 7' (Has 'pwsh') '' 'winget install --id Microsoft.PowerShell -e'
Row 'node' (Has 'node') '' 'winget install --id OpenJS.NodeJS.LTS -e'
Row 'ssh' (Has 'ssh') '' 'Settings, System, Optional features, add OpenSSH Client'
# The .NET 10 SDK (#4823): the launcher and the ship root tool are SDK
# projects on .NET 10 (Build-Launcher.ps1, Update-ShipRoot.ps1), so a machine
# without it cannot Ship a launcher. Native AOT links with the Visual Studio
# C++ build tools, which Build-Launcher.ps1 names when they are missing.
$sdk10 = ''
if (Has 'dotnet') {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $sdk10 = [string](@(& dotnet --list-sdks 2>$null | Where-Object { $_ -match '^10\.' }) | Select-Object -Last 1)
  $ErrorActionPreference = $old
}
Row 'the .NET 10 SDK, which builds the launcher' ([bool]$sdk10) $sdk10 `
    'winget install --id Microsoft.DotNet.SDK.10 -e   (docs/guide/set-up-a-machine.md "Setting up a machine" has the C++ build tools Native AOT needs)'
$signtool = Find-Signtool
Row 'signtool, from the Windows SDK' ([bool]$signtool) $signtool 'winget install --id Microsoft.WindowsSDK.10.0.26100 -e   (its signing tools are what matter)'
Row 'az, the Azure command line' (Has 'az') '' 'winget install --id Microsoft.AzureCLI -e'
$net8 = $false
if (Has 'dotnet') {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $rt = @(& dotnet --list-runtimes 2>$null)
  $ErrorActionPreference = $old
  foreach ($l in $rt) { $m = [regex]::Match([string]$l, '^Microsoft\.NETCore\.App (\d+)\.'); if ($m.Success -and [int]$m.Groups[1].Value -ge 8) { $net8 = $true } }
}
Row 'the .NET 8 runtime (or newer), which the signing client runs on' $net8 '' 'winget install --id Microsoft.DotNet.Runtime.8 -e'

# --------------------------------------------------- 2. the signing client --
Head '2. Microsoft''s signing client'
$pin = Get-SigningClientPin
$dlibRel = Find-SigningDlib $RepoDir
if ($dlibRel) {
  Row 'the signing client is in records\signing\client' $true $dlibRel ''
} elseif ($Check) {
  Plan ('fetch ' + $pin.Id + ' ' + $pin.Version + ' from nuget.org, check its sha256, and unpack it into records\signing\client')
  Row 'the signing client is in records\signing\client' $false 'not yet' '.\scripts\release\Setup-ShipMachine.ps1   (without -Check) fetches it'
} else {
  Say ('  fetching ' + $pin.Id + ' ' + $pin.Version + ' from nuget.org') 'DarkGray'
  $why = Save-SigningClient $RepoDir $pin ${function:Save-Url} $Work
  $dlibRel = Find-SigningDlib $RepoDir
  Row 'the signing client is in records\signing\client' ([bool]($dlibRel -and -not $why)) $(if ($why) { $why } else { $dlibRel }) 'Run this again; if the sha256 still differs, stop and tell Patrick rather than using another copy'
}

# ------------------------------------------------------ 3. signing.json --
Head '3. records\signing\signing.json'
$template = Join-Path $RepoDir 'records\signing\signing.template.json'
$cfgPath = Join-Path $RepoDir 'records\signing\signing.json'
if (-not (Test-Path -LiteralPath $cfgPath)) {
  if ($Check) {
    Plan ('write records\signing\signing.json from records\signing\signing.template.json' + $(if ($dlibRel) { ', naming ' + $dlibRel } else { '' }))
  } else {
    $r = New-SigningConfig $template $cfgPath $dlibRel
    if ($r.Wrote) { Say '  wrote records\signing\signing.json from the template (paths, no key)' 'Green' }
    else { Say ('  ' + $r.Why) 'Red' }
  }
}
if (Test-Path -LiteralPath $cfgPath) {
  . (Join-Path $Here 'Assert-PublishSigned.ps1')
  $refuse = Get-SigningConfigRefusal -ConfigPath $cfgPath -RepoRoot $RepoDir
  Row 'Ship would accept it' (-not $refuse) $refuse 'Fix what it says. Never set "enabled": false to get past it: a Ship from a machine that cannot sign is refused, on purpose'
  $miss = @(Get-SigningPathsMissing $cfgPath $RepoDir)
  Row 'the dlib and metadata it names are here' ($miss.Count -eq 0) ($miss -join '; ') `
    'It was copied from another machine and names that machine''s paths. Move it aside (rename it records\signing\signing.json.old) and run this again: it writes one from the template'
} else {
  Row 'records\signing\signing.json is here' $false '' '.\scripts\release\Setup-ShipMachine.ps1   (without -Check) writes it from the template'
}

# ------------------------------------------------------ 4. the az sign in --
Head '4. The Azure sign in signing uses'
$metaPath = Join-Path $RepoDir 'records\signing\metadata.json'
$ids = Get-SignatureIdentities (Join-Path $RepoDir 'launcher\app\Signature.cs')
if (-not (Has 'az')) {
  Row 'az can sign with the ThornswoodRelease profile' $false 'az is not installed' 'Install az (step 1), then az login'
} else {
  $reach = Test-SigningReach $metaPath $ids
  $fix = $(if ($reach.Why -match 'no Azure sign in') { 'az login --tenant 5a096034-ce55-40d2-b313-10ee86efe26a --allow-no-subscriptions   (as yourself, in the browser: docs/guide/set-up-a-machine.md "Your own signing sign in")' }
           elseif ($reach.Why -match 'signer role') { 'This sign in has no Certificate Profile Signer role on the ThornswoodSigning account, profile ThornswoodRelease. Patrick gives it to an account of your own once (docs/guide/set-up-a-machine.md "Your own signing sign in"), then az login as that account' }
           else { 'Run this again; if it keeps failing, the lines above say what the service answered' })
  Row 'az can sign with the ThornswoodRelease profile' $reach.Ok $reach.Why $fix $(if ($reach.Why -match 'signer role') { 'patrick' } else { 'you' })
}

# ------------------------------------------------- 5. the client runtime --
Head '5. The client runtime records\client-build.json names'
$record = Join-Path $RepoDir 'records\client-build.json'
$rec = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
$commit = [string]$rec.forkCommit
$total = @($rec.files.PSObject.Properties).Count
$dist = & (Join-Path $Here 'Where.ps1') ClientDist
$game = Join-Path $shipRoot 'Game'
$inGame = Get-ClientMatch $record $game
$inDist = Get-ClientMatch $record $dist
Say ('  record ' + $commit + '; the game folder ' + $game + ' holds ' + $inGame + ' of ' + $total + ', the build folder ' + $inDist + ' of ' + $total) 'DarkGray'
if ($inGame -eq $total -or $inDist -eq $total) {
  Row 'the recorded client is here' $true $(if ($inGame -eq $total) { 'in the game folder' } else { 'in ' + $dist + ', and Ship copies it in' }) ''
} elseif (($EngineBuild -eq 'ci') -or (Test-EngineBuildIsCi $engineFile)) {
  # CI's build of the pin (#3047): the fork's own build (#3399), held to the records.
  $getArgs = @{ NoPause = $true }
  if ($Check) { $getArgs['Check'] = $true }
  $global:LASTEXITCODE = 0
  & (Join-Path $Here 'Get-EngineArtifact.ps1') @getArgs
  $gc = $LASTEXITCODE
  if ($gc -eq 2) {
    Plan ('fetch CI''s build of ' + $commit + ' and hold every file to the records')
    Row 'the recorded client is here' $false 'not yet' '.\scripts\release\Setup-ShipMachine.ps1   (without -Check) fetches it, and so does the next Ship'
  } else {
    Row 'the recorded client is here' ($gc -eq 0) $(if ($gc -eq 0) { 'CI''s build of ' + $commit + ' in ' + (& (Join-Path $Here 'Where.ps1') EngineArtifact) + ', and Ship copies it in' } else { 'CI''s build of ' + $commit + ' could not be had' }) `
      '.\scripts\release\Get-EngineArtifact.ps1 says why above (engine\README.md, A Ship machine takes CI''s build)'
  }
} else {
  $feeds = @()
  . (Join-Path $PSScriptRoot 'Feed-Json.ps1')   # Join-FeedSettings: the site's feed whole (#1050)
  foreach ($pair in @(@('dev', '/feed-dev/version.json'), @('main', '/feed/version.json'))) {
    $doc = $null
    # Whole again: the client runtime is in the settings the feed names (#1050).
    $u = $Site.TrimEnd('/') + $pair[1]
    try { $doc = Join-FeedSettings (Invoke-RestMethod -Uri $u -UseBasicParsing -TimeoutSec 30) $u } catch { $doc = $null }
    $feeds += [pscustomobject]@{ Name = $pair[0]; Doc = $doc }
  }
  $cr = Find-ClientRuntime $feeds $commit
  if ($cr -and $Check) {
    Plan ('fetch client-runtime-' + $commit + ' (' + [math]::Round($cr.Bytes / 1MB, 1) + ' MB) from the ' + $cr.Feed + ' feed, check it, and put the six files in ' + $dist)
    Row 'the recorded client is here' $false 'not yet' '.\scripts\release\Setup-ShipMachine.ps1   (without -Check) fetches it'
  } elseif ($cr) {
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    $zip = Join-Path $Work ('client-runtime-' + $commit + '.zip')
    Say ('  fetching client-runtime-' + $commit + ' from the ' + $cr.Feed + ' feed') 'DarkGray'
    $why = ''
    try { Save-Url $cr.Url $zip } catch { $why = 'it could not be fetched: ' + $_.Exception.Message }
    if (-not $why) { $why = Install-ClientRuntime $zip $cr.Sha256 $cr.Bytes $record $dist (Join-Path $Work ('client-runtime-' + $commit)) }
    Remove-Item -LiteralPath $zip -Force -EA SilentlyContinue
    Row 'the recorded client is here' (-not $why) $(if ($why) { $why } else { 'fetched from the ' + $cr.Feed + ' feed into ' + $dist + ', every file as recorded' }) `
      'The lines above say why. CI''s build of the pin holds the same files: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci'
  } else {
    Row 'the recorded client is here' $false ('client-runtime-' + $commit + ' is on neither feed, and a build made here would not be the recorded bytes') `
      '.\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci   (CI''s build of the pin, the one the record names; engine\README.md, A Ship machine takes CI''s build)'
  }
}
if ((Test-Path -LiteralPath $game) -and ($inGame -ne $total)) {
  $global:LASTEXITCODE = 0
  & (Join-Path $Here 'Sync-Client.ps1') -Check -NoPause -Game $game -Dist $dist -Record $record 6>$null | Out-Null
  $sc = $LASTEXITCODE
  Say ('  Sync-Client -Check says ' + $(switch ($sc) { 0 { 'the game folder holds it' } 2 { 'a matching build is here and Ship copies it in' } default { 'no (exit ' + $sc + ')' } })) $(if ($sc -eq 0 -or $sc -eq 2) { 'DarkGray' } else { 'Yellow' })
}

# --------------------------------------------- the release folder itself --
# #2019: the folder is made or brought up to date the way every Ship does it
# first, and only asked about with -Check.
Head ('The ' + $Channel + ' release folder''s game folder and client')
if (Test-Path -LiteralPath (Join-Path $shipRoot 'Game\Data\vortex.deployment.json')) {
  Say '  not touched: it is a folder Vortex deploys into (see above)' 'Yellow'
} else {
  $upArgs = @{ Channel = $Channel; Root = $shipRoot; NoPause = $true }
  if ($Check) { $upArgs['Check'] = $true }
  elseif ($SkyrimFrom) { $upArgs['SkyrimFrom'] = $SkyrimFrom }
  $global:LASTEXITCODE = 0
  & (Join-Path $Here 'Update-ShipRoot.ps1') @upArgs
  $upCode = $LASTEXITCODE
  Row ('the release folder is current with Vortex''s deployment, with the recorded client in it') ($upCode -eq 0) $shipRoot `
    $('.\scripts\release\Update-ShipRoot.ps1 -Channel ' + $Channel + ' says why above')
}

# ---------------------------------------------------------- what is left --
Write-Host ''
Write-Host ('  ' + ('=' * 68)) -ForegroundColor DarkGray
if ($script:gaps.Count) {
  Say ('  ' + $script:gaps.Count + ' thing(s) to do before this machine can sign and Ship:') 'Yellow'
  $i = 0
  foreach ($g in $script:gaps) {
    $i++
    Say ('  ' + $i + '. ' + $g.What) 'Yellow'
    if ($g.Fix) { Say ('       ' + $g.Fix + $(if ($g.Who -eq 'patrick') { '   (Patrick does this one)' } else { '' })) 'White' }
  }
} else {
  Say '  The signing setup and the client runtime are in place.' 'Green'
}
Say '  Then Check-ShipReady asks everything else a Ship asks:' 'DarkGray'

# ------------------------------------------------------ 6. Check-ShipReady --
$readyArgs = @{ Channel = $Channel; NoPause = $true }
if ($NoVps) { $readyArgs['NoVps'] = $true }
if ($Root) { $readyArgs['Root'] = $Root }
$global:LASTEXITCODE = 0
& (Join-Path $Here 'Check-ShipReady.ps1') @readyArgs
$readyCode = $LASTEXITCODE

if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if ($script:gaps.Count -or $readyCode -ne 0) { exit 1 }
exit 0
