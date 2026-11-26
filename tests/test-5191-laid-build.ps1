<#
  test-5191-laid-build.ps1

      pwsh -NoProfile -File .\tests\test-5191-laid-build.ps1

  Issue #5191, stage 4e: nothing generated is committed, so a deploy sends
  what the box's content build wrote, laid over its checkout, instead of the
  copies in git. On a copy of this checkout's commit, with a build planted
  where the box keeps them (Build-ContentOnBox.ps1, <cache>\<server>\<key>):
    1. Get-ContentBuild.ps1 -Take -Kept lays that build of the commit's key
       over the checkout, held to its build.json, and writes
       temp\content-laid.json: the server, key, commit and every file laid
       with its sha256, which reads back held under Set-StrictMode too, as
       Ship.ps1 runs (a step of content-tables.json names only the lists
       it has);
    2. it says MISSING and lays nothing when no build of the key is kept, and
       stops, writing nothing, on a kept file that is not its sha256;
    3. New-ThornswoodArtifact -Content dev puts the laid files in the zip,
       not the commit's copies, the rest from the commit, and its record
       names the build; without -Content the same deploy is refused, the
       commit holding no tables;
    4. -Content refuses a laid file changed after it was laid, a build of
       the other server, a build of other inputs than the commit's, and a
       built file the deploy sends that the build lacks;
    5. Get-ThornswoodBuiltPaths is the content plugin, the catalogue and
       every path the chain writes, which -Newest lays too.

  Writes only under its own folder in TEMP, which it removes. Exit 1 when
  any check fails.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$script = Join-Path $root 'scripts\release\Get-ContentBuild.ps1'
$pass = 0; $fail = 0
function Check([string]$What, [bool]$Ok) {
    if ($Ok) { $script:pass++; Write-Host "PASS  $What" } else { $script:fail++; Write-Host "FAIL  $What" }
}
function TGit([string]$Dir, [string[]]$Words) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $Dir @Words 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
    return , $o
}
function Sha([byte[]]$B) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($B)).ToLowerInvariant() }
function Run([string[]]$Words) {
    $o = @(& pwsh -NoProfile -File $script @Words 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $o; Text = ($o -join "`n") }
}
function Try-It([scriptblock]$Block) {
    try { $v = & $Block; return [pscustomobject]@{ Ok = $true; Value = $v; Why = '' } }
    catch { return [pscustomobject]@{ Ok = $false; Value = $null; Why = $_.Exception.Message } }
}

. (Join-Path $root 'scripts\mods\ContentPaths.ps1')
. (Join-Path $root 'scripts\deploy\Artifact.ps1')

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-laid-' + [Guid]::NewGuid().ToString('n').Substring(0, 10))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $repo = Join-Path $tmp 'repo'
    TGit $tmp @('clone', '--quiet', '--shared', '--no-checkout', $root, $repo) | Out-Null
    TGit $repo @('checkout', '--quiet', '--detach', (TGit $root @('rev-parse', 'HEAD'))[0]) | Out-Null
    TGit $repo @('config', 'user.name', 'Test') | Out-Null
    TGit $repo @('config', 'user.email', 'test@thornswood.invalid') | Out-Null
    $head = (TGit $repo @('rev-parse', 'HEAD'))[0]
    $paths = (Get-ThornswoodContentPaths -Repo $repo -Tool 'scripts/mods/Add-ContentRecords.py').Paths
    $key = (Get-ThornswoodContentKey -Repo $repo -Commit $head -Server dev -Paths $paths).Key

    # ---------------------------------------------- 5. what a build lays
    $built = Get-ThornswoodBuiltPaths -Repo $repo
    $writes = (Get-ThornswoodContentPaths -Repo $repo).Writes
    Check '5 the built paths are the plugin, the catalogue and every path the chain writes' (
        $built[0] -ceq 'game/content/Thornswood-Content.esp' -and $built -ccontains 'game/data/npc-population.json' -and
        @($writes | Where-Object { $built -cnotcontains $_ }).Count -eq 0 -and $built.Count -eq (@($writes | Where-Object { $_ -cne 'game/data/npc-population.json' }).Count + 2))
    Check '5 the list folder and maker page are built, an unrelated page beside them is not' (
        (Test-ThornswoodBuiltPath $built 'docs/systems/lists/a.md') -and (Test-ThornswoodBuiltPath $built 'docs/systems/who-makes-it.md') -and
        -not (Test-ThornswoodBuiltPath $built 'docs/systems/unrelated-page.md') -and
        (Test-ThornswoodBuiltPath $built 'game\gamemode-tables\DATA.json') -and -not (Test-ThornswoodBuiltPath $built 'game/gamemode.js'))
    $take = [IO.File]::ReadAllText($script)
    Check '5 -Newest lays the built paths, from the one list' ($take -match '\$writes = Get-ThornswoodBuiltPaths -Repo \$Repo')

    # A build of the commit's key, kept where the box keeps them: every built
    # path, each holding words no commit has.
    $cache = Join-Path $tmp 'cache'
    function Plant([string]$Server, [string]$Key, [string]$Word) {
        $dir = Join-Path (Join-Path $cache $Server) $Key
        $files = [ordered]@{}
        foreach ($p in $built) {
            $rel = if ($p -ceq 'docs/systems/lists') { 'docs/systems/lists/a.md' } else { $p }
            $to = Join-Path (Join-Path $dir 'files') $rel
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            $b = [Text.Encoding]::UTF8.GetBytes("$Word $rel`n")
            [IO.File]::WriteAllBytes($to, $b)
            $files[$rel] = Sha $b
        }
        $rec = [ordered]@{ issue = 5191; server = $Server; key = $Key; commit = $head; built = '2026-11-16T05:00:00Z'; files = $files }
        [IO.File]::WriteAllText((Join-Path $dir 'build.json'), ($rec | ConvertTo-Json -Depth 4))
        return $dir
    }

    # ------------------------------------------------- 2. none kept
    New-Item -ItemType Directory -Force -Path (Join-Path $cache 'dev') | Out-Null
    $r = Run @('-Repo', $repo, '-Take', '-Kept', $cache)
    Check '2 with no build of the key kept it says MISSING and stops' ($r.Code -ne 0 -and $r.Out -contains 'MISSING' -and $r.Text -match 'keeps no build of these inputs')
    Check '2 and lays nothing' (-not (Test-Path -LiteralPath (Join-Path $repo 'temp/content-laid.json')))

    $dir = Plant 'dev' $key 'built'
    $one = Join-Path $dir 'files/game/data/last-plugin.json'
    $was = [IO.File]::ReadAllBytes($one)
    [IO.File]::WriteAllText($one, 'tampered')
    # A table is built, never committed (#5191): the checkout has none until
    # a build is laid, and a stop leaves it so.
    $dataAt = Join-Path $repo 'game/gamemode-tables/DATA.json'
    function DataNow { if (Test-Path -LiteralPath $dataAt) { Sha ([IO.File]::ReadAllBytes($dataAt)) } else { 'none' } }
    $before = DataNow
    $r = Run @('-Repo', $repo, '-Take', '-Kept', $cache)
    Check '2 a kept file that is not its sha256 stops it' ($r.Code -ne 0 -and $r.Text -match 'game/data/last-plugin.json in the box''s build .* is not the sha256 build.json names')
    Check '2 writing nothing' ((DataNow) -ceq $before -and -not (Test-Path -LiteralPath (Join-Path $repo 'temp/content-laid.json')))
    [IO.File]::WriteAllBytes($one, $was)

    # ----------------------------------------------------- 1. laid
    $r = Run @('-Repo', $repo, '-Take', '-Kept', $cache)
    Check '1 -Take -Kept lays the box''s build of the key' ($r.Code -eq 0 -and $r.Out -contains "FOUND $dir" -and $r.Text -match "TOOK $key FROM $head")
    $laidText = [IO.File]::ReadAllText((Join-Path $dir 'files/game/gamemode-tables/DATA.json'))
    Check '1 every file over the checkout' ([IO.File]::ReadAllText((Join-Path $repo 'game/gamemode-tables/DATA.json')) -ceq $laidText -and
        [IO.File]::ReadAllText((Join-Path $repo 'game/content/Thornswood-Content.esp')) -ceq "built game/content/Thornswood-Content.esp`n")
    $rec = [IO.File]::ReadAllText((Join-Path $repo 'temp/content-laid.json')) | ConvertFrom-Json -AsHashtable
    Check '1 temp\content-laid.json names the server, key, commit and each file laid' (
        $rec.server -ceq 'dev' -and $rec.key -ceq $key -and $rec.commit -ceq $head -and $rec.files.Count -eq $built.Count -and
        $rec.files['game/gamemode-tables/DATA.json'] -ceq (Sha ([Text.Encoding]::UTF8.GetBytes($laidText))))
    $l = Try-It { Get-ThornswoodLaidBuild -Repo $repo -Server dev }
    Check '1 and reads back held' ($l.Ok -and $l.Value.Key -ceq $key -and $l.Value.Files.Count -eq $built.Count)
    $strict = @(& pwsh -NoProfile -Command {
            param($cp, $r)
            Set-StrictMode -Version Latest
            $ErrorActionPreference = 'Stop'
            try { . $cp; 'KEY ' + (Get-ThornswoodLaidBuild -Repo $r -Server dev).Key } catch { 'STOPPED: ' + $_.Exception.Message }
        } -args (Join-Path $root 'scripts\mods\ContentPaths.ps1'), $repo 2>&1 | ForEach-Object { "$_" })
    Check ('1 and under Set-StrictMode, as Ship.ps1 runs (' + ($strict -join ' ') + ')') ($strict -contains "KEY $key")

    # ------------------------------------------------ 3. the artifact
    $out = Join-Path $tmp 'deploys'
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode.js', 'game/gamemode-tables' -AlsoSends 'game/content/Thornswood-Content.esp', 'game/data/last-plugin.recipe', 'records/server-build.json' -OutDir $out -Content dev }
    Check '3 -Content dev builds the artifact over the laid build' $a.Ok
    if ($a.Ok) {
        $art = $a.Value
        $files = @($art.Record.files)
        $data = @($files | Where-Object { $_.path -ceq 'game/gamemode-tables/DATA.json' })
        $gm = @($files | Where-Object { $_.path -ceq 'game/gamemode.js' })
        $gitGm = (TGit $repo @('rev-parse', "${head}:game/gamemode.js"))[0]
        Check '3 its tables are the laid build''s' ($data.Count -eq 1 -and $data[0].sha256 -ceq $rec.files['game/gamemode-tables/DATA.json'] -and
            [IO.File]::ReadAllText((Join-Path $art.Folder 'game/gamemode-tables/DATA.json')) -ceq $laidText)
        Check '3 every table the build laid, and none the commit has that the build lacks' (
            (@($files | Where-Object { $_.path.StartsWith('game/gamemode-tables/') }).Count) -eq (@($rec.files.Keys | Where-Object { $_.StartsWith('game/gamemode-tables/') }).Count))
        Check '3 gamemode.js is the commit''s' ($gm.Count -eq 1 -and (Get-Content -LiteralPath (Join-Path $art.Folder 'game/gamemode.js') -Raw -AsByteStream).Length -eq (TGit $repo @('cat-file', '-s', $gitGm))[0])
        Check '3 the record names the build' ($art.Record.content -ceq "dev $key $head")
    }
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode.js', 'game/gamemode-tables' -OutDir $out }
    Check '3 without -Content it is refused: the commit holds no tables, which only a build has (#5191)' (-not $a.Ok -and $a.Why -match 'has nothing at game/gamemode-tables')

    # ------------------------------------------------ 4. refusals
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode-tables' -OutDir $out -Content main }
    Check '4 a build of the other server is refused' (-not $a.Ok -and $a.Why -match "the dev server's, not main's")

    $p = Join-Path $repo 'game/gamemode-tables/DATA.json'
    [IO.File]::WriteAllText($p, 'edited after it was laid')
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode-tables' -OutDir $out -Content dev }
    Check '4 a laid file changed since is refused' (-not $a.Ok -and $a.Why -match 'not what it laid any more: game/gamemode-tables/DATA.json \(changed\)')
    [IO.File]::WriteAllText($p, $laidText)

    $recPath = Join-Path $repo 'temp/content-laid.json'
    $keep = [IO.File]::ReadAllText($recPath)
    $less = $keep | ConvertFrom-Json -AsHashtable
    $less.files.Remove('game/data/last-plugin.recipe')
    [IO.File]::WriteAllText($recPath, ($less | ConvertTo-Json -Depth 4))
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode.js' -AlsoSends 'game/data/last-plugin.recipe' -OutDir $out -Content dev }
    Check '4 a built file it sends that the build lacks is refused' (-not $a.Ok -and $a.Why -match 'has no game/data/last-plugin.recipe')
    [IO.File]::WriteAllText($recPath, $keep)

    # A commit that changes an input has another key.
    $src = Join-Path $repo 'records/load-order.json'
    [IO.File]::AppendAllText($src, "`n")
    TGit $repo @('commit', '--quiet', '-am', 'an input moves') | Out-Null
    $a = Try-It { New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode-tables' -OutDir $out -Content dev }
    Check '4 a build of other inputs than the commit''s is refused' (-not $a.Ok -and $a.Why -match 'is of other inputs')
    $r = Run @('-Repo', $repo, '-Take', '-Kept', $cache)
    Check '4 and -Kept finds none kept for the new key' ($r.Code -ne 0 -and $r.Out -contains 'MISSING')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
exit $(if ($fail) { 1 } else { 0 })
