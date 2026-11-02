<#
  test-2586-atomic-records.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2586-atomic-records.ps1

  Issue #2586. The launcher wrote its records about Thornswood's own folder
  (Profile\OwnGame\files.txt, about 3 MB and the one record of which files
  are Vortex's, and left-out.txt, vortex.txt, made.txt and the rest) straight
  over the old file. A launcher killed during that write, or a disk that
  filled, left the record cut short, and the next refresh or Ship read a
  partial list: Publish-Update refuses an empty files.txt but not a cut one.
  Build-Generated's generated.txt was deleted and then the new one moved in,
  which left a moment with no record at all.

  NOT File.Replace EITHER. ReplaceFile moves the old record aside to a name
  of its own (files.txt~RF....TMP) and then moves the new one in, so a
  process killed between the two leaves no record. Measured 16 Oct on One: a
  writer swapping a 3 MB record in a loop, killed 150 times, left files.txt
  missing 4 times through File.Replace, with the ~RF files beside it, and
  whole all 150 times through MoveFileEx with MOVEFILE_REPLACE_EXISTING,
  which renames over the record in one call. That is what the records use.

  WHAT IT HOLDS THEM TO.
    1. Every record OwnGame writes goes through OwnGame.WriteRecord: no
       File.WriteAllLines or File.WriteAllText is left in OwnGame*.cs, and
       each record named below is written by WriteRecord.
    2. WriteRecord, lifted out of OwnGame.cs and compiled with the .NET SDK
       the launcher builds with (everywhere): it writes a new record, replaces
       an old one, writes the same bytes File.WriteAllLines did, takes over a
       .new left by a write that was cut short, and leaves no .new behind.
       It renames through kernel32's MoveFileEx, so 2 and 3 run on Windows
       only and say SKIP elsewhere.
    3. Killed while it writes: a child process writes a 3 MB record over and
       over, A then B, and is killed with TerminateProcess at 50 moments. The
       record is A or B whole every time. The same child writing in place,
       the way OwnGame wrote before, is killed 20 times the same way and
       leaves the record cut short at least once, so the test can see the
       fault it guards against.
    4. The generated record (GeneratedRecord.Write in launcher\app\Generated.cs,
       which the launcher and Write-GeneratedRecord in scripts\mods\Generated.ps1
       both use since #3715) renames over the record with the same MoveFileEx
       (GeneratedOs.Replace in GeneratedBuild.cs), never File.Replace on
       Windows and never a delete first, and writes and rewrites a record that
       reads back.

  Nothing outside its own scratch folder is read or written, besides the
  repository's own sources.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$App = Join-Path $Repo 'launcher\app'
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

# ---- 1: every record goes through WriteRecord ---------------------------------
$sources = @(Get-ChildItem -LiteralPath $App -Filter 'OwnGame*.cs' -File)
Yes ('the OwnGame sources are there ({0})' -f $sources.Count) ($sources.Count -ge 4)
$all = ($sources | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
$inPlace = @()
foreach ($s in $sources) {
    $n = 0
    foreach ($l in [IO.File]::ReadAllLines($s.FullName)) {
        $n++
        if ($l -match 'File\.(WriteAllLines|WriteAllText|WriteAllBytes|AppendAllLines)\(') { $inPlace += ($s.Name + ':' + $n) }
    }
}
Yes ('no OwnGame source writes a file in place' + $(if ($inPlace) { ' (' + ($inPlace -join ', ') + ')' })) ($inPlace.Count -eq 0)
$records = [ordered]@{
    'files.txt' = 'FilesList'; 'left-out.txt' = 'LeftOutFile'; 'made.txt' = 'MadeFile'; 'vortex.txt' = 'VortexSeenFile'
    'shared.txt' = 'SharesFile'; 'differs.txt' = 'DiffersFile'; 'changed.txt' = 'ChangedFile'
    'steam-copy-cleaned.txt' = 'CleanedFile'; 'installed-kept.txt' = 'InstalledKept'; 'declined.txt' = 'DeclinedFile'
}
foreach ($k in $records.Keys) {
    $prop = $records[$k]
    $named = $all -match ('static string ' + $prop + ' \{ get \{ return Path\.Combine\(Dir, "' + [regex]::Escape($k) + '"\); \} \}')
    $written = ([regex]::Matches($all, 'WriteRecord\(' + $prop + ',')).Count
    Yes ("$k ($prop) is written by WriteRecord ($written place(s))") ($named -and $written -gt 0)
}
Yes 'installed-into-game.txt, which OwnGame rewrites when the Steam copy is cleaned, is too' ($all -match 'WriteRecord\(InstalledList,')

# ---- 2 and 3: WriteRecord itself, compiled ---------------------------------------
$og = [IO.File]::ReadAllText((Join-Path $App 'OwnGame.cs')) -replace "`r`n", "`n"
$m = [regex]::Match($og, '(?s)\n(        (?:internal )?static void WriteRecord\(string path, IEnumerable<string> lines\)\n        \{\n.*?\n        \}\n.*?private static partial bool MoveFileEx\([^)]*\);\n)')
Yes 'OwnGame.WriteRecord is in OwnGame.cs, with the MoveFileEx it calls' $m.Success
Yes '...and renames a file beside the record over it in one call, replacing it' ($m.Success -and $m.Groups[1].Value -match 'MoveFileEx\(next, path, MoveReplaceExisting \| MoveWriteThrough\)' -and
    $m.Groups[1].Value -match 'const int MoveReplaceExisting = 0x1;' -and $m.Groups[1].Value -match 'path \+ "\.new"')
Yes '...never File.Replace, which leaves no record when it is stopped half way' ($m.Success -and $m.Groups[1].Value -notmatch 'File\.Replace\(')
Yes '...flushed to the disk before it takes the record''s place' ($m.Success -and $m.Groups[1].Value -match 'fs\.Flush\(true\)')
if (-not $m.Success) { Done }

$work = Join-Path $Scratch ('thornswood-2586-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    static partial class AtomicRecordTest
    {
__WRITERECORD__
        // A record the size of a real files.txt: about 40,000 lines.
        static List<string> Lines(string mark, int count)
        {
            var l = new List<string>();
            for (int i = 0; i < count; i++)
                l.Add("L|V|" + (1000 + i) + "|638650000000000000|Data\\meshes\\" + mark + "\\thornswood\\some mod\\file" + i.ToString("00000") + ".nif");
            return l;
        }

        static int Main(string[] args)
        {
            string mode = args[0], path = args[1];
            if (mode == "write") { WriteRecord(path, Lines(args[2], int.Parse(args[3]))); return 0; }
            if (mode == "plain") { File.WriteAllLines(path, Lines(args[2], int.Parse(args[3])).ToArray()); return 0; }
            // Over and over until killed: A then B. "loop" through WriteRecord,
            // "inplace" straight over the file, the way OwnGame wrote before.
            List<string> a = Lines("a", 40000), b = Lines("b", 38000);
            bool atomic = mode == "loop";
            Console.WriteLine("ready");
            Console.Out.Flush();
            for (int n = 0; ; n++)
            {
                List<string> l = n % 2 == 0 ? a : b;
                if (atomic) WriteRecord(path, l); else File.WriteAllLines(path, l.ToArray());
            }
        }
    }
}
'@
    $driver = $driver.Replace('__WRITERECORD__', $m.Groups[1].Value.TrimEnd())
    $dll = $null
    try { $dll = Build-LauncherCode -Source $driver -Exe }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes "WriteRecord compiles with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $dll)
    if (-not $dll) { Done }

    if (-not $OnWindows) {
        Write-Host 'SKIP  2 and 3, run: WriteRecord renames through kernel32''s MoveFileEx, which only Windows has'
    } else {
    function Run([string[]]$a) { $null = Invoke-LauncherExe $dll @a; return $LASTEXITCODE }
    function Sha([string]$p) { if (-not (Test-Path -LiteralPath $p)) { return '' }; return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }

    # 2: what it writes.
    $rec = Join-Path $work 'OwnGame\files.txt'
    $plainA = Join-Path $work 'plain-a.txt'
    $plainB = Join-Path $work 'plain-b.txt'
    $null = Run @('plain', $plainA, 'a', '40000')
    $null = Run @('plain', $plainB, 'b', '38000')
    $code = Run @('write', $rec, 'a', '40000')
    Yes 'no record yet, and no folder: WriteRecord makes both' ($code -eq 0 -and (Sha $rec) -eq (Sha $plainA))
    Yes '...the same bytes File.WriteAllLines wrote, so every reader reads it as before' ((Sha $rec) -eq (Sha $plainA) -and (Get-Item -LiteralPath $rec).Length -gt 3000000)
    $code = Run @('write', $rec, 'b', '38000')
    Yes 'an old record is replaced whole by the new one' ($code -eq 0 -and (Sha $rec) -eq (Sha $plainB))
    Yes '...and nothing is left beside it' (-not (Test-Path -LiteralPath ($rec + '.new')))
    [IO.File]::WriteAllText(($rec + '.new'), 'L|V|1|2|Data\half')
    $code = Run @('write', $rec, 'a', '40000')
    Yes 'a .new left by a write that was cut short is written over, and the record is the new one' ($code -eq 0 -and (Sha $rec) -eq (Sha $plainA) -and -not (Test-Path -LiteralPath ($rec + '.new')))

    # 3: killed while it writes.
    function KillTest([string]$mode, [string]$path, [int]$kills) {
        $null = Run @('write', $path, 'a', '40000')
        $whole = 0; $cut = @()
        $rand = New-Object Random 2586
        for ($i = 0; $i -lt $kills; $i++) {
            $psi = New-Object Diagnostics.ProcessStartInfo($LauncherDotnet, ('"{0}" "{1}" "{2}"' -f $dll, $mode, $path))
            $psi.UseShellExecute = $false
            $psi.RedirectStandardOutput = $true
            $p = [Diagnostics.Process]::Start($psi)
            $null = $p.StandardOutput.ReadLine()   # "ready": the records are built, the writing has begun
            Start-Sleep -Milliseconds ($rand.Next(15, 160))
            $p.Kill()
            $p.WaitForExit()
            $p.Dispose()
            $h = Sha $path
            if ($h -eq (Sha $plainA) -or $h -eq (Sha $plainB)) { $whole++ } else { $cut += $(if (Test-Path -LiteralPath $path) { '{0} bytes' -f (Get-Item -LiteralPath $path).Length } else { 'missing' }) }
        }
        return [pscustomobject]@{ Whole = $whole; Cut = $cut }
    }
    $r = KillTest 'loop' (Join-Path $work 'killed\files.txt') 50
    Yes ('killed 50 times while WriteRecord writes 3 MB records: the record is A or B whole every time ({0} of 50{1})' -f $r.Whole, $(if ($r.Cut) { '; not whole: ' + ($r.Cut -join ', ') })) ($r.Whole -eq 50)
    $code = Run @('write', (Join-Path $work 'killed\files.txt'), 'b', '38000')
    Yes '...and the next write after the last kill replaces it and leaves no .new' ($code -eq 0 -and (Sha (Join-Path $work 'killed\files.txt')) -eq (Sha $plainB) -and -not (Test-Path -LiteralPath (Join-Path $work 'killed\files.txt.new')))
    $r = KillTest 'inplace' (Join-Path $work 'inplace\files.txt') 20
    Yes ('the same kills of a writer that writes in place, as OwnGame did, leave the record cut short ({0} of 20 cut: {1})' -f $r.Cut.Count, (($r.Cut | Select-Object -First 3) -join ', ')) ($r.Cut.Count -gt 0)
    }
}
finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { Write-Host "NOTE  $work could not be removed: $($_.Exception.Message)" }
}

# ---- 4: the generated record --------------------------------------------------
# As git checks it out: CRLF on Windows, LF here.
$gen = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Generated.cs')) -replace "`r`n", "`n"
$fn = [regex]::Match($gen, '(?s)public static void Write\(string path, string game, GeneratedInputs inputs, List<GeneratedFile> files\)\s*\{.*?\n        \}\n')
Yes 'GeneratedRecord.Write is in Generated.cs' $fn.Success
Yes '...writes the new record beside the old and renames it over with GeneratedOs.Replace' ($fn.Success -and $fn.Value -match 'string tmp = path \+ "\.new";' -and
    $fn.Value -match 'GeneratedOs\.Replace\(tmp, path\);')
Yes '...never File.Replace, and never a delete first' ($fn.Success -and $fn.Value -notmatch 'File\.Replace\(' -and $fn.Value -notmatch 'File\.Delete\(')
$os = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\GeneratedBuild.cs')) -replace "`r`n", "`n"
$rp = [regex]::Match($os, '(?s)public static void Replace\(string from, string to\)\s*\{.*?\n        \}\n')
$win = ''
if ($rp.Success) { $at = $rp.Value.IndexOf('return;'); if ($at -gt 0) { $win = $rp.Value.Substring($at) } }
Yes 'GeneratedOs.Replace renames with one MoveFileEx, replacing it' ($rp.Success -and $win -match 'MoveFileEx\(from, to, MoveReplaceExisting \| MoveWriteThrough\)' -and
    $os -match 'const int MoveReplaceExisting = 0x1;' -and $os -match 'const int MoveWriteThrough = 0x8;')
Yes '...and on Windows never File.Replace and never a delete first' ($win.Length -gt 0 -and $win -notmatch 'File\.Replace\(' -and $win -notmatch 'File\.Delete\(')
. (Join-Path $Repo 'scripts\mods\Generated.ps1')
$gw = Join-Path $Scratch ('thornswood-2586-gen-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $path = Join-Path $gw 'Profile\OwnGame\generated.txt'
    $inputs = [pscustomobject]@{ Parts = [ordered]@{ list = ('a' * 64) }; Sha = ('b' * 64) }
    Write-GeneratedRecord $path 'C:\Game' $inputs @([pscustomobject]@{ Sha = ('c' * 64); Rel = 'Data\meshes\one.nif' })
    $first = Read-GeneratedRecord $path
    Write-GeneratedRecord $path 'C:\Game' $inputs @([pscustomobject]@{ Sha = ('d' * 64); Rel = 'Data\meshes\two.nif' })
    $second = Read-GeneratedRecord $path
    Yes 'a new generated record is written and reads back' ($null -ne $first -and $first.Game -eq 'C:\Game' -and
        $first.Files.Count -eq 1 -and $first.Files[0].Rel -eq 'Data\meshes\one.nif')
    Yes '...and a second write replaces it whole, with no .new left' ($null -ne $second -and $second.Files.Count -eq 1 -and
        $second.Files[0].Rel -eq 'Data\meshes\two.nif' -and -not (Test-Path -LiteralPath ($path + '.new')))
}
finally {
    Remove-Item -LiteralPath $gw -Recurse -Force -ErrorAction SilentlyContinue
}

Done
