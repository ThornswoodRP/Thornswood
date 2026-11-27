<#
  test-4711-setup-failures-logged.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4711-setup-failures-logged.ps1

  #4711. A setup failure says what happened and what to do, and what Windows
  said behind it is in a log. The window's words come from Failure (#4633),
  which writes the exception to launcher.log through Swallow. But the
  first-run install runs before Paths.Init, which only runs once it has
  installed, so Paths.LogFile was empty and LauncherLog wrote nothing: a disk
  that filled during the copy stopped with "the drive ... is full. Free some
  space on it", and "There is not enough space on the disk", its error number
  and where it happened were in no file anywhere. Now InstallWindow.Work
  points launcher.log at the install's own Profile\launcher.log
  (Paths.LogFileFor) as soon as it has made Profile, and the stop names that
  file beside setup-log.txt.

  This compiles the real Swallow.cs and Failure.cs, with Paths cut down to
  LogFile and the real LogFileFor lifted out of Paths.cs, and plants a full
  disk: the IOException Windows raises for it (0x80070070) on a copy into a
  temp install folder, said the way InstallSteps.CopyFailed says it.
    1. With launcher.log pointed nowhere, as the install ran before: the
       window's words are right and the log has nothing. This is the cause.
    2. With it pointed where Work now points it: the same words, with no
       Windows sentence in them, and launcher.log in the install's Profile
       holds the Windows sentence and where it happened.
    3. Work points it there after Profile is made and before anything that
       can fail is run, and the stop names launcher.log.
  On main Paths.cs has no LogFileFor, so 2 and 3 fail.

  No disk is filled and no launcher or setup is started.
#>
$ErrorActionPreference = 'Stop'
$app = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$pass = 0; $fail = 0
function Yes([string]$name, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS  $name" } else { $script:fail++; Write-Host "FAIL  $name" } }
function Done { Write-Host "$pass passed, $fail failed"; if ($fail) { exit 1 }; exit 0 }

$pathsSrc = [IO.File]::ReadAllText((Join-Path $app 'Paths.cs'))
$windowSrc = [IO.File]::ReadAllText((Join-Path $app 'InstallWindow.cs'))
$logFor = [regex]::Match($pathsSrc, '(?ms)^        public static string LogFileFor\(string root\)\r?\n.*?^        \}\r?\n').Value
Yes 'Paths.cs says where an install''s launcher.log is (LogFileFor)' ($logFor.Length -gt 0)
Yes '  and Paths.Init sets LogFile by it' ($pathsSrc.Contains('LogFile     = LogFileFor(Root);'))

# 3. Work: after Profile is made, before the first step that can fail.
$work = [regex]::Match($windowSrc, '(?ms)^        void Work\(InstallChoice choice, DateTime acceptedAt\)\r?\n.*?^        \}\r?\n').Value
$made = $work.IndexOf('Directory.CreateDirectory(profile);')
$points = $work.IndexOf('Paths.LogFile = Paths.LogFileFor(choice.Root);')
$first = @($work.IndexOf('InstallSkyrim.Stop('), $work.IndexOf('InstallAgreements.Record('), $work.IndexOf('steps.Run();') | Where-Object { $_ -ge 0 } | Measure-Object -Minimum).Minimum
Yes '3. the install points launcher.log at its own Profile once Profile is made' ($made -ge 0 -and $points -gt $made)
Yes '   before anything it runs can fail' ($points -gt 0 -and $first -gt $points)
Yes '   and a stop names launcher.log beside setup-log.txt' ($work.Contains('"\n\nEverything it said is below, and saved in " + log +') -and $work.Contains('Paths.LogFileFor(choice.Root)'))
if (-not $logFor) { Done }

$paths = @"
using System.IO;
namespace Thornswood
{
    static class Paths
    {
        public static string LogFile;
$logFor
    }
    public static class Probe
    {
        public static string Copy(string dest, System.Exception e) { return Failure.Why("InstallSteps, copying " + dest, e, dest); }
        public static void Point(string root) { Paths.LogFile = root == null ? null : Paths.LogFileFor(root); }
    }
}
"@
$src = @([IO.File]::ReadAllText((Join-Path $app 'Swallow.cs')), [IO.File]::ReadAllText((Join-Path $app 'Failure.cs')), $paths)
# One compilation of three files: their using lines go first, once each.
$usings = New-Object System.Collections.Generic.SortedSet[string]
$bodies = foreach ($s in $src) {
    foreach ($m in [regex]::Matches($s, '(?m)^using [A-Za-z0-9_.]+;\r?$')) { [void]$usings.Add($m.Value.Trim()) }
    [regex]::Replace($s, '(?m)^using [A-Za-z0-9_.]+;\r?\n', '')
}
$src = @(@($usings) -join "`n") + $bodies
$compileError = ''
try {
    Add-Type -TypeDefinition ($src -join "`n") -Language CSharp
} catch { $compileError = $_.Exception.Message }
Yes ('the real Swallow.cs and Failure.cs compile' + $(if ($compileError) { ': ' + $compileError } else { '' })) (-not $compileError)
if ($compileError -or -not ('Thornswood.Probe' -as [type])) { Done }

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4711-' + [Guid]::NewGuid().ToString('n'))
try {
    $profileDir = Join-Path $root 'Profile'
    [void][IO.Directory]::CreateDirectory($profileDir)
    $dest = [IO.Path]::Combine($root, 'Profile', 'Payload', 'Data', 'Thornswood-Content.esp')
    $windows = 'There is not enough space on the disk.'
    $full = New-Object System.IO.IOException(($windows + " : '" + $dest + "'"), [int]0x80070070)
    $logPath = Join-Path $profileDir 'launcher.log'

    # 1. pointed nowhere, as before
    [Thornswood.Probe]::Point($null)
    $said = [Thornswood.Probe]::Copy($dest, $full)
    Yes '1. a full disk is said in the launcher''s words' ($said -like '*is full*' -and -not $said.Contains($windows))
    Yes '   and with launcher.log pointed nowhere, as the install ran before, nothing is in any log' (-not (Test-Path -LiteralPath $logPath))

    # 2. pointed where Work now points it
    [Thornswood.Probe]::Point($root)
    $said = [Thornswood.Probe]::Copy($dest, $full)
    Yes '2. the same words, and no Windows sentence in them' ($said -like ('the drive ' + $dest + ' is on is full*') -and -not $said.Contains($windows))
    $logged = if (Test-Path -LiteralPath $logPath) { [IO.File]::ReadAllText($logPath) } else { '' }
    Yes '   launcher.log is in the install''s Profile' ($logged.Length -gt 0)
    Yes '   and holds what Windows said and where it happened' ($logged.Contains($windows) -and $logged.Contains('InstallSteps, copying ' + $dest))
} finally {
    [Thornswood.Probe]::Point($null)
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
Done
