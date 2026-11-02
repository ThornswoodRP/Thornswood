<#
  test-set-collection.ps1

      pwsh -NoProfile -File .\tests\test-set-collection.ps1

  scripts\ops\Set-Collection.ps1, which writes the collection address into
  this machine's config.json and the feed's version.json, then sends the feed.
  The real script runs as a child from a scratch copy of the repo whose
  scripts\release\Feed-Store.ps1 is a stub: it logs what would be received or
  sent and touches nothing else, so nothing leaves the machine. The scratch
  root has [ ], & and spaces in its name.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-setcoll-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\[Root] A & B')
$Fake = Join-Path $T 'repo'
$Root = Join-Path $T 'Thornswood [main]'
$Rel = Join-Path $T 'feed [main]'
$Store = Join-Path $T 'store'
$Log = Join-Path $T 'feed-store.log'
$Url = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf'

function W([string]$p, [string]$t, [bool]$bom = $false) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($bom)))
}
function J([string]$p) {
    $b = [IO.File]::ReadAllBytes($p); $s = if ($b.Length -ge 3 -and $b[0] -eq 0xEF) { 3 } else { 0 }
    return ([Text.Encoding]::UTF8.GetString($b, $s, $b.Length - $s) | ConvertFrom-Json)
}
function Bom([string]$p) { $b = [IO.File]::ReadAllBytes($p); return ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB) }
function Reset {
    W (Join-Path $Root 'config.json') '{"Server":"thornswood.net","Port":7777,"Nested":{"a":[1,2]}}' $true
    W (Join-Path $Rel 'version.json') '{"launcherVersion":"1.2.1","packs":[{"id":"p1"}],"news":[]}'
    W (Join-Path $Store 'version.json') '{"launcherVersion":"1.2.1","packs":[],"news":[],"collectionUrl":"https://old"}'
    if (Test-Path -LiteralPath $Log) { Remove-Item -LiteralPath $Log -Force }
    Remove-Item -LiteralPath (Join-Path $T 'receive-fails') -Force -ErrorAction SilentlyContinue
}
function Run([string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Fake 'scripts\ops\Set-Collection.ps1') @a -Root $Root -NoPause 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Logged { if (Test-Path -LiteralPath $Log) { return @([IO.File]::ReadAllLines($Log)) } return @() }

try {
    [void][IO.Directory]::CreateDirectory((Join-Path $Fake 'scripts\ops'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\ops\Set-Collection.ps1'), (Join-Path $Fake 'scripts\ops\Set-Collection.ps1'))
    # The stub sends nothing, but writes the feed the real way: the real
    # Feed-Json.ps1, which Feed-Store.ps1 dot-sources (#1050).
    $stub = @"
. '$((Join-Path $Repo 'scripts\release\Feed-Json.ps1').Replace("'", "''"))'
`$script:StubLog = '$($Log.Replace("'", "''"))'
`$script:StubStore = '$($Store.Replace("'", "''"))'
`$script:StubFail = '$((Join-Path $T 'receive-fails').Replace("'", "''"))'
function Get-FeedStoreDir([string]`$Channel) { return `$script:StubStore }
function Receive-FeedStore([string]`$Channel, [string]`$Dir) {
    Add-Content -LiteralPath `$script:StubLog -Value ("receive|`$Channel|`$Dir")
    if (Test-Path -LiteralPath `$script:StubFail) { throw 'stub: the VPS did not answer' }
    return @{}
}
function Send-FeedStore([string]`$Channel, [string]`$Dir, [string[]]`$Files) {
    Add-Content -LiteralPath `$script:StubLog -Value ("send|`$Channel|`$Dir|" + (`$Files -join ','))
}
"@
    W (Join-Path $Fake 'scripts\release\Feed-Store.ps1') $stub
    Yes 'the scratch root has [ ], & and spaces' ($T -match '\[Root\] A & B')

    # 1. A folder, not pushed: both files get the address, nothing is sent.
    Reset
    $r = Run @('-Url', $Url, '-ReleaseDir', $Rel, '-NoPush')
    $cfg = J (Join-Path $Root 'config.json'); $v = J (Join-Path $Rel 'version.json')
    Yes ("-ReleaseDir -NoPush exits 0 ({0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  config.json gains CollectionUrl' ($cfg.CollectionUrl -eq $Url)
    Yes '  and keeps everything else, nested values included' ($cfg.Server -eq 'thornswood.net' -and $cfg.Port -eq 7777 -and (@($cfg.Nested.a) -join ',') -eq '1,2')
    Yes '  written with no byte order mark, though it was read with one' (-not (Bom (Join-Path $Root 'config.json')))
    Yes '  version.json gains collectionUrl and keeps its packs' ($v.collectionUrl -eq $Url -and @($v.packs)[0].id -eq 'p1' -and $v.launcherVersion -eq '1.2.1')
    Yes '  with no byte order mark' (-not (Bom (Join-Path $Rel 'version.json')))
    Yes '  nothing received or sent' ((Logged).Count -eq 0)
    Yes '  and it says it was not pushed' ($r.Out -match 'Not pushed')

    # 2. Run again with another address: replaced, not added twice.
    $r = Run @('-Url', ($Url + '/'), '-ReleaseDir', $Rel, '-NoPush')
    $raw = [IO.File]::ReadAllText((Join-Path $Root 'config.json'))
    Yes 'a second address replaces the first in both files' ((J (Join-Path $Root 'config.json')).CollectionUrl -eq ($Url + '/') -and (J (Join-Path $Rel 'version.json')).collectionUrl -eq ($Url + '/'))
    Yes '  with one CollectionUrl in config.json' (([regex]::Matches($raw, '"CollectionUrl"')).Count -eq 1)

    # 3. The live feed: received into the store, edited, sent back.
    Reset
    $r = Run @('-Url', ('"' + $Url + '"'))
    $sent = Logged
    Yes ("the live feed path exits 0 ({0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  receives main into the store folder first' ($sent.Count -ge 1 -and $sent[0] -eq "receive|main|$Store")
    Yes '  then sends only version.json for main' ($sent.Count -eq 2 -and $sent[1] -eq "send|main|$Store|version.json")
    Yes '  with the quotes around a pasted address taken off, and the old address replaced' ((J (Join-Path $Store 'version.json')).collectionUrl -eq $Url)
    Yes '  and the folder given to -ReleaseDir untouched' ($null -eq (J (Join-Path $Rel 'version.json')).PSObject.Properties['collectionUrl'])

    # 4. Receiving fails: only this machine changed, and it says so.
    Reset
    W (Join-Path $T 'receive-fails') 'x'
    $r = Run @('-Url', $Url)
    Yes 'a failed receive stops it (exit 1)' ($r.Code -eq 1 -and $r.Out -match 'only this machine was changed')
    Yes '  the store''s version.json is untouched and nothing is sent' ((J (Join-Path $Store 'version.json')).collectionUrl -eq 'https://old' -and @(Logged | Where-Object { $_ -like 'send|*' }).Count -eq 0)

    # 5. -Clear empties both.
    Reset
    $r = Run @('-Clear', '-ReleaseDir', $Rel, '-NoPush')
    Yes '-Clear writes an empty address into both' ($r.Code -eq 0 -and (J (Join-Path $Root 'config.json')).CollectionUrl -eq '' -and (J (Join-Path $Rel 'version.json')).collectionUrl -eq '')
    Yes '  and warns about the installer' ($r.Out -match '-NoVortex')

    # 6. Refusals write nothing.
    foreach ($c in @(@{ L = 'a blank address'; U = '   '; W = 'Nothing given' }, @{ L = 'a non web address'; U = 'ftp://x/y'; W = 'not a web address' })) {
        Reset
        $before = [IO.File]::ReadAllText((Join-Path $Root 'config.json'))
        $r = Run @('-Url', $c.U, '-ReleaseDir', $Rel, '-NoPush')
        Yes ("{0} is refused and nothing is written" -f $c.L) ($r.Code -eq 1 -and $r.Out -match $c.W -and [IO.File]::ReadAllText((Join-Path $Root 'config.json')) -eq $before -and $null -eq (J (Join-Path $Rel 'version.json')).PSObject.Properties['collectionUrl'])
    }
    Reset
    $r = Run @('-Url', 'https://example.com/c', '-ReleaseDir', $Rel, '-NoPush')
    Yes 'an address off nexusmods.com is warned about but set' ($r.Code -eq 0 -and $r.Out -match 'not a nexusmods\.com address' -and (J (Join-Path $Root 'config.json')).CollectionUrl -eq 'https://example.com/c')

    # 7. No config.json: stop before the feed.
    Reset
    Remove-Item -LiteralPath (Join-Path $Root 'config.json') -Force
    $r = Run @('-Url', $Url, '-ReleaseDir', $Rel, '-NoPush')
    Yes 'no config.json stops it before the feed is touched' ($r.Code -eq 1 -and $r.Out -match 'not found: .*config\.json' -and $null -eq (J (Join-Path $Rel 'version.json')).PSObject.Properties['collectionUrl'])
}
finally {
    Remove-Item -LiteralPath (Split-Path -Parent $T) -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }