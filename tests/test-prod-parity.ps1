# tests\test-prod-parity.ps1
# Issue #2165. Offline: scripts\vps\Check-ProdParity.ps1 against made-up box
# facts, and scripts\vps\Get-ProdFacts.ps1's redaction against stand-in tasks
# and settings. Nothing reaches the VPS.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$repo = Split-Path -Parent $PSScriptRoot
$check = Join-Path $repo 'scripts\vps\Check-ProdParity.ps1'
$collector = Join-Path $repo 'scripts\vps\Get-ProdFacts.ps1'
$pass = 0; $fail = 0
function T([bool]$ok, [string]$what) { if ($ok) { Write-Host "PASS  $what"; $script:pass++ } else { Write-Host "FAIL  $what"; $script:fail++ } }

foreach ($s in $check, $collector) {
    $errs = $null; [void][Management.Automation.Language.Parser]::ParseFile($s, [ref]$null, [ref]$errs)
    T ($errs.Count -eq 0) ((Split-Path -Leaf $s) + ' parses')
}
$craw = Get-Content -LiteralPath $collector -Raw
T ($craw -notmatch '(?m)^\s*[^#\n]*\b(Set-|Remove-|New-Item|Stop-|Start-|Restart-|Register-|Unregister-|Disable-|Enable-)\w+') 'the collector calls no cmdlet that changes anything'

# ---- redaction in the collector ------------------------------------------
. $collector -Define
$fakeTask = [pscustomobject]@{
    TaskName = 'Thornswood Fake'; State = 'Ready'
    Principal = [pscustomobject]@{ UserId = 'SYSTEM'; RunLevel = 'Highest' }
    Triggers = @()
    Actions = @([pscustomobject]@{ Execute = 'node.exe'; Arguments = 'server.js --key hunter2-PLANTED-SECRET' })
}
$tf = ConvertTo-TaskFact $fakeTask | ConvertTo-Json -Compress
T ($tf -notmatch 'PLANTED') 'a task argument never leaves the collector'
T ($tf -match '"argsSha256":"[0-9a-f]{64}"') 'only its sha256 does'
$shape = ConvertTo-SettingShape ([pscustomobject]@{ botKey = 'PLANTED-SECRET-VALUE'; port = 3001; on = $true; list = @(1, 2); blank = '' }) | ConvertTo-Json -Compress
T ($shape -notmatch 'PLANTED') 'a setting value never leaves the collector'
T ($shape -match '"botKey":"string"' -and $shape -match '"port":"number"' -and $shape -match '"on":"bool"' -and $shape -match '"blank":"empty"') 'only key names and value types do'

# ---- comparison ------------------------------------------------------------
$sha = [Security.Cryptography.SHA256]::Create()
function RepoSha([string]$rel) { $t = ([IO.File]::ReadAllText((Join-Path $repo $rel))) -replace "`r`n", "`n"; -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($t)) | ForEach-Object { $_.ToString('x2') }) }
$now = [datetime]'2026-10-11T12:00:00Z'
function Facts { $x = [ordered]@{
    takenUtc = '2026-10-11T12:00:00Z'; host = 'STANDIN'
    listeners = @(
        @{ proto = 'tcp'; address = '0.0.0.0'; port = 443; process = 'caddy' }, @{ proto = 'tcp'; address = '0.0.0.0'; port = 80; process = 'caddy' },
        @{ proto = 'tcp'; address = '0.0.0.0'; port = 22; process = 'sshd' }, @{ proto = 'tcp'; address = '127.0.0.1'; port = 3001; process = 'node' },
        @{ proto = 'tcp'; address = '127.0.0.1'; port = 7778; process = 'node' }, @{ proto = 'tcp'; address = '127.0.0.1'; port = 7789; process = 'node' },
        @{ proto = 'udp'; address = '0.0.0.0'; port = 7777; process = 'node' }, @{ proto = 'tcp'; address = '0.0.0.0'; port = 3000; process = 'node' },
        @{ proto = 'udp'; address = '0.0.0.0'; port = 7787; process = 'node' }, @{ proto = 'tcp'; address = '0.0.0.0'; port = 7788; process = 'node' },
        @{ proto = 'udp'; address = '0.0.0.0'; port = 443; process = 'caddy' }, @{ proto = 'tcp'; address = '0.0.0.0'; port = 135; process = 'svchost' },
        @{ proto = 'tcp'; address = '::'; port = 445; process = 'System' }, @{ proto = 'udp'; address = '0.0.0.0'; port = 123; process = 'svchost' },
        @{ proto = 'udp'; address = '0.0.0.0'; port = 5353; process = 'svchost' }, @{ proto = 'udp'; address = '::'; port = 5355; process = 'svchost' })
    tasks = @(
        @{ name = 'Thornswood Server'; user = 'LOCAL SERVICE'; triggers = @('Boot') }, @{ name = 'Thornswood Dev Server'; user = 'LOCAL SERVICE'; triggers = @('Boot') },
        @{ name = 'Thornswood Voice'; user = 'LOCAL SERVICE'; triggers = @('Boot') }, @{ name = 'Thornswood Dev Voice'; user = 'LOCAL SERVICE'; triggers = @('Boot') },
        @{ name = 'Thornswood Docs'; user = 'NT AUTHORITY\LOCAL SERVICE'; triggers = @('Boot') }, @{ name = 'Thornswood Web'; user = 'LOCAL SERVICE'; triggers = @('Boot', 'Time') },
        @{ name = 'Thornswood Watch'; user = 'SYSTEM'; triggers = @('Time') }, @{ name = 'Thornswood Backup'; user = 'LOCAL SERVICE'; triggers = @('Daily') },
        @{ name = 'Thornswood Load'; user = 'SYSTEM'; triggers = @('Time') }, @{ name = 'Thornswood Disk History'; user = 'SYSTEM'; triggers = @('Daily') },
        @{ name = 'Thornswood Runner Logs'; user = 'SYSTEM'; triggers = @('Daily') }, @{ name = 'Thornswood Bridge'; user = 'LOCAL SERVICE'; triggers = @('Boot') },
        @{ name = 'Thornswood Gate'; user = 'SYSTEM'; triggers = @('Boot') },
        @{ name = 'Thornswood Bot Pass'; user = 'LOCAL SERVICE'; triggers = @() })
    services = @(
        @{ name = 'sshd'; account = 'LocalSystem'; state = 'Running' }, @{ name = 'ThornswoodBot'; account = 'NT SERVICE\ThornswoodBot'; state = 'Running' },
        @{ name = 'actions.runner.X.thornswood-vps'; account = '.\thornswood-runner'; state = 'Running' })
    files = [ordered]@{
        'C:\Thornswood-Caddy\Caddyfile' = (RepoSha 'scripts/deploy/Caddyfile'); 'C:\Thornswood-Docs\server.js' = (RepoSha 'site/server.js')
        'C:\Thornswood-Voice\voice-server.js' = (RepoSha 'voice/voice-server.js'); 'C:\Thornswood-Voice-Dev\voice-server.js' = (RepoSha 'voice/voice-server.js') }
    certs = @(@{ subject = 'CN=thornswood.net'; notAfterUtc = '2026-12-01T00:00:00Z' })
    versions = [ordered]@{ node = '22.11.0'; caddy = '2.8.4' }
    settings = [ordered]@{ 'C:\Thornswood-Docs\config.json' = [ordered]@{ botKey = 'string'; port = 'number' } }
    machineEnvNames = @()
    # #3807: the required rules from the record, as the box had them on 26 Oct.
    inboundRules = @(@((Get-Content (Join-Path $repo 'records\prod-parity.json') -Raw | ConvertFrom-Json).inboundRules | Where-Object { $_.required }) |
        ForEach-Object { @{ name = ('{' + [guid]::NewGuid().ToString() + '}'); displayName = [string]$_.rule; protocol = 'TCP'; ports = @('1'); remote = @('Any') } })
    # #3896: the box's policy holds the rules, and Edge is gone.
    firewallProfiles = @(@{ name = 'Domain'; allowLocalRules = 'False' }, @{ name = 'Private'; allowLocalRules = 'False' }, @{ name = 'Public'; allowLocalRules = 'False' })
    edgeVersion = ''
    edgeInstallBlocked = $true
}
# The site's modules (#5357), as the collector lists them.
foreach ($m in @(Get-ChildItem -LiteralPath (Join-Path $repo 'site/lib') -Filter *.js -File)) { $x.files[('C:\Thornswood-Docs\lib\' + $m.Name)] = (RepoSha ('site/lib/' + $m.Name)) }
$x }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('prod-parity-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
function Run($facts, [string]$record) {
    $fp = Join-Path $scratch 'facts.json'; $rp = Join-Path $scratch 'report.md'
    Remove-Item $rp -EA SilentlyContinue
    $facts | ConvertTo-Json -Depth 6 | Set-Content $fp -Encoding utf8
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $check, '-Facts', $fp, '-Report', $rp, '-Now', '2026-10-11T12:00:00Z', '-Strict')
    if ($record) { $a += @('-Record', $record) }
    $o = & $boxPs @a 2>&1 | Out-String
    @{ Code = $LASTEXITCODE; Out = $o; Report = $(if (Test-Path $rp) { Get-Content $rp -Raw } else { '' }) }
}
try {
    $x = Run (Facts) ''
    T ($x.Code -eq 0) 'a box that matches the record has nothing to review'
    T ($x.Report -match '\| file \| C:\\Thornswood-Caddy\\Caddyfile \|[^\n]*\| same \| ok \|') 'the live Caddyfile is compared with scripts\deploy\Caddyfile'
    T ($x.Report -match 'botKey \(string\)' -and $x.Report -notmatch 'PLANTED') 'the report carries setting names and types only'

    # The deploy gate's verb names one folder for both files (-Out), which the
    # broker sends back to a cloud thread.
    $od = Join-Path $scratch 'out'
    New-Item -ItemType Directory -Path $od | Out-Null
    Copy-Item (Join-Path $scratch 'facts.json') (Join-Path $od 'prod-facts.json')
    $o = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $check -Out $od -Now '2026-10-11T12:00:00Z' 2>&1 | Out-String
    T ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $od 'prod-parity.md'))) '-Out reads prod-facts.json from the folder and writes prod-parity.md beside it'

    $b = Facts
    ($b.listeners | Where-Object { $_.port -eq 3001 }).address = '0.0.0.0'
    $b.listeners += @{ proto = 'tcp'; address = '0.0.0.0'; port = 8080; process = 'node' }
    ($b.tasks | Where-Object { $_.name -eq 'Thornswood Docs' }).user = 'SYSTEM'
    $b.machineEnvNames = @('THORNSWOOD_DOCS_EXPOSE')
    $b.certs = @(@{ subject = 'CN=thornswood.net'; notAfterUtc = '2026-10-16T00:00:00Z' })
    $b.files.'C:\Thornswood-Caddy\Caddyfile' = ('0' * 64)
    ($b.services | Where-Object { $_.name -eq 'ThornswoodBot' }).state = 'Stopped'
    $x = Run $b ''
    T ($x.Code -eq 1) 'with -Strict, any difference to review fails'
    T ($x.Out -match 'REVIEW  listener tcp 3001: expected loopback node, found public node') 'the site on every address is caught'
    T ($x.Out -match 'REVIEW  listener tcp 8080: expected not listed in the record') 'a public port nobody wrote down is caught'
    T ($x.Out -match 'REVIEW  task Thornswood Docs: expected as LOCAL SERVICE, found as SYSTEM') 'a task running as the wrong account is caught'
    T ($x.Out -match 'REVIEW  env THORNSWOOD_DOCS_EXPOSE') 'an exposing environment variable is caught by name'
    T ($x.Out -match 'REVIEW  tls thornswood.net: expected valid, 14\+ days, found 4 days left') 'a certificate close to lapsing is caught'
    T ($x.Out -match 'REVIEW  file C:\\Thornswood-Caddy\\Caddyfile') 'a live Caddyfile that differs is caught'
    T ($x.Out -match 'REVIEW  service ThornswoodBot') 'a stopped bot service is caught'

    # #5357: the site's modules, each held by name, and one only the box has.
    $m = Facts
    $m.files.'C:\Thornswood-Docs\lib\serve.js' = ('0' * 64)
    $m.files.'C:\Thornswood-Docs\lib\dropped.js' = ('1' * 64)
    $m.files.Remove('C:\Thornswood-Docs\lib\news.js')
    $x = Run $m ''
    T ($x.Out -match 'REVIEW  file C:\\Thornswood-Docs\\lib\\serve\.js') 'a site module that differs on the box is caught'
    T ($x.Out -match 'REVIEW  file C:\\Thornswood-Docs\\lib\\news\.js') 'a site module missing on the box is caught'
    T ($x.Out -match 'REVIEW  file C:\\Thornswood-Docs\\lib\\dropped\.js') 'a module on the box the repository does not have is caught'

    $rec = Get-Content (Join-Path $repo 'records\prod-parity.json') -Raw | ConvertFrom-Json
    $rec.intentional = @([pscustomobject]@{ area = 'listener'; item = 'tcp 8080'; why = 'stand-in reason' })
    $rp2 = Join-Path $scratch 'record.json'; $rec | ConvertTo-Json -Depth 6 | Set-Content $rp2 -Encoding utf8
    $c = Facts; $c.listeners += @{ proto = 'tcp'; address = '0.0.0.0'; port = 8080; process = 'node' }
    $x = Run $c $rp2
    T ($x.Code -eq 0 -and $x.Report -match 'intentional: stand-in reason') 'a difference listed as intentional is classed so, with its reason'

    $d = Facts; $d.versions.node = 'password=hunter2PLANTED'
    $x = Run $d ''
    T ($x.Code -eq 2 -and -not $x.Report) 'a report holding something shaped like a secret is refused and not written'

    # ---- #2165 first live run: expected box state and the comment-blind Caddyfile
    $body = 'thornswood.net {' + "`n" + '    reverse_proxy 127.0.0.1:3001' + "`n" + '}'
    $h1 = Get-ConfigBodyHash ("# header line one`n#`n# header line three`n`n" + $body + "`n")
    T ($h1 -eq (Get-ConfigBodyHash $body)) 'comment and blank lines do not change a config body hash'
    T ($h1 -eq (Get-ConfigBodyHash (($body -replace "`n", "`r`n") + "   `r`n"))) 'line endings and trailing spaces do not either'
    T ($h1 -ne (Get-ConfigBodyHash ($body -replace '3001', '3002'))) 'a changed directive does'

    $repoBody = Get-ConfigBodyHash ([IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Caddyfile')))
    $e = Facts; $e.files.'C:\Thornswood-Caddy\Caddyfile' = ('0' * 64); $e.fileBodies = [ordered]@{ 'C:\Thornswood-Caddy\Caddyfile' = $repoBody }
    $x = Run $e ''
    T ($x.Code -eq 0 -and $x.Report -match '\| file \| C:\\Thornswood-Caddy\\Caddyfile \|[^\n]*comments aside \| same \| ok \|') 'a live Caddyfile without the comment header is ok'
    $e.fileBodies.'C:\Thornswood-Caddy\Caddyfile' = ('1' * 64)
    $x = Run $e ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  file C:\\Thornswood-Caddy\\Caddyfile') 'a live Caddyfile whose body differs is still caught'

    $x = Run (Facts) ''
    T ($x.Code -eq 0 -and $x.Out -cnotmatch 'REVIEW  ') 'the Oct 11 run''s ten rows (3 tasks, udp 443, Windows ports) are recorded and pass'
    T ($x.Report -match '\| listener \| udp 443 \|[^\n]*\| ok \|') 'udp 443 for Caddy HTTP/3 is an expected listener'
    $h = Facts; ($h.listeners | Where-Object { $_.proto -eq 'udp' -and $_.port -eq 443 }).process = 'node'
    $x = Run $h ''
    T ($x.Out -match 'REVIEW  listener udp 443') 'udp 443 held by anything but Caddy is caught'
    $rj = Get-Content (Join-Path $repo 'records\prod-parity.json') -Raw | ConvertFrom-Json
    $new2165 = @(@($rj.listeners | Where-Object { "$($_.proto) $($_.port)" -in 'udp 443', 'tcp 135', 'tcp 445', 'udp 123', 'udp 5353', 'udp 5355' }) + @($rj.tasks | Where-Object { $_.name -eq 'Thornswood Load' }))
    T ($new2165.Count -eq 7 -and -not @($new2165 | Where-Object { -not $_.why })) 'the seven rows from the Oct 11 run that stay are recorded, each with a reason'
    # Maint Update and Dev Crash Capture were made by hand and are off the box (#3288, Remove-HandMadeTasks.ps1).
    T (-not @($rj.tasks | Where-Object { $_.name -in 'Thornswood Maint Update', 'Thornswood Dev Crash Capture' })) 'the two hand made tasks are not recorded as wanted'
    T (-not @($rj.intentional)) 'expected state is recorded as expected, not as an ignore list'
    # ---- #3807 inbound firewall rules
    $g = Facts; $g.inboundRules += @{ name = '{7606AA2C-8B97-43D0-AB9E-BF57D54DF1A7}'; displayName = 'Allow WinRM HTTPS'; protocol = 'TCP'; ports = @('5986'); remote = @('Any') }
    $g.inboundRules += @{ name = 'OpenSSH-Server-In-TCP'; displayName = 'OpenSSH SSH Server (sshd)'; protocol = 'TCP'; ports = @('22'); remote = @('127.0.0.1') }
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  firewall Allow WinRM HTTPS: expected not listed in the record, found on, TCP 5986 from Any') 'an inbound rule on the box that the record does not list is caught'
    T ($x.Out -notmatch 'REVIEW  firewall OpenSSH') 'one the record lists by its Name is not'
    $g = Facts; $g.inboundRules = @($g.inboundRules | Where-Object { $_.displayName -ne 'Thornswood game (UDP)' })
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  firewall Thornswood game \(UDP\): expected on \(required\), found off, or not on the box') 'a required rule that is off or gone is caught'
    $g = Facts; $g.Remove('inboundRules')
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  firewall inbound rules') 'facts that carry no inbound rules are not taken for a clean firewall'
    T (@($rj.inboundRules).Count -ge 10 -and -not @($rj.inboundRules | Where-Object { -not $_.why })) 'records\prod-parity.json lists the inbound rules the box keeps, each with a reason'
    # ---- #3896 the box's own firewall policy, and Edge
    $g = Facts; $g.firewallProfiles[2] = @{ name = 'Public'; allowLocalRules = 'NotConfigured' }
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  firewall Public profile, local rules: expected ignored \(AllowLocalFirewallRules False\), found taken \(NotConfigured\)') 'a profile that still takes local rules is caught'
    $g = Facts; $g.edgeVersion = '156.0.4314.42'; $g.edgeInstallBlocked = $false
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  program Microsoft Edge: .*found installed, 156\.0\.4314\.42, and nothing stops the updater') 'Edge back on the box, with nothing stopping its updater, is caught'
    $g = Facts; $g.edgeVersion = '156.0.4314.42'
    $x = Run $g ''
    T ($x.Out -notmatch 'REVIEW  program Microsoft Edge') 'Edge kept because its setup refused the uninstall, with its updater told never to install it, is expected (q-3896-edge-uninstall-refused, A)'
    $g = Facts; $g.Remove('firewallProfiles'); $g.Remove('edgeVersion')
    $x = Run $g ''
    T ($x.Code -eq 1 -and $x.Out -match 'REVIEW  firewall local rules' -and $x.Out -match 'REVIEW  program Microsoft Edge') 'facts that carry neither are not taken for a clean box'

    $rec2 = Get-Content (Join-Path $repo 'records\prod-parity.json') -Raw
    T ($rec2 -notmatch '(?i)password\s*[=:]|BEGIN ') 'records\prod-parity.json holds no secret'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue }

Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
