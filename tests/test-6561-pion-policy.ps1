# #6561: Exercise the public native config contract without reading a real key.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/turn/PionPolicy.ps1')
$path=Join-Path $PSScriptRoot '../records/turn/relay-policy.json'
$policy=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
$pass=0;$fail=0
function Yes($n,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $n"}else{$script:fail++;Write-Host "FAIL  $n"}}
function Refuses($n,[scriptblock]$a){$no=$false;try{& $a | Out-Null}catch{$no=$true};Yes $n $no}
$key=Join-Path ([IO.Path]::GetTempPath()) 'inert-key.txt'
$d=Get-PionConfiguration $policy dev 8.8.8.8 $key
$m=Get-PionConfiguration $policy main 8.8.8.8 $key
Yes 'Dev reviewed listener and allocation range' ($d.listenPort -eq 3478 -and $d.minPort -eq 42000 -and $d.maxPort -eq 42031)
Yes 'Main separate listener and allocation range' ($m.listenPort -eq 3479 -and $m.minPort -eq 42032 -and $m.maxPort -eq 42063)
Yes 'separate realms and no embedded credential' ($d.realm -ceq 'turn-dev.thornswood.net' -and $m.realm -ceq 'turn-main.thornswood.net' -and $d.Count -eq 8 -and -not $d.Contains('secret'))
foreach($address in @('0.0.0.0','127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','8.8.8.8,1.1.1.1')){Refuses ('unsafe bind '+$address) {Get-PionConfiguration $policy dev $address $key}}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.roles.main.minPort=42016;$bad.roles.main.maxPort=42047
Refuses 'overlapping role ranges' {Get-PionConfiguration $bad dev 8.8.8.8 $key}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.roles.dev.minPort=50000;$bad.roles.dev.maxPort=50031
Refuses 'dynamic-range allocation ports' {Get-PionConfiguration $bad dev 8.8.8.8 $key}
$bad=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json;$bad.totalQuota=0
Refuses 'unbounded quotas' {Get-PionConfiguration $bad dev 8.8.8.8 $key}
Refuses 'relative protected key path' {Get-PionConfiguration $policy dev 8.8.8.8 'relative.txt'}
$text=$d | ConvertTo-Json -Compress;$bytes=[Text.UTF8Encoding]::new($false).GetBytes($text)
$ok=$true;try{Assert-PionConfigShape $d $bytes}catch{$ok=$false};Yes 'exact serialized configuration' $ok
Refuses 'extra config field' {Assert-PionConfigShape $d ([Text.Encoding]::UTF8.GetBytes($text.Replace('}',',"extra":true}')))}
Refuses 'UTF16 config' {Assert-PionConfigShape $d ([Text.Encoding]::Unicode.GetBytes($text))}
Refuses 'duplicate config field' {Assert-PionConfigShape $d ([Text.Encoding]::UTF8.GetBytes($text.Replace('{','{"schema":1,')))}
Write-Host "$pass passed, $fail failed";if($fail){exit 1}
