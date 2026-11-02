<#
  Read-Online.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Read-Online'     from any session with gh, a cloud thread included
      .\scripts\vps\Read-Online.ps1                         from any machine that reaches the box's game ports

  Says how many people are on each game server, live and dev, from the
  online.json each server announces on its resources port (3000 live, 7788
  dev), the same file Restart-Server.ps1 and the launcher read. Read only:
  it asks two web addresses and changes nothing.

  WHY THIS EXISTS. "Nobody on" is the quiet hour: a server's change runs now
  when its online.json says 0. Until this, that number was read only from One
  or the box, because the box's game ports do not answer a cloud thread (its
  network stops them; measured 31 Oct 2026, both ports timed out from the
  cloud), so every cloud thread that needed it handed the read to the Local
  Desk. Through the deploy gate it runs on the box itself.

  It prints one line per server:
      live: 0 on (most 30)
      dev: could not read http://<box>:7788/online.json: <why>
  and ends 0 when both were read, 1 when either was not. A server that does
  not answer is not counted as nobody on: the caller decides what an unread
  server means.

  PowerShell 7, on the box and anywhere.
#>
[CmdletBinding()]
param(
    [string]$Vps = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

$bad = 0
foreach ($s in @(@{ Name = 'live'; Port = 3000 }, @{ Name = 'dev'; Port = 7788 })) {
    $url = 'http://' + $Vps + ':' + $s.Port + '/online.json'
    try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec 15 -UseBasicParsing
        $j = $r.Content | ConvertFrom-Json
        if ($null -eq $j.now) { throw 'it has no "now" count' }
        $most = if ($null -ne $j.max) { ' (most ' + [int]$j.max + ')' } else { '' }
        Write-Output ($s.Name + ': ' + [int]$j.now + ' on' + $most)
    }
    catch {
        $bad++
        Write-Output ($s.Name + ': could not read ' + $url + ': ' + $_.Exception.Message)
    }
}
exit $(if ($bad) { 1 } else { 0 })
