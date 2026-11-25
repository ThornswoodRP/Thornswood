'use strict';
// Compile the actual launcher writer and retention reader, with only their
// destination paths replaced. No launcher window, install or remote service.
const path=require('node:path'),lc=require('../../tests/launcher-csc');
const app=path.join(__dirname,'../app');
const code=String.raw`
using System;
using System.IO;
using System.Globalization;
using System.Text.RegularExpressions;
namespace Thornswood {
 static class Paths { public static string LogFile; }
 static class Diag { public static string ReportDir; }
 public static class ClockCases {
  static int failed;
  static void Yes(string name,bool ok){Console.WriteLine((ok?"PASS ":"FAIL ")+name);if(!ok)failed++;}
  public static int Main(){
   string dir=Path.Combine(Path.GetTempPath(),"thornswood-4949-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
   try {
    Paths.LogFile=Path.Combine(dir,"launcher.log");Diag.ReportDir=Path.Combine(dir,"reports");
    CultureInfo.CurrentCulture=new CultureInfo("ar-SA");
    DateTime before=DateTime.UtcNow;LauncherLog.Line("clock check");DateTime after=DateTime.UtcNow;
    string line=File.ReadAllText(Paths.LogFile);DateTime when=DateTime.MinValue;
    bool parsed=line.Length>=20&&DateTime.TryParseExact(line.Substring(0,20),"yyyy-MM-dd'T'HH:mm:ss'Z'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out when);
    Yes("real launcher lines use invariant UTC at the instant of writing",parsed&&when>=before.AddSeconds(-1)&&when<=after&&line.EndsWith("  clock check"+Environment.NewLine));
    string normal=Paths.LogFile;Paths.LogFile=dir;LauncherLog.Line("refused clock check");Paths.LogFile=normal;
    Yes("refused-write diagnostics carry the same explicit UTC stamp",Regex.IsMatch(LauncherLog.Refused(),@"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z  launcher.log refused:"));
    DateTime now=new DateTime(2026,11,25,12,0,0,DateTimeKind.Utc),cut=now.AddDays(-LocalKeep.Days);
    string fresh=cut.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",CultureInfo.InvariantCulture)+"  boundary\n  trace\n";
    File.WriteAllText(normal,cut.AddSeconds(-1).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",CultureInfo.InvariantCulture)+"  old\n"+fresh);
    Yes("UTC retention cuts only older records and keeps the exact boundary with its trace",LocalKeep.PruneLog(normal,now.ToLocalTime())==1&&File.ReadAllText(normal)==fresh);
    string legacy=cut.ToLocalTime().AddMinutes(1).ToString("yyyy-MM-dd HH:mm:ss",CultureInfo.InvariantCulture)+"  legacy\n";
    File.WriteAllText(normal,cut.AddDays(-1).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",CultureInfo.InvariantCulture)+"  old\n"+legacy+fresh);
    Yes("mixed logs retain legacy local records and newer UTC records byte for byte",LocalKeep.PruneLog(normal,now.ToLocalTime())==1&&File.ReadAllText(normal)==legacy+fresh);
    File.WriteAllText(normal,cut.AddDays(-1).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",CultureInfo.InvariantCulture)+"  old\n");
    LocalKeep.Tidy(now.ToLocalTime());
    Yes("the retention diagnostic also uses the controlled UTC instant",File.ReadAllText(normal).StartsWith("2026-11-25T12:00:00Z  Kept to the last"));
   } finally {Directory.Delete(dir,true);}
   Console.WriteLine(failed+" failed");return failed==0?0:1;
  }
 }
}`;
const dll=lc.build({sources:[code],files:[path.join(app,'Swallow.cs'),path.join(app,'LocalKeep.cs')],exe:true});
const r=lc.run(dll);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status||0;
