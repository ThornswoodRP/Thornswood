# Exercise the part of Go between kept-copy bookkeeping and server checks.
# Never run Go itself, which writes game files and may start the game.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$record = Get-Content -LiteralPath (Join-Path $repo 'records/collection.json') -Raw | ConvertFrom-Json
$entry = @($record.plugins | Where-Object name -eq 'MCMHelper.esp')
$order = (Get-Content -LiteralPath (Join-Path $repo 'records/load-order.json') -Raw | ConvertFrom-Json).loadOrder
$sky = [array]::IndexOf($order, 'SkyUI_SE.esp')
$mcm = [array]::IndexOf($order, 'MCMHelper.esp')
if ($entry.Count -ne 1 -or $entry[0].masters -notcontains 'SkyUI_SE.esp' -or $sky -lt 0 -or $mcm -le $sky) {
    throw 'The collection must own MCMHelper.esp and record its SkyUI master'
}
Write-Host 'PASS the collection owns MCMHelper.esp and records its SkyUI master'

$source = [IO.File]::ReadAllText((Join-Path $repo 'scripts/release/Go.ps1'))
$start = $source.IndexOf('else { Note "$kept file(s)')
$end = $source.IndexOf('if (-not $SkipServer) {', $start)
if ($start -lt 0 -or $end -le $start) { throw 'Cannot locate the Go profile step' }
$section = [scriptblock]::Create('if ($kept -lt 0) {} ' + $source.Substring($start, $end - $start))
function Head($text) { }
function Note($text) { }

$root = Join-Path ([IO.Path]::GetTempPath()) ('ts-4762-' + [guid]::NewGuid().ToString('N'))
$Game = Join-Path $root 'Game'
$kept = 0
$failed = 0
try {
    # An already deployed list and a stale list with the plugin switched off.
    # Both must remain byte-for-byte unchanged, including BOM and line endings.
    $lists = [ordered]@{
        'Profile/LocalAppData/Plugins.txt' = "# deployed`r`n*SkyUI_SE.esp`r`n*MCMHelper.esp`r`n*Follower.esp`r`n"
        'Profile/Default/plugins.txt' = "# stale copy`n*SkyUI_SE.esp`nMCMHelper.esp`n*Follower.esp`n"
    }
    $hash = @{}
    foreach ($rel in $lists.Keys) {
        $path = Join-Path $root $rel
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
        [IO.File]::WriteAllText($path, $lists[$rel], [Text.UTF8Encoding]::new($true))
        $hash[$rel] = (Get-FileHash -LiteralPath $path).Hash
    }
    & $section
    foreach ($rel in $lists.Keys) {
        $path = Join-Path $root $rel
        if ((Get-FileHash -LiteralPath $path).Hash -eq $hash[$rel]) { Write-Host "PASS Go preserves $rel" }
        else { Write-Host "FAIL Go rewrites $rel"; $failed++ }
    }
} finally {
    if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
if ($failed) { exit 1 }
