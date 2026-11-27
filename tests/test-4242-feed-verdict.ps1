# Run the two real setters in a scratch tree with only an offline feed adapter.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('feed-verdict-' + [guid]::NewGuid().ToString('N'))
$ops = Join-Path $tmp 'scripts/ops'; $release = Join-Path $tmp 'scripts/release'
$cfg = Join-Path $tmp 'config.json'; $feed = Join-Path $tmp 'version.json'
$trace = Join-Path $tmp 'trace.txt'; $marker = Join-Path $tmp 'scenario.txt'
$before = '{"ServerAddress":"old.invalid","ServerPort":"7777","CollectionUrl":"https://old.invalid"}'
$oldFeed = '{"serverAddress":"old.invalid","serverPort":"7777","collectionUrl":"https://old.invalid"}'
$script:bad = 0; $script:good = 0
function Yes($name, $ok) {
    if ($ok) { Write-Host "PASS $name"; $script:good++ }
    else { Write-Host "FAIL $name (exit $rc; $log)"; $script:bad++ }
}
try {
    $null = New-Item -ItemType Directory -Force -Path $ops, $release
    foreach ($name in 'Set-Server', 'Set-Collection') {
        Copy-Item -LiteralPath (Join-Path $repo "scripts/ops/$name.ps1") -Destination $ops
    }
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/release/Feed-Json.ps1') -Destination $release
    Set-Content -LiteralPath (Join-Path $release 'Feed-Store.ps1') -Value @'
. (Join-Path $PSScriptRoot 'Feed-Json.ps1')
function Get-FeedStoreDir($channel) { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
function Receive-FeedStore($channel, $dir) {
    Add-Content -LiteralPath (Join-Path $dir 'trace.txt') 'receive'
    if ((Get-Content -LiteralPath (Join-Path $dir 'scenario.txt')) -eq 'read-failure') { throw 'offline feed read failed' }
}
function Send-FeedStore($channel, $dir, $files) {
    Add-Content -LiteralPath (Join-Path $dir 'trace.txt') ('send:' + ($files -join ','))
    switch (Get-Content -LiteralPath (Join-Path $dir 'scenario.txt')) {
        'send-failure' { throw 'offline publisher refused' }
        'same' { return @{ Sent = @(); Same = @('version.json') } }
        'no-receipt' { return @{ Sent = @(); Same = @() } }
        default { return @{ Sent = @('version.json'); Same = @() } }
    }
}
'@
    foreach ($name in 'Set-Server', 'Set-Collection') {
        $ports = if ($name -eq 'Set-Server') { @('0','65536','1.5','no','-1','999999999999','1','65535') }
        foreach ($case in @('no-push','read-failure','bad-json','bad-shape','send-failure','same','no-receipt','published') + @($ports | Where-Object { $_ })) {
            [IO.File]::WriteAllText($cfg, $before)
            $feedBefore = switch ($case) { 'bad-json' { '{' } 'bad-shape' { '[{}]' } default { $oldFeed } }
            [IO.File]::WriteAllText($feed, $feedBefore)
            Set-Content -LiteralPath $marker -Value $case
            Set-Content -LiteralPath $trace -Value ''
            $params = @{ Root = $tmp; NoPause = $true }
            if ($name -eq 'Set-Server') {
                $params.Address = 'new.invalid'; $params.Force = $true
                $params.Port = if ($case -in $ports) { $case } else { '7788' }
                $field = 'ServerPort'; $expected = $params.Port
            } else {
                $params.Url = 'https://example.invalid/collection'; $field = 'CollectionUrl'; $expected = $params.Url
            }
            if ($case -eq 'no-push') { $params.NoPush = $true }
            # Each setter runs in its own pwsh, so its exit code is its own: run in
            # this process, a script that ends without exit leaves the last case's
            # $LASTEXITCODE standing.
            $argv = @('-NoProfile', '-File', (Join-Path $ops "$name.ps1"))
            foreach ($k in $params.Keys) { if ($params[$k] -is [bool]) { $argv += "-$k" } else { $argv += "-$k"; $argv += [string]$params[$k] } }
            $log = (& pwsh @argv 2>&1 | Out-String)
            $rc = $LASTEXITCODE
            $calls = (Get-Content -LiteralPath $trace -Raw).Trim()
            $claim = $log -match 'picks (this|it) up|site serves it now'
            $cfgAfter = [IO.File]::ReadAllText($cfg); $feedAfter = [IO.File]::ReadAllText($feed)
            if ($case -in @('0','65536','1.5','no','-1','999999999999','read-failure','bad-json','bad-shape')) {
                $expectedCalls = if ($case -in @('read-failure','bad-json','bad-shape')) { 'receive' } else { '' }
                Yes "$name $case leaves both files untouched" ($rc -eq 1 -and !$claim -and $calls -eq $expectedCalls -and $cfgAfter -ceq $before -and $feedAfter -ceq $feedBefore)
                continue
            }
            $updated = ($cfgAfter | ConvertFrom-Json).$field -ceq $expected -and ($feedAfter | ConvertFrom-Json).$field -ceq $expected
            switch ($case) {
                'no-push' { Yes "$name no-push stages locally without a public claim" ($rc -eq 0 -and $calls -eq 'receive' -and $updated -and !$claim -and $log -match 'Not pushed') }
                'send-failure' { Yes "$name publish refusal leaves a local edit only" ($rc -eq 1 -and $updated -and !$claim -and $log -match 'offline publisher refused') }
                'no-receipt' { Yes "$name missing publish receipt fails" ($rc -eq 1 -and !$claim) }
                'same' { Yes "$name already published reports no new publish" ($rc -eq 0 -and $updated -and !$claim -and $log -match 'already') }
                default { Yes "$name $case acknowledges a confirmed publish" ($rc -eq 0 -and $updated -and $claim -and $calls -match '(?s)^receive\s+send:version\.json$') }
            }
        }
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
Write-Host "$script:good passed, $script:bad failed"
if ($script:bad) { exit 1 }
