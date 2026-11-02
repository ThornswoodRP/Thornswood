<#
  test-bad-json-records.ps1

      pwsh -NoProfile -File .\tests\test-bad-json-records.ps1

  A record that is empty, cut off or not JSON at all, fed straight to
  ConvertFrom-Json, came out as a bare parse error ("Invalid JSON primitive",
  "Conversion from JSON failed", or 5.1's "Cannot bind argument to parameter
  'InputObject' because it is null") or a null property later, and none of
  them named the file. Each now names it:
    Sync-Client.ps1        the client build record (-Record)
    Set-Collection.ps1     config.json and the feed's version.json
    Set-Server.ps1         config.json and the feed's version.json
    Where.ps1              layout.json (scratch copy of the script)
    Ship-Rules.ps1         records\ui-gone.json (scratch copy)
  Scratch files only. -ReleaseDir with -NoPush, so no feed is received or sent;
  Set-Collection runs from a scratch copy whose Feed-Store is a stub.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-badjson-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($T)
function W([string]$p, [string]$t) { [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p)); [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($false))) }
# Each script runs through this launcher so its error comes back as written:
# pwsh's default error view wraps a message at the console's width, breaking
# the path in it when the temp folder's path is long (#2933). The exit code is
# the one -File would give.
$childRun = Join-Path $T 'run-child.ps1'
W $childRun "`$global:ErrorView = 'NormalView'`r`n`$script, `$rest = `$args`r`n& `$script @rest`r`nif (-not `$?) { exit `$LASTEXITCODE }`r`nexit 0`r`n"
function Child([string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $o = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $childRun @a 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = ($o -replace '\s+', ' ') }
}
$bad = [ordered]@{ 'empty' = ''; 'cut off' = '{"files": {"a": {"sha256": "ab'; 'not JSON' = 'this is not json' }
$expect = @{ 'empty' = 'is empty'; 'cut off' = 'is not valid JSON'; 'not JSON' = 'is not valid JSON' }
function Named($r, [string]$path, [string]$kind) { $r.Code -ne 0 -and $r.Out.Contains(($path -replace '\s+', ' ') + ' ' + $expect[$kind]) }
try {
    # ---- Sync-Client -Record --------------------------------------------------------
    $game = Join-Path $T 'Game'; $dist = Join-Path $T 'dist'
    [void][IO.Directory]::CreateDirectory($game); [void][IO.Directory]::CreateDirectory($dist)
    foreach ($k in $bad.Keys) {
        $rec = Join-Path $T 'client-build.json'; W $rec $bad[$k]
        $r = Child @((Join-Path $Repo 'scripts\release\Sync-Client.ps1'), '-Record', $rec, '-Game', $game, '-Dist', $dist, '-Check', '-NoPause')
        Yes ("Sync-Client: a client record that is {0} is named ({1})" -f $k, $expect[$k]) (Named $r $rec $k)
    }

    # ---- Set-Server: config.json, then version.json ------------------------------------
    $root = Join-Path $T 'ss-root'; $rel = Join-Path $T 'ss-feed'
    foreach ($k in $bad.Keys) {
        W (Join-Path $root 'config.json') $bad[$k]; W (Join-Path $rel 'version.json') '{"serverAddress":"a","serverPort":"1"}'
        $r = Child @((Join-Path $Repo 'scripts\ops\Set-Server.ps1'), '-Address', '192.0.2.5', '-Root', $root, '-ReleaseDir', $rel, '-Force', '-NoPush', '-NoPause')
        Yes ("Set-Server: a config.json that is {0} is named, and the feed is untouched" -f $k) ((Named $r (Join-Path $root 'config.json') $k) -and [IO.File]::ReadAllText((Join-Path $rel 'version.json')) -match '"serverAddress":"a"')
    }
    foreach ($k in $bad.Keys) {
        W (Join-Path $root 'config.json') '{"ServerAddress":"x","ServerPort":1}'; W (Join-Path $rel 'version.json') $bad[$k]
        $r = Child @((Join-Path $Repo 'scripts\ops\Set-Server.ps1'), '-Address', '192.0.2.5', '-Root', $root, '-ReleaseDir', $rel, '-Force', '-NoPush', '-NoPause')
        Yes ("Set-Server: a version.json that is {0} is named" -f $k) (Named $r (Join-Path $rel 'version.json') $k)
    }

    # ---- Set-Collection, from a scratch copy with a stub Feed-Store --------------------
    $sc = Join-Path $T 'sc'
    [void][IO.Directory]::CreateDirectory((Join-Path $sc 'scripts\ops'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\ops\Set-Collection.ps1'), (Join-Path $sc 'scripts\ops\Set-Collection.ps1'))
    # The real Feed-Json.ps1, which Feed-Store.ps1 dot-sources, so the feed is written the real way (#1050).
    W (Join-Path $sc 'scripts\release\Feed-Store.ps1') (". '" + (Join-Path $Repo 'scripts\release\Feed-Json.ps1').Replace("'", "''") + "'`nfunction Get-FeedStoreDir { 'unused' }`nfunction Receive-FeedStore { throw 'stub: no receive' }`nfunction Send-FeedStore { throw 'stub: no send' }`n")
    $croot = Join-Path $T 'sc-root'; $cfeed = Join-Path $T 'sc-feed'
    $url = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/abc'
    foreach ($k in $bad.Keys) {
        W (Join-Path $croot 'config.json') $bad[$k]; W (Join-Path $cfeed 'version.json') '{}'
        $r = Child @((Join-Path $sc 'scripts\ops\Set-Collection.ps1'), '-Url', $url, '-Root', $croot, '-ReleaseDir', $cfeed, '-NoPush', '-NoPause')
        Yes ("Set-Collection: a config.json that is {0} is named" -f $k) (Named $r (Join-Path $croot 'config.json') $k)
        W (Join-Path $croot 'config.json') '{}'; W (Join-Path $cfeed 'version.json') $bad[$k]
        $r = Child @((Join-Path $sc 'scripts\ops\Set-Collection.ps1'), '-Url', $url, '-Root', $croot, '-ReleaseDir', $cfeed, '-NoPush', '-NoPause')
        Yes ("Set-Collection: a version.json that is {0} is named" -f $k) (Named $r (Join-Path $cfeed 'version.json') $k)
    }

    # ---- Where.ps1 and layout.json ----------------------------------------------------
    $wh = Join-Path $T 'wh'
    [void][IO.Directory]::CreateDirectory((Join-Path $wh 'scripts\release'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\release\Where.ps1'), (Join-Path $wh 'scripts\release\Where.ps1'))
    # Where.ps1 throws, and a throw that ends a script is printed in
    # PowerShell's error view, wrapped at the console's width with a margin
    # put in at each break. On the nightly runner the scratch path is long
    # enough that the break fell inside 'is not valid JSON' (#1273), so the
    # sentence is read from the exception itself, the way the Ship-Rules
    # case below reads its throw. It asks for Out, a place layout.json
    # holds: Repo and this machine's own places never read it (#2903).
    $whCall = Join-Path $wh 'call.ps1'
    W $whCall ("`$ErrorActionPreference = 'Stop'`ntry { `$null = & '" + (Join-Path $wh 'scripts\release\Where.ps1').Replace("'", "''") + "' Out; 'ANSWERED' } catch { 'THREW ' + `$_.Exception.Message; exit 1 }`n")
    foreach ($k in $bad.Keys) {
        W (Join-Path $wh 'layout.json') $bad[$k]
        $r = Child @($whCall)
        Yes ("Where.ps1: a layout.json that is {0} is named" -f $k) ($r.Code -ne 0 -and $r.Out.Contains('THREW layout.json at ' + ((Join-Path $wh 'layout.json') -replace '\s+', ' ') + ' ' + $expect[$k]))
    }

    # ---- Ship-Rules and records\ui-gone.json ------------------------------------------
    $sr = Join-Path $T 'sr'
    [void][IO.Directory]::CreateDirectory((Join-Path $sr 'scripts\release'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\release\Ship-Rules.ps1'), (Join-Path $sr 'scripts\release\Ship-Rules.ps1'))
# Ship-Rules holds ui-gone.json to RecordShape.ps1 (#2180), which loads Read-JsonFile.ps1.
foreach ($n in 'RecordShape.ps1', 'Read-JsonFile.ps1', 'RepoPlugins.ps1', 'CollectionRevision.ps1') { [IO.File]::Copy((Join-Path $Repo ('scripts\release\' + $n)), (Join-Path $sr ('scripts\release\' + $n)), $true) }
    $load = Join-Path $sr 'load.ps1'
    W $load ("`$ErrorActionPreference = 'Stop'`ntry { . '" + (Join-Path $sr 'scripts\release\Ship-Rules.ps1').Replace("'", "''") + "'; 'LOADED' } catch { 'THREW ' + `$_.Exception.Message; exit 1 }`n")
    foreach ($k in $bad.Keys) {
        W (Join-Path $sr 'records\ui-gone.json') $bad[$k]
        $r = Child @($load)
        Yes ("Ship-Rules: a ui-gone.json that is {0} is named" -f $k) ($r.Out -match ('THREW records\\ui-gone\.json ' + $expect[$k]))
    }
    [IO.File]::Copy((Join-Path $Repo 'records\ui-gone.json'), (Join-Path $sr 'records\ui-gone.json'), $true)
    $r = Child @($load)
    Yes '  and the real one still loads' ($r.Out -match 'LOADED')

    # ---- the shared helper, scripts\release\Read-JsonFile.ps1 -----------------------
    . (Join-Path $Repo 'scripts\release\Read-JsonFile.ps1')
    $src = 'C:\somewhere\x.json'
    function Says([scriptblock]$b) { try { & $b; return '' } catch { return $_.Exception.Message } }
    Yes 'ConvertFrom-ThornswoodJson: an object comes back' ((ConvertFrom-ThornswoodJson '{"a":1}' $src).a -eq 1)
    $arr = ConvertFrom-ThornswoodJson '[{"a":1}]' $src
    $raw1 = '[{"a":1}]' | ConvertFrom-Json
    Yes '  a one-item array comes back as ConvertFrom-Json gives it on this PowerShell' (($arr -is [array]) -eq ($raw1 -is [array]) -and @($arr)[0].a -eq 1)
    Yes '  a byte order mark is dropped' ((ConvertFrom-ThornswoodJson ([string][char]0xFEFF + '{"a":2}') $src).a -eq 2)
    Yes '  $null is "<path> is empty"' ((Says { ConvertFrom-ThornswoodJson $null $src }) -eq "$src is empty")
    Yes '  white space is "<path> is empty"' ((Says { ConvertFrom-ThornswoodJson " `r`n " $src }) -eq "$src is empty")
    Yes '  cut off is "<path> is not valid JSON: ..."' ((Says { ConvertFrom-ThornswoodJson '{"a":' $src }) -like "$src is not valid JSON: *")
    Yes '  and a throw inside try still falls back' ($(try { $null = ConvertFrom-ThornswoodJson 'nope' $src; 'went on' } catch { 'fell back' }) -eq 'fell back')

    # ---- per script, through the helper ---------------------------------------------
    $f = Join-Path $T 'bad.json'
    . (Join-Path $Repo 'scripts\release\Release-Baseline.ps1')
    W $f '{"a":'
    Yes 'Release-Baseline Read-BaselineFile: a cut-off baseline is named' ((Says { Read-BaselineFile $f }) -like "$f is not valid JSON: *")
    W $f ''
    Yes '  and an empty one is still an empty baseline, as before' ((Read-BaselineFile $f).Count -eq 0)

    . (Join-Path $Repo 'scripts\release\Feed-Store.ps1')
    $site = Join-Path $T 'site'
    # The feed is its newest generation, feed\version\<8 digits>.json, since
    # #2727: the site's version.json is never written any more.
    $gen = Join-Path $site 'feed\version\00000001.json'
    foreach ($k in $bad.Keys) {
        W $gen $bad[$k]
        $m = Says { Read-SiteFeed 'main' $site }
        Yes ("Feed-Store Read-SiteFeed: a site feed that is {0} is named" -f $k) ($m.StartsWith($gen + ' ' + $expect[$k]))
    }

    . (Join-Path $Repo 'scripts\mods\LoadOrder.ps1')
    $lr = Join-Path $T 'lo-root'
    W (Join-Path $lr 'config.json') '{"ServerAddress": "x", '
    Yes 'LoadOrder Get-LoadOrderManifestUrl: a cut-off config.json is named' ((Says { Get-LoadOrderManifestUrl $lr }) -like ((Join-Path $lr 'config.json') + ' is not valid JSON: *'))

    $al = Join-Path $T 'al'; W (Join-Path $al 'plugins.txt') ''; [void][IO.Directory]::CreateDirectory((Join-Path $al 'Data'))
    W (Join-Path $al 'server-settings.json') ''
    $r = Child @((Join-Path $Repo 'scripts\mods\Align-LoadOrder.ps1'), '-Data', (Join-Path $al 'Data'), '-Plugins', (Join-Path $al 'plugins.txt'), '-Settings', (Join-Path $al 'server-settings.json'))
    Yes 'Align-LoadOrder: an empty server-settings.json is named' (Named $r (Join-Path $al 'server-settings.json') 'empty')

    $sm = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\release\Setup-ShipMachine.ps1'), [ref]$null, [ref]$null)
    $gcm = $sm.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ClientMatch' }, $true)
    . ([scriptblock]::Create($gcm.Extent.Text))
    W $f 'not json at all'
    Yes 'Setup-ShipMachine Get-ClientMatch: a client record that is not JSON is named' ((Says { Get-ClientMatch $f $T }) -like "$f is not valid JSON: *")

    $sf = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\release\Scrub-Feed.ps1'), [ref]$null, [ref]$null)
    $rl = $sf.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Read-Ledger' }, $true)
    . ([scriptblock]::Create($rl.Extent.Text))
    $LedgerFile = $f; W $f '{"ab":'
    Yes 'Scrub-Feed Read-Ledger: a cut-off ledger is named' ((Says { Read-Ledger }) -like "$f is not valid JSON: *")
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }