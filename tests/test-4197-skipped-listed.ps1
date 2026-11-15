<#
  test-4197-skipped-listed.ps1

      pwsh -NoProfile -File tests/test-4197-skipped-listed.ps1

  Issue #4197. A harness that ran only its SKIP path ended 0, and the run's
  summary counted it with the passed ones: the page said how many checks
  were skipped, never which harness skipped what. So the three native NPC
  harnesses, the fork halves and the gamemode harnesses' plugin halves read
  as passed every night though they checked nothing there.

  scripts\dev\Merge-HarnessReports.ps1 now counts harnesses as well as
  checks, and lists apart from the passed ones each harness that ran nothing
  but SKIP or NOT RUN lines and each that passed with some of them, with the
  lines it skipped. Planted share reports, one harness of each kind:
    1. the count line names how many harnesses failed, passed, passed with
       parts skipped, and ran nothing but skips;
    2. the skip-only harness is listed with its SKIP line;
    3. the harness that passed with a part skipped is listed with it;
    4. a harness that passed whole is in neither list, nor is the failed one;
    5. the -Failed list, for the nightly's failure comment, is unchanged.
  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$merge = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Merge-HarnessReports.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4197-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work 'reports')
    $xml = @'
<?xml version="1.0" encoding="utf-8"?>
<testsuites name="harnesses" tests="8" failures="1" skipped="3" time="4">
  <testsuite name="test-whole.js" tests="2" failures="0" skipped="0" time="1">
    <testcase classname="test-whole.js" name="the forge makes one dagger" />
    <testcase classname="test-whole.js" name="the dagger weighs 4" />
  </testsuite>
  <testsuite name="game/tests/test-npc-native.js" tests="1" failures="0" skipped="1" time="1">
    <testcase classname="game/tests/test-npc-native.js" name="the native check needs a built addon">
      <skipped message="the native check needs a built addon" />
    </testcase>
  </testsuite>
  <testsuite name="test-plugin-half.js" tests="3" failures="0" skipped="2" time="1">
    <testcase classname="test-plugin-half.js" name="the table is sorted" />
    <testcase classname="test-plugin-half.js" name="the plugin half: no Data folder here">
      <skipped message="the plugin half: no Data folder here" />
    </testcase>
    <testcase classname="test-plugin-half.js" name="the fork half: no fork checkout">
      <skipped message="the fork half: no fork checkout" />
    </testcase>
  </testsuite>
  <testsuite name="test-red.ps1" tests="2" failures="1" skipped="0" time="1">
    <testcase classname="test-red.ps1" name="one thing" />
    <testcase classname="test-red.ps1" name="the key is kept">
      <failure message="the key is kept"></failure>
    </testcase>
  </testsuite>
</testsuites>
'@
    [IO.File]::WriteAllText((Join-Path $work 'reports/share.xml'), $xml, (New-Object Text.UTF8Encoding $false))
    $page = Join-Path $work 'page.md'
    $failed = Join-Path $work 'failed.md'
    $null = @(& (Get-Process -Id $PID).Path -NoProfile -File $merge -Path (Join-Path $work 'reports') -Summary $page -Failed $failed 2>&1)
    $md = $(if (Test-Path -LiteralPath $page) { [IO.File]::ReadAllText($page) } else { '' })
    $fl = $(if (Test-Path -LiteralPath $failed) { [IO.File]::ReadAllText($failed) } else { '' })
    $count = ([regex]::Match($md, '(?m)^.*harnesses:.*$')).Value
    Yes ('1. the count line names the harnesses by how they ended (' + $count + ')') (
        $md -match '(?m)^4 harnesses: 1 failed, 1 passed, 1 passed with parts skipped, 1 ran nothing but skips\.\s*$')

    # The two lists, each from its heading to the next heading or the end.
    function Section([string]$text, [string]$head) {
        $m = [regex]::Match($text, '(?ms)^### ' + [regex]::Escape($head) + '\s*$(.*?)(?=^##|\z)')
        if ($m.Success) { return $m.Groups[1].Value }
        return ''
    }
    $only = Section $md 'Ran nothing but skips'
    $part = Section $md 'Passed, with parts skipped'
    Yes '2. the skip-only harness is listed apart, with its SKIP line' (
        $only -match 'game/tests/test-npc-native\.js' -and $only -match 'SKIP  the native check needs a built addon')
    Yes '3. the harness that passed with parts skipped is listed apart, with what it skipped' (
        $part -match 'test-plugin-half\.js' -and $part -match 'SKIP  the plugin half: no Data folder here' -and $part -match 'SKIP  the fork half: no fork checkout')
    Yes '4. a harness that passed whole is in neither list, nor is the failed one' (
        ($only + $part) -notmatch 'test-whole\.js' -and ($only + $part) -notmatch 'test-red\.ps1')
    Yes '5. the failure list for the nightly''s comment names the failed harness and no skipped one' (
        $fl -match 'test-red\.ps1' -and $fl -notmatch 'test-npc-native' -and $fl -notmatch 'test-plugin-half')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
