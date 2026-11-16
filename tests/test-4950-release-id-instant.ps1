<#
  test-4950-release-id-instant.ps1

  A release id names the instant it was made, and everything that sorts or
  reads ids reads that instant (#4950).

  WHY THIS EXISTS. New-ReleaseId named a release by Mountain time with no
  zone. On the first Sunday of November Mountain clocks run 1:00 to 1:59 AM
  twice, so a release forty minutes after one at 1:50 AM summer time was named
  1:10 AM and sorted before it in the store's list of releases
  (Get-StoreReleases), which Rollback-Feed and Scrub-Feed read. An id is now
  the UTC time with a Z (yyyyMMdd-HHmmssZ, -dev on dev), and the ids from
  before it are read as the Mountain time they were made on. This holds:

    1. a new id is UTC with its Z, whatever the clock it is minted on
    2. two releases across the repeated hour are named in the order they went
       out, and the id is its own instant, never moved to sort after another
    3. Get-ReleaseIdUtc reads both shapes, the old as Mountain time
    4. the store's list sorts old and new ids by the instant they name
    5. Dev-News puts a new id's span on the clock the notes are dated by
    6. the tag shapes Set-Ref.ps1 and Publish-ReleaseFiles.ps1 accept take it

  Nothing here connects to anything, and everything it writes is in its own
  temp folder. test-release-name.ps1 drives the rest of the names.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$rel = Join-Path (Join-Path $repo 'scripts') 'release'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [scriptblock]$cond) {
    $ok = $false; $why = ''
    try { $ok = [bool](& $cond) } catch { $why = ' | ' + $_.Exception.Message }
    if ($ok) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host ("FAIL  $what" + $why) }
}

. (Join-Path $rel 'Release-Name.ps1')
. (Join-Path $rel 'Release-Baseline.ps1')
. (Join-Path $rel 'Dev-News.ps1')
$inv = [Globalization.CultureInfo]::InvariantCulture
function Utc([int]$y, [int]$mo, [int]$d, [int]$h, [int]$mi, [int]$s) { [datetime]::new($y, $mo, $d, $h, $mi, $s, [DateTimeKind]::Utc) }

# ---- 1. a new id is UTC with its Z ------------------------------------------
Write-Host ''; Write-Host 'a new id'
Yes 'New-ReleaseId is minted on the UTC clock unless a time is given' {
    $p = (Get-Command New-ReleaseId).ScriptBlock.Ast.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'UtcNow' }
    $p -and $p.DefaultValue.Extent.Text -eq '[datetime]::UtcNow'
}
Yes '21:56 UTC on 31 Oct is 20261031-215600Z' { (New-ReleaseId $null -UtcNow (Utc 2026 10 31 21 56 0)) -eq '20261031-215600Z' }
Yes '  and 20261031-215600Z-dev on dev' { (New-ReleaseId $null -Dev -UtcNow (Utc 2026 10 31 21 56 0)) -eq '20261031-215600Z-dev' }
Yes '  the same instant handed as a machine''s local time gives the same id' {
    (New-ReleaseId $null -UtcNow ((Utc 2026 10 31 21 56 0).ToLocalTime())) -eq '20261031-215600Z'
}
Yes 'an id the feed already names still moves on a second' {
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = '20261031-215600Z' }, [pscustomobject]@{ id = '20261031-215601Z-2' }) }
    (New-ReleaseId $f -UtcNow (Utc 2026 10 31 21 56 0)) -eq '20261031-215602Z'
}

# ---- 2. the repeated hour ---------------------------------------------------
Write-Host ''; Write-Host 'the repeated hour, 1 Nov'
$first = Utc 2026 11 1 7 50 0     # 1:50 AM summer time
$again = Utc 2026 11 1 8 10 0     # 1:10 AM standard time, forty minutes later
Yes 'the two read back on the team''s clock as 01:50 and 01:10' {
    (Get-TeamNow $first).ToString('HH:mm') -eq '01:50' -and (Get-TeamNow $again).ToString('HH:mm') -eq '01:10'
}
$one = ''; $two = ''
Yes 'the first release is 20261101-075000Z' { $script:one = New-ReleaseId $null -UtcNow $first; $script:one -eq '20261101-075000Z' }
Yes '  the second 20261101-081000Z, its own instant, and it sorts after the first' {
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = $script:one }); release = [pscustomobject]@{ id = $script:one } }
    $script:two = New-ReleaseId $f -UtcNow $again
    $script:two -eq '20261101-081000Z' -and [string]::CompareOrdinal($script:two, $script:one) -gt 0
}
Yes 'an id is never moved to sort after the feed''s: a feed naming a later instant leaves it as its own' {
    $f = [pscustomobject]@{ release = [pscustomobject]@{ id = '20261101-090000Z' } }
    (New-ReleaseId $f -UtcNow $again) -eq '20261101-081000Z'
}

# ---- 3. reading an id --------------------------------------------------------
Write-Host ''; Write-Host 'what instant an id names'
$cases = @(
    @('20261101-081000Z', (Utc 2026 11 1 8 10 0), 'a new one'),
    @('20261101-081000Z-dev', (Utc 2026 11 1 8 10 0), 'a new dev one'),
    @('20261101-081000Z-2', (Utc 2026 11 1 8 10 0), 'a part of a new one'),
    @('20261102-121621', (Utc 2026 11 2 19 16 21), 'main''s last tag, Mountain standard time'),
    @('20261101-140731-dev', (Utc 2026 11 1 21 7 31), 'dev''s, the afternoon after the clocks went back'),
    @('20261031-155600', (Utc 2026 10 31 21 56 0), 'one in summer time'),
    @('20261001-1800', (Utc 2026 10 2 0 0 0), 'a minute id from before #1057'),
    @('20260928-2324-dev-2', (Utc 2026 9 29 5 24 0), 'a part of an old dev minute id')
)
foreach ($c in $cases) {
    $id = $c[0]; $want = $c[1]
    Yes ("$id, {0}, is {1:yyyy-MM-dd HH:mm:ss} UTC" -f $c[2], $want) {
        $got = Get-ReleaseIdUtc $id
        $null -ne $got -and $got.Kind -eq [DateTimeKind]::Utc -and $got -eq $want
    }
}
Yes 'anything else names no instant' {
    $null -eq (Get-ReleaseIdUtc 'v1.2.6') -and $null -eq (Get-ReleaseIdUtc '') -and $null -eq (Get-ReleaseIdUtc '2026110-1200')
}

# ---- 4. the store's list across the change -----------------------------------
Write-Host ''; Write-Host 'the store''s list of releases'
function Entry([string]$id) { [pscustomobject]@{ id = $id; sha256 = ('a' * 64); url = 'https://example.invalid/' + $id; entries = 1; lastPack = $id } }
Yes 'old and new ids sort by the instant they name, newest first' {
    # 12:16 PM Mountain is 19:16 UTC: a new id from 19:00 UTC went out before
    # it, though its digits are larger, and one from 20:00 UTC after it.
    $doc = [pscustomobject]@{ releases = @((Entry '20261102-190000Z'), (Entry '20261102-200000Z'), (Entry '20261102-121621')) }
    $order = @(Get-StoreReleases '' $doc | ForEach-Object { $_.id }) -join ','
    $order -eq '20261102-200000Z,20261102-121621,20261102-190000Z'
}
Yes '  and the two releases of the repeated hour, in the order they went out' {
    $doc = [pscustomobject]@{ releases = @((Entry '20261101-075000Z'), (Entry '20261101-081000Z')) }
    (@(Get-StoreReleases '' $doc | ForEach-Object { $_.id }) -join ',') -eq '20261101-081000Z,20261101-075000Z'
}

# ---- 5. Dev-News's spans -------------------------------------------------------
Write-Host ''; Write-Host 'a dev release''s span on the notes'' clock'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Yes 'git is on PATH' { $false } }
else {
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-4950-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    try {
        $env:GIT_AUTHOR_NAME = 'Thornswood test'; $env:GIT_AUTHOR_EMAIL = 'test@thornswood.invalid'
        $env:GIT_COMMITTER_NAME = 'Thornswood test'; $env:GIT_COMMITTER_EMAIL = 'test@thornswood.invalid'
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & git -C $scratch init -q 2>&1 | Out-Null
        & git -C $scratch -c commit.gpgsign=false commit -q --allow-empty -m one 2>&1 | Out-Null
        $env:GIT_COMMITTER_DATE = '2026-11-01T08:12:00Z'
        & git -C $scratch -c tag.gpgsign=false tag -a 'release/dev/20261101-081000Z-dev' -m 'Thornswood dev release' 2>&1 | Out-Null
        Remove-Item Env:GIT_COMMITTER_DATE
        $ErrorActionPreference = $old
        $tags = @(Get-DevReleaseTags $scratch)
        Yes 'a new id''s span starts at its minute on the team''s clock, 1:10 AM' {
            $tags.Count -eq 1 -and $tags[0].From -eq [datetime]::new(2026, 11, 1, 1, 10, 0)
        }
        Yes '  so a note dated 11-1-2026 1:11 AM is found in it' {
            $hit = Find-DevNoteRelease $tags '11-1-2026 1:11 AM'
            $null -ne $hit -and @($hit.Ids) -contains '20261101-081000Z-dev'
        }
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- 6. the tag shapes -----------------------------------------------------------
Write-Host ''; Write-Host 'the tags a release gets'
$setRef = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo 'scripts') 'ops') 'Set-Ref.ps1'))
$shape = [regex]::Match($setRef, "\`$tagShape = '([^']+)'").Groups[1].Value
$pub = [IO.File]::ReadAllText((Join-Path $rel 'Publish-ReleaseFiles.ps1'))
$pubShape = [regex]::Match($pub, "\`$Tag -notmatch '([^']+)'").Groups[1].Value
foreach ($t in 'release/dev/20261101-081000Z-dev', 'release/main/20261101-081000Z', 'release/main/20261102-121621', 'release/dev/20261001-1800-dev') {
    Yes "Set-Ref.ps1 makes $t" { $shape -and $t -match $shape }
    Yes "  and Publish-ReleaseFiles.ps1 takes it" { $pubShape -and $t -match $pubShape }
}
foreach ($t in 'release/dev/20261101-081000Z', 'release/main/20261101-081000Z-dev', 'release/main/20261101-1810Z') {
    Yes "  and Set-Ref.ps1 makes no $t" { $shape -and $t -notmatch $shape }
}
Yes 'the tag of a new release is a valid git ref' {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $false }
    & git check-ref-format ('refs/tags/' + (Get-ReleaseTagName 'dev' '20261101-081000Z-dev')) 2>$null
    $LASTEXITCODE -eq 0
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
