<#
  test-2753-cloud-ssh.ps1

      pwsh -NoProfile -File .\tests\test-2753-cloud-ssh.ps1

  The PowerShell half of ssh from cloud Claude threads (#2753):
  Install-Bridge.ps1 (the box's end, as a task) and Setup-CloudSsh.ps1 (the
  cloud thread's end). tests\test-2753-box-bridge.js runs the bridge itself,
  and tests\test-2891-box-access.ps1 holds Grant-BoxAccess.ps1, which makes
  the cloud's key and token on One as it does everybody's.

  WHAT IT HOLDS THEM TO.
    1. Each parses, and each script it sends to the box, built the way the
       script builds it with stand-in values, parses as PowerShell too, so a
       backtick in the wrong place fails here and not on the box.
    2. Install-Bridge.ps1: a commit or nothing (Artifact.ps1), the task as
       LOCAL SERVICE with a SID of its own after the fail-safe
       (ServiceAccount.ps1, #2578), priority 4 (#1968), the log through
       server-log.js kept 90 days (#2166), the folder taking nothing from C:\,
       and the old files and task back when the new one does not answer.
    3. (Grant-BoxAccess.ps1, in tests\test-2891-box-access.ps1.)
    4. Setup-CloudSsh.ps1: ssh with StrictHostKeyChecking yes from the first
       connection, the box's key only through Add-ThornswoodKnownHost -Scanned
       (the pin, by way of Add-ThornswoodKnownHostThroughBridge), neither
       secret printed.
    5. Add-ThornswoodKnownHost -Scanned, against throwaway keys: a pinned line
       is written under the box's address, one that is not pinned is refused
       with nothing written, and ssh-keyscan is not asked.
    6. The Caddyfile carries /box/ to the port the bridge and its installer
       use, and Setup-Domain.ps1 refuses a Caddyfile without it.
    7. Get-PlainAnswer, the one way Install-Bridge.ps1 reads an answer, run
       in pwsh, which the box runs, against bridge.js itself, a stand-in for
       the site's 404 and a port nobody holds: the bridge's line, the site's, and nothing (#2875).
  Section 7 starts bridge.js and a stand-in on loopback ports of its own and
  stops them; nothing else connects and nothing leaves this machine.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }
function Text([string]$p) { return [IO.File]::ReadAllText($p) }
function ParseErrors([string]$code) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$e)
    return @($e)
}

$installPath = P 'scripts', 'deploy', 'Install-Bridge.ps1'
$setupPath   = P 'scripts', 'vps', 'Setup-CloudSsh.ps1'
$vpsPath     = P 'scripts', 'vps', 'Vps.ps1'
$install = Text $installPath
$setup   = Text $setupPath
$vpsText = Text $vpsPath
$sendScript = Text (P 'scripts', 'vps', 'Send-Script.ps1')

# ---- 1. they parse --------------------------------------------------------
foreach ($p in $installPath, $setupPath) {
    $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e)
    Yes ((Split-Path -Leaf $p) + ' parses') (@($e).Count -eq 0)
}

# The here-strings each script sends, expanded with stand-in values the way
# the script expands them, then parsed.
function HereStrings([string]$path) {
    $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$e)
    return @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $n.StringConstantType -eq 'DoubleQuotedHereString' }, $true))
}
# A here-string as the script expands it: its text between @" and "@, with
# its backticks and variables, expanded here.
function Build($h) {
    $t = $h.Extent.Text
    $t = $t.Substring($t.IndexOf("`n") + 1)
    $t = $t.Substring(0, $t.LastIndexOf("`n"))
    return $ExecutionContext.InvokeCommand.ExpandString($t)
}

. (P 'scripts', 'deploy', 'ServiceAccount.ps1')
$Root = 'C:\Thornswood-Bridge'; $Port = 7790; $TaskName = 'Thornswood Bridge'; $Wait = 20; $AsSystem = $false
$log = 'C:\Thornswood-Bridge\bridge.log'; $stage = '.stage-20261020-000000'; $prev = '.prev-20261020-000000'
$want = "'bridge.js' = 'AA'; 'ws.js' = 'BB'; 'server-log.js' = 'CC'"
# Get-PlainAnswer and what is sent ahead of the scripts that use it, defined
# from Install-Bridge.ps1's own text, as the script defines them.
$e = $null
$iast = [System.Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$null, [ref]$e)
$pa = @($iast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-PlainAnswer' }, $true))
$sendAst = @($iast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$SendPlainAnswer' }, $true))
Yes 'Install-Bridge.ps1 reads every answer through one Get-PlainAnswer, which it sends to the box' ($pa.Count -eq 1 -and $sendAst.Count -eq 1)
Invoke-Expression $pa[0].Extent.Text
Invoke-Expression $sendAst[0].Extent.Text
$Plain = 'box bridge: not here'
$hs = HereStrings $installPath
$stopAst = @($hs | Where-Object { $_.Extent.Text -match '^@"\r?\nfunction StopIt' })
Yes 'Install-Bridge.ps1 has one StopIt it sends' ($stopAst.Count -eq 1)
$stopIt = Build $stopAst[0]
$bad = @()
foreach ($h in $hs) {
    try { $code = Build $h } catch { $bad += ('line ' + $h.Extent.StartLineNumber + ' does not build: ' + $_.Exception.Message); continue }
    $errs = @(ParseErrors $code)
    if ($errs.Count) { $bad += ('line ' + $h.Extent.StartLineNumber + ': ' + $errs[0].Message) }
}
Yes ('every script Install-Bridge.ps1 sends parses once built (' + $hs.Count + ')' + $(if ($bad.Count) { ': ' + ($bad -join '; ') })) ($hs.Count -ge 5 -and $bad.Count -eq 0)

$installCode = Build (@($hs | Where-Object { $_.Extent.Text -match 'BRIDGE OK' })[0])

# ---- 2. Install-Bridge.ps1 ------------------------------------------------
Yes 'Install-Bridge.ps1 builds an artifact from the commit and checks it before sending' (
    $install -match 'New-ThornswoodArtifact -Component bridge' -and $install -match 'Assert-ThornswoodSourceIntegrity' -and
    $install -match "'scripts/vps/bridge/bridge.js', 'scripts/vps/bridge/ws.js'" -and $install -match "-AlsoSends 'scripts/vps/Server-Log.js'")
Yes '  and records what the box runs only once it answers' ($install.LastIndexOf('Set-ThornswoodArtifactCurrent') -gt $install.IndexOf("-notcontains 'BRIDGE OK'"))
# #3214: the install's own ssh rides the bridge it stops, so it goes to the
# box as a detached run that waits for that session to end, and its report
# is read in fresh sessions until END.
Yes 'the install goes to the box as a detached run, never in the session the stop cuts (#3214)' (
    $install.Contains('$run = Get-ThornswoodDetachedRun -Script $install') -and $install.Contains('@(Remote $run.Start)') -and
    $install.Contains('@(Remote $run.Read |') -and $install -notmatch '\$out = @\(Remote @"\r?\n`\$ErrorActionPreference = ''Stop''\r?\n`\$ProgressPreference')
Yes '  read until its END, and BRIDGE OK looked for in what it said' (
    $install.Contains("if (`$lines[`$i] -match '^END (-?\d+)$')") -and $install.IndexOf('$endRc = [int]$Matches[1]') -lt $install.IndexOf("-notcontains 'BRIDGE OK'"))
Yes 'the detached run waits for the session that started it to end before any of it runs (#3214)' (
    $sendScript.Contains("WriteAllText('`$file.session'") -and $sendScript.Contains('WaitForExit(') -and
    $sendScript.IndexOf('WaitForExit(') -lt $sendScript.IndexOf("& '`$file' *>&1"))
$recAst = @($hs | Where-Object { $_.Extent.Text -match "'MATCHES'" })
Yes '-Record has one script it sends' ($recAst.Count -eq 1)
$recCode = Build $recAst[0]
Yes '  which checks each file by hash and the port, and stops, starts and moves nothing' (
    $recCode -match 'Get-FileHash -LiteralPath \$p -Algorithm SHA256' -and $recCode.Contains("Get-PlainAnswer 'http://127.0.0.1:7790/' 5") -and
    $recCode -notmatch 'Stop-ScheduledTask|Start-ScheduledTask|Move-Item|Remove-Item|StopIt|Register-ScheduledTask')
Yes '  and records only on MATCHES' ($install.IndexOf("if (`$out -notcontains 'MATCHES')") -lt $install.IndexOf('Set-ThornswoodArtifactCurrent') -and $install.IndexOf("if (`$out -notcontains 'MATCHES')") -gt 0)
Yes '-Remove refuses from a machine whose ssh goes through the bridge' (
    $install.IndexOf('if (Test-ThornswoodBridgeSsh $VpsHost) { Die') -gt $install.IndexOf('if ($Remove) {') -and
    $install.IndexOf('if (Test-ThornswoodBridgeSsh $VpsHost) { Die') -lt $install.IndexOf('Unregister-ScheduledTask -TaskName ''$TaskName'' -Confirm:`$false -EA SilentlyContinue'))
Yes 'the task is LOCAL SERVICE with its own SID, granted its folder, after the fail-safe' (
    $installCode -match 'New-ThornswoodServicePrincipal -AsSystem:\$system' -and $installCode -match 'Get-ThornswoodTaskSid' -and
    $installCode -match 'Grant-ThornswoodServiceFolder' -and
    $installCode.IndexOf('Test-ThornswoodServiceCannotReach (') -ge 0 -and $installCode.IndexOf('Test-ThornswoodServiceCannotReach (') -lt $installCode.IndexOf('if (-not $stopOk)'))
Yes '  at priority 4, normal (#1968)' ($installCode -match 'New-ScheduledTaskSettingsSet [^\r\n]*-Priority 4\b')
Yes '  and runs the bridge under server-log.js, kept 90 days with a time on each line (#2166)' ($installCode -match '--log "\{1\}" --days 90 --stamp bridge\.js')
Yes '  on the port the Caddyfile hands /box/ to' ($installCode -match 'THORNSWOOD_BRIDGE_PORT=7790&&')
Yes 'the folder takes nothing from C:\ and no broad group keeps a rule on it' (
    $install -match 'SetAccessRuleProtection\(`\$true, `\$false\)' -and $install -match "'S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19'")
Yes 'the stage is checked by hash and node --check before the bridge is stopped' (
    $installCode.IndexOf('did not arrive as it was sent') -lt $installCode.IndexOf('if (-not $stopOk)') -and
    $installCode.IndexOf('--check') -lt $installCode.IndexOf('if (-not $stopOk)'))
Yes 'a bridge that does not answer gets the old files and the old task back' ($installCode -match 'Register-ScheduledTask -TaskName .Thornswood Bridge. -Xml \$oldXml' -and $installCode -match "BRIDGE ROLLED BACK")
Yes 'StopIt stops only what names bridge.log, and the child it started' ($stopIt -match [regex]::Escape("like ('*' + 'C:\Thornswood-Bridge\bridge.log' + '*')") -and $stopIt -match 'ParentProcessId -eq')
# #2928: each opened before the task stops, waited for until it has exited,
# with StopAndMove.ps1 sent in front of it, and a stop that left one running
# is refused rather than read as true because the function said a line.
# Since #5155 the refusal also takes away the hold written before the stop.
Yes '  and waits for each to exit, with StopAndMove.ps1 sent in front, and is refused on $stopOk' (
    $stopIt -match 'Get-ThornswoodProcessHeld' -and $stopIt -match 'Stop-ThornswoodProcessHeld' -and $stopIt -notmatch 'Start-Sleep' -and
    $install.Contains("`$stopIt = [IO.File]::ReadAllText((Join-Path `$Here 'StopAndMove.ps1')) + ") -and
    $installCode -match "StopIt\r?\nif \(-not \`$stopOk\) \{ Clear-ThornswoodHold -Target 'Thornswood Bridge'; 'BRIDGE REFUSED'; exit 1 \}")
# #2875: the site's own 404 says "not here" too, so every check that the
# bridge answers looks for its whole line, never a status code or "not here".
$bridgeJs = Text (P 'scripts', 'vps', 'bridge', 'bridge.js')
Yes 'Install-Bridge.ps1 looks for the line bridge.js answers a plain request with (#2875)' (
    $bridgeJs -match "const PLAIN = 'box bridge: not here';" -and $install -match "(?m)^\`$Plain = 'box bridge: not here'\r?$")
Yes '  through Caddy, at the outside check' ($install.Contains('if ($a.Code -eq 404 -and $a.Body -eq $Plain) {') -and $install -notmatch "-eq 'not here'")
Yes '  and on the port, at install and in the status, never by status code alone' (
    $install.Contains("if (Answers @('`$Plain'))") -and $installCode.Contains('if ($a.Code -eq 404 -and $Lines -contains $a.Body) { return $true }') -and
    $install.Contains('if (`$a.Code -eq 404 -and `$a.Body -eq ''$Plain'') { ''port'))
Yes '  each through Get-PlainAnswer, which goes with the scripts that call it' (
    $installCode.Contains('function Get-PlainAnswer {') -and $installCode.IndexOf('function Get-PlainAnswer {') -lt $installCode.IndexOf('function Answers'))
# On Windows PowerShell 5.1, which the box ran until #5356, a 404 left
# Invoke-WebRequest's ErrorDetails empty, so a body read that way was never
# seen (#2875).
Yes '  and none through Invoke-WebRequest or ErrorDetails' ($install -notmatch 'Invoke-WebRequest -' -and $install -notmatch '\.ErrorDetails')
Yes 'the status names whose tokens are there, never what they are' ($install -match "'tokens    for '" -and $install -notmatch 'Get-Content[^\r\n]*tokens')

# ---- 4. Setup-CloudSsh.ps1 -----------------------------------------------
Yes 'Setup-CloudSsh.ps1 writes its Host block with Set-ThornswoodBridgeSsh, which writes StrictHostKeyChecking yes' ($setup -match 'Set-ThornswoodBridgeSsh -Address \$VpsHost' -and $vpsText -match "'    StrictHostKeyChecking yes'")
Yes '  never turns checking down' ($setup -notmatch '(?i)StrictHostKeyChecking\s*[= ]\s*"?(no|off|accept-new|ask)\b' -and $vpsText -notmatch '(?i)StrictHostKeyChecking\s*[= ]\s*"?(no|off|accept-new|ask)\b')
Yes '  writes known_hosts only through the pin' ($setup -match 'Add-ThornswoodKnownHostThroughBridge -Address \$VpsHost' -and $vpsText -match 'Add-ThornswoodKnownHost -Address \$Address -Scanned \$lines' -and $setup -notmatch 'Add-Content[^\r\n]*known_hosts')
Yes '  asks ssh-keyscan through listen.js, never the box''s own port' ($setup -match "'listen\.js'" -and $vpsText -match 'ssh-keyscan -T 20 -p \$port 127\.0\.0\.1')
Yes '  and prints neither secret' (-not ($setup -match '(?m)^\s*(Say|Write-Host)[^\r\n]*\$(keyB64|keyText|env:THORNSWOOD_BOX_TOKEN\b[^)])'))

# ---- 5. Add-ThornswoodKnownHost -Scanned ----------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2753-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    . (P 'scripts', 'vps', 'Vps.ps1')
    $keys = @{}
    foreach ($k in 'box', 'impostor') {
        $kp = Join-Path $tmp $k
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        foreach ($empty in '""', '') {
            & ssh-keygen -q -t ed25519 -N $empty -C $k -f $kp 2>&1 | Out-Null
            if (Test-Path -LiteralPath "$kp.pub") { break }
        }
        $ErrorActionPreference = $old
        $pk = ([IO.File]::ReadAllText("$kp.pub")).Trim() -split '\s+'
        $keys[$k] = '203.0.113.9 ' + $pk[0] + ' ' + $pk[1]
    }
    $boxFp = Get-ThornswoodSshFingerprint $keys['box']
    $global:ThornswoodScanAsked = $false
    function global:ssh-keyscan { $global:ThornswoodScanAsked = $true }
    $kh = Join-Path $tmp 'known_hosts'
    $threw = $false
    try { [void](Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp) -Scanned @($keys['impostor'])) } catch { $threw = $true }
    Yes 'a scanned line that is not pinned is refused, nothing written' ($threw -and -not (Test-Path -LiteralPath $kh))
    $n = Add-ThornswoodKnownHost -Address '203.0.113.9' -KnownHosts $kh -Pinned @($boxFp) -Scanned @($keys['impostor'], $keys['box'])
    $held = [IO.File]::ReadAllText($kh)
    Yes '  and the pinned one is written, the other left out' ($n -eq 1 -and $held.Contains($keys['box']) -and -not $held.Contains($keys['impostor']))
    Yes '  and ssh-keyscan was never asked' (-not $global:ThornswoodScanAsked)
    Yes 'the known_hosts path is one folder at a time, so it is right on Linux too' ((Get-ThornswoodKnownHostsPath) -eq (Join-Path (Join-Path $HOME '.ssh') 'known_hosts'))
}
finally {
    Remove-Item -Path function:global:ssh-keyscan -ErrorAction SilentlyContinue
    Remove-Variable -Name ThornswoodScanAsked -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 6. the door ----------------------------------------------------------
$caddy = Text (P 'scripts', 'deploy', 'Caddyfile')
$bridgeJs = Text (P 'scripts', 'vps', 'bridge', 'bridge.js')
Yes 'the Caddyfile hands /box/ to 127.0.0.1:7790' ($caddy -match '(?s)handle_path /box/\* \{\s*reverse_proxy 127\.0\.0\.1:7790\b')
Yes '  the port bridge.js takes when none is given' ($bridgeJs -match 'THORNSWOOD_BRIDGE_PORT\) \|\| 7790')
Yes '  and Install-Bridge.ps1 installs it on' ($install -match '\[int\]\$Port\s+= 7790')
Yes 'Setup-Domain.ps1 refuses a Caddyfile without the /box/ block' ((Text (P 'scripts', 'deploy', 'Setup-Domain.ps1')) -match "'handle_path /box/\*'")

# ---- 7. Get-PlainAnswer in each PowerShell -------------------------------
function FreePort {
    $l = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
    $l.Start(); $n = $l.LocalEndpoint.Port; $l.Stop()
    return $n
}
function StartNode([string]$script, [hashtable]$envs) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command node).Source
    $psi.Arguments = '"' + $script + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($k in $envs.Keys) { $psi.EnvironmentVariables[$k] = [string]$envs[$k] }
    return [Diagnostics.Process]::Start($psi)
}
function Until([string]$url) {
    $stop = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $stop) {
        if ((Get-PlainAnswer $url 1).Code) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return $false
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Yes 'node is here to run bridge.js for Get-PlainAnswer' $false
} else {
    $ptmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2875-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $ptmp -Force | Out-Null
    $procs = @()
    try {
        New-Item -ItemType Directory -Path (Join-Path $ptmp 'tokens') -Force | Out-Null
        $sitePath = Join-Path $ptmp 'site.js'
        # The site's own 404, as site/server.js sends it.
        [IO.File]::WriteAllText($sitePath, "require('http').createServer((q, s) => { s.writeHead(404, { 'Content-Type': 'text/plain' }); s.end('not here'); }).listen(Number(process.env.PORT), '127.0.0.1');")
        $bridgePort = FreePort; $sitePort = FreePort; $nobody = FreePort
        $procs += StartNode (P 'scripts', 'vps', 'bridge', 'bridge.js') @{ THORNSWOOD_BRIDGE_PORT = $bridgePort; THORNSWOOD_BRIDGE_TOKENS = (Join-Path $ptmp 'tokens'); THORNSWOOD_BRIDGE_TARGET = ('127.0.0.1:' + $nobody) }
        $procs += StartNode $sitePath @{ PORT = $sitePort }
        Yes 'bridge.js and the stand-in site start' ((Until "http://127.0.0.1:$bridgePort/") -and (Until "http://127.0.0.1:$sitePort/"))
        # The box runs its scripts in pwsh since #5356.
        $shells = @('pwsh')
        foreach ($sh in $shells) {
            $asks = @($bridgePort, $sitePort, $nobody) | ForEach-Object { "`$a = Get-PlainAnswer 'http://127.0.0.1:$_/' 3; 'ANSWER ' + `$a.Code + ' ' + `$a.Body" }
            $code = $SendPlainAnswer + "`n" + ($asks -join "`n")
            $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
            $out = @(& $sh -NoProfile -NonInteractive -EncodedCommand $enc 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -like 'ANSWER *' })
            $ver = (& $sh -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()' | Select-Object -First 1)
            $saw = ' (read: ' + ($out -join ' / ') + ')'
            Yes ("${sh} ${ver}: the bridge's 404 reads as its line" + $(if ($out[0] -ne 'ANSWER 404 box bridge: not here') { $saw })) ($out.Count -eq 3 -and $out[0] -eq 'ANSWER 404 box bridge: not here')
            Yes ("${sh} ${ver}: the site's 404 reads as the site's, not the bridge's") ($out.Count -eq 3 -and $out[1] -eq 'ANSWER 404 not here')
            Yes ("${sh} ${ver}: a port nobody holds reads as no answer") ($out.Count -eq 3 -and $out[2] -eq 'ANSWER 0 ')
        }
        Yes 'Get-PlainAnswer ran in at least one PowerShell' ($shells.Count -ge 1)
    }
    finally {
        foreach ($p in $procs) { if ($p -and -not $p.HasExited) { $p.Kill() } }
        Remove-Item -LiteralPath $ptmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
