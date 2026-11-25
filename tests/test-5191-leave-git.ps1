<#
  test-5191-leave-git.ps1

      pwsh -NoProfile -File .\tests\test-5191-leave-git.ps1

  Issue #5191, stage 4e part 3: nothing generated is committed (Patrick's B
  on #5191), so what the box's content build writes leaves git, and every
  reader outside the chain lays the build first. It checks:
    1. every path the build lays (Get-ThornswoodBuiltPaths -NotCommitted) is
       out of git at HEAD and ignored, and .gitignore's block covers that
       list and nothing else; the few content-tables.json names committed (the cut
       decisions) are paths the chain writes, are in git and are not ignored;
    2. every deploy and the Ship lay the dev server's build (the one every
       Release carries) before the artifact or the ship root reads it, and
       the deploys' artifacts and the Last plugin's take the built files from
       it (New-ThornswoodArtifact -Content dev); Deploy-Gamemode.ps1, which
       builds a server folder on a PC, says how to lay it when it is not;
    3. Use-ThornswoodContentBuild takes a laid build that holds without
       asking for another, lays one through Get-ContentBuild.ps1 when none
       is laid, and stops naming why when that fails;
    4. the box build carries what each step wrote, ignored as it is, to the
       steps after it, and a box run sends a built file, or a folder that
       holds only built files (game/content, #6351), only once the commit
       has it, so every step of a build from this commit sends only paths
       the commit holds;
    5. the workflows and cloud sessions that read a table lay a build first,
       and the hourly revision check, which reads none, lays nothing;
    6. the old way is gone: Rebuild-PullTables.ps1, Rebuild-OnBox.ps1, the
       Rebuild-ContentTables verb and Run-OnBox.ps1 -Out.

  Writes only under its own folder in TEMP, which it removes. Exit 1 when
  any check fails.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$pass = 0; $fail = 0
function Check([string]$What, [bool]$Ok) {
    if ($Ok) { $script:pass++; Write-Host "PASS  $What" } else { $script:fail++; Write-Host "FAIL  $What" }
}
function TGit([string]$Dir, [string[]]$Words) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $Dir @Words 2>&1 | ForEach-Object { "$_" }); $c = $LASTEXITCODE } finally { $ErrorActionPreference = $was }
    return [pscustomobject]@{ Code = $c; Out = $o }
}
function Src([string]$Rel) { return [IO.File]::ReadAllText((Join-Path $root $Rel)) }
function Sha([byte[]]$B) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($B)).ToLowerInvariant() }

. (Join-Path $root 'scripts\mods\ContentPaths.ps1')

# ------------------------------------------------------- 1. out of git
$built = @(Get-ThornswoodBuiltPaths -Repo $root -NotCommitted)
$all = @(Get-ThornswoodBuiltPaths -Repo $root)
$doc = (Src 'scripts/mods/content-tables.json') | ConvertFrom-Json
$kept = @($doc.committed.PSObject.Properties | ForEach-Object { $_.Name })
$writes = @((Get-ThornswoodContentPaths -Repo $root).Writes)
Check '1 the build lays the content plugin, the catalogue and the tables, less the committed ones' (
    $built.Count -gt 80 -and $built -ccontains 'game/content/Thornswood-Content.esp' -and $built -ccontains 'game/data/npc-population.json' -and
    @($built | Where-Object { $_.StartsWith('game/gamemode-tables/') }).Count -gt 20 -and $built.Count -eq ($all.Count - $kept.Count))
$tracked = @((TGit $root (@('ls-tree', '-r', '--name-only', '--full-tree', 'HEAD', '--') + $built)).Out | Where-Object { $_ })
Check '1 none of them is in git at HEAD' ($tracked.Count -eq 0)
if ($tracked.Count) { Write-Host ('      in git: ' + (@($tracked | Select-Object -First 5) -join ', ')) }
$notIgnored = @()
foreach ($p in $built) {
    # A folder the chain writes is ignored as a folder, so a file in it is.
    $probe = if ([IO.Path]::GetExtension($p)) { $p } else { $p + '/any.json' }
    if ((TGit $root @('check-ignore', '-q', '--no-index', '--', $probe)).Code -ne 0) { $notIgnored += $p }
}
Check '1 every one is ignored' ($notIgnored.Count -eq 0)
if ($notIgnored.Count) { Write-Host ('      not ignored: ' + (@($notIgnored | Select-Object -First 5) -join ', ')) }
$lines = @((Src '.gitignore') -split "`r?`n")
$at = [Array]::FindIndex([string[]]$lines, [Predicate[string]] { param($l) $l -match '^# What the box''s content build writes \(#5191' })
$block = @()
if ($at -ge 0) {
    for ($i = $at + 1; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($l -match '^#') { continue }
        if (-not $l.Trim()) { break }
        $block += $l.Trim().TrimStart('/').TrimEnd('/')
    }
}
# Each line of the block is a path the build lays, or a folder that holds
# only such paths (the gamemode's tables); and every path is under a line.
$odd = @($block | Where-Object {
    $l = $_
    -not ($built -ccontains $l) -and -not (@($built | Where-Object { $_.StartsWith($l + '/') }).Count -and
        -not @((TGit $root @('ls-tree', '-r', '--name-only', '--full-tree', 'HEAD~0', '--', $l)).Out | Where-Object { $_ }).Count)
})
$uncovered = @($built | Where-Object { $p = $_; -not @($block | Where-Object { $p -ceq $_ -or $p.StartsWith($_ + '/') }).Count })
Check '1 .gitignore''s content build block is that list: each line a built path or a folder of them, and every built path under a line' ($at -ge 0 -and $block.Count -ge 1 -and $odd.Count -eq 0 -and $uncovered.Count -eq 0)
if ($odd.Count -or $uncovered.Count) { Write-Host ('      not built: ' + ($odd -join ', ') + '; not ignored by the block: ' + (@($uncovered | Select-Object -First 5) -join ', ')) }
Check '1 the committed ones are paths the chain writes, each with its reason' (
    $kept.Count -ge 1 -and @($kept | Where-Object { $writes -cnotcontains $_ }).Count -eq 0 -and
    @($doc.committed.PSObject.Properties | Where-Object { ([string]$_.Value).Length -lt 40 }).Count -eq 0)
$keptIn = @((TGit $root (@('ls-tree', '-r', '--name-only', '--full-tree', 'HEAD', '--') + $kept)).Out | Where-Object { $_ })
$keptIgnored = @($kept | Where-Object { (TGit $root @('check-ignore', '-q', '--no-index', '--', $_)).Code -eq 0 })
Check '1 and they are in git and not ignored' ($keptIn.Count -eq $kept.Count -and $keptIgnored.Count -eq 0)

# --------------------------------------------------- 2. the readers lay it
$lay = 'Use-ThornswoodContentBuild -Repo [^\r\n]* -Server dev'
foreach ($f in @('scripts/deploy/Deploy-DevGamemode.ps1', 'scripts/deploy/Deploy-Server.ps1', 'scripts/release/Publish-Server.ps1', 'scripts/release/Ship.ps1')) {
    $s = Src $f
    $m = [regex]::Match($s, $lay)
    $art = $s.IndexOf('New-ThornswoodArtifact -Component gamemode')
    $readsAfter = if ($f -like '*Ship.ps1') { $s.IndexOf('# ------------------------------------------------------------ the ship root') } else { $art }
    Check "2 $(Split-Path -Leaf $f) lays the dev server's build before it reads one" ($m.Success -and $readsAfter -gt $m.Index -and $s -notmatch 'Use-ThornswoodContentBuild [^\r\n]*-Server (main|\$Channel)')
}
foreach ($f in @('scripts/deploy/Deploy-DevGamemode.ps1', 'scripts/deploy/Deploy-Server.ps1', 'scripts/release/Publish-Server.ps1', 'scripts/deploy/LastPluginOnBox.ps1')) {
    $calls = @([regex]::Matches((Src $f), 'New-ThornswoodArtifact -Component [^\r\n]*(\r?\n\s+-[^\r\n]*)?') | ForEach-Object { $_.Value })
    Check "2 $(Split-Path -Leaf $f)'s artifact takes the built files from that build" ($calls.Count -eq 1 -and $calls[0] -match '-Content dev\s*$')
}
# Deploy-Gamemode.ps1 builds a server folder on a PC from whatever gamemode
# it is given, its tables beside it; what goes live is Publish-Server's
# artifact. It lays nothing, and says how when the build is not there.
$dg = Src 'scripts/deploy/Deploy-Gamemode.ps1'
Check '2 Deploy-Gamemode.ps1 names Get-ContentBuild.ps1 -Take when the tables or the Last plugin''s record are not laid' (
    @([regex]::Matches($dg, 'never committed \(#5191\): pwsh scripts\\release\\Get-ContentBuild\.ps1 -Take lays this commit''s over the checkout')).Count -eq 2)
Check '2 the Nexus pack takes a built file from the laid build of this commit, never from git' (
    (Src 'scripts/release/Nexus-Run.ps1') -match 'Get-NexusRunTracked \$RepoRoot \(\$Root \+ ''/'' \+ \$it\)\) \+ @\(Get-NexusRunLaid' -and
    (Src 'scripts/release/Nexus-Run.ps1') -match 'Get-ThornswoodLaidBuild -Repo \$RepoRoot -Server dev')

# ------------------------------------- 3. Use-ThornswoodContentBuild itself
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-leave-' + [Guid]::NewGuid().ToString('n').Substring(0, 10))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $repo = Join-Path $tmp 'repo'
    TGit $tmp @('clone', '--quiet', '--shared', '--no-checkout', $root, $repo) | Out-Null
    TGit $repo @('checkout', '--quiet', '--detach', (TGit $root @('rev-parse', 'HEAD')).Out[0]) | Out-Null
    $head = (TGit $repo @('rev-parse', 'HEAD')).Out[0]
    $paths = (Get-ThornswoodContentPaths -Repo $repo -Tool 'scripts/mods/Add-ContentRecords.py').Paths
    $key = (Get-ThornswoodContentKey -Repo $repo -Commit $head -Server dev -Paths $paths).Key
    $one = 'game/data/npc-population.json'
    $bytes = [Text.Encoding]::UTF8.GetBytes("laid`n")
    function Lay {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $repo $one)) | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $repo $one), $bytes)
        Save-ThornswoodLaidBuild -Repo $repo -Server dev -Key $key -Commit $head -From 'a test' -Files ([ordered]@{ $one = (Sha $bytes) })
    }
    # A stand-in for Get-ContentBuild.ps1 in the copy, so nothing reaches
    # GitHub: it says what it was asked, and lays or fails as told.
    $stub = Join-Path $repo 'scripts/release/Get-ContentBuild.ps1'
    $asked = Join-Path $tmp 'asked.txt'
    function Stub([string]$Body) {
        [IO.File]::WriteAllText($stub, "param([string]`$Repo, [string]`$Server, [switch]`$Take, [string]`$Kept)`n[IO.File]::WriteAllText('$asked', (`$args + @(`$Server, `$Take.IsPresent, `$Kept) -join ' '))`n$Body`n")
    }
    Lay
    Stub 'Write-Output "STOP. it should not have been asked"; exit 1'
    if (Test-Path -LiteralPath $asked) { Remove-Item -LiteralPath $asked }
    $r = try { Use-ThornswoodContentBuild -Repo $repo -Server dev -Kept (Join-Path $tmp 'none') } catch { $_.Exception.Message }
    Check '3 a laid build that holds is taken as it is, with no other asked for' ($r.Key -ceq $key -and $r.Files[$one] -ceq (Sha $bytes) -and -not (Test-Path -LiteralPath $asked))

    Remove-Item -LiteralPath (Get-ThornswoodLaidBuildFile $repo)
    Stub ". (Join-Path '$root' 'scripts/mods/ContentPaths.ps1'); [IO.File]::WriteAllBytes((Join-Path '$repo' '$one'), [Text.Encoding]::UTF8.GetBytes(`"laid`n`")); Save-ThornswoodLaidBuild -Repo '$repo' -Server dev -Key '$key' -Commit '$head' -From 'the stub' -Files ([ordered]@{ '$one' = '$(Sha $bytes)' }); Write-Output 'TOOK'; exit 0"
    $keptDir = Join-Path $tmp 'kept'
    New-Item -ItemType Directory -Force -Path (Join-Path $keptDir 'dev') | Out-Null
    $r = try { Use-ThornswoodContentBuild -Repo $repo -Server dev -Kept $keptDir 6>$null } catch { $_.Exception.Message }
    $said = if (Test-Path -LiteralPath $asked) { [IO.File]::ReadAllText($asked) } else { '' }
    Check '3 with none laid it lays the commit''s build through Get-ContentBuild.ps1 -Take, from the box''s kept builds where they are' ($r.Key -ceq $key -and $r.From -ceq 'the stub' -and $said -match '^dev True ' -and $said.EndsWith($keptDir))
    Remove-Item -LiteralPath (Get-ThornswoodLaidBuildFile $repo)
    $r = try { Use-ThornswoodContentBuild -Repo $repo -Server dev -Kept (Join-Path $tmp 'none') 6>$null } catch { $_.Exception.Message }
    $said = [IO.File]::ReadAllText($asked)
    Check '3 and from the build''s draft where no build is kept' ($r.Key -ceq $key -and $said -ceq 'dev True ')

    Remove-Item -LiteralPath (Get-ThornswoodLaidBuildFile $repo)
    Stub 'Write-Output "MISSING"; Write-Output "STOP. there is no build of these inputs yet"; exit 1'
    $r = try { Use-ThornswoodContentBuild -Repo $repo -Server dev -Kept (Join-Path $tmp 'none') 6>$null; 'no throw' } catch { $_.Exception.Message }
    Check '3 when none can be laid it stops, naming why' ($r -match 'could not be laid' -and $r -match 'MISSING STOP\. there is no build of these inputs yet')

    Lay
    [IO.File]::WriteAllText((Join-Path $repo $one), 'changed after')
    Stub 'Write-Output "STOP. the build of these inputs is not up yet"; exit 1'
    Remove-Item -LiteralPath $asked
    $r = try { Use-ThornswoodContentBuild -Repo $repo -Server dev -Kept (Join-Path $tmp 'none') 6>$null; 'no throw' } catch { $_.Exception.Message }
    Check '3 a laid build that does not hold any more is laid again, not taken' ($r -match 'could not be laid' -and (Test-Path -LiteralPath $asked))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------- 4. the box build
$box = Src 'scripts/mods/Build-ContentOnBox.ps1'
Check '4 each step''s box build commits what it wrote past the ignore' (
    $box -match '\$builtHere = Get-ThornswoodBuiltPaths -Repo \$repo' -and $box -match "Invoke-BuildGit \(@\('add', '--force', '--'\) \+ \`$made\)")
$run = Src 'scripts/mods/Run-OnBox.ps1'
Check '4 a box run sends what Select-ThornswoodSentPaths keeps, before it makes the artifact' (
    $run -match "\`$paths = Select-ThornswoodSentPaths -Repo \`$repo -Commit 'HEAD' -Paths \`$paths" -and
    $run.IndexOf('Select-ThornswoodSentPaths') -lt $run.IndexOf('New-ThornswoodArtifact -Component tools'))
# What every step of a box build would send from this commit, with nothing
# built yet, is all in it: New-ThornswoodArtifact stops on a path the commit
# has nothing at, which is how every content build from 67c120a ended 1 on
# game/content (#6351).
$head0 = (TGit $root @('rev-parse', 'HEAD')).Out[0]
$tools = @('scripts/mods/Add-ContentRecords.py', 'scripts/dev/Build-NpcPopulation.py', 'scripts/mods/Rebuild-ContentTables.ps1')
$empty = @()
foreach ($t in $tools) {
    foreach ($p in @(Select-ThornswoodSentPaths -Repo $root -Commit $head0 -Paths (Get-ThornswoodContentPaths -Repo $root -Tool $t).Paths)) {
        if (-not @((TGit $root @('ls-tree', '-r', '--name-only', '--full-tree', $head0, '--', $p)).Out | Where-Object { $_ }).Count) { $empty += "$t sends $p" }
    }
}
Check '4 every step of a box build sends only paths this commit holds something at' ($empty.Count -eq 0)
if ($empty.Count) { Write-Host ('      not in the commit: ' + ($empty -join '; ')) }
# The rule itself, on a commit of its own.
$sel = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-sent-' + [Guid]::NewGuid().ToString('n').Substring(0, 10))
try {
    New-Item -ItemType Directory -Path (Join-Path $sel 'src') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $sel 'src/a.txt'), 'a')
    TGit $sel @('init', '-q') | Out-Null
    TGit $sel @('add', '--all') | Out-Null
    TGit $sel @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'base') | Out-Null
    $b = [string[]]@('out/plugin.esp', 'data/t.json')
    $s1 = @(Select-ThornswoodSentPaths -Repo $sel -Commit HEAD -Paths @('src', 'out', 'data/t.json', 'lost') -Built $b)
    Check '4 a folder that holds only built files, and a built file, are left out until the commit has them' (($s1 -join ',') -ceq 'src,lost')
    New-Item -ItemType Directory -Path (Join-Path $sel 'out') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $sel 'out/plugin.esp'), 'p')
    TGit $sel @('add', '--all') | Out-Null
    TGit $sel @('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'step') | Out-Null
    $s2 = @(Select-ThornswoodSentPaths -Repo $sel -Commit HEAD -Paths @('src', 'out', 'data/t.json', 'lost') -Built $b)
    Check '4   and go up once a step committed them; a source the commit lacks always stays, so the artifact names it' (($s2 -join ',') -ceq 'src,out,lost')
} finally { Remove-Item -LiteralPath $sel -Recurse -Force -ErrorAction SilentlyContinue }

# ------------------------------------- 5. workflows and cloud sessions lay it
foreach ($wf in @('collection-record.yml', 'nexus-run.yml')) {
    $y = Src ".github/workflows/$wf"
    Check "5 $wf lays the newest build, with the Actions read it takes" ($y -match '(?m)^\s+- name: Lay the newest content build' -and $y -match '(?m)^\s+uses: \./\.github/actions/lay-content\s*$' -and $y -match '(?m)^\s+actions: read')
}
# Check-CollectionRevisions.ps1 reads only records\collection-plugins.json
# (committed), Nexus and the two Releases, so its hourly job lays nothing and
# its token stays at reading the code and editing issues (#4068).
$y = Src '.github/workflows/collection-revision.yml'
Check '5 collection-revision.yml reads nothing built, so it lays nothing and asks no Actions read' ($y -notmatch 'Get-ContentBuild' -and $y -notmatch 'actions: read')
Check '5 a cloud session lays the newest build at its start' ((Src 'scripts/dev/Setup-CloudSession.sh') -match 'pwsh -NoProfile -File scripts/release/Get-ContentBuild\.ps1 -Newest')
Check '5 the guide''s new machine lays it' ((Src 'docs/guide/set-up-a-machine.md') -match 'pwsh scripts/release/Get-ContentBuild\.ps1 -Newest')

# ------------------------------------------------------ 6. the old way gone
$verbs = (Src 'scripts/vps/gate/verbs.json') | ConvertFrom-Json
Check '6 Rebuild-PullTables.ps1 and Rebuild-OnBox.ps1 are gone' (
    -not (Test-Path -LiteralPath (Join-Path $root 'scripts/mods/Rebuild-PullTables.ps1')) -and -not (Test-Path -LiteralPath (Join-Path $root 'scripts/mods/Rebuild-OnBox.ps1')))
Check '6 the gate has no Rebuild-ContentTables verb' (-not $verbs.verbs.PSObject.Properties['Rebuild-ContentTables'])
Check '6 Run-OnBox.ps1 takes no -Out' ($run -notmatch '\[string\]\$Out\b' -and $run -notmatch '\$Out\b')
Check '6 no guide page says to commit the tables or run the pull request rebuild' (
    @(Get-ChildItem -LiteralPath (Join-Path $root 'docs/guide') -Filter '*.md' | Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'Rebuild-PullTables|Rebuild-ContentTables -Pull|commit those with the plugin' }).Count -eq 0)

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
