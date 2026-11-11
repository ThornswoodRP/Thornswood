<#
  RestartNotice.ps1

  The restart notice the Discord bot posts (#5784), written on the box by
  the scripts that stop a game server by hand: Request-Restart.ps1 (and so
  Deploy-Server.ps1 and Deploy-DevGamemode.ps1, which warn through it),
  Swap.ps1's swap block and Restart-Server.ps1. The deploy agent writes the
  same file from tools\DeployAgent\RestartNotice.cs; bot\bot_restarts.py
  reads it and posts each restart in #updates (the dev server's in the dev
  updates channel) before it happens, and once more when it is over.

  The file is C:\Thornswood-Deploys\for-bot\restart-<environment>.json,
  beside the release news: environment (main for C:\Thornswood-Server, dev
  for C:\Thornswood-Server-Dev), id, state, downUtc, why and writtenUtc.
  States: coming, back, down, off. A coming gets a new id; the others keep
  the id and the time of the coming they end, and are written only while
  one is coming.

  Until 11 Nov 2026 nothing that restarted a game server said so in Discord.

  $ThornswoodRestartNoticeText is the function the box runs, put in front
  of the script sent there. Set-ThornswoodRestartNotice prints one line:
    NOTICE SAID: <id> <state>   written
    NOTICE NONE: <why>          nothing to say (not a game server's folder,
                                or an end with no restart coming)
    NOTICE FAILED: <why>        it could not be written, so Discord was not
                                told; a caller warning ahead stops there

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads what is sent as
  ANSI.
#>

$ThornswoodRestartNoticeText = @'
# ==== restart notice (#5784) ====
$ThornswoodRestartNoticeDir = 'C:\Thornswood-Deploys\for-bot'
function Get-ThornswoodRestartEnvironment([string]$Root) {
  $r = ([string]$Root).Replace('/', '\').TrimEnd('\')
  if ($r -ieq 'C:\Thornswood-Server') { return 'main' }
  if ($r -ieq 'C:\Thornswood-Server-Dev') { return 'dev' }
  return ''
}
function Set-ThornswoodRestartNotice([string]$Root, [string]$State, [double]$Minutes = 0, [string]$Why = 'an update') {
  $which = Get-ThornswoodRestartEnvironment $Root
  if (-not $which) { return ('NOTICE NONE: ' + $Root + ' is not the live or the dev server') }
  if (-not (Test-Path -LiteralPath $ThornswoodRestartNoticeDir)) {
    return ('NOTICE FAILED: there is no ' + $ThornswoodRestartNoticeDir + ', which Install-DeployAgent.ps1 makes where the Discord bot runs')
  }
  $file = Join-Path $ThornswoodRestartNoticeDir ('restart-' + $which + '.json')
  $now = (Get-Date).ToUniversalTime()
  $fmt = 'yyyy-MM-ddTHH:mm:ssZ'
  if ($State -eq 'coming') {
    $id = $which + '-' + $now.ToString('yyyyMMdd-HHmmss') + '-hand'
    $down = $now.AddSeconds([int][Math]::Round($Minutes * 60)).ToString($fmt)
    $about = $Why
  } else {
    $raw = ''
    try { $raw = [IO.File]::ReadAllText($file) } catch { $raw = '' }
    # Read by pattern, not ConvertFrom-Json, which in PowerShell 7 turns the
    # time into a local date.
    $field = { param($n) $m = [regex]::Match($raw, '"' + $n + '"\s*:\s*"((?:[^"\\]|\\.)*)"'); if ($m.Success) { $m.Groups[1].Value } else { '' } }
    if ((& $field 'state') -ne 'coming') { return ('NOTICE NONE: no restart of ' + $which + ' was said to be coming') }
    $id = & $field 'id'
    $down = & $field 'downUtc'
    $about = [regex]::Unescape((& $field 'why'))
  }
  $doc = [ordered]@{ environment = $which; id = $id; state = $State; downUtc = $down; why = $about; writtenUtc = $now.ToString($fmt) }
  $tmp = $file + '.new'
  try {
    [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $doc -Compress), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $file -Force -ErrorAction Stop
  } catch {
    return ('NOTICE FAILED: ' + $file + ' could not be written (' + $_.Exception.Message + ')')
  }
  return ('NOTICE SAID: ' + $id + ' ' + $State)
}
# ==== end restart notice ====
'@
