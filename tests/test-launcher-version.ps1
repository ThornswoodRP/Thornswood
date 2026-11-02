<#
  test-launcher-version.ps1

      pwsh -NoProfile -File .\tests\test-launcher-version.ps1

  #5179, the plan's part 7: the launcher's number comes from the build. It was
  a line in launcher\app\Updater.cs that a pull request of its own moved
  (Bump-Version.ps1), four times in the last hundred merges on 31 Oct 2026.
  Now scripts\release\LauncherVersion.ps1 works the number out from when the
  launcher's sources last changed, and the build gives it to the exe as
  -p:Version (#4825): no source file holds it.

  This drives the real LauncherVersion.ps1 against a scratch git repository
  whose commits it dates itself, and holds it to the rule its header gives:
    1. the number is the UTC time of the newest first-parent commit that
       changed the launcher's sources, year.monthday.hourminute;
    2. Markdown under launcher\ and files outside the list do not move it;
       records\client-build.json, records\ui-gone.json,
       records\generated.json and scripts\release\Build-Launcher.ps1 do;
    3. two changes inside one minute: the later takes the minute after;
    4. any commit after a change keeps that change's number, and an older
       commit has its own;
    5. a merge counts once, at the merge, on the first-parent line;
    6. a shallow checkout and a repository with no change stop, and say why;
    7. each part fits in 0 to 65534, the most a Windows file version holds,
       up to the last minute of 2099;
    8. no source file in this repository holds the number: Updater.cs reads
       it from the exe's own version, a bare build of the project is 0.0.0,
       Build-Launcher.ps1 hands the number to the compile as -p:Version, and
       Publish-Update.ps1 records the number it is given; Ship.ps1
       fingerprints the same files the number is worked out from.

  Read only apart from its own folder under TEMP, which it removes.
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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$lib = Join-Path $Repo 'scripts\release\LauncherVersion.ps1'
Yes 'LauncherVersion.ps1 is there' (Test-Path -LiteralPath $lib)
if (-not (Test-Path -LiteralPath $lib)) { Done }
. $lib

# ---- 8. this repository ------------------------------------------------------
$updater = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Updater.cs'))
Yes 'Updater.cs holds no number: its Version is the exe''s own (BuiltVersion)' (
    $updater.Contains('public static readonly string Version = BuiltVersion();') -and
    $updater.Contains('typeof(Updater).Assembly.GetName().Version') -and
    $updater -notmatch 'Version\s*=\s*"\d+\.\d+\.\d+')
$proj = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Thornswood.csproj'))
Yes '  a bare build of the project is 0.0.0' ($proj.Contains("<Version Condition=`"'`$(Version)' == ''`">0.0.0</Version>"))
$bl = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Build-Launcher.ps1'))
Yes '  Build-Launcher.ps1 gives the compile the number as -p:Version, worked out here unless given' (
    $bl.Contains('"-p:Version=$Version"') -and $bl.Contains('Get-LauncherVersion -RepoDir'))
$pub = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Publish-Update.ps1'))
Yes '  and Publish-Update.ps1 records no launcher number and reads no source file for one (#4825)' (
    -not $pub.Contains('$VersionOverride') -and -not $pub.Contains("launcher\app\Updater.cs'"))
$ship = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Ship.ps1'))
Yes 'Ship.ps1 works out no launcher number: a Ship sends no launcher (#4825)' ($ship -notmatch 'LauncherVersion\.ps1' -and $ship -notmatch 'Get-LauncherVersion')

# ---- 7. the parts fit a file version ------------------------------------------
$last = Format-LauncherVersion ([DateTime]::new(2099, 12, 31, 23, 59, 0, [DateTimeKind]::Utc))
Yes "the last minute of 2099 is $last, every part 65534 or less" (@($last.Split('.') | Where-Object { [int]$_ -gt 65534 }).Count -eq 0)
Yes 'a time is year.monthday.hourminute, each a plain number' ((Format-LauncherVersion ([DateTime]::new(2026, 1, 2, 3, 4, 0, [DateTimeKind]::Utc))) -eq '2026.102.304')

# ---- a scratch repository whose commit times are set -----------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-launcher-version-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$r = Join-Path $tmp 'repo'
New-Item -ItemType Directory -Force -Path $r | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = $tmp
$saved = @{}
foreach ($k in 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE') { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }

function Run-Git {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & git -C $r -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false @args 2>&1
    $ErrorActionPreference = $old
    return $out
}
# Writes one file and commits it at the UTC time given, "2026-11-01T17:45:12Z".
function Change([string]$path, [string]$at) {
    $p = Join-Path $r $path
    $d = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($p, ([Guid]::NewGuid().ToString() + "`n"), $utf8)
    $env:GIT_AUTHOR_DATE = $at; $env:GIT_COMMITTER_DATE = $at
    Run-Git add -A | Out-Null
    Run-Git commit -q -m "change $path" | Out-Null
    return ((Run-Git rev-parse HEAD) | Out-String).Trim()
}
function Number([string]$commit = 'HEAD') {
    try { return (Get-LauncherVersion -RepoDir $r -Commit $commit) } catch { return 'threw: ' + $_.Exception.Message }
}

try {
    Run-Git init -q -b main | Out-Null

    # ---- 6. nothing to go on ------------------------------------------------------
    $first = Change 'docs/readme.txt' '2026-10-01T08:00:00Z'
    Yes 'a history with no launcher change stops and says so' ((Number) -match '^threw: No commit')

    # ---- 1. the newest change's time ---------------------------------------------
    $c1 = Change 'launcher/app/Shell.cs' '2026-11-01T17:45:12Z'
    Yes ('a change to launcher\app is its minute: ' + (Number)) ((Number) -eq '2026.1101.1745')

    # ---- 2. what counts and what does not ------------------------------------------
    $null = Change 'launcher/app/NOTES.md' '2026-11-01T18:00:00Z'
    Yes 'Markdown under launcher\ does not move it' ((Number) -eq '2026.1101.1745')
    $null = Change 'game/gamemode.js' '2026-11-01T18:10:00Z'
    Yes 'a file the launcher is not built from does not move it' ((Number) -eq '2026.1101.1745')
    $at = [ordered]@{
        'records/client-build.json'          = @('2026-11-01T19:00:00Z', '2026.1101.1900')
        'records/ui-gone.json'               = @('2026-11-01T19:10:00Z', '2026.1101.1910')
        'records/generated.json'             = @('2026-11-01T19:20:00Z', '2026.1101.1920')
        'scripts/release/Build-Launcher.ps1' = @('2026-11-01T19:30:00Z', '2026.1101.1930')
        'launcher/app.ico'                   = @('2026-11-01T19:40:00Z', '2026.1101.1940')
    }
    foreach ($f in $at.Keys) {
        $null = Change $f $at[$f][0]
        Yes ("$f moves it, to " + (Number)) ((Number) -eq $at[$f][1])
    }

    # ---- 3. the same minute ----------------------------------------------------------
    $null = Change 'launcher/app/Online.cs' '2026-11-01T20:05:01Z'
    $a = Number
    $null = Change 'launcher/app/Online.cs' '2026-11-01T20:05:40Z'
    $b = Number
    Yes "two changes in one minute: the first is $a" ($a -eq '2026.1101.2005')
    Yes "  and the second the minute after it, $b, so no two launchers share one" ($b -eq '2026.1101.2006')
    $null = Change 'launcher/app/Online.cs' '2026-11-01T20:05:50Z'
    Yes ('  and a third the minute after that, ' + (Number)) ((Number) -eq '2026.1101.2007')
    $null = Change 'launcher/app/Online.cs' '2026-11-01T20:06:30Z'
    Yes ('  a change inside a minute already taken goes past it too, ' + (Number)) ((Number) -eq '2026.1101.2008')
    $c2 = Change 'launcher/app/Online.cs' '2026-11-01T21:00:00Z'
    Yes ('  and a change after the run is its own minute again, ' + (Number)) ((Number) -eq '2026.1101.2100')

    # ---- 4. commits after and before -----------------------------------------------
    $null = Change 'game/gamemode.js' '2026-11-02T09:00:00Z'
    Yes 'a later commit that changes no launcher source keeps the number' ((Number) -eq '2026.1101.2100')
    Yes 'an older commit has its own number' ((Number $c1) -eq '2026.1101.1745')
    Yes 'and the same commit gives the same number every time' ((Number $c1) -eq (Number $c1))

    # ---- 5. a merge --------------------------------------------------------------------
    Run-Git checkout -q -b side | Out-Null
    $null = Change 'launcher/app/Shell.cs' '2026-11-02T10:00:00Z'
    $null = Change 'launcher/app/Shell.cs' '2026-11-02T10:30:00Z'
    Run-Git checkout -q main | Out-Null
    $env:GIT_AUTHOR_DATE = '2026-11-02T11:15:00Z'; $env:GIT_COMMITTER_DATE = '2026-11-02T11:15:00Z'
    Run-Git merge -q --no-ff -m 'merge side' side | Out-Null
    Yes ('a merge that brings a launcher change counts once, at the merge: ' + (Number)) ((Number) -eq '2026.1102.1115')
    $changes = @(Get-LauncherChanges -RepoDir $r)
    Yes '  and the side branch''s own commits are not counted on main''s line' (@($changes | Where-Object { $_.Utc -eq [DateTime]::new(2026, 11, 2, 10, 0, 0, [DateTimeKind]::Utc) }).Count -eq 0)

    # ---- 6. a shallow checkout ------------------------------------------------------------
    $shallow = Join-Path $tmp 'shallow'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git clone -q --depth 1 ('file://' + ($r -replace '\\', '/')) $shallow 2>&1 | Out-Null
    $ErrorActionPreference = $old
    $said = ''
    try { $null = Get-LauncherVersion -RepoDir $shallow; $said = 'went on' } catch { $said = $_.Exception.Message }
    Yes 'a shallow checkout stops rather than guess' ($said -match 'shallow')
    Yes '  and says how to get the history' ($said -match 'fetch-depth: 0' -and $said -match 'unshallow')
    $said = ''
    try { $null = Get-LauncherVersion -RepoDir (Join-Path $tmp 'nothing') ; $said = 'went on' } catch { $said = $_.Exception.Message }
    Yes 'a folder that is not a repository stops and says so' ($said -match 'could not read')
}
finally {
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
