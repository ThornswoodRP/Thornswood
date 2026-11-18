# #6561: Exercise real nested archive validation and refusal before staging.
# No vendor executable, credential, network, service or firewall operation.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/turn/CoturnPackage.ps1')
$pass=0;$fail=0
function Yes($name,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $name"}else{$script:fail++;Write-Host "FAIL  $name"}}
function Refuses($name,[scriptblock]$action){$refused=$false;try{& $action | Out-Null}catch{$refused=$true};Yes $name $refused}
function Hash([byte[]]$bytes){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()}
function Zip([object[]]$entries){
 $stream=[IO.MemoryStream]::new();$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
 try {foreach($entry in $entries){$e=$zip.CreateEntry($entry.Name);$s=$e.Open();try{$s.Write([byte[]]$entry.Bytes)}finally{$s.Dispose()}}}finally{$zip.Dispose()}
 try{return ,$stream.ToArray()}finally{$stream.Dispose()}
}
$nonce=[guid]::NewGuid().ToString('n')
$root=Join-Path ([IO.Path]::GetTempPath()) ('tw-coturn-package-'+$nonce)
[void][IO.Directory]::CreateDirectory($root)
[IO.File]::WriteAllText((Join-Path $root '.owned'),$nonce)
try{
 $data=[Text.Encoding]::UTF8.GetBytes('inert fixture bytes, not an executable')
 $entry=@{Name='bin/turnserver.exe';Bytes=$data}
 $inner=Zip @($entry)
 $outer=Zip @(@{Name='coturn_windows_msvc.zip';Bytes=$inner})
 $archive=Join-Path $root 'fixture.zip';[IO.File]::WriteAllBytes($archive,$outer)
 $pin=@{schema=1;supplier='coturn/coturn';artifactBytes=$outer.Length;artifactSha256=(Hash $outer);innerArchiveName='coturn_windows_msvc.zip';innerArchiveBytes=$inner.Length;innerArchiveSha256=(Hash $inner);files=@(@{path='bin/turnserver.exe';bytes=$data.Length;sha256=(Hash $data)})}
 $read=Read-CoturnRuntime $archive $pin
 Yes 'valid nested archive returns only exact reviewed bytes' ($read.Count -eq 1 -and [Convert]::ToBase64String($read[0].Bytes) -eq [Convert]::ToBase64String($data))
 $bad=$pin.Clone();$bad.artifactSha256='0'*64;Refuses 'wrong outer digest is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.artifactBytes++;Refuses 'wrong outer size is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.innerArchiveSha256='0'*64;Refuses 'wrong inner digest is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.innerArchiveBytes++;Refuses 'wrong inner size is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@(@{path='bin/turnserver.exe';bytes=$data.Length;sha256=('0'*64)});Refuses 'altered runtime byte hash is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@($pin.files[0],@{path='bin/absent.dll';bytes=2;sha256=('0'*64)});Refuses 'missing reviewed file is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@($pin.files[0],@{path='../escape.exe';bytes=2;sha256=('0'*64)});Refuses 'traversal in reviewed file list is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@($pin.files[0],$pin.files[0]);Refuses 'duplicate reviewed file is refused' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@(@{path='bin/turnserver.exe';bytes=16777217;sha256=('0'*64)});Refuses 'oversized reviewed file is refused before decompression' {Read-CoturnRuntime $archive $bad}
 $bad=$pin.Clone();$bad.files=@();Refuses 'empty runtime cannot be prepared as a valid package' {Read-CoturnRuntime $archive $bad}
 $dupInner=Zip @($entry,$entry);$dupOuter=Zip @(@{Name='coturn_windows_msvc.zip';Bytes=$dupInner});$dupPath=Join-Path $root 'duplicate.zip';[IO.File]::WriteAllBytes($dupPath,$dupOuter)
 $bad=$pin.Clone();$bad.artifactBytes=$dupOuter.Length;$bad.artifactSha256=Hash $dupOuter;$bad.innerArchiveBytes=$dupInner.Length;$bad.innerArchiveSha256=Hash $dupInner
 Refuses 'duplicate zip entry is refused despite matching archive pin' {Read-CoturnRuntime $dupPath $bad}
 $safe=Join-Path $root 'new-package';Yes 'new named staging child is accepted' ((Assert-NewCoturnStagingPath $safe) -eq [IO.Path]::GetFullPath($safe))
 Refuses 'existing package directory is never overwritten' {Assert-NewCoturnStagingPath $root}
 Refuses 'existing file is never used as package directory' {Assert-NewCoturnStagingPath $archive}
 $drive=[IO.Path]::GetPathRoot($root);Refuses 'top-level path is never a staging destination' {Assert-NewCoturnStagingPath (Join-Path $drive ('tw-'+$nonce))}
}finally{
 $full=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
 if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.File]::ReadAllText((Join-Path $root '.owned')) -ne $nonce){throw 'Refusing cleanup of an unowned fixture path'}
 Remove-Item -LiteralPath $full -Recurse -Force
}
Write-Host "$pass passed, $fail failed"
if($fail){exit 1}
