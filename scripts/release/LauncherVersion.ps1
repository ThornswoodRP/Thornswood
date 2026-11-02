<#
  LauncherVersion.ps1

  Works out the launcher's number from git, so it is never committed.

  #5179, the plan's part 7, "the version comes from the build". Dot-sourced
  by Ship.ps1, Build-Launcher.ps1, BuildStamp.ps1, Check-ShipReady.ps1,
  Nexus.ps1 and release.yml; defines functions and nothing else. ASCII, and
  Windows PowerShell 5.1 as well as 7.

  WHY. The number was a line in launcher\app\Updater.cs, so every launcher
  change needed a second pull request that moved it (Bump-Version.ps1):
  four in the last hundred merges on 31 Oct 2026 (1.2.12, 1.2.14, 1.2.15,
  1.2.16), each one more build, more review and more wait before a main
  release could carry the change. #5192 was one: the engine pin moved, so
  1.2.15 "cannot carry it (Ship-Main stopped on the number)".

  THE RULE. The launcher's number is the time, in UTC, of the newest commit
  on the checkout's first-parent history that changed anything the launcher
  is built from, written year.monthday.hourminute: 2026.1101.1745 for 5:45
  PM UTC on 1 Nov 2026. What the launcher is built from is the list
  Ship.ps1's Get-LauncherInputHash fingerprints (every file under launcher\
  but the Markdown, records\client-build.json, records\ui-gone.json,
  records\generated.json and scripts\release\Build-Launcher.ps1), the same
  list here as $script:LauncherInputPathspec, so the number moves exactly
  when the fingerprint does on a committed tree.
    - The same sources always give the same number, from any commit after
      them, so a main Ship from a later commit that changed nothing in the
      launcher finds the launcher dev tried under the number it expects
      (#5156), and one whose launcher is already out keeps it (#921).
    - A later change always gives a higher number, so every launcher is
      offered it: Updater.IsNewer compares the parts as numbers, and each
      part fits the 0 to 65534 a Windows file version allows.
    - Two changes inside one minute: the later one takes the minute after
      the earlier one's number, so no two launchers ever share a number. That
      is worked out from the history itself, the same on every machine.
  A dev number is this number with a fourth part, as before (Ship.ps1).

  Needs the history: a shallow checkout cannot say when the launcher last
  changed, so it stops and says so rather than guessing.
#>

# The launcher's sources as git pathspecs, from the top of the repository.
# Ship.ps1's Get-LauncherInputHash reads the same files off the working tree.
# Not its harnesses in launcher\tests (plan line 42): a change to a check is no
# new launcher, and would otherwise give every launcher a new number.
$script:LauncherInputFiles = @('records/client-build.json', 'records/ui-gone.json', 'records/generated.json', 'scripts/release/Build-Launcher.ps1')
$script:LauncherInputPathspec = @(':(top)launcher', ':(top,exclude,glob)launcher/**/*.md', ':(top,exclude)launcher/tests') + @($script:LauncherInputFiles | ForEach-Object { ':(top)' + $_ })

# year.monthday.hourminute of a UTC time, each part a plain number.
function Format-LauncherVersion([DateTime]$utc) {
    return ('{0}.{1}.{2}' -f $utc.Year, ($utc.Month * 100 + $utc.Day), ($utc.Hour * 100 + $utc.Minute))
}

# The commits on <commit>'s first-parent history that changed the launcher's
# sources, oldest first, each as @{ Commit; Utc }. Throws on a shallow
# checkout or when git cannot answer.
function Get-LauncherChanges([string]$RepoDir, [string]$Commit = 'HEAD') {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $shallow = "$(& git -C $RepoDir rev-parse --is-shallow-repository 2>$null)".Trim()
        if ($LASTEXITCODE -ne 0) { throw "git could not read $RepoDir as a repository (exit $LASTEXITCODE), so the launcher's number is not known." }
        if ($shallow -eq 'true') {
            throw ("$RepoDir is a shallow checkout, so when the launcher last changed is not known and neither is its number. " +
                   'Fetch the history first (git fetch --unshallow, or actions/checkout with fetch-depth: 0).')
        }
        $lines = @(& git -C $RepoDir log --first-parent --format='%H %ct' $Commit -- @($script:LauncherInputPathspec) 2>$null)
        if ($LASTEXITCODE -ne 0) { throw "git log of the launcher's sources at $Commit stopped with exit $LASTEXITCODE, so the launcher's number is not known." }
    }
    finally { $ErrorActionPreference = $old }
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($l in $lines) {
        $m = [regex]::Match([string]$l, '^([0-9a-f]{40}) (\d+)$')
        if (-not $m.Success) { continue }
        $utc = [DateTimeOffset]::FromUnixTimeSeconds([long]$m.Groups[2].Value).UtcDateTime
        $out.Insert(0, [pscustomobject]@{ Commit = $m.Groups[1].Value; Utc = $utc })
    }
    if ($out.Count -eq 0) { throw "No commit on $Commit's history changed the launcher's sources, so it has no number." }
    return , $out.ToArray()
}

# The launcher's number at <commit> (THE RULE above).
function Get-LauncherVersion([string]$RepoDir, [string]$Commit = 'HEAD') {
    $at = $null
    foreach ($c in (Get-LauncherChanges -RepoDir $RepoDir -Commit $Commit)) {
        $t = $c.Utc.AddSeconds(-$c.Utc.Second).AddTicks(-($c.Utc.Ticks % [TimeSpan]::TicksPerSecond))
        if ($null -ne $at -and $t -le $at) { $t = $at.AddMinutes(1) }
        $at = $t
    }
    return (Format-LauncherVersion $at)
}
