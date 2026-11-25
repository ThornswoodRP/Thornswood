<#
.SYNOPSIS
  Writes records\collection-plugins.json, the collection's plugins with the size and sha256 of each, which the full deploys hold the plugins they send to (#2019, CollectionPlugins.ps1).

.DESCRIPTION
  Writes records\collection-plugins.json, the collection's plugins with the
  size and sha256 of each, which the full deploys hold the plugins they send
  to (#2019, CollectionPlugins.ps1). Reads plugin files from a folder and
  nothing else: it never opens or asks the Vortex app.

      .\scripts\mods\New-CollectionPluginRecord.ps1 -Data <folder> -Collection 7essxf -Revision 2

  -Data is a folder holding the collection's plugins as the collection
  installs them (a game Data folder deployed from the collection). Every
  .esp, .esm and .esl in it goes in, or only -Plugins when named.
  Thornswood-Content.esp never does: it is ours and goes up from the repo.
  -Out writes somewhere else than records\collection-plugins.json.

  The text is written by hand, sorted by name, LF and no byte order mark, so
  the same folder gives the same bytes on Windows PowerShell 5.1 and 7.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Data,
    [string]$Out,
    [string[]]$Plugins,
    [string]$Collection = '',
    [int]$Revision = 0
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
. (Join-Path $Here '..\deploy\CollectionPlugins.ps1')

if (-not (Test-Path -LiteralPath $Data -PathType Container)) { throw "There is no folder at $Data" }
if (-not $Out) { $Out = Join-Path $Here '..\..\records\collection-plugins.json' }
$Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)

$files = @(Get-ChildItem -LiteralPath $Data -File | Where-Object { $_.Extension -match '^\.es[pml]$' -and -not (Test-ThornswoodRepoPlugin $_.Name) })
if ($Plugins) {
    $want = @($Plugins | Where-Object { -not (Test-ThornswoodRepoPlugin $_) })
    $missing = @($want | Where-Object { $n = $_; -not @($files | Where-Object { $_.Name -eq $n }).Count })
    if ($missing.Count) { throw ('not in ' + $Data + ': ' + ($missing -join ', ')) }
    $files = @($files | Where-Object { $want -contains $_.Name })
}
if (-not $files.Count) { throw "There are no plugins in $Data" }
$files = @($files | Sort-Object -Property @{ Expression = { $_.Name.ToLowerInvariant() } })

function Esc([string]$s) { return $s.Replace('\', '\\').Replace('"', '\"') }
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('{')
$lines.Add('  "version": 1,')
$lines.Add('  "builtBy": "scripts/mods/New-CollectionPluginRecord.ps1",')
$lines.Add('  "collection": "' + (Esc $Collection) + '",')
$lines.Add('  "revision": ' + $Revision + ',')
$lines.Add('  "plugins": [')
for ($i = 0; $i -lt $files.Count; $i++) {
    $f = $files[$i]
    $row = '    { "name": "' + (Esc $f.Name) + '", "size": ' + $f.Length + ', "sha256": "' + (Get-ThornswoodPluginSha256 $f.FullName) + '" }'
    if ($i -lt $files.Count - 1) { $row += ',' }
    $lines.Add($row)
}
$lines.Add('  ]')
$lines.Add('}')
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir }
[IO.File]::WriteAllText($Out, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
# Read back through the deploy's own reader, so a record this writes is one it takes.
$null = Read-ThornswoodCollectionPluginRecord $Out
Write-Host ('  {0} plugins from {1} written to {2}' -f $files.Count, $Data, $Out)
