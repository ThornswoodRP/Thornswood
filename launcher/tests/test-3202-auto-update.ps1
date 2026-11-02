<#
  test-3202-auto-update.ps1

  #3202. Automatic updates are on by default and actually update. Patrick,
  21 Oct, 6:30 PM: "the app needs to auto update by default and fix the auto
  update as I believe it's not working".

  The cause, measured in the source before this: Config.AutoUpdate was
  already on unless config.json says false, but the only code that read it
  was the end of OnVersionDoc, behind installWhenSeen, which only the game
  closing for an update set. An update found when the launcher opened, or
  seen by the feed watch while it sat open, waited on the card for a press
  of Install now. The setting's own words said something else again: "Check
  for updates when the launcher opens", a check that always runs (#937).

  What this holds, by the source:

    1. The default. Config.AutoUpdate is on unless config.json holds an
       explicit false, so a fresh install and an older config.json with no
       key both have it on, and config.example.json says true.
    2. Every update check's answer is followed by UpdateBySelf, and Scan's
       and Fix's own readings of the feed are not (Scan only looks; Fix
       takes the update itself, last).
    3. UpdateBySelf takes the update with one press of Install now
       (UpdateNow) when the setting is on and an update is waiting. It
       leaves it while the launcher's own game runs (the in-play clock
       closes the game and the check after the close comes back here),
       while an update is going in, and while a Skyrim the launcher did not
       start is open, and it never takes the update RunUpdate tried last a
       second time by itself.
    4. installWhenSeen is gone: with the setting on every check takes the
       update, so the flag had nothing left to say.
    5. RunUpdate runs one update at a time, and clears that when the update
       has gone in or failed.
    6. The setting says what it does, and that the check always runs.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# Line ends as git checked them out: CRLF on a runner, LF in some worktrees.
function Src([string]$path) { [IO.File]::ReadAllText($path) -replace "`r`n", "`n" }
$App = Join-Path $Repo 'launcher\app'
$cfg = Src (Join-Path $App 'Config.cs')
$upd = Src (Join-Path $App 'ShellUpdate.cs')
$shell = Src (Join-Path $App 'Shell.cs')
$sf = Src (Join-Path $App 'ShellScanFix.cs')
$xaml = Src (Join-Path $Repo 'launcher\app\MainWindow.axaml')
$example = Src (Join-Path $Repo 'config.example.json')

function Body([string]$text, [string]$head) {
    [regex]::Match($text, '(?s)' + [regex]::Escape($head) + '(.*?)\n        \}\n').Groups[1].Value
}

# ---- 1: the default ---------------------------------------------------------------
Yes 'AutoUpdate is a nullable that starts on' ($cfg.Contains('[JsonInclude, JsonPropertyName("AutoUpdate")] public bool? AutoUpdateSetting = true;'))
Yes 'and only an explicit false is off, so a config.json without the key has it on' ($cfg -match 'get \{ return AutoUpdateSetting != false; \}')
Yes 'config.example.json has it on' ($example -match '"AutoUpdate":\s*true')

# ---- 2: who asks ------------------------------------------------------------------
$check = Body $upd 'static void CheckUpdatesBackground(bool loud)'
Yes 'every update check''s answer is followed by UpdateBySelf' ($check.Contains('OnVersionDoc(v, loud); UpdateBySelf();'))
Yes 'and nothing else calls it: not Scan''s or Fix''s reading of the feed' (([regex]::Matches(($upd + $shell + $sf), 'UpdateBySelf\(\);')).Count -eq 1)

# ---- 3: what it does --------------------------------------------------------------
$self = Body $upd 'static void UpdateBySelf()'
Yes 'UpdateBySelf exists' ($self.Length -gt 0)
function Before([string]$a, [string]$b) { $i = $self.IndexOf($a); $j = $self.IndexOf($b); ($i -ge 0) -and ($j -ge 0) -and ($i -lt $j) }
Yes 'it does nothing with the setting off' (Before 'if (!cfg.AutoUpdate) return;' 'UpdateNow();')
Yes 'or with nothing waiting' (Before 'if (!updatePending || (pendingPacks.Count == 0 && !selfUpdateOffered)) return;' 'UpdateNow();')
Yes 'it leaves the update to the in-play clock while the game runs' (Before 'if (playing) return;' 'UpdateNow();')
Yes 'and to the update already going in' (Before 'if (updating) return;' 'UpdateNow();')
Yes 'it never closes a Skyrim the launcher did not start' (Before 'if (Checks.GameRunning())' 'UpdateNow();')
Yes 'it never takes the update tried last a second time' (Before 'updateTried.IsSupersetOf(UpdateParts(pendingPacks, pendingDoc, selfUpdateOffered))' 'UpdateNow();')
Yes 'and otherwise it is one press of Install now' ($self -match 'Log\("Installing it now, because automatic updates are on \(Settings, Updates\)\."\);\s*UpdateNow\(\);\s*$')

# ---- 4: installWhenSeen is gone -------------------------------------------------------
Yes 'installWhenSeen is gone from the launcher' (-not ($upd + $shell + $sf).Contains('installWhenSeen'))
$ovd = Body $upd 'static void OnVersionDoc(VersionDoc v, bool loud)'
Yes 'OnVersionDoc only paints the answer and starts no update itself' ($ovd.Length -gt 0 -and -not ($ovd -match 'RunUpdate\(|UpdateNow\('))
Yes 'the game closing for an update still checks again' ($shell -match '(?s)closedForUpdate = false;.*?CheckUpdatesBackground\(true\)')

# ---- 5: one update at a time --------------------------------------------------------
$run = Body $upd 'static void RunUpdate(Action<bool> after)'
$guard = $run.IndexOf('if (updating) {')
$set = $run.IndexOf('updating = true;')
Yes 'RunUpdate refuses a second update while one is going in' ($guard -ge 0 -and $guard -lt $set)
Yes 'and marks one only once the game is out of the way' ($run.IndexOf('if (!ClearStuckGame(true)) return;') -lt $set)
Yes 'and clears it both when the update went in and when it failed' (([regex]::Matches($run, 'updating = false;')).Count -eq 2)

# ---- 6: the words -------------------------------------------------------------------
Yes 'the setting says it installs, not that it checks' ($xaml.Contains('<CheckBox x:Name="ChkAutoUpdate" Content="Install updates by themselves"/>') -and -not $xaml.Contains('Check for updates when the launcher opens'))
Yes 'and says the check runs either way' ($xaml.Contains('The launcher always checks for updates either way.'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
