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
  else, to the gate broker (GateBroker.ps1, a SYSTEM task) over the named
  pipe \\.\pipe\thornswood-gate, which only this account and SYSTEM may open
  and no other machine may. The broker decides whether it runs. This file
  holds no rule of its own, so nothing here can be talked into more: the
  account it runs as can do nothing on the box, and the broker trusts
  nothing it is sent but the line.

  What it prints is the broker's answer as it comes, line by line:
      | <text>             a line the verb printed
      @FILE <name> <b64>   part of a file the verb wrote (Get-Logs)
      @REFUSED <why>       the broker did not run it
      @END <code>          the verb's exit code, and this one's
  Exit codes: the verb's own, 64 refused, 65 the broker is not there or went
  away before it said @END.

  PowerShell 7 (pwsh), as sshd's forced command starts it since #5356. It
  loads no module and writes through [Console] only, so nothing reaches stderr as CLIXML
  (#3059).
#>
$ErrorActionPreference = 'Stop'
$out = [Console]::Out
function Say([string]$m) { $out.WriteLine($m); $out.Flush() }

$line = [string]$env:SSH_ORIGINAL_COMMAND
$pipe = $null
try {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', 'thornswood-gate', [IO.Pipes.PipeDirection]::InOut)
    try { $pipe.Connect(20000) }
    catch {
        Say ('@REFUSED the gate broker did not answer in 20 seconds: either it is running another verb, or the task Thornswood Gate is not running (' + $_.Exception.Message + '). Nothing was run.')
        Say '@END 65'
        exit 65
    }
    $enc = New-Object Text.UTF8Encoding($false)
    $w = New-Object IO.StreamWriter($pipe, $enc, 4096, $true)
    $w.NewLine = "`n"
    $w.AutoFlush = $true
    $r = New-Object IO.StreamReader($pipe, $enc, $false, 4096, $true)
    # The request, and only the request: the line in base64, so no character
    # in it can end the request early.
    $w.WriteLine('LINE ' + [Convert]::ToBase64String($enc.GetBytes($line)))
    $code = 65
    $ended = $false
    while ($null -ne ($l = $r.ReadLine())) {
        Say $l
        if ($l -match '^@END (-?[0-9]+)$') { $code = [int]$Matches[1]; $ended = $true; break }
    }
    if (-not $ended) {
        Say '@REFUSED the gate broker went away before it said how the verb ended. Its log on the box, C:\Thornswood-Gate\log\gate.log, says what it ran.'
        Say '@END 65'
    }
    exit $code
}
finally {
    if ($pipe) { $pipe.Dispose() }
}
