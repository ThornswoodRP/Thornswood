<#
  test-2975-server-port-once.ps1

      pwsh -NoProfile -File .\scripts\tests\test-2975-server-port-once.ps1

  Publish-Server.ps1 and Deploy-Server.ps1 try the resources port from
  outside once, through Vps.ps1's Test-ThornswoodFromOutside, say what it
  answered, and do not call the port shut from a machine that reaches no raw
  port on the box.

  WHY THIS EXISTS. Issue #2975: after the box had already had the new server
  answer on both its ports (INSTALL OK, SWAP OK), Publish-Server tried the
  resources port up to 30 times two seconds apart, and Deploy-Server, which
  copied its shape, up to 10. That waited for nothing. Measured on the box on
  21 Oct 2026: 3000 and 7788 each listen on :: with one node process, the
  socket the box's own check finds, and their inbound allow rules are
  standing ones with remote Any, made when the box was set up. And from a
  cloud thread, whose container reaches nothing but HTTPS, every raw port is
  silent, so the loop always ended in "nothing is answering".

  HOW. Vps.ps1 is dot-sourced, and its two functions are run against a
  listener and closed ports on this machine's loopback. Both scripts reach
  the VPS the moment they run, so they are parsed and never run: the lines
  that decide what to say are lifted as text and run with the outside try
  stood in, once for each answer it can give, and what they print and
  whether they stop the run are held to what each case means.

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

# ---- Vps.ps1's try, on loopback --------------------------------------------
. (Join-Path $RepoPath 'scripts\vps\Vps.ps1')
Yes 'Vps.ps1 has Get-ThornswoodPortTry' ($null -ne (Get-Command Get-ThornswoodPortTry -ErrorAction SilentlyContinue))
Yes '  and Test-ThornswoodFromOutside' ($null -ne (Get-Command Test-ThornswoodFromOutside -ErrorAction SilentlyContinue))

$l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$l.Start()
$open = $l.LocalEndpoint.Port
$s = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$s.Start()
$shut = $s.LocalEndpoint.Port
$s.Stop()

$watch = [Diagnostics.Stopwatch]::StartNew()
$r = Get-ThornswoodPortTry '127.0.0.1' $open
Yes "a port something listens on answered ($r, $($watch.ElapsedMilliseconds) ms)" ($r -eq 'answered')
$watch.Restart()
$r = Get-ThornswoodPortTry '127.0.0.1' $shut
Yes "  and one with nothing on it is refused ($r)" ($r -eq 'refused')
Yes '  at once, not after the 5 s a silent port gets' ($watch.ElapsedMilliseconds -lt 4000)
$r = Get-ThornswoodPortTry 'no-such-box.invalid' $open
Yes "a name that does not resolve was not tried, and says why ($r)" ($r -like 'not tried: *' -and $r.Length -gt 11)

$o = Test-ThornswoodFromOutside '127.0.0.1' $open $shut
Yes 'answered: Answered, and nothing not known' ($o.Answered -and $o.Said -eq 'answered' -and -not $o.NotKnown)
$o = Test-ThornswoodFromOutside '127.0.0.1' $shut $open
Yes 'refused while the witness answers: a measurement, not answered' (-not $o.Answered -and $o.Said -eq 'refused' -and -not $o.NotKnown)
$o = Test-ThornswoodFromOutside '127.0.0.1' $shut $shut
Yes 'refused and the witness refused too: not known, naming the witness' (-not $o.Answered -and $o.NotKnown -match "reaches no raw port on the box: $shut, which answers everybody, was refused as well")
$o = Test-ThornswoodFromOutside 'no-such-box.invalid' $open $open
Yes 'a try that threw: not known, saying why' (-not $o.Answered -and $o.NotKnown -like 'it could not be tried: *')
$l.Stop()

# ---- the two scripts, parsed -----------------------------------------------
function Lift([string]$file, [string]$fromText, [string]$toText) {
    $path = Join-Path $RepoPath $file
    $tokens = $null; $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Yes "$file parses" (-not $errors.Count)
    # A Windows checkout has CRLF line ends, and the markers are written with LF.
    $text = (Get-Content -LiteralPath $path -Raw).Replace("`r`n", "`n")
    $from = $text.IndexOf($fromText)
    $to = $text.IndexOf($toText, [Math]::Max($from, 0))
    Yes '  its check from here is there' ($from -gt 0 -and $to -gt $from)
    $block = $text.Substring($from, $to + $toText.Length - $from)
    $code = ($block -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    Yes '  with no loop' ($code -notmatch '\b(for|foreach|while|do)\s*[\({]')
    Yes '  sleeping for nothing' ($code -notmatch 'Start-Sleep')
    Yes '  and one try, through Test-ThornswoodFromOutside' (([regex]::Matches($code, 'Test-ThornswoodFromOutside')).Count -eq 1 -and $code -notmatch 'TcpClient')
    Yes '  whose witness is the other server''s resources port' ($code -match '\$witness = if \(\$resPort -eq 3000\) \{ 7788 \} else \{ 3000 \}')
    # An exit in the lifted text would end this test, so it is turned into a
    # return that says it was reached.
    return $code.Replace('exit 1', '$script:exited = $true; return')
}

$publish = Lift 'scripts\release\Publish-Server.ps1' "Head 'Checking it answers'" '# ------------------------------------------------------------------ news ----'
$deploy = Lift 'scripts\deploy\Deploy-Server.ps1' '# And from here, the shape Publish-Server.ps1 uses' "`n}`n"
$pubText = Get-Content -LiteralPath (Join-Path $RepoPath 'scripts\release\Publish-Server.ps1') -Raw
Yes 'Publish-Server writes its news whenever the run gets that far, not only on an answer from here' ($pubText.Contains('if (-not $NoNews) {') -and $pubText -notmatch '\$up\b')

function Case([string]$code, [string]$said, [string]$notKnown) {
    $script:out = @()
    $script:exited = $false
    $script:asked = @()
    $sb = {
        param($code, $said, $notKnown)
        $ResPort = 7788; $resPort = 7788; $GamePort = 7787; $port = 7787
        $IsDev = $true; $noBuild = $true; $livePort = 7787; $settings = $null
        $VpsHost = '192.0.2.1'; $Vps = '192.0.2.1'; $target = 'a@b'; $NoPause = $true; $VpsRoot = 'C:\S'
        function Test-ThornswoodFromOutside([string]$Address, [int]$Port, [int]$Witness) {
            $script:asked += ('{0}:{1}/{2}' -f $Address, $Port, $Witness)
            [pscustomobject]@{ Answered = ($said -eq 'answered'); Said = $said; NotKnown = $notKnown }
        }
        function Say($m, $c = 'Gray') { $script:out += ($c + ': ' + $m) }
        function Head($m) { }
        function Write-Host($Object, $ForegroundColor = 'Gray') { if ($null -ne $Object -and "$Object" -ne '') { $script:out += ([string]$ForegroundColor + ': ' + $Object) } }
        function Read-Host { }
        function Invoke-ThornswoodNative { $script:out += 'ssh' }
        . ([scriptblock]::Create($code))
    }
    & $sb $code $said $notKnown
    return [pscustomobject]@{ Out = ($script:out -join "`n"); Exited = $script:exited; Asked = ($script:asked -join ',') }
}

foreach ($which in @(@{ Name = 'Publish-Server'; Code = $publish }, @{ Name = 'Deploy-Server'; Code = $deploy })) {
    $n = $which.Name
    $c = Case $which.Code 'answered' ''
    Yes "$n, answered: up, in green, and the run goes on" ($c.Out -match 'Green: .*192\.0\.2\.1:7787, resources on 7788' -and -not $c.Exited)
    Yes '  having asked 7788 once, with 3000 as the witness' ($c.Asked -eq '192.0.2.1:7788/3000')

    $c = Case $which.Code 'silent for 5 s' 'this machine reaches no raw port on the box: 3000, which answers everybody, was silent for 5 s as well'
    Yes "$n, from a machine that reaches no raw port: not known, in yellow, and the run goes on" ($c.Out -match 'Yellow: .*not known: this machine reaches no raw port' -and $c.Out -notmatch 'Red:' -and -not $c.Exited)

    $c = Case $which.Code 'refused' ''
    Yes "$n, refused while the witness answers: red, saying refused, and the run stops" ($c.Out -match 'Red: .*192\.0\.2\.1:7788 was refused from' -and $c.Exited)
    Yes '  pointing at the inbound rule for that port' ($c.Out -match 'Where-Object LocalPort -eq 7788 \| Get-NetFirewallRule')

    $c = Case $which.Code 'silent for 5 s' ''
    Yes "$n, silent while the witness answers: red, saying silent, and the run stops" ($c.Out -match 'Red: .*was silent for 5 s from' -and $c.Exited)
}

Done
