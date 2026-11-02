<#
  vps-runner-logs.ps1

  Runs ON the VPS, once a day, as the scheduled task that
  Keep-RunnerLogs.ps1 -Install puts there (C:\Thornswood-Watch\runner-logs.ps1).
  Not meant to be run from this machine, except by
  tests\test-3184-runner-logs.ps1, which runs it against scratch folders.

  WHY THIS EXISTS (#3184). actions/runner writes a Runner_*.log every time a
  runner starts and a Worker_*.log for every job into its _diag folder, and
  per-step logs into _diag\pages, and never removes any of them. On 21 Oct 2026
  the box's runners held about 4,000 of them, 1.6 GB, the oldest from 25 Sep,
  and 255 jobs a day add more. A job's own log is on GitHub for 90 days; these
  are the runner's side of it, read only when a job went wrong on the box, so
  two weeks of them is plenty.

  WHAT IT DOES. In _diag and _diag\pages of every runner folder under -Root
  named Thornswood-Runner or Thornswood-RunnerN, removes the files named
  Runner_*.log, Worker_*.log and, in pages, *.log, last written more than -Days
  days ago. Nothing else, and nothing below those two folders. A file it
  cannot remove (a runner that is writing it) is said in the log with what
  Windows answered, and left for the next day.

  Each run appends a line or two to runner-logs.log beside it: how many it
  removed and how much that was, and each one it could not. Keep it ASCII:
  PowerShell 7 runs it.
#>
param(
  [string]$Root = 'C:\',
  [int]$Days = 14,
  [string]$Log = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Log) { $Log = Join-Path $PSScriptRoot 'runner-logs.log' }

function Note([string]$m) {
  Add-Content -LiteralPath $Log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $m) -Encoding ASCII
}

$cut = (Get-Date).AddDays(-$Days)
$removed = 0
[uint64]$bytes = 0
$refused = 0
$runners = @(Get-ChildItem -LiteralPath $Root -Directory -Force | Where-Object { $_.Name -match '^Thornswood-Runner\d*$' })
foreach ($r in $runners) {
  foreach ($sub in @(@{ Dir = '_diag'; Like = @('Runner_*.log', 'Worker_*.log') }, @{ Dir = '_diag\pages'; Like = @('*.log') })) {
    $dir = Join-Path $r.FullName $sub.Dir
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Force)) {
      $named = $false
      foreach ($l in $sub.Like) { if ($f.Name -like $l) { $named = $true } }
      if (-not $named -or $f.LastWriteTime -ge $cut) { continue }
      try {
        $len = $f.Length
        Remove-Item -LiteralPath $f.FullName -Force
        $removed++
        $bytes += [uint64]$len
      } catch {
        $refused++
        Note ('could not remove ' + $f.FullName + ': ' + $_.Exception.Message)
      }
    }
  }
}
Note ('removed {0} runner log(s), {1:N1} MB, older than {2} days, from {3} runner folder(s); {4} could not be removed' -f $removed, ($bytes / 1MB), $Days, $runners.Count, $refused)
