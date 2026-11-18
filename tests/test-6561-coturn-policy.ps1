# #6561: Config security and role isolation; never opens a socket or reads keys.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/turn/CoturnPolicy.ps1')
$path=Join-Path $PSScriptRoot '../records/turn/relay-policy.json'
$policy=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
$pass=0;$fail=0
function Yes($n,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $n"}else{$script:fail++;Write-Host "FAIL  $n"}}
function Refuses($n,[scriptblock]$a){$no=$false;try{& $a | Out-Null}catch{$no=$true};Yes $n $no}
$d=@(Get-CoturnPublicOptions $policy dev 8.8.8.8)
$m=@(Get-CoturnPublicOptions $policy main 8.8.8.8)
Yes 'Dev has its reviewed listener and media range' ('listening-port=3478' -in $d -and 'min-port=42000' -in $d -and 'max-port=42031' -in $d)
Yes 'Main has a separate staged listener and media range' ('listening-port=3479' -in $m -and 'min-port=42032' -in $m -and 'max-port=42063' -in $m)
Yes 'roles have distinct realms' ('realm=turn-dev.thornswood.net' -in $d -and 'realm=turn-main.thornswood.net' -in $m)
foreach($lines in @(@{role='dev';lines=$d},@{role='main';lines=$m})){
 $v=$lines.lines
 Yes ($lines.role+' preserves limits and required auth') ('use-auth-secret' -in $v -and 'user-quota=8' -in $v -and 'total-quota=32' -in $v -and 'max-bps=65536' -in $v -and 'bps-capacity=2097152' -in $v)
 Yes ($lines.role+' exposes no TLS/TCP/admin/DB/loopback permission option') ('no-tcp' -in $v -and 'no-tls' -in $v -and 'no-tcp-relay' -in $v -and -not @($v | Where-Object {$_ -match '^(dtls|cli|web-admin|prometheus|.*userdb|allow-loopback-peers|allowed-peer-ip|no-auth)(=|$)'}).Count)
 Yes ($lines.role+' protects private and link-local peers') ('denied-peer-ip=127.0.0.0-127.255.255.255' -in $v -and 'denied-peer-ip=100.64.0.0-100.127.255.255' -in $v -and 'denied-peer-ip=169.254.0.0-169.254.255.255' -in $v -and 'no-multicast-peers' -in $v)
 Yes ($lines.role+' public options never contain a secret') (-not @($v | Where-Object {$_ -match '^(static-auth-secret|user|oauth|.*password|.*key)='}).Count)
}
foreach($address in @('0.0.0.0','127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','8.8.8.8,1.1.1.1','8.8.8.8`nno-auth')){Refuses ('invalid/nonpublic bind refused: '+$address) {Get-CoturnPublicOptions $policy dev $address}}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.roles.main.minPort=42016;$bad.roles.main.maxPort=42047
Refuses 'overlapping role ranges are refused' {Get-CoturnPublicOptions $bad dev 8.8.8.8}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.roles.dev.minPort=50000;$bad.roles.dev.maxPort=50031
Refuses 'default dynamic UDP range cannot be used for relay media' {Get-CoturnPublicOptions $bad dev 8.8.8.8}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.totalQuota=0
Refuses 'unbounded allocation policy cannot be configured' {Get-CoturnPublicOptions $bad dev 8.8.8.8}
Write-Host "$pass passed, $fail failed";if($fail){exit 1}
