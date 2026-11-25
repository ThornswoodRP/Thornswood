<#
  Gate.ps1

  The deploy key's forced command (#2841). It runs on the box as
  thornswood-deploy, an account with no administrator rights, whatever the
  client asked for: the key's line in that account's authorized_keys says
  restrict,from="127.0.0.1",command="... -File C:\Thornswood-Gate\Gate.ps1",
  so sshd runs this and nothing else, with no shell, file copy or forwarding.
  scripts\deploy\Install-Gate.ps1 puts it on the box.

  What the client asked for arrives in SSH_ORIGINAL_COMMAND, as one line
  (GateRules.ps1 says what a line is). This hands that line, and nothing
  else, to the gate broker (GateBroker.ps1, a SYSTEM task) over its named
  pipes, which only this account and SYSTEM may open and no other machine
  may. The broker decides whether it runs. This file holds no rule of its
  own, so nothing here can be talked into more: the account it runs as can
  do nothing on the box, and the broker trusts nothing it is sent but the
  line.

  TWO PIPES (#6231). The line goes first to \\.\pipe\thornswood-gate-read,
  the broker's read lane, which answers a ping at once and runs a verb
  main's verbs.json marks onlyReads beside whatever else runs. For any
  other verb it answers @CHANGE and what the gate runs now, and the line
  goes to \\.\pipe\thornswood-gate, which runs one such verb at a time.
  Until then one pipe took every line, so a content build the deploy agent
  started after each merge to main held a ping or a log read for its whole
  six minutes, and Box-Run was refused after this file's 20 seconds.

  What it prints is the broker's answer as it comes, line by line:
      | <text>             a line the verb printed
      @FILE <name> <b64>   part of a file the verb wrote (Get-Logs)
      @REFUSED <why>       the broker did not run it
      @END <code>          the verb's exit code, and this one's
      @CHANGE <what runs>  the read lane hands the line to the other pipe;
                           this is never printed
  Exit codes: the verb's own, 64 refused, 65 the broker is not there, did
  not take the line, or went away before it said @END, and 66 main cannot be
  read (GitHub did not answer for main on a ping, or main could not be read
  before a run).

  PowerShell 7 (pwsh), as sshd's forced command starts it since #5356. It
  loads no module and writes through [Console] only, so nothing reaches stderr as CLIXML
  (#3059).
#>
$ErrorActionPreference = 'Stop'
$out = [Console]::Out
function Say([string]$m) { $out.WriteLine($m); $out.Flush() }

$line = [string]$env:SSH_ORIGINAL_COMMAND
$enc = New-Object Text.UTF8Encoding($false)
# One exchange with one of the broker's pipes: the line, then its answer as
# it comes. Returns the exit code, or the text after @CHANGE when the read
# lane hands the line on.
function Ask([string]$Pipe, [string]$Refused) {
    $p = $null
    try {
        $p = New-Object IO.Pipes.NamedPipeClientStream('.', $Pipe, [IO.Pipes.PipeDirection]::InOut)
        try { $p.Connect(20000) }
        catch {
            Say ('@REFUSED ' + $Refused + ' (' + $_.Exception.Message + '). Nothing was run.')
            Say '@END 65'
            return 65
        }
        $w = New-Object IO.StreamWriter($p, $enc, 4096, $true)
        $w.NewLine = "`n"
        $w.AutoFlush = $true
        $r = New-Object IO.StreamReader($p, $enc, $false, 4096, $true)
        # The request, and only the request: the line in base64, so no
        # character in it can end the request early.
        $w.WriteLine('LINE ' + [Convert]::ToBase64String($enc.GetBytes($line)))
        while ($null -ne ($l = $r.ReadLine())) {
            if ($l -match '^@CHANGE(?: (.*))?$') { return [pscustomobject]@{ Holds = [string]$Matches[1] } }
            Say $l
            if ($l -match '^@END (-?[0-9]+)$') { return [int]$Matches[1] }
        }
        Say '@REFUSED the gate broker went away before it said how the verb ended. Its log on the box, C:\Thornswood-Gate\log\gate.log, says what it ran.'
        Say '@END 65'
        return 65
    }
    finally {
        if ($p) { $p.Dispose() }
    }
}

$code = Ask 'thornswood-gate-read' 'the gate broker did not answer in 20 seconds: either the task Thornswood Gate is not running, or its read lane is running another read'
if ($code -is [int]) { exit $code }
$holds = if ($code.Holds) { 'it is running ' + $code.Holds } else { 'it said it was running nothing a moment ago' }
exit (Ask 'thornswood-gate' ('the gate did not take this verb within 20 seconds: it runs one verb that changes the box at a time, and ' + $holds))
