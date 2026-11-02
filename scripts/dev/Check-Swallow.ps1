<#
  Check-Swallow.ps1

      .\scripts\dev\Check-Swallow.ps1          compare with the baseline
      .\scripts\dev\Check-Swallow.ps1 -List    print today's numbers in the
                                         baseline's own format

  Counts the silent catches in the launcher and in the PowerShell under
  scripts\ and installer\, file by file, and fails when any file has more than
  scripts\dev\swallow-baseline.txt allows, or fewer than it allows with its
  line not yet lowered.

  THE SCRIPTS TOO, since #2711 (18 Oct). Until then this read launcher\app\*.cs
  and nothing else, so the two empty catches in
  scripts\release\New-ClientBuildRecord.ps1 that let a record be written over
  a base, dirty and stale check that never ran were never counted: no rule
  looked at a .ps1. PSScriptAnalyzer names them (PSAvoidUsingEmptyCatchBlock)
  in the build's lint step, which is warnings only and never fails. A script's
  key in the baseline is its path from the repository root, as
  scripts\release\Feed-Store.ps1; a launcher file's is its name, as Shell.cs.
  A PowerShell catch counts in the same shapes, with its type, or several
  types, in square brackets instead of round ones, as catch
  [System.IO.IOException] followed by braces with nothing but whitespace
  between them, on one line or across several. A body holding only a #
  comment does not count. tests\ is not read: a harness's catches are its own cleanup, and
  a check a harness hides fails the harness, not a release.

  THE SITE, VOICE AND THE BOT TOO, since #2736 (18 Oct). Until then nothing
  read a .js or a .py, so the /api/play/logs handler in site\server.js stored
  a session's logs, answered ok, and lost the session's trouble colour and
  the bot's crash note inside try { ... } catch (e) { } with nothing said.
  The JavaScript under site\ and voice\ and the Python under bot\ are read
  now, keyed by the path from the repository root like a script, as
  site\server.js or bot\bot.py. A JavaScript catch counts in the C# shapes,
  catch (e) and a bare catch, and so does a promise's .catch handed a
  function whose braces hold nothing but whitespace, as .catch(() => { })
  or .catch(function () { }), because that drops the failure the same way.
  A Python except counts when its whole body is pass: except Exception: pass
  on one line, or pass alone on the lines under it. A # comment on the
  except line, beside the pass or in the body says why, and does not count.
  Not read: node_modules (somebody else's packages), a .min.js (a vendored
  library, minified onto one line, such as site\public\marked-12.0.2.min.js),
  __pycache__ and a venv or .venv (the bot's installed packages), and the
  harnesses: everything in a product's own tests folder (voice\tests\,
  bot\tests\, installer\tests\, plan line 42) and any test-* file still
  beside the code, for the same reason tests\ is not read.

  WHY. Entry 239 on the To Do List. Measured on 24 Sep: 386 of the 618 catch
  clauses in launcher\app\*.cs had nothing between their braces, so a failure in
  any of them left no line anywhere. A tester says the Save button did
  nothing, and launcher.log cannot say why, because nothing was written. The
  entry counted 367, then 373, then 386 while it sat on the list, which is why
  this is a rule with a frozen baseline and not a clean up somebody has to
  remember.

  THE RULE is written out at the top of swallow-baseline.txt. In short: a
  catch counts when its body holds nothing but whitespace, on one line or
  across several, and a body holding only a comment does not count.

  WHEN IT FAILS. Put Swallow.Note("Class.Method", ex) in the new catch
  (launcher\app\Swallow.cs), which writes one line to launcher.log, touches no
  control and never throws. In a script, let the error stop the script, or
  catch it to say what could not be done and stop. If nothing should be done
  and nothing should be logged, say why in a comment inside the braces.
  Raising a number in the baseline is a decision for Patrick, not a fix.

  WHEN A NUMBER GOES DOWN this is red too, until that file's line in the
  baseline is lowered to what the file now holds. Issue #756. A fall used to
  print a yellow line and pass, which meant the lowering the rule asks for
  could be left for somebody else: Checks.cs and Verify.cs each sat a catch
  above their real count from #706 and #709 until the two lines were found by
  eye and lowered in #753. Red puts the lowering in the pull request that made
  the count fall, where it belongs, and the number cannot creep back up.
  Lowering a line is not a decision anybody has to take: the file already
  holds fewer, and -List prints the numbers in the baseline's own format.

  Read only. Exits 1 when any file rose, when a file fell and its line has not
  been lowered, or when the baseline cannot be read, and 0 otherwise.
  build.yml runs it on every pull request.
#>
[CmdletBinding()]
param(
  [string]$AppDir,
  [string]$Baseline,
  # Folders whose .ps1 and .psm1 files are counted, every level down. Default:
  # scripts\ and installer\. A script is keyed by its path from -Root.
  [string[]]$ScriptDirs,
  # Folders whose .js, .mjs and .cjs files are counted, every level down
  # (#2736). Default: site\ and voice\. Keyed by the path from -Root.
  [string[]]$JsDirs,
  # Folders whose .py files are counted, every level down (#2736). Default:
  # bot\. Keyed by the path from -Root.
  [string[]]$PyDirs,
  [string]$Root,
  [switch]$List
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root)     { $Root     = Join-Path $Here '..\..' }
$Root = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not $AppDir)   { $AppDir   = Join-Path $Root 'launcher\app' }
if (-not $Baseline) { $Baseline = Join-Path $Here 'swallow-baseline.txt' }
if (-not $PSBoundParameters.ContainsKey('ScriptDirs')) { $ScriptDirs = @((Join-Path $Root 'scripts'), (Join-Path $Root 'installer')) }
if (-not $PSBoundParameters.ContainsKey('JsDirs')) { $JsDirs = @((Join-Path $Root 'site'), (Join-Path $Root 'voice')) }
if (-not $PSBoundParameters.ContainsKey('PyDirs')) { $PyDirs = @((Join-Path $Root 'bot')) }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

if (-not (Test-Path -LiteralPath $AppDir)) { Say "  no app folder at $AppDir" 'Red'; exit 1 }
foreach ($d in (@($ScriptDirs) + @($JsDirs) + @($PyDirs))) {
  if (-not (Test-Path -LiteralPath $d -PathType Container)) { Say "  no source folder at $d" 'Red'; exit 1 }
}

# The rule as a pattern. \s takes new lines as well as spaces, so a catch whose
# braces sit on lines of their own counts the same as one written on one line.
# A comment inside the braces is not whitespace, so it stops the match, which
# is the rule's one exception. The optional brackets take catch (IOException)
# and catch (Exception ex) alike. PowerShell names the type in square
# brackets, one or more, comma separated: catch [System.IO.IOException].
$Silent = [regex]'\bcatch\s*(\([^)]*\))?\s*\{\s*\}'
$SilentPs = [regex]'\bcatch\s*(\[[^\]\r\n]*\]\s*(,\s*\[[^\]\r\n]*\]\s*)*)?\{\s*\}'
# JavaScript (#2736): the C# shape, kept off a promise's .catch by the look
# behind, and a promise's .catch handed an arrow or a function with nothing
# between its braces, as .catch(() => { }), .catch((e) => {}), .catch(e => {})
# or .catch(function () { }).
$SilentJs = [regex]('(?<![.\w$])catch\s*(\([^)]*\))?\s*\{\s*\}' +
  '|\.catch\(\s*(?:async\s+)?(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*\{\s*\}\s*\)' +
  '|\.catch\(\s*(?:async\s+)?function\b[\w$\s]*\([^)]*\)\s*\{\s*\}\s*\)')
# Python (#2736): the except line, its indent, and what follows its colon.
$PyExcept = [regex]'^(?<ind>[ \t]*)except\b(?<head>[^#\r\n]*?):(?<rest>.*)$'
$NewLine = [regex]'\n'

# Key to the line numbers of its silent catches: every .cs file by its name,
# every script by its path from -Root.
$found = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
$paths = @{}
function Find-Silent([string]$full, [regex]$rule) {
  $text = [IO.File]::ReadAllText($full)
  $at = New-Object 'System.Collections.Generic.List[int]'
  $line = 1; $from = 0
  foreach ($m in $rule.Matches($text)) {
    $line += $NewLine.Matches($text.Substring($from, $m.Index - $from)).Count
    $from = $m.Index
    $at.Add($line)
  }
  return , $at
}
# A Python except whose whole body is pass, by its line number. Read line by
# line, because the body is whatever sits indented under the except: pass on
# the except line itself, or the lines below it down to the first one that
# is not indented past it. A # comment on the except line, beside the pass or
# on a line of the body is somebody saying why, and stops it counting.
function Find-SilentPy([string]$full) {
  $lines = [IO.File]::ReadAllLines($full)
  $at = New-Object 'System.Collections.Generic.List[int]'
  for ($i = 0; $i -lt $lines.Length; $i++) {
    $m = $PyExcept.Match($lines[$i])
    if (-not $m.Success) { continue }
    $rest = $m.Groups['rest'].Value.Trim()
    if ($rest) {
      if ($rest -eq 'pass') { $at.Add($i + 1) }
      continue
    }
    $ind = $m.Groups['ind'].Value.Length
    $body = New-Object 'System.Collections.Generic.List[string]'
    $said = $false
    for ($j = $i + 1; $j -lt $lines.Length; $j++) {
      $t = $lines[$j].TrimStart()
      if (-not $t.Trim()) { continue }
      $lead = $lines[$j].Length - $t.Length
      if ($t.StartsWith('#')) { if ($lead -gt $ind) { $said = $true }; continue }
      if ($lead -le $ind) { break }
      $body.Add($t.Trim())
      if ($body.Count -gt 1) { break }
    }
    if (-not $said -and $body.Count -eq 1 -and $body[0] -eq 'pass') { $at.Add($i + 1) }
  }
  return , $at
}
# A file's key in the baseline is its path from -Root, for the scripts, the
# site, voice and the bot alike, written with \ on any machine, as the
# baseline writes it.
$Sep = [IO.Path]::DirectorySeparatorChar
function Key-Of($f) {
  if (-not $f.FullName.StartsWith($Root + $Sep, [StringComparison]::OrdinalIgnoreCase)) {
    Say "  $($f.FullName) is not under $Root, so it has no key in the baseline" 'Red'; exit 1
  }
  return $f.FullName.Substring($Root.Length + 1).Replace($Sep, '\')
}
# What is never read under site\, voice\ and bot\, by its path below the
# folder named: other people's packages, a vendored minified library, and a
# harness kept beside the code (the header says why for each).
function Skip-Source($f, [string]$dir) {
  $below = '\' + $f.FullName.Substring($dir.TrimEnd($Sep).Length + 1).Replace($Sep, '\')
  if ($below -match '\\(node_modules|__pycache__|venv|\.venv)\\') { return $true }
  # A product's harnesses in its own tests folder (plan line 42), for the
  # same reason tests\ is not read.
  if ($below -match '^\\tests\\') { return $true }
  if ($f.Name -like '*.min.js') { return $true }
  if ($f.Name -like 'test-*') { return $true }
  return $false
}
foreach ($f in @(Get-ChildItem -LiteralPath $AppDir -Filter '*.cs' -File | Sort-Object Name)) {
  $found[$f.Name] = (Find-Silent $f.FullName $Silent)
  $paths[$f.Name] = $f.FullName
}
foreach ($d in @($ScriptDirs)) {
  $full = [IO.Path]::GetFullPath($d)
  foreach ($f in @(Get-ChildItem -LiteralPath $full -Recurse -File | Where-Object { $_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1' } | Sort-Object FullName)) {
    if ((Split-Path -Leaf (Split-Path -Parent $f.FullName)) -eq 'tests' -and (Skip-Source $f $full)) { continue }
    $key = Key-Of $f
    $found[$key] = (Find-Silent $f.FullName $SilentPs)
    $paths[$key] = $f.FullName
  }
}
foreach ($d in @($JsDirs)) {
  $full = [IO.Path]::GetFullPath($d)
  foreach ($f in @(Get-ChildItem -LiteralPath $full -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs', '.cjs' } | Sort-Object FullName)) {
    if (Skip-Source $f $full) { continue }
    $key = Key-Of $f
    $found[$key] = (Find-Silent $f.FullName $SilentJs)
    $paths[$key] = $f.FullName
  }
}
foreach ($d in @($PyDirs)) {
  $full = [IO.Path]::GetFullPath($d)
  foreach ($f in @(Get-ChildItem -LiteralPath $full -Recurse -File | Where-Object { $_.Extension -eq '.py' } | Sort-Object FullName)) {
    if (Skip-Source $f $full) { continue }
    $key = Key-Of $f
    $found[$key] = (Find-SilentPy $f.FullName)
    $paths[$key] = $f.FullName
  }
}

if ($List) {
  foreach ($name in @($found.Keys | Sort-Object)) {
    if ($found[$name].Count -gt 0) { Write-Host ("{0} {1}" -f $name, $found[$name].Count) }
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $Baseline)) { Say "  no baseline at $Baseline" 'Red'; exit 1 }

# One file name and one number a line. Anything starting with # is the rule
# and the reasons, and is skipped. A line that is neither is refused rather
# than skipped, because a baseline that reads as all zeroes fails every file
# and one that reads a typo as a big number hides a rise.
$allowed = New-Object 'System.Collections.Generic.Dictionary[string,int]' ([StringComparer]::OrdinalIgnoreCase)
$n = 0
foreach ($l in @(Get-Content -LiteralPath $Baseline)) {
  $n++
  $t = "$l".Trim()
  if (-not $t -or $t.StartsWith('#')) { continue }
  $mm = [regex]::Match($t, '^(\S+)\s+(\d+)$')
  if (-not $mm.Success) { Say ("  line {0} of the baseline is not a file name and a number: {1}" -f $n, $t) 'Red'; exit 1 }
  $allowed[$mm.Groups[1].Value] = [int]$mm.Groups[2].Value
}

Write-Host ''
Write-Host '  THORNSWOOD  -  silent catches in the launcher, the scripts, the site, voice and the bot' -ForegroundColor White

$rose = 0; $fell = 0; $total = 0; $cap = 0
foreach ($v in $allowed.Values) { $cap += $v }
foreach ($name in @($found.Keys | Sort-Object)) {
  $now = $found[$name].Count
  $total += $now
  $may = 0
  if ($allowed.ContainsKey($name)) { $may = $allowed[$name] }
  if ($now -gt $may) {
    $rose++
    $where = ($found[$name] | ForEach-Object { "$_" }) -join ', '
    Say ("  NEW   {0} has {1} silent catches and the baseline allows {2}. They are on lines {3}." -f $name, $now, $may, $where) 'Red'
    if ($env:GITHUB_ACTIONS -eq 'true') {
      Write-Host ("::error file={0}::{1} has {2} silent catches and swallow-baseline.txt allows {3}. Log the new one with Swallow.Note; in a script let the error stop it; in the site, voice or the bot say what failed in its log." -f $paths[$name], $name, $now, $may)
    }
  } elseif ($now -lt $may) {
    $fell++
    Say ("  DOWN  {0} is at {1} and the baseline says {2}. Lower its line in swallow-baseline.txt to {1}." -f $name, $now, $may) 'Red'
    if ($env:GITHUB_ACTIONS -eq 'true') {
      Write-Host ("::error file={0}::{1} is at {2} and swallow-baseline.txt allows {3}. Lower its line to {2} in this pull request." -f $paths[$name], $name, $now, $may)
    }
  }
}
foreach ($name in @($allowed.Keys | Sort-Object)) {
  if (-not $found.ContainsKey($name) -and $allowed[$name] -gt 0) {
    $fell++
    Say ("  GONE  {0} is in the baseline and not among the files this reads. Take its line out." -f $name) 'Red'
    if ($env:GITHUB_ACTIONS -eq 'true') {
      Write-Host ("::error file={0}::{1} is in swallow-baseline.txt and not among the files Check-Swallow reads any more. Take its line out in this pull request." -f $Baseline, $name)
    }
  }
}

Write-Host ''
Say ("  {0} silent catches in {1} source files; the baseline allows {2}." -f $total, $found.Count, $cap)
if ($rose) {
  Say ("  {0} file(s) have more than the baseline allows. Log the new catch with" -f $rose) 'Red'
  Say '  Swallow.Note (in a script, let the error stop it; in the site, voice or' 'Red'
  Say '  the bot, say what failed in its log), or say why in a comment inside' 'Red'
  Say '  its braces, or on the except line.' 'Red'
}
if ($fell) {
  Say ("  {0} line(s) in the baseline stand above what the files hold. Put them" -f $fell) 'Red'
  Say '  right in this pull request, where the count fell: .\scripts\dev\Check-Swallow.ps1 -List' 'Red'
  Say '  prints every number in the baseline''s own format.' 'Red'
}
if ($rose -or $fell) { exit 1 }
Say '  Nothing rose, and the baseline matches.' 'Green'
exit 0
