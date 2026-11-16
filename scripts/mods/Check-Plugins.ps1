# What is enabled that should not be, and what is missing that should be there.
# Compares the live load order against the reference this install shipped with.
# Exit 0 when both enable the same plugins. Exit 1 when either enables one the
# other does not, or when either list cannot be found or read (#4760).
# -Live and -Reference name the two lists. Left off, they are the game's own
# plugins.txt under LOCALAPPDATA and the first Thornswood\Profile\Default\
# plugins.txt on a fixed drive, as before.
param(
  [string]$Live = '',
  [string]$Reference = ''
)

if (-not $Live) { $Live = Join-Path $env:LOCALAPPDATA (Join-Path 'Skyrim Special Edition' 'plugins.txt') }

$ref = $Reference
if (-not $ref) {
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if ($d.DriveType -ne 'Fixed' -or -not $d.IsReady) { continue }
    $t = Join-Path $d.RootDirectory.FullName (Join-Path 'Thornswood' (Join-Path 'Profile' (Join-Path 'Default' 'plugins.txt')))
    if (Test-Path -LiteralPath $t) { $ref = $t; break }
  }
}

# How many of the two lists could not be found or read. Either one missing
# makes the other's whole list look EXTRA or MISSING, which is no comparison.
$script:unread = 0
function Enabled($p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { $script:unread++; return @() }
  $lines = @(Get-Content -LiteralPath $p -ErrorVariable readError)
  if ($readError) { $script:unread++ }
  @($lines | Where-Object { $_.StartsWith('*') } | ForEach-Object { $_.Substring(1).Trim() })
}

$have = Enabled $Live
$want = Enabled $ref
Write-Host ""
Write-Host ("live      : {0}  ({1})" -f $have.Count, $Live)
Write-Host ("reference : {0}  ({1})" -f $want.Count, $ref)

$extra   = @($have | Where-Object { $want -notcontains $_ })
$missing = @($want | Where-Object { $have -notcontains $_ })

Write-Host ""
Write-Host ("EXTRA, enabled but not part of the build ({0}):" -f $extra.Count) -ForegroundColor Yellow
if ($extra.Count -eq 0) { Write-Host "  none" -ForegroundColor DarkGray } else { $extra | ForEach-Object { Write-Host "  $_" } }

Write-Host ""
Write-Host ("MISSING, part of the build but not enabled ({0}):" -f $missing.Count) -ForegroundColor Yellow
if ($missing.Count -eq 0) { Write-Host "  none" -ForegroundColor DarkGray } else { $missing | ForEach-Object { Write-Host "  $_" } }
Write-Host ""

# What it found is the exit code (#4760). Until then this always exited 0, so
# a script or harness that ran it read a pass whatever the lists said.
if ($script:unread -or $extra.Count -or $missing.Count) { exit 1 }
exit 0
