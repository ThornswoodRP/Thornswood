<#
  ServerReadyWait.ps1

  How long a started game server has to answer on its ports before a deploy
  puts the old files back. Who takes it:
    - dot-sourced by Swap.ps1, so Deploy-Server.ps1 and Deploy-DevGamemode.ps1
      take it, and by Publish-Server.ps1, which also copies it to the box;
    - dot-sourced by Install-ThornswoodServer.ps1 on the box, from beside it;
    - read as text and joined into the script that runs on the box by
      Reset-Character.ps1, Reset-Npcs.ps1 and Move-World.ps1, which take
      their wait from Get-ThornswoodServerReadyWait there and have no -Wait
      of their own.
  tests\test-4570-ready-wait-callers.ps1 holds this list to the scripts.

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
  when the ceiling is reached. -Wait on the deploy scripts and the installer
  overrides it for one run.

  Keep it ASCII. The installer loads it on the box, in PowerShell 7, and the
  three scripts above send its text to the box inside theirs.
#>

# Seconds from start until both ports answered, as measured on the VPS.
$ThornswoodServerReadyLiveSeconds = 66
$ThornswoodServerReadyDevSeconds  = 113
$ThornswoodServerReadyWaitSeconds = [int][Math]::Ceiling(
    [Math]::Max($ThornswoodServerReadyLiveSeconds, $ThornswoodServerReadyDevSeconds) * 1.5)

function Get-ThornswoodServerReadyWait {
    return [int]$ThornswoodServerReadyWaitSeconds
}
