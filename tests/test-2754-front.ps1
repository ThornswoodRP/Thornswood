# test-2754-front.ps1
#
#     pwsh -NoProfile -File .\tests\test-2754-front.ps1
#
# The front is built from the pinned fork and recorded (#2754, step 1 of
# Patrick's A, Ships from the feed): Front.ps1 writes the same zip for the
# same build on any machine, says every way a zip is not the recorded build,
# and Go.ps1 unpacks only the recorded build. Offline: the build itself
# (Build-Front.ps1, yarn and the npm registry) is not run here.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Front.ps1')

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text)
}
function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2754 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $dist = Join-Path $tmp 'dist'
    Put (Join-Path $dist 'build.js') 'console.log(1);'
    Put (Join-Path $dist 'index.html') '<html></html>'
    Put (Join-Path $dist 'a1b2.svg') '<svg/>'
    Put (Join-Path $dist 'fonts\B.ttf') 'font'

    # ---- one zip for one build, wherever it is made
    $z1 = Join-Path $tmp 'one.zip'
    $z2 = Join-Path $tmp 'two.zip'
    Write-ThornswoodFrontZip $dist $z1
    Start-Sleep -Milliseconds 1100
    (Get-Item -LiteralPath (Join-Path $dist 'build.js')).LastWriteTime = Get-Date
    Write-ThornswoodFrontZip $dist $z2
    Yes 'the same build makes the same zip, whatever the files'' times' ((Sha $z1) -eq (Sha $z2))

    $files = Get-ThornswoodFolderFiles $dist
    $inZip = Get-ThornswoodZipFiles $z1
    Yes 'the zip holds every file of the build, by the same names with /' ((@($files.Keys) -join '|') -eq (@($inZip.Keys) -join '|') -and $inZip.Contains('fonts/B.ttf'))
    Yes 'and the same bytes' (-not @($files.Keys | Where-Object { $files[$_].sha256 -ne $inZip[$_].sha256 }).Count)

    # ---- the record, and every way a zip is not it
    $record = [pscustomobject]@{ forkCommit = ('a' * 40); files = [pscustomobject]$files }
    Yes 'the recorded build has no problems' (@(Get-ThornswoodFrontProblems $inZip $record).Count -eq 0)
    $other = Join-Path $tmp 'other'
    Copy-Item -LiteralPath $dist -Destination $other -Recurse
    Put (Join-Path $other 'build.js') 'console.log(2);'
    Put (Join-Path $other 'DINPro.ttf') 'not ours to hand out'
    Remove-Item -LiteralPath (Join-Path $other 'a1b2.svg')
    $bad = @(Get-ThornswoodFrontProblems (Get-ThornswoodFolderFiles $other) $record)
    Yes 'other bytes are named' (@($bad | Where-Object { $_ -eq 'build.js is not the recorded bytes' }).Count -eq 1)
    Yes 'a file the build does not make is named (a stale zip''s font, #1317)' (@($bad | Where-Object { $_ -eq 'DINPro.ttf is not in the recorded build' }).Count -eq 1)
    Yes 'a file the build makes that is missing is named' (@($bad | Where-Object { $_ -eq 'a1b2.svg, which the build makes, is missing' }).Count -eq 1)

    # ---- the committed record
    $rec = Read-ThornswoodFrontRecord
    $pin = ((& git -C $repo ls-tree HEAD engine/skymp) -split '\s+')[2]
    Yes 'records\front-build.json is the build of the pinned commit' ($rec.forkCommit -eq $pin)
    Yes 'and lists build.js and index.html' ($null -ne $rec.files.'build.js' -and $null -ne $rec.files.'index.html')
    Yes 'and no DIN Pro or Futura face (#1317)' (-not @($rec.files.PSObject.Properties.Name | Where-Object { $_ -match '(?i)din|futura' }).Count)

    # ---- a fork folder is a clone of its own, not an unfetched submodule (#3315)
    $outer = Join-Path $tmp 'outer'
    $inner = Join-Path (Join-Path $outer 'engine') 'skymp'
    New-Item -ItemType Directory -Force -Path $inner | Out-Null
    & git init -q $outer
    Yes 'an empty folder inside another checkout is not a fork clone' (-not (Test-ThornswoodForkClone $inner))
    Yes 'a folder that is not there is not one' (-not (Test-ThornswoodForkClone (Join-Path $tmp 'nothing')))
    & git init -q $inner
    Yes 'a clone of its own is one' (Test-ThornswoodForkClone $inner)
    Yes 'the same folder named with the other slash is the same path' ((Get-ThornswoodFullPath ($inner -replace '\\', '/')) -eq (Get-ThornswoodFullPath ($inner -replace '/', '\')))
    $bf = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Build-Front.ps1'))
    Yes 'Build-Front fetches the pin into an unfetched engine\skymp before reading the commit' ($bf.IndexOf('submodule update --init --depth 1 engine/skymp') -ge 0 -and $bf.IndexOf('submodule update --init --depth 1 engine/skymp') -lt $bf.IndexOf('rev-parse --verify --quiet ($Commit'))

    # ---- Go.ps1 unpacks only the recorded build
    $go = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Go.ps1'))
    $front = $go.Substring($go.IndexOf("Head 'Front'"), $go.IndexOf('# The wheel is an overlay script now') - $go.IndexOf("Head 'Front'"))
    Yes 'Go.ps1 checks the zip against the record before it unpacks anything' ($front.IndexOf('Get-ThornswoodFrontProblems') -ge 0 -and $front.IndexOf('Get-ThornswoodFrontProblems') -lt $front.IndexOf('Expand-Archive'))
    Yes 'and a zip that is missing or not the record fails the run' ($front -match "Gone 'the front is not the recorded build")
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "$pass passed, $fail failed"
exit $(if ($fail) { 1 } else { 0 })
