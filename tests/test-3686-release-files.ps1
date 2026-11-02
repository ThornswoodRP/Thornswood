<#
  test-3686-release-files.ps1

      pwsh -NoProfile -File .\tests\test-3686-release-files.ps1

  Issue #3686. scripts\release\Publish-ReleaseFiles.ps1 puts every file a
  release names on a GitHub Release, on the release's own tag, named by its
  sha256, for the site to send launchers to (site\server.js, "release
  copies"). This runs the real script against a stand-in GitHub and a
  stand-in site: its three calls out (Invoke-GitHub, Get-SiteFile,
  Get-SiteJson) are replaced in a copy of it under TEMP by ones that read and
  write a JSON state file, so every refusal and every Release it leaves can
  be looked at afterwards.

  It holds:
    - a private repository: nothing uploaded, exit 0;
    - a tag that is not release/<channel>/<id>: exit 1;
    - a new release: a draft made, every file the tag and the record name
      uploaded under its sha256, the installer on main, then published, main
      as the latest; run again, nothing changes;
    - a site file that is not its sha256: exit 1, the Release left a draft;
    - a published Release missing a file: exit 1, nothing uploaded;
    - a Release of more than 100 files: every page of its files is read;
    - a tag from before #3686, which names no files: the live split feed is
      read when it still names that release, and refused when it does not.

  Read only, apart from its folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Sha([byte[]]$b) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)) -replace '-', '').ToLowerInvariant() }

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-release-files-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $src = [IO.File]::ReadAllText((Join-Path $repo 'scripts/release/Publish-ReleaseFiles.ps1'))
    $a = $src.IndexOf('function Invoke-GitHub(')
    $b = $src.IndexOf('function Stop-Run(')
    Yes 'the script sends every call out through Invoke-GitHub, Get-SiteFile and Get-SiteJson' ($a -gt 0 -and $b -gt $a -and
        $src.Substring($a, $b - $a) -match 'function Get-SiteFile' -and $src.Substring($a, $b - $a) -match 'function Get-SiteJson' -and
        $src -notmatch 'Invoke-RestMethod -Uri "\$Site' -and ([regex]::Matches($src, 'Invoke-(RestMethod|WebRequest)')).Count -eq 3)

    # The stand-in: GitHub and the site as one state file.
    $stub = @'
function Save-Fake { [IO.File]::WriteAllText($env:TS_FAKE, ($global:Fake | ConvertTo-Json -Depth 10)) }
$global:Fake = [IO.File]::ReadAllText($env:TS_FAKE) | ConvertFrom-Json
function Invoke-GitHub([string]$Method, [string]$Uri, $Body = $null, [string]$InFile = '', [string]$ContentType = '') {
    $F = $global:Fake
    $F.calls += ,"$Method $Uri"
    $path = $Uri -replace '^https://(api|uploads)\.github\.com/repos/[^/]+/[^/]+', ''
    try {
        if ($Method -eq 'GET' -and $path -eq '') { return [pscustomobject]@{ private = [bool]$F.private } }
        if ($Method -eq 'GET' -and $path -match '^/git/ref/tags/(.+)$') {
            $t = @($F.tags | Where-Object { $_.name -eq $Matches[1] })[0]
            if (-not $t) { throw "404 $Uri" }
            return [pscustomobject]@{ object = [pscustomobject]@{ type = 'tag'; sha = $t.obj } }
        }
        if ($Method -eq 'GET' -and $path -match '^/git/tags/(.+)$') {
            $t = @($F.tags | Where-Object { $_.obj -eq $Matches[1] })[0]
            return [pscustomobject]@{ message = $t.message }
        }
        # Pages of 100, each handed back as one object, the way
        # Invoke-RestMethod hands back a JSON array.
        if ($Method -eq 'GET' -and $path -match '^/releases\?per_page=100&page=(\d+)$') {
            $skip = 100 * ([int]$Matches[1] - 1)
            return ,@($F.releases | Select-Object -Skip $skip -First 100 | ForEach-Object { [pscustomobject]@{ id = $_.id; tag_name = $_.tag_name; draft = $_.draft } })
        }
        if ($Method -eq 'POST' -and $path -eq '/releases') {
            $r = [pscustomobject]@{ id = 100 + @($F.releases).Count; tag_name = $Body.tag_name; draft = $Body.draft; prerelease = $Body.prerelease; make_latest = ''; assets = @() }
            $F.releases += ,$r
            return [pscustomobject]@{ id = $r.id; tag_name = $r.tag_name; draft = $r.draft }
        }
        if ($Method -eq 'GET' -and $path -match '^/releases/(\d+)/assets\?per_page=100&page=(\d+)$') {
            $skip = 100 * ([int]$Matches[2] - 1)
            $id = [int]$Matches[1]
            $r = @($F.releases | Where-Object { $_.id -eq $id })[0]
            return ,@(@($r.assets) | Select-Object -Skip $skip -First 100)
        }
        if ($Method -eq 'POST' -and $path -match '^/releases/(\d+)/assets\?name=(.+)$') {
            $id = [int]$Matches[1]; $name = [uri]::UnescapeDataString($Matches[2])
            $r = @($F.releases | Where-Object { $_.id -eq $id })[0]
            if (-not $r.draft) { throw "422 a published Release was changed" }
            $bytes = [IO.File]::ReadAllBytes($InFile)
            $d = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
            $r.assets += ,[pscustomobject]@{ id = 5000 + @($F.calls).Count; name = $name; state = 'uploaded'; size = $bytes.Length; digest = "sha256:$d" }
            return $null
        }
        if ($Method -eq 'DELETE' -and $path -match '^/releases/assets/(\d+)$') {
            $aid = [int]$Matches[1]
            foreach ($r in $F.releases) { $r.assets = @($r.assets | Where-Object { $_.id -ne $aid }) }
            return $null
        }
        if ($Method -eq 'PATCH' -and $path -match '^/releases/(\d+)$') {
            $id = [int]$Matches[1]
            $r = @($F.releases | Where-Object { $_.id -eq $id })[0]
            $r.draft = $Body.draft; $r.make_latest = $Body.make_latest
            return $null
        }
        throw "the stand-in GitHub has no $Method $path"
    } finally { Save-Fake }
}
function Get-SiteFile([string]$Uri, [string]$OutFile) {
    $rel = $Uri -replace '^https://thornswood\.net/', ''
    $f = Join-Path $env:TS_SITE $rel
    if (-not (Test-Path -LiteralPath $f)) { throw "404 $Uri" }
    Copy-Item -LiteralPath $f -Destination $OutFile
}
function Get-SiteJson([string]$Uri) { return Get-Content -Raw -LiteralPath (Join-Path $env:TS_SITE 'api/public') | ConvertFrom-Json }

'@
    $copy = Join-Path $work 'scripts/release/Publish-ReleaseFiles.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/release/Release-Name.ps1') -Destination (Split-Path -Parent $copy)
    [IO.File]::WriteAllText($copy, $src.Substring(0, $a) + $stub + $src.Substring($b))

    # The site: a record naming two files, a launcher, notes, and the installer.
    $site = Join-Path $work 'site'
    function Put([string]$rel, [byte[]]$bytes) {
        $f = Join-Path $site $rel
        New-Item -ItemType Directory -Path (Split-Path -Parent $f) -Force | Out-Null
        [IO.File]::WriteAllBytes($f, $bytes)
        return (Sha $bytes)
    }
    $enc = New-Object Text.UTF8Encoding($false)
    $f1 = [byte[]](1..40); $f2 = [byte[]](50..90)
    $s1 = Put "feed/assets/$(Sha $f1)" $f1
    $s2 = Put "feed/assets/$(Sha $f2)" $f2
    $recText = '{"Data\\a.esp":"' + $f1.Length + ':' + $s1 + '","Data\\b.nif":"' + $f2.Length + ':' + $s2 + '",":gone:Data\\x.esp":"always",":record:files":"1"}'
    $rec = $enc.GetBytes($recText)
    $sRec = Put "feed/assets/$(Sha $rec)" $rec
    $exe = [byte[]](7..30); $sExe = Put "feed/assets/$(Sha $exe)" $exe
    $news = $enc.GetBytes('[]'); $sNews = Put "feed/assets/$(Sha $news)" $news
    $inst = [byte[]](100..140); $sInst = Put 'file/Thornswood-Setup.exe' $inst
    New-Item -ItemType Directory -Path (Join-Path $site 'api') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $site 'api/public'), (@{ files = @(@{ name = 'Thornswood-Setup.exe'; size = $inst.Length; sha256 = $sInst }) } | ConvertTo-Json -Depth 4))

    $tagNew = 'release/main/20261026-170000'
    $msgNew = "Thornswood main release 20261026-170000`n`nlauncher  1.2.7`nrecord    $sRec`nexe       $sExe`nnews      $sNews"
    $fake = Join-Path $work 'fake.json'
    function Set-Fake($o) { [IO.File]::WriteAllText($fake, ($o | ConvertTo-Json -Depth 10)) }
    function Get-Fake { return [IO.File]::ReadAllText($fake) | ConvertFrom-Json }
    function Run([string]$tag) {
        $env:TS_FAKE = $fake; $env:TS_SITE = $site
        $out = @(& pwsh -NoProfile -File $copy -Tag $tag -Repo 'ThornswoodRP/Thornswood' 2>&1 | ForEach-Object { [string]$_ })
        return @{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
    }
    $base = [ordered]@{ private = $false; calls = @(); releases = @(); tags = @(
        [ordered]@{ name = $tagNew; obj = 't1'; message = $msgNew }) }

    # ---- private ------------------------------------------------------------
    $p = [ordered]@{} + $base; $p.private = $true; Set-Fake $p
    $r = Run $tagNew
    Yes 'a private repository: exit 0, and it says why nothing went up' ($r.Code -eq 0 -and $r.Out -match 'PRIVATE')
    Yes '  and nothing was asked of GitHub but the repository' (@((Get-Fake).calls).Count -eq 1)

    # ---- a tag of another shape ---------------------------------------------
    Set-Fake $base
    $r = Run 'v1.2.7'
    Yes 'a tag that is not release/<channel>/<id> is refused' ($r.Code -eq 1 -and $r.Out -match 'is not release/main')

    # ---- a new release --------------------------------------------------------
    Set-Fake $base
    $r = Run $tagNew
    $g = Get-Fake
    $rel = @($g.releases)[0]
    $names = @($rel.assets | ForEach-Object { $_.name })
    Yes ("a new release is published ({0})" -f ($r.Out -split "`n" | Select-Object -Last 1)) ($r.Code -eq 0 -and $rel -and $rel.draft -eq $false -and $r.Out -match 'PUBLISHED')
    Yes '  on its own tag, as the latest, not a prerelease' ($rel.tag_name -eq $tagNew -and $rel.make_latest -eq 'true' -and $rel.prerelease -eq $false)
    Yes '  holding the record, both files it lists, the launcher and the notes, each named by its sha256' (
        @($sRec, $s1, $s2, $sExe, $sNews | Where-Object { $names -notcontains $_ }).Count -eq 0)
    Yes '  each one GitHub''s own digest of what went up' (@($rel.assets | Where-Object { $_.name -match '^[0-9a-f]{64}$' -and $_.digest -ne ('sha256:' + $_.name) }).Count -eq 0)
    Yes '  and the installer, under its own name, the file the site lists' (@($rel.assets | Where-Object { $_.name -eq 'Thornswood-Setup.exe' -and $_.digest -eq "sha256:$sInst" }).Count -eq 1)
    Yes '  and nothing else' ($names.Count -eq 6)
    $calls = @($g.calls).Count
    $r = Run $tagNew
    $g = Get-Fake
    Yes 'run again: it says it is already there' ($r.Code -eq 0 -and $r.Out -match 'ALREADY')
    Yes '  and uploads nothing' (@($g.calls | Select-Object -Skip $calls | Where-Object { $_ -match '^(POST|PATCH|DELETE) ' }).Count -eq 0)

    # ---- a published Release missing a file -----------------------------------
    $broken = Get-Fake
    $broken.releases[0].assets = @($broken.releases[0].assets | Where-Object { $_.name -ne $s2 })
    $broken.calls = @()
    Set-Fake $broken
    $r = Run $tagNew
    Yes 'a published Release that lacks a file is refused' ($r.Code -eq 1 -and $r.Out -match 'never changed')
    Yes '  and nothing is uploaded to it' (@((Get-Fake).calls | Where-Object { $_ -match '^(POST|PATCH|DELETE) ' }).Count -eq 0)

    # ---- a site file that is not its sha256 -----------------------------------
    Set-Fake $base
    $good = [IO.File]::ReadAllBytes((Join-Path $site "feed/assets/$s2"))
    [IO.File]::WriteAllBytes((Join-Path $site "feed/assets/$s2"), [byte[]](9, 9, 9))
    $r = Run $tagNew
    $g = Get-Fake
    Yes 'a file the site sends that is not its sha256 stops the run' ($r.Code -eq 1 -and $r.Out -match 'nothing was published')
    Yes '  and the Release stays a draft' (@($g.releases).Count -eq 1 -and $g.releases[0].draft -eq $true)
    [IO.File]::WriteAllBytes((Join-Path $site "feed/assets/$s2"), $good)
    $r = Run $tagNew
    $g = Get-Fake
    Yes 'run again once the site is right: the same draft is filled and published' ($r.Code -eq 0 -and @($g.releases).Count -eq 1 -and $g.releases[0].draft -eq $false -and @($g.releases[0].assets).Count -eq 6)

    # ---- more than 100 files: every page of them is read ----------------------
    # A draft already holding 150 other files puts this release's own past
    # the first page, as the dev release's 253 were (#3686).
    $many = [ordered]@{} + $base
    $many.releases = @([ordered]@{ id = 100; tag_name = $tagNew; draft = $true; prerelease = $false; make_latest = ''; assets = @(
        1..150 | ForEach-Object { [ordered]@{ id = 9000 + $_; name = ('other-{0:d3}' -f $_); state = 'uploaded'; size = 1; digest = 'sha256:' + ('0' * 64) } }) })
    Set-Fake $many
    $r = Run $tagNew
    $g = Get-Fake
    Yes 'a draft of more than 100 files is read page by page, filled and published' ($r.Code -eq 0 -and $r.Out -match 'PUBLISHED' -and $g.releases[0].draft -eq $false -and @($g.releases[0].assets).Count -eq 156)
    $r = Run $tagNew
    Yes '  and run again, the published Release is read to its last page and holds all' ($r.Code -eq 0 -and $r.Out -match 'ALREADY')

    # ---- a tag from before #3686 ----------------------------------------------
    $tagOld = 'release/dev/20261025-230853-dev'
    $old = [ordered]@{ private = $false; calls = @(); releases = @(); tags = @(
        [ordered]@{ name = $tagOld; obj = 't2'; message = "Thornswood dev release 20261025-230853-dev`n`nlauncher  1.2.6.10" }) }
    foreach ($n in $s1, $s2, $sRec, $sExe) { Copy-Item -LiteralPath (Join-Path $site "feed/assets/$n") -Destination (New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed-dev/assets')).FullName }
    $settings = $enc.GetBytes((@{ release = @{ id = '20261025-230853-dev'; tag = $tagOld } } | ConvertTo-Json -Compress))
    $sSet = Put "feed-dev/assets/$(Sha $settings)" $settings
    [IO.File]::WriteAllText((Join-Path $site 'feed-dev/version.json'), (@{ launcherVersion = '1.2.6.10'; launcherSha256 = $sExe; baseline = @{ id = 'x'; sha256 = $sRec }; settings = @{ sha256 = $sSet } } | ConvertTo-Json -Depth 4))
    Set-Fake $old
    $r = Run $tagOld
    $g = Get-Fake
    Yes 'a tag that names no files: the live split feed, which names this release, is read' ($r.Code -eq 0 -and $r.Out -match 'PUBLISHED')
    Yes '  a dev release: a prerelease, never the latest, and no installer' ($g.releases[0].prerelease -eq $true -and $g.releases[0].make_latest -eq 'false' -and
        @($g.releases[0].assets | Where-Object { $_.name -eq 'Thornswood-Setup.exe' }).Count -eq 0 -and @($g.releases[0].assets).Count -eq 4)
    $settings = $enc.GetBytes((@{ release = @{ id = '20261026-160000-dev'; tag = 'release/dev/20261026-160000-dev' } } | ConvertTo-Json -Compress))
    $sSet = Put "feed-dev/assets/$(Sha $settings)" $settings
    [IO.File]::WriteAllText((Join-Path $site 'feed-dev/version.json'), (@{ launcherSha256 = $sExe; baseline = @{ sha256 = $sRec }; settings = @{ sha256 = $sSet } } | ConvertTo-Json -Depth 4))
    Set-Fake $old
    $r = Run $tagOld
    Yes '  and once a later Ship moved the feed on, it is refused, nothing uploaded' ($r.Code -eq 1 -and $r.Out -match 'now names' -and @((Get-Fake).releases).Count -eq 0)

    # ---- the workflow ---------------------------------------------------------
    $wf = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/release-files.yml'))
    Yes 'release-files.yml runs only while the repository is public' ($wf -match "if: \`$\{\{ github\.event\.repository\.private == false \}\}")
    Yes '  on GitHub''s hosted runner, never the box' ($wf -match 'runs-on: ubuntu-latest' -and $wf -notmatch 'self-hosted')
    Yes '  with main''s script, and the tag passed through env' ($wf -match 'ref: \$\{\{ github\.event\.repository\.default_branch \}\}' -and $wf -match 'RELEASE_TAG: ' -and $wf -match '-Tag \$env:RELEASE_TAG')
    Yes '  started by a release tag push or by hand' ($wf -match "- 'release/main/\*'" -and $wf -match "- 'release/dev/\*'" -and $wf -match 'workflow_dispatch:')
    $gr = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/git-ref.yml'))
    Yes 'git-ref.yml starts it after a release tag it made, since that tag starts no workflow' ($gr -match 'release-files\.yml/dispatches' -and $gr -match 'actions: write')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
