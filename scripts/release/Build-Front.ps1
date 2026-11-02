<#
.SYNOPSIS
  Builds the front, the in-game page Data\Platform\UI comes from, from the
  fork at the pinned commit, into local\thornswood-front.zip.

.DESCRIPTION
  The front is the fork's skymp5-front, built by webpack: build.js, the page
  and the hashed fonts, pictures and sounds build.js names. Go.ps1 unpacks
  local\thornswood-front.zip into Data\Platform\UI, and from there every
  release carries it.

  Until 20 October that zip was built on One from nobody knew which commit,
  and nothing checked it. Measured that day (#1317): it predated the fork's
  #40, so the live release still shipped DIN Pro and Futura PT, which nobody
  may redistribute, as four hashed .ttf files. Patrick's A on #2754 (Ships
  from the feed, in the cloud) needs every file a release carries to be built
  from something tracked, so the front is built here, from the commit
  engine\skymp is pinned to, the same commit records\client-build.json names
  (engine\README.md, One engine), and recorded in records\front-build.json.
  Go.ps1 refuses a zip that is not the recorded build.

  WHAT IT DOES
    1. Takes skymp5-front out of the fork at the commit with git archive, with
       line endings as committed, so Windows and Linux build the same bytes.
    2. yarn 1.22.22 (through npx) installs the locked packages and builds.
       Needs node and the npm registry; nothing else on the machine.
    3. Reads which npm packages webpack put in build.js, and each one's
       licence text from the folder it came from (Front.ps1, #3751).
    4. Compares what it built, and those packages and texts, with
       records\front-build.json. The same: it writes
       local\thornswood-front.zip, one fixed time on every entry, so the zip
       is the same on every machine. Different: it writes nothing and says
       what differs.
  -Record writes records\front-build.json and records\front-licences\ (each
  package's text) from this build instead of comparing, for when the pin
  moved: commit them with the pin. The texts are not in the zip: they go
  with build.js in the installer's licences folder and in every update that
  carries build.js (Source-Notice.ps1).

  Read only except for the zip, the record and its texts with -Record, its own scratch
  folder, which it removes, and engine\skymp when this checkout never
  fetched it (a cloud checkout): then it fetches the pinned commit there with
  git submodule update --init --depth 1. Never talks to the VPS.

.EXAMPLE
  .\scripts\release\Build-Front.ps1
  Builds the pinned front and puts the zip in local\ when it is the recorded build.

.EXAMPLE
  pwsh scripts/release/Build-Front.ps1 -Fork ../skymp -Record
  After a pin move: builds from another clone of the fork and records the build.
#>
[CmdletBinding()]
param(
    # A clone of the fork that has the commit. engine\skymp unless given
    # (git submodule update --init engine/skymp fetches it).
    [string]$Fork = (& (Join-Path $PSScriptRoot 'Where.ps1') Engine),
    # The fork commit. The one this checkout pins engine\skymp to unless given.
    [string]$Commit,
    [string]$Out = (Join-Path (& (Join-Path $PSScriptRoot 'Where.ps1') Local) 'thornswood-front.zip'),
    [switch]$Record
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Front.ps1')
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
$yarn = 'yarn@1.22.22'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

function Invoke-Native([string]$What, [scriptblock]$Run) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $said = @(& $Run 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
    if ($LASTEXITCODE -ne 0) {
        $said | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" }
        throw "$What failed (exit $LASTEXITCODE). Nothing was written."
    }
    return $said
}

# The pin in the index, which is what a commit takes: HEAD's on a clean
# checkout, and the moved pin while Update-EnginePin.ps1 makes a pin (#5207).
$pinned = ((& git -C $repo ls-files -s engine/skymp 2>$null) -split '\s+')[1]
if (-not $Commit) {
    if (-not $pinned) { throw 'this checkout pins no engine\skymp commit (git ls-files -s engine/skymp), so there is no front to build. Nothing was written.' }
    $Commit = $pinned
}
if (-not (Test-ThornswoodForkClone $Fork)) {
    $sub = Join-Path (Join-Path $repo 'engine') 'skymp'
    if ((Get-ThornswoodFullPath $Fork) -ne (Get-ThornswoodFullPath $sub)) { throw "there is no clone of the fork at $Fork. Give -Fork a clone of ThornswoodRP/skymp. Nothing was written." }
    # This checkout's own engine\skymp, never fetched (a cloud checkout):
    # the pin says which commit, so it is fetched here at that commit alone.
    Say "  engine\skymp is not fetched in this checkout, fetching the pinned commit"
    $null = Invoke-Native 'git submodule update --init --depth 1 engine/skymp' { & git -C $repo submodule update --init --depth 1 engine/skymp }
    if (-not (Test-ThornswoodForkClone $Fork)) { throw "engine\skymp is still not a clone of the fork after git submodule update. Nothing was written." }
}
$full = (& git -C $Fork rev-parse --verify --quiet ($Commit + '^{commit}') 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $full) { throw "the fork clone at $Fork does not have $Commit. Fetch it there (git -C $Fork fetch origin thornswood/engine-changes). Nothing was written." }
$full = "$full".Trim()
if ($pinned -and $full -ne $pinned) { Say "  note: $full is not the commit this checkout pins ($pinned)" 'Yellow' }
$npx = $(if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'npx.cmd' } else { 'npx' })
if (-not (Get-Command $npx -ErrorAction SilentlyContinue)) { throw 'npx is not on PATH, so the front cannot be built: install node (https://nodejs.org). Nothing was written.' }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-front-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$here = Get-Location
try {
    Say "front from $Fork at $($full.Substring(0, 8))" 'Cyan'
    $src = Join-Path $work 'src.zip'
    # As committed: autocrlf would give a Windows checkout CRLF sources, and a
    # build.js with other bytes than Linux's.
    Invoke-Native 'git archive' { & git -C $Fork -c core.autocrlf=false -c core.eol=lf archive --format=zip -o $src $full skymp5-front } | Out-Null
    Add-ThornswoodZipTypes
    [IO.Compression.ZipFile]::ExtractToDirectory($src, $work)
    $front = Join-Path $work 'skymp5-front'
    # webpack.config.ts reads its output folder from config.js, which the fork
    # leaves to each machine.
    [IO.File]::WriteAllText((Join-Path $front 'config.js'), "module.exports = { outputPath: `"./dist`" };`n", (New-Object Text.UTF8Encoding($false)))
    Set-Location -LiteralPath $front
    Say "  installing the locked packages ($yarn)"
    Invoke-Native 'yarn install' { & $npx --yes $yarn install --frozen-lockfile --ignore-engines --non-interactive } | Out-Null
    Say '  building'
    Invoke-Native 'yarn build' { & $npx --yes $yarn build } | Out-Null
    Set-Location -LiteralPath $here
    $dist = Join-Path $front 'dist'
    $files = Get-ThornswoodFolderFiles $dist
    if (-not $files.Contains('build.js') -or -not $files.Contains('index.html')) { throw 'the build made no build.js or index.html. Nothing was written.' }
    Say ("  built {0} files" -f $files.Count)
    $packages = Get-ThornswoodFrontPackages $dist $front
    Say ("  build.js holds {0} npm packages: {1}" -f $packages.Count, (@($packages.Values | ForEach-Object { $_.package + ' ' + $_.version }) -join ', '))

    if ($Record) {
        $rec = [ordered]@{
            forkCommit = $full
            builtUtc   = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
            builtWith  = ('node ' + "$(& node --version)".Trim() + ', ' + $yarn)
            files      = $files
            packages   = [ordered]@{}
        }
        $texts = [IO.Path]::GetFullPath($ThornswoodFrontLicencesDir)
        if (Test-Path -LiteralPath $texts) { Remove-Item -LiteralPath $texts -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $texts | Out-Null
        foreach ($n in $packages.Keys) {
            $p = $packages[$n]
            [IO.File]::WriteAllBytes((Join-Path $texts ($n + '.txt')), $p.Text)
            $rec.packages[$n] = [ordered]@{ package = $p.package; version = $p.version; licence = $p.licence; from = $p.from; sha256 = $p.sha256; bytes = $p.bytes }
        }
        [IO.File]::WriteAllText([IO.Path]::GetFullPath($ThornswoodFrontRecordPath), (($rec | ConvertTo-Json -Depth 5) + "`n"), (New-Object Text.UTF8Encoding($false)))
        Say '  recorded in records\front-build.json and records\front-licences\: commit them with the pin' 'Green'
    } else {
        $recorded = Read-ThornswoodFrontRecord
        if ($recorded.forkCommit -ne $full) { throw "records\front-build.json is the build of $($recorded.forkCommit), not $full. After a pin move run this with -Record and commit the record with the pin. Nothing was written." }
        $bad = @(Get-ThornswoodFrontProblems $files $recorded) + @(Get-ThornswoodFrontPackageProblems $packages $recorded)
        if ($bad.Count) {
            foreach ($b in $bad) { Say "  STOP  $b" 'Red' }
            throw 'this build is not records\front-build.json''s, so the zip was not written.'
        }
    }
    Write-ThornswoodFrontZip $dist $Out
    Say "  wrote $Out" 'Green'
} finally {
    Set-Location -LiteralPath $here
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
