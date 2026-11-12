<#
  test-4448-site-ready.ps1

      pwsh -NoProfile -File .\tests\test-4448-site-ready.ps1

  Issue #4448. When the site cannot read bans.json, pk.json or linked.json it
  lets nobody in to play and /api/ready answers 503 naming the file
  (site\lib\staff.js heldBroken, #2180, #2186), but the watchdog asked only
  /api/public, which answers 200 whatever those files say. So the door was
  shut and nobody was told. Only Deploy-Docs asked /api/ready, once a deploy.

  This runs the real watcher, lifted out of Watch-Services.ps1 the way
  test-watch-alerts.ps1 does, on a fake clock, against a stand-in site: a
  real HTTP listener on loopback that answers /api/public 200 and /api/ready
  as each case sets it. Everything else that touches the world is faked as
  in test-watch-alerts.ps1. It holds:

    1. a 503 from /api/ready is told to staff once, naming the file and why,
       and saying nobody is let in to play when the file is one play rests on;
    2. it restarts nothing for it: a restart does not mend a file;
    3. ten more runs of the same say nothing more;
    4. a site that cannot be asked at all says nothing here and ends
       nothing (the website check tells that), and is not "back";
    5. once /api/ready answers 200 again, one message says it reads again;
    6. a broken file play does not rest on is named without saying play
       is shut, and a 503 that names no file still tells;
    7. the header's list of what is checked names /api/ready.

  Read only apart from its own temp folder. Listens on one loopback port.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$WatchPath = Join-Path $Root 'scripts/vps/Watch-Services.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- the stand-in site --------------------------------------------------------
$probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$probe.Start(); $port = ([Net.IPEndPoint]$probe.LocalEndpoint).Port; $probe.Stop()
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
$site = [hashtable]::Synchronized(@{ Code = 200; Body = '{"ok":true,"broken":[]}'; Asked = [Collections.ArrayList]::Synchronized((New-Object Collections.ArrayList)) })
$answer = {
    param($l, $site)
    while ($l.IsListening) {
        try { $ctx = $l.GetContext() } catch { break }
        $path = $ctx.Request.Url.AbsolutePath
        [void]$site.Asked.Add($path)
        $code = 404; $body = '{}'
        if ($path -eq '/api/public') { $code = 200; $body = '{"open":true}' }
        elseif ($path -eq '/api/ready') { $code = $site.Code; $body = $site.Body }
        try {
            $b = [Text.Encoding]::UTF8.GetBytes($body)
            $ctx.Response.StatusCode = $code
            $ctx.Response.ContentType = 'application/json; charset=utf-8'
            $ctx.Response.ContentLength64 = $b.Length
            $ctx.Response.OutputStream.Write($b, 0, $b.Length)
            $ctx.Response.Close()
        } catch { }
    }
}
# The stand-in up, answering on its port.
function SiteUp() {
    $listener.Start()
    $script:serve = [powershell]::Create()
    $null = $script:serve.AddScript($answer).AddArgument($listener).AddArgument($site)
    $script:serving = $script:serve.BeginInvoke()
}
# The stand-in gone, its port refusing, as a site whose process stopped. Not
# a listener that aborts a request: measured on Linux, HttpListener's
# Response.Abort() before anything is written sends HTTP 200, empty.
function SiteGone() {
    $listener.Stop()
    try { $script:serve.EndInvoke($script:serving) } catch { }
    $script:serve.Dispose()
}
SiteUp
function Ready([int]$code, $broken) {
    $site.Code = $code
    if ($broken -is [string]) { $site.Body = $broken }
    else { $site.Body = (ConvertTo-Json @{ ok = ($code -eq 200); broken = @($broken) } -Compress -Depth 4) }
}

# ---- the watcher, as the box gets it, pointed at the stand-in -------------------
$errs = $null
$outer = [System.Management.Automation.Language.Parser]::ParseFile($WatchPath, [ref]$null, [ref]$errs)
$assign = $outer.Find({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$watcher' }, $true)
$text = $assign.Right.Find({ param($a) $a -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true).Value
$text = $text.Replace('http://127.0.0.1:3001/', "http://127.0.0.1:$port/")
$inner = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errs)
Yes 'the watcher lifted out of Watch-Services.ps1 parses' ($errs.Count -eq 0)

# Faked as in test-watch-alerts.ps1. HealthProblem is the real one for the
# stand-in site, so /api/public is truly asked, and '' for the rest.
$fake = @('Answers', 'SiteAnswers', 'BotAlive', 'BotProcs', 'HealthProblem', 'ReadyProblem', 'EndTask', 'HowItEnded', 'ServiceProblem', 'BackupProblem', 'OffBoxProblem', 'CertProblem', 'PostWebhook', 'DiskNow')
$body = @()
foreach ($s in $inner.EndBlock.Statements) {
    if ($s -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $fake -contains $s.Name) {
        if ($s.Name -eq 'HealthProblem') { $script:realHealth = [scriptblock]::Create($s.Body.Extent.Text.Trim().TrimStart('{').TrimEnd('}')) }
        continue
    }
    if ($s -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($s.Left)" -eq '$root') { $body += '$root = $script:boxRoot'; continue }
    $body += $s.Extent.Text
}
$script:watchBlock = [scriptblock]::Create($body -join "`n")

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4448-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Box([string]$name) {
    $script:boxRoot = Join-Path $tmp $name
    New-Item -ItemType Directory -Force -Path $script:boxRoot | Out-Null
    $script:clock = New-Object DateTime (2026, 11, 12, 12, 0, 0, [DateTimeKind]::Local)
    $script:runs = @()
    $site.Asked.Clear()
    Ready 200 @()
}
function Get-Date { return $script:clock }
function Start-Sleep { }
function schtasks { $script:runs += $args[-1]; $global:LASTEXITCODE = 0; return 'SUCCESS' }
function Restart-Service { [CmdletBinding()] param([string]$Name, [switch]$Force) $script:runs += $Name }
function Answers($port) { return $true }
function SiteAnswers($url) { return $true }
function BotAlive() { return $true }
function BotProcs() { return @() }
function HealthProblem($url) { if ($url -like "http://127.0.0.1:$port/*") { return (& $script:realHealth $url) }; return '' }
function ReadyProblem($url) { return '' }
function EndTask($task, $p) { $script:runs += ('end ' + $task); return ('ended ' + $task) }
function HowItEnded($task) { return '' }
function ServiceProblem($name) { return '' }
function BackupProblem($task, $folder, $hours) { return '' }
function OffBoxProblem($file, $hours) { return '' }
function CertProblem($url, $days) { return '' }
function DiskNow() { return @{ Free = 40GB; Size = 80GB } }
function PostWebhook($url, $text) { return '' }

function Step([int]$n = 1) {
    for ($i = 0; $i -lt $n; $i++) {
        $script:clock = $script:clock.AddMinutes(5)
        $null = . $script:watchBlock
    }
}
function Outbox() {
    $f = Join-Path $script:boxRoot 'alerts.jsonl'
    if (-not (Test-Path -LiteralPath $f)) { return @() }
    return @(Get-Content -LiteralPath $f -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { ConvertFrom-Json $_ })
}
function Show() { foreach ($a in (Outbox)) { Write-Host ('      ' + $a.service + ' ' + $a.kind + ': ' + $a.text) } }
# What the readiness check said: every message but the website check's own.
function Mine() { return @(Outbox | Where-Object { $_.service -ne 'website' }) }

$bans = @{ file = 'bans.json'; why = 'will not parse'; play = $true }
$sess = @{ file = 'sessions.json'; why = 'is not a list'; play = $false }

try {
    # -- 1, 2: the door shut, /api/public still 200 ------------------------------
    Box 'shut'
    Ready 503 @($bans)
    Step 1
    $o = @(Outbox)
    Yes '1. the stand-in site was asked /api/public, so the website check is the real one' ($site.Asked -contains '/api/public')
    Yes '   the watchdog asked /api/ready' ($site.Asked -contains '/api/ready')
    Yes ('   one message to staff on the first run (' + $o.Count + ')') ($o.Count -eq 1)
    $m = $(if ($o.Count) { $o[0] } else { $null })
    Yes '   it is a down message' ($m -and $m.kind -eq 'down')
    Yes '   it names bans.json and why' ($m -and $m.text -match 'bans\.json' -and $m.text -match 'will not parse')
    Yes '   it says nobody is let in to play' ($m -and $m.text -match 'nobody is let in to play')
    Yes '   it is not the website check speaking, which /api/public keeps quiet' (@($o | Where-Object { $_.service -eq 'website' }).Count -eq 0)
    Yes ('2. nothing was restarted or ended (' + ($script:runs -join ', ') + ')') ($script:runs.Count -eq 0)
    if ($o.Count -ne 1) { Show }

    # -- 3: still shut ---------------------------------------------------------
    Step 10
    Yes ('3. ten more runs of the same say nothing more (' + @(Outbox).Count + ')') (@(Outbox).Count -eq 1)
    Yes '   and restart nothing' ($script:runs.Count -eq 0)

    # -- 4: the site cannot be asked -------------------------------------------
    SiteGone
    $refused = $false
    try { $r = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port/api/ready").GetResponse(); $r.Close() } catch {
        $e = $_.Exception
        while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
        $refused = ($e -and -not $e.Response)
    }
    Yes '4. the stand-in, stopped, answers nothing at all' $refused
    Step 3
    Yes ('   a site that does not answer /api/ready is not said to be back (' + @(Mine).Count + ')') (@(Mine).Count -eq 1)
    Yes '   the website check tells that instead' (@(Outbox | Where-Object { $_.service -eq 'website' -and $_.kind -eq 'down' }).Count -eq 1)
    Yes '   and nothing is ended for it here' ($script:runs.Count -eq 0)
    SiteUp

    # -- 5: mended ---------------------------------------------------------------
    Ready 200 @()
    Step 3
    $o = @(Mine)
    Yes ('5. once it reads again, one more message, and only one (' + $o.Count + ')') ($o.Count -eq 2)
    Yes '   and it says it is back' ($o.Count -eq 2 -and $o[1].kind -eq 'back' -and $o[1].service -eq $o[0].service)
    Step 5
    Yes '   and then nothing' (@(Mine).Count -eq 2)
    if (@(Mine).Count -ne 2) { Show }

    # -- 6: a file play does not rest on; a 503 that names nothing ---------------
    Box 'sessions'
    Ready 503 @($sess)
    Step 1
    $o = @(Outbox)
    Yes ('6. sessions.json not a list is told once (' + $o.Count + ')') ($o.Count -eq 1)
    Yes '   naming it and why' ($o.Count -eq 1 -and $o[0].text -match 'sessions\.json' -and $o[0].text -match 'is not a list')
    Yes '   without saying play is shut' ($o.Count -eq 1 -and $o[0].text -notmatch 'nobody is let in to play')

    Box 'nameless'
    Ready 503 'not json'
    Step 1
    $o = @(Outbox)
    Yes ('   a 503 that names no file is still told, once (' + $o.Count + ')') ($o.Count -eq 1 -and $o[0].text -match '503')
    Yes '   and restarts nothing' ($script:runs.Count -eq 0)

    Box 'quiet'
    Step 20
    Yes '   a site that reads everything says nothing in twenty runs' (@(Outbox).Count -eq 0 -and $script:runs.Count -eq 0)
} finally {
    if ($listener.IsListening) { SiteGone }
    $listener.Close()
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}

# -- 7: the header ---------------------------------------------------------------
$top = [IO.File]::ReadAllText($WatchPath)
$top = $top.Substring(0, $top.IndexOf('#>'))
Yes '7. the header''s list of what it checks names /api/ready' ($top -match '/api/ready')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
