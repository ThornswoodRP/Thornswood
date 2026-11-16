<#
  test-release-name.ps1

  A release goes by one name, the feed and the store record everything else
  against it, and Ship tags the commit it was built from only after the feed
  is out (#444).

  WHY THIS EXISTS. Measured on 28 September, a release was known by four
  things nothing tied together: the launcher version (shared by every Ship
  that keeps its launcher since #921), the pack id (also its baseline record's
  name since #441), the client runtime's fork commit, and the source commit,
  which was written down nowhere. The repository had no tag for any Ship; the
  v<version> tags are pushed by hand so CI builds a main launcher.
  scripts\release\Release-Name.ps1 is the fix; this drives it, the real
  Publish-Update.ps1 and the real Feed-Store.ps1:

    1. the tag names: release/main/<id> and release/dev/<id>, distinct, valid
       git refs, and never v<...>, the old launchers' tags (#5385)
    2. Get-ReleaseDisagreements: a feed whose names agree has none, and each
       way they can disagree is caught (launcher, packs, baseline, commit, tag)
    3. the real Publish-Update.ps1 in a child PowerShell, publishing for real
       into a folder standing in for the site and the VPS store (-SiteDir), from
       a scratch git checkout: the feed names the release by its pack id, with
       the same id as its baseline, the launcher the feed offers, the commit
       and its tag; releases.txt in the store has the same line; and the
       publisher says it sent it. A -NoUpload -NoPush run (what Ship -DryRun
       passes) and a run whose feed send fails both say nothing was sent; the
       first exits 0 (#1056), the second does not (#1055). The same build
       again is Nothing to do, the rule paths alone being no release (#1012),
       and a second release straight after gets an id of its own (#1057),
       which New-ReleaseId (1b) never takes from the feed.
    4. Add-ReleaseTag against a scratch repository and a bare one standing in
       for GitHub: the annotated tag lands on the commit the feed names, main
       and dev apart; nothing is tagged without the publisher's word, for
       another release, or when the feed's names disagree; a second run is
       quiet; a tag already on another commit is left alone; a push that fails
       says what to run
    5. where Ship.ps1 calls it: after the publisher, after both of its early
       exits, never on a dry run, and only when the publisher set the id,
       which Ship clears first; and Publish-Update sets it only once the feed
       send worked and never under -NoPush

  Nothing here connects to anything, and everything it writes is in its own
  temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
# Publish-Update takes no -Vps; its box here is this machine's stand-in.
$env:THORNSWOOD_VPS = '127.0.0.1'
# The tag goes to the bare origin below with git, as on One. In a cloud
# session Add-ReleaseTag asks GitHub instead (#3314), which
# tests\test-3107-set-ref.ps1 holds.
Remove-Item Env:CLAUDE_CODE_REMOTE -ErrorAction SilentlyContinue
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# The feed below holds a runtime the server already serves, so it carries the note
# version Publish-Update writes today (Source-Notice.ps1), not a number that goes stale.
$noticeV = [int]([regex]::Match((Get-Content -LiteralPath (Join-Path $repo 'scripts\release\Source-Notice.ps1') -Raw), '\$SourceNoticeVersion = (\d+)').Groups[1].Value)
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function RunGit([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& git -C $dir @args 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = ($out -join "`n").Trim() }
}
function Read-Json([string]$path) { return (([IO.File]::ReadAllText($path)) -replace '^\uFEFF', '') | ConvertFrom-Json }

$lib = Join-Path $repo 'scripts\release\Release-Name.ps1'
Yes 'scripts\release\Release-Name.ps1 is there' (Test-Path -LiteralPath $lib)
if (-not (Test-Path -LiteralPath $lib)) { Done }
. $lib
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Yes 'git is on PATH' $false; Done }

$script:gameServer = $null
$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-release-name-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$gitId = @('-c', 'user.name=Thornswood test', '-c', 'user.email=test@thornswood.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false')
$oldGitName = $env:GIT_COMMITTER_NAME; $oldGitMail = $env:GIT_COMMITTER_EMAIL
$env:GIT_COMMITTER_NAME = 'Thornswood test'; $env:GIT_COMMITTER_EMAIL = 'test@thornswood.invalid'
$oldAuthName = $env:GIT_AUTHOR_NAME; $oldAuthMail = $env:GIT_AUTHOR_EMAIL
$env:GIT_AUTHOR_NAME = 'Thornswood test'; $env:GIT_AUTHOR_EMAIL = 'test@thornswood.invalid'

try {
    # ---- 1. the names ----------------------------------------------------------------
    Write-Host ''; Write-Host 'the names'
    $m = Get-ReleaseTagName 'main' '20260928-1630'
    $d = Get-ReleaseTagName 'dev' '20260928-2324-dev'
    Yes "main is release/main/<id> ($m)" ($m -eq 'release/main/20260928-1630')
    Yes "dev is release/dev/<id> ($d)" ($d -eq 'release/dev/20260928-2324-dev')
    Yes 'the same id on the two channels gives two different tags' ((Get-ReleaseTagName 'main' 'x') -ne (Get-ReleaseTagName 'dev' 'x'))
    Yes 'no id, no tag' ((Get-ReleaseTagName 'main' '') -eq '')
    foreach ($tg in $m, $d) {
        $ok = RunGit $Scratch check-ref-format ('refs/tags/' + $tg)
        Yes "  $tg is a valid git tag name" ($ok.Code -eq 0)
    }
    Yes 'no release tag is a v<...> tag, the old launchers'' tags' (-not ($m -like 'v*') -and -not ($d -like 'v*'))
    Yes '  and no workflow builds on a tag push any more (#5385)' (-not (Test-Path -LiteralPath (Join-Path $repo '.github\workflows\release.yml')))

    # ---- 1a. the team's clock, whatever the machine's (31 Oct) -----------------------
    # A GitHub runner keeps UTC and One and the box keep Mountain time, so a
    # note shipped from a runner said a time six hours late and sat out of
    # order on the News tab. Ids and note dates are minted on Mountain time.
    Write-Host ''; Write-Host "the team's clock"
    $mdt = Get-TeamNow ([datetime]::new(2026, 10, 31, 21, 56, 0, [DateTimeKind]::Utc))
    Yes ("21:56 UTC on 31 Oct is 3:56 PM, summer time ({0})" -f $mdt.ToString('h:mm tt', [Globalization.CultureInfo]::InvariantCulture)) ($mdt -eq [datetime]::new(2026, 10, 31, 15, 56, 0))
    $mst = Get-TeamNow ([datetime]::new(2026, 11, 2, 18, 0, 0, [DateTimeKind]::Utc))
    Yes ("  18:00 UTC on 2 Nov is 11:00 AM, standard time ({0})" -f $mst.ToString('h:mm tt', [Globalization.CultureInfo]::InvariantCulture)) ($mst -eq [datetime]::new(2026, 11, 2, 11, 0, 0))
    $pu = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Update.ps1'))
    $rb = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Rollback-Feed.ps1'))
    Yes '  a note Publish-Update or Rollback-Feed writes is dated by it, not by the machine' (
        $pu -match "date\s+=\s+\(Get-TeamNow\)\.ToString\('M-d-yyyy h:mm tt'" -and $rb -match "date = \(Get-TeamNow\)\.ToString\('M-d-yyyy h:mm tt'" -and
        $pu -notmatch "date\s+=\s+\(Get-Date\)" -and $rb -notmatch "date = \(Get-Date\)")
    Yes '  and a release id is minted on the UTC clock unless a time is given, with its Z (#4950)' ((Get-Command New-ReleaseId).ScriptBlock.Ast.Body.ParamBlock -eq $null -and
        ((Get-Command New-ReleaseId).ScriptBlock.Ast.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'UtcNow' }).DefaultValue.Extent.Text -eq '[datetime]::UtcNow')

    # ---- 1b. a new id is never one the feed has (#1057) ------------------------------
    Write-Host ''; Write-Host 'a new release id'
    $at = [datetime]::new(2026, 9, 28, 23, 48, 12, [DateTimeKind]::Utc)
    Yes 'it is the second, yyyyMMdd-HHmmssZ' ((New-ReleaseId $null -UtcNow $at) -eq '20260928-234812Z')
    Yes '  with -dev on dev' ((New-ReleaseId $null -Dev -UtcNow $at) -eq '20260928-234812Z-dev')
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = '20260928-234812Z' }) }
    Yes 'the id of a pack already on the feed moves on to the next second' ((New-ReleaseId $f -UtcNow $at) -eq '20260928-234813Z')
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = '20260928-234812Z' }, [pscustomobject]@{ id = '20260928-234812Z-2' }, [pscustomobject]@{ id = '20260928-234813Z' }) }
    Yes '  past every one taken, parts included' ((New-ReleaseId $f -UtcNow $at) -eq '20260928-234814Z')
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = '20260928-234812Z-dev-2' }) }
    Yes '  a part alone is enough to move it (<id>-2)' ((New-ReleaseId $f -Dev -UtcNow $at) -eq '20260928-234813Z-dev')
    $f = [pscustomobject]@{ packs = @(); releases = @([pscustomobject]@{ id = '20260928-234812Z' }); release = [pscustomobject]@{ id = '20260928-234813Z' }; baseline = [pscustomobject]@{ id = '20260928-234814Z' } }
    Yes '  and so is a release the feed names in releases, release or baseline' ((New-ReleaseId $f -UtcNow $at) -eq '20260928-234815Z')
    $f = [pscustomobject]@{ packs = @([pscustomobject]@{ id = '20260928-2348' }, [pscustomobject]@{ id = '20260928-234812' }) }
    Yes 'an old Mountain id with the same digits is not the new one' ((New-ReleaseId $f -UtcNow $at) -eq '20260928-234812Z')
    # Across the change of shape the newer release still sorts last as text:
    # UTC is ahead of Mountain time, so a new id's digits are larger than any
    # id made before it (test-4950-release-id-instant.ps1 holds the rest).
    $old = '20260928-174812'; $new = New-ReleaseId $null -UtcNow $at
    Yes ('  and an old id from the same instant sorts before it, ordinal') ([string]::CompareOrdinal($old, $new) -lt 0 -and
        [string]::CompareOrdinal($old + '-dev', $new + '-dev') -lt 0 -and (Get-ReleaseIdUtc $old) -eq (Get-ReleaseIdUtc $new))
    $up = [IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Updater.cs'))
    Yes 'the launcher skips a pack only when applied.txt has that exact id' ($up -match '!done\.Contains\(p\.id\)\) list\.Add\(p\)')
    foreach ($s in 'Publish-Update.ps1', 'Rollback-Feed.ps1') {
        $src = [IO.File]::ReadAllText((Join-Path $repo ('scripts\release\' + $s)))
        Yes "$s mints through New-ReleaseId and mints no id from the minute" ($src -match 'New-ReleaseId \$\w+ -Dev:\$Dev' -and $src -notmatch "Get-Date -Format 'yyyyMMdd-HHmm'")
    }

    # ---- 2. do the names agree ---------------------------------------------------------
    Write-Host ''; Write-Host 'do the names agree'
    $c1 = 'a' * 40
    function Good {
        $doc = [pscustomobject][ordered]@{
            launcherVersion = '1.1.102.7'
            packs = @([pscustomobject]@{ id = '20260928-2324-dev' }, [pscustomobject]@{ id = '20260929-0100-dev' }, [pscustomobject]@{ id = '20260929-0100-dev-2' })
            baseline = [pscustomobject]@{ id = '20260929-0100-dev'; sha256 = ('b' * 64); url = 'x'; entries = 3 }
            # The list a channel can be put back to (#442), newest first.
            releases = @([pscustomobject]@{ id = '20260929-0100-dev'; lastPack = '20260929-0100-dev-2' },
                         [pscustomobject]@{ id = '20260928-2324-dev'; lastPack = '20260928-2324-dev' })
        }
        $doc | Add-Member -NotePropertyName release -NotePropertyValue (New-ReleaseRecord '20260929-0100-dev' 'dev' '1.1.102.7' @('20260929-0100-dev', '20260929-0100-dev-2') '20260929-0100-dev' $c1 'claude/x' 0)
        return $doc
    }
    $g = Good
    Yes 'a release whose packs, baseline, launcher and tag agree has no disagreement' (@(Get-ReleaseDisagreements $g).Count -eq 0)
    Yes '  and its tag is release/dev/<id>' ($g.release.tag -eq 'release/dev/20260929-0100-dev')
    $cases = @(
        @('the feed offers another launcher', { param($x) $x.launcherVersion = '1.1.102.8' }, 'launcher'),
        @('a pack that is not on the feed', { param($x) $x.release.packs = @('20260929-0100-dev', '20260929-0100-dev-3') }, 'not on the feed'),
        @('a pack of another release', { param($x) $x.release.packs = @('20260928-2324-dev') }, 'not one of its own'),
        @('a baseline of another release', { param($x) $x.release.baseline = '20260928-2324-dev'; $x.baseline.id = '20260928-2324-dev' }, 'another release'),
        @('the feed names another baseline', { param($x) $x.baseline.id = '20260928-2324-dev' }, 'feed''s baseline'),
        @('a tag for the other channel', { param($x) $x.release.tag = 'release/main/20260929-0100-dev' }, 'names tag'),
        @('a short commit', { param($x) $x.release.commit = 'abc1234'; $x.release.tag = 'release/dev/20260929-0100-dev' }, 'full commit'),
        @('a tag with no commit', { param($x) $x.release.commit = '' }, 'names tag'),
        @('another release is the newest in releases', { param($x) $x.releases = @($x.releases[1], $x.releases[0]) }, 'not the newest'),
        @('its entry in releases ends on another pack', { param($x) $x.releases[0].lastPack = '20260929-0100-dev' }, 'its entry in releases')
    )
    foreach ($c in $cases) {
        $x = Good; & $c[1] $x
        $said = @(Get-ReleaseDisagreements $x)
        Yes ("  caught: {0} ({1})" -f $c[0], ($said -join '; ')) (($said -join ' ') -match $c[2])
    }
    $x = Good; $x.PSObject.Properties.Remove('release')
    Yes '  caught: no release at all' ((@(Get-ReleaseDisagreements $x) -join ' ') -match 'names no release')

    if ($OnWindows) {
        # ---- 3. the real Publish-Update.ps1 ------------------------------------------------
        Write-Host ''; Write-Host 'the real Publish-Update.ps1'
        $fake = Join-Path $Scratch 'repo'
        New-Item -ItemType Directory -Force -Path $fake | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fake -Recurse -Force
        foreach ($f in 'layout.json', 'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt', 'records\generated.json', 'records\ui-gone.json', 'records\shipped-not-ours.json', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences') {
            $from = Join-Path $repo $f
            if (Test-Path -LiteralPath $from) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent (Join-Path $fake $f)) | Out-Null
                Copy-Item -LiteralPath $from -Destination (Join-Path $fake $f) -Force -Recurse
            }
        }
        $reqFrom = Join-Path $repo 'game\required-data'
        if (Test-Path -LiteralPath $reqFrom) {
            New-Item -ItemType Directory -Force -Path (Join-Path $fake 'game\required-data') | Out-Null
            Copy-Item -Path (Join-Path $reqFrom '*') -Destination (Join-Path $fake 'game\required-data') -Recurse -Force
        }
        # The real Stop-Game closes any Skyrim on the machine; nothing here may.
        Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Stop-Game { param([string]`$Root) return `$false }`r`nfunction Get-GameProcesses { param([string]`$Root) return @() }`r`n"
        # No signing setup here: the catalog Publish-Update signs (#2163, phase B) is left unsigned, and the stub answers that it passed.
        Put (Join-Path $fake 'scripts\release\Sign-ReleaseCatalog.ps1') "function Invoke-ReleaseCatalogSign { param([string]`$Catalog, [string]`$RepoDir) return '' }`r`n"
        [void](RunGit $fake init -q)
        [void](RunGit $fake @gitId add -A)
        [void](RunGit $fake @gitId commit -q -m 'the build')
        $head = (RunGit $fake rev-parse HEAD).Out
        Yes "the stand-in checkout has a commit ($($head.Substring(0, [Math]::Min(12, $head.Length))))" ($head -match '^[0-9a-f]{40}$')

        $inst = Join-Path $Scratch 'install'
        $site = Join-Path $Scratch 'site'
        $rel = Join-Path $Scratch 'rel'
        foreach ($dd in 'Game\Data', 'Profile\OwnGame', 'appdata', 'dist') { New-Item -ItemType Directory -Force -Path (Join-Path $inst $dd) | Out-Null }
        New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed'), (Join-Path $site 'feed-dev'), $rel | Out-Null
        [IO.File]::WriteAllLines((Join-Path $inst 'Profile\OwnGame\files.txt'), @('F|V|1024|638000000000000000|Data\collection.esp'))
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed'
        # Every pack carries the reference plugin list in the game server's order,
        # read from its manifest on the resources port. A stand-in server on this
        # machine answers for it, and config.json points there.
        Put (Join-Path $inst 'Profile\OwnGame\plugins.txt') "*ours.esp`r`n"
        $pluginHeader = [byte[]]::new(24)
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($pluginHeader, 0)
        foreach ($plugin in 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'ours.esp') {
            [IO.File]::WriteAllBytes((Join-Path $inst "Game\Data\$plugin"), $pluginHeader)
        }
        Put (Join-Path $inst 'Profile\OwnGame\loadorder.txt') "ours.esp`r`n"
        . (Join-Path $repo 'tests\fixtures\ui-front.ps1')
        Install-UiFrontFixture (Join-Path $inst 'Game')
        # The collection revision record, and a Vortex on it (#3597).
        . (Join-Path $repo 'tests\fixtures\collection-revision.ps1')
        $roaming = Join-Path $inst 'roaming'
        $null = Install-CollectionRevisionFixture -From $repo -RepoCopy $fake -AppData $roaming
        $node = Get-Command node -ErrorAction SilentlyContinue
        Yes 'node is on PATH, for the stand-in game server' ($null -ne $node)
        if ($null -eq $node) { Done }
        # The stand-in takes a port from the system, holds it, and says which on
        # its first line; config.json names the game port one below it, the rule
        # LoadOrder.ps1 reads the resources port by. It used to be given a random
        # number nothing checked was free, and 800 ms to be up (#1728).
        $serverJs = Join-Path $Scratch 'server.js'
        Put $serverJs ("const srv = require('http').createServer(function (q, s) { s.setHeader('Content-Type', 'application/json'); " +
                       "s.end(JSON.stringify({ mods: ['Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm','ours.esp'].map(filename => ({ filename, size: 24, crc32: 1 })) })); }); " +
                       "srv.listen(0, '127.0.0.1', function () { console.log('listening on 127.0.0.1:' + srv.address().port); });")
        $gpsi = New-Object Diagnostics.ProcessStartInfo
        $gpsi.FileName = $node.Source; $gpsi.Arguments = '"' + $serverJs + '"'
        $gpsi.UseShellExecute = $false; $gpsi.CreateNoWindow = $true; $gpsi.RedirectStandardOutput = $true; $gpsi.RedirectStandardError = $true
        $script:gameServer = [Diagnostics.Process]::Start($gpsi)
        $gameErr = $script:gameServer.StandardError.ReadToEndAsync()
        $first = $script:gameServer.StandardOutput.ReadLineAsync()
        $heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
        $m = [regex]::Match($heard, '^listening on 127\.0\.0\.1:(\d+)$')
        $port = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
        Yes "the stand-in game server says it is listening, on a port the system gave it ($port)" ($port -gt 0)
        if (-not $port) {
            if ($script:gameServer.HasExited -and $gameErr.Wait(2000)) { Write-Host $gameErr.Result -ForegroundColor DarkGray }
            Done
        }
        $null = $script:gameServer.StandardOutput.ReadToEndAsync()
        Put (Join-Path $inst 'config.json') ('{"ServerAddress":"127.0.0.1","ServerPort":' + ($port - 1) + '}')
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.bsa') ('x' * 4096)
        # What the last release published, on the stand-in store: the plugin as it
        # was, so this build has something to send. The feed names no baseline
        # record yet, so the store's copy is what it is diffed against.
        # The stand-in UI front carries a SkyMP file (build.js), so the pack's source
        # notice reads records\client-build.json (#1318), copied above. The feed
        # already has that client runtime, as a real feed does, so this run does
        # not stage the six runtime files the stand-in game folder never had.
        $pFork = [string](((Get-Content -LiteralPath (Join-Path $fake 'records\client-build.json') -Raw) -replace '^\uFEFF', '') | ConvertFrom-Json).forkCommit
        # The site's feed is the newest of its generations (Feed-Store.ps1, #2727).
        function SiteFeed { return (Get-FeedVersionFile (Join-Path $site 'feed')) }
        Put (Join-Path $site 'feed\version\00000001.json') ('{"launcherVersion":"1.1.102","packs":[],"news":[],"clientRuntime":{"forkCommit":"' + $pFork + '","url":"https://example.invalid/client-runtime-' + $pFork + '.zip","sha256":"' + ('c' * 64) + '","bytes":4096,"notice":' + $noticeV + '}}')
        Put (Join-Path $site 'feed\published.json') '{"Data\\Platform\\UI\\thornswood-ours.esp":"5:0000000000000000000000000000000000000000000000000000000000000000"}'
        $Shell = (Get-Process -Id $PID).Path
        function Publish([string[]]$extra) {
            $oldA = $env:LOCALAPPDATA; $oldR = $env:APPDATA; $oldE = $ErrorActionPreference
            $env:LOCALAPPDATA = Join-Path $inst 'appdata'
            $env:APPDATA = $roaming
            $ErrorActionPreference = 'Continue'
            try {
                $pu = Join-Path $fake 'scripts\release\Publish-Update.ps1'
                function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
                $argText = (@('-Root', (Q $inst), '-ReleaseDir', (Q $rel), '-DistRoot', (Q (Join-Path $inst 'dist')), '-SiteDir', (Q $site),
                              '-SiteUrl', 'http://127.0.0.1:9', '-NoPause') + @($extra)) -join ' '
                # In this process's scope the way Ship runs it, so the id the
                # publisher hands back can be read afterwards.
                # try/finally: the publisher can stop on a Read-Host this child
                # refuses, and what it handed back is still read.
                $cmd = "`$global:ThornswoodPublishedRelease = ''; `$rc = 1; try { & $(Q $pu) $argText; `$rc = `$LASTEXITCODE } " +
                       "finally { 'PUBLISHED=[' + `$global:ThornswoodPublishedRelease + ']' }; exit `$rc"
                $out = (& $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String); $code = $LASTEXITCODE
            } finally { $env:LOCALAPPDATA = $oldA; $env:APPDATA = $oldR; $ErrorActionPreference = $oldE }
            $said = [regex]::Match($out, 'PUBLISHED=\[([^\]]*)\]')
            return [pscustomobject]@{ Code = $code; Out = $out; Published = $(if ($said.Success) { $said.Groups[1].Value } else { '?' }) }
        }
        function Said($r, [bool]$ok) { if (-not $ok) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 14) -join "`n") -ForegroundColor DarkGray } }
        function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; Said $r $cond }

        # a. A release, sent for real into the stand-in site and store.
        $r = Publish @('-Notes', "'Test release`n- one line'")
        YesR ("a release goes out (exit {0}) and the publisher says which one ({1})" -f $r.Code, $r.Published) ($r.Code -eq 0 -and $r.Published -match '^\d{8}-\d{6}Z$') $r
        $id = $r.Published
        $feed = Read-Json (SiteFeed)
        $rec = Get-ReleaseRecord $feed
        Yes 'the feed the site serves names that release' ($null -ne $rec -and [string]$rec.id -eq $id)
        if ($null -ne $rec) {
            $packIds = @($feed.packs | ForEach-Object { [string]$_.id })
            Yes ("  its packs are the ones it added, named by the release ({0})" -f (@($rec.packs) -join ', ')) (
                @($rec.packs).Count -ge 1 -and @($rec.packs | Where-Object { $packIds -notcontains $_ -or ($_ -ne $id -and $_ -notlike "$id-*") }).Count -eq 0)
            Yes ("  its baseline is the release's own record, and the one the feed names ({0})" -f $rec.baseline) ($rec.baseline -eq $id -and $feed.baseline.id -eq $id)
            # The list a rollback reads is the store's releases.json since #1050,
            # beside the feed and not in it.
            $storeList = Read-ReleaseListFile (Join-Path $site 'feed\releases.json')
            $top = if ($null -ne $storeList -and @($storeList).Count) { @($storeList)[0] } else { $null }
            Yes '  and it is the newest of the releases the channel can be put back to, ending on its last pack' (
                $null -ne $top -and [string]$top.id -eq $id -and [string]$top.lastPack -eq [string]@($rec.packs)[-1])
            Yes '  that list is in the store beside the feed, and the feed carries none' (-not $feed.PSObject.Properties['releases'])
            Yes ("  it names the launcher the feed offers ({0})" -f $rec.launcherVersion) ($rec.launcherVersion -eq '1.1.102' -and $feed.launcherVersion -eq '1.1.102')
            Yes '  the commit it was built from, and the checkout was clean' ($rec.commit -eq $head -and [int]$rec.uncommitted -eq 0)
            Yes ("  and its tag, {0}" -f $rec.tag) ($rec.tag -eq "release/main/$id")
            $bad = @(Get-ReleaseDisagreements $feed $storeList)
            Yes ('  every name agrees' + $(if ($bad.Count) { ': ' + ($bad -join '; ') } else { '' })) ($bad.Count -eq 0)
        }
        $relTxt = Join-Path $site 'feed\releases.txt'
        $line = @(if (Test-Path -LiteralPath $relTxt) { Get-Content -LiteralPath $relTxt | Where-Object { $_ -like "$id`t*" } })
        Yes 'the store''s releases.txt has one line for it, its id first' ($line.Count -eq 1)
        $listed = @(Get-FeedStoreReleases 'main' -SiteDir $site | Where-Object { $_.Id -eq $id })
        Yes '  and Get-FeedStoreReleases reads back the same names' ($listed.Count -eq 1 -and $listed[0].Channel -eq 'main' -and
            $listed[0].Commit -eq $head -and $listed[0].Tag -eq "release/main/$id" -and $listed[0].Baseline -eq $id -and
            $listed[0].LauncherVersion -eq '1.1.102' -and @($listed[0].Packs).Count -eq @($rec.packs).Count)

        # The rule paths still ride in a pack that carries a real change (#1012).
        . (Join-Path $repo 'scripts\release\Ship-Rules.ps1')
        $rule = @(Get-ShipDeleteAlways)
        $zipA = @(Get-ChildItem -LiteralPath (Join-Path $inst 'dist') -Recurse -File -Filter "pack-$id*.zip" -ErrorAction SilentlyContinue)
        $del = @()
        if ($zipA.Count) {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $za = [IO.Compression.ZipFile]::OpenRead($zipA[0].FullName)
            try {
                $de = $za.GetEntry('delete.txt')
                if ($de) { $sr = New-Object IO.StreamReader($de.Open()); try { $del = @($sr.ReadToEnd() -split "`r?`n" | Where-Object { $_ }) } finally { $sr.Dispose() } }
            } finally { $za.Dispose() }
        }
        # delete.txt names them with forward slashes.
        $rule = @($rule | ForEach-Object { $_ -replace '\\', '/' })
        Yes ("  its pack's delete.txt lists every rule path ({0} of {1})" -f @($rule | Where-Object { $del -contains $_ }).Count, $rule.Count) (
            $rule.Count -gt 0 -and @($rule | Where-Object { $del -notcontains $_ }).Count -eq 0)

        # e. The same build again, nothing of ours changed (#1012): the rule paths
        #    alone are no reason for a release, so it stops with Nothing to do,
        #    and says so with exit code 2, the code Ship reads as nothing
        #    released. It was 0 without -Launcher until 6 Oct, which Ship read as
        #    a release and announced.
        $packsBefore = @((Read-Json (SiteFeed)).packs).Count
        $r = Publish @('-Notes', "'Test release`n- the same again'")
        YesR ("the same build again says Nothing to do (exit {0})" -f $r.Code) ($r.Code -eq 2 -and $r.Out -match 'Nothing to do' -and $r.Published -eq '') $r
        Yes '  and the feed gained no pack' (@((Read-Json (SiteFeed)).packs).Count -eq $packsBefore)

        # d. A second real release straight after the first (#1057): its own id,
        #    never the first's, so a launcher that took the first still takes it.
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed for a second release'
        $r = Publish @('-Notes', "'Test release`n- a second one'")
        YesR ("a second release goes out under an id of its own ({0} after {1}, exit {2})" -f $r.Published, $id, $r.Code) (
            $r.Code -eq 0 -and $r.Published -match '^\d{8}-\d{6}Z$' -and $r.Published -ne $id) $r
        $ids = @((Read-Json (SiteFeed)).packs | ForEach-Object { [string]$_.id })
        Yes ("  the feed lists both, no id twice ({0})" -f ($ids -join ', ')) ($ids -contains $id -and $ids -contains $r.Published -and
            @($ids | Select-Object -Unique).Count -eq $ids.Count)
        $applied = @($id)
        Yes '  and a launcher that applied the first has the second still to take' (@($ids | Where-Object { $applied -notcontains $_ }) -contains $r.Published)
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed for a release under a taken name'
        $r2 = Publish @('-Notes', "'Test release`n- a clash'", '-Id', $r.Published)
        YesR ("  an -Id the feed already has is refused (exit {0})" -f $r2.Code) ($r2.Code -ne 0 -and $r2.Out -match 'already has a release or pack named') $r2

        # b. What Ship -DryRun passes: -NoUpload -NoPush. Nothing is sent, so
        #    nothing may be named as sent.
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed again'
        $siteBefore = [IO.File]::ReadAllText((SiteFeed))
        # A fixed id, so the checks below can name it.
        $r = Publish @('-Notes', "'Test release`n- two lines'", '-Id', '20990101-0001', '-NoUpload', '-NoPush', '-NoClose', '-KeepPacks', '0')
        YesR ("-NoUpload -NoPush: the publisher says no release was sent (exit {0})" -f $r.Code) ($r.Published -eq '') $r
        # #1056: a dry run of a real change is a dry run that worked, not exit 1
        # with advice about the ssh key, and it asks nothing of the keyboard.
        YesR ("  and finishes with exit 0, the packs' empty urls expected (exit {0})" -f $r.Code) (
            $r.Code -eq 0 -and $r.Out -notmatch 'uploaded no asset' -and $r.Out -match 'nothing was uploaded') $r
        Yes '  and the site''s feed is what it was' ([IO.File]::ReadAllText((SiteFeed)) -eq $siteBefore)
        $local = Read-Json (Join-Path $rel 'version.json')
        $lrec = Get-ReleaseRecord $local
        Yes '  the feed it wrote here still names its release, with no baseline, as it sent none' ($null -ne $lrec -and $lrec.id -eq '20990101-0001' -and $lrec.baseline -eq '')

        # c. A feed send that fails: the new feed cannot go up to the store.
        Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'the plugin, changed a third time'
        [void](Receive-FeedStore 'main' $rel -SiteDir $site)
        New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed\version.json.part\in-the-way') | Out-Null
        $siteBefore = [IO.File]::ReadAllText((SiteFeed))
        $r = Publish @('-Notes', "'Test release`n- three lines'", '-Id', '20990101-0002')
        YesR ("a feed send that fails: the publisher says no release was sent (exit {0})" -f $r.Code) ($r.Published -eq '' -and $r.Out -match 'NOT SHIPPED') $r
        # #1055: and says it with its exit code, which is all a Ship that keeps its
        # launcher reads; anything but 0 or 2 stops Ship before it tells anybody.
        Yes ("  with an exit code that is not 0 or 2 ({0})" -f $r.Code) ($r.Code -ne 0 -and $r.Code -ne 2)
        Yes '  and the site''s feed is what it was' ([IO.File]::ReadAllText((SiteFeed)) -eq $siteBefore)
        Remove-Item -LiteralPath (Join-Path $site 'feed\version.json.part') -Recurse -Force
    } else {
        Write-Host 'SKIP  the real Publish-Update.ps1: a release that signs here makes its catalog with New-FileCatalog, which only Windows has'
    }

    # ---- 4. the tag --------------------------------------------------------------------
    Write-Host ''; Write-Host 'the tag'
    $work = Join-Path $Scratch 'work'
    $bare = Join-Path $Scratch 'origin.git'
    [void](RunGit $Scratch init -q --bare $bare)
    [void](RunGit $Scratch init -q $work)
    Put (Join-Path $work 'a.txt') 'one'
    [void](RunGit $work @gitId add -A); [void](RunGit $work @gitId commit -q -m one)
    $cA = (RunGit $work rev-parse HEAD).Out
    Put (Join-Path $work 'a.txt') 'two'
    [void](RunGit $work @gitId commit -q -am two)
    $cB = (RunGit $work rev-parse HEAD).Out
    [void](RunGit $work remote add origin $bare)
    $src = Get-ReleaseSource $work
    Yes 'the top of a checkout reports its commit and branch' ($src.Commit -eq $cB -and $src.Branch -and $src.Uncommitted -eq 0)
    New-Item -ItemType Directory -Force -Path (Join-Path $work 'inner') | Out-Null
    Yes '  a folder inside one reports none, so it never names another repository''s commit' ((Get-ReleaseSource (Join-Path $work 'inner')).Commit -eq '')
    # Publish-Update runs off its end, so a git exit code left behind here
    # would be the publisher's own.
    $global:LASTEXITCODE = 0
    [void](Get-ReleaseSource (Join-Path $Scratch 'not-a-checkout'))
    Yes '  and asking a folder that is no checkout leaves the exit code as it was' ($global:LASTEXITCODE -eq 0)
    Put (Join-Path $work 'a.txt') 'three'
    Yes '  and a changed tracked file is counted' ((Get-ReleaseSource $work).Uncommitted -eq 1)
    [void](RunGit $work checkout -q -- a.txt)
    $vf = Join-Path $Scratch 'tagfeed\version.json'
    function Feed-For([string]$rid, [string]$ch, [string]$commit) {
        $doc = [pscustomobject][ordered]@{
            launcherVersion = '1.1.102'
            packs = @([pscustomobject]@{ id = $rid })
            baseline = [pscustomobject]@{ id = $rid; sha256 = ('c' * 64); url = 'x'; entries = 1 }
        }
        $doc | Add-Member -NotePropertyName release -NotePropertyValue (New-ReleaseRecord $rid $ch '1.1.102' @($rid) $rid $commit 'main' 0)
        Put $vf ($doc | ConvertTo-Json -Depth 6)
    }
    function OnOrigin([string]$tag) { return (RunGit $bare rev-parse --verify --quiet ("refs/tags/$tag" + '^{commit}')).Out }

    Feed-For '20260929-0100' 'main' $cA
    $tg = Add-ReleaseTag $work $vf '' 'origin'
    Yes ("without the publisher's word nothing is tagged ({0})" -f $tg.Why) ($tg.Why -and -not (OnOrigin 'release/main/20260929-0100') -and (RunGit $work tag -l).Out -eq '')
    $tg = Add-ReleaseTag $work $vf '20260929-0200' 'origin'
    Yes ("  nor for a release the feed here does not name ({0})" -f $tg.Why) ($tg.Why -match 'names release' -and (RunGit $work tag -l).Out -eq '')
    $doc = Read-Json $vf; $doc.launcherVersion = '1.1.103'; Put $vf ($doc | ConvertTo-Json -Depth 6)
    $tg = Add-ReleaseTag $work $vf '20260929-0100' 'origin'
    Yes ("  nor when the feed's names disagree ({0})" -f $tg.Why) ($tg.Why -match 'disagree' -and (RunGit $work tag -l).Out -eq '')

    Feed-For '20260929-0100' 'main' $cA
    $tg = Add-ReleaseTag $work $vf '20260929-0100' 'origin' 'https://thornswood.net/feed/version.json'
    Yes ("after a publish, release/main/<id> is on origin, on the commit the feed names ({0})" -f $(if ($tg.Why) { $tg.Why } else { 'no complaint' })) (
        -not $tg.Why -and $tg.Tag -eq 'release/main/20260929-0100' -and (OnOrigin 'release/main/20260929-0100') -eq $cA)
    Yes '  an older commit than HEAD, so it tags what was built, not what is checked out' ($cA -ne $cB)
    Yes '  annotated' ((RunGit $bare cat-file -t 'refs/tags/release/main/20260929-0100').Out -eq 'tag')
    $msg = (RunGit $bare tag -l -n20 'release/main/20260929-0100').Out
    Yes '  and the message names the release, its launcher, packs, baseline and feed' (
        $msg -match 'main release 20260929-0100' -and $msg -match 'launcher\s+1\.1\.102' -and $msg -match 'packs\s+20260929-0100' -and
        $msg -match 'baseline\s+20260929-0100' -and $msg -match 'thornswood\.net/feed/version\.json')
    $tg = Add-ReleaseTag $work $vf '20260929-0100' 'origin'
    Yes ('a second run is quiet' + $(if ($tg.Why) { ": $($tg.Why)" } else { '' })) (-not $tg.Why)

    Feed-For '20260929-0100-dev' 'dev' $cB
    $tg = Add-ReleaseTag $work $vf '20260929-0100-dev' 'origin'
    Yes ("a dev release is release/dev/<id>, beside main's" + $(if ($tg.Why) { ": $($tg.Why)" } else { '' })) (
        -not $tg.Why -and (OnOrigin 'release/dev/20260929-0100-dev') -eq $cB -and (OnOrigin 'release/main/20260929-0100') -eq $cA)
    $devTags = @((RunGit $bare tag -l 'release/dev/*').Out -split "`n" | Where-Object { $_ })
    $mainTags = @((RunGit $bare tag -l 'release/main/*').Out -split "`n" | Where-Object { $_ })
    Yes '  and each channel lists only its own' ($devTags.Count -eq 1 -and $mainTags.Count -eq 1)

    Feed-For '20260929-0100' 'main' $cB
    $tg = Add-ReleaseTag $work $vf '20260929-0100' 'origin'
    Yes ("a tag already on another commit is left alone ({0})" -f $tg.Why) ($tg.Why -match 'already names' -and (OnOrigin 'release/main/20260929-0100') -eq $cA)

    Feed-For '20260929-0300' 'main' $cB
    $global:LASTEXITCODE = 0
    $tg = Add-ReleaseTag $work $vf '20260929-0300' (Join-Path $Scratch 'no-such-remote.git')
    Yes ("a push that fails says so ({0})" -f $tg.Why) ($tg.Why -match 'did not reach')
    Yes '  and leaves the exit code as it was, because Ship''s own is its last one' ($global:LASTEXITCODE -eq 0)
    Yes ("  and what to run to finish it ({0})" -f $tg.PutRight) ($tg.PutRight -match '^git push .+ refs/tags/release/main/20260929-0300$')

    Feed-For '20260929-0400' 'main' ('d' * 40)
    $tg = Add-ReleaseTag $work $vf '20260929-0400' 'origin'
    Yes ("a commit this checkout does not have is not tagged ({0})" -f $tg.Why) ($tg.Why -match 'not in this checkout' -and $tg.PutRight -match 'git fetch')

    # ---- 5. where Ship and Publish-Update call it ---------------------------------------
    Write-Host ''; Write-Host 'where it is called'
    function Parse([string]$p) { $tk = $null; $er = $null; $a = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tk, [ref]$er); return [pscustomobject]@{ Ast = $a; Errors = @($er) } }
    $IfAst = [System.Management.Automation.Language.IfStatementAst]
    function Conds($node) {
        $out = @(); $prev = $node; $p = $node.Parent
        while ($p) {
            if ($p -is $IfAst) { foreach ($cl in $p.Clauses) { if ([object]::ReferenceEquals($cl.Item2, $prev)) { $out += $cl.Item1.Extent.Text } }
                                 if ($p.ElseClause -and [object]::ReferenceEquals($p.ElseClause, $prev)) { $out += ('else of ' + $p.Clauses[0].Item1.Extent.Text) } }
            $prev = $p; $p = $p.Parent
        }
        return $out
    }
    $shipPath = Join-Path $repo 'scripts\release\Ship.ps1'
    $ship = Parse $shipPath
    Yes 'Ship.ps1 parses' ($ship.Errors.Count -eq 0)
    $cmds = @($ship.Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))
    $tagCall = @($cmds | Where-Object { $_.GetCommandName() -eq 'Add-ReleaseTag' })
    $pubCall = @($cmds | Where-Object { $_.Extent.Text -match "^&\s*\(Join-Path \`$Here 'Publish-Update\.ps1'\)" })
    Yes 'Ship calls Add-ReleaseTag once, and the publisher once' ($tagCall.Count -eq 1 -and $pubCall.Count -eq 1)
    if ($tagCall.Count -eq 1 -and $pubCall.Count -eq 1) {
        $cond = (Conds $tagCall[0]) -join ' | '
        Yes ("  never on a dry run, and only when the publisher named what it sent ({0})" -f $cond) (
            $cond -match '-not \$DryRun' -and $cond -match '\$global:ThornswoodPublishedRelease')
        $at = $tagCall[0].Extent.StartOffset
        Yes '  after the publisher' ($at -gt $pubCall[0].Extent.StartOffset)
        $exits = @($ship.Ast.FindAll({ param($n) $n -is $IfAst -and $n.Clauses[0].Item1.Extent.Text -match '^\$published -(ne|eq) ' }, $true))
        Yes ("  after both of its early exits, a failed publish and nothing to publish ({0} found)" -f $exits.Count) (
            $exits.Count -ge 2 -and @($exits | Where-Object { $_.Extent.EndOffset -gt $at }).Count -eq 0)
        $clear = @($ship.Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                                              $n.Left.Extent.Text -eq '$global:ThornswoodPublishedRelease' }, $true))
        Yes '  and Ship clears the id just before the publisher runs' ($clear.Count -eq 1 -and $clear[0].Right.Extent.Text -eq "''" -and
            $clear[0].Extent.StartOffset -lt $pubCall[0].Extent.StartOffset)
    }
    $pu = Parse (Join-Path $repo 'scripts\release\Publish-Update.ps1')
    Yes 'Publish-Update.ps1 parses' ($pu.Errors.Count -eq 0)
    $sets = @($pu.Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                                         $n.Left.Extent.Text -eq '$global:ThornswoodPublishedRelease' }, $true))
    $sc = if ($sets.Count -eq 1) { (Conds $sets[0]) -join ' | ' } else { '' }
    Yes ("Publish-Update sets it once, after a feed send that worked and never under -NoPush ({0})" -f $sc) (
        $sets.Count -eq 1 -and $sc -match '-not \$NoPush' -and $sc -match 'else of \$pushFailed')
}
finally {
    if ($script:gameServer) { try { if (-not $script:gameServer.HasExited) { $script:gameServer.Kill() } } catch { } }
    $env:GIT_COMMITTER_NAME = $oldGitName; $env:GIT_COMMITTER_EMAIL = $oldGitMail
    $env:GIT_AUTHOR_NAME = $oldAuthName; $env:GIT_AUTHOR_EMAIL = $oldAuthMail
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
