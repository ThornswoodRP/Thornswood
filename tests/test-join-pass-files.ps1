<#
  test-join-pass-files.ps1

      pwsh -NoProfile -File .\tests\test-join-pass-files.ps1

  The join pass files, run (#5689, part of #4351). launcher\app\JoinPass.cs
  leaves the pass the site signed in Game\Data\Platform\thornswood-pass.txt
  and the pass's own key beside it in thornswood-pass-key.txt, renews them
  every minute while the game runs, and deletes both when a new Play starts.
  The front plugin reads them and the game server ends any session without a
  good pass (#937, #1320). tests\test-join-pass-launcher.ps1 reads that file
  as text; this one compiles it and runs it.

  HOW. It builds the shipped launcher\app\JoinPass.cs with the .NET SDK the
  launcher builds with (Add-LauncherType, tests\Launcher-Csc.ps1), with
  stand-ins for the three things it calls: Paths.Game (a scratch folder),
  Discord.Pass (answers the harness sets, so nothing reaches the site) and
  Swallow.Note (kept in a list). It sets the picked character and calls
  Fetch, the step Tick hands to the pool, directly, so every case runs in
  order on this thread.

  WHAT IT CHECKS, on a scratch Game folder:
    A  a pass with a key: the pass file is the pass, the key file is the
       pass's signature, a space, then the key, and the log line says so once
    B  the next pass has no key: the key file goes, so no old key is paired
       with the new pass
    C  a refusal leaves the files as they are and is said once, and said
       again only when the site's reason changes
    D  a pass for a character no longer picked writes nothing
    E  Forget deletes both files, and a pass after it is said again
    F  a write that fails is noted, and no "got the pass" line is said
    G  no pass is ever in a line said or noted

  THE CHECKS BITE. The same build carries five copies of JoinPass.cs, each
  with one thing broken, every one in a namespace of its own with its own
  stand-ins: the old key kept, the key left by Forget, a pass written for a
  character no longer picked, a refusal said every minute, and the key named
  by the wrong part of the pass. Each must fail at least one of A to G, and
  each break must still find its text in JoinPass.cs, so a change there
  that moves the text says so here instead of passing quietly. One build for
  all six, so the gate pays for one compile.

  Writes only under its own temp folder, and the build under out\harness,
  which git ignores. Never connects to anything.
#>
[CmdletBinding()]
param([string]$AppPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $AppPath) { $AppPath = Join-Path $Repo (Join-Path 'launcher' 'app') }

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

$src = Join-Path $AppPath 'JoinPass.cs'
Yes 'launcher\app\JoinPass.cs is there' (Test-Path -LiteralPath $src)
if (-not (Test-Path -LiteralPath $src)) { Done }
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# ---- the stand-ins, one set for each namespace -------------------------------
function StandIns([string]$ns) {
    return @"
namespace $ns
{
    public static class Paths { public static string Game = ""; }
    public static class Discord
    {
        public static string NextPass = "", NextKey = "", NextWhy = "";
        public static string Pass(int profileId, out string key, out string why)
        {
            key = NextKey; why = NextWhy; return NextPass;
        }
    }
    public static class Swallow
    {
        public static readonly System.Collections.Generic.List<string> Notes = new System.Collections.Generic.List<string>();
        public static void Note(string where, System.Exception ex) { Notes.Add(where + ": " + ex.GetType().Name + ": " + ex.Message); }
    }
}
"@
}

# ---- the five breaks ---------------------------------------------------------
# Each: what it breaks, the text in JoinPass.cs, and what goes in its place.
$real = [IO.File]::ReadAllText($src)
$breaks = [ordered]@{
    'M1' = @('a pass without a key keeps the old key', 'else if (File.Exists(KeyPath)) File.Delete(KeyPath);', ';')
    'M2' = @('Forget leaves the key', 'try { if (File.Exists(KeyPath)) File.Delete(KeyPath); }', 'try { }')
    'M3' = @('a pass is written for a character no longer picked', 'if (id != profile) return;', '')
    'M4' = @('a refusal is said every minute', 'if (why != lastWhy)', 'if (why == why)')
    'M5' = @('the key is named by the wrong part of the pass', "pass.Substring(pass.LastIndexOf('.') + 1)", "pass.Substring(pass.IndexOf('.') + 1)")
}
$sources = @((StandIns 'Thornswood'))
foreach ($id in $breaks.Keys) {
    $b = $breaks[$id]
    $found = $real.Contains($b[1])
    Yes ("the break '" + $b[0] + "' still finds its text in JoinPass.cs") $found
    if (-not $found) { continue }
    $sources += (StandIns ('JoinPass' + $id))
    $sources += $real.Replace($b[1], $b[2]).Replace('namespace Thornswood', 'namespace JoinPass' + $id)
}

$asm = $null
try { $asm = Add-LauncherType -File $src -Source $sources } catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'JoinPass.cs builds with its stand-ins, the way the project builds it' ($null -ne $asm)
if ($null -eq $asm) { Done }

$any = [Reflection.BindingFlags]'Static, Public, NonPublic'

# ---- A to G against one namespace; gives back the cases that failed ---------
function Run-Cases([string]$ns, [string]$work) {
    $jp = $asm.GetType($ns + '.JoinPass', $true)
    $paths = $asm.GetType($ns + '.Paths', $true)
    $site = $asm.GetType($ns + '.Discord', $true)
    $sw = $asm.GetType($ns + '.Swallow', $true)
    $game = Join-Path $work $ns
    [void][IO.Directory]::CreateDirectory($game)
    $paths.GetField('Game').SetValue($null, $game)
    # Read from the class itself, so the paths are the ones it writes.
    $passFile = [string]$jp.GetProperty('FilePath', $any).GetValue($null)
    $keyFile = [string]$jp.GetProperty('KeyPath', $any).GetValue($null)
    $fetch = $jp.GetMethod('Fetch', $any)
    $forget = $jp.GetMethod('Forget', $any)
    $picked = $jp.GetField('profile', $any)
    $notes = $sw.GetField('Notes').GetValue($null)
    $said = New-Object System.Collections.Generic.List[string]
    $say = [Action[string]]({ param($l) $said.Add($l) }.GetNewClosure())
    $failed = New-Object System.Collections.Generic.List[string]

    function Answer([string]$p, [string]$k, [string]$w) {
        $site.GetField('NextPass').SetValue($null, $p)
        $site.GetField('NextKey').SetValue($null, $k)
        $site.GetField('NextWhy').SetValue($null, $w)
    }
    function Pick([int]$id) { $picked.SetValue($null, $id) }
    function Fetch([int]$id) { [void]$fetch.Invoke($null, [object[]]@($id, $say)) }
    function Forget { [void]$forget.Invoke($null, [object[]]@()) }
    function Text([string]$p) { if ([IO.File]::Exists($p)) { return [IO.File]::ReadAllText($p) } return $null }
    function Case([string]$name, [bool]$ok) { if (-not $ok) { $failed.Add($name) } }

    $key = 'k' * 24
    $passes = @('jp1.eyJwIjo3fQ.SIGONE', 'jp1.eyJwIjo3LCJuIjoyfQ.SIGTWO', 'jp1.eyJwIjo4fQ.SIGEIGHT', 'jp1.eyJwIjo3LCJuIjozfQ.SIGTHREE', 'jp1.eyJwIjo3LCJuIjo0fQ.SIGFOUR')

    # A: a pass with a key.
    Pick 7
    Answer $passes[0] $key ''
    Fetch 7
    Case 'A the pass file holds the pass' ((Text $passFile) -ceq $passes[0])
    Case 'A the key file holds the pass''s signature, a space, then the key' ((Text $keyFile) -ceq ('SIGONE ' + $key))
    Case 'A the pass is said once, for that character' ($said.Count -eq 1 -and $said[0] -ceq 'Got the join pass for character 7.')

    # B: the next pass has no key.
    Answer $passes[1] '' ''
    Fetch 7
    Case 'B the pass file holds the new pass' ((Text $passFile) -ceq $passes[1])
    Case 'B the old key is gone, so it is never paired with the new pass' (-not [IO.File]::Exists($keyFile))
    Case 'B a renewal says nothing' ($said.Count -eq 1)

    # C: refusals.
    Answer '' '' 'Link Discord first.'
    Fetch 7
    Case 'C a refusal leaves the pass file as it was' ((Text $passFile) -ceq $passes[1])
    Case 'C a refusal is said with the site''s reason' ($said.Count -eq 2 -and $said[1] -ceq 'No join pass for character 7, so the server will end this session: Link Discord first.')
    Fetch 7
    Case 'C the same refusal a minute later is not said again' ($said.Count -eq 2)
    Answer '' '' 'The site is down.'
    Fetch 7
    Case 'C a new reason is said' ($said.Count -eq 3 -and $said[2].EndsWith('The site is down.'))

    # D: a pass for a character no longer picked.
    Answer $passes[2] $key ''
    Fetch 8
    Case 'D a pass for a character no longer picked writes nothing' ((Text $passFile) -ceq $passes[1] -and -not [IO.File]::Exists($keyFile))
    Case 'D and says nothing' ($said.Count -eq 3)

    # E: Forget, then a pass again.
    Answer $passes[3] $key ''
    Fetch 7
    Case 'E (a pass with a key is back)' ([IO.File]::Exists($passFile) -and [IO.File]::Exists($keyFile))
    Forget
    Case 'E Forget deletes the pass file' (-not [IO.File]::Exists($passFile))
    Case 'E Forget deletes the key file' (-not [IO.File]::Exists($keyFile))
    Fetch 7
    Case 'E after Forget nothing is fetched for the last character' (-not [IO.File]::Exists($passFile))
    $before = $said.Count
    Pick 7
    Fetch 7
    Case 'E a pass after Forget is said again' ($said.Count -eq $before + 1 -and $said[$said.Count - 1] -ceq 'Got the join pass for character 7.')

    # F: a write that fails: a folder where the pass file goes.
    Forget
    [void][IO.Directory]::CreateDirectory($passFile)
    Pick 7
    $before = $said.Count
    Answer $passes[4] '' ''
    Fetch 7
    Case 'F a write that fails is noted' (@($notes | Where-Object { $_.StartsWith('JoinPass.Fetch, write: ') }).Count -eq 1)
    Case 'F and no line says the pass was got' ($said.Count -eq $before)
    [IO.Directory]::Delete($passFile)

    # G: no pass, and no pass's signature, in anything said or noted.
    $leak = @(@($said) + @($notes) | Where-Object { $l = $_; @($passes | Where-Object { $l.Contains($_) -or $l.Contains($_.Substring($_.LastIndexOf('.') + 1)) }).Count -gt 0 })
    Case 'G no pass or signature is in a line said or noted' ($leak.Count -eq 0)

    return ,$failed
}

$cases = @('A the pass file holds the pass', 'A the key file holds the pass''s signature, a space, then the key', 'A the pass is said once, for that character',
    'B the pass file holds the new pass', 'B the old key is gone, so it is never paired with the new pass', 'B a renewal says nothing',
    'C a refusal leaves the pass file as it was', 'C a refusal is said with the site''s reason', 'C the same refusal a minute later is not said again', 'C a new reason is said',
    'D a pass for a character no longer picked writes nothing', 'D and says nothing',
    'E (a pass with a key is back)', 'E Forget deletes the pass file', 'E Forget deletes the key file', 'E after Forget nothing is fetched for the last character', 'E a pass after Forget is said again',
    'F a write that fails is noted', 'F and no line says the pass was got',
    'G no pass or signature is in a line said or noted')

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-join-pass-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($work)
try {
    $failed = Run-Cases 'Thornswood' $work
    foreach ($c in $cases) { Yes $c (-not $failed.Contains($c)) }
    foreach ($c in $failed) { if ($cases -notcontains $c) { Yes ('a case the list above does not name: ' + $c) $false } }

    Write-Host ''
    Write-Host 'each copy with one thing broken fails'
    foreach ($id in $breaks.Keys) {
        if (-not $real.Contains($breaks[$id][1])) { continue }
        $f = Run-Cases ('JoinPass' + $id) $work
        Yes ('  ' + $breaks[$id][0] + ': ' + $(if ($f.Count) { $f -join '; ' } else { 'nothing failed' })) ($f.Count -gt 0)
    }
}
finally {
    try { [IO.Directory]::Delete($work, $true) } catch { Write-Host ('      the scratch folder ' + $work + ' was left: ' + $_.Exception.Message) }
}
Done
