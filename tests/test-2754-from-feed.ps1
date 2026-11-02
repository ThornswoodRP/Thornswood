<#
  test-2754-from-feed.ps1

      pwsh -NoProfile -File .\tests\test-2754-from-feed.ps1

  A release built from the feed, with no game folder of the collection's
  (#2754, Patrick's A of 20 Oct), signed on GitHub in the engine fork (#2903,
  Patrick's A of 20 Oct).

  What this proves:
    1. ShippedBytes.ps1: a text file of the repo goes out with CRLF line ends
       whatever the checkout holds, the way One's checkout has always shipped
       it; a file with a NUL in it goes out as its bytes; a copy replaces what
       was there rather than writing through it.
    2. Get-ShipFeedOrderProblem (Ship-Rules.ps1): the last release's plugin
       list holds when the server loads the masters, its Creation Club
       plugins and the list, in that order; a moved plugin and one the server
       does not load are refused, saying a load order change ships from One.
    3. Get-ShipSkyUIFeedChange (Ship-Rules.ps1): SkyUI's check carries over
       only while no script, menu or archive differs from the last record;
       a changed one, a new one and a missing one are named; a path every
       release deletes is not.
    4. New-FeedRoot.ps1 against a stand-in site (-SiteDir): it stages every
       file of the last record by its sha256, removes what the record does not
       name, keeps what is already right, writes config.json from the feed,
       and refuses a record without :record:files and an asset whose bytes
       are not its name. The client is held to the checkout's record, taken
       from this channel's assets or else the other's, else from CI's engine
       build of the pin (a stand-in folder, -EngineDist), and refused when
       none of them holds the recorded bytes (#2983).
    5. Sign-OnGitHub.ps1 with a stand-in gh and box: it sends release.json and
       Thornswood's own pin, account and signer to the fork's workflow, waits
       for that run, takes its catalog, and returns '' only when the box
       accepts it; a red run, no run, a box refusal and a box that says
       nothing all refuse, and the box script is ASCII.
    6. Where it sits: Ship -FromFeed signs on GitHub and never asks for a
       signing machine, and Publish-Update -FromFeed sends release.json
       without making the catalog itself.

  Nothing connects anywhere, and everything it writes is in its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$rel = Join-Path $repo 'scripts\release'

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
function Put([string]$path, $content) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    if ($content -is [byte[]]) { [IO.File]::WriteAllBytes($path, $content) }
    else { [IO.File]::WriteAllText($path, [string]$content, (New-Object Text.UTF8Encoding($false))) }
}
function ShaBytes([byte[]]$b) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return -join ($h.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) } finally { $h.Dispose() }
}
function ShaFile([string]$p) { return (ShaBytes ([IO.File]::ReadAllBytes($p))) }
function Utf8([string]$s) { return [Text.Encoding]::UTF8.GetBytes($s) }

. (Join-Path $rel 'ShippedBytes.ps1')
. (Join-Path $rel 'Ship-Rules.ps1')

$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-2754-feed-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
try {
    # ---- 1. the bytes a repo file ships as ------------------------------------------
    Write-Host ''; Write-Host 'the bytes a repo file ships as'
    $lf = Join-Path $Scratch 'lf.js'; Put $lf "a`nb`n"
    $crlf = Join-Path $Scratch 'crlf.js'; Put $crlf "a`r`nb`r`n"
    $mixed = Join-Path $Scratch 'mixed.js'; Put $mixed "a`r`nb`nc"
    Yes 'an LF file ships with CRLF' ([Text.Encoding]::ASCII.GetString((Get-ThornswoodShippedBytes $lf)) -eq "a`r`nb`r`n")
    Yes '  a CRLF file ships as it is' ([Text.Encoding]::ASCII.GetString((Get-ThornswoodShippedBytes $crlf)) -eq "a`r`nb`r`n")
    Yes '  a mixed one ships with CRLF throughout' ([Text.Encoding]::ASCII.GetString((Get-ThornswoodShippedBytes $mixed)) -eq "a`r`nb`r`nc")
    Yes '  and the LF and CRLF checkouts fingerprint the same' ((Get-ThornswoodShippedSha256 $lf) -eq (Get-ThornswoodShippedSha256 $crlf) -and (Get-ThornswoodShippedSha256 $crlf) -eq (ShaFile $crlf))
    $bin = Join-Path $Scratch 'plugin.esp'; $binBytes = [byte[]](0x54, 0x45, 0x53, 0x34, 0x00, 0x0A, 0x41, 0x0A)
    Put $bin $binBytes
    Yes 'a file with a NUL in it ships as its bytes' ((ShaBytes (Get-ThornswoodShippedBytes $bin)) -eq (ShaBytes $binBytes))
    $utf = Join-Path $Scratch 'utf.txt'; Put $utf ("caf" + [char]0xE9 + "`n")
    Yes 'a UTF-8 text keeps every byte but the line ends' ((ShaBytes (Get-ThornswoodShippedBytes $utf)) -eq (ShaBytes (Utf8 ("caf" + [char]0xE9 + "`r`n"))))
    $dst = Join-Path $Scratch 'out\lf.js'; Put $dst 'what was there before'
    Copy-ThornswoodShippedFile $lf $dst
    Yes 'a copy writes the shipped bytes over what was there' ([IO.File]::ReadAllText($dst) -eq "a`r`nb`r`n")
    Yes '  and leaves the source as it was' ([IO.File]::ReadAllText($lf) -eq "a`nb`n")
    $sb = [IO.File]::ReadAllText((Join-Path $rel 'ShippedBytes.ps1'))
    Yes 'ShippedBytes.ps1 is ASCII, for Windows PowerShell 5.1' (-not ($sb.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    # ---- 2. the last release's plugin list against the server's order --------------
    Write-Host ''; Write-Host 'the plugin list against the server'
    $masters = @($ShipBaseMasters)
    $list = @('A.esp', 'B.esp', 'Thornswood-Last.esp')
    $r = Get-ShipFeedOrderProblem (@($masters) + @('_ResourcePack.esl') + $list) $list
    Yes 'the masters, the Creation Club plugin and the list in order: it holds' ($r.Problem -eq '')
    Yes '  and the Creation Club plugin comes back as Ccc' ((@($r.Ccc) -join '|') -eq '_ResourcePack.esl')
    $r = Get-ShipFeedOrderProblem (@($masters) + @('_ResourcePack.esl', 'B.esp', 'A.esp', 'Thornswood-Last.esp')) $list
    Yes 'two plugins the other way round: refused, at the position' ($r.Problem -match 'position' -and $r.Problem -match 'collection Ship')
    $r = Get-ShipFeedOrderProblem (@($masters) + @('A.esp', 'Thornswood-Last.esp')) $list
    Yes 'a plugin the server does not load: refused, naming it' ($r.Problem -match 'B\.esp' -and $r.Problem -match 'does not load')
    $r = Get-ShipFeedOrderProblem (@($masters) + @('a.ESP', 'b.esp', 'Thornswood-Last.esp')) $list
    Yes 'names compare without case' ($r.Problem -eq '')

    # ---- 3. what SkyUI's check reads, against the last record ----------------------
    Write-Host ''; Write-Host 'SkyUI''s check from the feed'
    $g = Join-Path $Scratch 'skyui\Game'
    $files = @{
        'Data\Scripts\ski_main.pex'          = 'the script'
        'Data\Interface\skyui\itemcard.swf'  = 'the item card'
        'Data\Thornswood.bsa'                = 'an archive'
        'Data\Platform\Plugins\chat.js'      = 'not SkyUI''s'
    }
    $record = @{ ':record:files' = '1' }
    foreach ($k in $files.Keys) {
        $p = Join-Path $g $k
        Put $p $files[$k]
        $b = [IO.File]::ReadAllBytes($p)
        $record[$k] = ('{0}:{1}' -f $b.Length, (ShaBytes $b).ToUpperInvariant())
    }
    Yes 'nothing differs: the check holds' (@(Get-ShipSkyUIFeedChange $g $record @()).Count -eq 0)
    Put (Join-Path $g 'Data\Platform\Plugins\chat.js') 'changed, and not SkyUI''s'
    Yes '  a change outside Scripts, Interface and the archives does not count' (@(Get-ShipSkyUIFeedChange $g $record @()).Count -eq 0)
    Put (Join-Path $g 'Data\Interface\Translations\Thornswood-Content_ENGLISH.txt') 'a string table the check never opens'
    Yes '  nor a file under Interface that is not a menu, such as a string table' (@(Get-ShipSkyUIFeedChange $g $record @()).Count -eq 0)
    Put (Join-Path $g 'Data\Scripts\ski_main.pex') 'another script'
    $c = @(Get-ShipSkyUIFeedChange $g $record @())
    Yes 'a changed script is named' (($c -join '|') -eq 'Data\Scripts\ski_main.pex')
    Put (Join-Path $g 'Data\Scripts\ski_main.pex') 'the script'
    Put (Join-Path $g 'Data\Interface\map.swf') 'a loose map'
    $c = @(Get-ShipSkyUIFeedChange $g $record @())
    Yes 'a menu the last release did not have is named' (($c -join '|') -eq 'Data\Interface\map.swf')
    Yes '  unless every release deletes it' (@(Get-ShipSkyUIFeedChange $g $record @('Data\Interface\map.swf')).Count -eq 0)
    Remove-Item -LiteralPath (Join-Path $g 'Data\Interface\map.swf') -Force
    Remove-Item -LiteralPath (Join-Path $g 'Data\Thornswood.bsa') -Force
    $c = @(Get-ShipSkyUIFeedChange $g $record @())
    Yes 'an archive the last release had and this one has not is named' (($c -join '|') -eq 'Data\Thornswood.bsa')

    # ---- 4. New-FeedRoot.ps1 against a stand-in site --------------------------------
    Write-Host ''; Write-Host 'New-FeedRoot.ps1'
    $site = Join-Path $Scratch 'site'
    $assets = Join-Path $site 'feed-dev\assets'
    function Asset([byte[]]$b) { $s = ShaBytes $b; Put (Join-Path $assets $s) $b; return $s }
    $one = Utf8 "the chat plugin`r`n"; $two = [byte[]](1, 2, 3, 0, 4)
    $sOne = Asset $one; $sTwo = Asset $two
    function New-Record([bool]$whole) {
        $m = [ordered]@{}
        if ($whole) { $m[':record:files'] = '1' }
        $m['Data\Platform\Plugins\chat.js'] = ('{0}:{1}' -f $one.Length, $sOne)
        $m['Data\Meshes\body.nif'] = ('{0}:{1}' -f $two.Length, $sTwo)
        return (Asset (Utf8 (([pscustomobject]$m) | ConvertTo-Json)))
    }
    function Set-Feed([string]$recordSha) {
        $feed = [ordered]@{
            launcherVersion = '1.2.6.1'; packs = @(); serverAddress = '192.0.2.7'; serverPort = 7788; siteUrl = 'https://thornswood.net'
            baseline = [ordered]@{ id = '20261020-111032-dev'; sha256 = $recordSha; url = "https://thornswood.net/feed-dev/assets/$recordSha"; entries = 2 }
        }
        Put (Join-Path $site 'feed-dev\version\00000001.json') (([pscustomobject]$feed) | ConvertTo-Json -Depth 5)
    }
    $Shell = (Get-Process -Id $PID).Path
    $root = Join-Path $Scratch 'feed-root'
    # The client record a stage holds the folder to: by default one naming the
    # chat plugin, which the record carries already.
    $clientRec = Join-Path $Scratch 'client-build.json'
    function Set-ClientRecord([hashtable]$files) {
        $f = [ordered]@{}
        foreach ($k in $files.Keys) { $f[$k] = [ordered]@{ sha256 = (ShaBytes $files[$k]); bytes = $files[$k].Length } }
        Put $clientRec (([pscustomobject]@{ forkCommit = 'b6c76e45'; files = [pscustomobject]$f }) | ConvertTo-Json -Depth 5)
    }
    Set-ClientRecord @{ 'Data\Platform\Plugins\chat.js' = $one }
    # CI's engine build of the pin, standing in: absent until a case puts the
    # client in it, so no stage reaches GitHub.
    $engineDist = Join-Path $Scratch 'engine-ci\build\dist\client'
    function Stage([string]$Channel = 'dev') {
        $oldE = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $out = (& $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $rel 'New-FeedRoot.ps1') -Channel $Channel -Root $root -SiteDir $site -ClientRecord $clientRec -EngineDist $engineDist 2>&1 | Out-String); $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $oldE }
        # Squashed: the refusal is an error record, which PowerShell wraps at the
        # console's width (a word can break across two lines) on a runner.
        return [pscustomobject]@{ Code = $code; Out = $out; Squashed = ($out -replace '[\s|]', '') }
    }
    Set-Feed (New-Record $true)
    Put (Join-Path $root 'Game\Data\stray.txt') 'left from something older'
    $r = Stage
    Yes ("it stages the record (exit {0})" -f $r.Code) ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out -ForegroundColor DarkGray }
    Yes '  each file by its sha256' ((ShaFile (Join-Path $root 'Game\Data\Platform\Plugins\chat.js')) -eq $sOne -and (ShaFile (Join-Path $root 'Game\Data\Meshes\body.nif')) -eq $sTwo)
    Yes '  and nothing the record does not name' (-not (Test-Path -LiteralPath (Join-Path $root 'Game\Data\stray.txt')))
    $cfg = [IO.File]::ReadAllText((Join-Path $root 'config.json')) | ConvertFrom-Json
    Yes '  and config.json names the feed''s own server' ($cfg.ServerAddress -eq '192.0.2.7' -and [string]$cfg.ServerPort -eq '7788')
    Yes '  and keeps the record it staged from' (Test-Path -LiteralPath (Join-Path $root 'record\record.json'))
    $r = Stage
    Yes 'a second run fetches nothing that is already right' ($r.Code -eq 0 -and $r.Out -match '0 fetched' -and $r.Out -match '1 already here' -and $r.Out -match 'all 1 files are the recorded build')
    Put (Join-Path $root 'Game\Data\Meshes\body.nif') 'damaged'
    $r = Stage
    Yes '  and fetches again a file whose bytes are wrong' ($r.Code -eq 0 -and (ShaFile (Join-Path $root 'Game\Data\Meshes\body.nif')) -eq $sTwo)
    Set-Feed (New-Record $false)
    $r = Stage
    Yes 'a record whose files are not all on the site is refused' ($r.Code -ne 0 -and $r.Out -match 'does not have all its files on the site')
    Set-Feed (New-Record $true)
    Put (Join-Path $assets $sTwo) 'not the bytes the name says'
    Remove-Item -LiteralPath (Join-Path $root 'Game\Data\Meshes\body.nif') -Force
    $r = Stage
    Yes 'an asset whose bytes are not its name is refused' ($r.Code -ne 0 -and $r.Out -match 'body\.nif could not be staged')
    Put (Join-Path $assets $sTwo) $two

    # The client the checkout records, when the last release carried another
    # build (#2983): main's release has the old client, and the recorded one
    # is on the site only under dev's assets.
    $newClient = Utf8 "the client at b6c76e45`r`n"
    $sNew = ShaBytes $newClient
    $mainAssets = Join-Path $site 'feed\assets'
    function MainAsset([byte[]]$b) { $s = ShaBytes $b; Put (Join-Path $mainAssets $s) $b; return $s }
    $oldClient = Utf8 "the client at 0714e444`r`n"
    $sOld = MainAsset $oldClient; [void](MainAsset $two)
    $mrec = [ordered]@{ ':record:files' = '1'; 'Data\Platform\Plugins\skymp5-client.js' = ('{0}:{1}' -f $oldClient.Length, $sOld); 'Data\Meshes\body.nif' = ('{0}:{1}' -f $two.Length, $sTwo) }
    $mrecSha = MainAsset (Utf8 (([pscustomobject]$mrec) | ConvertTo-Json))
    $mfeed = [ordered]@{
        launcherVersion = '1.2.6'; packs = @(); serverAddress = '192.0.2.7'; serverPort = 7777; siteUrl = 'https://thornswood.net'
        baseline = [ordered]@{ id = '20261017-205912'; sha256 = $mrecSha; url = "https://thornswood.net/feed/assets/$mrecSha"; entries = 2 }
    }
    Put (Join-Path $site 'feed\version\00000001.json') (([pscustomobject]$mfeed) | ConvertTo-Json -Depth 5)
    Set-ClientRecord @{ 'Data\Platform\Plugins\skymp5-client.js' = $newClient }
    $r = Stage 'main'
    Yes 'a recorded client the last release lacks is refused when neither feed nor CI''s engine build has it' ($r.Code -ne 0 -and $r.Out -match 'on neither feed' -and $r.Out -match 'skymp5-client\.js' -and $r.Squashed -match 'noenginebuildat')
    # A client no Ship has carried yet (#3088's 891f5d47): on neither feed, but
    # in CI's engine build of the pin.
    $ciFile = Join-Path $engineDist 'Data\Platform\Plugins\skymp5-client.js'
    Put $ciFile 'not the recorded client'
    $r = Stage 'main'
    Yes '  and refused when CI''s engine build holds another file than the record names' ($r.Code -ne 0 -and $r.Squashed -match 'holdsanotherData.Platform.Plugins.skymp5-client\.jsthantherecordnames' -and -not (Test-Path -LiteralPath (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js')))
    Put $ciFile ([byte[]]$newClient)
    $r = Stage 'main'
    Yes ("  and taken from CI's engine build of the pin when neither feed has it (exit {0})" -f $r.Code) ($r.Code -eq 0 -and (ShaFile (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js')) -eq $sNew -and $r.Out -match "skymp5-client\.js from CI's engine build of the pin")
    if ($r.Code -ne 0) { Write-Host $r.Out -ForegroundColor DarkGray }
    Remove-Item -LiteralPath (Join-Path $Scratch 'engine-ci') -Recurse -Force
    Remove-Item -LiteralPath (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js') -Force
    [void](Asset $newClient)
    $r = Stage 'main'
    Yes ("  and taken from dev's assets when only dev has it (exit {0})" -f $r.Code) ($r.Code -eq 0 -and (ShaFile (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js')) -eq $sNew -and $r.Out -match 'skymp5-client\.js from /feed-dev')
    if ($r.Code -ne 0) { Write-Host $r.Out -ForegroundColor DarkGray }
    Yes '  and the rest of the release is still staged as recorded' ((ShaFile (Join-Path $root 'Game\Data\Meshes\body.nif')) -eq $sTwo)
    [void](MainAsset $newClient)
    Remove-Item -LiteralPath (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js') -Force
    $r = Stage 'main'
    Yes "  and from the channel's own assets first when it has it" ($r.Code -eq 0 -and $r.Out -match 'skymp5-client\.js from /feed[^-]')
    $r = Stage 'main'
    Yes '  and nothing is taken when the folder already holds the recorded client' ($r.Code -eq 0 -and $r.Out -match 'all 1 files are the recorded build')
    Put (Join-Path $mainAssets $sNew) 'not the client'
    Remove-Item -LiteralPath (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js') -Force
    $r = Stage 'main'
    Yes '  and a copy whose bytes are not the record is passed over for one that is' ($r.Code -eq 0 -and (ShaFile (Join-Path $root 'Game\Data\Platform\Plugins\skymp5-client.js')) -eq $sNew -and $r.Out -match 'from /feed-dev')

    # ---- 5. signing on GitHub, with a stand-in gh and box ---------------------------
    Write-Host ''; Write-Host 'signing on GitHub'
    . (Join-Path $rel 'Sign-OnGitHub.ps1')
    $sign = Join-Path $Scratch 'signed\files\release.json'
    Put $sign '{"schema":1,"release":"20261020-190000-dev","channel":"dev","assets":[]}'
    $cat = Join-Path $Scratch 'signed\release.cat'
    $script:calls = New-Object System.Collections.ArrayList
    $script:runState = @{ Status = 'completed'; Conclusion = 'success'; Seen = $true; Kept = $true }
    $gh = {
        [void]$script:calls.Add(@($args))
        if ($args[0] -eq 'workflow') { return '' }
        if ($args[0] -eq 'run' -and $args[1] -eq 'list') {
            if (-not $script:runState.Seen) { return '[]' }
            $req = ''
            foreach ($c in $script:calls) { $i = [array]::IndexOf($c, 'request=' + $script:want); if ($i -ge 0) { $req = $script:want } }
            return ('[{"databaseId":42,"displayTitle":"sign ' + $req + '","status":"' + $script:runState.Status + '","conclusion":"' + $script:runState.Conclusion + '","url":"https://github.com/ThornswoodRP/skymp/actions/runs/42"},' +
                    '{"databaseId":41,"displayTitle":"sign somebody-else","status":"completed","conclusion":"success","url":"x"}]')
        }
        if ($args[0] -eq 'run' -and $args[1] -eq 'download') {
            $i = [array]::IndexOf($args, '-D')
            if ($script:runState.Kept) { Put (Join-Path $args[$i + 1] 'release.cat') 'a signed catalog' }
            return ''
        }
        throw "gh was asked something unexpected: $($args -join ' ')"
    }
    $script:boxSaid = @('CATALOG ACCEPTED')
    $script:boxScript = ''
    $box = { param($s) $script:boxScript = $s; return $script:boxSaid }
    $launcherUrl = 'https://thornswood.net/feed-dev/assets/' + ('ab' * 32)
    function SignNow([string]$request) {
        $script:want = $request
        $script:calls.Clear()
        return (Invoke-ReleaseCatalogSignOnGitHub -Json $sign -Catalog $cat -RepoDir $repo -Request $request -LauncherUrl $launcherUrl -Gh $gh -Box $box -WaitSeconds 1 -Poll 0)
    }
    $why = SignNow 'r1'
    Yes ("a green run and a box that accepts: signed ('{0}')" -f $why) ($why -eq '')
    Yes '  and the catalog it kept is where the publisher reads it' ([IO.File]::ReadAllText($cat) -eq 'a signed catalog')
    $d = @($script:calls | Where-Object { $_[0] -eq 'workflow' })
    $sent = if ($d.Count) { @($d[0]) } else { @() }
    $pin = Get-SignOnGitHubClientPin $repo
    $meta = [IO.File]::ReadAllText((Join-Path $repo 'records\signing\metadata.json')) | ConvertFrom-Json
    Yes 'it asks the fork''s workflow on main' ($sent -contains 'thornswood-sign-manifest.yml' -and $sent -contains 'ThornswoodRP/skymp' -and $sent -contains 'main')
    Yes '  with release.json and its sha256' ($sent -contains ('manifest=' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($sign))) -and $sent -contains ('manifest_sha256=' + (ShaFile $sign)))
    Yes '  with the pin Setup-ShipMachine.ps1 holds' ($sent -contains ('client_version=' + $pin.Version) -and $sent -contains ('client_sha256=' + $pin.Sha256))
    Yes '  with the account and profile metadata.json names' ($sent -contains ('endpoint=' + $meta.Endpoint) -and $sent -contains ('account=' + $meta.CodeSigningAccountName) -and $sent -contains ('certificate_profile=' + $meta.CertificateProfileName))
    Yes '  and with Updater.cs''s ExpectedSigner' ($sent -contains ('expected_signer=' + (Get-ExpectedSignerFragment -RepoRoot $repo)))
    # #3312: the fork checks the launcher the release names before it signs.
    $gzArg = @($sent | Where-Object { $_ -like 'signature_cs_gz=*' })
    $csBack = ''
    if ($gzArg.Count -eq 1) {
        $gz = New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(, [Convert]::FromBase64String($gzArg[0].Substring(16)))), [IO.Compression.CompressionMode]::Decompress)
        $csBack = (New-Object IO.StreamReader($gz, [Text.Encoding]::UTF8)).ReadToEnd()
    }
    Yes '  and with Signature.cs, gzipped, which unpacks to the file itself (#3312)' ($csBack -ne '' -and $csBack -eq [IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Signature.cs')))
    Yes '  and with where the site serves the launcher the release names' ($sent -contains ('launcher_url=' + $launcherUrl))
    Yes '  and the whole dispatch fits a Windows command line (32,767)' ((($sent | ForEach-Object { [string]$_ }) -join ' ').Length -lt 30000)
    $dl = @($script:calls | Where-Object { $_[0] -eq 'run' -and $_[1] -eq 'download' })
    Yes '  and takes the catalog from that run, by the request''s own name' ($dl.Count -eq 1 -and @($dl[0]) -contains '42' -and @($dl[0]) -contains 'release-cat-r1')
    Yes 'the box is sent the catalog, release.json and the launcher''s own check' ($script:boxScript.Contains([Convert]::ToBase64String([IO.File]::ReadAllBytes($sign))) -and $script:boxScript.Contains('Get-PublishSignRefusal') -and $script:boxScript.Contains('Test-FileCatalog') -and $script:boxScript.Contains('Signature.cs'))
    Yes '  as ASCII, for its Windows PowerShell 5.1' (-not ($script:boxScript.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    Yes '  and its folder goes whatever happens' ($script:boxScript -match 'finally \{ Remove-Item -LiteralPath \$d -Recurse')
    # The box runs that text as Send-Script.ps1's runner hands it over: read
    # from its file and run as a block from -EncodedCommand, so there is no
    # script root. Here it runs the same way, under Windows PowerShell where
    # there is one. On 22 Oct 2026 the first cloud dev Ship stopped at
    # Assert-PublishSigned.ps1's Join-Path on that empty root, before the check
    # began, and nothing had ever run the text.
    $runDir = Join-Path $Scratch 'box-run'
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    $onWin = ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)
    $runCat = $cat
    if ($onWin) {
        $runCat = Join-Path $runDir 'release.cat'
        New-FileCatalog -Path (Split-Path -Parent $sign) -CatalogFilePath $runCat -CatalogVersion 2.0 | Out-Null
    }
    $runText = Join-Path $runDir 'check.ps1'
    [IO.File]::WriteAllText($runText, (New-SignedCatalogCheckScript $sign $runCat 'Thornswood' $repo), (New-Object Text.UTF8Encoding($false)))
    $runner = '$b = [scriptblock]::Create([IO.File]::ReadAllText(''' + $runText.Replace("'", "''") + ''', [Text.Encoding]::UTF8)); . $b'
    $exe = if ($onWin) { 'powershell.exe' } else { (Get-Process -Id $PID).Path }
    # The box's text puts its folder in TEMP, which off Windows nothing sets.
    $hadTemp = $env:TEMP
    $env:TEMP = $runDir
    try { $ran = @(& $exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))) 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $env:TEMP = $hadTemp }
    $ranSaid = @($ran | Where-Object { $_ -match '^CATALOG ' })
    $ranLine = ($ranSaid -join ' | ')
    Yes ("the box's text, run with no script root, says one CATALOG line ('{0}')" -f $ranLine) ($ranSaid.Count -eq 1 -and $ranLine -notmatch 'Cannot bind argument')
    if ($onWin) { Yes '  and gets as far as the launcher''s own check, which refuses an unsigned catalog' ($ranLine -match '^CATALOG REFUSED release\.cat ') }
    else { Yes '  and gets as far as the catalog check, which this machine does not have' ($ranLine -match 'Test-FileCatalog') }
    $script:boxSaid = @('CATALOG REFUSED release.cat is signed by "CN=Somebody", which does not contain ExpectedSigner')
    $why = SignNow 'r2'
    Yes 'a box that refuses it: refused, with the box''s reason' ($why -match 'Somebody')
    $script:boxSaid = @('something else entirely')
    $why = SignNow 'r3'
    Yes 'a box that does not say: refused' ($why -match 'did not say')
    $script:boxSaid = @('CATALOG ACCEPTED')
    $script:runState.Conclusion = 'failure'
    $why = SignNow 'r4'
    Yes 'a red run: refused, with the run' ($why -match 'ended failure' -and $why -match 'runs/42')
    $script:runState.Conclusion = 'success'; $script:runState.Status = 'in_progress'
    $why = SignNow 'r5'
    Yes 'a run still going when the wait is up: refused' ($why -match 'still in_progress')
    $script:runState.Status = 'completed'; $script:runState.Seen = $false
    $why = SignNow 'r6'
    Yes 'no run at all: refused' ($why -match 'started no signing run')
    $script:runState.Seen = $true; $script:runState.Kept = $false
    $why = SignNow 'r7'
    Yes 'a run that kept no catalog: refused' ($why -match 'kept no release\.cat')
    $script:runState.Kept = $true
    $script:want = 'r8'
    $why = Invoke-ReleaseCatalogSignOnGitHub -Json $sign -Catalog $cat -RepoDir $repo -Request 'r8' -LauncherUrl $launcherUrl -Gh { throw 'HTTP 403' } -Box $box -WaitSeconds 1 -Poll 0
    Yes 'a dispatch GitHub refuses: refused, saying so' ($why -match 'could not be started' -and $why -match '403')
    $so = [IO.File]::ReadAllText((Join-Path $rel 'Sign-OnGitHub.ps1'))
    Yes 'Sign-OnGitHub.ps1 is ASCII, for Windows PowerShell 5.1' (-not ($so.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    # ---- 5b. the launcher from GitHub (#3312) ------------------------------------------
    Write-Host ''; Write-Host 'the launcher from GitHub'
    $now = (Get-Date).ToUniversalTime()
    $script:lcalls = New-Object System.Collections.ArrayList
    $script:lstate = @{ TagRun = 'success'; TagStatus = 'completed'; Runs = $true; Status = 'completed'; Conclusion = 'success'; Old = $false }
    $lgh = {
        [void]$script:lcalls.Add(@($args))
        if ($args[0] -eq 'workflow') { return '' }
        if ($args[0] -eq 'run' -and $args[1] -eq 'list') {
            $w = $args[[array]::IndexOf($args, '-w') + 1]
            $when = $now.AddSeconds(5).ToString('yyyy-MM-ddTHH:mm:ssZ')
            if ($script:lstate.Old) { $when = $now.AddHours(-2).ToString('yyyy-MM-ddTHH:mm:ssZ') }
            if ($w -eq 'release-tag.yml') {
                return ('[{"databaseId":7,"displayTitle":"tag v1.2.6.7","headBranch":"main","status":"' + $script:lstate.TagStatus + '","conclusion":"' + $script:lstate.TagRun + '","url":"https://github.com/x/runs/7","createdAt":"' + $when + '"}]')
            }
            if (-not $script:lstate.Runs) { return '[]' }
            # Main's run for the tag (#3930), an older tag's on main, and a
            # newer manual run on the tag's own ref, which signs nothing.
            return ('[{"databaseId":9,"displayTitle":"Release launcher v1.2.6.7","headBranch":"main","status":"' + $script:lstate.Status + '","conclusion":"' + $script:lstate.Conclusion + '","url":"https://github.com/x/runs/9","createdAt":"' + $when + '"},' +
                    '{"databaseId":8,"displayTitle":"Release launcher v1.2.6.6","headBranch":"main","status":"completed","conclusion":"success","url":"x","createdAt":"' + $when + '"},' +
                    '{"databaseId":10,"displayTitle":"Release launcher v1.2.6.7","headBranch":"v1.2.6.7","status":"completed","conclusion":"success","url":"https://github.com/x/runs/10","createdAt":"' + $when + '"}]')
        }
        throw "gh was asked something unexpected: $($args -join ' ')"
    }
    $sha40 = 'c' * 40
    function AskNow { $script:lcalls.Clear(); return (Invoke-ReleaseLauncherOnGitHub -Repo 'ThornswoodRP/Thornswood' -Tag 'v1.2.6.7' -Commit $sha40 -Gh $lgh -WaitSeconds 1 -Poll 0) }
    $why = AskNow
    Yes ("a green release.yml run on the tag: '' ('{0}')" -f $why) ($why -eq '')
    $d = @($script:lcalls | Where-Object { $_[0] -eq 'workflow' })
    Yes '  it asks release-tag.yml on main for that tag and commit' ($d.Count -eq 1 -and @($d[0]) -contains 'release-tag.yml' -and @($d[0]) -contains 'main' -and @($d[0]) -contains 'tag=v1.2.6.7' -and @($d[0]) -contains ('commit=' + $sha40))
    $script:lstate.Conclusion = 'failure'
    $why = AskNow
    Yes 'a red release.yml run: refused, with the run' ($why -match 'ended failure' -and $why -match 'runs/9')
    Yes '  and a green run on the tag''s own ref, which signs nothing, is not taken instead (#3930)' ($why -notmatch 'runs/10')
    $script:lstate.Conclusion = 'success'; $script:lstate.Runs = $false; $script:lstate.TagRun = 'failure'
    $why = AskNow
    Yes 'a red release-tag.yml run (a tag on another commit): refused, with that run' ($why -match 'release-tag\.yml ended failure' -and $why -match 'runs/7')
    $script:lstate.TagRun = 'success'
    $why = AskNow
    Yes 'no release.yml run on the tag: refused when the wait is up' ($why -match 'no release\.yml run on main started for v1\.2\.6\.7')
    $script:lstate.Runs = $true; $script:lstate.Old = $true
    $why = AskNow
    Yes '  and a run from before the ask is not taken for it' ($why -match 'no release\.yml run on main started')
    $script:lstate.Old = $false; $script:lstate.Status = 'in_progress'
    $why = AskNow
    Yes 'a run still going when the wait is up: refused' ($why -match 'still in_progress')
    $script:lstate.Status = 'completed'
    Yes 'a tag that is not v<a.b.c[.d]> is refused before anything is asked' ((Invoke-ReleaseLauncherOnGitHub -Repo 'r' -Tag 'main' -Commit $sha40 -Gh $lgh) -match 'not a launcher release tag')

    # Get-SignedFileRefusal: on the box off Windows, with a stand-in box.
    $exeFile = Join-Path $Scratch 'Thornswood.exe'
    Put $exeFile 'MZ not really a launcher'
    $script:fboxSaid = @('SIGNED ACCEPTED')
    $script:fboxScript = ''
    $fbox = { param($t) $script:fboxScript = $t; return $script:fboxSaid }
    $why = Get-SignedFileRefusal $exeFile 'Thornswood' $repo $fbox
    Yes ("a box that accepts the file: '' ('{0}')" -f $why) ($why -eq '')
    Yes '  the box is sent the file, Signature.cs and Get-PublishSignRefusal' ($script:fboxScript.Contains([Convert]::ToBase64String([IO.File]::ReadAllBytes($exeFile))) -and $script:fboxScript.Contains('Get-PublishSignRefusal -Path $f') -and $script:fboxScript.Contains('Signature.cs'))
    Yes '  as ASCII, for its Windows PowerShell 5.1' (-not ($script:fboxScript.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    Yes '  and its folder goes whatever happens' ($script:fboxScript -match 'finally \{ Remove-Item -LiteralPath \$d -Recurse')
    $script:fboxSaid = @('SIGNED REFUSED Thornswood.exe is not Authenticode Valid (status NotSigned).')
    Yes 'a box that refuses: refused, with its reason' ((Get-SignedFileRefusal $exeFile 'Thornswood' $repo $fbox) -match 'NotSigned')
    $script:fboxSaid = @('nothing useful')
    Yes 'a box that does not say: refused' ((Get-SignedFileRefusal $exeFile 'Thornswood' $repo $fbox) -match 'did not say')
    # The text runs as the box's runner hands it over, with no script root.
    $runText = Join-Path $runDir 'checkfile.ps1'
    [IO.File]::WriteAllText($runText, (New-SignedFileCheckScript $exeFile 'Thornswood' $repo), (New-Object Text.UTF8Encoding($false)))
    $runner = '$b = [scriptblock]::Create([IO.File]::ReadAllText(''' + $runText.Replace("'", "''") + ''', [Text.Encoding]::UTF8)); . $b'
    $hadTemp = $env:TEMP
    $env:TEMP = $runDir
    try { $ran = @(& $exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))) 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $env:TEMP = $hadTemp }
    $ranSaid = @($ran | Where-Object { $_ -match '^SIGNED ' })
    Yes ("the box's text for a file, run with no script root, says one SIGNED line ('{0}')" -f ($ranSaid -join ' | ')) ($ranSaid.Count -eq 1 -and ($ranSaid -join '') -match '^SIGNED REFUSED Thornswood\.exe ')

    # ---- 6. where it sits -------------------------------------------------------------
    Write-Host ''; Write-Host 'where it sits'
    $ship = [IO.File]::ReadAllText((Join-Path $rel 'Ship.ps1')).Replace("`r`n", "`n")
    Yes 'Ship -FromFeed asks gh, not a signing machine, at the sign gate' ($ship.Contains('$signWhy = if ($FromFeed) { Get-SignOnGitHubRefusal $RepoDir } else { Get-SigningConfigRefusal'))
    Yes '  and loads Sign-OnGitHub.ps1 only then' ($ship.Contains("if (`$FromFeed) { . (Join-Path `$Here 'Sign-OnGitHub.ps1') }"))
    Yes 'Ship -FromFeed builds, fetches and signs no launcher: a Ship sends none (#4825)' (
        -not $ship.Contains('Invoke-ReleaseLauncherOnGitHub') -and -not $ship.Contains('Get-ReleaseLauncher') -and -not $ship.Contains('Get-SignedFileRefusal') -and
        -not $ship.Contains('$MainSourceAligned') -and -not $ship.Contains('a new launcher is compiled and signed on One'))
    Yes '  and carries SkyUI''s check only through Get-ShipSkyUIFeedChange' ($ship.Contains('$skyuiMoved = @(Get-ShipSkyUIFeedChange $GameDir $feedRecord @(Get-ShipDeleteAlways))'))
    $pu = [IO.File]::ReadAllText((Join-Path $rel 'Publish-Update.ps1')).Replace("`r`n", "`n")
    Yes 'Publish-Update -FromFeed writes release.json without a catalog' ($pu.Contains('-NoCatalog:$FromFeed'))
    Yes '  signs it on GitHub' ($pu.Contains('Invoke-ReleaseCatalogSignOnGitHub -Json $sm.Json -Catalog $sm.Catalog -RepoDir $RepoDir'))
    Yes '  telling the fork where the site serves the launcher it names (#3312)' ($pu.Contains("-LauncherUrl (Val `$doc 'launcherUrl')"))
    Yes '  and still holds the listing to the feed' ($pu.Contains('Get-ReleaseManifestRefusal $sm $doc -CatalogChecked'))
    Yes '  and any other release still signs here' ($pu.Contains('$smWhy = Invoke-ReleaseCatalogSign $sm.Catalog $RepoDir'))
}
finally {
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
