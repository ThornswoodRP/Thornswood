# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$path = Join-Path $repo 'scripts\deploy\Deploy-Server.ps1'
$source = [IO.File]::ReadAllText($path)
$block = [regex]::Match($source, '(?s)# ==== thornswood staged directories ====\s*(.*?)# ==== end thornswood staged directories ====')
if (-not $block.Success) { throw 'Missing production staging directory block' }
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-StageDirectories' }, $true)
if (-not $fn) { throw 'Missing production staging directory resolver' }
Invoke-Expression $fn.Extent.Text
$rootWin = Join-Path ([IO.Path]::GetTempPath()) ('ts-server-stage-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($rootWin) | Out-Null
$stageName = '.stage-fixture'
$send = [ordered]@{}
$record = [IO.File]::ReadAllText((Join-Path $repo 'records\server-build.json')) | ConvertFrom-Json
foreach ($file in $record.files.PSObject.Properties) { $send[$file.Name] = '' }
$send['gamemode.js'] = ''; $send['plugins/Thornswood-Content.esp'] = ''
# The gamemode's tables (#5191) go up in one scp of their own, into a folder
# the block makes with the rest.
$tableSend = [ordered]@{ 'gamemode-tables/ITEM_NAMES.json' = ''; 'gamemode-tables/RECIPES_BY_ID.json' = '' }
function Remote([string]$script) { Invoke-Expression $script }
Invoke-Expression $block.Groups[1].Value
foreach ($relative in @($send.Keys) + @($tableSend.Keys)) {
    $target = Join-Path "$rootWin\$stageName" ($relative -replace '/', '\')
    [IO.File]::WriteAllText($target, 'staged')
    if (-not [IO.File]::Exists($target)) { throw "Native payload could not stage $relative" }
    Write-Host "PASS staging supports $relative"
}
foreach ($relative in '../outside.txt', 'data/../../outside.txt', 'C:\outside.txt') {
    $refused = $false
    try { $null = Get-StageDirectories "$rootWin\$stageName" @($relative) } catch { $refused = $true }
    if (-not $refused) { throw "Unsafe stage destination accepted: $relative" }
    Write-Host "PASS rejects $relative"
}
# The box's own folders come out the same from any machine, a cloud session's
# included: Windows paths, resolved by Windows' rules (#2989).
$boxStage = 'C:\Thornswood-Server\.stage-box'
$got = @(Get-StageDirectories $boxStage @('gamemode.js', 'data/a.json', 'data\b.json', 'plugins/./x.esp', 'data/sub/../c.json'))
$want = @($boxStage, ($boxStage + '\data'), ($boxStage + '\plugins'))
if (($got -join '|') -ne ($want -join '|')) { throw "The box's stage folders came out as $($got -join ', ')" }
Write-Host "PASS the box's stage folders are its own Windows paths on any machine"
