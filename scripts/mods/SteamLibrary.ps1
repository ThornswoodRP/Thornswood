<#
.SYNOPSIS
  Finds the Steam copy of Skyrim Special Edition without changing any files.

.DESCRIPTION
  Finds the Steam copy of Skyrim Special Edition without changing any files.
#>

# Steam's own folder from the registry, then the libraries it lists. An
# optional default root lets the audit still find a copy without a registry key.
function Get-SteamSkyrim([string]$DefaultRoot) {
  $roots = @()
  foreach ($k in 'HKCU:\Software\Valve\Steam', 'HKCU:\Software\Wow6432Node\Valve\Steam') {
    try { $p = (Get-ItemProperty -Path $k -Name SteamPath -EA Stop).SteamPath } catch { continue }
    if ($p) { $roots += $p.Replace('/', [IO.Path]::DirectorySeparatorChar) }
  }
  try { $p = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Wow6432Node\Valve\Steam' -Name InstallPath -EA Stop).InstallPath } catch { $p = $null }
  if ($p) { $roots += $p }
  if ($DefaultRoot -and -not $roots.Count) { $roots += $DefaultRoot }
  foreach ($r in @($roots | Select-Object -Unique)) {
    $vdf = Join-Path $r 'config\libraryfolders.vdf'
    if (-not (Test-Path -LiteralPath $vdf -PathType Leaf)) { continue }
    foreach ($line in (Get-Content -LiteralPath $vdf)) {
      $m = [regex]::Match($line, '^\s*"path"\s+"(.+)"\s*$')
      if ($m.Success) { $roots += ($m.Groups[1].Value -replace '\\\\', '\') }
    }
  }
  # Retain the audit's default path as a last candidate even when a registry
  # entry points somewhere else.
  if ($DefaultRoot) { $roots += $DefaultRoot }
  foreach ($r in ($roots | Select-Object -Unique)) {
    $game = Join-Path $r 'steamapps\common\Skyrim Special Edition'
    if (Test-Path -LiteralPath (Join-Path $game 'SkyrimSE.exe') -PathType Leaf) { return $game }
  }
  return ''
}
