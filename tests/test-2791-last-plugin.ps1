<#
  test-2791-last-plugin.ps1

      pwsh -NoProfile -File .\tests\test-2791-last-plugin.ps1

  #2791. Thornswood-Last.esp copies other authors' records out of the load
  order, so Thornswood hands on only its recipe (Patrick's A of 26 Oct 2026 on
  #3721), and the launcher makes the plugin on each machine from that
  machine's own plugins (launcher\app\LastPlugin.cs). It must come out byte
  for byte what scripts\mods\last_recipe.py's apply() makes.

  WHAT THIS HOLDS.
    1. On made-up game folders (tests\fixtures\2791\last-plugin-fixture.py
       writes them from the small plugins tests\last-recipe-cases.py builds,
       nothing of anybody's), the launcher's own code makes the plugin
       last_recipe.make() wrote the recipe for, byte for byte: a localised
       name read out of an archive, LZ4 packed, in name order after one that
       has no table and before one with another copy; the same table loose
       under Data\Strings, which wins; a compressed record; a subrecord over
       64 KiB.
    2. A plugin that is not the copy the recipe names, a missing plugin, no
       string table, and a loose table that is another copy all make nothing,
       and the reason names the file. Only the missing English table is taken
       for a game set to another language, for which Scan says to switch
       Skyrim to English (#4007, Patrick's A of 27 Oct 2026).
    3. IsCurrent and Expected: no plugin, or another one, is not current; the
       one the recipe makes is. Makes names Thornswood-Last.esp only where a
       recipe is.
    4. The committed recipe, game\data\last-plugin.recipe, reads in the
       launcher's code to the size and sha256 of the plugin
       game\data\last-plugin.json names, and to the sources it counts. No
       repository holds the plugin since #2791 step 3.
    5. It compiles at the build's C# version and at C# 5, which Windows
       PowerShell 5.1's Add-Type compiles for scripts\release\Go.ps1.
    6. By the source: the step kinds and the magic are last_recipe.py's;
       Play, Scan and Fix make it through MadeFromGame; Verify never fetches
       the made plugin from the server and counts it as ours in the order; the
       own folder keeps it as Thornswood's.

  Reads the repository; writes only its own folder under the scratch folder.
  Needs Python (the fixture is plain Python) and the compiler the build runs.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
. (Join-Path $PSScriptRoot 'Framework-Csc.ps1')   # C# 5 against the .NET Framework, as Windows PowerShell 5.1's Add-Type
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }
$App = Join-Path $Repo 'launcher\app'
$Fixture = Join-Path $Repo 'tests\fixtures\2791'

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
# Line ends as git checked them out: CRLF on a runner, LF in some worktrees.
function Src([string]$path) { [IO.File]::ReadAllText($path) -replace "`r`n", "`n" }

# ---- 6. by the source --------------------------------------------------------------
$last = Src (Join-Path $App 'LastPlugin.cs')
$py = Src (Join-Path $Repo 'scripts\mods\last_recipe.py')
Yes 'the step kinds are last_recipe.py''s (LIT 0, REC 1, CPY 2, STR 3)' (
    $py -match '(?m)^LIT, REC, CPY, STR = 0, 1, 2, 3$' -and $last -match 'const int Lit = 0, Rec = 1, Cpy = 2, Str = 3;')
Yes '  and so are the source kinds and the magic' (
    $py -match '(?m)^PLUGIN_SOURCE, TABLE_SOURCE = 0, 1$' -and $last -match 'const int PluginSource = 0, TableSource = 1;' -and
    $py -match "(?m)^MAGIC = b'TSLR\\x01'$" -and $last -match "Magic = \{ \(byte\)'T', \(byte\)'S', \(byte\)'L', \(byte\)'R', 1 \};")
Yes '  and the flag of a compressed record' ($py -match '(?m)^COMPRESSED = 0x00040000$' -and $last -match 'const uint Compressed = 0x00040000;')
$mfg = Src (Join-Path $App 'MadeFromGame.cs')
Yes 'MadeFromGame counts it out of date only when the game folder holds a recipe' ($mfg -match 'if \(LastPlugin\.HasRecipe\(Paths\.Game\) && !LastPlugin\.IsCurrent\(Paths\.Game\)\) l\.Add\(LastPlugin\.File\);')
Yes '  and makes it only when it is out of date' ($mfg -match 'if \(rels\.Contains\(LastPlugin\.File\)\) l\.Add\(MakeLast\(\)\);' -and $mfg -match 'foreach \(FromGameFile f in Make\(off\)\)')
$upkeep = Src (Join-Path $App 'Upkeep.cs')
Yes 'Scan says to switch Skyrim to English when an English table is missing (#4007, Patrick''s A)' ($upkeep -match 'english = f\.NotEnglish;' -and $upkeep -match 'english \? "Thornswood plays in English: in Steam, right click Skyrim Special Edition, Properties, Language' -and
    (Src (Join-Path $App 'MadeFromGame.cs')) -match 'catch \(LastPlugin\.CannotMake ex\) \{ f\.Problem = ex\.Message; f\.NotEnglish = ex\.NotEnglish; \}')
Yes 'Scan names it with the collection to put right in Vortex' ($upkeep -match 'MadeFromGame\.Make\(off\)' -and $upkeep -match 'last \? "Install the collection revision Thornswood pins in Vortex and press Deploy there')
$verify = Src (Join-Path $App 'Verify.cs')
Yes 'Verify''s Fix never fetches it, from the release or the server (#3386)' (
    $verify -match '!LastPlugin\.Makes\(Paths\.Game, i\.Plugin\) && FetchPlugin\(cfg, i, release, say\)' -and
    $verify -match '!m\.Served \|\| LastPlugin\.Makes\(Paths\.Game, m\.filename\)\) continue;')
Yes '  and its byte check leaves one that is not made yet to MadeFromGame' ($verify -match 'if \(LastPlugin\.Makes\(Paths\.Game, m\.filename\)\)\s*\{\s*if \(!LastPlugin\.IsCurrent\(Paths\.Game\)\) continue;')
Yes '  and the order counts it as ours' ($verify -match 'if \(!ServedByServer\(cfg, p\) && !LastPlugin\.Makes\(Paths\.Game, p\)\) notOurs\.Add\(p\);')
$kinds = Src (Join-Path $App 'OwnGameKinds.cs')
Yes 'the own folder keeps it as Thornswood''s (MadeInGame)' ([regex]::Match($kinds, '(?s)static readonly string\[\] MadeInGame = \{(.*?)\};').Groups[1].Value -match 'LastPlugin\.File,')

# ---- the fixture -----------------------------------------------------------------
$python = $null
foreach ($n in @('python', 'python3', 'py')) {
    $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $python = $c.Source; break }
}
Yes 'Python is on this machine, to write the made-up game folders' ([bool]$python)
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if ($script:fail) { Done }

$work = Join-Path $Scratch ('thornswood-2791-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $games = Join-Path $work 'games'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $said = & $python -I (Join-Path $Fixture 'last-plugin-fixture.py') $games 2>&1; $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    $cases = @('made', 'loose', 'long', 'other', 'no-plugin', 'no-table', 'later')
    Yes ('the fixture writes the made-up game folders (' + ($cases -join ', ') + ')') (
        $rc -eq 0 -and @($cases | Where-Object { -not (Test-Path -LiteralPath (Join-Path $games "$_\Data\Thornswood-Last.recipe")) }).Count -eq 0)
    if ($rc -ne 0) { $said | ForEach-Object { Write-Host "      $_" }; Done }

    # ---- 1 to 4: the launcher's own code, with a driver --------------------------
    $driver = @'
using System;
using System.IO;
using System.Security.Cryptography;

namespace Thornswood
{
    static class LastPluginTest
    {
        static void Yes(string what, bool ok) { Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what); }

        static bool Same(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        static string Hex(byte[] b)
        {
            var sb = new System.Text.StringBuilder();
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        static int Main(string[] args)
        {
            string games = args[0];
            foreach (string name in new[] { "made", "loose", "long" })
            {
                string g = Path.Combine(games, name);
                byte[] want = File.ReadAllBytes(Path.Combine(g, "want.esp"));
                byte[] made = null;
                string why = null;
                try { made = LastPlugin.Make(g); }
                catch (LastPlugin.CannotMake ex) { why = ex.Message; }
                Yes(name + ": the launcher makes the plugin last_recipe.make() wrote the recipe for, byte for byte" + (why != null ? ": " + why : ""), Same(made, want));
            }
            foreach (string name in new[] { "other", "no-plugin", "no-table", "later" })
            {
                string g = Path.Combine(games, name);
                string want = File.ReadAllText(Path.Combine(g, "want.txt"));
                string why = null;
                byte[] made = null;
                bool english = false;
                try { made = LastPlugin.Make(g); }
                catch (LastPlugin.CannotMake ex) { why = ex.Message; english = ex.NotEnglish; }
                Yes(name + ": nothing is made, and the reason names the file: " + (why ?? "(it was made)"),
                    made == null && why != null && why.IndexOf(want, StringComparison.Ordinal) >= 0);
                // #4007: only a missing English table is a game in another language.
                Yes("  " + (name == "no-table" ? "and it is the game's language (#4007)" : "and it is not taken for the game's language"), english == (name == "no-table"));
            }

            string m = Path.Combine(games, "made");
            string dest = Path.Combine(Path.Combine(m, "Data"), LastPlugin.Name);
            byte[] wantMade = File.ReadAllBytes(Path.Combine(m, "want.esp"));
            string sha;
            using (var h = SHA256.Create()) sha = Hex(h.ComputeHash(wantMade));
            Yes("Expected is the sha256 of the plugin the recipe makes", LastPlugin.Expected(m) == sha);
            Yes("with no plugin in Data it is not current", !LastPlugin.IsCurrent(m));
            var other = (byte[])wantMade.Clone();
            other[other.Length - 1] ^= 1;
            File.WriteAllBytes(dest, other);
            Yes("another plugin there is not current", !LastPlugin.IsCurrent(m));
            File.WriteAllBytes(dest, wantMade);
            Yes("the plugin the recipe makes is", LastPlugin.IsCurrent(m));
            Yes("Makes names Thornswood-Last.esp where a recipe is, in any case", LastPlugin.Makes(m, "thornswood-last.ESP"));
            Yes("  and no other plugin", !LastPlugin.Makes(m, "Thornswood-Content.esp"));
            string none = Path.Combine(games, "none");
            Directory.CreateDirectory(Path.Combine(none, "Data"));
            Yes("  and nothing where no recipe is", !LastPlugin.Makes(none, LastPlugin.Name) && !LastPlugin.HasRecipe(none) && LastPlugin.Expected(none) == null);

            if (args.Length > 3)
            {
                LastPlugin.Header head = LastPlugin.ReadHeader(File.ReadAllBytes(args[1]));
                long size = long.Parse(args[2]);
                string psha = args[3];
                Yes("the committed recipe names the size and sha256 last-plugin.json names (" + size + " bytes, " + psha.Substring(0, 12) + "...)",
                    head.Size == size && Hex(head.Sha256) == psha);
                Console.WriteLine("sources: " + head.Sources.Count);
            }
            return 0;
        }
    }
}
'@
    $sources = @((Join-Path $App 'LastPlugin.cs'), (Join-Path $App 'FromGameArchive.cs'))
    # At the build's C# version with the .NET SDK, the program that runs below;
    # and at C# 5 against the .NET Framework, as Windows PowerShell 5.1's
    # Add-Type compiles them for Go.ps1, built only.
    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Main 'Thornswood.LastPluginTest' -Source $driver -File $sources }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes "LastPlugin.cs, FromGameArchive.cs and the driver compile at C# $LauncherLangVersion, as the build does" ($null -ne $exe)
    $five = $null
    try { $five = Build-FrameworkCode -Exe -Main 'Thornswood.LastPluginTest' -Source $driver -File $sources }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes 'LastPlugin.cs, FromGameArchive.cs and the driver compile at C# 5, as Windows PowerShell 5.1''s Add-Type compiles' ($null -ne $five)
    if (-not $exe) { Done }

    $recipe = Join-Path $Repo 'game\data\last-plugin.recipe'
    $manifestPath = Join-Path $Repo 'game\data\last-plugin.json'
    $runArgs = @($games)
    if ((Test-Path -LiteralPath $recipe) -and (Test-Path -LiteralPath $manifestPath)) {
        $named = (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).plugin
        $runArgs += $recipe, ([string][int64]$named.size), ([string]$named.sha256).ToLowerInvariant()
    }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = Invoke-LauncherExe $exe @runArgs 2>&1
    $ErrorActionPreference = $old
    $sourcesSeen = -1
    foreach ($l in @($out)) {
        $l = "$l"
        if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
        elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
        elseif ($l -match '^sources: (\d+)$') { $sourcesSeen = [int]$Matches[1] }
        else { Write-Host "      $l" }
    }
    if ($runArgs.Count -gt 1) {
        $manifest = Get-Content -Raw -LiteralPath (Join-Path $Repo 'game\data\last-plugin.json') | ConvertFrom-Json
        Yes ("  and the sources game\data\last-plugin.json counts ({0})" -f $manifest.recipe.sources) ($sourcesSeen -eq [int]$manifest.recipe.sources)
    } else {
        Write-Host 'SKIP  4, no committed recipe yet: the next build of Thornswood-Last.esp writes it'
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
