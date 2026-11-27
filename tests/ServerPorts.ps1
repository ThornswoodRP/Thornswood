<#
  ServerPorts.ps1
  Runs a script with a stand-in for the machine's UDP port list, so a harness
  decides whether a game server looks to be running (#4243). Reset-Appearance.ps1
  and New-Character.ps1 stop while something holds their server's game port
  (scripts\ops\World-Server.ps1), and a harness must not pass or fail on
  whatever the machine running it happens to hold, nor stop on Linux, which
  has no Get-NetUDPEndpoint.

      & $ps -NoProfile -NonInteractive -File tests\ServerPorts.ps1 <script> <its arguments>

  The ports held are $env:THORNSWOOD_TEST_UDP_HELD, numbers joined by commas;
  unset or empty holds none. The script's exit code is this one's.
#>
function Get-NetUDPEndpoint {
    param($ErrorAction)
    foreach ($p in @("$env:THORNSWOOD_TEST_UDP_HELD" -split ',' | Where-Object { $_ })) {
        [pscustomobject]@{ LocalPort = [int]$p; OwningProcess = $PID }
    }
}
$script = $args[0]
$rest = @($args | Select-Object -Skip 1)
$global:LASTEXITCODE = 0
& $script @rest
exit $LASTEXITCODE
