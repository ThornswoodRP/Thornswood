# test-deploy-json-records.ps1
#
#     pwsh -NoProfile -File .\tests\test-deploy-json-records.ps1
#
# The deploy scripts read their JSON records and configs on this machine
# through ConvertFrom-ThornswoodJson (scripts\release\Read-JsonFile.ps1), so
# an empty, cut-off or broken record stops the deploy naming the file, not as
# "Invalid JSON primitive" or a null further on.
#
# Read from the scripts' own syntax trees: text sent to the box (here-strings
# and the strings built for remote commands) is a string to the parser, so
# only the reads that run here are counted. Then each of those statements is
# taken out of the script as written and run against bad files in a scratch
# folder. Offline: nothing connects to anything. Deploy-Server and Deploy-DevGamemode
# since #2154; Deploy-Gamemode, ServerOrder and MaxOnline since its follow-up.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Read-JsonFile.ps1')

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Tree([string]$rel) {
    $tok = $null; $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $rel), [ref]$tok, [ref]$err)
    return $ast
}
function Commands($ast, [string]$name) {
    return @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name }, $true))
}

foreach ($rel in 'scripts\deploy\Deploy-Server.ps1', 'scripts\deploy\Deploy-DevGamemode.ps1', 'scripts\deploy\ServerBuild.ps1',
                 'scripts\deploy\Swap.ps1', 'scripts\vps\Send-Script.ps1', 'scripts\vps\Send-Secret.ps1') {
    $ast = Tree $rel
    $leaf = Split-Path -Leaf $rel
    Yes "$leaf runs no bare ConvertFrom-Json on this machine" ((Commands $ast 'ConvertFrom-Json').Count -eq 0)
}
foreach ($rel in 'scripts\deploy\Deploy-Server.ps1', 'scripts\deploy\Deploy-DevGamemode.ps1') {
    $ast = Tree $rel
    $leaf = Split-Path -Leaf $rel
    $text = [IO.File]::ReadAllText((Join-Path $repo $rel))
    $dot = $text.IndexOf(". (Join-Path `$Here '..\release\Read-JsonFile.ps1')")
    $first = (Commands $ast 'ConvertFrom-ThornswoodJson' | ForEach-Object { $_.Extent.StartOffset } | Measure-Object -Minimum).Minimum
    Yes "$leaf loads Read-JsonFile.ps1 before its first read" ($dot -gt 0 -and $first -gt $dot)
}

# Each read, as the script has it, against bad files.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-json [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    $bad = [ordered]@{ empty = ''; 'cut off' = '{ "loadOrder": [ "a.esp"'; 'not JSON' = 'loadOrder = a.esp' }
    # server-build.json in Deploy-Server and Deploy-DevGamemode is read through
    # Read-ThornswoodRecord now (#2180), which reads through this helper and
    # then holds the shape; tests\test-record-shapes.ps1 and
    # test-2180-record-readers.ps1 cover those two reads.
    $reads = @(
        @{ File = 'scripts\deploy\Deploy-Server.ps1';      Var = 'settingsSrc';       Leaf = 'server-settings.json' },
        @{ File = 'scripts\deploy\Deploy-Server.ps1';      Var = 'buildSettingsPath'; Leaf = 'server-settings.json' },
        @{ File = 'scripts\deploy\Deploy-Server.ps1';      Var = 'stampPath';         Leaf = 'thornswood-build.json' },
        @{ File = 'scripts\deploy\Deploy-DevGamemode.ps1'; Var = 'settingsSrc';       Leaf = 'server-settings.json' })
    foreach ($r in $reads) {
        $ast = Tree $r.File
        $calls = @(Commands $ast 'ConvertFrom-ThornswoodJson' | Where-Object { $_.Extent.Text.EndsWith(' $' + $r.Var) -and $_.Extent.Text.Contains('-LiteralPath $' + $r.Var + ' ') })
        $leaf = Split-Path -Leaf $r.File
        Yes "$leaf reads `$$($r.Var) through ConvertFrom-ThornswoodJson, naming it" ($calls.Count -ge 1)
        if (-not $calls.Count) { continue }
        $expr = $calls[0].Extent.Text
        foreach ($k in $bad.Keys) {
            $p = Join-Path $tmp $r.Leaf
            [IO.File]::WriteAllText($p, $bad[$k])
            $why = ''
            try { Set-Variable -Name $r.Var -Value $p; $null = & ([scriptblock]::Create($expr)) } catch { $why = $_.Exception.Message }
            Yes "  a record that is $k stops it, naming the file" ($why.StartsWith($p) -and ($why -match 'is empty$|is not valid JSON'))
        }
        [IO.File]::WriteAllText((Join-Path $tmp $r.Leaf), "$([char]0xFEFF){ `"loadOrder`": [ `"a.esp`" ], `"source`": { `"commit`": `"abc`" } }")
        Set-Variable -Name $r.Var -Value (Join-Path $tmp $r.Leaf)
        $ok = & ([scriptblock]::Create($expr))
        Yes '  and a good one, byte order mark and all, still reads' ($ok.source.commit -eq 'abc' -and @($ok.loadOrder)[0] -eq 'a.esp')
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- the deploy helpers and Deploy-Gamemode (#2154 follow-up)
# DeployedBuild.ps1 and ServerSettings.ps1 read JSON only inside text that
# runs on the box (ServerSettings.ps1 goes up beside the installer, which has
# no Read-JsonFile.ps1), so they are held to having no local read at all.
foreach ($rel in 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\deploy\ServerOrder.ps1', 'scripts\deploy\MaxOnline.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                 'scripts\deploy\DeployedBuild.ps1', 'scripts\deploy\ServerSettings.ps1') {
    Yes "$(Split-Path -Leaf $rel) runs no bare ConvertFrom-Json on this machine" ((Commands (Tree $rel) 'ConvertFrom-Json').Count -eq 0)
}
. (Join-Path $repo 'scripts\deploy\ServerOrder.ps1')
. (Join-Path $repo 'scripts\deploy\MaxOnline.ps1')
$gmTry = @((Tree 'scripts\deploy\Deploy-Gamemode.ps1').FindAll({ param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Body.Extent.Text.Contains('$colUrl') -and $n.Body.Extent.Text.Contains('ConvertFrom-ThornswoodJson') }, $true))
Yes 'Deploy-Gamemode reads config.json through ConvertFrom-ThornswoodJson, inside a try whose catch keeps why' ($gmTry.Count -eq 1 -and $gmTry[0].CatchClauses.Count -eq 1 -and $gmTry[0].CatchClauses[0].Body.Extent.Text -match '\$cfgWhy = \$_\.Exception\.Message')
$tmp2 = Join-Path ([IO.Path]::GetTempPath()) ('tw-json2 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp2
try {
    $bad2 = [ordered]@{ empty = ''; 'cut off' = '{ "lightPlugins": true, "people": 4'; 'not JSON' = 'people = 4' }
    $rp = Join-Path $tmp2 'server-build.json'
    $mp = Join-Path $tmp2 'most-online.json'
    $cfgPath = Join-Path $tmp2 'config.json'
    foreach ($k in $bad2.Keys) {
        [IO.File]::WriteAllText($rp, $bad2[$k])
        $why = ''; try { $null = Test-ThornswoodEngineLoadsLight $rp } catch { $why = $_.Exception.Message }
        Yes "ServerOrder: a server build record that is $k stops it, naming the file and what is wrong" ($why.Contains($rp) -and ($why -match 'is empty\)|is not valid JSON') -and $why -match 'not known whether the engine loads light plugins')
        [IO.File]::WriteAllText($mp, $bad2[$k])
        $m = Get-MostOnline $mp
        Yes "MaxOnline: a most-online.json that is $k gives no number, saying why with the file" ($m.Value -eq 0 -and $m.Why -match '^it does not read as JSON \(' -and $m.Why.Contains($mp))
        [IO.File]::WriteAllText($cfgPath, $bad2[$k])
        $colUrl = 'unset'; $cfgWhy = ''
        . ([scriptblock]::Create('$colUrl = ''''' + "`n" + $gmTry[0].Extent.Text))
        Yes "Deploy-Gamemode: a config.json that is $k gives no collection address, and says why with the file (#2711)" ($colUrl -eq '' -and $cfgWhy.Contains($cfgPath) -and ($cfgWhy -match 'is empty|is not valid JSON'))
    }
    $bom = [string][char]0xFEFF
    [IO.File]::WriteAllText($rp, $bom + '{ "lightPlugins": true }')
    Yes 'ServerOrder: a good record, byte order mark and all, still reads' ((Test-ThornswoodEngineLoadsLight $rp) -eq $true)
    [IO.File]::WriteAllText($mp, $bom + '{ "people": 40, "staffSeats": 2 }')
    $m = Get-MostOnline $mp
    Yes 'MaxOnline: a good most-online.json still gives its number' ($m.Value -eq 40 -and $m.Staff -eq 2 -and -not $m.Why)
    [IO.File]::WriteAllText($cfgPath, $bom + '{ "CollectionUrl": "https://example/collections/abc" }')
    $cfgWhy = ''
    . ([scriptblock]::Create($gmTry[0].Extent.Text))
    Yes 'Deploy-Gamemode: a good config.json still gives the collection address' ($colUrl -eq 'https://example/collections/abc' -and -not $cfgWhy)
} finally {
    Remove-Item -LiteralPath $tmp2 -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
