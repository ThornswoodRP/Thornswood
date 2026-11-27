<#
  test-3287-frida-sources.ps1

      pwsh -NoProfile -File .\tests\test-3287-frida-sources.ps1

  Issue #3287, Patrick's answer C. scripts\release\Publish-FridaSources.ps1
  puts the source of what is inside frida-gum.lib on one permanent Release,
  checks it every night, and says when the six forks may go. This runs the
  real script against a stand-in GitHub, stand-in forks and a stand-in site:
  its three calls out (Invoke-GitHub, Invoke-Git, Get-SiteText) are replaced
  in a copy of it under TEMP. The stand-in Invoke-Git runs the real git, with
  each fork's address pointed at a repository made here, so the archives are
  made the way the run makes them.

  It holds:
    - the record: six parts, each archive named <name>-<commit>.tar, of the
      Frida the client files carry;
    - make: nothing while the repository is private (Patrick, B on
      q-3287-release-when); once public, a draft made, every archive
      checked against the record before
      anything goes up, uploaded, published, never as the latest; run again,
      nothing changes;
    - make refuses a fork tag at another commit, an archive that is not the
      recorded bytes, and a published Release that lacks an archive, with
      nothing uploaded;
    - -Check: passes while private with the forks up and no Release yet,
      fails once public with no Release, passes on a whole Release, and fails
      on a wrong archive, a moved fork tag, or another Frida in the client;
      with forksUp false the forks are not asked;
    - -ForksMayGo: 2 while private, while a feed's runtime or release
      predates the note that names the Release, or while a game Release
      does; 0 once everything offered names it.

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
function Sha([string]$f) { return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() }

# ---- the record itself ------------------------------------------------------------
$real = [IO.File]::ReadAllText((Join-Path $repo 'records/frida-sources.json')) | ConvertFrom-Json
$cl = [IO.File]::ReadAllText((Join-Path $repo 'records/client-licences.json')) | ConvertFrom-Json
$named = @($real.parts | Where-Object { $_.commit -match '^[0-9a-f]{40}$' -and $_.sha256 -match '^[0-9a-f]{64}$' -and [long]$_.bytes -gt 0 -and $_.archive -eq ($_.name + '-' + $_.commit + '.tar') -and $_.upstream -match '^frida/' })
Yes 'records\frida-sources.json names six parts, each with a commit, a sha256, bytes, Frida''s repository and an archive <name>-<commit>.tar' (@($real.parts).Count -eq 6 -and $named.Count -eq 6)
Yes '  of the Frida client-licences.json says the client files carry' ([string]$real.frida -eq [string]$cl.ports.'frida-gum'.version)
Yes '  on a Release tag of its own, frida-sources-<version>' ([string]$real.release.tag -eq ('frida-sources-' + $real.frida))
$wf = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/frida-sources.yml'))
$nightly = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/nightly.yml'))
Yes 'frida-sources.yml runs the script on GitHub''s hosted runner with the run''s own token, by hand only, and only once the repository is public' ($wf -match 'if: \$\{\{ github\.event\.repository\.private == false \}\}' -and $wf -match 'runs-on: ubuntu-latest' -and $wf -match 'Publish-FridaSources\.ps1' -and $wf -match 'GH_TOKEN: \$\{\{ github\.token \}\}' -and $wf -notmatch '(?m)^\s+(push|schedule|pull_request)' -and $wf -notmatch 'self-hosted')
Yes 'the nightly run checks it' ($nightly -match 'Publish-FridaSources\.ps1 -Check')

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-frida-sources-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $src = [IO.File]::ReadAllText((Join-Path $repo 'scripts/release/Publish-FridaSources.ps1'))
    $a = $src.IndexOf('function Invoke-GitHub(')
    $b = $src.IndexOf('function Stop-Run(')
    Yes 'the script sends every call out through Invoke-GitHub, Invoke-Git and Get-SiteText' ($a -gt 0 -and $b -gt $a -and
        $src.Substring($a, $b - $a) -match 'function Invoke-Git\(' -and $src.Substring($a, $b - $a) -match 'function Get-SiteText' -and
        ([regex]::Matches($src, 'Invoke-(RestMethod|WebRequest)')).Count -eq 2 -and ([regex]::Matches($src, '& git ')).Count -eq 1)

    $stub = @'
function Save-Fake { [IO.File]::WriteAllText($env:TS_FAKE, ($global:Fake | ConvertTo-Json -Depth 10)) }
$global:Fake = [IO.File]::ReadAllText($env:TS_FAKE) | ConvertFrom-Json
function Invoke-GitHub([string]$Method, [string]$Uri, $Body = $null, [string]$InFile = '', [string]$Accept = '') {
    $F = $global:Fake
    $F.calls += ,"$Method $Uri"
    $path = $Uri -replace '^https://(api|uploads)\.github\.com/repos/[^/]+/[^/]+', ''
    try {
        if ($Method -eq 'GET' -and $path -eq '') { return [pscustomobject]@{ private = [bool]$F.private } }
        if ($Method -eq 'GET' -and $path -match '^/releases\?per_page=100&page=(\d+)$') {
            # One object, as Invoke-RestMethod hands on a JSON list.
            if ([int]$Matches[1] -gt 1) { return ,@() }
            return ,@($F.releases | ForEach-Object { [pscustomobject]@{ id = $_.id; tag_name = $_.tag_name; draft = $_.draft } })
        }
        if ($Method -eq 'POST' -and $path -eq '/releases') {
            $r = [pscustomobject]@{ id = 100 + @($F.releases).Count; tag_name = $Body.tag_name; draft = $Body.draft; target = $Body.target_commitish; make_latest = ''; assets = @() }
            $F.releases += ,$r
            return [pscustomobject]@{ id = $r.id; tag_name = $r.tag_name; draft = $r.draft }
        }
        if ($Method -eq 'GET' -and $path -match '^/releases/(\d+)/assets\?per_page=100&page=(\d+)$') {
            if ([int]$Matches[2] -gt 1) { return ,@() }
            $id = [int]$Matches[1]
            return ,@(@($F.releases | Where-Object { $_.id -eq $id })[0].assets)
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
        if ($Method -eq 'GET' -and $path -match '^/git/ref/tags/(.+)$') {
            $t = @($F.tags | Where-Object { $_.name -eq $Matches[1] })[0]
            return [pscustomobject]@{ object = [pscustomobject]@{ type = 'tag'; sha = ('t' + $t.commit) } }
        }
        if ($Method -eq 'GET' -and $path -match '^/git/tags/t(.+)$') { return [pscustomobject]@{ object = [pscustomobject]@{ sha = $Matches[1] } } }
        if ($Method -eq 'GET' -and $path -match '^/contents/scripts/release/Source-Notice\.ps1\?ref=(.+)$') {
            $v = $F.notice.($Matches[1])
            if ($null -eq $v) { throw "404 $Uri" }
            return "# a note`n`$SourceNoticeVersion = $v`n"
        }
        throw "the stand-in GitHub has no $Method $path"
    } finally { Save-Fake }
}
function Invoke-Git([string[]]$GitArgs) {
    $GitArgs = @($GitArgs | ForEach-Object { if ($_ -match '^https://github\.com/[^/]+/(.+)$') { Join-Path $env:TS_FORKS ($Matches[1] + '.git') } else { $_ } })
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $o = @(& git @GitArgs 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") }
    } finally { $ErrorActionPreference = $eap }
}
function Get-SiteText([string]$Uri) {
    $f = Join-Path $env:TS_SITE ($Uri -replace '^https://thornswood\.net/', '')
    if (-not (Test-Path -LiteralPath $f)) { throw "404 $Uri" }
    return [IO.File]::ReadAllText($f)
}

'@
    $copy = Join-Path $work 'scripts/release/Publish-FridaSources.ps1'
    New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
    [IO.File]::WriteAllText($copy, $src.Substring(0, $a) + $stub + $src.Substring($b))
    # The script takes its scratch folder from the helper beside it (#4264).
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/release/Get-ScratchDir.ps1') -Destination (Split-Path -Parent $copy)

    # ---- two forks, each with the tag at a commit, and the record of them ---------
    $forks = Join-Path $work 'forks'
    $parts = @()
    foreach ($n in @('frida-one', 'frida-two')) {
        $w = Join-Path $work ('w-' + $n)
        & git -c init.defaultBranch=main init -q $w
        [IO.File]::WriteAllText((Join-Path $w 'COPYING'), "the $n licence`n")
        New-Item -ItemType Directory -Path (Join-Path $w 'src') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $w 'src/a.c'), "int $($n.Replace('-', '_'))(void) { return 1; }`n")
        & git -C $w add -A
        & git -C $w -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m one
        & git -C $w tag thornswood-frida-1.2.3
        $c = ((& git -C $w rev-parse HEAD) -join '').Trim()
        & git clone -q --bare $w (Join-Path $forks ($n + '.git'))
        $t = Join-Path $work ($n + '.tar')
        $pre = '--prefix=' + $n + '-' + $c + '/'
        $to = '--output=' + $t
        & git -C $w archive --format=tar $pre $to $c
        $parts += [ordered]@{ holds = $n; name = $n; upstream = ('frida/' + $n); commit = $c; archive = ($n + '-' + $c + '.tar'); sha256 = (Sha $t); bytes = (Get-Item -LiteralPath $t).Length }
    }
    $recDir = Join-Path $work 'records'
    New-Item -ItemType Directory -Path $recDir -Force | Out-Null
    $recPath = Join-Path $recDir 'frida-sources.json'
    function Write-Record($Edit) {
        $r = [ordered]@{ frida = '1.2.3'; release = [ordered]@{ repo = 'Owner/Repo'; tag = 'frida-sources-1.2.3' }; forkTag = 'thornswood-frida-1.2.3'; forksUp = $true
                         parts = @($parts | ForEach-Object { [ordered]@{} + $_ }) }
        if ($Edit) { & $Edit $r }
        [IO.File]::WriteAllText($recPath, ($r | ConvertTo-Json -Depth 6))
    }
    function Write-Licences([string]$v) {
        [IO.File]::WriteAllText((Join-Path $recDir 'client-licences.json'), (@{ ports = @{ 'frida-gum' = @{ version = $v } } } | ConvertTo-Json -Depth 4))
    }
    Write-Record $null
    Write-Licences '1.2.3'

    $site = Join-Path $work 'site'
    $env:TS_FAKE = Join-Path $work 'fake.json'
    $env:TS_FORKS = $forks
    $env:TS_SITE = $site
    function New-Fake([bool]$private) {
        $global:F0 = [pscustomobject]@{ private = $private; calls = @(); releases = @(); tags = @(); notice = [pscustomobject]@{} }
        [IO.File]::WriteAllText($env:TS_FAKE, ($global:F0 | ConvertTo-Json -Depth 10))
    }
    function Fake { return [IO.File]::ReadAllText($env:TS_FAKE) | ConvertFrom-Json }
    function Set-Fake([scriptblock]$Edit) { $f = Fake; & $Edit $f; [IO.File]::WriteAllText($env:TS_FAKE, ($f | ConvertTo-Json -Depth 10)) }
    function Run([string[]]$More) {
        $out = @(& pwsh -NoProfile -File $copy -Record $recPath @More 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
    }

    # ---- make --------------------------------------------------------------------
    New-Fake $true
    $r = Run @()
    Yes 'make: while the repository is private it makes nothing and says why (Patrick, B: on the day it goes public)' ($r.Code -eq 0 -and $r.Out -match 'PRIVATE' -and @((Fake).releases).Count -eq 0 -and -not @((Fake).calls | Where-Object { $_ -match '^(POST|PATCH|DELETE) ' }).Count)
    New-Fake $false
    $r = Run @()
    $f = Fake
    $rel = @($f.releases)[0]
    Yes '  once public, a new Release is published with both archives' ($r.Code -eq 0 -and $r.Out -match 'PUBLISHED' -and @($f.releases).Count -eq 1 -and -not $rel.draft -and @($rel.assets).Count -eq 2)
    if ($r.Code -ne 0) { Write-Host $r.Out }
    $held = @($parts | Where-Object { $p = $_; @($rel.assets | Where-Object { $_.name -eq $p.archive -and $_.digest -eq ('sha256:' + $p.sha256) -and $_.size -eq $p.bytes }).Count -eq 1 })
    Yes '  each archive under its name, the recorded bytes' ($held.Count -eq 2)
    Yes '  on the record''s tag, from main, never the latest' ($rel.tag_name -eq 'frida-sources-1.2.3' -and $rel.target -eq 'main' -and $rel.make_latest -eq 'false')
    $r = Run @()
    $f2 = Fake
    $writes = { param($x) @($x.calls | Where-Object { $_ -match '^(POST|PATCH|DELETE) ' }).Count }
    Yes '  run again, it says so and changes nothing' ($r.Code -eq 0 -and $r.Out -match 'ALREADY' -and (& $writes $f2) -eq (& $writes $f))
    if ($r.Code -ne 0) { Write-Host $r.Out }

    # A fork whose tag is another commit.
    $w = Join-Path $work 'w-frida-two'
    & git -C $w -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m two
    & git -C $w tag -f thornswood-frida-1.2.3 2>&1 | Out-Null
    & git -C $w push -q -f (Join-Path $forks 'frida-two.git') refs/tags/thornswood-frida-1.2.3 2>&1 | Out-Null
    New-Fake $false
    $r = Run @()
    Yes 'make refuses a fork tag at another commit, with nothing made' ($r.Code -eq 1 -and $r.Out -match 'frida-two' -and $r.Out -match 'nothing was uploaded' -and @((Fake).releases).Count -eq 0)
    New-Fake $true
    $r = Run @('-Check')
    Yes '-Check fails on that moved tag, naming the fork' ($r.Code -eq 1 -and $r.Out -match "the fork frida-two's tag")
    Write-Record { param($x) $x.forksUp = $false }
    $r = Run @('-Check')
    Yes '  and with forksUp false it does not ask the forks' ($r.Code -eq 0)
    $back = $parts[1].commit
    & git -C $w tag -f thornswood-frida-1.2.3 $back 2>&1 | Out-Null
    & git -C $w push -q -f (Join-Path $forks 'frida-two.git') refs/tags/thornswood-frida-1.2.3 2>&1 | Out-Null

    # An archive that is not the recorded bytes.
    Write-Record { param($x) $x.parts[0].sha256 = ('0' * 64) }
    New-Fake $false
    $r = Run @()
    Yes 'make refuses an archive that is not the recorded bytes, with nothing made' ($r.Code -eq 1 -and $r.Out -match 'not the recorded' -and @((Fake).releases).Count -eq 0)
    Write-Record $null

    # A published Release that lacks an archive.
    New-Fake $false
    Set-Fake { param($x) $x.releases = @([pscustomobject]@{ id = 7; tag_name = 'frida-sources-1.2.3'; draft = $false; target = 'main'; make_latest = 'false'; assets = @() }) }
    $r = Run @()
    Yes 'make refuses a published Release that lacks an archive, and uploads nothing' ($r.Code -eq 1 -and $r.Out -match 'never changed' -and -not @((Fake).calls | Where-Object { $_ -match '^POST ' }).Count)

    # ---- -Check ------------------------------------------------------------------
    New-Fake $true
    $r = Run @('-Check')
    Yes '-Check passes while private, the forks up and no Release yet' ($r.Code -eq 0 -and $r.Out -match 'not made yet')
    New-Fake $false
    $r = Run @('-Check')
    Yes '  and fails once the repository is public with no Release' ($r.Code -eq 1 -and $r.Out -match 'is public and the Release')
    $null = Run @()
    $r = Run @('-Check')
    Yes '  and passes on a whole Release' ($r.Code -eq 0 -and $r.Out -match 'whole')
    Set-Fake { param($x) $x.releases[0].assets[0].digest = ('sha256:' + ('1' * 64)) }
    $r = Run @('-Check')
    Yes '  and fails when an archive on it is other bytes' ($r.Code -eq 1 -and $r.Out -match 'lacks 1 archive')
    Set-Fake { param($x) $x.releases[0].draft = $true }
    $r = Run @('-Check')
    Yes '  and fails on a draft' ($r.Code -eq 1 -and $r.Out -match 'is a draft')
    New-Fake $true
    Write-Licences '1.2.4'
    $r = Run @('-Check')
    Yes '  and fails when the client files carry another Frida' ($r.Code -eq 1 -and $r.Out -match 'a new Frida needs its own archives')
    Write-Licences '1.2.3'

    # ---- -ForksMayGo -------------------------------------------------------------
    New-Item -ItemType Directory -Path (Join-Path $site 'feed') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $site 'feed-dev/assets') -Force | Out-Null
    function Write-Feeds([int]$MainNotice, [string]$MainCommit, [string]$DevCommit) {
        [IO.File]::WriteAllText((Join-Path $site 'feed/version.json'), (@{ clientRuntime = @{ notice = $MainNotice }; release = @{ commit = $MainCommit } } | ConvertTo-Json -Depth 4))
        $rest = (@{ clientRuntime = @{ notice = 3 }; release = @{ commit = $DevCommit } } | ConvertTo-Json -Depth 4)
        $p = Join-Path $site 'feed-dev/settings.json'
        [IO.File]::WriteAllText($p, $rest)
        $s = Sha $p
        Move-Item -LiteralPath $p -Destination (Join-Path $site "feed-dev/assets/$s") -Force
        [IO.File]::WriteAllText((Join-Path $site 'feed-dev/version.json'), (@{ settings = @{ sha256 = $s } } | ConvertTo-Json))
    }
    $old = 'a' * 40; $new = 'b' * 40; $newer = 'c' * 40
    Write-Feeds 2 $old $new
    New-Fake $false
    Set-Fake { param($x) $x.notice = [pscustomobject]@{ $old = 2; $new = 3; $newer = 3 } }
    $r = Run @()
    Yes '  (the Release is made for these)' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Set-Fake { param($x) $x.private = $true }
    $r = Run @('-ForksMayGo')
    Yes '-ForksMayGo: not while the repository is private' ($r.Code -eq 2 -and $r.Out -match 'repository is private')
    if ($r.Code -ne 2) { Write-Host $r.Out }
    Set-Fake { param($x) $x.private = $false }
    $r = Run @('-ForksMayGo')
    Yes '  not while main''s runtime and release predate the note that names the Release' ($r.Code -eq 2 -and $r.Out -match "feed's client runtime carries notice 2" -and $r.Out -match "feed's release was made from aaaaaaaa" -and $r.Out -notmatch 'feed-dev')
    Write-Feeds 3 $newer $new
    Set-Fake { param($x) $x.releases += ,[pscustomobject]@{ id = 9; tag_name = 'release/main/20261101-120000'; draft = $false; assets = @() }; $x.tags = @([pscustomobject]@{ name = 'release/main/20261101-120000'; commit = $old }) }
    $r = Run @('-ForksMayGo')
    Yes '  not while a game Release was made before it' ($r.Code -eq 2 -and $r.Out -match 'the Release of release/main/20261101-120000 was made from aaaaaaaa')
    if ($r.Code -ne 2) { Write-Host $r.Out }
    Set-Fake { param($x) $x.tags = @([pscustomobject]@{ name = 'release/main/20261101-120000'; commit = $newer }) }
    $r = Run @('-ForksMayGo')
    Yes '  yes once everything offered names the Release' ($r.Code -eq 0 -and $r.Out -match 'YES  the forks may go')
    if ($r.Code -ne 0) { Write-Host $r.Out }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
