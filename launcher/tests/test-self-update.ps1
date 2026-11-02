<#
  test-self-update.ps1

      pwsh -NoProfile -File .\tests\test-self-update.ps1
      pwsh -NoProfile -File .\tests\test-self-update.ps1 -Signed <a signed Thornswood.exe>

  The launcher's own update is applied only once every file in it was
  checked, and a refusal applies nothing.

  WHY THIS EXISTS. On the To Do List as "The launcher's self update destroys
  the old exe and has no way back", and #912, the signer check that read a
  name anybody can put on a certificate. Until #4825 this harness drove the
  swap script in launcher\app\SelfSwap.cs. Velopack replaced it: it keeps the
  version before in its packages folder and puts a new one in from a process
  of its own (launcher\app\VeloUpdate.cs), so the way back is Velopack's and
  is not driven here. What stays ours, and is proved here, is what is checked
  before Velopack is asked to apply anything.

  WHAT IT DOES. Builds the whole launcher the way the project builds
  (tests\Launcher-Csc.ps1) with a driver beside it, and runs the driver:
    - VeloPackage.Refusal, on packages it makes: a game file with other
      bytes, another size, one the signed list does not name, one missing;
      a file beside them that differs from setup-files.<channel>.json, or is
      missing; a file nobody listed; a name that climbs out of its folder; a
      setup list that names a program; and a package with no program. Each
      is refused, with the reason in words.
    - On Windows, an unsigned launcher and an unsigned Update.exe in a
      package whose every other file matches are refused by
      Signature.Refusal, and the copy taken out to check leaves nothing in
      the temp folder. With a signed launcher (-Signed, by default the dev
      install's), that package passes, and with one byte of the launcher
      changed it is refused. Off Windows these say SKIP: Signature.Refusal
      asks WinVerifyTrust.
    - Updater.ApplyLauncher refuses an update FetchLauncher did not pass,
      and no update at all, and nothing then waits for the launcher to close;
      the same call on an update marked checked is held for the close, so the
      refusals were for that alone. Velo.ExitApply is never called.
  FetchLauncher itself needs Velopack's download and the release's signed
  record from GitHub, so what it does in what order is read from its source:
  the package check, then the Update.exe check, then the mark that it passed,
  and a refusal deletes the package and replaces nothing.

  Writes only under its own temp folder and out\harness (the build). Nothing
  touches the network.
#>
[CmdletBinding()]
param([string]$Signed = '')

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK and settings, and $OnWindows
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$App = Join-Path (Join-Path $Repo 'launcher') 'app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$($script:pass) passed, $($script:fail) failed"
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- FetchLauncher and ApplyLauncher, from their source -------------------------
Write-Host 'what FetchLauncher checks, and in what order (launcher\app\VeloUpdate.cs)'
$velo = [IO.File]::ReadAllText((Join-Path $App 'VeloUpdate.cs')).Replace("`r`n", "`n")
$fetchAt = $velo.IndexOf('public static void FetchLauncher(LauncherUpdate u, Action<string> log)')
$applyAt = $velo.IndexOf('public static void ApplyLauncher(LauncherUpdate u)')
$fetch = if ($fetchAt -ge 0 -and $applyAt -gt $fetchAt) { $velo.Substring($fetchAt, $applyAt - $fetchAt) } else { '' }
Yes 'FetchLauncher is there, before ApplyLauncher' ($fetch.Length -gt 0)
$pkgAt = $fetch.IndexOf('VeloPackage.Refusal(pkg, list, setup, ExpectedSigner,')
$exeAt = $fetch.IndexOf('Signature.Refusal(updateExe, ExpectedSigner, out exeSaid)')
$markAt = $fetch.IndexOf('u.Checked = true;')
$catchAt = $fetch.IndexOf('catch (Exception ex)')
Yes '  every file in the package is checked, then the Update.exe that applies it, then it is marked as passed' (
    $pkgAt -gt 0 -and $exeAt -gt $pkgAt -and $markAt -gt $exeAt)
Yes '  either refusal throws inside the try, before anything is kept on the update' (
    $fetch -match 'if \(why\.Length > 0\) throw new Exception\("The update package " \+ why\);' -and
    $fetch -match 'if \(exeWhy\.Length > 0\) throw new Exception\(' -and $catchAt -gt $exeAt -and $fetch.IndexOf('u.Package = pkg;') -lt $catchAt)
Yes '  a refusal deletes the package and says nothing was replaced, and the mark comes after the catch' (
    $fetch -match '(?s)catch \(Exception ex\)\s*\{\s*try \{ File\.Delete\(pkg\); \}' -and $fetch.Contains('Nothing has been replaced and the one you are running is untouched.') -and $markAt -gt $catchAt)
Yes 'ApplyLauncher stages nothing unless FetchLauncher marked it' (
    $velo -match 'if \(u == null \|\| !u\.Checked\) throw new Exception\("The launcher update was not downloaded and checked, so it is not applied\."\);\s*Velo\.ApplyOnExit\(u\.Manager, u\.Info\.TargetFullRelease\);')
Yes 'Velopack''s own checksum step also holds each package to the signed record before it keeps it' (
    $velo -match '(?s)protected override async Task VerifyPackageChecksumAsync\(VelopackAsset release, string filePathOverride = null\)\s*\{\s*await base\.VerifyPackageChecksumAsync\(release, filePathOverride\)\.ConfigureAwait\(false\);\s*string why = VeloRecord\.Vouches\(release\);\s*if \(why\.Length > 0\) throw')
Yes 'the swap script and its exe kept beside the launcher are gone (SelfSwap.cs)' (-not (Test-Path -LiteralPath (Join-Path $App 'SelfSwap.cs')))

# ---- the driver -------------------------------------------------------------------
Write-Host ''
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Thornswood
{
    // Drives VeloPackage.Refusal on packages made here and Updater.ApplyLauncher
    // on updates made here. args: <scratch folder> <windows: 1 or 0> [<signed exe>]
    static class SelfUpdateTest
    {
        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) pass++; else fail++;
            Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what);
        }

        static string Sha(byte[] b) { return VeloRecord.Sha256(b); }

        static VeloRecord.GameFile File1(string path, byte[] b)
        {
            var f = new VeloRecord.GameFile();
            f.Path = path; f.Size = b.Length; f.Sha256 = Sha(b);
            return f;
        }

        static VeloRecord.GameList List(string channel, params VeloRecord.GameFile[] files)
        {
            var l = new VeloRecord.GameList();
            l.Schema = 1; l.Channel = channel; l.Files = files;
            return l;
        }

        static string dir;
        static int made;

        // A package with these entries, in this order.
        static string Pack(params KeyValuePair<string, byte[]>[] entries)
        {
            string p = Path.Combine(dir, "pkg-" + (++made) + ".nupkg");
            using (ZipArchive z = ZipFile.Open(p, ZipArchiveMode.Create))
            {
                foreach (var e in entries)
                {
                    ZipArchiveEntry en = z.CreateEntry(e.Key);
                    using (Stream s = en.Open()) s.Write(e.Value, 0, e.Value.Length);
                }
            }
            return p;
        }

        static KeyValuePair<string, byte[]> E(string name, byte[] b) { return new KeyValuePair<string, byte[]>(name, b); }

        static string Ask(string pkg, VeloRecord.GameList game, VeloRecord.GameList setup, out string said)
        {
            return VeloPackage.Refusal(pkg, game, setup, Updater.ExpectedSigner, null, out said);
        }

        static int Main(string[] args)
        {
            dir = args[0];
            bool windows = args.Length > 1 && args[1] == "1";
            string signed = args.Length > 2 ? args[2] : "";
            Directory.CreateDirectory(dir);

            byte[] esp = Encoding.ASCII.GetBytes("TES4 a plugin the release lists");
            byte[] cfg = Encoding.ASCII.GetBytes("{ \"channel\": \"dev\" }");
            byte[] note = Encoding.ASCII.GetBytes("SOURCE CODE: https://github.com/EvilPatrick06/Thornswood");
            var game = List("dev", File1("Data/Thornswood.esp", esp));
            var setup = List("dev", File1("config.json", cfg), File1("SOURCE CODE.txt", note));
            var nupkgBits = E("Thornswood.nuspec", Encoding.ASCII.GetBytes("<package/>"));
            var gameEntry = E("lib/app/Game/Data/Thornswood.esp", esp);
            var cfgEntry = E("lib/app/config.json", cfg);
            var noteEntry = E("lib/app/SOURCE%20CODE.txt", note);
            var ver = E("lib/app/sq.version", Encoding.ASCII.GetBytes("<version/>"));
            string said, why;

            Console.WriteLine("every file in the package is held to the signed release's lists");

            byte[] changed = (byte[])esp.Clone(); changed[0] ^= 1;
            why = Ask(Pack(nupkgBits, E("lib/app/Game/Data/Thornswood.esp", changed), cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a game file of the listed size with other bytes is refused by its checksum: " + why, why.StartsWith("carries Data/Thornswood.esp with the checksum ", StringComparison.Ordinal) && said.Length == 0);

            why = Ask(Pack(nupkgBits, E("lib/app/Game/Data/Thornswood.esp", Encoding.ASCII.GetBytes("TES4 longer than the list says it is")), cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a game file of another size is refused by its size: " + why, why.StartsWith("carries Data/Thornswood.esp at ", StringComparison.Ordinal));

            why = Ask(Pack(nupkgBits, gameEntry, E("lib/app/Game/Data/Extra.esp", esp), cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a game file the signed list does not name is refused: " + why, why.Contains("Data/Extra.esp, which the signed release's game-files.json does not list"));

            why = Ask(Pack(nupkgBits, cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a package without a game file the list names is refused: " + why, why.StartsWith("lacks 1 of the game files the signed release lists, Data/Thornswood.esp", StringComparison.Ordinal));

            byte[] cfgOther = Encoding.ASCII.GetBytes("{ \"channel\": \"mai\" }");
            why = Ask(Pack(nupkgBits, gameEntry, E("lib/app/config.json", cfgOther), noteEntry, ver), game, setup, out said);
            Yes("a file beside the game files that differs from setup-files.dev.json is refused: " + why, why.StartsWith("carries config.json with the checksum ", StringComparison.Ordinal));

            why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, ver), game, setup, out said);
            Yes("a package without a file setup-files.dev.json names is refused: " + why, why.StartsWith("lacks 1 of the files beside the game files", StringComparison.Ordinal) && why.Contains("SOURCE CODE.txt"));

            why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver, E("lib/app/readme.txt", note)), game, setup, out said);
            Yes("a file nobody listed that is not a program is refused: " + why, why.Contains("lib/app/readme.txt, which is neither a signed program nor a file the signed release lists"));

            why = Ask(Pack(nupkgBits, E("lib/app/Game/../Thornswood.esp", esp), cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a name that climbs out of its folder is refused: " + why, why.Contains("a path that climbs out of its folder"));

            why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver), game, List("dev", File1("config.json", cfg), File1("Update.exe", cfg)), out said);
            Yes("a setup-files list that names a program is refused, since every program is held to its signature: " + why, why.Contains("names Update.exe, which is a game file or a program"));

            why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver), game, setup, out said);
            Yes("a package whose files all match but that holds no program is refused, as having no launcher in it: " + why, why == "carries no program at all, so there is no launcher in it." && said.Length == 0);

            Console.WriteLine("");
            Console.WriteLine("every program in the package is held to Thornswood's signature");
            if (!windows)
            {
                Console.WriteLine("SKIP  the programs: Signature.Refusal asks Windows (WinVerifyTrust), which only Windows has");
            }
            else
            {
                string tmp = Path.GetTempPath();
                int before = Directory.GetFiles(tmp, "thornswood-velo-*").Length;
                byte[] unsigned = File.ReadAllBytes(typeof(SelfUpdateTest).Assembly.Location);
                why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver, E("lib/app/Thornswood.exe", unsigned)), game, setup, out said);
                Yes("an unsigned launcher in a package whose files all match is refused: " + why, why.StartsWith("carries the program lib/app/Thornswood.exe, which ", StringComparison.Ordinal) && said.Length == 0);
                why = Ask(Pack(nupkgBits, E("lib/app/Update.exe", unsigned), gameEntry, cfgEntry, noteEntry, ver), game, setup, out said);
                Yes("  and so is an unsigned Update.exe, the program that would apply it: " + why, why.StartsWith("carries the program lib/app/Update.exe, which ", StringComparison.Ordinal));
                Yes("  and the copy taken out to check it is not left in the temp folder", Directory.GetFiles(tmp, "thornswood-velo-*").Length == before);

                if (signed.Length == 0 || !File.Exists(signed))
                {
                    Console.WriteLine("SKIP  a package with a launcher signed by Thornswood: no signed launcher on this machine (" + signed + ")");
                }
                else
                {
                    byte[] real = File.ReadAllBytes(signed);
                    why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver, E("lib/app/Thornswood.exe", real)), game, setup, out said);
                    Yes("a package whose files all match, with the signed launcher, passes: " + (why.Length > 0 ? why : said), why.Length == 0 && said.StartsWith("Every file in the update package checked: 1 game files and 2 files beside them", StringComparison.Ordinal));
                    byte[] bent = (byte[])real.Clone(); bent[bent.Length / 2] ^= 1;
                    why = Ask(Pack(nupkgBits, gameEntry, cfgEntry, noteEntry, ver, E("lib/app/Thornswood.exe", bent)), game, setup, out said);
                    Yes("  the same launcher with one byte changed is refused: " + why, why.StartsWith("carries the program lib/app/Thornswood.exe, which ", StringComparison.Ordinal));
                }
            }

            Console.WriteLine("");
            Console.WriteLine("nothing is applied that was not downloaded and checked");
            Yes("nothing is waiting to go in at the start", !Velo.Staged);
            string threw = "";
            try { Updater.ApplyLauncher(new Updater.LauncherUpdate()); } catch (Exception ex) { threw = ex.Message; }
            Yes("an update FetchLauncher did not pass is not applied: " + threw, threw == "The launcher update was not downloaded and checked, so it is not applied.");
            Yes("  and nothing waits for the launcher to close", !Velo.Staged);
            threw = "";
            try { Updater.ApplyLauncher(null); } catch (Exception ex) { threw = ex.Message; }
            Yes("no update at all is not applied either: " + threw, threw == "The launcher update was not downloaded and checked, so it is not applied." && !Velo.Staged);
            // The control: the same call on an update FetchLauncher marked as
            // checked is held for the exit, so the two above were refused for
            // not being checked and for nothing else. ExitApply is never called.
            var ok = new Updater.LauncherUpdate();
            ok.Checked = true;
            ok.Info = new Velopack.UpdateInfo(new Velopack.VelopackAsset(), false);
            threw = "";
            try { Updater.ApplyLauncher(ok); } catch (Exception ex) { threw = ex.Message; }
            Yes("an update FetchLauncher passed is held until the launcher closes" + (threw.Length > 0 ? ": " + threw : ""), threw.Length == 0 && Velo.Staged);

            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }
    }
}
'@

$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.SelfUpdateTest' }
catch { ($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll) { Done }

# The signed launcher for the passing package: the dev install's, as
# tests\test-signer-check.ps1 takes it, unless one is given.
if (-not $Signed -and $OnWindows) {
    try { $Signed = Join-Path ([string](& (Join-Path $Repo 'scripts\release\Where.ps1') InstallDev)) 'Launcher\Thornswood.exe' }
    catch { $Signed = '' }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-self-update-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$scratchTemp = Join-Path $T 'tmp'
$null = New-Item -ItemType Directory -Force -Path $scratchTemp
# The driver's temp folder is its own, so what Refusal takes out to check
# can be counted. Path.GetTempPath reads TMP and TEMP on Windows and TMPDIR
# elsewhere.
$oldTmp = $env:TMP; $oldTemp = $env:TEMP; $oldTmpDir = $env:TMPDIR
try {
    $env:TMP = $scratchTemp; $env:TEMP = $scratchTemp; $env:TMPDIR = $scratchTemp
    $out = @(Invoke-LauncherExe $dll (Join-Path $T 'work') $(if ($OnWindows) { '1' } else { '0' }) $Signed 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
} finally { $env:TMP = $oldTmp; $env:TEMP = $oldTemp; $env:TMPDIR = $oldTmpDir }

Write-Host ''
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes ('the driver ran to the end and reported (exit ' + $code + ')') (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
