<#
  test-6230-session-logs.ps1

      pwsh -NoProfile -File .\tests\test-6230-session-logs.ps1

  WHY THIS EXISTS. Issue #6230. The logs a launcher sends at game close are
  kept on the box (C:\Thornswood-Docs\data\session-logs) and no gate verb
  read them, so a cloud thread checking a playtest report (#6723, a trade's
  giver) had to start a session on One to open one. scripts\vps\
  Read-SessionLogs.ps1 is that verb: it writes one session's logs, or every
  game one profile played on one day, as files into the gate's out folder.

  What it checks:
    1. the reader's words are the site's: the folder and sessions.json it
       reads, a set's shape (session, who, at, logs), the session id rule and
       the log names the site keeps; and the gate takes the verb as one that
       only reads, with -Session, -Profile and -Day and its own out folder;
    2. the reader, run against sets and rows made here: by -Session it writes
       every log of that set as its own file and prints the set's row and
       line counts, and nothing from inside a log; by -Profile and -Day it
       writes the sets of that profile on that day, found by the account, the
       row's profile or the characters played, and leaves out another
       profile's set and a set of another day; a set that will not read is
       counted and passed over; a name the site does not keep is never made
       into a file; and it stops on a line it does not take, a missing
       folder, a missing session and a day with nothing.

  Nothing connects anywhere. Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$reader = Join-Path $repo 'scripts/vps/Read-SessionLogs.ps1'
$readerText = [IO.File]::ReadAllText($reader)

# ---- 1. the words ---------------------------------------------------------------------
Write-Host 'the words'
$sessions = [IO.File]::ReadAllText((Join-Path $repo 'site/lib/sessions.js'))
Yes 'the site keeps the sets in data\session-logs and the rows in data\sessions.json' (
    $sessions.Contains("const SLOGS = path.join(DATA, 'session-logs');") -and
    $sessions.Contains("const SESSIONS = path.join(DATA, 'sessions.json');") -and
    $readerText.Contains("'C:\Thornswood-Docs\data\session-logs'") -and $readerText.Contains("'C:\Thornswood-Docs\data\sessions.json'"))
Yes 'a set is { session, who, at, bytes, logs } and its file carries its own time' (
    $sessions -match 'session: key,\s+who: String\(who\),' -and $sessions -match 'at: Date\.now\(\),\s+bytes: total,' -and
    $sessions.Contains('fs.utimesSync(file, new Date(at), new Date(at));'))
Yes 'the session id rule is the site''s: 8 to 64 letters, digits and hyphens' (
    $sessions.Contains(".replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);") -and $sessions.Contains('return s.length >= 8 ? s :') -and
    $readerText.Contains("`$KeyRule = '^[A-Za-z0-9-]{8,64}$'"))
$m = [regex]::Match($sessions, 'const SLOG_NAMES = \[([^\]]*)\]')
$siteNames = @([regex]::Matches($m.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
$n = [regex]::Match($readerText, '\$Names = @\(([^)]*)\)')
$readerNames = @([regex]::Matches($n.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
Yes 'the log names are the site''s SLOG_NAMES, all of them' ($siteNames.Count -ge 9 -and (($siteNames -join ',') -eq ($readerNames -join ',')))
$verbs = [IO.File]::ReadAllText((Join-Path $repo 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
$verb = $verbs.verbs.PSObject.Properties['Read-SessionLogs']
Yes 'the gate runs it as a verb that only reads, with -Session, -Profile, -Day and its own out folder' (
    $null -ne $verb -and $verb.Value.script -eq 'scripts/vps/Read-SessionLogs.ps1' -and $verb.Value.onlyReads -eq $true -and
    $verb.Value.out -eq '-Out' -and (@($verb.Value.params.PSObject.Properties.Name) -join ',') -eq 'Session,Profile,Day')
Yes 'the gate''s session rule is the reader''s' ($null -ne $verb -and $verb.Value.params.Session -eq '^[A-Za-z0-9-]{8,64}$')

# ---- 2. the reader --------------------------------------------------------------------
Write-Host ''
Write-Host 'the reader'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('test-6230-' + [guid]::NewGuid().ToString('N'))
$logs = Join-Path $tmp 'session-logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$rows = Join-Path $tmp 'sessions.json'

function Ms([datetime]$t) { [DateTimeOffset]::new($t).ToUnixTimeMilliseconds() }
$day = (Get-Date).Date.AddDays(-3)
$dayText = $day.ToString('yyyy-MM-dd')
function PutSet([string]$key, [string]$who, [datetime]$at, $logsObj) {
    $file = Join-Path $logs ($key + '.json')
    $set = [ordered]@{ session = $key; who = $who; at = (Ms $at); bytes = 10; logs = $logsObj }
    [IO.File]::WriteAllText($file, ($set | ConvertTo-Json -Depth 5))
    (Get-Item -LiteralPath $file).LastWriteTime = $at
}
$secret = 'INSIDE-A-LOG-' + [guid]::NewGuid().ToString('N')
PutSet 'aaaaaaaa1111' '1135382718' $day.AddHours(18.6) ([ordered]@{
    'skyrim-platform.log' = "line one $secret`nremoveInventoryItems(14, 3eadf, 2, [], 0)`nline three"
    'launcher.log'        = 'launcher line'
    '..\evil.log'         = 'should never be a file' })
PutSet 'bbbbbbbb2222' '555' $day.AddHours(19) ([ordered]@{ 'skyrim-platform.log' = 'played as the profile' })
PutSet 'cccccccc3333' '777' $day.AddHours(20) ([ordered]@{ 'skyrim-platform.log' = 'another profile' })
PutSet 'dddddddd4444' '1135382718' $day.AddDays(-1).AddHours(12) ([ordered]@{ 'skyrim-platform.log' = 'another day' })
$badFile = Join-Path $logs 'eeeeeeee5555.json'
[IO.File]::WriteAllText($badFile, '{ not json')
(Get-Item -LiteralPath $badFile).LastWriteTime = $day.AddHours(21)
$rowsList = @(
    [ordered]@{ session = 'aaaaaaaa1111'; who = '1135382718'; profile = 1135382718; channel = 'main'; version = '1.3.115'
        start = (Ms $day.AddHours(18)); end = (Ms $day.AddHours(18.6)); minutes = 36; why = 'quit' },
    [ordered]@{ session = 'bbbbbbbb2222'; who = '555'; profile = 999; profiles = @(999, 1135382718); channel = 'dev'
        start = (Ms $day.AddHours(18.7)); end = (Ms $day.AddHours(19)); minutes = 18; why = 'quit' }
)
[IO.File]::WriteAllText($rows, (ConvertTo-Json -InputObject $rowsList -Depth 5))

function Run([string[]]$extra) {
    $out = Join-Path $tmp ('out-' + [guid]::NewGuid().ToString('N'))
    $args2 = @('-NoProfile', '-File', $reader, '-Folder', $logs, '-Rows', $rows, '-Out', $out) + $extra
    $text = (& pwsh @args2 2>&1 | Out-String)
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = $text; Out = $out }
}

$r = Run @('-Session', 'aaaaaaaa1111')
$plat = Join-Path $r.Out 'aaaaaaaa1111/skyrim-platform.log'
Yes 'by -Session it exits 0' ($r.Code -eq 0)
Yes 'by -Session it writes each kept log as its own file, whole' ((Test-Path -LiteralPath $plat) -and
    ([IO.File]::ReadAllText($plat)).Contains('removeInventoryItems(14, 3eadf, 2, [], 0)') -and
    (Test-Path -LiteralPath (Join-Path $r.Out 'aaaaaaaa1111/launcher.log')))
Yes 'it prints the set''s row and each log''s line count' ($r.Text.Contains('row: main server, version 1.3.115') -and
    $r.Text.Contains('36 minute(s), ended by quit, profile 1135382718') -and $r.Text.Contains('skyrim-platform.log: 3 line(s)'))
Yes 'it prints nothing from inside a log' (-not $r.Text.Contains($secret) -and -not $r.Text.Contains('removeInventoryItems'))
Yes 'a name the site does not keep is never made into a file' ($r.Text.Contains('not a name the site keeps') -and
    @(Get-ChildItem -LiteralPath $r.Out -Recurse -File | Where-Object { $_.Name -like '*evil*' }).Count -eq 0 -and
    -not (Test-Path -LiteralPath (Join-Path $tmp 'evil.log')))

$r = Run @('-Profile', '1135382718', '-Day', $dayText)
Yes 'by -Profile and -Day it exits 0' ($r.Code -eq 0)
Yes 'it takes the profile''s own set and the set where the profile was played' (
    (Test-Path -LiteralPath (Join-Path $r.Out 'aaaaaaaa1111/skyrim-platform.log')) -and
    (Test-Path -LiteralPath (Join-Path $r.Out 'bbbbbbbb2222/skyrim-platform.log')) -and $r.Text.Contains('played 999 1135382718'))
Yes 'it leaves out another profile''s set and a set of another day' (
    -not (Test-Path -LiteralPath (Join-Path $r.Out 'cccccccc3333')) -and -not (Test-Path -LiteralPath (Join-Path $r.Out 'dddddddd4444')))
Yes 'a set that will not read is counted and passed over' ($r.Text.Contains('1 set(s) that day would not read') -and $r.Text.Contains('2 set(s) written'))

$r = Run @('-Profile', '1135382718', '-Day', $day.AddDays(-5).ToString('yyyy-MM-dd'))
Yes 'a day with nothing exits 1 and says so' ($r.Code -eq 1 -and $r.Text.Contains('No set matched'))
$r = Run @('-Session', 'zzzzzzzz9999')
Yes 'a session with no set exits 1 and says so' ($r.Code -eq 1 -and $r.Text.Contains('No set for session zzzzzzzz9999'))
$r = Run @('-Session', '..\..\x')
Yes 'a session id the site would not make is refused' ($r.Code -eq 1 -and $r.Text.Contains('is not a session id'))
$r = Run @('-Profile', '1135382718')
Yes 'a profile with no day is refused' ($r.Code -eq 1 -and $r.Text.Contains('Name a session with -Session'))
$r = Run @('-Session', 'aaaaaaaa1111', '-Profile', '1')
Yes 'a session and a profile together are refused' ($r.Code -eq 1 -and $r.Text.Contains('not both'))
$out = Join-Path $tmp 'out-missing'
$text = (& pwsh -NoProfile -File $reader -Folder (Join-Path $tmp 'nothing-here') -Rows $rows -Out $out -Session 'aaaaaaaa1111' 2>&1 | Out-String)
Yes 'a missing session log folder exits 1 and says so' ($LASTEXITCODE -eq 1 -and $text.Contains('there are no session logs to read here'))

Remove-Item -LiteralPath $tmp -Recurse -Force
Done
