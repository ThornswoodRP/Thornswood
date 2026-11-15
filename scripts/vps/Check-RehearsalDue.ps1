<#
.SYNOPSIS
  Says whether the monthly hands-on restore rehearsal is due, from the Last rehearsed line in RESTORING.md in the private ops repo, and fails once it is overdue.

.DESCRIPTION
  Issue #1046. Patrick ruled on 18 October 2026 that the hands-on restore
  rehearsal (restore a backup with Restore-Server.ps1 -Rehearse, start the
  folder, connect, load a character from the backup, delete the folder) runs
  monthly. Before this, nothing recorded when the last one ran in a way
  anything read, and nothing said when one was due (SERVICE-OBJECTIVES.md,
  RTO). The record is the one line people already keep:

      **Last rehearsed: 28 September 2026** (...)

  in docs\RESTORING.md in the private ops repo (#3693), which the ops repo's
  own nightly check runs this against. It is written by hand only after a real run, and
  this script never writes it. It reads that line, exactly once, as a day,
  a month name and a year, and counts the days to -Today.

    ok        exit 0  the last rehearsal is -Days (35) days old or less.
    overdue   exit 1  it is older than that. The nightly checks run this, so
                      an overdue rehearsal opens or adds to the board's
                      "Nightly checks failed" issue until somebody does one
                      and writes the line.
    unread    exit 3  the file is not there, has no such line, has more
                      than one, or the date does not read.

  35 days is a month with a few days' slack, so a rehearsal done on the
  same day each month never shows as overdue. It is a number, -Days, and
  a different cadence is that number and the sentence in RESTORING.md.

  It reads one file and writes nothing. With no -Doc it reads
  docs\RESTORING.md in the ops repo checkout THORNSWOOD_OPS names, or else
  the one beside this checkout as ..\Thornswood-Ops. -Doc and -Today stand
  in for the real ones so scripts\tests\test-1046-rehearsal-due.ps1 can run it
  offline.

  Run by hand from the repository folder:
      .\scripts\vps\Check-RehearsalDue.ps1
#>
param(
  [string]$Doc = '',
  [string]$Today = '',
  [int]$Days = 35
)
$ErrorActionPreference = 'Stop'
if (-not $Doc) {
  $ops = if ($env:THORNSWOOD_OPS) { $env:THORNSWOOD_OPS } else { Join-Path $PSScriptRoot '..\..\..\Thornswood-Ops' }
  $Doc = Join-Path $ops 'docs\RESTORING.md'
}
$inv = [Globalization.CultureInfo]::InvariantCulture

function Unread([string]$why) {
  Write-Host ('rehearsal: ' + $why)
  exit 3
}

if ($Days -lt 1) { Unread ("-Days is {0}; it must be 1 or more" -f $Days) }
if ($Today) {
  $day = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($Today, 'yyyy-MM-dd', $inv, [Globalization.DateTimeStyles]::None, [ref]$day)) {
    Unread ("-Today {0} is not a yyyy-MM-dd date" -f $Today)
  }
  $now = $day.Date
} else {
  $now = (Get-Date).Date
}

if (-not (Test-Path -LiteralPath $Doc)) { Unread ("{0} is not there" -f $Doc) }
$text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Doc).Path)
$found = [regex]::Matches($text, '(?m)^\*\*Last rehearsed: ([^*]+)\*\*')
if ($found.Count -eq 0) { Unread ("{0} has no **Last rehearsed: <date>** line" -f $Doc) }
if ($found.Count -gt 1) { Unread ("{0} has {1} **Last rehearsed** lines; it must have one" -f $Doc, $found.Count) }

$said = $found[0].Groups[1].Value.Trim()
$last = [datetime]::MinValue
if (-not [datetime]::TryParseExact($said, 'd MMMM yyyy', $inv, [Globalization.DateTimeStyles]::None, [ref]$last)) {
  Unread ("Last rehearsed says '{0}', which is not a date like 28 September 2026" -f $said)
}
if ($last.Date -gt $now) { Unread ("Last rehearsed says {0}, which is after today ({1})" -f $said, $now.ToString('d MMMM yyyy', $inv)) }

$age = [int]($now - $last.Date).TotalDays
$due = $last.Date.AddDays($Days)
$dueSaid = $due.ToString('d MMMM yyyy', $inv)
if ($age -le $Days) {
  Write-Host ("rehearsal: ok, last rehearsed {0}, {1} day(s) ago; the next is due by {2} ({3} days)" -f $said, $age, $dueSaid, $Days)
  exit 0
}
Write-Host ("rehearsal: OVERDUE, last rehearsed {0}, {1} day(s) ago, due by {2} ({3} days). Do the hands-on rehearsal in the ops repo's docs\RESTORING.md, 'Rehearsing it', then write the date in its Last rehearsed line." -f $said, $age, $dueSaid, $Days)
exit 1
