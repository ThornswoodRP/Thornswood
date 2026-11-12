<#
  test-4157-build-headers.ps1

      pwsh -NoProfile -File .\tests\test-4157-build-headers.ps1

  Issue #4157. The headers of build.yml, build-pr.yml and engine.yml and the
  guide's "How work moves" are what a person reads to learn where a build
  runs, which checks main requires, which job runs the tests and when to
  post before a merge, and nothing held them to the settings and the jobs.
  So they kept rules from September after each was replaced: builds on the
  VPS, "nothing is required in GitHub's settings", the harnesses only at
  night, a merge said in #staff-updates first.

  This holds them to what is true:
    1. the checks main's ruleset requires, read from
       records\github-repo-settings.json (the file the box makes GitHub
       match, #3683), are each named in build.yml's header and in the
       guide, and neither says nothing is required;
    2. no build job runs on the box, and build.yml's and engine.yml's
       headers say so, engine.yml's that its fallback to the box went;
    3. build.yml's header names the job that runs the tests on a pull
       request, the gate's shares, and says a pull request runs those its
       change can reach;
    4. one rule for posting before a merge: the guide says a merge gets no
       line in #staff-updates, and no header asks for one.
  Reads the files only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { return ([IO.File]::ReadAllText((Join-Path $Repo $rel)) -replace "`r`n", "`n") }
# A workflow's header: its comment lines before "name:", joined into one
# line of words, so a phrase broken over two lines is still found.
function Header([string]$text) {
    $at = $text.IndexOf("`nname: ")
    $head = $(if ($at -ge 0) { $text.Substring(0, $at) } else { '' })
    return ((($head -split "`n") | ForEach-Object { $_ -replace '^#\s?', '' }) -join ' ') -replace '\s+', ' '
}
function Flat([string]$text) { return ($text -replace '\s+', ' ') }

$build = Text '.github/workflows/build.yml'
$pr = Text '.github/workflows/build-pr.yml'
$engine = Text '.github/workflows/engine.yml'
$guideText = Text 'docs/guide/how-work-moves.md'
$buildHead = Header $build
$prHead = Header $pr
$engineHead = Header $engine
$guide = Flat $guideText
Yes 'the three headers are there' ($buildHead.Length -gt 0 -and $prHead.Length -gt 0 -and $engineHead.Length -gt 0)

# ---- 1. the checks main requires ---------------------------------------------
$settings = (Text 'records/github-repo-settings.json') | ConvertFrom-Json
$main = @(@($settings.repositories | Where-Object { $_.repository -eq 'ThornswoodRP/Thornswood' })[0].rulesets | Where-Object { $_.name -eq 'main' })[0]
$required = @(@($main.rules | Where-Object { $_.type -eq 'required_status_checks' })[0].parameters.required_status_checks | ForEach-Object { $_.context })
Yes ("1. main's ruleset requires checks ({0})" -f ($required -join ', ')) ($required.Count -gt 0)
foreach ($c in $required) {
    Yes ("   build.yml's header names '{0}'" -f $c) ($buildHead.Contains($c))
    Yes ("   the guide names '{0}'" -f $c) ($guide.Contains($c))
}
$nothing = @('nothing is required in GitHub', 'Nothing in GitHub''s settings is required', 'there is no required check', 'named ONE required check')
foreach ($p in $nothing) {
    Yes ("   neither says '{0}'" -f $p) ($buildHead.IndexOf($p, [StringComparison]::OrdinalIgnoreCase) -lt 0 -and $guide.IndexOf($p, [StringComparison]::OrdinalIgnoreCase) -lt 0)
}

# ---- 2. where builds run --------------------------------------------------------
foreach ($f in @(@('build.yml', $build), @('build-pr.yml', $pr), @('engine.yml', $engine))) {
    $runsOn = @([regex]::Matches($f[1], '(?m)^\s+runs-on:\s*(.+)$') | ForEach-Object { $_.Groups[1].Value })
    $box = @($runsOn | Where-Object { $_ -match 'self-hosted|thornswood-vps|BUILD_RUNNER' })
    Yes ("2. {0} runs every job on GitHub's runners ({1} jobs)" -f $f[0], $runsOn.Count) ($runsOn.Count -gt 0 -and $box.Count -eq 0)
}
Yes "   build.yml's header says it runs on GitHub's hosted runners" ($buildHead -match "GitHub's hosted")
$onBox = @('these steps run on the VPS', 'the build check, on the VPS', 'as long as the checks on the VPS')
foreach ($p in $onBox) {
    Yes ("   nothing says '{0}'" -f $p) ($buildHead.IndexOf($p) -lt 0 -and $guide.IndexOf($p) -lt 0)
}
Yes "   engine.yml's header says its fallback to the box went" ($engineHead -match 'fallback went')

# ---- 3. which job runs the tests ------------------------------------------------
Yes "3. build.yml's header names the gate's shares as the job that runs the tests" ($buildHead.Contains('Gate harnesses'))
Yes '   and says a pull request runs those its change can reach' ($buildHead -match 'its change can reach')
Yes '   and does not say the harnesses run only at night' ($buildHead -notmatch 'run every night instead')
Yes "   the guide names the gate's shares too" ($guide.Contains('Gate harnesses (1 of 5)'))

# ---- 4. one rule for posting before a merge -----------------------------------
Yes '4. the guide says a merge gets no line in #staff-updates' ($guide -match 'merge gets no line in #staff-updates')
foreach ($h in @(@('build.yml', $buildHead), @('build-pr.yml', $prHead), @('engine.yml', $engineHead))) {
    Yes ("   {0}'s header asks for no post in #staff-updates before a merge" -f $h[0]) ($h[1] -notmatch 'staff-updates')
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
