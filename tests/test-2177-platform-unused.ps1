<#
  test-2177-platform-unused.ps1

      pwsh -NoProfile -File .\tests\test-2177-platform-unused.ps1

  Issue #2177. Five files under Data\Platform that nothing uses stop shipping
  and every install loses them on the next release (Patrick, 15 Oct):

      Data\Platform\Images\lock.png
      Data\Platform\Images\speaking.png
      Data\Platform\Fonts\ChainLink.spritefont
      Data\Platform\Fonts\NoticeIcon.spritefont
      Data\Platform\Fonts\VoiceIcon.spritefont

  They are two pictures dated 12 Sep and three icon sprite fonts dated 14 Sep,
  none of them in the SkyMP fork, and nobody recorded who made them. The way
  out is the one the retired dresser and Elysium Estate's old plugin took:
  Ship-Rules.ps1 calls them not ours and puts them on the list every pack
  deletes, and OwnGame.Foreign keeps a refresh from copying them back in.

  What it checks:
    1. Nothing in the repository that runs or is served names them: no
       script, launcher source, game plugin or overlay, site, bot or voice
       file, apart from the two rules that keep them out. On a machine with a
       game folder, its front build, client bundle and Modules do not either.
    2. Ship-Rules: each is not ours (no pack or installer carries it), is on
       the list every pack deletes, and is not a runtime path or one machine's
       file. Tavern and Barlow-SemiBold in the same folder still ship, and so
       would any other picture in Images. DIN-Pro-bold and Futura go too, by
       their own list (#1317, tests\test-1317-fonts.ps1).
    3. Publish-Update.ps1's scan, diff, collection filter and always list,
       lifted by text the way test-chargen-gone.ps1 lifts them, name all five
       in delete.txt whether or not the last pack carried them, and leave a
       copy still on the shipping machine out of the pack.
    4. OwnGame.Foreign's line for them, read out of the launcher source,
       matches exactly the five Ship-Rules names and none of their
       neighbours, sits in Foreign before its Data\Platform rules, and the
       rules number went up with a RuleTouches line for Images and Fonts, so
       a folder made before it looks at those two folders again.
    5. The register (records\asset-provenance.json) has both groups as
       withheld, naming the list in Ship-Rules.ps1 that keeps them out.

  Read only, apart from nothing: no file is written.
#>
$ErrorActionPreference = 'Stop'
$env:THORNSWOOD_HARNESS = '1'
$Here = Split-Path -Parent $PSScriptRoot

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

$five = @(
    'Data\Platform\Images\lock.png',
    'Data\Platform\Images\speaking.png',
    'Data\Platform\Fonts\ChainLink.spritefont',
    'Data\Platform\Fonts\NoticeIcon.spritefont',
    'Data\Platform\Fonts\VoiceIcon.spritefont'
)
# Their neighbours, which keep shipping.
$stay = @(
    'Data\Platform\Fonts\Tavern.ttf',
    'Data\Platform\Fonts\Tavern.spritefont',
    'Data\Platform\Fonts\Barlow-SemiBold.spritefont',
    'Data\Platform\Fonts\Barlow-SemiBold-OFL.txt',
    'Data\Platform\Images\other.png'
)
# As whole names: clock.png or a padlock.png is somebody else's.
$nameRe = New-Object System.Text.RegularExpressions.Regex('(?<![A-Za-z0-9_-])(lock\.png|speaking\.png|ChainLink|NoticeIcon|VoiceIcon)(?![A-Za-z0-9_])', [Text.RegularExpressions.RegexOptions]::IgnoreCase)

# ---- 1. nothing names them -----------------------------------------------------
$keepsThemOut = @('scripts\release\Ship-Rules.ps1', 'launcher\app\OwnGame.cs')
function RepoRel($f) { return $f.FullName.Substring($Here.Length).TrimStart('\', '/').Replace('/', '\') }
$sources = @()
foreach ($d in 'scripts', 'launcher', 'game\plugins', 'game\ui', 'site', 'bot', 'voice', 'installer') {
    $p = Join-Path $Here $d
    if (Test-Path -LiteralPath $p) {
        $sources += @(Get-ChildItem -LiteralPath $p -File -Recurse | Where-Object {
            $_.Extension -in '.ps1', '.psm1', '.js', '.cs', '.xaml', '.html', '.css', '.py', '.json', '.ini', '.txt' -and
            (RepoRel $_) -notlike 'scripts\oneoff\*' -and (RepoRel $_) -notlike 'site\node_modules\*' })
    }
}
$naming = @()
foreach ($s in $sources) {
    if ($keepsThemOut -contains (RepoRel $s)) { continue }
    foreach ($m in $nameRe.Matches([IO.File]::ReadAllText($s.FullName))) { $naming += ((RepoRel $s) + ' names ' + $m.Value) }
}
Yes ("no script, launcher source, plugin, overlay, site, bot, voice or installer file names them but the two rules that keep them out ({0} files read)" -f $sources.Count) ($sources.Count -gt 100 -and $naming.Count -eq 0)
foreach ($n in $naming) { Write-Host "      $n" }

# The game folder's own front build, client bundle and Modules, where this
# machine has one. Information for the machine that ships, not a gate.
$inst = [string](& (Join-Path $Here 'scripts\release\Where.ps1') Install)
$game = if ($inst) { ($inst.TrimEnd('\', '/') + '\Game\Data\Platform') } else { '' }
if ($game -and (Test-Path -LiteralPath $game)) {
    $there = @()
    foreach ($sub in 'UI', 'Plugins', 'Modules') {
        $p = "$game\$sub"
        if (Test-Path -LiteralPath $p) {
            $there += @(Get-ChildItem -LiteralPath $p -File | Where-Object { $_.Extension -in '.js', '.ts', '.html', '.css', '.txt' })
        }
    }
    $hits = @()
    foreach ($f in $there) {
        foreach ($m in $nameRe.Matches([IO.File]::ReadAllText($f.FullName))) { $hits += ($f.Name + ' names ' + $m.Value) }
    }
    Yes ("this machine's game folder: build.js, the client bundle and Modules name none of them ({0} files read)" -f $there.Count) ($hits.Count -eq 0)
    foreach ($h in $hits) { Write-Host "      $h" }
} else {
    Write-Host 'SKIP  no game folder on this machine to read the front build and the client bundle in'
}

# ---- 2. Ship-Rules -----------------------------------------------------------------
. (Join-Path $Here 'scripts\release\Ship-Rules.ps1')
Yes 'Ship-Rules lists exactly the five ($ShipPlatformUnused)' (
    @($ShipPlatformUnused).Count -eq 5 -and @($five | Where-Object { @($ShipPlatformUnused) -notcontains $_ }).Count -eq 0)
$always = @(Get-ShipDeleteAlways)
foreach ($r in $five) {
    Yes "$r is not ours, so no pack or installer carries it" ((Test-ShipOtherServer $r) -and (Test-ShipMachine $r))
    Yes "  and every pack deletes it" ($always -contains $r)
    Yes "  and it is neither a runtime path nor one machine's own file" ((-not (Test-ShipRuntime $r)) -and (-not (Test-ShipOneMachine $r)))
}
foreach ($r in $stay) {
    Yes "$r still ships and is not deleted" ((-not (Test-ShipMachine $r)) -and ($always -notcontains $r))
}

# ---- 3. Publish-Update names them in delete.txt --------------------------------------
$pub = [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Publish-Update.ps1'))
$tm   = [regex]::Match($pub, '(?m)^function Test-Machine\(.*$')
$fc   = [regex]::Match($pub, '(?ms)^function Test-FromCollection\(.*?^\}\r?$')
$diff = [regex]::Match($pub, '(?ms)^\$changed = @\(\); \$removed = @\(\)\r?$.*?^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine[^\r\n]*\r?$')
$coll = [regex]::Match($pub, '(?ms)^\$collectionRemovals = .*?^\}\r?$')
$alw  = [regex]::Match($pub, '(?ms)^\$alwaysGone = @\(Get-ShipDeleteAlways\)\r?\nforeach \(\$d in \$alwaysGone\) \{.*?^\}\r?$')
Yes 'Publish-Update.ps1 still has Test-Machine, Test-FromCollection, the diff, the collection filter and the always list to lift' (
    $tm.Success -and $fc.Success -and $diff.Success -and $coll.Success -and $alw.Success)
Yes 'and its scan still leaves out what Test-Machine claims' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
if (-not ($tm.Success -and $fc.Success -and $diff.Success -and $coll.Success -and $alw.Success)) { Done }
. ([scriptblock]::Create($tm.Value))
. ([scriptblock]::Create($fc.Value))
# A profile with no generated record: nothing generated, so the list is empty.
$ProfileDir = Join-Path ([IO.Path]::GetTempPath()) ('ts-2177-profile-' + [Guid]::NewGuid().ToString('N'))

$Dev = $true
$vortexFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[void]$vortexFiles.Add('Data\textures\gone\collection.dds')
function Pack([bool]$lastCarried, [bool]$stillHere) {
    $script:prev = @{}
    if ($lastCarried) { foreach ($r in $five) { $script:prev[$r] = '4168:638935838400000000' } }
    $script:prev['Data\textures\gone\collection.dds'] = '10:1'
    $onDisk = @($stay)
    foreach ($r in $stay) { $script:prev[$r] = '10:1' }
    if ($stillHere) { $onDisk += $five }
    $script:now = @{}
    foreach ($r in $onDisk) {
        if (Test-Machine $r) { continue }
        $script:now[$r] = '10:1'
    }
}
Pack $true $false
. ([scriptblock]::Create($diff.Value))
. ([scriptblock]::Create($coll.Value))
. ([scriptblock]::Create($alw.Value))
Yes 'a pack after one that carried them names all five in delete.txt' (@($five | Where-Object { $removed -notcontains $_ }).Count -eq 0)
Yes 'and removes none of the fonts that stay' (@($stay | Where-Object { $removed -contains $_ }).Count -eq 0)
Yes 'the lifted collection filter is live: a collection file that went is not removed' ($removed -notcontains 'Data\textures\gone\collection.dds')

Pack $false $true
. ([scriptblock]::Create($diff.Value))
. ([scriptblock]::Create($coll.Value))
. ([scriptblock]::Create($alw.Value))
Yes 'a pack whose baseline never carried them still names all five in delete.txt' (@($five | Where-Object { $removed -notcontains $_ }).Count -eq 0)
Yes 'and a copy still on the shipping machine goes into no pack' (@($five | Where-Object { $now.ContainsKey($_) -or $changed -contains $_ }).Count -eq 0)
Yes 'while the fonts that stay are still in the build' (@($stay | Where-Object { -not $now.ContainsKey($_) }).Count -eq 0)

# ---- 4. OwnGame.Foreign keeps a refresh from bringing them back ------------------------
$og = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\OwnGame.cs'))
$fAt = $og.IndexOf('public static bool Foreign(string rel)', [StringComparison]::Ordinal)
$line = [regex]::Match($og, '(?m)^\s*if \(Regex\.IsMatch\(rel, @"(\^Data\\\\Platform\\\\\(Images[^"]*)", I\)\) return true;')
$platformRule = $og.IndexOf('if (!rel.StartsWith("Data\\Platform\\", StringComparison.OrdinalIgnoreCase)) return false;', [StringComparison]::Ordinal)
$pluginsRule = $og.IndexOf('if (Regex.IsMatch(rel, @"^Data\\Platform\\Plugins\\[^\\]+\.js$", I))', [StringComparison]::Ordinal)
Yes 'OwnGame.Foreign has a line for the five' ($fAt -ge 0 -and $line.Success -and $line.Index -gt $fAt)
Yes 'after its Data\Platform guard and before its plugin and UI rules, so nothing ahead of it calls them ours' (
    $line.Success -and $platformRule -gt $fAt -and $line.Index -gt $platformRule -and $pluginsRule -gt $line.Index)
if ($line.Success) {
    $re = New-Object System.Text.RegularExpressions.Regex($line.Groups[1].Value, ([Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [Text.RegularExpressions.RegexOptions]::CultureInvariant))
    $missed = @($ShipPlatformUnused | Where-Object { -not $re.IsMatch($_) })
    Yes 'it matches every one Ship-Rules names, so the two lists are the same five' ($missed.Count -eq 0)
    foreach ($m in $missed) { Write-Host "      not matched: $m" }
    Yes '  in any case of letters, as Windows names them' ($re.IsMatch('data\platform\fonts\chainlink.SPRITEFONT'))
    $wrong = @($stay + @('Data\Platform\Images\lock.png.bak', 'Data\Platform\UI\lock.png', 'Data\Platform\Fonts\ChainLink.ttf') | Where-Object { $re.IsMatch($_) })
    Yes 'and none of their neighbours or a name that only starts the same' ($wrong.Count -eq 0)
    foreach ($w in $wrong) { Write-Host "      matched: $w" }
}
$rulesNum = [regex]::Match($og, '(?m)^\s*const int Rules = (\d+);')
Yes 'OwnGame.Rules went up to 17 or later for it' ($rulesNum.Success -and [int]$rulesNum.Groups[1].Value -ge 17)
Yes 'and rule 17 says it is about Images and Fonts, so an older folder looks at those again' (
    $og -match '\{ 17, new string\[\] \{ "Data\\\\Platform\\\\Images\\\\", "Data\\\\Platform\\\\Fonts\\\\" \} \},')

# ---- 5. the register ----------------------------------------------------------------------
$reg = Get-Content -LiteralPath (Join-Path $Here 'records\asset-provenance.json') -Raw | ConvertFrom-Json
$held = @($reg.notInRepo | Where-Object { $_.status -eq 'withheld' -and $_.record -eq 'scripts/release/Ship-Rules.ps1#ShipPlatformUnused' })
$heldPaths = @($held | ForEach-Object { @($_.paths) })
Yes 'the register has the five as withheld, by the list in Ship-Rules.ps1 that keeps them out' (
    $held.Count -ge 2 -and @($five | Where-Object { $heldPaths -notcontains $_ }).Count -eq 0 -and $heldPaths.Count -eq 5)

Done
