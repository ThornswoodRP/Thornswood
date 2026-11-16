<#
  ServerFolderTurn.ps1

  One turn at the game server folders, for the nightly backup and for the
  scripts that stop a game server and swap its files (#3247).

  Its text goes where StopAndMove.ps1's does for a game server: Swap.ps1 puts
  it in front of the game server swap block (Deploy-Server,
  Deploy-DevGamemode, and their -PutBack), Install-ThornswoodServer.ps1
  carries an exact copy, and so does vps-nightly-backup.ps1, which runs on its
  own on the box. scripts\tests\test-3247-server-folder-turn.ps1 fails when a copy
  and this file differ. It is not in StopAndMove.ps1, whose rule is that
  nothing in it sleeps or tries again (#2928): this waits for its turn, which
  is not a rename tried again. Keep it ASCII: Windows PowerShell 5.1 on the
  box reads a file with no byte order mark as ANSI.
#>

# The server folders' turn (#3247). The nightly backup reads each game
# server's folder while it runs, and a server install or deploy stops that
# server and renames its folder or its files. On 22 Oct 2026 at 2:21 AM a dev
# publish stopped dev and was refused the folder swap ("Access to the path is
# denied"), because the backup, started 2:15 AM, still had files open under
# it: its log has game-dev\world taken from 2:19:33 to 2:22:00 AM, and the
# dev folders done at 2:27:01 AM. Nothing made the two take turns.
#
# So each takes the turn first: the backup for as long as it reads the server
# folders, an install or a deploy before it stops a server, held until the
# script ends. The turn is server-folders.turn in the backup's own folder
# (C:\Thornswood-Backup on the box, beside the server folders), opened with
# no sharing, so only one process at a time has it open, and Windows gives
# it back when that process ends however it ends: no turn is ever left taken
# by a run that died. Whoever has it writes who and since when beside it, in
# server-folders.turn.who, for the one waiting to say. With no backup folder
# beside the server folders (a scratch root in a harness, a box the backup
# was never installed on) there is nothing to take turns with, and it hands
# back $null.
#
# Hands back the open file, which the caller keeps until it is done; throws
# when the turn has not come in $WaitSeconds, naming who has it, so the
# caller refuses with nothing stopped. $Tell says the one line about waiting.
function Enter-ThornswoodServerFolderTurn([string]$Folder, [string]$Who, [int]$WaitSeconds, [scriptblock]$Tell) {
  if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return $null }
  $turn = Join-Path $Folder 'server-folders.turn'
  $note = Join-Path $Folder 'server-folders.turn.who'
  $until = (Get-Date).AddSeconds($WaitSeconds)
  $told = $false
  while ($true) {
    try {
      $held = [IO.File]::Open($turn, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      [IO.File]::WriteAllText($note, ($Who + ', pid ' + $PID + ', since ' + (Get-Date).ToString('h:mm:ss tt')))
      return $held
    } catch [IO.IOException] {
      # Only "another process has it open" is a wait: 0x80070020 or 21 on
      # Windows, 11 where .NET locks with flock. Anything else is thrown.
      $e = $_.Exception
      if ($e.GetType() -ne [IO.IOException] -or @(0x80070020, 0x80070021, 11) -notcontains $e.HResult) { throw }
      $who = ''
      try { $who = [IO.File]::ReadAllText($note).Trim() } catch { $who = 'a run that has not said who it is (' + $_.Exception.Message + ')' }
      if ((Get-Date) -ge $until) { throw ('the server folders are still taken after ' + $WaitSeconds + ' s, by ' + $who) }
      if (-not $told) { [void](& $Tell ('waiting for the server folders, which ' + $who + ' has')); $told = $true }
      Start-Sleep -Seconds 2
    }
  }
}
