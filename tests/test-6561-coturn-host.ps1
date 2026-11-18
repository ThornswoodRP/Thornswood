# #6561: Windows ACL creation plus read-only mocked cutover detection.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/turn/CoturnHost.ps1')
$pass=0;$fail=0
function Yes($n,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $n"}else{$script:fail++;Write-Host "FAIL  $n"}}
function Refuses($n,[scriptblock]$a){$no=$false;try{& $a | Out-Null}catch{$no=$true};Yes $n $no}
$script:sourceEnabled=$true;$script:rangeStart=49152
function Get-NetIPAddress {[pscustomobject]@{IPAddress='8.8.8.8';AddressState='Preferred';SkipAsSource=(-not $script:sourceEnabled)}}
function netsh.exe {"Start Port : $script:rangeStart";$global:LASTEXITCODE=0}
$ok=$true;try{Assert-CoturnCutover 8.8.8.8}catch{$ok=$false};Yes 'actual preferred source and nonoverlapping dynamic boundary admit cutover' $ok
$script:sourceEnabled=$false;Refuses 'staged SkipAsSource address cannot activate a relay' {Assert-CoturnCutover 8.8.8.8};$script:sourceEnabled=$true
$script:rangeStart=42000;Refuses 'changed dynamic UDP range blocks activation' {Assert-CoturnCutover 8.8.8.8}
if($IsWindows){
 $n=[guid]::NewGuid().ToString('n');$root=Join-Path ([IO.Path]::GetTempPath()) ('tw-coturn-acl-'+$n);[void][IO.Directory]::CreateDirectory($root)
 $path=Join-Path $root 'fixture.txt';$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 try{
  Write-CoturnProtectedFile $path ([Text.Encoding]::ASCII.GetBytes('nonsecret inert ACL fixture')) $current
  $ok=$true;try{Assert-CoturnSecretAcl $path $current}catch{$ok=$false};Yes 'protected generic Read ACE is validated with its native Synchronize bit' $ok
  $acl=Get-Acl -LiteralPath $path;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-19'),[Security.AccessControl.FileSystemRights]::Read,'Allow'));[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl)
  Refuses 'shared LOCAL SERVICE access cannot reach a task-specific secret' {Assert-CoturnSecretAcl $path $current}
 }finally{
  if(Test-Path -LiteralPath $path){$acl=Get-Acl -LiteralPath $path;$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($current),[Security.AccessControl.FileSystemRights]::FullControl,'Allow'));[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($path),$acl);Remove-Item -LiteralPath $path -Force}
  if([IO.Path]::GetFileName($root) -cne ('tw-coturn-acl-'+$n)){throw 'Unexpected ACL fixture cleanup path'}
  Remove-Item -LiteralPath $root
 }
}else{Write-Host 'SKIP Windows ACL check: Windows native relay uses Windows ACLs; platform-independent cutover refusal checks ran.'}
Write-Host "$pass passed, $fail failed";if($fail){exit 1}
