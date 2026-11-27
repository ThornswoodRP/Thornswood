<#
  test-4290-utc-times.ps1

      pwsh -NoProfile -File .\tests\test-4290-utc-times.ps1

  Issue #4290. GitHub's schedule is in UTC and does not move with daylight
  saving, but nightly.yml, expire-claims.yml and the guide gave the nightly
  checks' time as one Mountain time ("03:00 Mountain", "4:15 AM on the box's
  clock"), which was an hour off from 1 Nov. A Mountain time is two times,
  one for winter (MST, UTC-7) and one for summer (MDT, UTC-6).
  This fails on:
    1. a workflow with a daily cron that names Mountain time without both
       the winter and the summer time of that cron, on the 12-hour clock,
       and the cron's own UTC time;
    2. a workflow that gives a scheduled time "on the box's clock";
    3. the guide's line on the nightly checks not giving the nightly cron's
       UTC time and both its Mountain times.
  Reads the workflows and one guide page. Under a second.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit ([int]($script:fail -gt 0)) }

# A time of day, in minutes past midnight, on the 12-hour clock: 9:00 AM.
function Clock([int]$m) {
    $m = ($m + 1440) % 1440
    $h = [math]::Floor($m / 60); $mm = $m % 60
    $ap = if ($h -lt 12) { 'AM' } else { 'PM' }
    $h12 = $h % 12; if ($h12 -eq 0) { $h12 = 12 }
    return ('{0}:{1:00} {2}' -f $h12, $mm, $ap)
}
# Comments and text only, joined into one line, so a time split over two
# comment lines still reads as one.
function Flat([string]$t) { return (($t -split "`r?`n" | ForEach-Object { ($_ -replace '^\s*#\s?', '').Trim() }) -join ' ') }
function Crons([string]$t) {
    return @([regex]::Matches($t, "cron:\s*'(\d+)\s+(\d+)\s+\*\s+\*\s+\*'") | ForEach-Object { [int]$_.Groups[2].Value * 60 + [int]$_.Groups[1].Value })
}
function Times([int]$c) {
    return [pscustomobject]@{ Utc = (Clock $c) + ' UTC'; Winter = Clock ($c - 420); Summer = Clock ($c - 360) }
}

$flows = Get-ChildItem -LiteralPath ([IO.Path]::Combine($Repo, '.github', 'workflows')) -Filter '*.yml'
Yes 'the workflows folder has workflows' ($flows.Count -gt 0)
$named = 0
foreach ($f in $flows) {
    $raw = [IO.File]::ReadAllText($f.FullName)
    $text = Flat $raw
    Yes ("2. $($f.Name) gives no time on the box's clock") ($text -notmatch "box's clock")
    if ($text -notmatch '\bMountain\b') { continue }
    $crons = Crons $raw
    if ($crons.Count -eq 0) { continue }
    $named++
    foreach ($c in $crons) {
        $t = Times $c
        Yes ("1. $($f.Name) names Mountain time, and gives its cron's $($t.Utc)") ($text.Contains($t.Utc))
        Yes ("   and $($t.Winter) in winter") ($text -match ([regex]::Escape($t.Winter) + '[^.]*\bwinter\b'))
        Yes ("   and $($t.Summer) in summer") ($text -match ([regex]::Escape($t.Summer) + '[^.]*\bsummer\b'))
    }
}
Yes '1. at least one scheduled workflow names Mountain time (nightly.yml)' ($named -ge 1)

$night = Crons ([IO.File]::ReadAllText([IO.Path]::Combine($Repo, '.github', 'workflows', 'nightly.yml')))
Yes 'nightly.yml has one daily cron' ($night.Count -eq 1)
if ($script:fail) { Done }
$t = Times $night[0]
$guide = Flat ([IO.File]::ReadAllText([IO.Path]::Combine($Repo, 'docs', 'guide', 'how-work-moves.md')))
$at = $guide.IndexOf('.github/workflows/nightly.yml')
Yes '3. the guide names nightly.yml' ($at -ge 0)
if ($script:fail) { Done }
$line = $guide.Substring($at, [math]::Min(200, $guide.Length - $at))
Yes ("   with its $($t.Utc)") ($line.Contains($t.Utc))
Yes ("   and $($t.Winter) Mountain in winter") ($line -match ([regex]::Escape($t.Winter) + ' Mountain in winter'))
Yes ("   and $($t.Summer) in summer") ($line -match ([regex]::Escape($t.Summer) + ' in summer'))
Done
