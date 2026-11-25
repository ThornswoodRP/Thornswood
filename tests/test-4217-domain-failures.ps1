# Run the installer with a stand-in transport. Execute the sent config and
# firewall code against scratch files and functions, never a box or live rule.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('test-4217-' + [guid]::NewGuid())
$pass = 0; $fail = 0
function Check($name, $ok, $details) {
    if ($ok) { Write-Host "PASS  $name"; $script:pass++ }
    else { Write-Host "FAIL  $name`n$details"; $script:fail++ }
}
try {
    $deploy = Join-Path $tmp 'deploy'
    $vps = Join-Path $tmp 'vps'
    $scratchCaddy = Join-Path $tmp 'caddy'
    New-Item -ItemType Directory -Path $deploy, $vps, $scratchCaddy -Force | Out-Null
    foreach ($f in 'Setup-Domain.ps1', 'Caddyfile') { Copy-Item (Join-Path $repo "scripts/deploy/$f") $deploy }
    foreach ($f in 'Vps.ps1', 'ServerHold.ps1') { Set-Content (Join-Path $vps $f) '# stand-in' }
    Set-Content (Join-Path $deploy 'CloudflareRanges.ps1') '# DNS is not called'
    Set-Content (Join-Path $deploy 'ServiceAccount.ps1') 'function Get-ThornswoodServiceAccountScript {}'
    Set-Content (Join-Path $vps 'Lock-Folder.ps1') @'
function Get-ThornswoodLockedFolderScript {}
function Get-ThornswoodLockFailure {}
'@
    Set-Content (Join-Path $vps 'BoxFirewall.ps1') @'
function Get-ThornswoodFirewallScript {
    'function Sync-ThornswoodFirewall { $trace.Add("refresh") }'
}
'@
    Set-Content (Join-Path $vps 'Send-Script.ps1') @'
function Get-ThornswoodHoldScript { param($Script) }
function Get-ThornswoodDetachedRun {
    param($Script)
    @{ Start = 'fixture restart'; Read = 'fixture read'; Log = 'fixture log' }
}
function Start-Sleep { param($Seconds) }
function Invoke-ThornswoodRemote($Target, $SshArgs, $Script) {
    $global:LASTEXITCODE = 0
    if ($Script -eq 'fixture restart') { $trace.Add('restart'); return 'STARTED 1' }
    if ($Script -eq 'fixture read') { return 'REPORT 1', 'END 0' }
    if ($Script.Contains('docs restarted on loopback')) { $trace.Add('loopback'); return 'docs restarted on loopback' }
    if ($case -eq 'transport') { $global:LASTEXITCODE = 255; return 'fixture transport unavailable' }
    $cut = $Script.IndexOf('# A Caddyfile already on the box')
    if ($cut -lt 0) { throw 'Unexpected remote call in fixture' }
    $dir = $scratchCaddy
    if ($case -eq 'write') { $dir = Join-Path $scratchCaddy 'missing-parent' }
    function Get-NetFirewallRule { [CmdletBinding()] param($PolicyStore, $DisplayName) }
    function New-NetFirewallRule {
        [CmdletBinding()] param($PolicyStore, $DisplayName, $Direction, $Protocol, $LocalPort, $Action)
        $trace.Add("rule $LocalPort")
        if ($case -eq 'rule' -and $LocalPort -eq 443) { Write-Error 'fixture rule denied' }
    }
    $ErrorActionPreference = 'Stop'
    try { & ([scriptblock]::Create($Script.Substring($cut))) }
    catch { $_.Exception.Message; $global:LASTEXITCODE = 1 }
}
'@
    foreach ($case in 'write', 'rule', 'transport', 'ok') {
        $trace = [Collections.Generic.List[string]]::new()
        $global:LASTEXITCODE = 0
        $out = (& (Join-Path $deploy 'Setup-Domain.ps1') -SkipDnsCheck -Vps '192.0.2.1' -User fixture -Domain 'fixture.invalid' *>&1) -join "`n"
        $rc = $LASTEXITCODE
        if ($case -eq 'ok') {
            Check 'success applies the rules and reaches the site address' ($rc -eq 0 -and $out -match 'https://fixture\.invalid' -and ($trace -join ',') -eq 'rule 80,rule 443,refresh,loopback,restart') $out
            continue
        }
        Check "$case exits 1 without restarting or printing success" ($rc -eq 1 -and $out -notmatch 'https://fixture\.invalid' -and $trace -notcontains 'loopback' -and $trace -notcontains 'restart') $out
        switch ($case) {
            'write' { Check 'write failure identifies the config step and creates no rule' ($out -match 'Could not write the Caddyfile' -and -not $trace.Count) $out }
            'rule' { Check 'rule failure identifies TCP 443 and preserves the diagnostic' ($out -match 'Could not open TCP port 443' -and $out -match 'fixture rule denied' -and $trace -notcontains 'refresh') $out }
            'transport' { Check 'transport failure identifies setup and retains its exit code' ($out -match 'Caddy setup failed.*255' -and $out -match 'fixture transport unavailable') $out }
        }
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
Write-Host "$pass passed, $fail failed"
exit [int]($fail -gt 0)
