<#
  App-Part.ps1

  Makes the zip of one app the box deploy agent puts in from a build Release
  (#5190, #5187): the site, the Discord bot or the voice service, each as the
  folder it lands in on the box holds it. Merge release (merge-release.yml)
  runs this for each app on every merge and puts the zip on the Release as
  its own part; the agent stages it, checks it, and swaps it in
  (tools/DeployAgent/App.cs, docs/DEPLOY-AGENT.md).

      pwsh -File scripts/release/App-Part.ps1 -Part site    -Out <folder>\site.zip
      pwsh -File scripts/release/App-Part.ps1 -Part discord -Out <folder>\discord.zip
      pwsh -File scripts/release/App-Part.ps1 -Part voice   -Out <folder>\voice.zip
      pwsh -File scripts/release/App-Part.ps1 -Part tables  -Out <folder>\gamemode-tables.zip

  WHAT EACH CARRIES, by the path it has in the app's folder on the box:

    site     server.js, lib\*, public\*, data\site\*   (C:\Thornswood-Docs)
             What Deploy-Docs.ps1 sends as the app, and the public pages
             (-Site), which nobody edits in the browser. The documents, the
             boards and everything the site writes are the site's own and
             never ride a Release.
    discord  bot.py, _pyguard.py, trust.py, card.py, staff-channel.txt,
             dev-channel.txt (where dev news goes), requirements.txt,
             factions.json, assets\join-card.png
             (C:\Thornswood-Bot). The list Install-Bot.ps1 -CodeOnly sends.
             The token, the settings, the records and the libraries are the
             bot's own and never ride a Release.
    voice    voice-server.js, headlines.js, server-log.js
             (C:\Thornswood-Voice and C:\Thornswood-Voice-Dev). The list
             Install-Voice.ps1 sends; server-log.js is
             scripts\vps\Server-Log.js, which the voice task writes its log
             through.
    tables   every game\gamemode-tables\<NAME>.json, at the top of the zip
             (#5191). Not an app: it rides the gamemode part as
             gamemode-tables.zip, and the agent swaps the folder in beside
             gamemode.js (tools/DeployAgent/Tables.cs). Built here for the
             same bytes as the apps, so a merge that changed no table leaves
             the gamemode part unchanged.

  THE ZIP IS THE SAME BYTES FOR THE SAME FILES. Merge release tells whether
  an app changed by comparing this zip's sha256 with the same part of the
  newest build Release, so a zip that differed from run to run would deploy
  every app on every merge. So the entries are sorted by path (ordinal), each
  carries one fixed time and no file attributes, the paths use forward
  slashes, and every entry is compressed at one fixed level by .NET's own
  deflate. The files are read as git checked them out; .gitattributes keeps
  their line endings the same on every runner.

  Exit 0 with the zip written and one line naming it, its sha256 and its
  entries; exit 1 with the reason and no zip.

  Keep it ASCII.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('site', 'discord', 'voice', 'tables')][string]$Part,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$RepoDir = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepoDir) { $RepoDir = Join-Path $PSScriptRoot '..\..' }
$RepoDir = (Resolve-Path -LiteralPath $RepoDir).ProviderPath

# Every entry's time. A zip holds a local time with two-second steps, so this
# is a plain date, the day the agent first took an app (#5190).
$Fixed = [DateTimeOffset]::new(2026, 11, 1, 0, 0, 0, [TimeSpan]::Zero)

function Stop-Part([string]$why) {
  [Console]::Error.WriteLine("App-Part.ps1 -Part ${Part}: $why")
  if ($Out -and (Test-Path -LiteralPath $Out)) { Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue }
  exit 1
}

# The entries, as path in the zip => file in the repository.
$entries = [ordered]@{}
function Add-One([string]$rel, [string]$src) {
  $full = Join-Path $RepoDir $src
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Stop-Part "there is no $src in the repository" }
  $entries[$rel] = $full
}
# Every file under a folder of the repository, at the same place under at.
function Add-Tree([string]$src, [string]$at) {
  $dir = Join-Path $RepoDir $src
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Stop-Part "there is no folder $src in the repository" }
  $base = (Resolve-Path -LiteralPath $dir).ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Recurse -Force)) {
    $rel = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
    $entries[$at + '/' + $rel] = $f.FullName
  }
}

switch ($Part) {
  'site' {
    Add-One 'server.js' 'site/server.js'
    Add-Tree 'site/lib' 'lib'
    Add-Tree 'site/public' 'public'
    Add-Tree 'site/data/site' 'data/site'
  }
  'discord' {
    foreach ($f in 'bot.py', '_pyguard.py', 'trust.py', 'card.py', 'staff-channel.txt', 'dev-channel.txt', 'requirements.txt', 'factions.json') { Add-One $f ('bot/' + $f) }
    Add-One 'assets/join-card.png' 'bot/assets/join-card.png'
  }
  'voice' {
    Add-One 'voice-server.js' 'voice/voice-server.js'
    Add-One 'headlines.js' 'voice/headlines.js'
    Add-One 'server-log.js' 'scripts/vps/Server-Log.js'
  }
  'tables' {
    # The names the gamemode's table('NAME') reads; anything else in the
    # folder is not a table.
    $dir = Join-Path $RepoDir 'game/gamemode-tables'
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Stop-Part 'there is no folder game/gamemode-tables in the repository' }
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Filter '*.json' | Where-Object { $_.Name -cmatch '^[A-Z][A-Z0-9_]*\.json$' })) {
      Add-One $f.Name ('game/gamemode-tables/' + $f.Name)
    }
  }
}

# The agent takes a path made of plain names only (App.cs holds every entry
# to the same rule), so anything else stops here rather than on the box.
foreach ($rel in @($entries.Keys)) {
  foreach ($seg in $rel.Split('/')) {
    if ($seg -notmatch '^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$') { Stop-Part "$rel has a part, '$seg', that is not a plain file or folder name the agent takes" }
  }
}
if ($entries.Count -eq 0) { Stop-Part 'nothing to put in it' }

$outFull = [IO.Path]::GetFullPath($Out)
$outDir = Split-Path -Parent $outFull
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
if (Test-Path -LiteralPath $outFull) { Remove-Item -LiteralPath $outFull -Force }

Add-Type -AssemblyName System.IO.Compression
$names = [string[]]@($entries.Keys)
[Array]::Sort($names, [StringComparer]::Ordinal)
try {
  $fs = [IO.File]::Open($outFull, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    $zip = [IO.Compression.ZipArchive]::new($fs, [IO.Compression.ZipArchiveMode]::Create, $false, [Text.Encoding]::UTF8)
    try {
      foreach ($rel in $names) {
        $e = $zip.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
        $e.LastWriteTime = $Fixed
        $e.ExternalAttributes = 0
        $w = $e.Open()
        try {
          $bytes = [IO.File]::ReadAllBytes($entries[$rel])
          $w.Write($bytes, 0, $bytes.Length)
        } finally { $w.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $fs.Dispose() }
} catch {
  Stop-Part ("the zip could not be written: " + $_.Exception.Message)
}

$sum = (Get-FileHash -LiteralPath $outFull -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ("{0}: {1} ({2} entries, sha256 {3})" -f $Part, $outFull, $names.Count, $sum)
exit 0
