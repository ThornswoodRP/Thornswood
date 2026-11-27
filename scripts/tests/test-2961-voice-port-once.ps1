<#
  test-2961-voice-port-once.ps1

      pwsh -NoProfile -File .\scripts\tests\test-2961-voice-port-once.ps1

  Install-Voice.ps1's "Checking from here" tries the voice port from outside
  once, says what it answered, and does not call a port shut from a machine
  that reaches no raw port on the box.

  WHY THIS EXISTS. Issue #2961: the check tried up to 15 times a second
  apart, waiting for nothing. Measured on 21 Oct 2026, the firewall rule an
  install makes is in force when New-NetFirewallRule returns, and it is made
  before the old voice is stopped, so by this point it has been in force for
  the whole swap. And from a cloud thread, whose container reaches nothing
  but HTTPS through its proxy, every raw port is silent, so a loopback
  install there printed "correctly shut" whatever the firewall did.

  HOW. Install-Voice.ps1 reaches the VPS the moment it runs, so it is parsed
  and never run. The try is Vps.ps1's Get-ThornswoodPortTry (#2975), run
  here against a listener and a closed port on this machine's loopback. The
  lines that decide what to say are lifted as text and run with that try
  stood in under Test-ThornswoodFromOutside, once for each answer the voice
  port and the game server's port can give, and what they print is held to
  what each case means.

  Never connects to anything off this machine.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $RepoPath) { $RepoPath = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
trap { Yes ('the run finished without an error: ' + $_.Exception.Message) $false; Done }

# ---- the script, parsed ----------------------------------------------------
$installPath = Join-Path $RepoPath 'scripts\deploy\Install-Voice.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$tokens, [ref]$errors)
Yes 'Install-Voice.ps1 parses' (-not $errors.Count)
$text = Get-Content -LiteralPath $installPath -Raw

$from = $text.IndexOf("Head 'Checking from here'")
$to = $text.IndexOf("# The service's files are in place")
Yes 'the check is there, before the record is written' ($from -gt 0 -and $to -gt $from)
$verify = $text.Substring($from, $to - $from)
$code = ($verify -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
$code = [regex]::Replace($code, '(?s)<#.*?#>', '')
Yes 'the check has no loop' ($code -notmatch '\b(for|foreach|while|do)\s*[\({]')
Yes '  and sleeps for nothing' ($code -notmatch 'Start-Sleep')

Yes '  and has no try of its own' ($code -notmatch 'TcpClient')
. (Join-Path $RepoPath 'scripts\vps\Vps.ps1')

# ---- the try, on loopback --------------------------------------------------
$VpsHost = '127.0.0.1'
$l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$l.Start()
$open = $l.LocalEndpoint.Port
$watch = [Diagnostics.Stopwatch]::StartNew()
$r = Get-ThornswoodPortTry $VpsHost $open
Yes "a port something listens on answered ($r, $($watch.ElapsedMilliseconds) ms)" ($r -eq 'answered')
$l.Stop()
$watch.Restart()
$r = Get-ThornswoodPortTry $VpsHost $open
Yes "  and with nothing on it, it is refused ($r)" ($r -eq 'refused' -or $r -like 'silent*')
Yes '  at once, not after the 5 s a silent port gets' ($watch.ElapsedMilliseconds -lt 4000)
$VpsHost = 'no-such-box.invalid'
$r = Get-ThornswoodPortTry $VpsHost $open
Yes "a name that does not resolve was not tried, and says why ($r)" ($r -like 'not tried: *' -and $r.Length -gt 11)

# A lookup slow to fail is not a silent port (#7423): the name is looked up
# before the port is tried, outside its 5 s. A lookup that takes 6 s and
# finds nothing is still "not tried", with the lookup's reason.
$try = (Get-Command Get-ThornswoodPortTry).ScriptBlock.Ast
$calls = @($try.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Member.Extent.Text -eq 'BeginConnect' }, $true))
$lookup = @($try.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Resolve-ThornswoodAddress' }, $true))
Yes 'the try looks the name up first, then connects to what it found, never to the name' (
    $calls.Count -eq 1 -and $lookup.Count -eq 1 -and $lookup[0].Extent.StartOffset -lt $calls[0].Extent.StartOffset -and
    $calls[0].Arguments[0].Extent.Text -notmatch '\$Address')
function Resolve-ThornswoodAddress([string]$Address) {
    Start-Sleep -Milliseconds 6000
    throw [Net.Sockets.SocketException]::new(11001)
}
$watch.Restart()
$r = Get-ThornswoodPortTry 'slow-to-fail.invalid' $open
Yes "  a lookup that takes 6 s to find nothing is not tried, and says why ($r, $($watch.ElapsedMilliseconds) ms)" ($r -like 'not tried: *' -and $r.Length -gt 11 -and $r -notlike 'silent*')
Remove-Item Function:\Resolve-ThornswoodAddress
. (Join-Path $RepoPath 'scripts\vps\Vps.ps1')

# ---- what it says, for each answer -----------------------------------------
$start = $verify.IndexOf('$resPort = ')
Yes 'the one try is Test-ThornswoodFromOutside $VpsHost $Port $resPort' ($start -gt 0 -and ([regex]::Matches($code, 'Test-ThornswoodFromOutside')).Count -eq 1 -and $verify.Contains('Test-ThornswoodFromOutside $VpsHost $Port $resPort'))
$decide = [scriptblock]::Create($verify.Substring($start))

function Case([string]$bind, [string]$channel, [string]$voice, [string]$res, [string]$siteOrigin = 'https://example.invalid') {
    $script:said = @()
    $script:asked = @()
    $answers = @{ voice = $voice; res = $res }
    $env:THORNSWOOD_TEST_CASE = ''
    $sb = {
        param($bind, $channel, $answers, $siteOrigin)
        $Bind = $bind; $voiceChannel = $channel
        $Port = $(if ($channel -eq 'dev') { 7789 } else { 7778 })
        $VpsHost = '192.0.2.1'; $Site = $siteOrigin; $Root = 'C:\Voice'; $target = 'a@b'; $TaskName = 'Thornswood Dev Voice'
        function Get-ThornswoodPortTry([string]$a, [int]$p) {
            $script:asked += $p
            if ($p -eq $Port) { return $answers.voice }
            return $answers.res
        }
        function Say($m, $c = 'Gray') { $script:said += ($c + ': ' + $m) }
        function Write-Host { }
        # What the site's /voice/health says to anybody since #3806: ok, and nothing more.
        function Invoke-RestMethod { return [pscustomobject]@{ ok = $true } }
        . $decide
    }
    & $sb $bind $channel $answers $siteOrigin
    return [pscustomobject]@{ Said = ($script:said -join "`n"); Asked = $script:asked }
}

$c = Case '127.0.0.1' 'dev' 'silent for 5 s' 'answered'
Yes 'loopback, silent, and the dev server answers: correctly shut, in green' ($c.Said -match 'Green: Loopback only, and 192\.0\.2\.1:7789 is correctly shut from out here \(silent for 5 s\)')
Yes '  asking the dev server''s 7788' ($c.Asked -join ',' -eq '7789,7788')
Yes '  and says what carries it' ($c.Said -match 'Green: Reached it through https://example\.invalid/voice-dev, which says ok')

$c = Case '127.0.0.1' 'dev' 'silent for 5 s' 'answered' 'http://127.0.0.1:3001'
Yes 'the local Site still sends the outside check through the public voice route' ($c.Said -match 'Green: Reached it through https://thornswood\.net/voice-dev, which says ok')

$c = Case '127.0.0.1' 'main' 'silent for 5 s' 'silent for 5 s'
Yes 'loopback, silent, and live''s 3000 silent too (a cloud thread): not known, in yellow' ($c.Said -match 'Yellow: Loopback only, and whether 192\.0\.2\.1:7778 is shut from outside is not known: this machine reaches no raw port on the box')
Yes '  never "correctly shut"' ($c.Said -notmatch 'correctly shut')
Yes '  asking live''s 3000' ($c.Asked -join ',' -eq '7778,3000')
Yes '  and still says what carries it, over HTTPS' ($c.Said -match 'Reached it through https://example\.invalid/voice\b')

$c = Case '127.0.0.1' 'dev' 'answered' 'answered'
Yes 'loopback and answering from outside: red' ($c.Said -match 'Red: 192\.0\.2\.1:7789 IS STILL ANSWERING')
Yes '  with one try and nothing else asked' ($c.Asked -join ',' -eq '7789')

$c = Case '0.0.0.0' 'dev' 'answered' 'answered'
Yes 'every interface and answering: up, in green, one try' ($c.Said -match 'Green: Voice is up at http://192\.0\.2\.1:7789' -and $c.Asked -join ',' -eq '7789')

$c = Case '0.0.0.0' 'dev' 'silent for 5 s' 'answered'
Yes 'every interface, silent, and the dev server answers: red, saying what it was' ($c.Said -match 'Red: Installed, but 192\.0\.2\.1:7789 was silent for 5 s from out here')
Yes '  and pointing at the firewall rule' ($c.Said -match "Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName 'Thornswood Dev Voice'")

$c = Case '0.0.0.0' 'dev' 'refused' 'answered'
Yes 'every interface and refused: red, saying refused' ($c.Said -match 'Red: Installed, but 192\.0\.2\.1:7789 was refused from out here')

$c = Case '0.0.0.0' 'dev' 'silent for 5 s' 'silent for 5 s'
Yes 'every interface, from a machine that reaches no raw port: not known, in yellow, not a failure' ($c.Said -match 'Yellow: Voice answers on the box, and whether 192\.0\.2\.1:7789 answers from outside is not known' -and $c.Said -notmatch 'Red:')

$c = Case '0.0.0.0' 'dev' 'not tried: No such host is known' 'answered'
Yes 'a try that threw: not known, saying why, and the game port is not asked' ($c.Said -match 'Yellow: .*not known: it could not be tried: No such host is known' -and $c.Asked -join ',' -eq '7789')

Done
