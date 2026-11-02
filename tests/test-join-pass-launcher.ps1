<#
  test-join-pass-launcher.ps1

      pwsh -NoProfile -File .\tests\test-join-pass-launcher.ps1

  The launcher's half of #937: it fetches a join pass for the character picked
  at the menu and keeps it fresh for the front plugin, and every publish writes
  minLauncher into the feed. Patrick, 28 Sep: "People should not be allowed in
  at all if they don't join from our launcher."

  Two parts:
    - the minLauncher block of Publish-Update.ps1, lifted out between its
      markers with Set-Prop and Val and run against feeds made here;
    - the wiring, read out of the launcher's source: what Discord.Pass sends
      and accepts, when the Shell fetches, renews and forgets a pass, where
      JoinPass leaves it, and that a log can never carry one.
  tests\test-updater.ps1 compiles the launcher and runs Updater.FeedUrl, the
  half that stops config.json switching the update check off.

  Read only. Never connects to anything.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $here
$app = Join-Path $repo 'launcher\app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Read-Text([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }

# ---- nothing publishes a launcher field (#4825) -----------------------------
# minLauncher, the floor the site's join pass reads, was written by every
# publish as the launcher the feed offered. Since #4825 the launcher goes out
# only through Velopack, and neither Publish-Update nor Ship writes any of the
# feed's launcher fields or sends a launcher: the feed keeps the ones it has,
# the last launcher it sent and its floor.
$pub = Read-Text (Join-Path $repo 'scripts\release\Publish-Update.ps1')
$ship = Read-Text (Join-Path $repo 'scripts\release\Ship.ps1')
foreach ($f in 'launcherVersion', 'launcherUrl', 'launcherSha256', 'launcherInputs', 'minLauncher') {
    Yes "Publish-Update.ps1 writes no $f" ($pub -notmatch ("Set-Prop \`$doc '" + $f + "'") -and $pub -notmatch ('\.' + $f + '\s*='))
    Yes "  and Ship.ps1 does not name it at all" (-not $ship.Contains($f))
}
Yes 'Publish-Update.ps1 takes no -Launcher, -VersionOverride or -LauncherInputs' ($pub -notmatch '\[switch\]\$Launcher\b' -and $pub -notmatch '\$VersionOverride' -and $pub -notmatch '\$LauncherInputs')
Yes '  and sends no launcher exe to the site or to the secret scan' ($pub -notmatch 'Get-LauncherExe' -and $pub -notmatch '\$exePath' -and $pub -notmatch '-Binary ')
Yes 'Ship.ps1 passes the publisher no launcher' ($ship -notmatch "pubArgs\['(Launcher|VersionOverride|LauncherInputs)'\]")
Yes '  and builds, installs, fetches or signs none' ($ship -notmatch 'Build-Launcher\.ps1''\) -Root' -and $ship -notmatch "'Install-Launcher\.ps1'" -and
    $ship -notmatch 'Invoke-ReleaseLauncherOnGitHub' -and $ship -notmatch 'Get-ReleaseLauncher' -and $ship -notmatch 'Set-ReleaseLauncherSignature')
Yes 'the packs-gone floor reads the feed''s own minLauncher, which nothing moves' ($pub.Contains("foreach (`$k in 'minLauncher', 'launcherVersion')"))

function Lift([string]$src, [string]$head) {
    $at = $src.IndexOf($head)
    if ($at -lt 0) { return '' }
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        if ($src[$i] -eq '{') { $depth++ }
        elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) } }
    }
    return ''
}

# ---- the launcher asks for a pass and hands it to the game -----------------
$discord = Read-Text (Join-Path $app 'Discord.cs')
$passAt = $discord.IndexOf('public static string Pass(int profileId, out string key, out string why)')
Yes 'Discord.Pass is in Discord.cs' ($passAt -gt 0)
$passSrc = if ($passAt -gt 0) { Lift $discord 'public static string Pass(int profileId, out string key, out string why)' } else { '' }
Yes 'it posts to the site''s /api/play/pass' ($passSrc -match 'PostJson\(Site \+ "/api/play/pass"')
Yes 'with the Discord ticket, the character, the channel and this launcher''s version' (
    $passSrc -match '\\"ticket\\"' -and $passSrc -match '\\"profileId\\"' -and
    $passSrc -match '\\"channel\\"' -and $passSrc -match 'Escape\(Updater\.Version\)')
Yes 'an unlinked copy asks nothing and says why' ($passSrc -match 'if \(!Linked\)[\s\S]{0,120}return "";')
Yes 'only a 200 carrying a pass of the jp1 shape is taken' ($passSrc -match 'code == 200' -and $passSrc -match '\^jp1\\\\\.\[A-Za-z0-9_-\]\+\\\\\.\[A-Za-z0-9_-\]\+\$')
Yes 'a refusal hands back the site''s own sentence' ($passSrc -match 'why = Field\(reply, "message"\);')
Yes 'the pass''s own key is taken only beside a pass, and only in its shape (#1320)' (
    $passSrc -match 'string k = Field\(reply, "key"\);' -and $passSrc -match '\^\[A-Za-z0-9_-\]\{16,128\}\$"\)\) key = k;' -and
    $passSrc -match 'key = "";')
Yes 'a log sent from this machine has any join pass taken out (Scrub)' ($discord -match '\\bjp1\\\.\[A-Za-z0-9_-\]\{8,\}\\\.\[A-Za-z0-9_-\]\{8,\}", "jp1\.\[join pass removed\]"')

$jp = Read-Text (Join-Path $app 'JoinPass.cs')
Yes 'JoinPass leaves the pass where the front plugin reads it' ($jp -match 'Path\.Combine\(Paths\.Game, "Data\\\\Platform\\\\thornswood-pass\.txt"\)')
$renew = [regex]::Match($jp, 'const int RenewMinutes = (\d+);')
Yes 'it renews well inside the ten minutes a pass lives' ($renew.Success -and [int]$renew.Groups[1].Value -ge 1 -and [int]$renew.Groups[1].Value -le 5)
Yes 'a failed fetch is tried again a minute later' ($jp -match 'const int RetryMinutes = 1;' -and $jp -match 'due = DateTime\.UtcNow\.AddMinutes\(RetryMinutes\);')
Yes 'a fetch for a character no longer picked is thrown away' ($jp -match 'if \(id != profile\) return;')
Yes 'the pass is never in a line it says or logs: it is only ever written to its file' (
    $jp -notmatch '\+\s*pass\b' -and $jp -notmatch '\bpass\s*\+' -and $jp -notmatch 'say\(pass' -and
    @([regex]::Matches($jp, '[(,]\s*pass\s*\)')).Count -eq 1 -and $jp -match 'File\.WriteAllText\(FilePath, pass\)')
Yes 'Forget deletes the last session''s pass' ($jp -match 'public static void Forget\(\)[\s\S]{0,300}File\.Delete\(FilePath\)')
Yes 'and its key' ($jp -match 'public static void Forget\(\)[\s\S]{0,500}File\.Delete\(KeyPath\)')
Yes 'the key goes straight in Data\Platform, which no release carries (#1320)' ($jp -match 'Path\.Combine\(Paths\.Game, "Data\\\\Platform\\\\thornswood-pass-key\.txt"\)')
$keyAt = $jp.IndexOf('File.WriteAllText(KeyPath')
$passWriteAt = $jp.IndexOf('File.WriteAllText(FilePath, pass)')
Yes 'the key is written before the pass, named by the pass''s mac, so the front plugin never pairs a key with another pass' (
    $keyAt -gt 0 -and $passWriteAt -gt $keyAt -and $jp -match 'File\.WriteAllText\(KeyPath, pass\.Substring\(pass\.LastIndexOf\(''\.''\) \+ 1\) \+ " " \+ key\)')
Yes 'a site with no key leaves no old key behind' ($jp -match 'else if \(File\.Exists\(KeyPath\)\) File\.Delete\(KeyPath\);')
Yes 'the key is never in a line it says or logs' ($jp -notmatch 'say\([^)]*key' -and $jp -notmatch 'Note\([^)]*\bkey\b\s*\)')

$chars = Read-Text (Join-Path $app 'ShellChars.cs')
$poll = Lift $chars 'static void PollChoice()'
Yes 'PollChoice renews the pass on every tick, before it looks for a new choice' (
    $poll -match 'JoinPass\.Tick\(PresenceLog\);[\s\S]*if \(id <= 0 \|\| id == chosenId\) return;')
Yes 'and fetches one at once for a character just picked' ($poll -match 'chosenId = id;\s*JoinPass\.For\(id, PresenceLog\);')
$start = Lift $chars 'static void StartPlay()'
Yes 'Play forgets the last session''s pass before the game starts' ($start -match 'JoinPass\.Forget\(\);[\s\S]*Play\(\);\s*\}$')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
