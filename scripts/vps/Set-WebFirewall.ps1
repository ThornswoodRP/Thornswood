<#
.SYNOPSIS
  Lets the box take TCP 80 and 443 only from Cloudflare's ranges, so a forged
  SYN from anywhere else gets no SYN-ACK back (#2995). -Open puts both back to
  any address.

.DESCRIPTION
  Issue #2995, Patrick's A on q-2995-syn-fix (21 Oct 2026). The box answered
  every SYN on 443 from anybody, so forged SYNs carrying other people's
  addresses made it send each of them four or five SYN-ACKs: it was one
  reflector of many in an attack on them. BisectHosting declined to filter
  upstream. With thornswood.net behind Cloudflare's proxy every real visitor
  reaches the box from a Cloudflare address, so the box drops everything
  else on 80 and 443 the way it already drops every port nothing allows.

  Runs on your machine. In this order, and it stops at the first thing that
  is not right:

    1. The ranges, from scripts\deploy\cloudflare-ranges.txt. The Caddyfile
       trusts the same list (tests\test-2995-cloudflare-front.ps1 holds the
       two equal), and Watch-Outside.ps1 says when Cloudflare's published
       list moves away from it.
    2. The box's own key. known_hosts here must hold the host key
       scripts\vps\vps.json pins.
    3. On the box: scripts\vps\vps-web-firewall.ps1 runs there, sent through
       Send-Script.ps1. It reads the two rules Setup-Domain.ps1 made
       ("Thornswood Web 80" and "Thornswood Web 443"), any other rule that
       would let 80 or 443 in, the firewall's profiles and where the site's
       name points, and only then changes the two rules and reads them back.
       It refuses while thornswood.net or www still points straight at the
       box, since the scope would then shut everybody out.

  -Check only reads. -WhatIf runs step 3 read only and prints what WOULD
  change. -Open is the way back: both rules take any address again. Turn
  Cloudflare's proxy off only after -Open, or the site is shut to everybody.

  Nothing restarts: the firewall takes the change at once, and a connection
  already open stays open.

.PARAMETER Check
  Only say how the two rules stand, what else lets 80 or 443 in, and where
  the name points. Nothing is changed.

.PARAMETER Open
  Put both rules back to any address.

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as. vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.

.PARAMETER RangesFile
  The list of ranges. scripts\deploy\cloudflare-ranges.txt by default.

.PARAMETER OnTheBox
  Run the box half here, on the box, with no ssh: the deploy gate's verb
  Set-WebFirewall, which runs it as SYSTEM from main (#5334), so a cloud
  session scopes the two rules with

      pwsh scripts/vps/Box-Run.ps1 -Line 'Set-WebFirewall'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Set-WebFirewall -Check'

  The gate has no -Open: putting the rules back to any address stays a step
  for a machine with the box's key.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  .\scripts\vps\Set-WebFirewall.ps1 -Check
  Says how 80 and 443 stand on the box. Changes nothing.

.EXAMPLE
  .\scripts\vps\Set-WebFirewall.ps1 -WhatIf
  Says what it would change.

.EXAMPLE
  .\scripts\vps\Set-WebFirewall.ps1
  Takes 80 and 443 only from Cloudflare's ranges, once the name points at
  Cloudflare.

.EXAMPLE
  .\scripts\vps\Set-WebFirewall.ps1 -Open
  Puts 80 and 443 back to any address.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch]$Check,
    [switch]$Open,
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [string]$RangesFile = '',
    [switch]$OnTheBox,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here '..\deploy\CloudflareRanges.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }
if (-not $RangesFile) { $RangesFile = Join-Path (Split-Path -Parent $Here) 'deploy\cloudflare-ranges.txt' }

$BoxScript = Join-Path $Here 'vps-web-firewall.ps1'
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

function Clean($lines) {
    @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

function Invoke-Box([string]$mode) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($OnTheBox) {
        # The same file, run here with the same words (the ranges come from
        # the checkout's own list, read and checked above).
        $global:LASTEXITCODE = 0
        $out = Clean @(& ([scriptblock]::Create("& '" + $BoxScript.Replace("'", "''") + "' " + $mode)) 2>&1)
    } else {
        $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $mode
        $out = Clean @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    }
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in $out) {
        $c = 'Gray'
        if ($l -match '^CHANGED ' -or $l -match '^RULE \d+ SCOPED to the \d+ ranges given$' -or $l -match ', inside the ranges$') { $c = 'Green' }
        elseif ($l -match '^(WOULD|ALSO) ' -or $l -match '^RULE \d+ (OPEN|SCOPED to \d+ addresses)' -or $l -match ', OUTSIDE the ranges$') { $c = 'Yellow' }
        elseif ($l -match '^STOP ') { $c = 'Red' }
        elseif ($l -match '^(ALREADY|PROFILE|DONE) ') { $c = 'DarkGray' }
        Say "  $l" $c
    }
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }

Write-Host ''
Write-Host '  THORNSWOOD  -  who the box takes 80 and 443 from' -ForegroundColor White
Say "  $User@$Vps" 'DarkGray'

if ($OnTheBox) { Say '  here, on the box, through the deploy gate' 'DarkGray' }
if ($OnTheBox -and $Open) { Die '-Open is not run through the gate. Nothing was changed.' }
if (-not $OnTheBox -and -not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die 'ssh is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client.' }
if ($Check -and $Open) { Die '-Check only reads, so it does not go with -Open.' }

Head "1. Cloudflare's ranges"
try { $ranges = Read-ThornswoodCloudflareRanges $RangesFile } catch { Die ($_.Exception.Message + ' Nothing was changed.') }
Say ("  " + $ranges.Count + ' ranges from ' + $RangesFile) 'Green'
$rangeArg = "-Ranges '" + ($ranges -join ',') + "'"

if (-not $OnTheBox) {
    Head "2. The box's own key"
    $hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
    if ($hk.Status -ne 'trusted') {
        Die ("known_hosts does not hold the key scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 first. Nothing was changed.')
    }
    Say '  known_hosts holds the pinned key' 'Green'
}

if ($Check) {
    Head '3. On the box, read only'
    $box = Invoke-Box ('-Check ' + $rangeArg)
    if ($box.Code -ne 0 -or -not (Has $box.Lines '^RULE 443 ')) { Die ('The box did not say how the rules stand (exit ' + $box.Code + '). Run .\scripts\vps\Setup-SshKey.ps1 -Test if it did not answer at all.') }
    Done 0
}

$what = if ($Open) { 'let TCP 80 and 443 in from any address' } else { "let TCP 80 and 443 in only from Cloudflare's " + $ranges.Count + ' ranges' }
$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", $what)
Head $(if ($doIt) { '3. On the box' } else { '3. On the box, read only' })
$mode = @($(if ($Open) { '-Open' } else { '-Apply' }), $rangeArg)
if (-not $doIt) { $mode += '-DryRun' }
$box = Invoke-Box ($mode -join ' ')
if (Has $box.Lines '^STOP ') { Die ('The box stopped (exit ' + $box.Code + '). The lines above say why.') }
if ($box.Code -ne 0) { Die ('The box did not finish (exit ' + $box.Code + '). Run this with -Check to read where it stands.') }
if (-not $doIt) { Write-Host ''; Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'; Done 0 }
if ($Open) { Say '  80 and 443 take any address again. Cloudflare''s proxy can be turned off now.' 'Green' }
else { Say '  80 and 443 take only Cloudflare''s ranges. Check-Site.ps1 says whether the site still answers through Cloudflare.' 'Green' }
Done 0
