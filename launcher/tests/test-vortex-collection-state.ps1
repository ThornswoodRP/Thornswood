param([string]$Scratch)
$ErrorActionPreference='Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# A folder this run makes is removed in the finally below (#1992); one the
# caller passed in is the caller's to keep.
$ownScratch=-not $Scratch
if($ownScratch){$Scratch=Join-Path ([IO.Path]::GetTempPath()) ('thornswood-collection-state-'+[guid]::NewGuid().ToString('N'))}
$oldAppData=$env:APPDATA
try {
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
& python (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'fixtures\vortex-collection-state.py') $Scratch
if($LASTEXITCODE){throw 'Collection fixture generation failed'}
. (Join-Path $repo 'scripts\mods\LoadOrder.ps1')
$cases=@{
 'compressed'=2; 'updated'=3; 'downgraded'=1; 'deleted'=0; 'revision-deleted'=0; 'other-slug'=0;
 'mixed'=2; 'latest-not-installed'=2; 'obsolete'=2; 'authoring'=2; 'authoring-version'=2; 'authoring-numeric-version'=2;
 'cache-only'=0; 'ordinary-mod-cache'=0; 'other-author'=0; 'author-link-deleted'=0;
 'negative'=0; 'zero'=0; 'fraction'=0; 'overflow'=0; 'string-revision'=0; 'corrupt'=0; 'partial'=0; 'vertical-tab'=0; 'nbsp'=0; 'valid-space'=2; 'short-cache'=0; 'subscriber-unknown-author'=0; 'authoring-invalid-cache'=0
}
# #1902: the newest revision and the mod ids from the same compressed state,
# read through the same tie. Only the cases where they differ from the
# installed revision are named; every other case expects that number.
# latest-not-installed is the issue's own case: Vortex knows 99 is out.
# mixed: another collection's 99 is not this one's. A cached revision of the
# slug counts as known even with no mod tied to it, as it did before.
$newest=@{
 'latest-not-installed'=99; 'mixed'=2; 'cache-only'=99; 'ordinary-mod-cache'=2; 'author-link-deleted'=2;
 'subscriber-unknown-author'=2; 'authoring-invalid-cache'=2
}
# The tied mod, or none. An ordinary mod linked to a cached revision is not
# the collection, and neither is an authored one whose link was deleted.
$current='collection_current'; $local='vortex_collection_local'
$ids=@{
 'compressed'=$current; 'updated'=$current; 'downgraded'=$current; 'deleted'=''; 'revision-deleted'=$current; 'other-slug'='';
 'mixed'=$current; 'latest-not-installed'=$current; 'obsolete'=$current; 'authoring'=$local; 'authoring-version'=$local; 'authoring-numeric-version'=$local;
 'cache-only'=''; 'ordinary-mod-cache'=''; 'other-author'=''; 'author-link-deleted'='';
 'negative'=$current; 'zero'=$current; 'fraction'=$current; 'overflow'=$current; 'string-revision'=$current; 'corrupt'=''; 'partial'='';
 'vertical-tab'=$current; 'nbsp'=$current; 'valid-space'=$current; 'short-cache'=''; 'subscriber-unknown-author'=$current; 'authoring-invalid-cache'=$local
}
function Newest($case){ if($newest.ContainsKey($case)){$newest[$case]}else{$cases[$case]} }
$count=0
 # Exercise the publishing entry point first: the old raw-byte reader must fail.
 foreach($case in @('compressed')+@($cases.Keys | Where-Object {$_ -ne 'compressed'} | Sort-Object)){
  $env:APPDATA=Join-Path $Scratch ('collection-'+$case)
  $got=Get-CollectionRevisionFromState '7essxf'
  if($got -ne $cases[$case]){throw ('Collection '+$case+': expected '+$cases[$case]+', got '+$got)}
  $count++;Write-Host ('PASS publishing '+$case)
  $got=Get-CollectionNewest '7essxf'
  if($got -ne (Newest $case)){throw ('Newest '+$case+': expected '+(Newest $case)+', got '+$got)}
  $count++;Write-Host ('PASS newest '+$case)
  $got=(Get-CollectionModIds '7essxf') -join ','
  if($got -ne $ids[$case]){throw ('Mod ids '+$case+': expected ['+$ids[$case]+'], got ['+$got+']')}
  $count++;Write-Host ('PASS mod ids '+$case)
 }
 # The same reader built the way the launcher builds it, with the .NET SDK at
 # the launcher's C# version, on any machine (#4823), and called through the
 # type that build returns, not the copy LoadOrder.ps1 loaded above.
 $T=(Add-LauncherType -File ([IO.Path]::Combine($repo,'launcher','app','VortexProfileState.cs'))).GetType('Thornswood.VortexProfileState',$true)
 foreach($case in $cases.Keys | Sort-Object){
      $state=Join-Path (Join-Path $Scratch ('collection-'+$case)) 'Vortex\state.v2'
      $got=0;$gotNewest=0;$gotIds=''
      try{$got=$T::CollectionRevision($state,'7essxf')}catch{if($case -notin @('corrupt','partial')){throw}}
      if($got -ne $cases[$case]){throw ('Shared C# reader '+$case+' differs')}
      try{$gotNewest=$T::CollectionNewest($state,'7essxf')}catch{if($case -notin @('corrupt','partial')){throw}}
      if($gotNewest -ne (Newest $case)){throw ('Shared C# reader newest '+$case+' differs')}
      try{$gotIds=$T::CollectionModIds($state,'7essxf') -join ','}catch{if($case -notin @('corrupt','partial')){throw}}
      if($gotIds -ne $ids[$case]){throw ('Shared C# reader mod ids '+$case+' differs')}
      $count++;Write-Host ('PASS reader '+$case)
 }
 Write-Host ($count.ToString()+' collection cases and the compile passed')
}finally{
 $env:APPDATA=$oldAppData
 if($ownScratch -and (Test-Path -LiteralPath $Scratch)){Remove-Item -LiteralPath $Scratch -Recurse -Force}
}
