# Runs the real resume helpers out of Publish-Update.ps1 against a temp folder.
#
# The rest of that script uploads to GitHub and pushes a feed, so it cannot be
# run here. This takes the block between its two markers, which is nothing but
# four functions over one small file, and drives it. If the markers move, this
# stops rather than quietly testing nothing.

# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$here = Split-Path -Parent (Split-Path -Parent $here)
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')

$src = Get-Content -LiteralPath (Join-Path $here 'scripts\release\Publish-Update.ps1') -Raw
$a = $src.IndexOf('# ==== thornswood publish resume ====')
$b = $src.IndexOf('# ==== end thornswood publish resume ====')
if ($a -lt 0 -or $b -lt 0) {
    Write-Host 'the resume block markers are not in Publish-Update.ps1' -ForegroundColor Red
    exit 1
}
# Since #780 (#437) the script sets $script:PendingFile near its top, to the
# channel's note under LOCALAPPDATA, before any of these run, and
# Get-PendingFile answers with it when it is set. The block alone never sets
# it, and under strict mode reading it unset throws, so it is set here empty,
# which is the beside-the-baseline answer the checks below drive. The
# override itself is checked at the end.
$script:PendingFile = ''
Invoke-Expression $src.Substring($a, $b - $a)

$pass = 0
$fail = 0
function Check($what, $got, $want) {
    if ([string]$got -eq [string]$want) {
        $script:pass++
        Write-Host ("PASS  " + $what) -ForegroundColor DarkGray
    } else {
        $script:fail++
        Write-Host ("FAIL  " + $what) -ForegroundColor Red
        Write-Host ("      wanted [" + $want + "] got [" + $got + "]") -ForegroundColor Red
    }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-resume-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $state = Join-Path $work 'published.json'
    $devState = Join-Path $work 'published-dev.json'

    # ---- where the note goes
    Check 'the note sits beside the baseline' (Get-PendingFile $state) (Join-Path $work 'published-pending.json')
    Check 'and the dev baseline has its own' (Get-PendingFile $devState) (Join-Path $work 'published-dev-pending.json')
    Check 'no baseline, no note' (Get-PendingFile '') ''

    # ---- nothing written yet
    Check 'no note means nothing to finish' (Read-Pending $state) ''

    # ---- a failure is remembered
    Write-Pending $state '20260923-2311' 'git push exited with 1'
    $p = Read-Pending $state
    Check 'the id comes back' $p.id '20260923-2311'
    Check 'and what went wrong' $p.why 'git push exited with 1'
    # The time is read off the file rather than off the object: ConvertFrom-Json
    # turns an ISO-8601 string back into a DateTime, which prints in whatever
    # the machine's locale is. What matters is what is written down.
    $onDisk = Get-Content -LiteralPath (Get-PendingFile $state) -Raw
    Check 'with a UTC time on it' ($onDisk -match '"at":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"') 'True'
    Check 'the dev note is untouched by main' (Read-Pending $devState) ''

    # ---- the two channels do not see each other
    Write-Pending $devState '20260923-2312-dev' 'no git identity'
    Check 'dev remembers its own id' (Read-Pending $devState).id '20260923-2312-dev'
    Check 'and main still remembers its' (Read-Pending $state).id '20260923-2311'

    # ---- a note that will not parse is the same as no note. It is a message to
    # ourselves about the last run, and refusing to publish over a damaged one
    # would be the tail wagging the dog.
    Set-Content -LiteralPath (Get-PendingFile $state) -Value 'not json at all' -Encoding UTF8
    Check 'nonsense reads as nothing to finish' (Read-Pending $state) ''

    # ---- a note with no id in it is no note either
    Set-Content -LiteralPath (Get-PendingFile $state) -Value '{"why":"something"}' -Encoding UTF8
    Check 'a note with no id is ignored' (Read-Pending $state) ''

    # ---- a byte order mark does not stop it, which has bitten every other
    # reader of JSON in this repo
    $bom = [char]0xFEFF + '{"id":"20260923-2320","why":"bom"}'
    Set-Content -LiteralPath (Get-PendingFile $state) -Value $bom -Encoding UTF8
    Check 'a byte order mark is stepped over' (Read-Pending $state).id '20260923-2320'

    # ---- and a finished release clears it
    Clear-Pending $state
    Check 'clearing removes the file' (Test-Path -LiteralPath (Get-PendingFile $state)) 'False'
    Check 'and nothing is left to finish' (Read-Pending $state) ''
    Clear-Pending $state
    Check 'clearing twice is not an error' (Test-Path -LiteralPath (Get-PendingFile $state)) 'False'
    Check 'the dev note survived all of that' (Read-Pending $devState).id '20260923-2312-dev'

    # ---- the machine's own note, as the script sets it (#780)
    $script:PendingFile = Join-Path $work 'local\published-pending.json'
    Check 'a note file the script names wins over the one beside the baseline' (Get-PendingFile $state) $script:PendingFile
    New-Item -ItemType Directory -Path (Join-Path $work 'local') -Force | Out-Null
    Write-Pending $state '20260928-0101' 'gh exited with 1'
    Check 'and it is the one written' (Test-Path -LiteralPath $script:PendingFile) 'True'
    Check 'and read back' (Read-Pending $state).id '20260928-0101'

    # ---- a note that cannot be written or removed (#2711)
    # Both ran in a try with an empty catch, so Done said the next run would
    # finish a release no note named, and a note never removed was left to
    # name a release already out. Each now hands back what it could not do.
    Check 'a note written answers nothing to say' (Write-Pending $state '20260928-0102' 'gh exited with 1') ''
    if ($OnWindows) {
        $held = [IO.File]::Open($script:PendingFile, 'Open', 'Read', 'None')
        try { $why = Clear-Pending $state } finally { $held.Dispose() }
        Check 'a note that cannot be removed is said, naming it' ([bool]($why -match 'could not be removed' -and $why.Contains($script:PendingFile))) 'True'
        Check '  and it is still there' (Test-Path -LiteralPath $script:PendingFile) 'True'
    } else {
        # A file held open without share-delete is a Windows share mode; Linux
        # removes a file whoever holds it open.
        Write-Host 'SKIP  a note that cannot be removed: holding it open stops a remove only on Windows'
    }
    Check 'a note removed answers nothing to say' (Clear-Pending $state) ''
    $blocker = Join-Path $work 'a-file-not-a-folder'
    [IO.File]::WriteAllText($blocker, 'x')
    $script:PendingFile = Join-Path $blocker 'published-pending.json'
    $why = Write-Pending $state '20260928-0103' 'gh exited with 1'
    Check 'a note that cannot be written is said, with the release it would finish' ([bool]($why -match 'could not be written' -and $why.Contains('20260928-0103'))) 'True'
    $script:PendingFile = ''
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
