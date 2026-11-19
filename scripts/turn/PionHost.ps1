# Windows host controls shared by the reviewed installer and runtime gate.
function Test-PionTrustedOwner {
 param([string]$Sid,[string]$OperatorSid,[bool]$OperatorIsAdmin)
 return ($Sid -in @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') -or ($OperatorIsAdmin -and $Sid -ceq $OperatorSid))
}
function Get-PionCommandInterpreter {
 $windows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
 if(-not $windows){throw 'The native relay/voice task requires the actual Windows command interpreter.'}
 return Join-Path $windows 'System32/cmd.exe'
}
function Assert-PionTaskPrincipal {
 param($Task)
 $id=[string]$Task.Principal.UserId
 if($id -notmatch '^S-1-'){$id=([Security.Principal.NTAccount]::new($id)).Translate([Security.Principal.SecurityIdentifier]).Value}
 if($id -cne 'S-1-5-19' -or [string]$Task.Principal.RunLevel -cne 'Limited' -or [string]$Task.Principal.ProcessTokenSidType -cne 'Unrestricted' -or @($Task.Principal.RequiredPrivilege).Count -ne 1 -or [string]$Task.Principal.RequiredPrivilege[0] -cne 'SeChangeNotifyPrivilege'){throw 'Relay/voice task is not the exact restricted LOCAL SERVICE principal.'}
}
function Get-PionOwnerIdentity {
 $src=Get-ThornswoodOwnerLaunchSource
 $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($src.Replace("`r`n","`n")))).ToLowerInvariant()
 $directory=Join-Path $env:ProgramFiles 'Thornswood'
 $path=Join-Path $directory ('thornswood-owner-'+$hash.Substring(0,12)+'.exe')
 $may=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
 $operator=[Security.Principal.WindowsIdentity]::GetCurrent()
 $admin=[Security.Principal.WindowsPrincipal]::new($operator).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 foreach($name in $path,$directory){
  $item=Get-Item -LiteralPath $name -Force -ErrorAction Stop
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Canonical owner path is a reparse point.'}
  $acl=Get-Acl -LiteralPath $name
  if(-not (Test-PionTrustedOwner $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value $operator.User.Value $admin)){throw 'Canonical task owner path has an unexpected filesystem owner.'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if([string]$rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -in $may){continue}
   if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and $name -ceq $directory){continue}
   if(([long][int]$rule.FileSystemRights -band [long]0x500D0156) -ne 0){throw 'Canonical task owner can be modified by an unexpected principal.'}
  }
 }
 return @{path=$path;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function Assert-PionVoiceAction {
 param($Action,[string]$Root,[string]$TaskSid,[string]$OwnerPath,[string]$Shell,[string]$Node)
 if($Action.Execute -ine $OwnerPath -or $Action.WorkingDirectory -ine $Root -or -not $Action.Arguments.StartsWith($TaskSid+' "',[StringComparison]::Ordinal)){throw 'Voice action is outside the canonical role/owner root.'}
 $plain=Get-ThornswoodPlainAction $Action
 if($plain.Execute -ine $Shell){throw 'Voice action does not use the canonical command interpreter.'}
 $prefix='/c "set THORNSWOOD_SITE=http://127.0.0.1:3001&& set THORNSWOOD_VOICE_PORT=7789&& set THORNSWOOD_VOICE_BIND=127.0.0.1&& set THORNSWOOD_VOICE_AUTH=on&& set THORNSWOOD_CHAT_RANGE='
 $suffix=' start "" /b /wait /high "'+$Node+'" "'+(Join-Path $Root 'server-log.js')+'" --log "'+(Join-Path $Root 'voice.log')+'" --days 90 --stamp voice-server.js & call exit %^errorlevel%"'
 $pattern='^'+[regex]::Escape($prefix)+'[0-9]{1,6}(?:\.[0-9]{1,6})?&& (?:set THORNSWOOD_VOICE_MOST=[0-9]{1,4}&& )?set THORNSWOOD_TURN_URL=turn:[A-Za-z0-9.-]+:[0-9]{1,5}(?:\?transport=udp)?&& '+[regex]::Escape($suffix)+'$'
 if($plain.Argument -cnotmatch $pattern){throw 'Voice action is not the exact canonical Dev chain with unique safe bindings.'}
}
function Assert-PionRelayTask {
 param($Task,[string]$Root,[string]$TaskSid)
 Assert-PionTaskPrincipal $Task
 $owner=Get-PionOwnerIdentity
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 $argument='"'+(Join-Path $Root 'ops/server-log.js')+'" --log "'+(Join-Path $Root 'logs/turn.log')+'" --days 90 --stamp "'+(Join-Path $Root 'ops/Run-Pion.js')+'"'
 $expected=$TaskSid+' "'+$node+'" '+$argument
 if(@($Task.Actions).Count -ne 1 -or $Task.Actions[0].Execute -ine $owner.path -or $Task.Actions[0].Arguments -cne $expected -or $Task.Actions[0].WorkingDirectory -ine $Root){throw 'Relay task action is not the exact canonical owner/role/runner.'}
 return $owner
}
function Set-PionDirectoryAcl {
 param([string]$Path,[string]$TaskSid,[switch]$Writable)
 $access=[Security.AccessControl.DirectorySecurity]::new()
 $rights=if($Writable){'0x1301bf'}else{'GRGX'}
 $access.SetSecurityDescriptorSddlForm("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;$rights;;;$TaskSid)")
 [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path),$access)
}
function Write-PionProtectedFile {
 param([string]$Path,[byte[]]$Bytes,[string]$ReaderSid='')
 $access=[Security.AccessControl.FileSecurity]::new()
 $read=if($ReaderSid){"(A;;FR;;;$ReaderSid)"}else{''}
 $access.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;SY)(A;;FA;;;BA)$read")
 $stream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$access)
 try{$stream.Write($Bytes)}finally{$stream.Dispose()}
}
function Assert-PionSecretAcl {
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
function Assert-PionCutover {
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
function Assert-PionInstalledFiles {
 param([string]$Root)
 $state=Get-Content -LiteralPath (Join-Path $Root 'relay.json') -Raw | ConvertFrom-Json
 . (Join-Path $PSScriptRoot 'PionPackage.ps1')
 $null=Assert-PionWindowsPackage -Directory (Join-Path $Root 'runtime') -ExpectedSourceCommit $state.operationsCommit -ExpectedPackageHash $state.packageHash -PinPath (Join-Path $Root 'pion-pin.json')
}
function Assert-PionIngress {
 param([string]$Name,[string]$Executable,[string]$RelayIPv4,$Role)
 $rules=@(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name -ErrorAction Stop)
 if($rules.Count -ne 1 -or [string]$rules[0].Enabled -cne 'True' -or [string]$rules[0].Direction -cne 'Inbound' -or [string]$rules[0].Action -cne 'Allow'){throw 'Actual relay ingress rule is not the exact enabled inbound allow.'}
 $address=@($rules[0] | Get-NetFirewallAddressFilter -ErrorAction Stop)
 $program=@($rules[0] | Get-NetFirewallApplicationFilter -ErrorAction Stop)
 $port=@($rules[0] | Get-NetFirewallPortFilter -ErrorAction Stop)
 $want=@([string]$Role.udpPort,([string]$Role.minPort+'-'+[string]$Role.maxPort)) | Sort-Object
 $actual=@($port.LocalPort) | Sort-Object
 if($address.Count -ne 1 -or @($address.LocalAddress).Count -ne 1 -or $address.LocalAddress -cne $RelayIPv4 -or $program.Count -ne 1 -or $program.Program -ine $Executable -or $port.Count -ne 1 -or [string]$port.Protocol -notin '17','UDP' -or ($actual -join ',') -cne ($want -join ',')){throw 'Actual relay ingress address/program/UDP ports differ from the reviewed scope.'}
}
