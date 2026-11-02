<#
.SYNOPSIS
  Compares the VPS's own facts with what the repository says it should be (binds, Caddy, tasks, services, live file hashes, TLS dates, settings shape) and writes a redacted parity report; read-only (issue #2165).

.DESCRIPTION
  Two steps, and only the first touches the box.

  -Collect sends scripts\vps\Get-ProdFacts.ps1 to the VPS through
  Remote.ps1 and saves what it prints to -Facts. Get-ProdFacts only reads:
  no write, no start, no stop, no setting changed. Collecting is a live
  step, so it is Claude's to run (the ops repo's ops\claude-queue\2165-prod-parity.md).

  Without -Collect it reads a saved -Facts file and compares it with
  records\prod-parity.json and the repository's own files. That part is
  offline and is what tests\test-prod-parity.ps1 runs.

  Every difference is one row: area, item, expected, actual, and a class.
    ok            matches
    intentional   listed under "intentional" in records\prod-parity.json,
                  with the reason
    review        differs and nobody has said why yet. A person decides
                  whether it is stale documentation (fix the record or the
                  doc) or remediation (fix the box, through the script that
                  owns it, never by hand)
  No value of a setting, environment variable or task argument is ever in
  the facts or the report: names, types and hashes only. The report is
  scanned before it is written and refused if anything shaped like a
  secret got in.

  OWNER AND CADENCE. Installer lane owns this script and the record; Claude
  runs -Collect after every Deploy-Docs, Setup-Domain, Install-Voice or
  Install-Bot run and at least once a month, and files a "review" row as an
  issue or a record change.

.EXAMPLE
  pwsh scripts/vps/Box-Run.ps1 -Line 'Check-ProdParity'      from the cloud, through the deploy gate
  .\scripts\vps\Check-ProdParity.ps1 -Collect -Facts $env:TEMP\prod-facts.json -Report $env:TEMP\prod-parity.md
  .\scripts\vps\Check-ProdParity.ps1 -Facts .\facts.json -Report .\parity.md
#>
[CmdletBinding()]
param(
    [string]$Facts,
    [string]$Report,
    [switch]$Collect,
    # A folder for both files, the facts and the report, named
    # prod-facts.json and prod-parity.md. The deploy gate's Check-ProdParity
    # verb sets it to a folder of the run's own and sends both back, so a
    # cloud thread collects with no key to the box.
    [string]$Out,
    [string]$Record,
    [datetime]$Now = (Get-Date).ToUniversalTime(),
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
if ($Out) {
    if (-not (Test-Path -LiteralPath $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }
    if (-not $Facts) { $Facts = Join-Path $Out 'prod-facts.json' }
    if (-not $Report) { $Report = Join-Path $Out 'prod-parity.md' }
}
if (-not $Facts) { Write-Host 'Name -Facts, the facts file, or -Out, a folder for both files.' -ForegroundColor Red; exit 1 }
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Record) { $Record = Join-Path $Repo 'records\prod-parity.json' }

if ($Collect) {
    $out = & (Join-Path $PSScriptRoot 'Remote.ps1') -File (Join-Path $PSScriptRoot 'Get-ProdFacts.ps1')
    if ($LASTEXITCODE -ne 0) { Write-Host 'collecting from the VPS failed; nothing compared' -ForegroundColor Red; exit 1 }
    $json = (@($out) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1)
    if (-not $json) { Write-Host 'the VPS printed no facts' -ForegroundColor Red; exit 1 }
    Set-Content -LiteralPath $Facts -Value $json -Encoding utf8
}

$f = Get-Content -LiteralPath $Facts -Raw | ConvertFrom-Json
$r = Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
$rows = New-Object System.Collections.Generic.List[object]

function Row([string]$Area, [string]$Item, [string]$Expected, [string]$Actual, [bool]$Ok) {
    $cls = 'ok'; $why = ''
    if (-not $Ok) {
        $hit = @($r.intentional | Where-Object { $_.area -eq $Area -and $_.item -eq $Item }) | Select-Object -First 1
        if ($hit) { $cls = 'intentional'; $why = [string]$hit.why } else { $cls = 'review' }
    }
    $rows.Add([pscustomobject]@{ area = $Area; item = $Item; expected = $Expected; actual = $Actual; class = $cls; why = $why })
}

function Get-BindKind([string]$a) {
    if ($a -in '127.0.0.1', '::1') { return 'loopback' }
    if ($a -in '0.0.0.0', '::') { return 'public' }
    return 'address'
}

# ---- listeners -------------------------------------------------------------
foreach ($e in $r.listeners) {
    $have = @($f.listeners | Where-Object { $_.proto -eq $e.proto -and [int]$_.port -eq [int]$e.port })
    $item = "$($e.proto) $($e.port)"
    if (-not $have) { Row 'listener' $item "$($e.bind) $($e.process)" 'not listening' $false; continue }
    $kinds = @($have | ForEach-Object { Get-BindKind $_.address } | Sort-Object -Unique)
    $procs = @($have | ForEach-Object { [string]$_.process } | Sort-Object -Unique)
    $bindOk = switch ($e.bind) { 'any' { $true } 'loopback' { -not ($kinds -contains 'public' -or $kinds -contains 'address') } default { $kinds -contains 'public' } }
    $procOk = ($e.process -eq '*') -or ($procs -contains $e.process)
    Row 'listener' $item "$($e.bind) $($e.process)" (($kinds -join '+') + ' ' + ($procs -join '+')) ($bindOk -and $procOk)
}
# Anything public the record does not name is a door nobody wrote down.
$named = @($r.listeners | ForEach-Object { "$($_.proto) $($_.port)" })
$f.listeners | Where-Object { (Get-BindKind $_.address) -eq 'public' -and "$($_.proto) $($_.port)" -notin $named -and [int]$_.port -lt 49152 } |
    Group-Object { "$($_.proto) $($_.port)" } | ForEach-Object {
        Row 'listener' $_.Name 'not listed in the record' ('public ' + (@($_.Group.process | Sort-Object -Unique) -join '+')) $false
    }

# ---- tasks -----------------------------------------------------------------
foreach ($e in $r.tasks) {
    $t = @($f.tasks | Where-Object name -eq $e.name) | Select-Object -First 1
    if (-not $t) { Row 'task' $e.name "as $($e.user)" 'missing' $false; continue }
    $userOk = ([string]$t.user) -match ('^(NT AUTHORITY\\)?' + [regex]::Escape($e.user) + '$')
    Row 'task' $e.name "as $($e.user)" "as $($t.user)" $userOk
    if ($e.triggers) {
        $miss = @($e.triggers | Where-Object { $_ -notin @($t.triggers) })
        Row 'task' "$($e.name) triggers" ($e.triggers -join ',') (@($t.triggers) -join ',') (-not $miss)
    }
}
$f.tasks | Where-Object { $_.name -notin @($r.tasks.name) } | ForEach-Object { Row 'task' $_.name 'not listed in the record' "as $($_.user)" $false }

# ---- services --------------------------------------------------------------
foreach ($e in $r.services) {
    $like = $e.name -replace '\.', '\.' -replace '\*', '.*'
    $have = @($f.services | Where-Object { $_.name -match "^$like$" })
    if (-not $have) { Row 'service' $e.name "as $($e.account)" 'missing' $false; continue }
    foreach ($s in $have) {
        $acctOk = ([string]$s.account) -like $e.account
        Row 'service' $s.name "as $($e.account), running" "as $($s.account), $($s.state)" ($acctOk -and $s.state -eq 'Running')
    }
}

# ---- live files against the repository -------------------------------------
function Get-RepoHashes([string]$rel) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $Repo $rel))
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $lf = $text -replace "`r`n", "`n"; $crlf = $lf -replace "`n", "`r`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    @($lf, $crlf) | ForEach-Object { -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($_)) | ForEach-Object { $_.ToString('x2') }) }
}
. (Join-Path $PSScriptRoot 'Get-ProdFacts.ps1') -Define
foreach ($e in $r.files) {
    # "compare": "config" judges a config file by its body, comment and blank
    # lines left out on both sides (Get-ConfigBodyHash). Facts from before the
    # collector sent fileBodies fall back to the raw hash.
    # "folder": true holds every .js in the folder to the repository's
    # folder by name (the site's modules, #5357): each one the box has, and
    # each one only one side has.
    if ($e.folder) {
        $liveNames = @($f.files.PSObject.Properties.Name | Where-Object { $_ -like ($e.live + '\*') } | ForEach-Object { $_.Substring($e.live.Length + 1) })
        $repoNames = @(Get-ChildItem -LiteralPath (Join-Path $Repo $e.repo) -Filter *.js -File | ForEach-Object Name)
        foreach ($n in $repoNames) {
            $item = $e.live + '\' + $n; $rel = $e.repo + '/' + $n
            $live = [string]$f.files.$item
            if (-not $live) { Row 'file' $item "same as $rel" 'missing on the box' $false; continue }
            $ok = (Get-RepoHashes $rel) -contains $live
            Row 'file' $item "same as $rel at this checkout" $(if ($ok) { 'same' } else { 'differs (or deployed from another commit)' }) $ok
        }
        foreach ($n in @($liveNames | Where-Object { $repoNames -notcontains $_ })) {
            Row 'file' ($e.live + '\' + $n) "in $($e.repo)" 'on the box, not in the repository' $false
        }
        continue
    }
    $body = if ($f.fileBodies) { [string]$f.fileBodies.($e.live) } else { '' }
    if ($e.compare -eq 'config' -and $body) {
        $ok = (Get-ConfigBodyHash ([IO.File]::ReadAllText((Join-Path $Repo $e.repo)))) -eq $body
        Row 'file' $e.live "same as $($e.repo) at this checkout, comments aside" $(if ($ok) { 'same' } else { 'differs (or deployed from another commit)' }) $ok
        continue
    }
    $live = [string]$f.files.($e.live)
    if (-not $live) { Row 'file' $e.live "same as $($e.repo)" 'missing on the box' $false; continue }
    $ok = (Get-RepoHashes $e.repo) -contains $live
    Row 'file' $e.live "same as $($e.repo) at this checkout" $(if ($ok) { 'same' } else { 'differs (or deployed from another commit)' }) $ok
}

# ---- inbound firewall rules (#3807) ----------------------------------------
# Every enabled inbound Allow rule is on the record's list, by Name or
# DisplayName, and every required one is on. Set-InboundRules.ps1 turns off
# whatever is not listed; one that shows up afterwards is a door nobody wrote
# down. The row names a rule by its DisplayName: a Name can be a long run of
# letters and dashes that the secret scan below refuses.
if ($f.PSObject.Properties.Name -contains 'inboundRules') {
    $listed = @($r.inboundRules | ForEach-Object { [string]$_.rule })
    foreach ($e in @($r.inboundRules | Where-Object { $_.required })) {
        $on = @($f.inboundRules | Where-Object { $_.name -eq $e.rule -or $_.displayName -eq $e.rule })
        Row 'firewall' $e.rule 'on (required)' $(if ($on) { 'on' } else { 'off, or not on the box' }) ([bool]$on)
    }
    foreach ($x in @($f.inboundRules)) {
        if ($listed -contains [string]$x.name -or $listed -contains [string]$x.displayName) { continue }
        $ports = if (@($x.ports).Count) { @($x.ports) -join ',' } else { 'Any' }
        Row 'firewall' $x.displayName 'not listed in the record' ('on, ' + $x.protocol + ' ' + $ports + ' from ' + (@($x.remote) -join ',')) $false
    }
} else { Row 'firewall' 'inbound rules' 'collected' 'facts from before #3807 carry none' $false }

# ---- the box's own firewall policy, and Edge (#3896) ------------------------
# The firewall takes rules only from the box's policy store
# (scripts\vps\BoxFirewall.ps1), so no installer can open a port, and the
# in-box Edge, whose setup added an inbound rule with every version, is gone
# (vps-harden.ps1). Should its setup refuse the uninstall, Edge stays with its
# updater told never to install it again, and that is expected too (Patrick,
# 27 Oct, on the report page: q-3896-edge-uninstall-refused, A).
if ($f.PSObject.Properties.Name -contains 'firewallProfiles') {
    foreach ($p in @($f.firewallProfiles)) {
        Row 'firewall' ([string]$p.name + ' profile, local rules') 'ignored (AllowLocalFirewallRules False)' $(if ([string]$p.allowLocalRules -eq 'False') { 'ignored' } else { 'taken (' + $p.allowLocalRules + ')' }) ([string]$p.allowLocalRules -eq 'False')
    }
} else { Row 'firewall' 'local rules' 'collected' 'facts from before #3896 carry none' $false }
if ($f.PSObject.Properties.Name -contains 'edgeVersion') {
    $edgeBlocked = ($f.PSObject.Properties.Name -contains 'edgeInstallBlocked') -and [bool]$f.edgeInstallBlocked
    $edgeSaid = $(if (-not $f.edgeVersion) { 'not installed' } elseif ($edgeBlocked) { 'installed, ' + $f.edgeVersion + ', its setup refused the uninstall and the updater is told never to install it' } else { 'installed, ' + $f.edgeVersion + ', and nothing stops the updater putting it back' })
    Row 'program' 'Microsoft Edge' 'not installed, or kept with the updater told never to install it where its setup refuses the uninstall' $edgeSaid ((-not $f.edgeVersion) -or $edgeBlocked)
} else { Row 'program' 'Microsoft Edge' 'collected' 'facts from before #3896 carry none' $false }

# ---- TLS -------------------------------------------------------------------
$site = @($f.certs | Where-Object { $_.subject -match 'thornswood\.net' })
if (-not $site) { Row 'tls' 'thornswood.net' "valid, $($r.certMinDays)+ days" 'no certificate found' $false }
else {
    $best = $site | Sort-Object { [datetime]$_.notAfterUtc } -Descending | Select-Object -First 1
    $days = [math]::Floor(([datetime]$best.notAfterUtc - $Now).TotalDays)
    Row 'tls' 'thornswood.net' "valid, $($r.certMinDays)+ days" "$days days left" ($days -ge [int]$r.certMinDays)
}

# ---- settings and environment (names only) ---------------------------------
foreach ($n in $r.envMustBeAbsent) {
    $set = @($f.machineEnvNames) -contains $n
    Row 'env' $n 'not set' $(if ($set) { 'set' } else { 'not set' }) (-not $set)
}
foreach ($p in $f.settings.PSObject.Properties) {
    $v = $p.Value
    $shape = if ($v -is [string]) { $v } else { (@($v.PSObject.Properties | ForEach-Object { "$($_.Name) ($($_.Value))" }) -join ', ') }
    Row 'settings' $p.Name 'present and readable' $shape ($v -isnot [string])
}

# ---- versions (recorded, never judged) -------------------------------------
foreach ($p in $f.versions.PSObject.Properties) { Row 'version' $p.Name 'recorded' $(if ($p.Value) { [string]$p.Value } else { 'not found' }) $true }

# ---- report ----------------------------------------------------------------
$lines = @("# Production parity report", '', "Facts taken $($f.takenUtc) on $($f.host). Record: records\prod-parity.json.", '',
           '| Area | Item | Expected | Actual | Class |', '| --- | --- | --- | --- | --- |')
foreach ($x in $rows) { $lines += "| $($x.area) | $($x.item) | $($x.expected) | $($x.actual) | $($x.class)$(if ($x.why) { ': ' + $x.why }) |" }
$review = @($rows | Where-Object class -eq 'review')
$lines += ''; $lines += "$(@($rows | Where-Object class -eq 'ok').Count) ok, $(@($rows | Where-Object class -eq 'intentional').Count) intentional, $($review.Count) to review."
$text = $lines -join "`n"

# Refuse to write anything shaped like a secret: a long token that is not a
# 64 hex sha256, a private key header, or a key=value with a word like key.
$scan = $text -replace '\b[0-9a-f]{64}\b', ''
if ($scan -match '-----BEGIN|(?i)(password|secret|token|key)\s*[=:]\s*\S{6,}|[A-Za-z0-9+/_\-]{40,}') {
    Write-Host 'the report holds something shaped like a secret; it was not written' -ForegroundColor Red
    exit 2
}
if ($Report) { Set-Content -LiteralPath $Report -Value $text -Encoding utf8 } else { Write-Output $text }
foreach ($x in $review) { Write-Host ("REVIEW  {0} {1}: expected {2}, found {3}" -f $x.area, $x.item, $x.expected, $x.actual) -ForegroundColor Yellow }
Write-Host ("{0} rows, {1} to review" -f $rows.Count, $review.Count)
if ($Strict -and $review.Count) { exit 1 }
exit 0
