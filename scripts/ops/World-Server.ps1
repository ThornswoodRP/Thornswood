<#
  World-Server.ps1

  Whether the game server whose change forms a folder holds is running
  (#4243). Dot-sourced by Reset-Appearance.ps1 and New-Character.ps1; it does
  nothing on its own.

  A running server holds its change forms in memory and writes them out on
  its own schedule, so an edit or a delete made underneath it is written
  straight back. Both scripts said so in their headers and only printed a
  yellow line when any node process was running, then went on and ended in
  green. Any node is not the server either: the site and the bot are node
  too. The server is the one holding its game port, which is how
  Reset-Character.ps1 and Move-World.ps1 find it.

  Get-ThornswoodWorldServerStop returns $null when the server is not running,
  and otherwise the line that says why nothing can be changed yet: the
  folder is not a server's world\changeForms, its server-settings.json will
  not parse, the UDP ports could not be listed, or something holds the port.
#>

function Get-ThornswoodWorldServerStop([string]$World) {
  $worldDir = Split-Path -Parent $World
  $root = if ($worldDir) { Split-Path -Parent $worldDir } else { '' }
  if ((Split-Path -Leaf $World) -ne 'changeForms' -or (Split-Path -Leaf $worldDir) -ne 'world' -or -not $root) {
    return "$World is not a server's world\changeForms, so which server holds these change forms, and whether it is running, is not known."
  }
  $settings = Join-Path $root 'server-settings.json'
  # The engine's own port when server-settings.json names none (skymp5-server/ts/settings.ts).
  $port = 7777
  if (Test-Path -LiteralPath $settings) {
    $cfg = $null
    try { $cfg = [IO.File]::ReadAllText($settings) -replace '^\uFEFF', '' | ConvertFrom-Json }
    catch { return "$settings will not parse ($($_.Exception.Message)), so the server's port, and whether it is running, is not known." }
    if ($cfg -and $cfg.PSObject.Properties['port']) {
      $p = 0
      if (-not [int]::TryParse([string]$cfg.port, [ref]$p) -or $p -le 0) {
        return "$settings names a port that is not a number above 0 ($($cfg.port)), so whether the server is running is not known."
      }
      $port = $p
    }
  }
  $owners = @()
  try { $owners = @(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object { [int]$_.LocalPort -eq $port } | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique) }
  catch { return "The UDP ports could not be listed to find the server on $port ($($_.Exception.Message)), so whether it is running is not known." }
  if (-not $owners.Count) { return $null }
  $who = @($owners | ForEach-Object {
    $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($proc) { "$($proc.ProcessName) pid $_" } else { "pid $_" } }) -join ', '
  return "The server for $root is running: UDP $port is held by $who. Stop it first, or it writes its change forms back over this."
}
