<#
  test-2827-from-game.ps1

      pwsh -NoProfile -File .\tests\test-2827-from-game.ps1

  #2827. Thornswood ships none of Data\Interface\startmenu.swf,
  Data\meshes\thornswood\noticeboard01.nif and dropbox01.nif any more: each is
  Bethesda's file edited or put together, and Bethesda's terms grant no right
  to hand those on. The launcher makes them on each machine from that
  machine's own game archives (launcher\app\FromGame*.cs, MadeFromGame.cs), and
  they must come out byte for byte the files that shipped until now. Patrick
  chose this on 19 Oct (option 2).

  WHAT THIS HOLDS.
    1. On a made-up game (tests\fixtures\2827\from-game-fixture.py writes its
       archives, every byte from fixed numbers, nothing of Bethesda's), the
       launcher's own code makes all three byte for byte what the two Python
       tools that write the recipes make: the menu Build-StartMenu.py was
       given, and the meshes Build-NoticeBoard.py builds. The made-up meshes
       carry every case the build meets, and the archives every way an
       archive stores a file (the fixture's header says which).
    2. The recipes beside the fixture are what those two tools write from it
       (their --check), when this machine's Python has numpy and lz4, which
       both read the archives with. Both tools must agree with the launcher, or a
       recipe written on One would make something else here.
    3. A game that differs makes nothing, and the reason names the file of
       the game that differs: one byte changed in a notice mesh, one in the
       menu. A game with no Skyrim - Interface.bsa names that archive.
    4. ZlibLevel6, the launcher's port of zlib's level 6, packs a run of
       awkward inputs to the same bytes as Python's zlib does.
    5. The recipes that ship come to the files that shipped: their sha256 and
       sizes are the ones on record for those files (a1dd4595..., 47cfe0f2...,
       09d8ae92...).
    6. The same files compile at C# 5, which is what Windows PowerShell 5.1's
       Add-Type compiles, because scripts\release\Go.ps1 runs them there.
    7. By the source: the three, then the collection's six menus, are
       FromGame.Files, Ship-Rules.ps1 $ShipMadeFromGame then
       $ShipMadeFromMods, and OwnGameKinds.cs MadeInGame alike; no release list
       ships them and no file at their paths is in the repository; Play, Scan
       and Fix, the own folder and Go.ps1 all make or keep them.
    8. The collection's menus with no gold values (#3113) and the journal (#3127, FromGameModMenus.cs,
       written by scripts\mods\Build-ModMenus.py from the mods' own archives,
       which no test machine has): on the made-up game, which has none of the
       mods, each of the six says which archive it needs and nothing is made;
       each names its mod and both sha256s; a recipe for a file that is not a
       SWF takes its edits on the bytes as they are; and a mod file that is not
       the pinned one names the mod.

  Reads the repository; writes only its own folder under the scratch folder
  and its builds under out\harness. Needs Python (the fixture is plain
  Python) and the .NET SDK the launcher builds with, which also builds the C#
  5 copy against the .NET Framework (tests\Framework-Csc.ps1), so all of it
  runs on every machine.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Framework-Csc.ps1')  # the .NET SDK the launcher builds with, and C# 5 against the .NET Framework (#498, #4823)
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }
$App = Join-Path $Repo 'launcher\app'
$Fixture = Join-Path $Repo 'tests\fixtures\2827'

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
function List([string]$text, [string]$name) {
    $m = [regex]::Match($text, '(?ms)^\$' + $name + ' = @\((.*?)^\)')
    if (-not $m.Success) { return @() }
    $body = ($m.Groups[1].Value -split "`n" | ForEach-Object { $_ -replace '#.*$', '' }) -join "`n"
    @([regex]::Matches($body, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
}

# ---- what it needs -------------------------------------------------------------
$python = $null
foreach ($n in 'python', 'python3') {
    $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $python = $c.Source; break }
}
Yes 'Python is on this machine, to write the made-up game' ([bool]$python)
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
$real = @('FromGame.cs', 'FromGameArchive.cs', 'FromGameDeflate.cs', 'FromGameMath.cs', 'FromGameBoard.cs', 'FromGameMenu.cs', 'FromGameModMenus.cs') |
    ForEach-Object { Join-Path $App $_ }
foreach ($f in $real) {
    $why = ''
    if ($f -like '*FromGameMenu.cs') { $why = ' (written on a machine with the game by scripts\mods\Build-StartMenu.py)' }
    if ($f -like '*FromGameBoard.cs') { $why = ' (written on a machine with the game by scripts\mods\Build-NoticeBoard.py)' }
    if ($f -like '*FromGameModMenus.cs') { $why = ' (written from the collection''s archives by scripts\mods\Build-ModMenus.py)' }
    Yes ("launcher\app\{0} is there{1}" -f [IO.Path]::GetFileName($f), $why) (Test-Path -LiteralPath $f)
}
if ($script:fail) { Done }

$work = Join-Path $Scratch ('thornswood-2827-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    # ---- 1. the made-up game, and the same game changed ---------------------------
    $game = Join-Path $work 'game'
    $changed = Join-Path $work 'changed'
    $noMenu = Join-Path $work 'no-menu'
    $fx = Join-Path $Fixture 'from-game-fixture.py'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $said = & $python -I $fx $game --edited 2>&1; $rc1 = $LASTEXITCODE
    $said += & $python -I $fx $changed --changed 2>&1; $rc2 = $LASTEXITCODE
    $ErrorActionPreference = $old
    Yes 'the fixture writes the made-up game, and the same game changed' ($rc1 -eq 0 -and $rc2 -eq 0 -and (Test-Path -LiteralPath (Join-Path $game 'Skyrim - Interface.bsa')))
    if ($rc1 -ne 0 -or $rc2 -ne 0) { $said | ForEach-Object { Write-Host "      $_" }; Done }
    $null = New-Item -ItemType Directory -Force -Path $noMenu
    Get-ChildItem -LiteralPath $game -Filter '*.bsa' -File | Where-Object { $_.Name -ne 'Skyrim - Interface.bsa' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $noMenu }

    # ---- 2. the recipes beside the fixture are what the two tools write ----------
    # Both tools read the game's archives with Build-NoticeBoard.py's reader,
    # which needs lz4 (Skyrim's archives are LZ4 packed) and numpy. The VPS
    # runner's Python has neither (measured 19 Oct, #2855), so there they are
    # not run; the launcher's build below is still held to the recipes they
    # wrote, which is the part that ships.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $python -I -c 'import numpy, lz4.frame' 2>&1 | Out-Null
    $hasTools = ($LASTEXITCODE -eq 0)
    if ($hasTools) {
        $menuCheck = & $python -I (Join-Path $Repo 'scripts\mods\Build-StartMenu.py') --data $game --edited (Join-Path $game 'edited-startmenu.swf') `
            --recipe (Join-Path $Fixture 'FixtureMenu.cs') --name Fixture --check 2>&1
        $menuRc = $LASTEXITCODE
        $boardCheck = & $python -I (Join-Path $Repo 'scripts\mods\Build-NoticeBoard.py') --data $game `
            --recipe (Join-Path $Fixture 'FixtureBoard.cs') --name Fixture --check 2>&1
        $boardRc = $LASTEXITCODE
    }
    $ErrorActionPreference = $old
    if ($hasTools) {
        Yes 'Build-StartMenu.py writes FixtureMenu.cs from the made-up game, packing it again byte for byte' ($menuRc -eq 0)
        if ($menuRc -ne 0) { $menuCheck | ForEach-Object { Write-Host "      $_" } }
        Yes 'Build-NoticeBoard.py writes FixtureBoard.cs from the made-up game' ($boardRc -eq 0)
        if ($boardRc -ne 0) { $boardCheck | ForEach-Object { Write-Host "      $_" } }
    } else {
        Write-Host 'SKIP  this Python has no numpy or lz4, which Build-StartMenu.py and Build-NoticeBoard.py read archives with, so neither was run; the launcher''s build below is held to the recipes they wrote'
    }

    # ---- 1, 3, 4 and 5: the launcher's own code, with a driver ------------------
    # 7 holds the lists to the files the compiled FromGame says it makes, so it
    # waits on this too.
    $driver = @'
using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    static class FromGameTest
    {
        static void Yes(string what, bool cond) { Console.WriteLine((cond ? "PASS  " : "FAIL  ") + what); }

        static FromGameFile Get(List<FromGameFile> l, string rel)
        {
            foreach (FromGameFile f in l) if (f.Rel == rel) return f;
            return null;
        }

        static bool Same(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        static uint seed = 2827;
        static byte Next() { seed = seed * 1103515245u + 12345u; return (byte)(seed >> 16); }

        static int Main(string[] a)
        {
            string game = a[0], changed = a[1], noMenu = a[2], zdir = a[3];

            List<FromGameFile> made = FromGame.Build(game, MenuRecipe.Fixture, BoardRecipe.Fixture);
            FromGameFile menu = Get(made, FromGame.MenuFile), board = Get(made, FromGame.BoardFile), box = Get(made, FromGame.BoxFile);
            Yes("the three are made, in order: menu, board, box", made.Count == 3 && menu != null && board != null && box != null);
            if (menu == null || board == null || box == null) return 1;
            Yes("the menu comes out byte for byte the edited menu Build-StartMenu.py was given (" + MenuRecipe.Fixture.Size + " bytes)" + (menu.Problem != null ? ": " + menu.Problem : ""),
                menu.Problem == null && Same(menu.Bytes, File.ReadAllBytes(Path.Combine(game, "edited-startmenu.swf"))) && menu.Sha256 == MenuRecipe.Fixture.Sha256);
            Yes("the notice board comes out byte for byte what Build-NoticeBoard.py builds (" + BoardRecipe.Fixture.BoardSize + " bytes)" + (board.Problem != null ? ": " + board.Problem : ""),
                board.Problem == null && board.Bytes.Length == BoardRecipe.Fixture.BoardSize && board.Sha256 == BoardRecipe.Fixture.BoardSha256);
            Yes("and so does the drop box (" + BoardRecipe.Fixture.BoxSize + " bytes)" + (box.Problem != null ? ": " + box.Problem : ""),
                box.Problem == null && box.Bytes.Length == BoardRecipe.Fixture.BoxSize && box.Sha256 == BoardRecipe.Fixture.BoxSha256);
            Yes("each says the sha256 it came out at, which is the one it was checked against", menu.Sha256 == FromGame.Sha256(menu.Bytes) && board.Sha256 == FromGame.Sha256(board.Bytes));

            List<FromGameFile> other = FromGame.Build(changed, MenuRecipe.Fixture, BoardRecipe.Fixture);
            FromGameFile om = Get(other, FromGame.MenuFile), ob = Get(other, FromGame.BoardFile), ox = Get(other, FromGame.BoxFile);
            Yes("a game whose menu differs by a byte makes no menu, and the reason names interface\\startmenu.swf: " + om.Problem,
                om.Bytes == null && om.Problem != null && om.Problem.IndexOf("interface\\startmenu.swf", StringComparison.OrdinalIgnoreCase) >= 0);
            Yes("a game whose notice mesh differs by a byte makes no board and no box, and the reason names note01.nif: " + ob.Problem,
                ob.Bytes == null && ox.Bytes == null && ob.Problem != null && ob.Problem.IndexOf("meshes\\clutter\\books\\note01.nif", StringComparison.OrdinalIgnoreCase) >= 0 && ox.Problem == ob.Problem);
            bool clean = true;
            foreach (FromGameFile f in other) if (f.Problem != null && (f.Problem.IndexOf('—') >= 0 || f.Problem.IndexOf("player", StringComparison.OrdinalIgnoreCase) >= 0)) clean = false;
            Yes("both reasons are in the house words", clean);

            List<FromGameFile> none = FromGame.Build(noMenu, MenuRecipe.Fixture, BoardRecipe.Fixture);
            FromGameFile nm = Get(none, FromGame.MenuFile), nb = Get(none, FromGame.BoardFile);
            Yes("a game with no Skyrim - Interface.bsa makes no menu, and the reason names that archive: " + nm.Problem,
                nm.Bytes == null && nm.Problem != null && nm.Problem.IndexOf("Skyrim - Interface.bsa", StringComparison.Ordinal) >= 0);
            Yes("and still makes the board, which needs none of it", nb.Problem == null && nb.Sha256 == BoardRecipe.Fixture.BoardSha256);

            // ZlibLevel6 on awkward inputs; the harness packs each with Python's zlib and compares.
            var cases = new Dictionary<string, byte[]>();
            cases["empty"] = new byte[0];
            cases["one"] = new byte[] { 42 };
            cases["zeros"] = new byte[300000];
            byte[] noise = new byte[150000]; for (int i = 0; i < noise.Length; i++) noise[i] = Next(); cases["noise"] = noise;
            byte[] rep = new byte[200000];
            for (int i = 0; i < rep.Length; i++) rep[i] = (i % 5000 < 300) ? Next() : rep[i - (i < 40000 ? 1 : 33000 + (i % 7))];
            cases["repeats-past-the-window"] = rep;
            byte[] few = new byte[100000]; for (int i = 0; i < few.Length; i++) few[i] = (byte)("abcab"[Next() % 5]); cases["few-letters"] = few;
            byte[] lazy = new byte[70000]; for (int i = 0; i < lazy.Length; i++) lazy[i] = (byte)((i * 7 + (i >> 9)) % 13 + (Next() % 41 == 0 ? 100 : 0)); cases["lazy-matches"] = lazy;
            Directory.CreateDirectory(zdir);
            foreach (KeyValuePair<string, byte[]> c in cases)
            {
                File.WriteAllBytes(Path.Combine(zdir, c.Key + ".in"), c.Value);
                File.WriteAllBytes(Path.Combine(zdir, c.Key + ".z"), ZlibLevel6.Compress(c.Value));
            }

            Yes("the shipped menu recipe comes to the menu that shipped (83,386 bytes, sha256 a1dd4595...)",
                MenuRecipe.Shipped.Size == 83386 && FromGame.Expected(FromGame.MenuFile) == "a1dd4595c1e931ecb8910334a3529238f2f50146997f3cd10191b87fa0190ecf");
            Yes("the shipped board recipe comes to the notice board that shipped (155,907 bytes, sha256 47cfe0f2...)",
                BoardRecipe.Shipped.BoardSize == 155907 && FromGame.Expected(FromGame.BoardFile) == "47cfe0f22bdf8db0c66ad059cf77c546aeba972ad694d20e6ad7318630918216");
            Yes("and to the drop box that shipped (29,665 bytes, sha256 09d8ae92...)",
                BoardRecipe.Shipped.BoxSize == 29665 && FromGame.Expected(FromGame.BoxFile) == "09d8ae9277b6006017ff82f21fa2081e63f6c2249ffe63300e1e8cffb299241e");
            Yes("the shipped board recipe names the sha256 of every game mesh it reads", BoardRecipe.Shipped.Sources != null && BoardRecipe.Shipped.Sources.Length > 0);

            string gone = Path.Combine(zdir, "no-game");
            Yes("a file that is not there is not current", !FromGame.IsCurrent(gone, FromGame.MenuFile));
            Directory.CreateDirectory(Path.Combine(gone, "Data\\Interface"));
            File.WriteAllBytes(Path.Combine(gone, FromGame.MenuFile), menu.Bytes);
            Yes("nor is one with other bytes", !FromGame.IsCurrent(gone, FromGame.MenuFile));

            // The collection's menus with no gold values (#3113) and the journal
            // (#3127). The made-up game has none of the mods' archives, so each of the six says
            // which one it could not read, and nothing is made.
            List<FromGameFile> all = FromGame.Build(game);
            int mods = 0; bool named = true, pinned = true;
            foreach (MenuRecipe m in MenuRecipe.Mods)
            {
                FromGameFile f = Get(all, m.Path);
                if (f == null) { named = false; continue; }
                mods++;
                if (f.Bytes != null || f.Problem == null || f.Problem.IndexOf(m.Archive, StringComparison.OrdinalIgnoreCase) < 0) named = false;
                if (string.IsNullOrEmpty(m.Mod) || FromGame.Expected(m.Path) != m.Sha256 || m.Sha256.Length != 64 || m.SourceSha256.Length != 64 || m.Edits.Length == 0) pinned = false;
            }
            Yes("a game with none of the collection's mods makes none of their six menus, and each reason names the archive it needs", mods == 6 && named);
            Yes("each of the six names its mod, the sha256 of the mod's own file it is made from, and the sha256 it must come out at", pinned);

            // A recipe for a file that is not a SWF (SkyUI's config.txt) takes
            // its edits on the bytes as they are. Tried on the made-up game's
            // menu, read as plain bytes.
            byte[] plainSrc = new GameArchives(game, new[] { "Skyrim - Interface.bsa" }).Read("interface\\startmenu.swf");
            var want = new List<byte>(plainSrc);
            want.RemoveRange(3, 2);
            want.InsertRange(3, new byte[] { 0x41, 0x42, 0x43 });
            var text = new MenuRecipe
            {
                Mod = "Fixture", Archive = "Skyrim - Interface.bsa", Source = "interface\\startmenu.swf",
                SourceSha256 = FromGame.Sha256(plainSrc), SourceSize = plainSrc.Length,
                Path = "Data\\Interface\\fixture.txt", Sha256 = FromGame.Sha256(want.ToArray()), Size = want.Count,
                Edits = new[] { new MenuEdit(3, 2, "414243") }
            };
            FromGameFile t = FromGame.BuildMenu(game, text);
            Yes("a recipe for a file that is not a SWF takes its edits on the bytes as they are" + (t.Problem != null ? ": " + t.Problem : ""),
                t.Problem == null && Same(t.Bytes, want.ToArray()));
            text.SourceSha256 = new string('0', 64);
            FromGameFile u = FromGame.BuildMenu(game, text);
            Yes("and when the mod's own file is not the one the recipe pins, nothing is made and the reason names the mod: " + u.Problem,
                u.Bytes == null && u.Problem != null && u.Problem.IndexOf("Fixture is not the version the collection pins", StringComparison.Ordinal) >= 0);

            Console.WriteLine("files: " + string.Join("|", FromGame.Files));
            return 0;
        }
    }
}
'@
    $utf8 = New-Object Text.UTF8Encoding($false)
    $sources = @($real | ForEach-Object { (Resolve-Path -LiteralPath $_).Path }) +
        @((Join-Path $Fixture 'FixtureMenu.cs'), (Join-Path $Fixture 'FixtureBoard.cs'))
    # At the build's C# version with the .NET SDK, the program that runs below;
    # and at C# 5 against the .NET Framework, as Windows PowerShell 5.1's
    # Add-Type compiles them for Go.ps1, built only.
    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Main 'Thornswood.FromGameTest' -Source $driver -File $sources }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes "the launcher's FromGame files, the fixture's recipes and the driver compile at C# $LauncherLangVersion, as the build does" ($null -ne $exe)
    $five = $null
    try { $five = Build-FrameworkCode -Exe -Main 'Thornswood.FromGameTest' -Source $driver -File $sources }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes 'and at C# 5 against the .NET Framework, as Windows PowerShell 5.1''s Add-Type compiles them for Go.ps1' ($null -ne $five)
    if (-not $exe) { Done }

    $zdir = Join-Path $work 'zlib'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = Invoke-LauncherExe $exe $game $changed $noMenu $zdir 2>&1
    $ErrorActionPreference = $old
    $files = @()
    foreach ($l in @($out)) {
        $l = "$l"
        if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
        elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
        elseif ($l -match '^files: (.*)$') { $files = $Matches[1] -split '\|' }
        else { Write-Host "      $l" }
    }
    # The three of the game's, then one for each recipe FromGameModMenus.cs holds.
    $modRecipes = [regex]::Matches((Src (Join-Path $App 'FromGameModMenus.cs')), 'public static readonly MenuRecipe \w+ = new MenuRecipe').Count
    Yes ('the driver ran to the end and reported all {0} files' -f (3 + $modRecipes)) ($modRecipes -gt 0 -and $files.Count -eq 3 + $modRecipes)

    $zcheck = Join-Path $work 'zcheck.py'
    [IO.File]::WriteAllText($zcheck, @'
import os, sys, zlib
d = sys.argv[1]
bad = []
for n in sorted(os.listdir(d)):
    if not n.endswith('.in'):
        continue
    raw = open(os.path.join(d, n), 'rb').read()
    c = zlib.compressobj(6, zlib.DEFLATED, 15, 8, zlib.Z_DEFAULT_STRATEGY)
    want = c.compress(raw) + c.flush()
    if open(os.path.join(d, n[:-3] + '.z'), 'rb').read() != want:
        bad.append(n[:-3])
print('cases %d, differ: %s' % (len([n for n in os.listdir(d) if n.endswith('.in')]), ', '.join(bad) or 'none'))
sys.exit(1 if bad else 0)
'@, $utf8)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $zsaid = & $python -I $zcheck $zdir 2>&1; $zrc = $LASTEXITCODE
    $ErrorActionPreference = $old
    Yes ("ZlibLevel6 packs each awkward input to the bytes Python's zlib does ({0})" -f ($zsaid -join ' ')) ($zrc -eq 0)

    # ---- 7. by the source ------------------------------------------------------------
    $rules = Src (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
    $made = @(List $rules 'ShipMadeFromGame') + @(List $rules 'ShipMadeFromMods')
    $ours = List $rules 'ShipOursFiles'
    $kinds = Src (Join-Path $App 'OwnGameKinds.cs')
    $inGame = @([regex]::Matches([regex]::Match($kinds, '(?s)static readonly string\[\] MadeInGame = \{(.*?)\};').Groups[1].Value, '"((?:[^"\\]|\\.)*)"') |
        ForEach-Object { $_.Groups[1].Value.Replace('\\', '\') })
    Yes ('Ship-Rules.ps1 $ShipMadeFromGame, then $ShipMadeFromMods, is FromGame.Files (' + ($made -join ', ') + ')') ((@($made) -join '|') -eq ($files -join '|'))
    Yes 'and so is OwnGameKinds.cs MadeInGame, which the own folder keeps' ((@($inGame) -join '|') -eq ($files -join '|'))
    Yes 'and no release list ships any of them' (@($files | Where-Object { $ours -contains $_ }).Count -eq 0)
    $go = Src (Join-Path $Repo 'scripts\release\Go.ps1')
    $goMenu = List $go 'oursMenuFiles'
    if (-not $goMenu.Count) { $goMenu = @([regex]::Matches([regex]::Match($go, '(?s)\$oursMenuFiles = @\((.*?)\)').Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value }) }
    Yes 'Go.ps1 copies none of them out of game\ours' ($goMenu.Count -gt 0 -and @($goMenu | Where-Object { $files -contains $_ }).Count -eq 0)
    Yes 'and makes them with FromGame instead' ($go -match "\[Thornswood\.FromGame\]::Build\(" -and $go -match "Filter 'FromGame\*\.cs'")
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $tracked = @(& git -C $Repo ls-files -- @($files | ForEach-Object { 'game/ours/' + $_.Replace('\', '/') }) 2>&1)
    $ErrorActionPreference = $old
    Yes 'no file at their game\ours paths is in the repository' ($LASTEXITCODE -eq 0 -and $tracked.Count -eq 0)
    $play = Src (Join-Path $App 'ShellPlay.cs')
    Yes 'Play makes what is missing or changed before the game starts' ($play -match 'MadeFromGame\.Ensure\(\)' -and $play.IndexOf('MadeFromGame.Ensure()') -lt $play.IndexOf('if (!EnsureServer()) return;'))
    $upkeep = Src (Join-Path $App 'Upkeep.cs')
    Yes 'Scan says when they are missing or changed, and Fix makes them' ($upkeep -match '\bMade\(l\);' -and $upkeep -match 'IssueKind\.MadeFromGame\)\)\s*\{?\s*[^\n]*MadeFromGame\.Ensure\(\)')
    $own = Src (Join-Path $App 'OwnGame.cs')
    Yes 'the own folder''s refresh leaves them alone' ($own -match 'foreach \(string rel in MadeInGame\) set\.Add\(rel\);')
    $mfg = Src (Join-Path $App 'MadeFromGame.cs')
    Yes 'a made file takes the old name off before it is moved in, so a link into the Steam copy or Vortex is never written through' ($mfg -match 'OwnGame\.DropName\(dest\)' -and $mfg.IndexOf('OwnGame.DropName(dest)') -lt $mfg.IndexOf('File.Move(next, dest)'))
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
