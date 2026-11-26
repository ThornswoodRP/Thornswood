<#
  test-4702-whole-settings.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4702-whole-settings.ps1

  Issue #4702. The launcher wrote config.json, the Discord sign-in files, the
  door note, the character list the game's menu reads and SkyrimPlatform.ini
  in place, with File.WriteAllBytes and File.WriteAllText, which empty the
  file and then fill it. A launcher stopped between the two left a short
  file, and Config.Load reads a config.json that is not JSON as no settings
  at all: every choice went back to its default and a dev install turned
  into a main one. Each now goes through WholeFile (launcher\app\WholeFile.cs):
  the bytes go to a .new beside the file, flushed to the disk, renamed over
  it in one call.

  WHAT IT HOLDS THEM TO.
    1. None of those writers writes its file in place any more; each goes
       through WholeFile, and config.json and the ticket are locked to this
       account before they take their name.
    2. WholeFile writes the .new, flushes it to the disk and renames it over
       the file with MoveFileEx, MOVEFILE_REPLACE_EXISTING and
       MOVEFILE_WRITE_THROUGH, the call OwnGame.WriteRecord makes.
    3. Discord.AccountFiles names each file's .new as well, so Forget and an
       uninstall take a leftover sign-in with the rest.
    4. Compiled with the .NET SDK the launcher builds with, the real
       Config.cs and WholeFile.cs: a Save leaves the new settings and no .new;
       WriteText keeps a byte order mark only where the encoding has one;
       the lock is handed the .new while config.json is still the old one.
    5. A launcher saving a dev install's config.json in a loop, killed 40
       times at random moments: every time, config.json is there, is whole
       JSON, and Config.Load reads the dev channel back. Off Windows the
       rename is File.Move, rename(2), and the same kills run there.

  Nothing outside its own scratch folder is written.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $Repo 'tests\Launcher-Csc.ps1')
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
function Text([string]$name) { return ([IO.File]::ReadAllText((Join-Path $App $name)) -replace "`r`n", "`n") }

# The body of the method that starts with sig, from its first brace to the
# one that closes it, braces inside strings, characters and comments not
# counted (WriteCharacters has a "}" in it). '' when it is not there.
function Body([string]$src, [string]$sig) {
    $at = $src.IndexOf($sig)
    if ($at -lt 0) { return '' }
    $open = $src.IndexOf('{', $at + $sig.Length)
    if ($open -lt 0) { return '' }
    $depth = 0
    $i = $open
    while ($i -lt $src.Length) {
        $c = $src[$i]
        if ($c -eq '/' -and $i + 1 -lt $src.Length -and $src[$i + 1] -eq '/') {
            $nl = $src.IndexOf("`n", $i); if ($nl -lt 0) { return '' }; $i = $nl; continue
        }
        if ($c -eq '"' -or $c -eq "'") {
            $i++
            while ($i -lt $src.Length -and $src[$i] -ne $c) { if ($src[$i] -eq '\') { $i++ }; $i++ }
            $i++; continue
        }
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($open, $i - $open + 1) } }
        $i++
    }
    return ''
}
$inPlace = '\bFile\.Write(AllBytes|AllText|AllLines)\('

# ---- 1: the writers -----------------------------------------------------------
$writers = @(
    @{ File = 'Config.cs';       Sig = 'public void Save(string path)';                       Name = 'Config.Save, config.json';                         Want = 'WholeFile\.Write\(path, JsonSerializer\.SerializeToUtf8Bytes\(this, ConfigJson\.Writer\.Config\), Secrets\.LockDown\);' },
    @{ File = 'Discord.cs';      Sig = 'static void Save(string t, string who, string pic)';  Name = 'Discord.Save, the ticket, name and picture';       Want = 'WholeFile\.WriteText\(TicketFile, Secrets\.Protect\(t \?\? ""\), new UTF8Encoding\(false\), Secrets\.LockDown\);' },
    @{ File = 'Discord.cs';      Sig = 'public static void NoteAvatar(string pic)';           Name = 'Discord.NoteAvatar';                               Want = 'WholeFile\.WriteText\(AvatarFile, pic\);' },
    @{ File = 'Discord.cs';      Sig = 'static void NoteDev(bool allowed)';                   Name = 'Discord.NoteDev';                                  Want = 'WholeFile\.WriteText\(DevFile, "yes"\);' },
    @{ File = 'Discord.cs';      Sig = 'static void MarkPending(string id)';                  Name = 'Discord.MarkPending';                              Want = 'WholeFile\.WriteText\(PendingFile, id\);' },
    @{ File = 'Door.cs';         Sig = 'static void Remember(bool ok)';                       Name = 'Door.Remember, door.txt';                          Want = 'WholeFile\.WriteText\(AnswerFile, ' },
    @{ File = 'Chars.cs';        Sig = 'static void WriteList(string json)';                  Name = 'Chars.WriteList, thornswood-characters.json';      Want = 'WholeFile\.WriteText\(CharactersFile, json\);' },
    @{ File = 'Chars.cs';        Sig = 'static void WriteCharacters(Config cfg, List<Row> rows, int last, int spare, int slots)'; Name = 'Chars.WriteCharacters, thornswood-characters.js'; Want = 'WholeFile\.WriteText\(Path\.Combine\(ui, "thornswood-characters\.js"\),' },
    @{ File = 'Chars.cs';        Sig = 'static string WriteBrowserBackend()';                 Name = 'Chars.WriteBrowserBackend, SkyrimPlatform.ini';    Want = 'WholeFile\.WriteText\(PlatformIni, next, new UTF8Encoding\(true\)\);' },
    @{ File = 'InstallSteps.cs'; Sig = 'static void WriteJson(string path, JsonObject o)';    Name = 'the setup''s config.json (InstallSteps.WriteJson)'; Want = 'WholeFile\.Write\(path, ms\.ToArray\(\)\);' }
)
foreach ($w in $writers) {
    $b = Body (Text $w.File) $w.Sig
    Yes ("{0} is found by its signature in {1}" -f $w.Name, $w.File) ($b.Length -gt 0)
    if ($b.Length -eq 0) { continue }
    $code = [regex]::Replace($b, '//.*', '')
    Yes ("{0}: nothing written in place" -f $w.Name) ($code -notmatch $inPlace)
    Yes ("{0}: written whole, through WholeFile" -f $w.Name) ($code -match $w.Want)
}
$dSave = Body (Text 'Discord.cs') 'static void Save(string t, string who, string pic)'
Yes 'Discord.Save locks the ticket before it takes its name, not after' ($dSave -notmatch 'Secrets\.LockDown\(TicketFile\)')
$cSave = Body (Text 'Config.cs') 'public void Save(string path)'
Yes 'Config.Save locks config.json before it takes its name, not after' ($cSave -notmatch 'Secrets\.LockDown\(path\)')

# ---- 2: WholeFile -------------------------------------------------------------
$wf = Text 'WholeFile.cs'
$write = Body $wf 'internal static void Write(string path, byte[] bytes, Action<string> beforeSwap)'
Yes 'WholeFile writes the .new beside the file, flushed to the disk' (
    $write -match 'string next = Next\(path\);' -and $write -match 'new FileStream\(next, FileMode\.Create, FileAccess\.Write, FileShare\.None\)' -and
    $write -match 'fs\.Flush\(true\);')
Yes '...hands the .new to beforeSwap, then renames it over the file' ($write -match '(?s)beforeSwap\(next\);.*SwapIn\(next, path\);')
Yes '...in one MoveFileEx, replacing and written through' (
    $wf -match 'MoveFileEx\(next, path, MoveReplaceExisting \| MoveWriteThrough\)' -and
    $wf -match 'const int MoveReplaceExisting = 0x1;' -and $wf -match 'const int MoveWriteThrough = 0x8;')
Yes '...and never through File.Replace, which leaves a moment with no file (#2591)' ($wf -notmatch 'File\.Replace\(' -and $wf -notmatch 'File\.Delete\(')
Yes '...and the .new is path + ".new"' ($wf -match 'internal static string Next\(string path\) \{ return path \+ "\.new"; \}')

# ---- 3: the account files -----------------------------------------------------
$acct = Body (Text 'Discord.cs') 'public static string[] AccountFiles(string folder)'
Yes 'Discord.AccountFiles names every account file''s .new too' ($acct -match 'WholeFile\.Next\(files\[i\]\)')

# ---- 4 and 5: compiled --------------------------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.IO;
using System.Text;

namespace Thornswood
{
    // Swallow.cs reads the log's path from here; left null, nothing is logged.
    static class Paths { public static string LogFile; }

    static class WholeSettingsTest
    {
        static Config Dev(int k)
        {
            var c = new Config();
            c.Channel = "dev";
            c.ServerPort = k % 2 == 0 ? "7787" : "7788";
            return c;
        }

        static int Main(string[] args)
        {
            string mode = args[0], path = args[1];
            if (mode == "seed") { Dev(0).Save(path); return 0; }
            if (mode == "read")
            {
                // What the next start of the launcher would see.
                Config c = Config.Load(path);
                Console.WriteLine(c.Channel + "|" + c.ServerPort);
                return 0;
            }
            if (mode == "lock")
            {
                // The lock is handed the .new while path is still the old file.
                string seen = null;
                WholeFile.Write(path, Encoding.UTF8.GetBytes("new"), n => {
                    seen = Path.GetFileName(n) + "|" + File.ReadAllText(n) + "|" + File.ReadAllText(path);
                });
                Console.WriteLine(seen + "|" + File.ReadAllText(path) + "|" + File.Exists(WholeFile.Next(path)));
                return 0;
            }
            if (mode == "marks")
            {
                string a = path + ".bom", b = path + ".plain";
                WholeFile.WriteText(a, "[Browser]", new UTF8Encoding(true));
                WholeFile.WriteText(b, "[Browser]");
                byte[] ab = File.ReadAllBytes(a), bb = File.ReadAllBytes(b);
                Console.WriteLine(ab.Length + "|" + ab[0].ToString("X2") + "|" + bb.Length + "|" + bb[0].ToString("X2"));
                return 0;
            }
            Console.WriteLine("ready");
            Console.Out.Flush();
            for (int k = 0; ; k++) Dev(k).Save(path);
        }
    }
}
'@

$files = @('Config.cs', 'LooseString.cs', 'Secrets.cs', 'Swallow.cs', 'WholeFile.cs') | ForEach-Object { Join-Path $App $_ }
$dll = $null
try { $dll = Build-LauncherCode -Exe -Source $driver -File $files }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes "Config.cs and WholeFile.cs compile with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $dll)
if (-not $dll) { Done }

$work = Join-Path $Scratch ('thornswood-4702-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    function Run([string[]]$a) { return @(Invoke-LauncherExe $dll @a | ForEach-Object { [string]$_ }) }

    $cfg = Join-Path $work 'config.json'
    $null = Run @('seed', $cfg)
    $said = (Run @('read', $cfg)) -join ''
    Yes ('a Save writes the settings and Load reads them back (' + $said + ')') ($said -eq 'dev|7787')
    Yes '...and leaves no .new beside config.json' (-not (Test-Path -LiteralPath ($cfg + '.new')))

    $f = Join-Path $work 'door.txt'
    [IO.File]::WriteAllText($f, 'old')
    $said = (Run @('lock', $f)) -join ''
    Yes ('the lock is handed the .new, written, while the file is still the old one (' + $said + ')') ($said -eq 'door.txt.new|new|old|new|False')

    $said = (Run @('marks', (Join-Path $work 'ini'))) -join ''
    Yes ('WriteText keeps a byte order mark only where the encoding has one (' + $said + ')') ($said -eq '12|EF|9|5B')

    # Killed while it saves, the way Task Manager or a crash stops it.
    $kill = Join-Path $work 'killed\config.json'
    $null = New-Item -ItemType Directory -Force -Path (Split-Path $kill)
    $null = Run @('seed', $kill)
    $kills = 40; $whole = 0; $bad = @()
    $rand = New-Object Random 4702
    for ($i = 0; $i -lt $kills; $i++) {
        $psi = New-Object Diagnostics.ProcessStartInfo($LauncherDotnet, ('"{0}" loop "{1}"' -f $dll, $kill))
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $p = [Diagnostics.Process]::Start($psi)
        $null = $p.StandardOutput.ReadLine()
        Start-Sleep -Milliseconds ($rand.Next(15, 160))
        $p.Kill(); $p.WaitForExit(); $p.Dispose()
        $json = $false
        if (Test-Path -LiteralPath $kill) {
            try { $null = [IO.File]::ReadAllText($kill) | ConvertFrom-Json; $json = $true } catch { $json = $false }
        }
        $back = (Run @('read', $kill)) -join ''
        if ($json -and $back -in @('dev|7787', 'dev|7788')) { $whole++ }
        else {
            $bad += $(if (-not (Test-Path -LiteralPath $kill)) { 'missing' } elseif (-not $json) { 'cut short' } else { 'read as ' + $back })
            $null = Run @('seed', $kill)
        }
    }
    Yes ('killed {0} times while it saves a dev install''s config.json: whole, and still dev, every time ({1} of {0}{2})' -f $kills, $whole, $(if ($bad) { '; ' + ($bad -join ', ') })) ($whole -eq $kills)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
