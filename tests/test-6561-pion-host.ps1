# #6561: Windows ACL creation plus read-only mocked cutover detection.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
. (Join-Path $PSScriptRoot '../scripts/turn/PionHost.ps1')
$pass=0;$fail=0
function Yes($n,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $n"}else{$script:fail++;Write-Host "FAIL  $n"}}
function Refuses($n,[scriptblock]$a){$no=$false;try{& $a | Out-Null}catch{$no=$true};Yes $n $no}
Yes 'SYSTEM filesystem owner trusted' (Test-PionTrustedOwner 'S-1-5-18' 'fixture-operator' $false)
Yes 'unexpected filesystem owner refused despite safe DACL' (-not (Test-PionTrustedOwner 'S-1-5-19' 'fixture-operator' $true))
Yes 'nonadministrator caller cannot bless its own owner SID' (-not (Test-PionTrustedOwner 'fixture-operator' 'fixture-operator' $false))
$script:sourceEnabled=$true;$script:rangeStart=49152
function Get-NetIPAddress {[pscustomobject]@{IPAddress='203.0.113.7';AddressState='Preferred';SkipAsSource=(-not $script:sourceEnabled)}}
function netsh.exe {"Start Port : $script:rangeStart";$global:LASTEXITCODE=0}
$ok=$true;try{Assert-PionCutover 203.0.113.7}catch{$ok=$false};Yes 'actual preferred source and nonoverlapping dynamic boundary admit cutover' $ok
$script:sourceEnabled=$false;Refuses 'staged SkipAsSource address cannot activate a relay' {Assert-PionCutover 203.0.113.7};$script:sourceEnabled=$true
$script:rangeStart=42000;Refuses 'changed dynamic UDP range blocks activation' {Assert-PionCutover 203.0.113.7}
$script:rule=[pscustomobject]@{Enabled='True';Direction='Inbound';Action='Allow'}
$script:address=[pscustomobject]@{LocalAddress='203.0.113.7'}
$script:program=[pscustomobject]@{Program='C:/fixture/thornswood-turn.exe'}
$script:ports=[pscustomobject]@{Protocol='UDP';LocalPort=@('3478','42000-42031')}
function Get-NetFirewallRule {return $script:rule}
function Get-NetFirewallAddressFilter {return $script:address}
function Get-NetFirewallApplicationFilter {return $script:program}
function Get-NetFirewallPortFilter {return $script:ports}
$role=[pscustomobject]@{udpPort=3478;minPort=42000;maxPort=42031}
$ok=$true;try{Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role}catch{$ok=$false};Yes 'exact active-store public program and UDP scope' $ok
$script:rule.Enabled='False';Refuses 'false enum text cannot pass as truthy firewall enablement' {Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role};$script:rule.Enabled='True'
$script:address.LocalAddress='Any';Refuses 'widened local ingress address' {Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role};$script:address.LocalAddress='203.0.113.7'
$script:program.Program='Any';Refuses 'widened program scope' {Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role};$script:program.Program='C:/fixture/thornswood-turn.exe'
$script:ports.LocalPort=@('3478','42000-65535');Refuses 'widened UDP range' {Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role};$script:ports.LocalPort=@('3478','42000-42031')
$script:ports.Protocol='TCP';Refuses 'wrong transport scope' {Assert-PionIngress fixture C:/fixture/thornswood-turn.exe 203.0.113.7 $role}
if($OnWindows){
 $principal=[pscustomobject]@{Principal=[pscustomobject]@{UserId='LOCAL SERVICE';RunLevel='Limited';ProcessTokenSidType='Unrestricted';RequiredPrivilege=@('SeChangeNotifyPrivilege')}}
 $ok=$true;try{Assert-PionTaskPrincipal $principal}catch{$ok=$false};Yes 'Windows normalized LOCAL SERVICE resolves to the required SID' $ok
 $principal.Principal.UserId='SYSTEM';Refuses 'a real SYSTEM identity cannot satisfy restricted SID check' {Assert-PionTaskPrincipal $principal}
 $n=[guid]::NewGuid().ToString('n');$root=Join-Path ([IO.Path]::GetTempPath()) ('tw-pion-acl-'+$n);[void][IO.Directory]::CreateDirectory($root)
 $path=Join-Path $root 'fixture.txt';$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 try{
  Write-PionProtectedFile $path ([Text.Encoding]::ASCII.GetBytes('nonsecret inert ACL fixture')) $current
  $ok=$true;try{Assert-PionSecretAcl $path $current}catch{$ok=$false};Yes 'protected generic Read ACE is validated with its native Synchronize bit' $ok
  $acl=Get-Acl -LiteralPath $path;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-19'),[Security.AccessControl.FileSystemRights]::Read,'Allow'));[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl)
  Refuses 'shared LOCAL SERVICE access cannot reach a task-specific secret' {Assert-PionSecretAcl $path $current}
 }finally{
  if(Test-Path -LiteralPath $path){$acl=Get-Acl -LiteralPath $path;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($current),[Security.AccessControl.FileSystemRights]::FullControl,'Allow'));[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl);Remove-Item -LiteralPath $path -Force}
  if([IO.Path]::GetFileName($root) -cne ('tw-pion-acl-'+$n)){throw 'Unexpected ACL fixture cleanup path'}
  Remove-Item -LiteralPath $root
 }
}else{Write-Host 'SKIP Windows ACL check: Windows native relay uses Windows ACLs; platform-independent cutover refusal checks ran.'}
Write-Host "$pass passed, $fail failed";if($fail){exit 1}
