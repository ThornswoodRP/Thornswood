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
    5. merge-release.yml asks for the build before it releases, takes it
       before any part is built, and starts again on a Content Deployment's
       success, with the release's concurrency on its job.

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
    Add-Content -LiteralPath (Join-Path $repo 'game\data\last-plugin.json') -Value ' '
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
    TGit $repo @('clean', '--quiet', '-fd') | Out-Null

    # ------------------------------------------------------- 4. refusals
    $plugin = Join-Path $repo 'game\content\Thornswood-Content.esp'
    $before = Sha ([IO.File]::ReadAllBytes($plugin))
    function Refused([string]$What, [string]$Why, [string]$AssetsDir) {
        $r = Run @('-Repo', $repo, '-ReleasesFile', $rels, '-AssetDir', $AssetsDir, '-Take', '-Output', '')
        $kept = (Sha ([IO.File]::ReadAllBytes($plugin))) -eq $before
        Check "4 $What stops and writes nothing" ($r.Code -eq 1 -and $r.Text -match $Why -and $kept)
        if (-not ($r.Text -match $Why)) { Write-Host ($r.Out | Select-Object -Last 3) }
    }
    $names = @{}; foreach ($n in $built.Keys) { $names[$n] = Sha $built[$n] }
    $bad = $names.Clone(); $bad['game/data/last-plugin.recipe'] = ('0' * 64)
    Refused 'a file that is not the sha256 its record names' 'last-plugin\.recipe in content\.zip on .* is not the sha256' (Plant $built $bad)
    $fewer = $names.Clone(); $fewer.Remove('game/gamemode-tables/NewTable.json')
    Refused 'a file the record does not name' 'NewTable\.json, which content-build\.json does not name' (Plant $built $fewer)
    $more = $names.Clone(); $more['game/data/gone.json'] = ('1' * 64)
    Refused 'a file the zip lacks' 'lacks game/data/gone\.json' (Plant $built $more)
    $out1 = $built.Clone(); $out1['game/../../escape.txt'] = $enc.GetBytes('x')
    Refused 'a path out of the repository' 'which is not a repository path' (Plant $out1)
    Refused 'a record for another key' 'is for dev .*, not dev' (Plant $built $null ('f' * 64))
    Refused 'a record for the other server' 'is for main ' (Plant $built $null $key 'main')

    # ---------------------------------------------- 5. the merge release
    $wf = [IO.File]::ReadAllText((Join-Path $root '.github\workflows\merge-release.yml'))
    $job = $wf.Substring($wf.IndexOf("`n  release:"))
    Check '5 it starts again on deployment_status' ($wf -match '(?m)^  deployment_status:')
    Check '5 a content job asks for the build, on main only, on a push or a Content Deployment''s success' (
        $wf -match "(?s)  content:.*?if: \$\{\{ github\.ref == 'refs/heads/main' && \(github\.event_name != 'deployment_status' \|\| \(github\.event\.deployment\.environment == 'Content' && github\.event\.deployment_status\.state == 'success'\)\) \}\}" -and
        $wf -match 'Get-ContentBuild\.ps1 -Server dev -Ask')
    Check '5 the release waits on it and runs only when the build is found' ($job -match 'needs: content' -and $job -match "if: \$\{\{ needs\.content\.outputs\.found == 'yes' \}\}")
    $takeAt = $job.IndexOf('Get-ContentBuild.ps1 -Server dev -Take')
    Check '5 it takes the build right after the checkout, before any part is built' ($takeAt -gt 0 -and $takeAt -lt $job.IndexOf('- name: Name the release and read the one before'))
    Check '5 one release at a time on the release job, not the whole workflow, so a run a Deployment''s status starts holds no merge back (#6008)' (
        $wf -notmatch '(?m)^concurrency:' -and $job -match '(?s)concurrency:\s+group: merge-release\s+cancel-in-progress: false')
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "$pass passed, $fail failed"
exit ([int]($fail -gt 0))
