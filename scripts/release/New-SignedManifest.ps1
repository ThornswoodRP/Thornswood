<#
  New-SignedManifest.ps1

  Writes the manifest a Release for the box deploy agent carries (#5180), and
  the catalog over it that Sign-OnRunner.ps1 then signs. The agent reads both
  (tools/DeployAgent/ReleaseFetch.cs):

      manifest.json   { schema: 1, repo, commit, tag, version, made,
                        [launcherVersion,]
                        parts: { <part>: [ { name, sha256, size } ] } }
      manifest.cat    a catalog over manifest.json alone (New-FileCatalog,
                      version 2, SHA256), the shape release.cat has over
                      release.json (Release-Manifest.ps1)

      pwsh -File scripts/release/New-SignedManifest.ps1 -Out <folder> -Tag <tag>
           -Commit <40 hex> -Part gamemode -Files <path>,<path> [-Version a.b.c]
           [-BotFiles <path>,<path>] [-ServerZip <server-<commit>-<sum>.zip>]
           [-Add <part>=<path> ...] [-LauncherVersion a.b.c]

  -BotFiles adds a part, "bot": the bot pass a dev Deployment waits
  on (#5196, scripts\bot\Bot-Pass.js and what it needs). The agent puts
  every file of a Release in one folder, so no two files of a Release may
  have the same name.

  -ServerZip adds a part, server: the server build's zip as
  ServerArtifact.ps1 makes it (Get-EngineArtifact.ps1 puts CI's build of the
  pin there), and the record it carries, server-build.json, beside it, so the
  agent can tell from the record alone whether dev runs that build already
  and fetch the zip only when it does not (#5219).

  -Add (or -Zip) puts one file in a part of a build Release, once per file
  (#5179): the merge release's launcher (Thornswood.exe), game (the game
  files' zip and game-files.json, Build-GameFiles.ps1), velopack (the
  Velopack package of the launcher and the game files, and its feed files),
  site, discord and voice (each app's zip, App-Part.ps1), and after (the
  step files of deploy/after and the gate's verbs.json the agent holds them
  to, #5186). A part named
  twice holds every file named for it. The agent applies the parts it knows
  and names the others in its log, so a part is added here before the agent
  applies it. -LauncherVersion is written into the manifest beside the
  launcher part, so the next merge release can tell whether the launcher's
  sources changed (LauncherVersion.ps1) without building it.

  It writes <Out>\files\manifest.json, <Out>\manifest.cat, and copies each
  file into <Out>\assets beside the manifest and the catalog, so the folder
  is the Release's files. The catalog covers the manifest, and the manifest's
  sha256 covers every other file, so one signature holds the whole Release.
  New-FileCatalog is Windows only, so this runs on a Windows runner.

  Keep it ASCII.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$Commit,
  [Parameter(Mandatory = $true)][ValidateSet('gamemode', 'agent')][string]$Part,
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string]$Version = '',
  [string[]]$BotFiles = @(),
  [string]$ServerZip = '',
  [Alias('Zip')][string[]]$Add = @(),
  [string]$LauncherVersion = '',
  [string]$Repo = $env:GITHUB_REPOSITORY,
  [switch]$NoCatalog
)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = 'ThornswoodRP/Thornswood' }
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "commit $Commit is not 40 hex" }
if ($Tag -notmatch '^(build-[A-Za-z0-9._-]{1,80}|agent-v\d+\.\d+\.\d+)$') { throw "tag $Tag is neither build-<...> nor agent-v<a.b.c>" }
if ($Part -eq 'agent' -and $Tag -ne ('agent-v' + $Version)) { throw "an agent Release's tag is agent-v<version>, and $Tag does not say $Version" }

if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
$filesDir = Join-Path $Out 'files'
$assets = Join-Path $Out 'assets'
New-Item -ItemType Directory -Force -Path $filesDir, $assets | Out-Null

$names = @{}
function Get-PartList([string[]]$paths) {
  $out = @()
  foreach ($f in $paths) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "there is no file at $f" }
    $name = Split-Path -Leaf $f
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' -or $name -in 'manifest.json', 'manifest.cat') { throw "$name is not a file name the agent takes" }
    if ($names.ContainsKey($name)) { throw "two files are called $name, and the agent puts a Release's files in one folder" }
    $names[$name] = $true
    Copy-Item -LiteralPath $f -Destination (Join-Path $assets $name) -Force
    $item = Get-Item -LiteralPath (Join-Path $assets $name)
    $out += [ordered]@{ name = $name; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); size = $item.Length }
  }
  return ,$out
}
$list = Get-PartList $Files
$parts = [ordered]@{ $Part = @($list) }
if (@($BotFiles).Count) {
  if ($Part -ne 'gamemode') { throw "-BotFiles goes with a gamemode Release, the one a dev Deployment applies" }
  $parts['bot'] = Get-PartList $BotFiles
}

if ($ServerZip) {
  if ($Part -ne 'gamemode') { throw "a server build goes on a build Release beside the gamemode, not on an $Part Release" }
  if (-not (Test-Path -LiteralPath $ServerZip -PathType Leaf)) { throw "there is no server zip at $ServerZip" }
  $zipName = Split-Path -Leaf $ServerZip
  if ($zipName -notmatch '^server-[0-9a-f]{12}-[0-9a-f]{16}\.zip$') { throw "$zipName is not a server build zip as ServerArtifact.ps1 names one" }
  foreach ($n in 'server-build.json', $zipName) {
    if ($names.ContainsKey($n)) { throw "two files are called $n, and the agent puts a Release's files in one folder" }
    $names[$n] = $true
  }
  Copy-Item -LiteralPath $ServerZip -Destination (Join-Path $assets $zipName) -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $za = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ServerZip).ProviderPath)
  try {
    $ze = $za.Entries | Where-Object { $_.FullName -eq 'server-build.json' } | Select-Object -First 1
    if (-not $ze) { throw "$zipName carries no server-build.json" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($ze, (Join-Path $assets 'server-build.json'), $true)
  } finally { $za.Dispose() }
  $server = @()
  foreach ($n in 'server-build.json', $zipName) {
    $item = Get-Item -LiteralPath (Join-Path $assets $n)
    $server += [ordered]@{ name = $n; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); size = $item.Length }
  }
  $parts['server'] = @($server)
}

# The parts a merge release adds file by file (#5179). The bot pass is "bot",
# so the Discord bot is "discord".
$addParts = @('launcher', 'game', 'velopack', 'site', 'discord', 'voice', 'after')
$adds = [ordered]@{}
foreach ($pair in @($Add)) {
  if ($pair -notmatch '^([a-z]+)=(.+)$') { throw "-Add $pair is not <part>=<path>" }
  $pn = $Matches[1]; $pp = $Matches[2]
  if ($pn -notin $addParts) { throw "-Add names the part $pn, and a build Release adds only $($addParts -join ', ')" }
  if ($Part -ne 'gamemode') { throw "-Add goes with a build Release beside the gamemode, not on an $Part Release" }
  if (-not $adds.Contains($pn)) { $adds[$pn] = New-Object System.Collections.Generic.List[string] }
  $adds[$pn].Add($pp)
}
foreach ($pn in $adds.Keys) { $parts[$pn] = Get-PartList $adds[$pn].ToArray() }
if ($LauncherVersion) {
  if ($LauncherVersion -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw "-LauncherVersion $LauncherVersion is not a.b.c or a.b.c.d" }
  if (-not $adds.Contains('launcher')) { throw "-LauncherVersion names the launcher's number, and the Release carries no launcher part" }
}

$m = [ordered]@{
  schema  = 1
  repo    = $Repo
  commit  = $Commit
  tag     = $Tag
  version = $Version
  made    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
if ($LauncherVersion) { $m['launcherVersion'] = $LauncherVersion }
$m['parts'] = $parts
$json = Join-Path $filesDir 'manifest.json'
[IO.File]::WriteAllText($json, ($m | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath $json -Destination (Join-Path $assets 'manifest.json') -Force
Write-Host ("manifest.json for {0}: {1} file(s) of {2}{3}, commit {4}" -f $Tag, $list.Count, $Part, $(if ($parts.Contains('bot')) { ' and ' + @($parts['bot']).Count + ' of bot' } else { '' }), $Commit)
if ($ServerZip) { Write-Host ("  and the server build {0} with its record" -f (Split-Path -Leaf $ServerZip)) }
foreach ($pn in $adds.Keys) { Write-Host ("  and {0}: {1}" -f $pn, ((@($parts[$pn]) | ForEach-Object { $_.name }) -join ', ')) }
if ($NoCatalog) { exit 0 }

$cat = Join-Path $Out 'manifest.cat'
New-FileCatalog -Path $filesDir -CatalogFilePath $cat -CatalogVersion 2.0 | Out-Null
if (-not (Test-Path -LiteralPath $cat -PathType Leaf)) { throw "New-FileCatalog wrote no catalog at $cat" }
Write-Host "manifest.cat written over manifest.json; Sign-OnRunner.ps1 signs it, then it goes into assets"
exit 0
