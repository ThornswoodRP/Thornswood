<#
  test-4712-accepted-note-stops.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4712-accepted-note-stops.ps1

  #4712. When setup cannot write Profile\accepted.json, the note of what the
  person accepted, it stops there, before the install's steps start, and says
  which file, why and what to do. Until then InstallAgreements.Record caught
  the failed write, said one line and returned, so InstallWindow.Work went on
  into InstallSteps.Run, whose own check stopped it with "Setup found no note
  that you accepted": blaming answers the person had just given, and sending
  them round into the same failure.

  This compiles the real InstallAgreements.cs, Failure.cs and Swallow.cs,
  with InstallStop lifted from InstallSteps.cs and Paths cut down to LogFile,
  and makes the write fail in a temp folder: accepted.json's name is taken by
  a folder, so Windows (or Linux) refuses the file.
    1. The write throws an InstallStop, so the install's worker after it is
       never reached, and no file is left.
    2. Its words name the file, say nothing was installed, give the reason
       and a next step, and carry no Windows sentence.
    3. A write that works leaves the note, so an ordinary setup goes on.
    4. In InstallWindow.Work, Record comes before the steps are made, in the
       same try, with nothing between that catches; and Record has no catch
       left round the write.
  On main there is no Write and the failed write is caught and said, so 1, 2
  and 4 fail.

  No site is asked: Write is the half of Record after the pages are fetched.
  No launcher or setup is started.
#>
$ErrorActionPreference = 'Stop'
$app = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$pass = 0; $fail = 0
function Yes([string]$name, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS  $name" } else { $script:fail++; Write-Host "FAIL  $name" } }
function Done { Write-Host "$pass passed, $fail failed"; if ($fail) { exit 1 }; exit 0 }

$agreeSrc = [IO.File]::ReadAllText((Join-Path $app 'InstallAgreements.cs'))
$stepsSrc = [IO.File]::ReadAllText((Join-Path $app 'InstallSteps.cs'))
$windowSrc = [IO.File]::ReadAllText((Join-Path $app 'InstallWindow.cs'))

# 4. The source's order, and no catch left behind the write.
$record = [regex]::Match($agreeSrc, '(?ms)^        public static void Record\(.*?^        \}\r?\n').Value
$write = [regex]::Match($agreeSrc, '(?ms)^        public static void Write\(string profileDir, DateTime at, string\[\] shas\)\r?\n.*?^        \}\r?\n').Value
Yes '4. InstallAgreements has Write, the note''s own write' ($write.Length -gt 0)
Yes '   Record writes through it, after the pages' ($record.Contains('Write(profileDir, at, shas);') -and -not $record.Contains('File.WriteAllText'))
Yes '   and its one catch throws a stop rather than saying a line' ($write.Contains('throw new InstallStop(') -and -not $write.Contains('say('))
$work = [regex]::Match($windowSrc, '(?ms)^        void Work\(InstallChoice choice, DateTime acceptedAt\)\r?\n.*?^        \}\r?\n').Value
$rec = $work.IndexOf('InstallAgreements.Record(profile, acceptedAt, Line);')
$steps = $work.IndexOf('var steps = new InstallSteps(')
$between = if ($rec -ge 0 -and $steps -gt $rec) { $work.Substring($rec, $steps - $rec) } else { '' }
Yes '   Work notes what was accepted before it makes the steps' ($rec -ge 0 -and $steps -gt $rec)
Yes '   with nothing between that could catch the stop' ($between.Length -gt 0 -and $between -notmatch '\btry\b|\bcatch\b')

$stop = [regex]::Match($stepsSrc, '(?ms)^    sealed class InstallStop : Exception\r?\n    \{.*?^    \}\r?\n').Value
Yes 'InstallStop is found in InstallSteps.cs' ($stop.Length -gt 0)
if (-not $write -or -not $stop) { Done }

$stub = @"
namespace Thornswood
{
    static class Paths { public static string LogFile = null; }
    public static class Probe
    {
        public static string Note(string profile)
        {
            try { InstallAgreements.Write(profile, System.DateTime.UtcNow, new string[] { "", "", "" }); }
            catch (InstallStop s) { return "STOP:" + s.Message; }
            return "WENT ON";
        }
    }
$($stop -replace 'sealed class InstallStop', 'public sealed class InstallStop')
}
"@
$src = @([IO.File]::ReadAllText((Join-Path $app 'Swallow.cs')), [IO.File]::ReadAllText((Join-Path $app 'Failure.cs')), $agreeSrc, $stub)
# One compilation of four files: their using lines go first, once each.
$usings = New-Object System.Collections.Generic.SortedSet[string]
$bodies = foreach ($s in $src) {
    foreach ($m in [regex]::Matches($s, '(?m)^using [A-Za-z0-9_.]+;\r?$')) { [void]$usings.Add($m.Value.Trim()) }
    [regex]::Replace($s, '(?m)^using [A-Za-z0-9_.]+;\r?\n', '')
}
$compileError = ''
try { Add-Type -TypeDefinition ((@($usings) -join "`n") + "`n" + (@($bodies) -join "`n")) -Language CSharp }
catch { $compileError = $_.Exception.Message }
Yes ('the real InstallAgreements.cs, Failure.cs and Swallow.cs compile' + $(if ($compileError) { ': ' + $compileError } else { '' })) (-not $compileError)
if ($compileError -or -not ('Thornswood.Probe' -as [type])) { Done }

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4712-' + [Guid]::NewGuid().ToString('n'))
try {
    # 1 and 2: accepted.json's name is a folder, so the file cannot be written.
    $profile = Join-Path $root 'blocked\Profile'.Replace('\', [IO.Path]::DirectorySeparatorChar)
    $note = Join-Path $profile 'accepted.json'
    [void][IO.Directory]::CreateDirectory($note)
    $got = [Thornswood.Probe]::Note($profile)
    Yes '1. a note that cannot be written stops setup there' ($got.StartsWith('STOP:'))
    Yes '   so the install''s steps after it never start, and no note file is left' (-not (Test-Path -LiteralPath $note -PathType Leaf))
    $said = $got.Substring([Math]::Min(5, $got.Length))
    Write-Host "      said: $said"
    Yes '2. it names the file' ($said.Contains($note))
    Yes '   says nothing was installed' ($said.Contains('so nothing was installed'))
    Yes '   gives the reason and a next step' ($said -match 'Windows refused the launcher access to it\. .*then try again\.$')
    Yes '   and no Windows sentence' (-not ($said -match 'Access to the path|Is a directory|denied\.'))

    # 3: an ordinary write goes on and leaves the note.
    $ok = Join-Path $root 'fine\Profile'.Replace('\', [IO.Path]::DirectorySeparatorChar)
    $got = [Thornswood.Probe]::Note($ok)
    $okNote = Join-Path $ok 'accepted.json'
    Yes '3. a write that works goes on' ($got -eq 'WENT ON')
    Yes '   and leaves the note, with the three pages in it' ((Test-Path -LiteralPath $okNote -PathType Leaf) -and ([IO.File]::ReadAllText($okNote) -match '(?s)"terms".*"privacy".*"rules"'))
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
Done
