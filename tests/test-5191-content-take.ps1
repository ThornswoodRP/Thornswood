<#
  test-5191-content-take.ps1

      pwsh -NoProfile -File .\tests\test-5191-content-take.ps1

  Issue #5191, stage 3: the merge release takes the content plugin and the
  tables from the box's build, which the deploy agent puts on a draft
  Release named by its inputs (scripts\release\Get-ContentBuild.ps1). With
  no network, on a copy of this checkout, with the Releases and their files
  planted:
    1. the key is the one Build-ContentOnBox.ps1 keeps the build by (both
       call Get-ThornswoodContentKey), the same for the same commit and new
       when an input changes;
    2. with no whole draft for the key it says MISSING, and -Ask writes the
       Deployment to Content: main, the key, the server and the commit;
    3. with one it says FOUND, and -Take writes every file over the
       checkout, each the sha256 content-build.json names;
    4. -Take stops, writing nothing, on a file not its sha256, a file the
       record does not name, a file it lacks, a path out of the repository,
       or a record for another key;
    3b. -Newest takes the newest build a run on main kept, whatever its key,
       held to its server, and -Keep keeps what -Take took;
    5. merge-release.yml asks for the build before it releases, takes it
       before any part is built, and starts again on a Content Deployment's
       success, with the release's concurrency on its job;
    3c. -Newest says SAME KEY or OTHER KEY against this checkout's inputs,
       with same=, key= and commit= for the gate's pick, and -BuildKey
       holds it to a key;
    3d. -Newest -Find names the newest build for actions/download-artifact,
       and in a workflow the script never downloads a build itself (#6359);
    7. every workflow lays the build with .github/actions/lay-content, which
       has GitHub's download step take it, and none downloads it itself;
    6. the merge release runs the content checks over the build it took, in
       shares, and releases (and keeps it as content-dev) only when they
       pass; the gate's pick lays the newest build and hands it to its
       shares, which hold no token, and the nightly, the named harnesses and
       the gate map's runs lay it after their checkout.

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
    # Whole, so a single line is the list's first entry and not its first letter.
    return , $o
}
function Sha([byte[]]$B) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($B)).ToLowerInvariant() }
function Run([string[]]$Words) {
    $o = @(& pwsh -NoProfile -File $script @Words 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $o; Text = ($o -join "`n") }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-5191-take-' + [Guid]::NewGuid().ToString('n').Substring(0, 10))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    # A copy of this checkout's commit, with a working tree to write over.
    $repo = Join-Path $tmp 'repo'
    TGit $tmp @('clone', '--quiet', '--shared', '--no-checkout', $root, $repo) | Out-Null
    TGit $repo @('checkout', '--quiet', '--detach', (TGit $root @('rev-parse', 'HEAD'))[0]) | Out-Null
    TGit $repo @('config', 'user.name', 'Test') | Out-Null
    TGit $repo @('config', 'user.email', 'test@thornswood.invalid') | Out-Null
    $head = (TGit $repo @('rev-parse', 'HEAD'))[0]

    # ------------------------------------------------------------ 1. the key
    . (Join-Path $root 'scripts\mods\ContentPaths.ps1')
    $paths = (Get-ThornswoodContentPaths -Repo $repo -Tool 'scripts/mods/Add-ContentRecords.py').Paths
    $key = (Get-ThornswoodContentKey -Repo $repo -Commit $head -Server dev -Paths $paths).Key
    $rels = Join-Path $tmp 'releases.json'
    '[]' | Set-Content -LiteralPath $rels
    $out = Join-Path $tmp 'out.txt'
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Output', $out)
    Check '1 it says the key Get-ThornswoodContentKey gives for the commit' ($r.Code -eq 0 -and $r.Out -contains "KEY $key")
    $box = [IO.File]::ReadAllText((Join-Path $root 'scripts\mods\Build-ContentOnBox.ps1'))
    Check '1 and Build-ContentOnBox.ps1 keeps its build by the same function' ($box -match 'Get-ThornswoodContentKey -Repo \$repo -Commit \$commit -Server \$Server -Paths \$content\.Paths')
    $mainKey = (Get-ThornswoodContentKey -Repo $repo -Commit $head -Server main -Paths $paths).Key
    Check '1 the main server has a key of its own' ($mainKey -ne $key)
    Add-Content -LiteralPath (Join-Path $repo 'layout.json') -Value ' '
    TGit $repo @('commit', '--quiet', '-am', 'an input changes') | Out-Null
    $moved = (TGit $repo @('rev-parse', 'HEAD'))[0]
    $key2 = (Get-ThornswoodContentKey -Repo $repo -Commit $moved -Server dev -Paths $paths).Key
    Check '1 a changed input is a new key' ($key2 -ne $key)
    TGit $repo @('checkout', '--quiet', '--detach', $head) | Out-Null
    $tag = "content-dev-$key"

    # ------------------------------------------------ 2. missing, and -Ask
    Check '2 with no draft it says MISSING and found=no, and ends 0' ($r.Out -contains 'MISSING' -and (Get-Content -LiteralPath $out) -contains 'found=no' -and (Get-Content -LiteralPath $out) -contains "key=$key")
    $dep = Join-Path $tmp 'deployment.json'
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Ask', '-DeploymentFile', $dep, '-Output', '')
    $d = if (Test-Path -LiteralPath $dep) { Get-Content -LiteralPath $dep -Raw | ConvertFrom-Json } else { $null }
    Check '2 -Ask writes a Deployment to Content, to main, with the key, the server and the commit' ($r.Code -eq 0 -and $d -and $d.environment -ceq 'Content' -and $d.ref -ceq 'main' -and
        $d.payload.content -ceq $key -and $d.payload.server -ceq 'dev' -and $d.payload.commit -ceq $head -and $d.required_contexts.Count -eq 0 -and $d.auto_merge -eq $false -and $d.production_environment -eq $false)
    # A draft with one of its two files is not whole.
    $half = @(@{ tag_name = $tag; draft = $true; assets = @(@{ name = 'content.zip'; size = 1; url = '' }) })
    $half | ConvertTo-Json -Depth 5 -AsArray | Set-Content -LiteralPath $rels
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Output', '')
    Check '2 a draft without content-build.json is MISSING' ($r.Out -contains 'MISSING')
    # A published Release by the tag is not the draft.
    @(@{ tag_name = $tag; draft = $false; assets = @(@{ name = 'content.zip'; size = 1; url = '' }, @{ name = 'content-build.json'; size = 1; url = '' }) }) | ConvertTo-Json -Depth 5 -AsArray | Set-Content -LiteralPath $rels
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Output', '')
    Check '2 and so is a Release that is not a draft' ($r.Out -contains 'MISSING')
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Take', '-Output', '')
    Check '2 -Take with nothing to take stops' ($r.Code -eq 1 -and $r.Text -match 'STOP\. there is no whole draft')

    # ------------------------------------------------------ 3. found, taken
    function Plant([hashtable]$Files, [hashtable]$Names = $null, [string]$K = $key, [string]$Srv = 'dev') {
        $assets = Join-Path $tmp ('assets-' + [Guid]::NewGuid().ToString('n').Substring(0, 6))
        New-Item -ItemType Directory -Path $assets | Out-Null
        $zip = Join-Path $assets 'content.zip'
        Add-Type -AssemblyName System.IO.Compression
        $fs = [IO.File]::Create($zip)
        $za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
        foreach ($n in ($Files.Keys | Sort-Object)) {
            $s = $za.CreateEntry($n).Open(); $s.Write($Files[$n], 0, $Files[$n].Length); $s.Dispose()
        }
        $za.Dispose(); $fs.Dispose()
        if (-not $Names) { $Names = @{}; foreach ($n in $Files.Keys) { $Names[$n] = Sha $Files[$n] } }
        $rec = [ordered]@{ issue = 5191; server = $Srv; key = $K; commit = $head; built = '2026-11-13T00:00:00Z'; files = $Names }
        [IO.File]::WriteAllText((Join-Path $assets 'content-build.json'), ($rec | ConvertTo-Json -Depth 4))
        @(@{ tag_name = $tag; draft = $true; assets = @(
                    @{ name = 'content.zip'; size = (Get-Item $zip).Length; url = '' },
                    @{ name = 'content-build.json'; size = (Get-Item (Join-Path $assets 'content-build.json')).Length; url = '' }) }) |
            ConvertTo-Json -Depth 5 -AsArray | Set-Content -LiteralPath $rels
        return $assets
    }
    $enc = [Text.Encoding]::UTF8
    $built = @{
        'game/content/Thornswood-Content.esp' = $enc.GetBytes('TES4 built on the box')
        'game/data/last-plugin.recipe'        = $enc.GetBytes('the recipe the box wrote')
        'game/gamemode-tables/NewTable.json'  = $enc.GetBytes('{"new":true}')
    }
    $assets = Plant $built
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-Output', $out)
    Check '3 with a whole draft it says FOUND and found=yes' ($r.Code -eq 0 -and $r.Out -contains "FOUND $tag" -and (Get-Content -LiteralPath $out) -contains 'found=yes')
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-AssetDir', $assets, '-Take', '-Output', '')
    $same = @($built.Keys | Where-Object { (Sha ([IO.File]::ReadAllBytes((Join-Path $repo $_)))) -ne (Sha $built[$_]) }).Count -eq 0
    Check '3 -Take writes every file of the build over the checkout' ($r.Code -eq 0 -and $same -and $r.Text -match "TOOK $key FROM $head`: 3 files")
    TGit $repo @('checkout', '--quiet', '--force', $head) | Out-Null
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null
    $kept = Join-Path $tmp 'kept'
    $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-AssetDir', $assets, '-Take', '-Keep', $kept, '-Output', '')
    Check '3 -Keep keeps the two files it took, byte for byte, for the artifact' ($r.Code -eq 0 -and
        (Sha ([IO.File]::ReadAllBytes((Join-Path $kept 'content.zip')))) -eq (Sha ([IO.File]::ReadAllBytes((Join-Path $assets 'content.zip')))) -and
        (Sha ([IO.File]::ReadAllBytes((Join-Path $kept 'content-build.json')))) -eq (Sha ([IO.File]::ReadAllBytes((Join-Path $assets 'content-build.json')))))
    TGit $repo @('checkout', '--quiet', '--force', $head) | Out-Null
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null

    # ----------------------------------------------------- 3b. -Newest
    # Whatever its key: a pull request's checkout has inputs of its own.
    # An older build can carry what this checkout's chain no longer writes
    # (#6195: gamemode code); -Newest lays only what the chain writes.
    $newest = @{
        'game/content/Thornswood-Content.esp' = $built['game/content/Thornswood-Content.esp']
        'game/data/last-plugin.recipe'        = $built['game/data/last-plugin.recipe']
        'game/gamemode.js'                    = $enc.GetBytes('old gamemode code')
    }
    $gmBefore = Sha ([IO.File]::ReadAllBytes((Join-Path $repo 'game/gamemode.js')))
    $other = Plant $newest $null ('a' * 64)
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', $other, '-Output', $out)
    $same = @('game/content/Thornswood-Content.esp', 'game/data/last-plugin.recipe' | Where-Object { (Sha ([IO.File]::ReadAllBytes((Join-Path $repo $_)))) -ne (Sha $newest[$_]) }).Count -eq 0
    Check '3 -Newest writes the newest build over the checkout, whatever its key' ($r.Code -eq 0 -and $same -and $r.Text -match "TOOK $('a' * 64) FROM $head`: 2 files")
    Check '3 and only what this checkout''s chain writes, saying what it left' ((Sha ([IO.File]::ReadAllBytes((Join-Path $repo 'game/gamemode.js')))) -eq $gmBefore -and
        $r.Text -match "left 1 file\(s\) of the build that this checkout's chain does not write: game/gamemode\.js")
    $said = @(Get-Content -LiteralPath $out)
    Check '3 and says OTHER KEY when it is not of this checkout''s inputs, with same=no, the build''s key and commit' (
        $r.Text -match "OTHER KEY: this checkout's content inputs are $key" -and $said -contains 'same=no' -and $said -contains "key=$('a' * 64)" -and $said -contains "commit=$head")
    TGit $repo @('checkout', '--quiet', '--force', $head) | Out-Null
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null
    Remove-Item -LiteralPath $out -Force
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', (Plant $newest), '-Output', $out)
    Check '3 and SAME KEY, same=yes, when it is' ($r.Code -eq 0 -and $r.Text -match 'SAME KEY' -and @(Get-Content -LiteralPath $out) -contains 'same=yes')
    TGit $repo @('checkout', '--quiet', '--force', $head) | Out-Null
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', $other, '-BuildKey', $key, '-Output', '')
    Check '3 -BuildKey holds it to that key, writing nothing' ($r.Code -eq 1 -and $r.Text -match "is for dev $('a' * 64), not dev $key" -and -not (Test-Path -LiteralPath (Join-Path $repo 'game\gamemode-tables\NewTable.json')))
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', (Plant $newest $null $key 'main'), '-Output', '')
    Check '3 -Newest still holds the build to its server' ($r.Code -eq 1 -and $r.Text -match 'is for the main server, not dev')
    $arts = Join-Path $tmp 'artifacts.json'
    @{ artifacts = @(
            @{ id = 1; expired = $false; created_at = '2026-11-15T10:00:00Z'; workflow_run = @{ id = 11; head_branch = 'claude/x' } },
            @{ id = 2; expired = $true; created_at = '2026-11-14T10:00:00Z'; workflow_run = @{ id = 12; head_branch = 'main' } }) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $arts
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactsFile', $arts, '-Output', '')
    Check '3 -Newest takes only a build kept by a run on main that has not expired' ($r.Code -eq 1 -and $r.Text -match 'no merge release on main has kept a content-dev build yet')
    $r = Run @('-Repo', $repo, '-Newest', '-Take', '-Output', '')
    Check '3 -Newest goes without -Take and -Ask' ($r.Code -eq 1 -and $r.Text -match '-Newest takes the newest build main released')

    $oldSpotPath = 'docs/HUNTING-SPOTS.csv'
    $newSpotPath = 'game/data/HUNTING-SPOTS.csv'
    $spotFile = Join-Path $repo $newSpotPath
    $spots = @{ $oldSpotPath = $enc.GetBytes('the older signed build data') }
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', (Plant $spots), '-Output', '')
    Check '3 -Newest lays verified legacy spot bytes at the new path' (
        $r.Code -eq 0 -and (Test-Path -LiteralPath $spotFile) -and
        (Sha ([IO.File]::ReadAllBytes($spotFile))) -ceq (Sha $spots[$oldSpotPath]) -and
        -not (Test-Path -LiteralPath (Join-Path $repo $oldSpotPath)))
    $spots[$newSpotPath] = $enc.GetBytes('new location in the build')
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', (Plant $spots), '-Output', '')
    Check '3 -Newest prefers the verified current path when both are present' (
        $r.Code -eq 0 -and (Sha ([IO.File]::ReadAllBytes($spotFile))) -ceq (Sha $spots[$newSpotPath]))
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null
    $badSpot = @{ $oldSpotPath = ('0' * 64); $newSpotPath = (Sha $spots[$newSpotPath]) }
    $r = Run @('-Repo', $repo, '-Newest', '-ArtifactDir', (Plant $spots $badSpot), '-Output', '')
    Check '3 -Newest refuses a wrong hash before laying either spot file' (
        $r.Code -eq 1 -and $r.Text -match 'is not the sha256' -and -not (Test-Path -LiteralPath $spotFile))
    TGit $repo @('clean', '--quiet', '-fdx') | Out-Null

    # 3d. In a workflow GitHub's download step takes the build (#6359):
    # -Find names it, and the script's own download refuses.
    @{ artifacts = @(
            @{ id = 7; expired = $false; created_at = '2026-11-16T07:21:06Z'; workflow_run = @{ id = 70; head_branch = 'main' } },
            @{ id = 8; expired = $false; created_at = '2026-11-16T09:00:00Z'; workflow_run = @{ id = 80; head_branch = 'claude/x' } },
            @{ id = 6; expired = $false; created_at = '2026-11-15T07:21:06Z'; workflow_run = @{ id = 60; head_branch = 'main' } }) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $arts
    $out = Join-Path $tmp 'find-output.txt'
    $r = Run @('-Repo', $repo, '-Newest', '-Find', '-ArtifactsFile', $arts, '-Output', $out)
    $said = if (Test-Path -LiteralPath $out) { @(Get-Content -LiteralPath $out) } else { @() }
    Check '3d -Newest -Find names the newest build main kept, for actions/download-artifact, and lays nothing' (
        $r.Code -eq 0 -and $r.Text -match 'NEWEST artifact 7 of run 70' -and $said -ccontains 'artifact=7' -and $said -ccontains 'run=70' -and -not (Test-Path -LiteralPath (Join-Path $repo 'temp/content-laid.json')))
    $r = Run @('-Repo', $repo, '-Find', '-ArtifactsFile', $arts, '-Output', '')
    Check '3d -Find goes with -Newest alone' ($r.Code -eq 1 -and $r.Text -match '-Find goes with -Newest alone')
    $was = $env:GITHUB_ACTIONS
    try {
        $env:GITHUB_ACTIONS = 'true'
        $r = Run @('-Repo', $repo, '-Newest', '-ArtifactsFile', $arts, '-Output', '')
    } finally { $env:GITHUB_ACTIONS = $was }
    Check '3d in a workflow the script does not download a build itself, and names the action that does' ($r.Code -eq 1 -and $r.Text -match 'comes down through actions/download-artifact, not this script: lay it with the action \.github/actions/lay-content')

    # ------------------------------------------------------- 4. refusals
    # The plugin is built, never committed (#5191): a checkout has none until
    # a build is laid, and a refusal leaves it so.
    $plugin = Join-Path $repo 'game\content\Thornswood-Content.esp'
    function PluginNow { if (Test-Path -LiteralPath $plugin) { Sha ([IO.File]::ReadAllBytes($plugin)) } else { 'none' } }
    $before = PluginNow
    function Refused([string]$What, [string]$Why, [string]$AssetsDir) {
        $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-AssetDir', $AssetsDir, '-Take', '-Output', '')
        $kept = (PluginNow) -eq $before
        Check "4 $What stops and writes nothing" ($r.Code -eq 1 -and $r.Text -match $Why -and $kept)
        if (-not ($r.Text -match $Why)) { Write-Host ($r.Out | Select-Object -Last 3) }
    }
    $names = @{}; foreach ($n in $built.Keys) { $names[$n] = Sha $built[$n] }
    $bad = $names.Clone(); $bad['game/data/last-plugin.recipe'] = ('0' * 64)
    Refused 'a file that is not the sha256 its record names' 'last-plugin\.recipe in content\.zip in the draft .* is not the sha256' (Plant $built $bad)
    $fewer = $names.Clone(); $fewer.Remove('game/gamemode-tables/NewTable.json')
    Refused 'a file the record does not name' 'NewTable\.json, which content-build\.json does not name' (Plant $built $fewer)
    $more = $names.Clone(); $more['game/data/gone.json'] = ('1' * 64)
    Refused 'a file the zip lacks' 'lacks game/data/gone\.json' (Plant $built $more)
    $out1 = $built.Clone(); $out1['game/../../escape.txt'] = $enc.GetBytes('x')
    Refused 'a path out of the repository' 'which is not a repository path' (Plant $out1)
    Refused 'a record for another key' 'is for dev .*, not dev' (Plant $built $null ('f' * 64))
    Refused 'a record for the other server' 'is for the main server, not dev' (Plant $built $null $key 'main')

    # ---------------------------------------------- 5. the merge release
    # A Windows checkout holds the workflows CRLF; each job is cut out at its
    # next \n  name:\n line, so they are read LF (#6351).
    $wf = ([IO.File]::ReadAllText((Join-Path $root '.github\workflows\merge-release.yml')) -replace "`r`n", "`n")
    $job = $wf.Substring($wf.IndexOf("`n  release:"))
    Check '5 it starts again on deployment_status' ($wf -match '(?m)^  deployment_status:')
    Check '5 a content job asks for the build, on main only, on a push or a Content Deployment''s success' (
        $wf -match "(?s)  content:.*?if: \$\{\{ github\.ref == 'refs/heads/main' && \(github\.event_name != 'deployment_status' \|\| \(github\.event\.deployment\.environment == 'Content' && github\.event\.deployment_status\.state == 'success'\)\) \}\}" -and
        $wf -match 'Get-ContentBuild\.ps1 -Server dev -Ask')
    Check '5 the release waits on it and runs only when the build is found' ($job -match 'needs: \[content, ' -and $job -match "if: \$\{\{ !cancelled\(\) && needs\.content\.outputs\.found == 'yes' && ")
    $takeAt = $job.IndexOf('Get-ContentBuild.ps1 -Server dev -Take')
    Check '5 it takes the build right after the checkout, before any part is built' ($takeAt -gt 0 -and $takeAt -lt $job.IndexOf('- name: Name the release and read the one before'))
    $keepAt = $job.IndexOf('- name: Keep what was taken')
    Check '5 it keeps what it took as the artifact content-dev, for 90 days, for the harnesses and checkouts that read the tables (-Newest)' (
        $job -match 'Get-ContentBuild\.ps1 -Server dev -Take -Keep' -and $keepAt -gt $takeAt -and
        $job.Substring($keepAt) -match '(?s)^- name: Keep what was taken.*?uses: actions/upload-artifact@[0-9a-f]{40}.*?name: content-dev\s.*?retention-days: 90')
    # ------------------------------------------- 6. the content checks (4d)
    $pre = $wf.Substring(0, $wf.IndexOf("`n  release:"))
    Check '6 the content job takes the build it found, held to its key, and hands it to the checks for this run only' (
        $pre -match "(?s)- name: Take the build for the content checks\s+if: \$\{\{ steps\.find\.outputs\.found == 'yes' \}\}.*?Get-ContentBuild\.ps1 -Server dev -Take -Keep" -and
        $pre -match '(?s)- name: Hand the build to the content checks.*?name: content-taken\s.*?retention-days: 1')
    $pickAt = $pre.IndexOf("`n  checks-pick:")
    $checksAt = $pre.IndexOf("`n  checks:")
    $pick = $pre.Substring($pickAt, $checksAt - $pickAt)
    Check '6 the content pick lays the artifact held to this run''s key before reading the built tables' (
        $pick -match '(?s)uses: actions/download-artifact@[0-9a-f]{40}.*?name: content-taken.*?CONTENT_KEY: \$\{\{ needs\.content\.outputs\.key \}\}.*?Get-ContentBuild\.ps1 -Server dev -Newest -ArtifactDir .*?-BuildKey \$env:CONTENT_KEY.*?Run-Gate\.ps1 -Pick 5 -LinuxShares 4 -Content')
    foreach ($j in 'checks', 'checks-linux') {
        $at = $pre.IndexOf("`n  ${j}:")
        $body = if ($at -ge 0) { $pre.Substring($at + 1) } else { '' }
        $next = $body.IndexOf("`n  checks-linux:"); if ($j -eq 'checks' -and $next -gt 0) { $body = $body.Substring(0, $next) }
        Check "6 $j lays that build, held to the key, before it runs its share of the plan" ($at -ge 0 -and
            $body -match '(?s)name: content-taken.*?Get-ContentBuild\.ps1 -Server dev -Newest -ArtifactDir .*?-BuildKey \$env:CONTENT_KEY.*?GATE_PLAN: \$\{\{ needs\.checks-pick\.outputs\.plan \}\}.*?Run-Gate\.ps1 -Shard')
    }
    Check '6 the release runs only when every content check passed, so a build kept as content-dev passed its checks' (
        $job -match 'needs: \[content, checks-pick, checks, checks-linux\]' -and $job -match "needs\.checks-pick\.result == 'success'" -and
        $job -match "\(needs\.checks\.result == 'success' \|\| needs\.checks\.result == 'skipped'\)" -and $job -match "\(needs\.checks-linux\.result == 'success' \|\| needs\.checks-linux\.result == 'skipped'\)")
    # Every other run of the harnesses lays the newest build first.
    foreach ($f in 'build.yml', 'build-pr.yml') {
        $b = ([IO.File]::ReadAllText((Join-Path $root ".github\workflows\$f")) -replace "`r`n", "`n")
        Check "6 $f`: the pick lays the newest build, hands its same and commit to the pick, and the build to the shares" (
            $b -match '(?s)  pick:.*?id: content\s+uses: \./\.github/actions/lay-content\s+with:\s+keep: \$\{\{ runner\.temp \}\}/content-laid\s.*?- name: Hand the build to the shares.*?name: content-laid\s.*?retention-days: 1.*?CONTENT_SAME: \$\{\{ steps\.content\.outputs\.same \}\}\s+CONTENT_COMMIT: \$\{\{ steps\.content\.outputs\.commit \}\}.*?Run-Gate\.ps1 -Pick')
        foreach ($j in 'gate', 'gate-linux') {
            $at = $b.IndexOf("`n  ${j}:"); $body = $b.Substring($at + 1); $end = [regex]::Match($body.Substring(3), '\n  [a-z-]+:\n'); if ($end.Success) { $body = $body.Substring(0, $end.Index + 3) }
            Check "6 $f`: $j lays the pick's build before it runs the gate, with no token" ($body -match '(?s)name: content-laid.*?Get-ContentBuild\.ps1 -Newest -ArtifactDir .*?Run-Gate\.ps1 -Shard' -and $body -notmatch 'github\.token|GH_TOKEN')
        }
    }
    # Checkout options may follow persist-credentials. They are still part of
    # checkout, not an intervening step that could read stale content tables.
    $laysNewest = '(?s)actions: read.*?persist-credentials: false\n(?:[ \t]*\n|        [^\n]*\n|      #[^\n]*\n)*      - name: Lay the newest content build\n        uses: \./\.github/actions/lay-content\s*\n'
    foreach ($w in @(@('build.yml', 'checks'), @('build-pr.yml', 'checks'), @('nightly.yml', 'harnesses'), @('harnesses.yml', 'harnesses'), @('gate-map.yml', 'trace'), @('gate-map.yml', 'linux'), @('load-test.yml', 'load'))) {
        $b = ([IO.File]::ReadAllText((Join-Path $root ".github\workflows\$($w[0])")) -replace "`r`n", "`n")
        $at = $b.IndexOf("`n  $($w[1]):"); $body = $b.Substring($at + 1); $end = [regex]::Match($body.Substring(3), '\n  [a-z-]+:\n'); if ($end.Success) { $body = $body.Substring(0, $end.Index + 3) }
        Check "6 $($w[0]) $($w[1]) lays the newest build right after its checkout" ($at -ge 0 -and $body -match $laysNewest)
        if ($w[0] -eq 'build-pr.yml') {
            $late = $body.Replace('      - name: Lay the newest content build', "      - name: Read stale tables`n        run: node stale.js`n      - name: Lay the newest content build")
            Check '6 a step between checkout and laying content is still refused' ($late -notmatch $laysNewest)
            Check '6 keeping checkout credentials is still refused' ($body.Replace('persist-credentials: false', 'persist-credentials: true') -notmatch $laysNewest)
            Check '6 another action cannot stand in for laying content' ($body.Replace('uses: ./.github/actions/lay-content', 'uses: ./another-action') -notmatch $laysNewest)
        }
    }
    # 7. No job downloads the build itself (#6359): every lay in a workflow
    # is the action's, which names the build, has GitHub's download step take
    # it, and lays that folder.
    $direct = @()
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $root '.github/workflows') -Filter '*.yml' -File)) {
        foreach ($l in @([IO.File]::ReadAllLines($f.FullName))) {
            if ($l -match 'Get-ContentBuild\.ps1 .*-Newest' -and $l -notmatch '-ArtifactDir' -and $l -notmatch '^\s*#') { $direct += "$($f.Name): $($l.Trim())" }
        }
    }
    Check ('7 no workflow runs Get-ContentBuild.ps1 -Newest to download a build itself' + $(if ($direct.Count) { ': ' + ($direct -join '; ') } else { '' })) ($direct.Count -eq 0)
    $act = ([IO.File]::ReadAllText((Join-Path $root '.github/actions/lay-content/action.yml')) -replace "`r`n", "`n")
    Check '7 the action names the newest build, downloads it with actions/download-artifact by its id and run, and lays that folder' (
        $act -match '(?s)using: composite.*?id: find.*?Get-ContentBuild\.ps1 -Newest -Find .*?uses: actions/download-artifact@[0-9a-f]{40} # v\S+\s+with:\s+artifact-ids: \$\{\{ steps\.find\.outputs\.artifact \}\}\s+run-id: \$\{\{ steps\.find\.outputs\.run \}\}\s+github-token: \$\{\{ inputs\.github-token \}\}.*?id: lay.*?Get-ContentBuild\.ps1 -Newest -Server \$env:LAY_SERVER -ArtifactDir \$from -Keep .*?Get-ContentBuild\.ps1 -Newest -Server \$env:LAY_SERVER -ArtifactDir \$from\s')
    $pin = [regex]::Match(([IO.File]::ReadAllText((Join-Path $root '.github/workflows/build.yml'))), 'actions/download-artifact@([0-9a-f]{40})').Groups[1].Value
    Check '7 the action pins download-artifact where the workflows do' ($pin -and $act -match "actions/download-artifact@$pin ")
    Check '5 one release at a time on the release job, not the whole workflow, so a run a Deployment''s status starts holds no merge back (#6008)' (
        $wf -notmatch '(?m)^concurrency:' -and $job -match '(?s)concurrency:\s+group: merge-release\s+cancel-in-progress: false')
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "$pass passed, $fail failed"
exit ([int]($fail -gt 0))
