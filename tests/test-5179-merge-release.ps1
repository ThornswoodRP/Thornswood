<#
  test-5179-merge-release.ps1

      pwsh -NoProfile -File .\tests\test-5179-merge-release.ps1

  Issue #5179 (plan parts 7, 9 and 13). One signed Release for every merge
  that changes what Thornswood ships, every part on it, and a Deployment to
  Dev for it (.github\workflows\merge-release.yml). This holds the pieces it
  runs, with no network:
    - MergeRelease.ps1: the tag and the Velopack version from the day and
      the names it already has; where the notes start when the Release
      before is from a rewritten history; the print of each part, leaving
      out the gamemode's stamp, the server zip and the game files' list,
      which differ on every merge;
      the parts that changed since the Release before (all of them when there
      is none, never velopack or main, the two Velopack packages); and the
      Release before read from a planted list: drafts and other tags skipped,
      a manifest that names another tag refused.
    - New-SignedManifest.ps1 -Add and -LauncherVersion: the parts it may add,
      each a list, refused for an unknown part, a missing file, two files of
      one name in a part or across parts, an agent Release, or a launcher
      number with no launcher; the part main listed in the manifest and held
      in held\, never in the Release's assets (#5181).
    - Build-GameFiles.ps1 -SkipStage: game.zip and game-files.json, the same
      bytes when built twice and when the files' times differ, sorted by
      path, every *.pdb left out; and its gone list (#4825) from the record
      staged and the Release before's list, a path it ships never gone.
    - merge-release.yml: what starts it, signing and the draft in the release
      environment, the notes before anything is built, the launcher built
      with the package's version, the game files built against the Release
      before's list, the setup files and a Velopack package for each of dev
      and main, dev's published with its installer and main's held as an
      attested artifact for the approval (#5181), the attestation on every
      file, the site, the Discord bot and voice zipped as parts (#5190,
      #5187), and the Deployments: Dev when a part dev runs changed, Site and
      Discord bot when theirs did. No other workflow makes one.

  Writes only under its own folder in TEMP, which it removes. Exit 1 when
  any check fails.
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
function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Put([string]$p, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text)
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('test-5179-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$commit = 'a' * 40
try {
    . (Join-Path $Repo 'scripts/release/MergeRelease.ps1')

    # ---- the names ----------------------------------------------------------------
    $n = New-MergeReleaseNames -Utc ([DateTime]::new(2026, 11, 1, 23, 30, 0, [DateTimeKind]::Utc)) -Taken @('build-20261101.1', 'build-20261101.6', 'build-20261031.9', 'v1.2.16', 'agent-v1.0.30')
    Yes 'the tag is build-<yyyyMMdd>.<n>, n one past the day''s highest, and the Velopack version <yyyy>.<M*100+d>.<n>' ($n.Tag -eq 'build-20261101.7' -and $n.Velopack -eq '2026.1101.7')
    $f = New-MergeReleaseNames -Utc ([DateTime]::new(2026, 11, 2, 0, 0, 0, [DateTimeKind]::Utc)) -Taken @('build-20261101.6')
    Yes '  and a new day starts at 1' ($f.Tag -eq 'build-20261102.1')
    $j = New-MergeReleaseNames -Utc ([DateTime]::new(2027, 1, 2, 0, 0, 0, [DateTimeKind]::Utc))
    Yes '  with no leading zero, so 2 Jan is 102' ($j.Velopack -eq '2027.102.1')
    $later = New-MergeReleaseNames -Utc ([DateTime]::new(2026, 12, 31, 0, 0, 0, [DateTimeKind]::Utc))
    Yes '  and a later day is the higher version' ([version]$later.Velopack -gt [version]$n.Velopack)

    # ---- where the notes start, across a rewritten history ------------------------
    $g = Join-Path $tmp 'hist'
    New-Item -ItemType Directory -Force -Path $g | Out-Null
    function G { & git -C $g -c user.name=t -c user.email=t@t -c commit.gpgsign=false @args 2>&1 | Out-Null }
    G init -q -b main
    G commit -q --allow-empty -m 'first (#10)'
    G commit -q --allow-empty -m 'the Release before (#11)'
    $here = "$(git -C $g rev-parse HEAD)".Trim()
    G commit -q --allow-empty -m 'after it (#12)'
    $none = { param($c) throw 'not asked' }
    Yes 'the notes start at the Release before''s commit when this history holds it' ((Resolve-MergeReleaseSince -Commit $here -Subject $none -RepoDir $g) -eq $here)
    $gone = 'f' * 40
    $got = Resolve-MergeReleaseSince -Commit $gone -Subject { param($c) 'the Release before (#11)' } -RepoDir $g
    Yes '  and at the same merge, by its pull request number, when the history was rewritten' ($got -eq $here)
    $threw = $false; try { Resolve-MergeReleaseSince -Commit $gone -Subject { param($c) 'no number here' } -RepoDir $g | Out-Null } catch { $threw = $true }
    Yes '  a commit not here whose title names no pull request stops it' $threw
    $threw = $false; try { Resolve-MergeReleaseSince -Commit $gone -Subject { param($c) 'gone (#99)' } -RepoDir $g | Out-Null } catch { $threw = $_.Exception.Message -match '0 commits here end in \(#99\)' }
    Yes '  and so does one whose merge is not in this history' $threw

    # ---- the prints and what changed ------------------------------------------------
    # The launcher's print is the manifest's launcherVersion, its source
    # number, not its files (#4825), so each stand-in manifest carries one.
    function M($parts, [string]$lv = '2026.1031.1915') { [pscustomobject]@{ tag = 'build-1'; launcherVersion = $lv; parts = [pscustomobject]$parts } }
    function F($name, $sha) { [pscustomobject]@{ name = $name; sha256 = $sha; size = 1 } }
    $base = [ordered]@{
        gamemode = @((F 'gamemode.js' 'aa'), (F 'thornswood-build.json' 's1'))
        bot      = @((F 'bot.js' 'bb'))
        server   = @((F 'server-x.zip' 'z1'), (F 'server-build.json' 'r1'))
        launcher = @((F 'Thornswood.exe' 'ee'))
        game     = @((F 'game.zip' 'g1'), (F 'game-files.json' 'l1'))
        velopack = @((F 'releases.dev.json' 'v1'))
        main     = @((F 'releases.main.json' 'w1'))
    }
    $same = [ordered]@{
        gamemode = @((F 'thornswood-build.json' 's2'), (F 'gamemode.js' 'AA'))
        bot      = @((F 'bot.js' 'bb'))
        server   = @((F 'server-x.zip' 'z2'), (F 'server-build.json' 'r1'))
        launcher = @((F 'Thornswood.exe' 'ee'))
        game     = @((F 'game.zip' 'g1'), (F 'game-files.json' 'l2'))
        velopack = @((F 'releases.dev.json' 'v2'))
        main     = @((F 'releases.main.json' 'w2'))
    }
    function Copy-Parts($h) { $o = [ordered]@{}; foreach ($k in $h.Keys) { $o[$k] = $h[$k] }; return $o }
    $prev = M $base
    Yes 'a print is the files'' names and sha256, sorted, in lower case' ((Get-MergeReleasePrint (M $same) 'gamemode') -eq 'gamemode.js:aa' -and (Get-MergeReleasePrint $prev 'bot') -eq 'bot.js:bb')
    Yes '  and a part the manifest lacks prints as nothing' ((Get-MergeReleasePrint $prev 'site') -eq '')
    $none = @(Get-MergeReleaseChanged -Manifest (M $same) -Previous $prev)
    Yes 'nothing changed when only the stamp, the server zip, the game list and the two packages differ' ($none.Count -eq 0)
    $c = Copy-Parts $same; $c['server'] = @((F 'server-x.zip' 'z3'), (F 'server-build.json' 'r2'))
    $c['game'] = @((F 'game.zip' 'g2'), (F 'game-files.json' 'l3'))
    $got = @(Get-MergeReleaseChanged -Manifest (M $c) -Previous $prev)
    Yes 'a new server record and new game files are changes' (($got -join ',') -eq 'server,game')
    $c = Copy-Parts $same; $c['launcher'] = @((F 'Thornswood.exe' 'ff')); $c['site'] = @((F 'site.zip' 'q'))
    $got = @(Get-MergeReleaseChanged -Manifest (M $c '2026.1101.1745') -Previous $prev)
    Yes '  so are a new launcher and a part the Release before did not carry' (($got -join ',') -eq 'launcher,site')
    $c = Copy-Parts $same; $c['launcher'] = @((F 'Thornswood.exe' 'ff'))
    $got = @(Get-MergeReleaseChanged -Manifest (M $c) -Previous $prev)
    Yes '  but a launcher built again from the same sources is not, whatever its bytes' ($got.Count -eq 0)
    $c = Copy-Parts $same
    $got = @(Get-MergeReleaseChanged -Manifest (M $c '2026.1101.1745') -Previous $prev)
    Yes '  and new launcher sources are a change with the same exe' (($got -join ',') -eq 'launcher')
    $c = Copy-Parts $same; $c['after'] = @((F 'verbs.json' 'w1'))
    $got = @(Get-MergeReleaseChanged -Manifest (M $c) -Previous $prev)
    Yes 'the gate''s verbs.json alone in the steps after a deploy is no change (#5186)' ($got.Count -eq 0)
    $c['after'] = @((F 'verbs.json' 'w1'), (F '2484-gates.json' 'p1'))
    $got = @(Get-MergeReleaseChanged -Manifest (M $c) -Previous $prev)
    Yes '  and a step file is' (($got -join ',') -eq 'after')
    $got = @(Get-MergeReleaseChanged -Manifest $prev)
    Yes 'with no Release before, every part but velopack and main has changed' (($got -join ',') -eq 'gamemode,bot,server,launcher,game')
    # Whether this merge makes a Velopack package and builds the launcher for
    # it, from the same prints (ONE NUMBER in MergeRelease.ps1).
    Yes 'a package is made when the launcher''s sources moved' (Test-MergeReleaseVelopack -LauncherVersion '2026.1101.1745' -GameZipSha256 'g1' -Previous $prev)
    Yes '  or the game files did' (Test-MergeReleaseVelopack -LauncherVersion '2026.1031.1915' -GameZipSha256 'g2' -Previous $prev)
    Yes '  or there is no Release before' (Test-MergeReleaseVelopack -LauncherVersion '2026.1031.1915' -GameZipSha256 'g1')
    Yes '  and not when neither moved, so the launcher before is carried' (-not (Test-MergeReleaseVelopack -LauncherVersion '2026.1031.1915' -GameZipSha256 'G1' -Previous $prev))

    # ---- the Release before -----------------------------------------------------------
    $rd = Join-Path $tmp 'releases'
    New-Item -ItemType Directory -Force -Path $rd | Out-Null
    $rels = @(
        @{ id = 1; tag_name = 'build-20261101.9'; draft = $true; assets = @(@{ id = 11; name = 'manifest.json' }) },
        @{ id = 2; tag_name = 'agent-v1.2.3'; draft = $false; assets = @(@{ id = 12; name = 'manifest.json' }) },
        @{ id = 3; tag_name = 'build-20261101.8'; draft = $false; assets = @(@{ id = 13; name = 'notes.txt' }) },
        @{ id = 4; tag_name = 'build-20261101.7'; draft = $false; assets = @(@{ id = 14; name = 'manifest.json' }) },
        @{ id = 5; tag_name = 'build-20261101.6'; draft = $false; assets = @(@{ id = 15; name = 'manifest.json' }) }
    )
    $rf = Join-Path $tmp 'releases.json'
    [IO.File]::WriteAllText($rf, ($rels | ConvertTo-Json -Depth 5))
    [IO.File]::WriteAllText((Join-Path $rd 'build-20261101.7.json'), (@{ tag = 'build-20261101.7'; commit = $commit; parts = @{} } | ConvertTo-Json))
    $p = Get-MergeReleasePrevious -ReleasesFile $rf -ManifestDir $rd
    Yes 'the Release before is the newest published build-* with a manifest, drafts and agent tags skipped' ($null -ne $p -and $p.Tag -eq 'build-20261101.7' -and $p.Commit -eq $commit -and $p.Id -eq 4)
    [IO.File]::WriteAllText((Join-Path $rd 'build-20261101.7.json'), (@{ tag = 'build-20261101.5'; commit = $commit; parts = @{} } | ConvertTo-Json))
    $threw = $false; try { Get-MergeReleasePrevious -ReleasesFile $rf -ManifestDir $rd | Out-Null } catch { $threw = $_.Exception.Message -match 'says it is build-20261101\.5' }
    Yes '  a manifest that names another tag is refused' $threw
    [IO.File]::WriteAllText($rf, '[]')
    Yes '  and with no build Release yet there is none' ($null -eq (Get-MergeReleasePrevious -ReleasesFile $rf -ManifestDir $rd))

    # ---- main's launcher package, for promote-main.yml (#5181) ---------------------
    Yes 'build tags order by day, then number' ((Get-MergeReleaseOrder 'build-20261102.2') -gt (Get-MergeReleaseOrder 'build-20261101.10') -and
        (Get-MergeReleaseOrder 'build-20261101.10') -gt (Get-MergeReleaseOrder 'build-20261101.9') -and (Get-MergeReleaseOrder 'main-build-20261101.5') -eq -1)
    $pkgSha = ('a' * 64); $feedSha = ('b' * 64)
    function MM([string]$tag, [string]$lv, [string]$game, [bool]$withMain) {
        $parts = [ordered]@{ game = @([ordered]@{ name = 'game.zip'; sha256 = $game; size = 1 }) }
        if ($withMain) { $parts['main'] = @([ordered]@{ name = 'Thornswood-2026.1101.5-full.nupkg'; sha256 = $pkgSha; size = 1 }, [ordered]@{ name = 'releases.main.json'; sha256 = $feedSha; size = 1 }) }
        [pscustomobject]@{ tag = $tag; commit = ('c' * 40); launcherVersion = $lv; parts = [pscustomobject]$parts }
    }
    function Rel([int]$id, [string]$tag, [bool]$draft, $assets) { [ordered]@{ id = $id; tag_name = $tag; draft = $draft; assets = @($assets) } }
    function Asset([int]$id, [string]$name, [string]$sha) { [ordered]@{ id = $id; name = $name; digest = $(if ($sha) { 'sha256:' + $sha } else { $null }) } }
    $md = Join-Path $tmp 'main-manifests'
    New-Item -ItemType Directory -Force -Path $md | Out-Null
    function Write-Rels($list) { $f = Join-Path $tmp ('rels-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json'); [IO.File]::WriteAllText($f, (ConvertTo-Json @($list) -Depth 6)); return $f }
    function Write-M($m) { [IO.File]::WriteAllText((Join-Path $md ($m.tag + '.json')), ($m | ConvertTo-Json -Depth 6)) }
    $lv = '2026.1031.1915'
    $promoted = MM 'build-20261102.2' $lv 'g1' $false
    Write-M (MM 'build-20261102.3' $lv 'g1' $true)
    Write-M (MM 'build-20261101.5' $lv 'g1' $true)
    Write-M (MM 'build-20261101.4' $lv 'g0' $true)
    $base5181 = @(
        (Rel 1 'build-20261102.3' $false @(Asset 101 'manifest.json' '')),
        (Rel 2 'build-20261102.2' $false @(Asset 102 'manifest.json' '')),
        (Rel 3 'build-20261102.1' $true @(Asset 103 'manifest.json' '')),
        (Rel 4 'build-20261101.5' $false @(Asset 104 'manifest.json' '')),
        (Rel 5 'build-20261101.4' $false @(Asset 105 'manifest.json' ''))
    )
    $pk = Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels $base5181) -ManifestDir $md
    Yes 'a promotion of a Release that made no package puts out the newest one before it, never a later one' (
        $null -ne $pk -and $pk.From -eq 'build-20261101.5' -and $pk.MainTag -eq 'main-build-20261101.5' -and $pk.Commit -eq ('c' * 40) -and -not $pk.Published)
    $own = MM 'build-20261102.2' $lv 'g1' $true
    $pk = Find-MainPackage -Tag 'build-20261102.2' -Manifest $own -ReleasesFile (Write-Rels $base5181) -ManifestDir $md
    Yes '  and its own when it made one' ($null -ne $pk -and $pk.From -eq 'build-20261102.2' -and $pk.MainTag -eq 'main-build-20261102.2')
    Write-M (MM 'build-20261101.5' '2026.1030.1200' 'g1' $true)
    $why = ''; try { Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels $base5181) -ManifestDir $md | Out-Null } catch { $why = $_.Exception.Message }
    Yes ('  a package before it of another launcher is not taken: ' + $why) ($why -match 'so no package goes with build-20261102\.2')
    Write-M (MM 'build-20261101.5' $lv 'g1' $true)
    $out5 = { param($assets, $draft) @($base5181) + @(Rel 9 'main-build-20261101.5' $draft $assets) }
    $pk = Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels (& $out5 @((Asset 201 'Thornswood-2026.1101.5-full.nupkg' $pkgSha), (Asset 202 'releases.main.json' $feedSha)) $false)) -ManifestDir $md
    Yes 'main-<tag> out already with exactly the record''s files is left as it is' ($null -ne $pk -and $pk.Published)
    $why = ''; try { Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels (& $out5 @((Asset 201 'Thornswood-2026.1101.5-full.nupkg' ('d' * 64)), (Asset 202 'releases.main.json' $feedSha)) $false)) -ManifestDir $md | Out-Null } catch { $why = $_.Exception.Message }
    Yes ('  one out with another file under a listed name stops it: ' + $why) ($why -match 'is out already and holds a Thornswood-2026\.1101\.5-full\.nupkg')
    $why = ''; try { Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels (& $out5 @() $true)) -ManifestDir $md | Out-Null } catch { $why = $_.Exception.Message }
    Yes ('  and so does one left a draft: ' + $why) ($why -match 'main-build-20261101\.5 is a draft')
    $none = @((Rel 2 'build-20261102.2' $false @(Asset 102 'manifest.json' '')), (Rel 6 'build-20261101.1' $false @(Asset 106 'notes.txt' '')))
    Yes 'with no package made up to it, there is nothing for main''s launcher' ($null -eq (Find-MainPackage -Tag 'build-20261102.2' -Manifest $promoted -ReleasesFile (Write-Rels $none) -ManifestDir $md))
    $why = ''; try { Find-MainPackage -Tag 'build-20261103.1' -Manifest $promoted -ReleasesFile (Write-Rels $base5181) -ManifestDir $md | Out-Null } catch { $why = $_.Exception.Message }
    Yes ('a tag that is not among the Releases read stops it: ' + $why) ($why -match 'not among the hundred newest')
    $rec = MM 'build-20261101.5' $lv 'g1' $true
    $exact = @{ 'Thornswood-2026.1101.5-full.nupkg' = $pkgSha.ToUpperInvariant(); 'releases.main.json' = $feedSha }
    Yes 'the files of main''s package are held to the record by name and sha256' ((Get-MainPackageProblem -Record $rec -Have $exact) -eq '')
    Yes '  a file missing' ((Get-MainPackageProblem -Record $rec -Have @{ 'releases.main.json' = $feedSha }) -match '^lacks Thornswood-2026\.1101\.5-full\.nupkg')
    Yes '  a file the record does not list' ((Get-MainPackageProblem -Record $rec -Have (@{ 'x.exe' = $feedSha } + $exact)) -match '^holds x\.exe, which')
    Yes '  and a listed name with other bytes are each said' ((Get-MainPackageProblem -Record $rec -Have @{ 'Thornswood-2026.1101.5-full.nupkg' = $feedSha; 'releases.main.json' = $feedSha }) -match '^holds a Thornswood-2026\.1101\.5-full\.nupkg that is not')
    Yes '  and a record with no main package is no package' ((Get-MainPackageProblem -Record (MM 'build-20261102.2' $lv 'g1' $false) -Have $exact) -match 'lists no main package')
    function Art([string]$name, [bool]$expired, [string]$branch, [string]$sha, [long]$run) { [pscustomobject]@{ name = $name; expired = $expired; workflow_run = [pscustomobject]@{ id = $run; head_branch = $branch; head_sha = $sha } } }
    $c40 = 'c' * 40
    $arts = @((Art 'main-build-20261101.5' $true 'main' $c40 1), (Art 'main-build-20261101.5' $false 'dev' $c40 2), (Art 'main-build-20261101.5' $false 'main' ('e' * 40) 3), (Art 'main-build-20261101.5' $false 'main' $c40 4))
    $a = Select-MainPackageArtifact -Artifacts $arts -Name 'main-build-20261101.5' -Commit $c40
    Yes 'the artifact taken is the one kept on main at the record''s commit that has not expired' ($a.workflow_run.id -eq 4)
    $why = ''; try { Select-MainPackageArtifact -Artifacts @($arts[0]) -Name 'main-build-20261101.5' -Commit $c40 | Out-Null } catch { $why = $_.Exception.Message }
    Yes ('  an expired one says so: ' + $why) ($why -match 'has expired')
    $why = ''; try { Select-MainPackageArtifact -Artifacts @($arts[3], $arts[3]) -Name 'main-build-20261101.5' -Commit $c40 | Out-Null } catch { $why = $_.Exception.Message }
    Yes '  two is not one' ($why -match '2 artifacts')
    $why = ''; try { Select-MainPackageArtifact -Artifacts @() -Name 'main-build-20261101.5' -Commit $c40 | Out-Null } catch { $why = $_.Exception.Message }
    Yes '  and none says there is none' ($why -match 'no artifact main-build-20261101\.5')

    # ---- New-SignedManifest -Add -------------------------------------------------------
    $nsm = Join-Path $Repo 'scripts/release/New-SignedManifest.ps1'
    $gm = Join-Path $tmp 'in/gamemode.js'; Put $gm '// g'
    $exe = Join-Path $tmp 'in/Thornswood.exe'; Put $exe 'MZ'
    $gz = Join-Path $tmp 'in/game.zip'; Put $gz 'PK'
    $gl = Join-Path $tmp 'in/game-files.json'; Put $gl '{}'
    $other = Join-Path $tmp 'in2/game.zip'; Put $other 'PK2'
    function Run-Nsm([string]$out, [string[]]$extra) {
        $line = "& '$nsm' -Out '$out' -Tag build-20261101.7 -Commit $commit -Part gamemode -Files '$gm' -Repo O/R -NoCatalog " + ($extra -join ' ')
        $null = & pwsh -NoProfile -Command $line 2>&1
        return $LASTEXITCODE
    }
    $o1 = Join-Path $tmp 'm1'
    $rc = Run-Nsm $o1 @("-Add 'launcher=$exe','game=$gz','game=$gl'", '-LauncherVersion 2026.1031.1915')
    $m1 = if ($rc -eq 0) { [IO.File]::ReadAllText((Join-Path $o1 'files/manifest.json')) | ConvertFrom-Json } else { $null }
    Yes 'New-SignedManifest.ps1 -Add puts each part beside the gamemode, with its files and sha256' ($null -ne $m1 -and
        (@($m1.parts.launcher | ForEach-Object { $_.name }) -join ',') -eq 'Thornswood.exe' -and
        (@($m1.parts.game | ForEach-Object { $_.name }) -join ',') -eq 'game.zip,game-files.json' -and
        @($m1.parts.game)[0].sha256 -eq (Sha $gz) -and @($m1.parts.gamemode).Count -eq 1)
    Yes '  and the launcher''s number beside them' ($null -ne $m1 -and [string]$m1.launcherVersion -eq '2026.1031.1915')
    Yes '  and every file in the Release''s assets' ((Test-Path -LiteralPath (Join-Path $o1 'assets/Thornswood.exe')) -and (Test-Path -LiteralPath (Join-Path $o1 'assets/game-files.json')))
    $o2 = Join-Path $tmp 'm2'
    $rc = Run-Nsm $o2 @("-Zip 'velopack=$gz'")
    $m2 = if ($rc -eq 0) { [IO.File]::ReadAllText((Join-Path $o2 'files/manifest.json')) | ConvertFrom-Json } else { $null }
    Yes '  -Zip is the same switch, and one file is still a list' ($null -ne $m2 -and $m2.parts.velopack -is [array] -and -not $m2.PSObject.Properties['launcherVersion'])
    # Main's package (#5181): listed in the one signed record, held back.
    $mf = Join-Path $tmp 'in3/releases.main.json'; Put $mf '{}'
    $o10 = Join-Path $tmp 'm10'
    $rc = Run-Nsm $o10 @("-Add 'velopack=$gz','main=$mf'")
    $m10 = if ($rc -eq 0) { [IO.File]::ReadAllText((Join-Path $o10 'files/manifest.json')) | ConvertFrom-Json } else { $null }
    Yes 'the part main is listed in the manifest with its sha256, beside velopack' ($null -ne $m10 -and
        (@($m10.parts.main | ForEach-Object { $_.name }) -join ',') -eq 'releases.main.json' -and @($m10.parts.main)[0].sha256 -eq (Sha $mf) -and
        (@($m10.parts.velopack | ForEach-Object { $_.name }) -join ',') -eq 'game.zip')
    Yes '  and its files are held in held\, never among the Release''s assets' ((Test-Path -LiteralPath (Join-Path $o10 'held/releases.main.json')) -and
        -not (Test-Path -LiteralPath (Join-Path $o10 'assets/releases.main.json')) -and (Test-Path -LiteralPath (Join-Path $o10 'assets/game.zip')))
    Yes '  a held file may not share a name with a published one' ((Run-Nsm (Join-Path $tmp 'm11') @("-Add 'velopack=$gz','main=$other'")) -ne 0)
    $o12 = Join-Path $tmp 'm12'
    $null = Run-Nsm $o12 @("-Add 'velopack=$gz'")
    Yes '  and a Release with no main part has no held folder' ((Test-Path -LiteralPath (Join-Path $o12 'assets/game.zip')) -and -not (Test-Path -LiteralPath (Join-Path $o12 'held')))
    Yes 'New-SignedManifest.ps1 refuses an unknown part' ((Run-Nsm (Join-Path $tmp 'm3') @("-Add 'agent=$gz'")) -ne 0)
    Yes '  so is a pair that is not part=path' ((Run-Nsm (Join-Path $tmp 'm4') @("-Add '$gz'")) -ne 0)
    Yes '  so is a file that is not there' ((Run-Nsm (Join-Path $tmp 'm5') @("-Add 'game=$tmp/nothing.zip'")) -ne 0)
    Yes '  so are two files of one name in one part' ((Run-Nsm (Join-Path $tmp 'm6') @("-Add 'game=$gz','game=$other'")) -ne 0)
    Yes '  so is a launcher number with no launcher part' ((Run-Nsm (Join-Path $tmp 'm7') @('-LauncherVersion 1.2.3')) -ne 0)
    Yes '  so is a launcher number that is not a.b.c' ((Run-Nsm (Join-Path $tmp 'm8') @("-Add 'launcher=$exe'", '-LauncherVersion v1')) -ne 0)
    $line = "& '$nsm' -Out '$(Join-Path $tmp 'm9')' -Tag agent-v1.2.3 -Version 1.2.3 -Commit $commit -Part agent -Files '$exe' -Repo O/R -NoCatalog -Add 'game=$gz'"
    $null = & pwsh -NoProfile -Command $line 2>&1
    Yes '  and so is -Add on an agent Release' ($LASTEXITCODE -ne 0)

    # ---- Build-GameFiles -SkipStage -------------------------------------------------------
    $bg = Join-Path $Repo 'scripts/release/Build-GameFiles.ps1'
    $root = Join-Path $tmp 'gr'
    Put (Join-Path $root 'Game/Data/b.esp') 'b'
    Put (Join-Path $root 'Game/Data/a.esp') 'a'
    Put (Join-Path $root 'Game/Data/Platform/Plugins/x.dll') 'x'
    Put (Join-Path $root 'Game/Data/Platform/Plugins/x.pdb') 'symbols'
    Put (Join-Path $root 'Game/skse64_loader.exe') 'l'
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g1') -Root $root -Commit $commit -SkipStage 2>&1
    $rc1 = $LASTEXITCODE
    (Get-Item -LiteralPath (Join-Path $root 'Game/Data/a.esp')).LastWriteTimeUtc = [DateTime]::new(2020, 5, 5, 0, 0, 0, [DateTimeKind]::Utc)
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g2') -Root $root -Commit $commit -SkipStage 2>&1
    $rc2 = $LASTEXITCODE
    $z1 = Join-Path $tmp 'g1/game.zip'; $z2 = Join-Path $tmp 'g2/game.zip'
    Yes 'Build-GameFiles.ps1 writes game.zip and game-files.json' ($rc1 -eq 0 -and $rc2 -eq 0 -and (Test-Path -LiteralPath $z1) -and (Test-Path -LiteralPath (Join-Path $tmp 'g1/game-files.json')))
    Yes '  the same bytes when built twice, whatever the files'' times' ((Test-Path -LiteralPath $z2) -and (Sha $z1) -eq (Sha $z2) -and (Sha (Join-Path $tmp 'g1/game-files.json')) -eq (Sha (Join-Path $tmp 'g2/game-files.json')))
    $list = [IO.File]::ReadAllText((Join-Path $tmp 'g1/game-files.json')) | ConvertFrom-Json
    $paths = @($list.files | ForEach-Object { $_.path })
    Yes '  the list is sorted by path, in forward slashes, with each file''s sha256' (($paths -join ',') -eq 'Data/Platform/Plugins/x.dll,Data/a.esp,Data/b.esp,skse64_loader.exe' -and
        @($list.files)[1].sha256 -eq (Sha (Join-Path $root 'Game/Data/a.esp')) -and $list.commit -eq $commit -and $list.schema -eq 1)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $za = [IO.Compression.ZipFile]::OpenRead($z1)
    try { $names = @($za.Entries | ForEach-Object { $_.FullName }); $times = @($za.Entries | ForEach-Object { $_.LastWriteTime.Year } | Sort-Object -Unique) } finally { $za.Dispose() }
    Yes '  the zip holds the same files in the same order, at one fixed time' (($names -join ',') -eq ($paths -join ',') -and ($times -join ',') -eq '2000')
    Yes '  and no *.pdb' (-not ($names -like '*.pdb') -and -not ($paths -like '*.pdb'))
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g3') -Root (Join-Path $tmp 'nothing') -Commit $commit -SkipStage 2>&1
    Yes '  a root with no game folder stops it' ($LASTEXITCODE -ne 0)
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g4') -Root $root -Commit 'abc' -SkipStage 2>&1
    Yes '  and so does a commit that is not 40 hex' ($LASTEXITCODE -ne 0)
    Yes '  with no record staged and no Release before, nothing is gone' ($list.PSObject.Properties['gone'] -and @($list.gone).Count -eq 0)

    # What the release no longer ships (#4825; Build-GameFiles.ps1, WHAT IS
    # GONE): the record's :gone: as it says it, files the Release before
    # listed and this one does not by the sha256 they had, and the sha256
    # entries the Release before carried, unless the record has a word on
    # the path. A path the list ships is never gone.
    $shaA = 'a' * 64; $shaB = 'b' * 64; $shaC = 'c' * 64; $shaD = 'd' * 64
    Put (Join-Path $root 'record/record.json') (([ordered]@{
        'Data\a.esp' = '1:' + (Sha (Join-Path $root 'Game/Data/a.esp'))
        ':gone:Data\old.esp' = 'always'
        ':gone:Data\b.esp' = 'removed'
        ':gone:Data\named.esp' = 'removed'
    }) | ConvertTo-Json)
    $prevList = Join-Path $tmp 'prev/game-files.json'
    Put $prevList (([ordered]@{ schema = 1; commit = $commit; channel = 'dev'; from = 'r1'
        files = @([ordered]@{ path = 'Data/a.esp'; size = 1; sha256 = $shaA }, [ordered]@{ path = 'Data/dropped.esp'; size = 1; sha256 = $shaB },
                  [ordered]@{ path = 'Data/old.esp'; size = 1; sha256 = $shaC })
        gone = @([ordered]@{ path = 'Data/carried.esp'; value = $shaD }, [ordered]@{ path = 'Data/word.esp'; value = 'removed' },
                 [ordered]@{ path = 'Data/named.esp'; value = $shaD })
    }) | ConvertTo-Json -Depth 4)
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g5') -Root $root -Commit $commit -SkipStage -PreviousList $prevList 2>&1
    $rc5 = $LASTEXITCODE
    $g5 = if ($rc5 -eq 0) { [IO.File]::ReadAllText((Join-Path $tmp 'g5/game-files.json')) | ConvertFrom-Json } else { $null }
    $gone = if ($null -ne $g5) { @($g5.gone | ForEach-Object { $_.path + '=' + $_.value }) -join ',' } else { '' }
    Yes ('Build-GameFiles.ps1 lists what is gone, sorted by path: ' + $gone) ($rc5 -eq 0 -and
        $gone -eq ("Data/carried.esp=$shaD,Data/dropped.esp=$shaB,Data/named.esp=removed,Data/old.esp=always"))
    Yes '  and the game zip is the same bytes, the gone list being only in the list' ($rc5 -eq 0 -and (Sha (Join-Path $tmp 'g5/game.zip')) -eq (Sha $z1))
    $badList = Join-Path $tmp 'prev/bad.json'
    Put $badList (([ordered]@{ schema = 1; files = @([ordered]@{ path = 'Data/x.esp'; size = 1; sha256 = 'nope' }) }) | ConvertTo-Json -Depth 4)
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g6') -Root $root -Commit $commit -SkipStage -PreviousList $badList 2>&1
    Yes '  a list before that names a file without a sha256 stops it' ($LASTEXITCODE -ne 0)
    $null = & pwsh -NoProfile -File $bg -Out (Join-Path $tmp 'g7') -Root $root -Commit $commit -SkipStage -PreviousList (Join-Path $tmp 'prev/none.json') 2>&1
    Yes '  and so does a list before that is not there' ($LASTEXITCODE -ne 0)

    # ---- the workflow ----------------------------------------------------------------------
    $wf = [IO.File]::ReadAllText((Join-Path $Repo '.github/workflows/merge-release.yml'))
    Yes 'merge-release.yml runs on main for the game, the launcher, the records and the bot pass' ($wf -match "(?m)^\s+branches: \[main\]\s*$" -and
        $wf -match "(?m)^\s+- 'game/\*\*'\s*$" -and $wf -match "(?m)^\s+- 'launcher/\*\*'\s*$" -and $wf -match "(?m)^\s+- 'records/\*\*'\s*$" -and $wf -match "(?m)^\s+- 'scripts/bot/Bot-Pass\.js'\s*$")
    $self = @('Build-GameFiles.ps1', 'Build-SetupFiles.ps1', 'Source-Notice.ps1', 'MergeRelease.ps1', 'New-SignedManifest.ps1', 'Build-Launcher.ps1', 'Go.ps1', 'Build-Front.ps1') | Where-Object { $wf -notmatch ("(?m)^\s+- 'scripts/release/" + [regex]::Escape($_) + "'\s*$") }
    Yes ('  and for the scripts it runs that decide what is built' + $(if ($self) { ': not ' + ($self -join ', ') } else { '' })) (-not $self)
    Yes '  and for a new step after a deploy, carried as the part after with the gate''s verbs (#5186)' ($wf -match "(?m)^\s+- 'deploy/after/\*\.json'\s*$" -and
        $wf.Contains("Get-ChildItem -LiteralPath 'deploy\after' -Filter '*.json'") -and $wf.Contains("'after=' + (Resolve-Path 'scripts\vps\gate\verbs.json').Path"))
    Yes '  in the release environment, on main only, one run at a time, a newer merge cancelling the run before (#5398)' ($wf -match '(?m)^\s+environment: release\s*$' -and $wf.Contains("if: `${{ github.ref == 'refs/heads/main' }}") -and $wf -match '(?m)^\s+group: merge-release\s*$' -and $wf -match '(?m)^\s+cancel-in-progress: true\s*$')
    # GitHub refuses the run's token a tag on a commit whose workflow files
    # differ from main's (probe runs 41375894899 and 41376016183, #5398), so
    # only main's newest merge is published; the newer run carries the rest.
    $newestAt = $wf.IndexOf('- name: Is this still main''s newest merge'); $publishAt = $wf.IndexOf('- name: Publish the Release')
    # Four steps wait on it: the Release, main's held package (kept only for
    # a Release that is out), and the two Deployments.
    Yes 'a merge main has moved past publishes nothing and keeps no main package' ($newestAt -gt 0 -and $publishAt -gt $newestAt -and
        $wf.Contains('gh api "repos/$($env:GITHUB_REPOSITORY)/commits/main" --jq .sha') -and $wf.Contains("if ([string]`$head -eq `$env:GITHUB_SHA) { Add-Content -LiteralPath `$env:GITHUB_OUTPUT -Value 'release=yes'; exit 0 }") -and
        ([regex]::Matches($wf, [regex]::Escape("if: `${{ steps.newest.outputs.release == 'yes'"))).Count -eq 4)
    # A merge outside the paths above starts no run, so it cancels nothing and
    # releases nothing: the site fix #5451 was built and dropped that way on
    # 2 Nov. The run main moved past starts one of main's newest merge, and
    # fails when it cannot, rather than leave the change unreleased.
    $newestStep = if ($newestAt -gt 0) { $wf.Substring($newestAt, $publishAt - $newestAt) } else { '' }
    Yes '  and starts a run of main''s newest merge, which releases its changes, or fails' ($newestStep.Contains('gh workflow run merge-release.yml --repo $env:GITHUB_REPOSITORY --ref main') -and
        $newestStep -match 'if \(\$LASTEXITCODE -ne 0\) \{ Write-Host "::error::[^"]*"; exit 1 \}' -and
        $wf -match '(?m)^\s+actions: write\s*$' -and $wf -match '(?m)^  workflow_dispatch:\s*$')
    $notes = $wf.IndexOf('Collect-ReleaseNotes.ps1'); $build = $wf.IndexOf('Build-Launcher.ps1 -Root')
    Yes 'the notes are written before anything is built, and "none" from every pull request is the one line' ($notes -gt 0 -and $build -gt $notes -and $wf.Contains('if ($rc -eq 3)') -and $wf.Contains("NOTHING_TO_TELL: 'Nothing people would notice: every change in this release says none.'"))
    # The notes step itself, run the way GitHub runs a pwsh step: its text
    # between "$ErrorActionPreference = 'stop'" and "exit $LASTEXITCODE",
    # by pwsh -command, over a stand-in Collect-ReleaseNotes.ps1 that answers
    # each exit code. Run 41362111729 (1 Nov 2026) stopped on exit 3, which
    # the step had already taken as "nothing to tell".
    $lines = $wf -split "`r?`n"
    $at = [array]::IndexOf($lines, ($lines | Where-Object { $_ -match '^\s+- name: Write the notes from the merged pull requests\s*$' } | Select-Object -First 1))
    $step = @()
    if ($at -ge 0) {
        $r = $at; while ($r -lt $lines.Count -and $lines[$r] -notmatch '^\s+run: \|\s*$') { $r++ }
        $indent = $null
        for ($i = $r + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^\s*$') { $step += ''; continue }
            $lead = $lines[$i].Length - $lines[$i].TrimStart().Length
            if ($null -eq $indent) { $indent = $lead }
            if ($lead -lt $indent) { break }
            $step += $lines[$i].Substring($indent)
        }
    }
    Yes 'the notes step''s script is found in merge-release.yml' ($step.Count -gt 3 -and ($step -join "`n").Contains('Collect-ReleaseNotes.ps1'))
    $pwsh = (Get-Process -Id $PID).Path
    $stepEnv = 'RUNNER_TEMP', 'GITHUB_OUTPUT', 'GITHUB_SHA', 'GITHUB_REPOSITORY', 'SINCE', 'NOTHING_TO_TELL'
    $before = @{}; foreach ($v in $stepEnv) { $before[$v] = [Environment]::GetEnvironmentVariable($v) }
    foreach ($case in @(@{ Code = 0; Ok = $true; Says = 'a note' }, @{ Code = 3; Ok = $true; Says = 'nothing to tell' }, @{ Code = 2; Ok = $false; Says = 'a pull request with no line' }, @{ Code = 1; Ok = $false; Says = 'GitHub unread' })) {
        $w = Join-Path $tmp ('notes-step-' + $case.Code)
        Put (Join-Path $w 'scripts/release/Collect-ReleaseNotes.ps1') ("param([string]`$Since, [string]`$Until, [string]`$Repo, [string]`$OutFile)`nif (`$OutFile -and $($case.Code) -eq 0) { [IO.File]::WriteAllText(`$OutFile, 'a note') }`nexit $($case.Code)`n")
        $rt = Join-Path $w 'runner-temp'; New-Item -ItemType Directory -Force -Path $rt | Out-Null
        $out = Join-Path $w 'github-output'; Put $out ''
        $file = Join-Path $w 'step.ps1'
        Put $file ("`$ErrorActionPreference = 'stop'`n" + ($step -join "`n") + "`nif ((Test-Path -LiteralPath variable:\LASTEXITCODE)) { exit `$LASTEXITCODE }`n")
        $env:RUNNER_TEMP = $rt; $env:GITHUB_OUTPUT = $out; $env:GITHUB_SHA = $commit; $env:GITHUB_REPOSITORY = 'ThornswoodRP/Thornswood'; $env:SINCE = ''
        $env:NOTHING_TO_TELL = 'Nothing people would notice: every change in this release says none.'
        Push-Location $w
        try { $null = & $pwsh -NoProfile -command ". '$file'" 2>&1; $code = $LASTEXITCODE } finally { Pop-Location }
        $said = [IO.File]::ReadAllText($out)
        $notesFile = Join-Path $rt 'notes.md'
        if ($case.Ok) {
            $body = if (Test-Path -LiteralPath $notesFile) { [IO.File]::ReadAllText($notesFile) } else { '' }
            $want = if ($case.Code -eq 3) { $env:NOTHING_TO_TELL } else { 'a note' }
            Yes ("  the step goes on after $($case.Says) (exit $($case.Code)), with the notes file named (step exit $code)") ($code -eq 0 -and $said.Contains('file=' + $notesFile) -and $body.StartsWith($want))
        } else {
            Yes ("  the step stops on $($case.Says) (exit $($case.Code)) and names no notes file (step exit $code)") ($code -ne 0 -and -not $said.Contains('file='))
        }
    }
    foreach ($v in $stepEnv) { [Environment]::SetEnvironmentVariable($v, $before[$v]) }
    # Whether the launcher moved is its source number against the one the
    # Release before's manifest recorded (Test-MergeReleaseVelopack, checked
    # above), so each manifest records the number for the next run.
    Yes 'the launcher is carried when no package is made, held to the manifest and the signature check' (
        $wf.Contains('try { $ver = Get-LauncherVersion -RepoDir . }') -and $wf.Contains('Get-PublishSignRefusal') -and
        $wf.Contains('Test-MergeReleaseVelopack -LauncherVersion $ver -GameZipSha256 $env:GAME_SHA -Previous $pm') -and
        ([regex]::Matches($wf, 'New-SignedManifest\.ps1 [^\n]*-LauncherVersion \$env:LAUNCHER_VERSION')).Count -eq 2 -and
        $wf.Contains('LAUNCHER_VERSION: ${{ steps.launcher.outputs.version }}') -and $wf.Contains('Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value ("version=" + $ver)'))
    Yes '  and built with the package''s version when one is (#4825), then signed through Sign-OnRunner.ps1' ($wf.Contains('Build-Launcher.ps1 -Root $root -NoSign -NoPause -Version $env:VERSION') -and
        $wf.Contains('VERSION: ${{ steps.names.outputs.velopack }}') -and $wf.Contains('./scripts/release/Sign-OnRunner.ps1 -Path @(Get-ChildItem -LiteralPath $dir -File'))
    Yes '  and a launcher built for no package, or a package with a carried launcher, stops the run' ($wf.Contains('if ($velopack -ne $env:LAUNCHER_BUILT)'))
    $gameAt = $wf.IndexOf('- name: Build the game files over dev''s last release'); $launcherAt = $wf.IndexOf('- name: The launcher, built and signed or carried')
    Yes 'the game files are built first, against the Release before''s list held to its manifest (#4825)' ($gameAt -gt 0 -and $launcherAt -gt $gameAt -and
        $wf.Contains("gh release download `$env:PREVIOUS -R `$env:GITHUB_REPOSITORY -p 'game-files.json'") -and $wf.Contains("`$a['PreviousList'] = `$plist") -and
        $wf.Contains('is not the one its manifest names'))
    Yes 'the setup files are built for dev and for main' ($wf.Contains("foreach (`$ch in 'dev', 'main')") -and
        $wf.Contains("Build-SetupFiles.ps1 -Out `$out -GameRoot (Join-Path `$env:RUNNER_TEMP 'game-root') -Channel `$ch") -and $wf.Contains('"setup-files.$ch.json"'))
    Yes 'Velopack is pinned and packs both channels from the same files, signing its programs only' ($wf -match "VPK_VERSION: '\d+\.\d+\.\d+'" -and $wf.Contains('--channel $ch') -and
        -not $wf.Contains('--noInst') -and $wf.Contains("--signExclude '[\\/]Game[\\/]'") -and $wf.Contains('Sign-OnRunner.ps1') -and $wf.Contains('--signParallel 1'))
    Yes '  dev with a delta from the Velopack release before, main whole' ($wf.Contains("--channel dev --pre --token `$env:GH_TOKEN") -and $wf.Contains("`$delta = 'BestSpeed'") -and
        $wf.Contains("`$delta = 'None'") -and $wf.Contains('--delta $delta'))
    Yes '  dev''s installer published as Thornswood-Dev-Setup.exe, main''s held as Thornswood-Setup.exe' ($wf.Contains("'Thornswood-Dev-Setup.exe'") -and $wf.Contains("'Thornswood-Setup.exe'") -and
        $wf.Contains("'velopack=' + `$_.FullName") -and $wf.Contains("'main=' + `$_.FullName"))
    Yes '  and runs only when the launcher or the game files changed' ($wf.Contains("if: `${{ steps.changed.outputs.velopack == 'yes' }}") -and $wf.Contains("`$changed -contains 'launcher' -or `$changed -contains 'game'"))
    $publishAt = $wf.IndexOf('- name: Publish the Release'); $keepAt = $wf.IndexOf('- name: Keep main''s package for the approval')
    Yes 'main''s package is attested and kept with the run for the approval, once the Release is out, never published here (#5181)' ($keepAt -gt $publishAt -and $publishAt -gt 0 -and
        $wf.Contains('subject-path: ${{ steps.files.outputs.held_subjects }}') -and $wf -match 'uses: actions/upload-artifact@[0-9a-f]{40} # v' -and
        $wf.Contains('name: main-${{ steps.names.outputs.tag }}') -and $wf.Contains('path: ${{ steps.files.outputs.held }}') -and
        $wf.Contains("Get-ChildItem -LiteralPath (Join-Path `$env:DIR 'assets') -File"))
    Yes 'every file of the Release is attested, by a pinned action' ($wf -match 'uses: actions/attest-build-provenance@[0-9a-f]{40} # v' -and $wf.Contains('subject-path: ${{ steps.files.outputs.subjects }}') -and
        $wf -match '(?m)^\s+id-token: write\s*$' -and $wf -match '(?m)^\s+attestations: write\s*$')
    Yes 'a merge that changed nothing publishes nothing' ($wf.Contains("release=") -and ([regex]::Matches($wf, [regex]::Escape("if: `${{ steps.changed.outputs.release == 'yes' }}"))).Count -ge 4)
    Yes 'the Release is published from a draft, as a prerelease, never as latest, with the notes as its body' ($wf.Contains('--draft --prerelease') -and $wf.Contains('--draft=false') -and $wf.Contains('--latest=false') -and $wf.Contains('--notes-file $env:NOTES'))
    Yes 'the Deployment goes to Dev with the Release''s tag, which the agent applies' ($wf.Contains("environment = 'Dev'") -and $wf.Contains('payload = [ordered]@{ release = $env:TAG }'))
    # The site, the Discord bot and voice (#5190, #5187).
    $appsAt = $wf.IndexOf('- name: Zip the site, the Discord bot and voice'); $stampAt = $wf.IndexOf('- name: Stamp the gamemode and see what changed')
    Yes 'the site, the Discord bot and voice are zipped by App-Part.ps1 before the parts are compared' ($appsAt -gt 0 -and $stampAt -gt $appsAt -and
        $wf.Contains("foreach (`$p in 'site', 'discord', 'voice')") -and $wf.Contains('./scripts/release/App-Part.ps1 -Part $p -Out $zip'))
    Yes '  and each is a part of every Release' ($wf.Contains('"site=$($env:SITE_ZIP)", "discord=$($env:DISCORD_ZIP)", "voice=$($env:VOICE_ZIP)"'))
    $appPaths = @(@('site/server.js', 'site/lib/**', 'site/public/**', 'site/data/site/**', 'bot/bot.py', 'bot/dev-channel.txt', 'bot/staff-channel.txt', 'bot/requirements.txt', 'bot/assets/join-card.png',
        'voice/voice-server.js', 'voice/headlines.js', 'scripts/vps/Server-Log.js', 'scripts/release/App-Part.ps1') | Where-Object { $wf -notmatch ("(?m)^\s+- '" + [regex]::Escape($_) + "'\s*$") })
    Yes ('  and a merge that changes one of their files starts it' + $(if ($appPaths) { ': not ' + ($appPaths -join ', ') } else { '' })) ($appPaths.Count -eq 0)
    Yes 'dev gets a Deployment only when a part dev runs changed' ($wf.Contains("if: `${{ steps.newest.outputs.release == 'yes' && steps.changed.outputs.dev == 'yes' }}") -and
        $wf.Contains("`$dev = @(`$changed | Where-Object { `$_ -notin 'site', 'discord' })"))
    Yes 'the site and the bot each get a Deployment of their own with the part beside the tag' ($wf.Contains("`$where = @{ site = 'Site'; discord = 'Discord bot' }") -and
        $wf.Contains('payload = [ordered]@{ release = $env:TAG; part = $part }') -and $wf.Contains("if: `${{ steps.newest.outputs.release == 'yes' && steps.changed.outputs.apps != '' }}"))
    # The tables the gamemode reads (#5191) ride the gamemode part.
    Yes 'the gamemode part carries gamemode-tables.zip, zipped by App-Part.ps1, in the compare and the signed Release' ($wf.Contains('./scripts/release/App-Part.ps1 -Part tables -Out $tables') -and
        $wf.Contains('-Part gamemode -Files $gm, $stamp, $tables -BotFiles') -and $wf.Contains('-Part gamemode -Files $env:GAMEMODE, $env:STAMP, $env:TABLES -BotFiles') -and
        $wf.Contains('TABLES: ${{ steps.changed.outputs.tables }}'))
    $tz1 = Join-Path $tmp 'tables1/gamemode-tables.zip'; $tz2 = Join-Path $tmp 'tables2/gamemode-tables.zip'
    & pwsh -NoProfile -File (Join-Path $Repo 'scripts/release/App-Part.ps1') -Part tables -Out $tz1 -RepoDir $Repo *> $null; $e1 = $LASTEXITCODE
    Start-Sleep -Milliseconds 1100
    & pwsh -NoProfile -File (Join-Path $Repo 'scripts/release/App-Part.ps1') -Part tables -Out $tz2 -RepoDir $Repo *> $null; $e2 = $LASTEXITCODE
    $want = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'game/gamemode-tables') -File -Filter '*.json' | Where-Object { $_.Name -cmatch '^[A-Z][A-Z0-9_]*\.json$' } | ForEach-Object { $_.Name } | Sort-Object)
    $got = @()
    if ($e1 -eq 0 -and (Test-Path -LiteralPath $tz1)) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($tz1); try { $got = @($z.Entries | ForEach-Object { $_.FullName } | Sort-Object) } finally { $z.Dispose() }
    }
    Yes ('  with every table at the top of the zip (' + $want.Count + ' tables)') ($e1 -eq 0 -and $want.Count -gt 0 -and (($got -join '|') -ceq ($want -join '|')))
    Yes '  and the same tables give the same bytes, so a merge that changed none leaves the gamemode part unchanged' ($e2 -eq 0 -and (Test-Path -LiteralPath $tz2) -and
        (Get-FileHash -LiteralPath $tz1).Hash -eq (Get-FileHash -LiteralPath $tz2).Hash)
    $wfs = @(Get-ChildItem -LiteralPath (Join-Path $Repo '.github/workflows') -Filter *.yml -File | Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'Record-Deployment|gamemode-release' } | ForEach-Object { $_.Name })
    Yes ('no other workflow records a Deployment or names the old gamemode release' + $(if ($wfs) { ': ' + ($wfs -join ', ') } else { '' })) ($wfs.Count -eq 0 -or ($wfs.Count -eq 2 -and $wfs -contains 'merge-release.yml' -and $wfs -contains 'release-files.yml' -and
        -not ([IO.File]::ReadAllText((Join-Path $Repo '.github/workflows/release-files.yml'))).Contains('deployments: write')))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
