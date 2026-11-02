<#
  ServerReadyWait.ps1

  How long a started game server has to answer on its ports before a deploy
  puts the old files back. Dot-sourced by Swap.ps1 (so Deploy-Server.ps1 and
  Deploy-DevGamemode.ps1 take it), by Publish-Server.ps1, and by
  Install-ThornswoodServer.ps1 on the box, from beside it.

  WHAT IT WAITS FOR. Both ports, from the box itself. UDP is the game port.
  TCP is the resources port (3000 when the game port is 7777, otherwise the
  game port plus one). The resources port is what the launcher and the client
  fetch from, and it only opens once the native server has been built without
  throwing. A log line is not the signal: server.log can print listening
  before that port is up. Swap.ps1's Answering and the installer's Answers
  poll both, and return the moment both answer.

  WHY THIS NUMBER, issue #1938. The wait used to be 60 s, written as a
  default in four scripts at once, not derived from how long a start takes.
  On 5 Oct Live took 66 s from Start-ScheduledTask to both ports answering,
  so a healthy Deploy-Server was rolled back. Dev has taken 113 s. The
  ceiling is half again the worst of those measured starts: a start at the
  recorded times is kept, and a start that never answers still rolls back
  when the ceiling is reached. -Wait on each script overrides it for one run.

  Keep it ASCII. The installer loads it on the box, in PowerShell 7.
#>

# Seconds from start until both ports answered, as measured on the VPS.
$ThornswoodServerReadyLiveSeconds = 66
$ThornswoodServerReadyDevSeconds  = 113
$ThornswoodServerReadyWaitSeconds = [int][Math]::Ceiling(
    [Math]::Max($ThornswoodServerReadyLiveSeconds, $ThornswoodServerReadyDevSeconds) * 1.5)

function Get-ThornswoodServerReadyWait {
    return [int]$ThornswoodServerReadyWaitSeconds
}
