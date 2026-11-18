# Windows host controls shared by the reviewed installer and runtime gate.
function Set-CoturnDirectoryAcl {
 param([string]$Path,[string]$TaskSid,[switch]$Writable)
 $access=[Security.AccessControl.DirectorySecurity]::new()
 $rights=if($Writable){'0x1301bf'}else{'GRGX'}
 $access.SetSecurityDescriptorSddlForm("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;$rights;;;$TaskSid)")
 [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path),$access)
}
function Write-CoturnProtectedFile {
 param([string]$Path,[byte[]]$Bytes,[string]$ReaderSid='')
 $access=[Security.AccessControl.FileSecurity]::new()
 $read=if($ReaderSid){"(A;;FR;;;$ReaderSid)"}else{''}
 $access.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;SY)(A;;FA;;;BA)$read")
 $stream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$access)
 try{$stream.Write($Bytes)}finally{$stream.Dispose()}
}
function Assert-CoturnSecretAcl {
 param([string]$Path,[string]$ReaderSid='')
 $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'A protected relay file is a reparse point.'}
 $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
 $expected=@('S-1-5-18','S-1-5-32-544')+@($ReaderSid | Where-Object {$_})
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if(-not $acl.AreAccessRulesProtected -or $rules.Count -ne $expected.Count){throw 'Protected relay file ACL shape is not exact.'}
 foreach($rule in $rules){
  if($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin $expected){throw 'Protected relay file has an unexpected access rule.'}
  $want=if($rule.IdentityReference.Value -eq $ReaderSid){[Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Synchronize}else{[Security.AccessControl.FileSystemRights]::FullControl}
  if($rule.FileSystemRights -ne $want){throw 'Protected relay file rights differ from the required role.'}
 }
}
function Assert-CoturnCutover {
 param([string]$RelayIPv4)
 $addresses=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {$_.IPAddress -ceq $RelayIPv4 -and $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource})
 if($addresses.Count -ne 1){throw 'The intended public IPv4 is not exactly one active preferred source address; cutover is not verified.'}
 # Range choices are below the measured dynamic boundary. Recheck the actual
 # live OS instead of assuming Windows defaults survived another operator.
 foreach($family in 'ipv4','ipv6'){
  $range=@(& netsh.exe int $family show dynamicport udp)
  if($LASTEXITCODE -ne 0){throw 'Cannot verify the Windows dynamic UDP range.'}
  $start=@($range | Where-Object {$_ -match '^\s*Start Port\s*:\s*([0-9]+)\s*$'} | ForEach-Object {[int]$Matches[1]})
  if($start.Count -ne 1 -or $start[0] -le 42063){throw 'The proposed relay blocks overlap or cannot be compared with the actual dynamic UDP range.'}
 }
}
function Assert-CoturnInstalledFiles {
 param([string]$Root)
 $pin=Get-Content -LiteralPath (Join-Path $Root 'supplier-pin.json') -Raw | ConvertFrom-Json
 if($pin.schema -ne 1 -or $pin.supplier -cne 'coturn/coturn' -or @($pin.files).Count -lt 1 -or @($pin.files | Where-Object path -CEQ 'bin/turnserver.exe').Count -ne 1){throw 'Installed supplier pin is incomplete.'}
 foreach($file in $pin.files){
  if($file.path -cnotmatch '^bin/[A-Za-z0-9_.-]+$' -and $file.path -cne 'doc/turnserver/LICENSE'){throw 'Unsafe installed relay file pin.'}
  $item=Get-Item -LiteralPath (Join-Path (Join-Path $Root 'runtime') $file.path) -Force -ErrorAction Stop
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256){throw 'Installed native relay bytes differ from the reviewed supplier pin.'}
 }
}
