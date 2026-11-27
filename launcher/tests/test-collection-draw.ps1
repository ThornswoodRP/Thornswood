param([string]$Scratch)
$ErrorActionPreference='Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if(-not $Scratch){$Scratch=Join-Path ([IO.Path]::GetTempPath()) ('thornswood-collection-draw-'+[guid]::NewGuid().ToString('N'))}
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
$shell=[IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Shell.cs'))
$checksCs=[IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Checks.cs'))
function Method([string]$signature,[string]$text=$shell){
 $start=$text.IndexOf($signature)
 if($start -lt 0){throw ('Missing real method: '+$signature)}
 $at=$text.IndexOf('{',$start);$depth=1;$end=$at+1
 while($depth -gt 0 -and $end -lt $text.Length){if($text[$end] -eq '{'){$depth++};if($text[$end] -eq '}'){$depth--};$end++}
 if($depth){throw 'Unterminated real method'}
 return $text.Substring($start,$end-$start)
}
$draw=Method 'static bool DrawStatus()'
if(([regex]::Matches($draw,'Checks\.CollectionRevision\(cfg\)')).Count -ne 1){throw 'DrawStatus must take exactly one current revision observation'}
foreach($call in 'ModsMissing(collectionRevision)','CollectionUnconfirmed(collectionRevision)','ShowCollectionBar(collectionRevision)'){
 if(-not $draw.Contains($call)){throw ('DrawStatus does not pass its observation to '+$call)}
}
$methods=(Method 'static string CollectionProblem(')+(Method 'static bool ModsMissing(')+(Method 'static bool CollectionUnconfirmed(')
# The comparison itself is Checks.RevisionProblem, shared with the Mods row (#6944).
$revisionProblem=Method 'public static string RevisionProblem(' $checksCs
$harness=@'
using System;
namespace Thornswood {
 class Config { public string CollectionUrl = "https://example/collections/7essxf"; }
 static class Checks { public const int MostPluginsWithoutCollection=40; public static int Reads, Revision, Plugins=100;
  public static int EnabledPlugins(){return Plugins;} public static int CollectionRevision(Config c){Reads++;return Revision;}
  __REVISIONPROBLEM__ }
 static class Updater { public static int ServerCollectionRevision=2; }
 static class Swallow { public static void Note(string tag,Exception ex){throw ex;} }
 public static class CollectionDrawFixture {
  static Config cfg=new Config();
  __METHODS__
  public static void Run(){
   foreach(int revision in new[]{0,1,2,3}){
    Checks.Reads=0;Checks.Revision=revision;
    int observation=Checks.CollectionRevision(cfg);
    bool missing=ModsMissing(observation), unknown=CollectionUnconfirmed(observation);
    if(missing!=(revision==1||revision==3)||unknown!=(revision==0)||Checks.Reads!=1)throw new Exception("shared draw revision "+revision);
    Checks.Reads=0;
    if(CollectionUnconfirmed()!=(revision==0)||Checks.Reads!=1)throw new Exception("default observation "+revision);
   }
   Checks.Reads=0;Checks.Plugins=40;
   if(!ModsMissing(2)||CollectionUnconfirmed(2)||Checks.Reads!=0)throw new Exception("missing collection threshold");
   Checks.Plugins=100;Checks.Reads=0;cfg.CollectionUrl="";
   if(ModsMissing(2)||CollectionUnconfirmed(0)||Checks.Reads!=0)throw new Exception("no configured collection");
  }
 }
}
'@
# What is above read Shell.cs and held DrawStatus to one observation. What
# follows compiles the real methods with the .NET SDK the launcher builds
# with and runs them, on any machine (#4823). A refusal throws.
$assembly=Add-LauncherType -Source $harness.Replace('__METHODS__',$methods).Replace('__REVISIONPROBLEM__',$revisionProblem)
[void]$assembly.GetType('Thornswood.CollectionDrawFixture').GetMethod('Run').Invoke($null,@())
Write-Host 'PASS real collection methods: stale/ahead/unknown/current, default callers, threshold and absent URL; one observation per draw.'
