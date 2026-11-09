<#
  RunnerEgress.ps1

  The box runners' way out (#5495), as Install-RunnerEgress.ps1, which puts
  the proxy on the box, needs it. Install-Runner.ps1 sent tw-hermes-box
  through it until that runner came off on 9 Nov 2026 (#5565). Dot-source it.

  Get-ThornswoodRunnerEgress reads records\runner-egress.json and gives its
  listen address, port and the proxy's URL as a runner's .env names it.
  Get-ThornswoodEgressAskScript gives, as source to run on the box, the
  function Ask-Egress, which asks the proxy for a host and says its status
  line: HTTP/1.1 200 for a host on the list, 403 for one that is not, or
  why nothing answered. It sends no TLS after a 200, so the proxy closes the
  tunnel and logs that; nothing leaves the box for a question.

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads what is sent as
  ANSI.
#>

function Get-ThornswoodRunnerEgress([string]$RepoDir) {
    $file = Join-Path $RepoDir 'records\runner-egress.json'
    $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $listen = [string]$record.listen
    if ($listen -notmatch '^127\.0\.0\.1:(\d{2,5})$') { throw "records\runner-egress.json's listen ($listen) is not 127.0.0.1:<port>" }
    $port = [int]$Matches[1]
    if ($port -lt 1 -or $port -gt 65535) { throw "records\runner-egress.json's listen ($listen) has no port a socket can have" }
    [pscustomobject]@{ Listen = $listen; Port = $port; Url = 'http://' + $listen; Allow = @($record.allow | ForEach-Object { [string]$_ }) }
}

function Get-ThornswoodEgressAskScript {
    return @'
function Ask-Egress([int]$port, [string]$hostName) {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $t = $c.ConnectAsync('127.0.0.1', $port)
    if (-not $t.Wait(5000)) { return 'no answer on 127.0.0.1:' + $port }
    $s = $c.GetStream()
    $s.ReadTimeout = 5000
    $b = [Text.Encoding]::ASCII.GetBytes('CONNECT ' + $hostName + ':443 HTTP/1.1' + "`r`n" + 'Host: ' + $hostName + ':443' + "`r`n`r`n")
    $s.Write($b, 0, $b.Length)
    $buf = New-Object byte[] 256
    $n = $s.Read($buf, 0, $buf.Length)
    return ([Text.Encoding]::ASCII.GetString($buf, 0, $n) -split "`r`n")[0]
  } catch { return 'no answer on 127.0.0.1:' + $port + ': ' + $_.Exception.GetBaseException().Message }
  finally { $c.Close() }
}
'@
}
