<#
  A stand-in Data\Platform\UI for harnesses that run the real Publish-Update
  (the old installer's builder too, until #4824). Save-ShipUiHashedAssets refuses a game folder whose
  build.js is missing or names nothing (#1318). Font names are derived from
  the real shipped build.js's asset modules (tests/fixtures/ui-front-build.js,
  cut from the whole build in #3761), so they follow that file. They are the
  two the front built from the fork ships, Big Shoulders and Barlow
  SemiBold. The Futura PT and DIN Pro faces (#1317) and Bankir-Retro and
  icomoon (fork #41) are on records\ui-gone.json, so they are never ours, and
  a harness that packed them would be testing a file no release carries.
#>
$script:UiFrontFixtureRoot = $PSScriptRoot
$script:UiFrontFixtureFonts = $null

function Get-UiFrontFixtureBuildJs {
    return Join-Path $script:UiFrontFixtureRoot 'ui-front-build.js'
}

function Get-UiFrontFixtureExpectedNames {
    $path = Join-Path $script:UiFrontFixtureRoot 'ui-front-build.assets.txt'
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($raw in [IO.File]::ReadAllLines($path)) {
        $n = $raw.Trim()
        if ($n.Length -eq 0 -or $n[0] -eq '#') { continue }
        [void]$set.Add($n)
    }
    return $set
}

function Get-UiFrontFixtureFontNames {
    if ($null -ne $script:UiFrontFixtureFonts) { return $script:UiFrontFixtureFonts }
    $js = Get-UiFrontFixtureBuildJs
    $text = [IO.File]::ReadAllText($js)
    $book = $null
    $medium = $null
    $bookRe = '\.p \+ \\"([0-9a-f]{8,32}\.ttf)\\";\\n\\n//# sourceURL=webpack://ui_webpack/\./src/fonts/BigShoulders-Variable\.ttf'
    $mediumRe = '\.p \+ \\"([0-9a-f]{8,32}\.ttf)\\";\\n\\n//# sourceURL=webpack://ui_webpack/\./src/fonts/Barlow-SemiBold\.ttf'
    $m = [regex]::Match($text, $bookRe)
    if ($m.Success) { $book = $m.Groups[1].Value }
    $m = [regex]::Match($text, $mediumRe)
    if ($m.Success) { $medium = $m.Groups[1].Value }
    # Never a name records\ui-gone.json lists: no release ships those.
    $gone = @((Get-Content -LiteralPath (Join-Path $script:UiFrontFixtureRoot '..\..\records\ui-gone.json') -Raw | ConvertFrom-Json).unused)
    if ($book -and $gone -contains $book) { $book = $null }
    if ($medium -and $gone -contains $medium) { $medium = $null }
    if (-not $book -or -not $medium) {
        $fromList = @(Get-UiFrontFixtureExpectedNames | Where-Object { $_ -like '*.ttf' -and $gone -notcontains $_ } | Sort-Object { $_.ToLowerInvariant() })
        if (-not $book -and $fromList.Count) { $book = [string]$fromList[0] }
        if (-not $medium) {
            $medium = [string](@($fromList | Where-Object { $_ -ne $book } | Select-Object -First 1)[0])
        }
    }
    if (-not $book -or -not $medium) {
        throw 'tests/fixtures/ui-front-build.js did not yield two font names for the UI front fixture.'
    }
    $script:UiFrontFixtureFonts = @($book, $medium)
    return $script:UiFrontFixtureFonts
}

function Install-UiFrontFixture([string]$GameDir) {
    $ui = Join-Path $GameDir 'Data\Platform\UI'
    New-Item -ItemType Directory -Force -Path $ui | Out-Null
    $fonts = @(Get-UiFrontFixtureFontNames)
    $a = $fonts[0]
    $b = $fonts[1]
    $js = @"
!function(e){var t={};function n(r){if(t[r])return t[r].exports;var o=t[r]={i:r,l:!1,exports:{}};return e[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}n.p="";n(0)}([
function(e,t,n){e.exports=n.p+"$a";},
function(e,t,n){e.exports=n.p+"$b";}
]);
"@
    [IO.File]::WriteAllText((Join-Path $ui 'build.js'), $js)
    [IO.File]::WriteAllText((Join-Path $ui 'index.html'), '<html></html>')
    [IO.File]::WriteAllText((Join-Path $ui $a), 'font-a')
    [IO.File]::WriteAllText((Join-Path $ui $b), 'font-b')
}
