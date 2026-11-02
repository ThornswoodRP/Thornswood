<#
  test-3597-collection-revision.ps1

      pwsh -NoProfile -File .\tests\test-3597-collection-revision.ps1
      powershell -NoProfile -File .\tests\test-3597-collection-revision.ps1

  The collection revision a release names (#3597). Both feeds said revision 2,
  the one One's Vortex had installed, while records\collection-plugins.json
  and Nexus were on 5, so a launcher on 2 read as current and was let in.

  What this proves:
    1. Get-ShipRecordedCollectionRevision (CollectionRevision.ps1) reads the
       committed record's collection and revision, and refuses a record that is
       not there, does not read, or names no whole revision or no collection.
    2. Get-ShipCollectionRevisionProblem passes only a source on the recorded
       revision: one behind, one ahead, one that cannot say, and another
       collection are each refused, naming both numbers and the remedy.
    3. Publish-Update.ps1 asks it on both paths before anything is packed,
       writes the recorded revision into the feed, and no longer writes the
       number Vortex has.
    4. Ship.ps1 asks it on both paths before the version is worked out.
    5. The launcher's bars call the feed's number the revision the server was
       built against, never the collection's own.

  Scratch folders only; no network, no Vortex.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
. (Join-Path $Repo 'scripts\release\CollectionRevision.ps1')

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-3597-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\[repo] & x')
[void][IO.Directory]::CreateDirectory((Join-Path $T 'records'))
$rec = Join-Path (Join-Path $T 'records') 'collection-plugins.json'
function Rec([string]$text) { [IO.File]::WriteAllText($rec, $text, (New-Object Text.UTF8Encoding($false))) }
function Problem([int]$built, [string]$slug = '7essxf') {
    return (Get-ShipCollectionRevisionProblem -RepoDir $T -Path $rec -Built $built -Slug $slug -Source 'the stand-in source' -Remedy 'THE REMEDY.')
}
try {
    # ---- 1. the record -------------------------------------------------------------
    Write-Host ''; Write-Host 'the record'
    $real = Get-ShipRecordedCollectionRevision $Repo
    Yes "the committed record names collection 7essxf at a whole revision ($($real.Revision))" ($real.Slug -eq '7essxf' -and $real.Revision -ge 1)
    $realDoc = [IO.File]::ReadAllText((Join-Path (Join-Path $Repo 'records') 'collection-plugins.json')) | ConvertFrom-Json
    Yes '  the same number the record''s own revision field holds' ($real.Revision -eq [int]$realDoc.revision)

    $stop = ''; try { $null = Get-ShipRecordedCollectionRevision $T $rec } catch { $stop = $_.Exception.Message }
    Yes 'no record is refused, saying nothing names the revision' ($stop -match 'There is no' -and $stop -match 'which collection revision')
    Rec '{ "collection": "7essxf", "revision": 5, '
    $stop = ''; try { $null = Get-ShipRecordedCollectionRevision $T $rec } catch { $stop = $_.Exception.Message }
    Yes 'a record that does not read is refused' ($stop -match 'does not read as JSON')
    foreach ($bad in @('"5"', '0', '-1', 'null', 'true', '2.5')) {
        Rec ('{ "collection": "7essxf", "revision": ' + $bad + ', "plugins": [] }')
        $stop = ''; try { $null = Get-ShipRecordedCollectionRevision $T $rec } catch { $stop = $_.Exception.Message }
        Yes "a revision of $bad is refused" ($stop -match 'names no whole collection revision')
    }
    Rec '{ "revision": 5, "plugins": [] }'
    $stop = ''; try { $null = Get-ShipRecordedCollectionRevision $T $rec } catch { $stop = $_.Exception.Message }
    Yes 'a record naming no collection is refused' ($stop -match 'names no collection')
    [IO.File]::WriteAllText($rec, '{ "collection": "7essxf", "revision": 5, "plugins": [] }', (New-Object Text.UTF8Encoding($true)))
    $r = Get-ShipRecordedCollectionRevision $T $rec
    Yes 'a record with a byte order mark reads the same' ($r.Slug -eq '7essxf' -and $r.Revision -eq 5)

    # ---- 2. the problem --------------------------------------------------------------
    Write-Host ''; Write-Host 'a source on another revision'
    Yes 'a source on the recorded revision passes' ((Problem 5) -eq '')
    $p = Problem 2
    Yes 'a source behind it is refused, naming both numbers' ($p -match 'revision 5' -and $p -match 'is on revision 2' -and $p -match 'stand-in source')
    Yes '  and saying an install left behind would be let in' ($p -match 'would be let in')
    Yes '  and the remedy' ($p.EndsWith('THE REMEDY.'))
    $p = Problem 0
    Yes 'a source that cannot say is refused, never passed' ($p -match 'does not say which collection revision' -and $p -match 'revision 5' -and $p.EndsWith('THE REMEDY.'))
    $p = Problem 6
    Yes 'a source ahead of the record is refused: record it first' ($p -match 'revision 6' -and $p -match 'still on 5' -and $p -match 'New-CollectionPluginRecord' -and $p.EndsWith('THE REMEDY.'))
    $p = Problem 5 'abc123'
    Yes 'another collection is refused, naming both' ($p -match 'abc123' -and $p -match '7essxf')
    Yes 'no slug given compares the revision only' ((Get-ShipCollectionRevisionProblem -RepoDir $T -Path $rec -Built 5 -Source 's' -Remedy 'r') -eq '')
    Remove-Item -LiteralPath $rec -Force
    $p = Problem 5
    Yes 'with no record every source is refused' ($p -match 'There is no')
} finally {
    Remove-Item -LiteralPath (Split-Path -Parent $T) -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 3. Publish-Update.ps1 -----------------------------------------------------------
Write-Host ''; Write-Host 'Publish-Update.ps1'
$pu = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $Repo 'scripts') 'release') 'Publish-Update.ps1')).Replace("`r`n", "`n")
$asks = [regex]::Matches($pu, 'Get-ShipCollectionRevisionProblem -RepoDir \$RepoDir -Built \$ShipCollectionRevision')
Yes 'it asks on both paths, from the feed and from One' ($asks.Count -eq 2)
$held = $pu.IndexOf('loose files held for the collection until then still ship')
Yes '  both before anything is packed' ($held -gt 0 -and $asks.Count -eq 2 -and $asks[1].Index -lt $held)
Yes '  and stops on the answer' (([regex]::Matches($pu, 'if \(\$revWhy\) \{ Die \$revWhy \}')).Count -eq 2)
Yes '  asking One''s Vortex for the collection config.json names' ($pu.Contains('-Slug (Get-CollectionSlug (Get-ShipCollectionUrl $Root))'))
Yes 'it writes the recorded revision, on both paths' ($pu.Contains("Set-Prop `$doc 'collectionRevision' `$ShipCollectionRevision"))
Yes 'and never the number Vortex has, nor keeps the last feed''s quietly' (-not $pu.Contains("Set-Prop `$doc 'collectionRevision' `$rev") -and -not $pu.Contains('so the feed keeps what it had'))

# ---- 4. Ship.ps1 ---------------------------------------------------------------------
Write-Host ''; Write-Host 'Ship.ps1'
$ship = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $Repo 'scripts') 'release') 'Ship.ps1')).Replace("`r`n", "`n")
$sAsks = [regex]::Matches($ship, 'Get-ShipCollectionRevisionProblem -RepoDir \$RepoDir -Built \$revBuilt')
# Where Ship starts building from the root. It read the launcher's number
# there until #4825, when Ship stopped building a launcher.
$bump = $ship.IndexOf("Head 'Animation and body files'")
$root = $ship.IndexOf("Head 'The ship root'")
Yes 'it asks on both paths' ($sAsks.Count -eq 2)
Yes '  after the ship root is staged and before anything is built from it' ($root -gt 0 -and $bump -gt 0 -and $sAsks.Count -eq 2 -and $sAsks[0].Index -gt $root -and $sAsks[1].Index -lt $bump)
Yes '  from the feed, the revision the last release named' ($ship.Contains('$revFeed = Read-SiteFeed $Channel') -and $ship.Contains('the $Channel feed''s last release'))
Yes '  from One, this machine''s Vortex' ($ship.Contains("Get-ShipCollectionRevision `$Root") -and $ship.Contains("this machine's Vortex"))
$stopAt = $ship.IndexOf('if ($revWhy) { Die $revWhy }')
Yes '  and stops on the answer, before anything is built' ($stopAt -gt 0 -and $stopAt -lt $bump)

# ---- 5. the launcher's words ---------------------------------------------------------
Write-Host ''; Write-Host 'the launcher'
$appDir = Join-Path (Join-Path $Repo 'launcher') 'app'
$shell = [IO.File]::ReadAllText((Join-Path $appDir 'Shell.cs'))
$packs = [IO.File]::ReadAllText((Join-Path $appDir 'ShellPacks.cs'))
Yes 'no bar calls the feed''s number the collection''s revision' (-not ($shell + $packs).Contains('"The collection is on revision "'))
Yes 'the behind bar names the revision the server was built against' ($shell.Contains('"The server was built against collection revision " + wants'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
