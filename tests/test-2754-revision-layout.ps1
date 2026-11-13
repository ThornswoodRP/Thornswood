<#
  test-2754-revision-layout.ps1

      pwsh -NoProfile -File .\tests\test-2754-revision-layout.ps1

  Install-NexusRevision.ps1 (#2754) against the stand-in Nexus on this
  machine's loopback address (tests\fixtures\nexus-standin.js), with a small
  made-up collection, never the real one.

  WHY. The layout step replaces Vortex as the thing that turns a revision
  into files, and every release step will read what it writes. What it must
  refuse, and what it must never write over, is held here.

  WHAT IT HOLDS:
    1. -Game is required, and a folder in a Steam library or one Vortex
       deploys into is refused before anything is asked;
    2. a revision with a kind not laid out here (an optional mod, a later
       phase) is refused naming each entry, with nothing downloaded;
    3. a download whose md5 is not the revision's stops the run naming the
       file, and leaves nothing of it in the cache; a free account's 403 on
       download-link stops it the same way;
    4. the cache: a second run downloads nothing, and a cached archive that
       changed is downloaded again, that one only;
    5. with 7-Zip: the layout itself. A plain archive cut at its first stop
       pattern, a hashes list, a FOMOD run with the collection's choices, a
       script extender to the game folder, a bsdiff patch, a file two mods
       share going to the one the mod rules deploy last, the plugin order
       with an unlisted plugin disabled at the end, files.txt holding every
       file with its sha256, and layout.json the revision and file ids;
    6. a run again replaces the layout; a layout file that changed, and a
       file no layout put there, are never written over; two mods sharing a
       file with no rule between them stop the run with -Game untouched;
    7. -Revision through the API: GraphQL's downloadLink, the v2
       download_link, and the CDN, which never gets the key;
    8. Compare-NexusLayout.ps1 (#2969): a record against a copy of itself,
       and against a game folder as Vortex leaves it, each difference named:
       the plugin order held to the collection's plugin rules, which
       layout.json carries, with drift where no rule binds only listed; a
       plugin differing only in its light flag named as that; a file the
       machine writes for itself and a switched off line with no plugin file
       listed, not counted; and a record with no rules refused.

  OFF WINDOWS (#2969) every run writes only the record (-Record), because a
  game folder is laid out on Windows, and the same layout is held through
  files.txt: part 1 holds the refusals of -Game and -Record there instead,
  and part 6's runs over a placed layout say SKIP. On both, part 5 also holds
  what Windows does with names: a FOMOD naming OPT\LAMBDA.TXT finds
  opt\Lambda.txt, textures and Textures in one archive are one folder named as
  its first entry names it, and a zip entry named Data\SKSE\Plugins\x.dll
  lands in those folders.
  Off Windows, two files in one archive differing only in case stop the run.

  Needs node. Part 5 onward needs 7-Zip and says SKIP without it. Everything
  it writes is under its own temp folder, which it removes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# A path written the Windows way, under a folder on this machine.
function P([string]$root, [string]$rel) { return (Join-Path $root ($rel.Replace('\', [IO.Path]::DirectorySeparatorChar))) }
$script_ = P $repo 'scripts\release\Install-NexusRevision.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$win = $OnWindows

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
$script:standin = $null
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-2754-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
function Done {
    if ($script:standin -and -not $script:standin.HasExited) { $script:standin.Kill() }
    if (Test-Path -LiteralPath $T) { [IO.Directory]::Delete($T, $true) }
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Md5([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash.ToLowerInvariant() }
function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

$node = Get-Command node -ErrorAction SilentlyContinue
Yes 'node is on PATH, for the stand-in Nexus' ($null -ne $node)
if ($null -eq $node) { Done }
$pwsh = (Get-Process -Id $PID).Path
$sz = ''
if ($env:ProgramFiles -and (Test-Path -LiteralPath (Join-Path $env:ProgramFiles '7-Zip\7z.exe'))) { $sz = Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
if (-not $sz) { foreach ($n in '7z', '7zz', '7za') { $g = Get-Command $n -ErrorAction SilentlyContinue; if ($g) { $sz = $g.Source; break } } }
New-Item -ItemType Directory -Force -Path $T, (Join-Path $T 'scratch') | Out-Null

# ---- the stand-in -----------------------------------------------------------
$KEY = 'standin-' + [Guid]::NewGuid().ToString('N')
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $node.Source
[void]$psi.ArgumentList.Add((P $repo 'tests\fixtures\nexus-standin.js'))
$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables['NEXUS_STANDIN_KEY'] = $KEY
$script:standin = [Diagnostics.Process]::Start($psi)
trap { $script:fail++; Write-Host ('FAIL  the harness itself stopped: ' + $_.Exception.Message) -ForegroundColor Red; Done }
$errRead = $script:standin.StandardError.ReadToEndAsync()
$first = $script:standin.StandardOutput.ReadLineAsync()
$heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
$pm = [regex]::Match($heard, '^\[nexus\] listening on 127\.0\.0\.1:(\d+)$')
$port = if ($pm.Success) { [int]$pm.Groups[1].Value } else { 0 }
Yes "the stand-in Nexus says it is listening on its own port ($port)" ($port -gt 0)
if (-not $port) { if ($errRead.Wait(2000)) { Write-Host ('      ' + $errRead.Result) }; Done }
$null = $script:standin.StandardOutput.ReadToEndAsync()
$base = 'http://127.0.0.1:' + $port
function State { return (Invoke-RestMethod -Uri ($base + '/_requests')) }
function Control($h) { [void](Invoke-RestMethod -Method Post -Uri ($base + '/_control') -ContentType 'application/json' -Body ($h | ConvertTo-Json -Compress -Depth 6)) }
function Since([int]$n) { $all = @((State).requests); if ($all.Count -le $n) { return @() }; return @($all[$n..($all.Count - 1)]) }
function Count { return @((State).requests).Count }
function Cdn($reqs, [string]$id = '') { return , @($reqs | Where-Object { $_.path -like ('/cdn/file/' + $id + '*') }) }

$env:THORNSWOOD_NEXUS_STANDIN = $base
$env:THORNSWOOD_NEXUS_STANDIN_KEY = $KEY
$env:THORNSWOOD_NEXUS_API_KEY = $null
$env:THORNSWOOD_SCRATCH_ROOT = (Join-Path $T 'scratch')
$script:outs = New-Object System.Collections.Generic.List[string]
function Run([string[]]$arguments) {
    $p = New-Object Diagnostics.ProcessStartInfo
    $p.FileName = $pwsh
    foreach ($a in @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script_) + $arguments + @('-NoPause')) { [void]$p.ArgumentList.Add($a) }
    $p.UseShellExecute = $false; $p.CreateNoWindow = $true; $p.RedirectStandardOutput = $true; $p.RedirectStandardError = $true
    $pr = [Diagnostics.Process]::Start($p)
    $e = $pr.StandardError.ReadToEndAsync()
    $o = $pr.StandardOutput.ReadToEnd()
    $pr.WaitForExit()
    $text = $o + $e.Result
    $script:outs.Add($text)
    return [pscustomobject]@{ Code = $pr.ExitCode; Out = $text }
}
function Show($r) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 16) -join "`n") -ForegroundColor DarkGray }
function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; if (-not $cond) { Show $r } }

# ---- the made-up mods ----------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Zip([string]$name, [hashtable]$files) {
    $src = P $T ('src\' + $name)
    foreach ($k in $files.Keys) { Put (P $src $k) $files[$k] }
    $zip = P $T ('archives\' + $name + '.zip')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zip) | Out-Null
    [IO.Compression.ZipFile]::CreateFromDirectory($src, $zip)
    return $zip
}
# A zip whose entries are named exactly, in this order, so two names that
# differ only in case can both be in it, as they can in an archive made off
# Windows.
function ZipExact([string]$name, [object[]]$pairs) {
    $zip = P $T ('archives\' + $name + '.zip')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zip) | Out-Null
    $za = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        for ($i = 0; $i -lt $pairs.Count; $i += 2) {
            $w = New-Object IO.StreamWriter($za.CreateEntry($pairs[$i]).Open(), (New-Object Text.UTF8Encoding($false)))
            try { $w.Write([string]$pairs[$i + 1]) } finally { $w.Dispose() }
        }
    }
    finally { $za.Dispose() }
    return $zip
}
$lambdaXml = @'
<?xml version="1.0" encoding="utf-8"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://qconsulting.ca/fo3/ModConfig5.0.xsd">
  <moduleName>Lambda</moduleName>
  <requiredInstallFiles>
    <file source="OPT\LAMBDA.TXT" destination="lambda.txt" />
  </requiredInstallFiles>
</config>
'@
$fomodXml = @'
<?xml version="1.0" encoding="utf-8"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://qconsulting.ca/fo3/ModConfig5.0.xsd">
  <moduleName>Gamma</moduleName>
  <requiredInstallFiles>
    <folder source="common" destination="" />
  </requiredInstallFiles>
  <installSteps order="Explicit">
    <installStep name="Main">
      <optionalFileGroups order="Explicit">
        <group name="Pick" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="One"><description>one</description><files><file source="opt1\Gamma.esp" destination="Gamma.esp" /></files><typeDescriptor><type name="Optional"/></typeDescriptor></plugin>
            <plugin name="Two"><description>two</description><files><file source="opt2\Gamma.esp" destination="Gamma.esp" /></files><typeDescriptor><type name="Optional"/></typeDescriptor></plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>
'@
$arc = [ordered]@{
    alpha = Zip 'Alpha' @{ 'Data\Alpha.esp' = 'alpha plugin'; 'Data\Zeta.esp' = 'zeta plugin'; 'Data\textures\shared.dds' = 'alpha texture'; 'readme.txt' = 'read me'; 'Data\meta.ini' = '[General]' }
    beta  = Zip 'Beta' @{ 'junk\Beta.esp' = 'beta plugin'; 'junk\other.txt' = 'not listed' }
    gamma = Zip 'Gamma' @{ 'fomod\ModuleConfig.xml' = $fomodXml; 'opt1\Gamma.esp' = 'gamma one'; 'opt2\Gamma.esp' = 'gamma two'; 'common\textures\shared.dds' = 'gamma texture' }
    delta = Zip 'Delta' @{ 'delta_1\skse64_loader.exe' = 'loader'; 'delta_1\Data\Scripts\delta.pex' = 'script' }
    eps   = Zip 'Epsilon' @{ 'Eps.esp' = 'AAAA' }
    kappa = ZipExact 'Kappa' @('Data/textures/k2.dds', 'kappa two', 'Data/Textures/k1.dds', 'kappa one', 'Data\SKSE\Plugins\kappa.dll', 'kappa dll')
    lambda = ZipExact 'Lambda' @('fomod/ModuleConfig.xml', $lambdaXml, 'opt/Lambda.txt', 'lambda text')
    mu    = ZipExact 'Mu' @('Data/mu.txt', 'lower', 'Data/MU.txt', 'upper')
    nu    = Zip 'Nu' @{ 'Data\Nu.esl' = 'nu light plugin' }
    xi    = (P $T 'archives\Xi.rar')
}
# Xi starts the way a RAR archive does and is not one, so no 7-Zip can test it.
[IO.File]::WriteAllBytes($arc.xi, [byte[]](@(0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00) + @(1..57)))
$ids = @{ alpha = 900001; beta = 900002; gamma = 900003; delta = 900004; eps = 900005; kappa = 900006; lambda = 900007; mu = 900008; nu = 900009; xi = 900010 }
$serve = @{}
foreach ($k in $arc.Keys) { $serve[[string]$ids[$k]] = @{ path = $arc[$k]; name = (Split-Path -Leaf $arc[$k]) } }
Control @{ serve = $serve }
$betaMd5 = (Get-FileHash -LiteralPath (P $T 'src\Beta\junk\Beta.esp') -Algorithm MD5).Hash.ToLowerInvariant()
function Entry([string]$k, [string]$name, [hashtable]$extra) {
    $e = [ordered]@{ name = $name; version = '1.0'; optional = $false; domainName = 'skyrimspecialedition'
        source = [ordered]@{ type = 'nexus'; modId = ($ids[$k] - 900000 + 100); fileId = $ids[$k]; md5 = (Md5 $arc[$k]); fileSize = (Get-Item -LiteralPath $arc[$k]).Length; logicalFilename = $name; updatePolicy = 'exact'; tag = ('tag' + $k) }
        author = 'Someone'; details = [ordered]@{ category = 'Misc'; type = '' }; phase = 0 }
    foreach ($x in $extra.Keys) { if ($x -eq 'type') { $e.details.type = $extra[$x] } else { $e[$x] = $extra[$x] } }
    return $e
}
function Collection([object[]]$mods, [object[]]$rules) {
    return [ordered]@{
        info = [ordered]@{ author = 'Someone'; authorUrl = ''; name = 'Made Up'; description = ''; installInstructions = ''; domainName = 'skyrimspecialedition'; gameVersions = @('1.6.1170.0') }
        mods = $mods; modRules = $rules; tools = @()
        plugins = @(@{ name = 'Alpha.esp'; enabled = $true }, @{ name = 'Gamma.esp'; enabled = $true }, @{ name = 'Beta.esp'; enabled = $true }, @{ name = 'Eps.esp'; enabled = $true })
        # alpha after zeta names a plugin the list leaves off, so disabled:
        # it orders nothing the game loads and does not stop the run (#2969).
        pluginRules = [ordered]@{ plugins = @([ordered]@{ name = 'gamma.esp'; after = @('alpha.esp') }, [ordered]@{ name = 'alpha.esp'; after = @('zeta.esp') }); groups = @() }
        collectionConfig = [ordered]@{ recommendNewProfile = $true; referenceTagScheme = 'v1' }
    }
}
$alphaE = Entry 'alpha' 'Alpha' @{}
$betaE = Entry 'beta' 'Beta' @{ hashes = @([ordered]@{ path = 'Beta.esp'; md5 = $betaMd5 }) }
$gammaE = Entry 'gamma' 'Gamma' @{ choices = [ordered]@{ type = 'fomod'; options = @([ordered]@{ name = 'Main'; groups = @([ordered]@{ name = 'Pick'; choices = @([ordered]@{ name = 'Two'; idx = 1 }) }) }) } }
$deltaE = Entry 'delta' 'Delta' @{ type = 'dinput' }
$kappaE = Entry 'kappa' 'Kappa' @{}
$lambdaE = Entry 'lambda' 'Lambda' @{ choices = [ordered]@{ type = 'fomod'; options = @() } }
$muE = Entry 'mu' 'Mu' @{}
$crcOld = '' ; $epsE = $null
$rule = [ordered]@{ type = 'after'; reference = [ordered]@{ fileMD5 = (Md5 $arc.alpha); versionMatch = '1.0.0'; logicalFileName = 'Alpha' }; source = [ordered]@{ fileMD5 = (Md5 $arc.gamma); versionMatch = '1.0.0'; logicalFileName = 'Gamma' } }
function Write-Col([string]$dir, $c) { Put (P $dir 'collection.json') ($c | ConvertTo-Json -Depth 12); New-Item -ItemType Directory -Force -Path (P $dir 'bundled') | Out-Null }

# Where a run writes: a game folder on Windows, only the record elsewhere.
function To([string]$name) { if ($win) { return @('-Game', (P $T $name)) }; return @('-Record', (P $T $name)) }

# ---- 1: -Game ----------------------------------------------------------------------
$colPlain = P $T 'col-plain'
Write-Col $colPlain (Collection @($alphaE, $betaE, $gammaE, $deltaE) @($rule))
$n0 = Count
$r = Run @('-CollectionArchive', $colPlain, '-Revision', '5')
YesR 'with no -Game it stops and says there is no default' ($r.Code -eq 1 -and $r.Out -match 'Say which folder' -and (Count) -eq $n0) $r
if (-not $win) {
    $r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Game', (P $T 'linux-game'))
    YesR 'off Windows -Game is refused, pointing at -Record' ($r.Code -eq 1 -and $r.Out -match 'done on Windows' -and $r.Out -match '-Record' -and -not (Test-Path -LiteralPath (P $T 'linux-game'))) $r
    $r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Game', (P $T 'g'), '-Record', (P $T 'r'))
    YesR '-Game and -Record together are refused' ($r.Code -eq 1 -and $r.Out -match 'not both') $r
    $r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Record', (P $T 'r'), '-WhatIf')
    YesR '-Record with -WhatIf is refused' ($r.Code -eq 1 -and $r.Out -match 'leave -WhatIf off' -and -not (Test-Path -LiteralPath (P $T 'r'))) $r
    Put (P $T 'busy\notes.txt') 'mine'
    $r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Record', (P $T 'busy'))
    YesR 'a -Record folder holding anything but a record is refused' ($r.Code -eq 1 -and $r.Out -match 'more than a layout''s record' -and @(Get-ChildItem -LiteralPath (P $T 'busy')).Count -eq 1) $r
    Yes 'none of these asked the stand-in anything' ((Count) -eq $n0)
}
else {
$steam = P $T 'steamapps\common\Skyrim Special Edition'
$r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Game', $steam)
YesR 'a folder in a Steam library is refused' ($r.Code -eq 1 -and $r.Out -match 'is in a Steam library' -and -not (Test-Path -LiteralPath $steam)) $r
$vg = P $T 'vortex-game'
Put (P $vg 'Data\vortex.deployment.json') '{}'
$r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Game', $vg)
YesR 'a folder Vortex deploys into is refused' ($r.Code -eq 1 -and $r.Out -match 'is a folder Vortex deploys into' -and @(Get-ChildItem -LiteralPath $vg -Recurse -File).Count -eq 1) $r
Put (P $vg 'vortex.deployment.dinput.json') '{}'
[IO.File]::Delete((P $vg 'Data\vortex.deployment.json'))
$r = Run @('-CollectionArchive', $colPlain, '-Revision', '5', '-Game', $vg)
YesR 'and so is one with only the dinput record at its top' ($r.Code -eq 1 -and $r.Out -match 'Vortex deployment record') $r
Yes 'none of these asked the stand-in anything' ((Count) -eq $n0)
}

# ---- 2: a kind not laid out here ------------------------------------------------------------
$colOdd = P $T 'col-odd'
$oddA = Entry 'alpha' 'Alpha' @{ optional = $true }
$oddB = Entry 'beta' 'Beta' @{ phase = 1 }
Write-Col $colOdd (Collection @($oddA, $oddB) @())
$n0 = Count
$r = Run (@('-CollectionArchive', $colOdd, '-Revision', '5', '-Cache', (P $T 'cache')) + (To 'game-odd'))
YesR 'an optional mod and a later phase are refused, each named, and nothing is downloaded' ($r.Code -eq 1 -and $r.Out -match 'Alpha \(mod 101, file 900001\) is optional' -and $r.Out -match 'Beta \(mod 102, file 900002\) is in phase 1' -and $r.Out -match 'nothing was downloaded' -and (Count) -eq $n0 -and -not (Test-Path -LiteralPath (P $T 'cache')) -and -not (Test-Path -LiteralPath (P $T 'game-odd'))) $r

# ---- 3: a download that is not the revision's -----------------------------------------------
$cache = P $T 'cache'
Control @{ corrupt = @('900002') }
$n0 = Count
$r = Run (@('-CollectionArchive', $colPlain, '-Revision', '5', '-Cache', $cache) + (To 'game'))
Control @{ corrupt = @() }
YesR 'a download whose md5 is not the revision''s stops the run, naming the file' ($r.Code -eq 1 -and $r.Out -match 'The download of Beta \(mod 102, file 900002\) is not the archive the revision lists' -and $r.Out -match 'deleted from the cache') $r
Yes 'and nothing of it stays in the cache, while the one before it does' (@(Get-ChildItem -LiteralPath (P $cache '900002') -File -ErrorAction SilentlyContinue).Count -eq 0 -and @(Get-ChildItem -LiteralPath (P $cache '900001') -File).Count -eq 1)
Yes 'and -Game (or -Record) was not made' (-not (Test-Path -LiteralPath (P $T 'game')))
$got = @(Since $n0)
Yes 'the download links were asked for with the key, and the CDN got none' (@($got | Where-Object { $_.path -like '*/download-link' -and $_.key -ne 'right' }).Count -eq 0 -and (Cdn $got).Count -ge 2 -and @((Cdn $got) | Where-Object { $_.key -ne 'none' }).Count -eq 0)
Control @{ premium = $false }
$r = Run (@('-CollectionArchive', $colPlain, '-Revision', '5', '-Cache', $cache) + (To 'game'))
Control @{ premium = $true }
YesR 'a free account''s 403 on download-link stops it naming the file' ($r.Code -eq 1 -and $r.Out -match 'Asking for the download of Beta \(mod 102, file 900002\) was refused: HTTP 403' -and $r.Out -match 'Premium') $r

# ---- 4: the cache ----------------------------------------------------------------------
# A whole run that places nothing: -WhatIf on Windows, a -Record of its own off it.
$script:look = 0
function Look { if ($win) { return @('-Game', (P $T 'game'), '-WhatIf') }; $script:look++; return @('-Record', (P $T ('look' + $script:look))) }
$n0 = Count
$r = Run (@('-CollectionArchive', $colPlain, '-Revision', '5', '-Cache', $cache) + (Look))
$first4 = @(Since $n0)
YesR 'the first whole run downloads what the cache lacks' ((Cdn $first4).Count -eq 3 -and $r.Out -match '1 from the cache, 3 downloaded') $r
$n0 = Count
$r = Run (@('-CollectionArchive', $colPlain, '-Revision', '5', '-Cache', $cache) + (Look))
YesR 'a second run downloads nothing and asks for no link' ((Cdn @(Since $n0)).Count -eq 0 -and @((Since $n0) | Where-Object { $_.path -like '*/download-link' }).Count -eq 0 -and $r.Out -match '4 from the cache, 0 downloaded') $r
$cachedGamma = @(Get-ChildItem -LiteralPath (P $cache '900003') -File)[0].FullName
[IO.File]::AppendAllText($cachedGamma, 'x')
$n0 = Count
$r = Run (@('-CollectionArchive', $colPlain, '-Revision', '5', '-Cache', $cache) + (Look))
$got = @(Since $n0)
YesR 'a cached archive that changed is downloaded again, that one only' ((Cdn $got).Count -eq 1 -and (Cdn $got '900003').Count -eq 1 -and $r.Out -match 'is not the archive the revision lists for file 900003, so it is replaced' -and (Md5 $cachedGamma) -eq (Md5 $arc.gamma)) $r

if (-not $sz) { Skip 'the layout itself, a run again and -Revision through the API: 7-Zip is not on this machine'; Done }

# ---- 5: the layout ----------------------------------------------------------------------
# A bsdiff patch for Epsilon's Eps.esp, AAAA to AAAB, made the way bsdiff
# writes one: a control triple, the byte differences, no extra bytes.
function OffT([long]$v) { $b = [BitConverter]::GetBytes([long][Math]::Abs($v)); if ($v -lt 0) { $b[7] = $b[7] -bor 0x80 }; return $b }
function Bz([byte[]]$data, [string]$name) {
    $f = P $T ('bz\' + $name); New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null
    [IO.File]::WriteAllBytes($f, $data)
    & $sz a -tbzip2 -y ($f + '.bz2') $f | Out-Null
    return [IO.File]::ReadAllBytes($f + '.bz2')
}
$ctrl = Bz ((OffT 4) + (OffT 0) + (OffT 0)) 'ctrl'
$dif = Bz ([byte[]](0, 0, 0, 1)) 'diff'
$ext = Bz ([byte[]]@()) 'extra'
$patch = [byte[]]([Text.Encoding]::ASCII.GetBytes('BSDIFF40') + (OffT $ctrl.Length) + (OffT $dif.Length) + (OffT 4) + $ctrl + $dif + $ext)
Add-Type -LiteralPath (P $repo 'scripts\release\NexusLayout.cs')
$crcOld = [Thornswood.Layout.NexusLayout]::Crc32Of((P $T 'src\Epsilon\Eps.esp'))
$epsE = Entry 'eps' 'Epsilon' @{ patches = [ordered]@{ 'Eps.esp' = $crcOld } }
$colFull = P $T 'col-full'
Write-Col $colFull (Collection @($alphaE, $betaE, $gammaE, $deltaE, $epsE, $kappaE, $lambdaE) @($rule))
New-Item -ItemType Directory -Force -Path (P $colFull 'patches\Epsilon') | Out-Null
[IO.File]::WriteAllBytes((P $colFull 'patches\Epsilon\Eps.esp.diff'), $patch)
$game = P $T 'game'
$recDir = if ($win) { P $game 'Thornswood Layout' } else { P $T 'record' }
$r = Run (@('-CollectionArchive', $colFull, '-Revision', '5', '-Cache', $cache) + $(if ($win) { @('-Game', $game) } else { @('-Record', $recDir) }))
YesR 'the layout runs to the end' ($r.Code -eq 0 -and $r.Out -match 'revision 5 of 7essxf: ') $r
# The layout as files.txt has it, path (any case) to sha256; on Windows the
# placed files are then held to files.txt.
$lines = @()
if (Test-Path -LiteralPath (P $recDir 'files.txt')) { $lines = @([IO.File]::ReadAllLines((P $recDir 'files.txt')) | Where-Object { $_ -and -not $_.StartsWith('#') }) }
$F = @{}
foreach ($l in $lines) { $c = $l.Split("`t"); $F[$c[3].ToLowerInvariant()] = $c }
function ShaText([string]$t) { $b = (New-Object Text.UTF8Encoding($false)).GetBytes($t); return (([Security.Cryptography.SHA256]::Create().ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join '') }
function Has([string]$rel, [string]$text) { $c = $F[$rel.ToLowerInvariant()]; return ($null -ne $c -and $c[0] -eq (ShaText $text)) }
function Lacks([string]$rel) { return (-not $F.ContainsKey($rel.ToLowerInvariant())) }
Yes 'a plain archive is cut at its first stop pattern: Data\Alpha.esp, and readme.txt beside it in Data' ((Has 'Data\Alpha.esp' 'alpha plugin') -and (Has 'Data\readme.txt' 'read me') -and @($F.Keys | Where-Object { $_.StartsWith('data\data\') }).Count -eq 0)
Yes 'meta.ini is never deployed' (Lacks 'Data\meta.ini')
Yes 'a hashes list puts the listed md5 at its path and nothing else' ((Has 'Data\Beta.esp' 'beta plugin') -and (Lacks 'Data\other.txt') -and @($F.Keys | Where-Object { $_.StartsWith('data\junk\') }).Count -eq 0)
Yes 'the FOMOD runs with the collection''s choice (Two) and its required folder' (Has 'Data\Gamma.esp' 'gamma two')
Yes 'the file Alpha and Gamma share is Gamma''s, the mod the rule deploys after' ((Has 'Data\textures\shared.dds' 'gamma texture') -and $F['data\textures\shared.dds'][2] -eq '900003')
Yes 'the script extender goes to the game folder, from its own folder down' ((Has 'skse64_loader.exe' 'loader') -and (Has 'Data\Scripts\delta.pex' 'script') -and (Lacks 'Data\skse64_loader.exe'))
Yes 'the patch makes Eps.esp AAAB' (Has 'Data\Eps.esp' 'AAAB')
# textures comes first in the zip, so 7-Zip on Windows makes the folder
# textures and puts Textures/k1.dds in it (#2969: One's revision 2 has
# Immersive Armours' meshes this way).
Yes 'textures and Textures in one archive are one folder, named as its first entry names it, as on Windows' ((Has 'Data\textures\k1.dds' 'kappa one') -and (Has 'Data\textures\k2.dds' 'kappa two') -and @($lines | Where-Object { $_.EndsWith("`tData\textures\k1.dds") -or $_.EndsWith("`tData\textures\k2.dds") }).Count -eq 2)
Yes 'a FOMOD naming OPT\LAMBDA.TXT finds opt\Lambda.txt' (Has 'Data\lambda.txt' 'lambda text')
Yes 'a zip entry named with \ between its folders lands in those folders, as on Windows' (Has 'Data\SKSE\Plugins\kappa.dll' 'kappa dll')
$pl = @([IO.File]::ReadAllLines((P $recDir 'plugins.txt')) | Where-Object { $_ -and -not $_.StartsWith('#') })
Yes ('plugins.txt is the collection''s order, then the plugin it does not list, disabled: ' + ($pl -join ' ')) (($pl -join '|') -eq '*Alpha.esp|*Gamma.esp|*Beta.esp|*Eps.esp|Zeta.esp')
$lo = @([IO.File]::ReadAllLines((P $recDir 'loadorder.txt')) | Where-Object { $_ -and -not $_.StartsWith('#') })
Yes 'loadorder.txt is the same names without stars' (($lo -join '|') -eq 'Alpha.esp|Gamma.esp|Beta.esp|Eps.esp|Zeta.esp')
Yes ('files.txt names every file, ' + $lines.Count + ', sorted by path ignoring case') ($lines.Count -eq 13 -and (($lines | ForEach-Object { $_.Split("`t")[3] }) -join '|') -eq ((@($lines | ForEach-Object { $_.Split("`t")[3] }) | Sort-Object { $_ } -Culture '' -CaseSensitive:$false) -join '|'))
if ($win) {
    $onDisk = @(Get-ChildItem -LiteralPath $game -Recurse -File | Where-Object { -not $_.FullName.StartsWith($recDir) })
    $okLines = @($lines | Where-Object { $c = $_.Split("`t"); $f = P $game $c[3]; (Test-Path -LiteralPath $f) -and (Sha $f) -eq $c[0] -and (Get-Item -LiteralPath $f).Length -eq [long]$c[1] })
    Yes 'every file in files.txt is placed with its sha256 and size, and nothing else is' ($okLines.Count -eq $lines.Count -and $onDisk.Count -eq $lines.Count)
}
else {
    Yes 'nothing is placed off Windows: the record folder holds the four records only' ((@(Get-ChildItem -LiteralPath $recDir -Force | ForEach-Object { $_.Name } | Sort-Object) -join ' ') -eq 'files.txt layout.json loadorder.txt plugins.txt' -and -not (Test-Path -LiteralPath $game))
}
$lj = Get-Content -Raw -LiteralPath (P $recDir 'layout.json') | ConvertFrom-Json
Yes 'layout.json says the revision, and each mod''s file id, md5 and installer' ($lj.collection.revision -eq 5 -and $lj.collection.slug -eq '7essxf' -and $lj.files -eq 13 -and (@($lj.mods | ForEach-Object { [string]$_.fileId + ':' + $_.installer }) -join ' ') -eq '900001:basic 900002:list 900003:fomod 900004:script-extender 900005:basic 900006:basic 900007:fomod' -and @($lj.mods | Where-Object { $_.fileId -eq 900003 })[0].md5 -eq (Md5 $arc.gamma))
Yes 'and files.txt carries the file id each file came from' (@($lines | Where-Object { $_.EndsWith("`tData\textures\shared.dds") -and $_.Split("`t")[2] -eq '900003' }).Count -eq 1)
Yes 'the scratch folder is gone after' (-not (Test-Path -LiteralPath (P $T 'scratch\revision-layout-7essxf-5')))
if (-not $win) {
    $colMu = P $T 'col-mu'
    Write-Col $colMu (Collection @($muE) @())
    $r = Run @('-CollectionArchive', $colMu, '-Revision', '5', '-Cache', $cache, '-Record', (P $T 'record-mu'))
    YesR 'off Windows, two files in one archive differing only in case stop the run, naming them' ($r.Code -eq 1 -and $r.Out -match 'Mu \(mod 108, file 900008\): the archive holds Data\\(mu|MU)\.txt twice, differing only in case' -and -not (Test-Path -LiteralPath (P $T 'record-mu'))) $r
}

# ---- 6: a run again, and what is never written over ------------------------------------------
if ($win) {
    function Text([string]$rel) { $p = P $game $rel; if (Test-Path -LiteralPath $p) { return [IO.File]::ReadAllText($p) }; return $null }
    $r = Run @('-CollectionArchive', $colFull, '-Revision', '5', '-Game', $game, '-Cache', $cache)
    YesR 'a run again over its own layout replaces it' ($r.Code -eq 0 -and $r.Out -match 'the layout there now has 13 files, all as its files.txt says' -and (Text 'Data\Gamma.esp') -eq 'gamma two') $r
    # What a run cut part way through a copy leaves (#4303): files.txt still
    # saying it is being placed, the file not there, and its .part short.
    $ft = P $recDir 'files.txt'
    $fl = [IO.File]::ReadAllLines($ft); $fl[0] = $fl[0] -replace '\. sha256, size, Nexus file id, path in the game folder\.$', '. Being placed; layout.json is written when it is whole.'
    [IO.File]::WriteAllText($ft, (($fl -join "`r`n") + "`r`n"))
    [IO.File]::Delete((P $game 'Data\Gamma.esp'))
    [IO.File]::WriteAllText((P $game 'Data\Gamma.esp.part'), 'gam')
    $r = Run @('-CollectionArchive', $colFull, '-Revision', '5', '-Game', $game, '-Cache', $cache)
    YesR 'a run again over a layout cut part way through a copy finishes it, and leaves no .part' ($r.Code -eq 0 -and (Text 'Data\Gamma.esp') -eq 'gamma two' -and @(Get-ChildItem -LiteralPath $game -Recurse -File -Filter '*.part').Count -eq 0) $r
    [IO.File]::WriteAllText((P $game 'Data\Alpha.esp'), 'edited by hand')
    $r = Run @('-CollectionArchive', $colFull, '-Revision', '5', '-Game', $game, '-Cache', $cache)
    YesR 'a layout file that changed is not taken out, and the run stops naming it' ($r.Code -eq 1 -and $r.Out -match 'not what its files.txt says' -and $r.Out -match 'Data\\Alpha.esp' -and (Text 'Data\Alpha.esp') -eq 'edited by hand') $r
    $game2 = P $T 'game2'
    Put (P $game2 'Data\Beta.esp') 'somebody else''s'
    $r = Run @('-CollectionArchive', $colFull, '-Revision', '5', '-Game', $game2, '-Cache', $cache)
    YesR 'a file no layout put there is never written over' ($r.Code -eq 1 -and $r.Out -match 'no layout put them there' -and $r.Out -match 'Data\\Beta.esp' -and @(Get-ChildItem -LiteralPath $game2 -Recurse -File).Count -eq 1) $r
}
else { Skip 'a run again over a placed layout, and what it never writes over: a game folder is laid out on Windows only' }
$colNoRule = P $T 'col-norule'
Write-Col $colNoRule (Collection @($alphaE, $gammaE) @())
$r = Run (@('-CollectionArchive', $colNoRule, '-Revision', '5', '-Cache', $cache) + (To 'game3'))
YesR 'two mods that share a file with no rule between them stop the run, and -Game (or -Record) is untouched' ($r.Code -eq 1 -and $r.Out -match 'No mod rule says which' -and $r.Out -match 'Alpha and Gamma \(1 files\)' -and -not (Test-Path -LiteralPath (P $T 'game3'))) $r

# 27 Oct: revision 5 ruled cheddars_mashups.esl, which the game loads as a
# master, to load after plugins that are not, and the list had it at the end,
# so the rule held to the list and every install got LOOT's cyclic
# interaction. Nu.esl has no TES4 header here, so it is placed by its name.
$nuE = Entry 'nu' 'Nu' @{}
$colLoop = P $T 'col-loop'
$cLoop = Collection @($alphaE, $nuE) @()
$cLoop.plugins = @(@{ name = 'Alpha.esp'; enabled = $true }, @{ name = 'Nu.esl'; enabled = $true })
$cLoop.pluginRules = [ordered]@{ plugins = @([ordered]@{ name = 'nu.esl'; after = @('alpha.esp') }); groups = @() }
Write-Col $colLoop $cLoop
$r = Run (@('-CollectionArchive', $colLoop, '-Revision', '5', '-Cache', $cache) + (To 'game-loop'))
YesR 'an .esl ruled to load after a plugin that is not a master stops the run, naming the loop and why, and -Game (or -Record) is untouched' ($r.Code -eq 1 -and $r.Out -match 'cyclic interaction' -and $r.Out -match 'Nu\.esl --> Alpha\.esp --> Nu\.esl \(Nu\.esl loads as a master and Alpha\.esp does not; the rule Nu\.esl loads after Alpha\.esp\)' -and $r.Out -match 'placed by name alone: Alpha\.esp, Nu\.esl' -and -not (Test-Path -LiteralPath (P $T 'game-loop'))) $r

# 30 Oct: the stop for a RAR archive this 7-Zip cannot test began with the
# count, so PowerShell read the + as a sum, threw "Cannot convert value" and
# the reason never showed (the Desk, on Linux with Debian's 7z).
$colRar = P $T 'col-rar'
Write-Col $colRar (Collection @((Entry 'xi' 'Xi' @{})) @())
$r = Run (@('-CollectionArchive', $colRar, '-Revision', '5', '-Cache', $cache) + (To 'game-rar'))
YesR 'a RAR archive this 7-Zip cannot test stops the run, saying so' ($r.Code -eq 1 -and $r.Out -match '1 of the archives are RAR \(Xi\)' -and $r.Out -notmatch 'Cannot convert value' -and -not (Test-Path -LiteralPath (P $T 'game-rar'))) $r

# ---- 7: -Revision through the API -----------------------------------------------------------
$colArc = P $T 'collection_6.7z'
Push-Location $colFull; & $sz a -t7z -y $colArc 'collection.json' 'bundled' 'patches' | Out-Null; Pop-Location
Control @{ addRevision = @{ n = 6; id = 906006; status = 'draft'; archive = $colArc } }
$game6 = P $T 'game6'
$rec6 = if ($win) { P $game6 'Thornswood Layout' } else { $game6 }
$n0 = Count
$r = Run (@('-Revision', '6', '-Cache', $cache) + (To 'game6'))
$got = @(Since $n0)
YesR '-Revision reads the revision from Nexus and lays it out' ($r.Code -eq 0 -and $r.Out -match 'revision 6, draft, id 906006' -and (Test-Path -LiteralPath (P $rec6 'files.txt'))) $r
$lj6 = Get-Content -Raw -LiteralPath (P $rec6 'layout.json') | ConvertFrom-Json
Yes 'its layout.json says the revision id, the status and the collection archive''s md5' ($lj6.collection.revision -eq 6 -and $lj6.collection.revisionId -eq '906006' -and $lj6.collection.status -eq 'draft' -and $lj6.collection.archiveMd5 -eq (Md5 $colArc))
Yes 'the v2 download_link was asked with the key, and the collection''s CDN download without it' (@($got | Where-Object { $_.path -eq '/v2/collections/515846/revisions/906006/download_link' -and $_.key -eq 'right' }).Count -eq 1 -and @($got | Where-Object { $_.path -eq '/cdn/collection/906006' -and $_.key -eq 'none' }).Count -eq 1)

# ---- 8: Compare-NexusLayout.ps1 (#2969) ----------------------------------------------
$cmp = P $repo 'scripts\release\Compare-NexusLayout.ps1'
function RunCmp([string[]]$arguments) {
    $p = New-Object Diagnostics.ProcessStartInfo
    $p.FileName = $pwsh
    foreach ($a in @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cmp) + $arguments + @('-NoPause')) { [void]$p.ArgumentList.Add($a) }
    $p.UseShellExecute = $false; $p.CreateNoWindow = $true; $p.RedirectStandardOutput = $true; $p.RedirectStandardError = $true
    $pr = [Diagnostics.Process]::Start($p)
    $e = $pr.StandardError.ReadToEndAsync()
    $o = $pr.StandardOutput.ReadToEnd()
    $pr.WaitForExit()
    return [pscustomobject]@{ Code = $pr.ExitCode; Out = $o + $e.Result }
}
$ljr = Get-Content -Raw -LiteralPath (P $recDir 'layout.json') | ConvertFrom-Json
Yes 'layout.json carries the collection''s plugin rules as it gives them' (@($ljr.pluginRules).Count -eq 2 -and $ljr.pluginRules[0].name -eq 'gamma.esp' -and @($ljr.pluginRules[0].after) -join ',' -eq 'alpha.esp' -and $ljr.pluginRules[1].name -eq 'alpha.esp' -and @($ljr.pluginRules[1].after) -join ',' -eq 'zeta.esp')
$copy = P $T 'record-copy'
New-Item -ItemType Directory -Force -Path $copy | Out-Null
foreach ($n in 'files.txt', 'plugins.txt', 'loadorder.txt', 'layout.json') { Copy-Item -LiteralPath (P $recDir $n) -Destination (P $copy $n) }
$r = RunCmp @('-Record', $recDir, '-With', $copy)
YesR 'a record compared with a copy of itself is the same, files.txt the same file' ($r.Code -eq 0 -and $r.Out -match 'files.txt is the same file in both' -and $r.Out -match 'The same: every file and the plugin order') $r
$cl = [IO.File]::ReadAllLines((P $copy 'files.txt'))
for ($i = 0; $i -lt $cl.Length; $i++) { if ($cl[$i].EndsWith("`tData\Gamma.esp")) { $c = $cl[$i].Split("`t"); $c[0] = ('0' * 64); $cl[$i] = $c -join "`t" } }
$cl = @($cl | Where-Object { -not $_.EndsWith("`tData\lambda.txt") })
[IO.File]::WriteAllText((P $copy 'files.txt'), (($cl -join "`r`n") + "`r`n"))
$r = RunCmp @('-Record', $recDir, '-With', $copy, '-Out', (P $T 'cmp.txt'))
YesR 'a changed file and a missing one are named, and it exits 1' ($r.Code -eq 1 -and $r.Out -match 'only in the record: 1' -and $r.Out -match 'Data\\lambda\.txt  from Lambda \(file 900007\)' -and $r.Out -match 'different bytes: 1' -and $r.Out -match 'Data\\Gamma\.esp' -and (Test-Path -LiteralPath (P $T 'cmp.txt'))) $r
# A game folder as Vortex leaves it: its deployment records, the files, one
# file of a mod made on the machine, and the game's plugins.txt.
$vg2 = P $T 'vortex-deployed'
$want = [ordered]@{ 'Data\Alpha.esp' = 'alpha plugin'; 'Data\readme.txt' = 'read me'; 'Data\Zeta.esp' = 'zeta plugin'; 'Data\Beta.esp' = 'beta plugin'; 'Data\Gamma.esp' = 'gamma two'; 'Data\textures\shared.dds' = 'gamma texture'; 'Data\Scripts\delta.pex' = 'script'; 'Data\Eps.esp' = 'AAAB'; 'Data\textures\k1.dds' = 'kappa one'; 'Data\textures\k2.dds' = 'kappa two'; 'Data\SKSE\Plugins\kappa.dll' = 'kappa dll'; 'Data\lambda.txt' = 'lambda text'; 'skse64_loader.exe' = 'loader' }
foreach ($k in $want.Keys) { Put (P $vg2 $k) $want[$k] }
function Deployed([bool]$extra) {
    $data = @($want.Keys | Where-Object { $_.StartsWith('Data\') } | ForEach-Object { [ordered]@{ relPath = $_.Substring(5); source = 'Mod-1'; target = '' } })
    if ($extra) { Put (P $vg2 'Data\meshes\made.nif') 'made here'; $data += [ordered]@{ relPath = 'meshes\made.nif'; source = 'Generated Files'; target = '' } }
    Put (P $vg2 'Data\vortex.deployment.json') ([ordered]@{ instance = 'x'; version = 1; deploymentMethod = 'hardlink'; files = $data } | ConvertTo-Json -Depth 5)
    Put (P $vg2 'vortex.deployment.dinput.json') ([ordered]@{ instance = 'x'; version = 1; deploymentMethod = 'hardlink'; files = @([ordered]@{ relPath = 'skse64_loader.exe'; source = 'Delta-4'; target = '' }) } | ConvertTo-Json -Depth 5)
}
Deployed $false
Put (P $T 'game-plugins.txt') "# This file is used by Skyrim to keep track of your downloaded content.`r`n*Alpha.esp`r`n*Gamma.esp`r`n*Beta.esp`r`n*Eps.esp`r`nZeta.esp`r`n"
$r = RunCmp @('-Record', $recDir, '-Vortex', $vg2, '-Plugins', (P $T 'game-plugins.txt'))
YesR 'a Vortex deployment of the same files and plugin order is the same' ($r.Code -eq 0 -and $r.Out -match '13 files are the same in both' -and $r.Out -match 'The same: every file, and the plugin order keeps the collection''s rules') $r
Deployed $true
Put (P $vg2 'Data\Beta.esp') 'beta plugin, edited'
Put (P $T 'game-plugins.txt') "*Alpha.esp`r`n*Beta.esp`r`n*Gamma.esp`r`n*Eps.esp`r`n*Zeta.esp`r`n*ccBGSSSE001-Fish.esm`r`n"
$r = RunCmp @('-Record', $recDir, '-Vortex', $vg2, '-Plugins', (P $T 'game-plugins.txt'))
YesR 'a mod made on the machine, a changed file, a broken rule and a moved plugin are each named' ($r.Code -eq 1 -and $r.Out -match 'Generated Files: 1 files, Data\\meshes\\made\.nif' -and $r.Out -match 'different bytes: 1' -and $r.Out -match 'Data\\Beta\.esp  layout: Beta \(file 900002\), Vortex: Mod-1' -and $r.Out -match 'plugins only in the other: 1' -and $r.Out -match 'plugin rules broken there: 1' -and $r.Out -match 'Alpha\.esp is to load after Zeta\.esp, and loads before it there' -and $r.Out -match 'Zeta\.esp is disabled here and enabled there') $r
Yes 'where no rule binds, a plugin placed elsewhere than the curator''s list is listed and not counted' ($r.Out -match 'differs from the curator''s list: 1, not a difference' -and $r.Out -match 'position 2 of the 4 plugins both enable: Gamma\.esp here, Beta\.esp there' -and $r.Out -match '(?m)^5 differences\.')
# What the first run on One printed as 15 plain differences (#2969): a
# plugin edited in its light flag only, files the machine writes for itself,
# and a switched off line for a plugin that is gone.
function Tes4([uint32]$flags, [byte]$last) { $b = New-Object byte[] 24; [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0); [BitConverter]::GetBytes([uint32]0).CopyTo($b, 4); [BitConverter]::GetBytes($flags).CopyTo($b, 8); $b[23] = $last; return , $b }
function PutBytes([string]$path, [byte[]]$b) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null; [IO.File]::WriteAllBytes($path, $b) }
$rec9 = P $T 'record-kinds'; $vg9 = P $T 'vortex-kinds'
PutBytes (P $T 'kinds-light.esp') (Tes4 0 1); PutBytes (P $T 'kinds-other.esp') (Tes4 0 2)
Put (P $T 'kinds-snct.ini') ''; Put (P $T 'kinds-a.log') 'shipped'
$kinds = [ordered]@{ 'Data\Light.esp' = 'kinds-light.esp'; 'Data\Other.esp' = 'kinds-other.esp'; 'Data\SKSE\Plugins\EngineFixes_SNCT.ini' = 'kinds-snct.ini'; 'Data\SKSE\Plugins\a.log' = 'kinds-a.log' }
$fl = @('# Install-NexusRevision.ps1: collection 7essxf revision 9. sha256, size, Nexus file id, path in the game folder.')
foreach ($k in $kinds.Keys) { $src = P $T $kinds[$k]; $fl += ((Sha $src) + "`t" + (Get-Item -LiteralPath $src).Length + "`t900009`t" + $k) }
Put (P $rec9 'files.txt') (($fl -join "`r`n") + "`r`n")
Put (P $rec9 'plugins.txt') "# Install-NexusRevision.ps1: collection 7essxf revision 9`r`n*Light.esp`r`n*Other.esp`r`n"
Put (P $rec9 'layout.json') ([ordered]@{ schema = 1; mods = @([ordered]@{ name = 'Kinds'; fileId = 900009 }); plugins = @(); pluginRules = @([ordered]@{ name = 'other.esp'; after = @('light.esp') }) } | ConvertTo-Json -Depth 5)
PutBytes (P $vg9 'Data\Light.esp') (Tes4 0x200 1)
PutBytes (P $vg9 'Data\Other.esp') (Tes4 0x200 3)
Put (P $vg9 'Data\SKSE\Plugins\EngineFixes_SNCT.ini') "[Volumes]`r`nMusic=0.4`r`n"
Put (P $vg9 'Data\SKSE\Plugins\a.log') 'written in game'
Put (P $vg9 'Data\vortex.deployment.json') ([ordered]@{ instance = 'x'; version = 1; deploymentMethod = 'hardlink'; files = @($kinds.Keys | ForEach-Object { [ordered]@{ relPath = $_.Substring(5); source = 'Kinds-9'; target = '' } }) } | ConvertTo-Json -Depth 5)
Put (P $T 'kinds-plugins.txt') "*Light.esp`r`n*Other.esp`r`nGone.esp`r`n"
$r = RunCmp @('-Record', $rec9, '-Vortex', $vg9, '-Plugins', (P $T 'kinds-plugins.txt'))
YesR 'a plugin that is the record''s bytes but for the light flag is named as that, and counted' ($r.Code -eq 1 -and $r.Out -match 'but for the light flag in the plugin''s header: 1' -and $r.Out -match 'Data\\Light\.esp  set here, Kinds \(file 900009\)') $r
Yes 'a plugin that differs in more than the flag is still different bytes' ($r.Out -match 'different bytes: 1' -and $r.Out -match 'Data\\Other\.esp  layout: Kinds')
Yes 'the sound volumes Engine Fixes saves and a log are written on the machine, listed and not counted' ($r.Out -match 'written on this machine for itself \(a log, a setting saved there\): 2, not a difference' -and $r.Out -match 'EngineFixes_SNCT\.ini' -and $r.Out -match '(?m)^2 differences\.')
Yes 'a switched off line with no plugin file in Data is listed and not counted' ($r.Out -match 'no file in Data, so the game loads nothing for them: 1, not a difference' -and $r.Out -match 'Gone\.esp' -and $r.Out -notmatch 'plugins only in the other' -and $r.Out -notmatch 'rules broken')
$lj9 = Get-Content -Raw -LiteralPath (P $rec9 'layout.json') | ConvertFrom-Json
Put (P $rec9 'layout.json') ([ordered]@{ schema = 1; mods = $lj9.mods; plugins = @() } | ConvertTo-Json -Depth 5)
$r = RunCmp @('-Record', $rec9, '-Vortex', $vg9, '-Plugins', (P $T 'kinds-plugins.txt'))
YesR 'a record written before layout.json carried the rules is refused, and says how to write it again' ($r.Code -eq 1 -and $r.Out -match 'has no pluginRules' -and $r.Out -match 'Install-NexusRevision\.ps1 -Record') $r

# ---- the key, across every run ---------------------------------------------------
Yes ('no run printed the key, in ' + $script:outs.Count + ' runs') (@($script:outs | Where-Object { $_.Contains($KEY) }).Count -eq 0)
$v = @((State).violations)
Yes 'the stand-in saw no request without the key, and no key sent to the CDN' ($v.Count -eq 0)
foreach ($x in $v) { Write-Host ('      ' + $x) }
Done
