<#
  test-3099-client-licences.ps1

      pwsh -NoProfile -File .\tests\test-3099-client-licences.ps1

  The vcpkg libraries in the client files, and their licence texts (#3099):
  scripts\release\New-ClientLicenceRecord.ps1, which engine.yml runs after
  New-ClientBuildRecord.ps1 on the build\licences folder the fork's build
  measured (the fork's misc\thornswood\Write-ClientLicences.ps1).

  WHY. The texts are what the downloads and the installer carry, and the
  record is what says which text goes with which file. Each check is one a
  later edit could drop with nothing else going red. On a made up clone and
  build folder:
    1. the right build is recorded: every native file of the client record
       with its ports, every port with its version, declared licence, files
       and its text's sha256 and size, and each text beside the record byte
       for byte, the folder holding no other;
    2. each of these is refused with nothing written: a build of another
       commit, a client record of another commit, a measured file the client
       record does not have, a native file of the client record that was not
       measured, a text that is not the one licences.json names, a port in a
       file with no text, a port in a file that licences.json does not list,
       and a build that measured nothing.
  Save-PackageClientLicences, which gave the old installer the texts of the
  client it packed, went with that installer (Package-ClientRecord.ps1,
  #4824).

  Writes only under a temp folder, which it removes. Needs git. Connects to
  nothing.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent $Here
$script = Join-Path $root 'scripts\release\New-ClientLicenceRecord.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-3099-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$p, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $text, $utf8)
}
function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
$shell = (Get-Process -Id $PID).Path
function Run([string[]]$a) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    # The error as one line: pwsh wraps a thrown sentence to the console's
    # width, with colour and a gutter, and a Windows runner's is narrow.
    try {
        $o = @(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @a 2>&1 | ForEach-Object { "$_" })
        $one = (($o -join "`n") -replace '\x1b\[[0-9;]*m', '') -replace '\s*\r?\n\s*(\|\s*)?', ' '
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $one }
    }
    finally { $ErrorActionPreference = $eap }
}

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not on this machine' }
    $clone = Join-Path $T 'clone'
    $null = New-Item -ItemType Directory -Force -Path $clone
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git -C $clone -c init.defaultBranch=main init -q 2>&1 | Out-Null
    & git -C $clone -c user.name=t -c user.email=t@t commit -q --allow-empty -m fork 2>&1 | Out-Null
    $commit = ((& git -C $clone rev-parse HEAD) -join '').Trim()
    $ErrorActionPreference = $eap

    $native = @('Data\SKSE\Plugins\MpClientPlugin.dll', 'Data\SKSE\Plugins\SkyrimPlatform.dll',
                'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll',
                'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden')
    $inFile = @{ 'Data\SKSE\Plugins\MpClientPlugin.dll' = @('nlohmann-json', 'spdlog', 'fmt'); 'Data\SKSE\Plugins\SkyrimPlatform.dll' = @()
                 'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll' = @('frida-gum', 'nlohmann-json', 'fmt', 'spdlog')
                 'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden' = @('cef-prebuilt') }
    $licence = @{ 'nlohmann-json' = 'MIT'; spdlog = 'MIT'; fmt = 'MIT'; 'frida-gum' = $null; 'cef-prebuilt' = $null }
    $library = @{
        tilted = @{ Kind = 'fork'; Version = $null; Licence = $null; In = @('Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden', 'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll') }
        viet = @{ Kind = 'fork'; Version = $null; Licence = 'MIT'; In = @('Data\SKSE\Plugins\MpClientPlugin.dll', 'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll') }
        'npm-eventemitter3-5.0.1' = @{ Kind = 'npm'; Version = '5.0.1'; Licence = 'MIT'; In = @('Data\Platform\Plugins\skymp5-client.js') }
    }

    # A client record and a build folder as engine.yml has them; $edit
    # changes either before the script runs. Returns the paths.
    function New-Case([string]$tag, [scriptblock]$edit) {
        $d = Join-Path $T $tag
        $lic = Join-Path $d 'build\licences'
        $files = [ordered]@{}
        foreach ($f in $native) { $files[$f.Replace('\', '/')] = [ordered]@{ pdb = 'x.pdb'; ports = @($inFile[$f]); otherLibraries = @('libcpmt.lib') } }
        $ports = [ordered]@{}
        foreach ($n in @($licence.Keys | Sort-Object)) {
            Put (Join-Path $lic ($n + '.txt')) ("Copyright (c) the $n authors`r`nPermission is hereby granted`n")
            $ports[$n] = [ordered]@{ version = '1.2.3'; portVersion = 1; licence = $licence[$n]
                in = @($native | Where-Object { $inFile[$_] -contains $n } | ForEach-Object { $_.Replace('\', '/') })
                text = ($n + '.txt'); bytes = (Get-Item -LiteralPath (Join-Path $lic ($n + '.txt'))).Length; sha256 = (Sha (Join-Path $lic ($n + '.txt'))) }
        }
        # The libraries beside the ports (#3751): two of the fork's folders
        # and an npm package in skymp5-client.js.
        $libs = [ordered]@{}
        foreach ($n in @($library.Keys | Sort-Object)) {
            Put (Join-Path $lic ($n + '.txt')) ("The $n notice`n")
            $libs[$n] = [ordered]@{ kind = $library[$n].Kind; version = $library[$n].Version; licence = $library[$n].Licence; from = 'somewhere'
                in = @($library[$n].In | ForEach-Object { $_.Replace('\', '/') })
                text = ($n + '.txt'); bytes = (Get-Item -LiteralPath (Join-Path $lic ($n + '.txt'))).Length; sha256 = (Sha (Join-Path $lic ($n + '.txt'))) }
        }
        $m = [ordered]@{ commit = $commit; triplet = 'x64-windows-sp'; readWith = 'LLVM version 18.1.8'; files = $files; ports = $ports; libraries = $libs }
        $cfiles = [ordered]@{}
        foreach ($f in $native + @('Data\Platform\Plugins\skymp5-client.js', 'Data\Scripts\TESModPlatform.pex')) { $cfiles[$f] = [ordered]@{ sha256 = ('0' * 64); bytes = 1 } }
        $c = [ordered]@{ forkCommit = $commit.Substring(0, 8); files = $cfiles }
        if ($edit) { & $edit $lic $m $c }
        Put (Join-Path $lic 'licences.json') ($m | ConvertTo-Json -Depth 6)
        $rec = Join-Path $d 'records\client-build.json'
        Put $rec ($c | ConvertTo-Json -Depth 5)
        $out = Join-Path $d 'records\client-licences.json'
        return [pscustomobject]@{ Licences = $lic; Client = $rec; Out = $out; Texts = (Join-Path $d 'records\client-licences') }
    }
    function Try-Case($k) { return (Run @('-Licences', $k.Licences, '-Clone', $clone, '-ClientRecord', $k.Client, '-Out', $k.Out)) }
    function Wrote($k) { return ((Test-Path -LiteralPath $k.Out) -or (Test-Path -LiteralPath $k.Texts)) }

    # ---- 1. the right build ------------------------------------------------------
    Write-Host 'the right build'
    $k = New-Case 'good' $null
    $r = Try-Case $k
    Yes 'the build is recorded' ($r.Code -eq 0 -and (Test-Path -LiteralPath $k.Out))
    if ($r.Code -ne 0) { Write-Host $r.Out }
    $rec = $null
    if (Test-Path -LiteralPath $k.Out) { $rec = [IO.File]::ReadAllText($k.Out) | ConvertFrom-Json }
    Yes '  it names the client record''s fork commit' ($rec -and [string]$rec.forkCommit -eq $commit.Substring(0, 8))
    $filesOk = $rec -and @($rec.files.PSObject.Properties.Name).Count -eq 4
    foreach ($f in $native) { if (-not $rec -or (@($rec.files.$f) -join ',') -ne (@($inFile[$f] | Sort-Object) -join ',')) { $filesOk = $false } }
    Yes '  every native file of the client record, with its ports, at the record''s paths' $filesOk
    $portsOk = $rec -and @($rec.ports.PSObject.Properties.Name).Count -eq 5
    foreach ($n in $licence.Keys) {
        $p = if ($rec) { $rec.ports.$n } else { $null }
        $txt = Join-Path $k.Texts ($n + '.txt')
        if (-not $p -or [string]$p.version -ne '1.2.3' -or [int]$p.portVersion -ne 1 -or $p.licence -ne $licence[$n] -or -not (Test-Path -LiteralPath $txt) -or
            [string]$p.sha256 -ne (Sha $txt) -or [long]$p.bytes -ne (Get-Item -LiteralPath $txt).Length -or
            (@($p.in) -join ',') -ne (@($native | Where-Object { $inFile[$_] -contains $n }) -join ',')) { $portsOk = $false }
    }
    Yes '  every port with its version, declared licence, files, and its text''s sha256 and size' $portsOk
    $libsOk = $rec -and $rec.PSObject.Properties['libraries'] -and @($rec.libraries.PSObject.Properties.Name).Count -eq 3
    foreach ($n in $library.Keys) {
        $p = if ($libsOk) { $rec.libraries.$n } else { $null }
        $txt = Join-Path $k.Texts ($n + '.txt')
        if (-not $p -or [string]$p.kind -ne $library[$n].Kind -or $p.version -ne $library[$n].Version -or $p.licence -ne $library[$n].Licence -or -not (Test-Path -LiteralPath $txt) -or
            [string]$p.sha256 -ne (Sha $txt) -or [long]$p.bytes -ne (Get-Item -LiteralPath $txt).Length -or
            (@($p.in) -join ',') -ne (@($library[$n].In | Sort-Object) -join ',')) { $libsOk = $false }
    }
    Yes '  every library (#3751) with its kind, version, declared licence, files, and its text''s sha256 and size' $libsOk
    Yes '  each text beside the record is the build''s, byte for byte, and nothing else is there' (
        @(Get-ChildItem -LiteralPath $k.Texts -File).Count -eq 8 -and
        @(@($licence.Keys) + @($library.Keys) | Where-Object { (Sha (Join-Path $k.Texts ($_ + '.txt'))) -ne (Sha (Join-Path $k.Licences ($_ + '.txt'))) }).Count -eq 0)
    Put (Join-Path $k.Texts 'old-port.txt') 'a text from an earlier pin'
    $r = Try-Case $k
    Yes '  recorded again, a text no port names any more is gone' ($r.Code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $k.Texts 'old-port.txt')))

    # ---- 2. refused, nothing written ----------------------------------------------
    Write-Host ''; Write-Host 'refused'
    $cases = @(
        @{ Tag = 'commit'; What = 'a build of another commit'; Match = 'licences\.json is the build of'
           Edit = { param($l, $m, $c) $m.commit = ('b' * 40) } },
        @{ Tag = 'client'; What = 'a client record of another commit'; Match = 'names fork commit bbbbbbbb'
           Edit = { param($l, $m, $c) $c.forkCommit = 'bbbbbbbb' } },
        @{ Tag = 'extra'; What = 'a measured file the client record does not have'; Match = 'measured Data\\SKSE\\Plugins\\Other\.dll, which'
           Edit = { param($l, $m, $c) $m.files['Data/SKSE/Plugins/Other.dll'] = [ordered]@{ ports = @() } } },
        @{ Tag = 'unmeasured'; What = 'a native file of the client record that was not measured'; Match = 'SkyrimPlatform\.dll is in .* and licences\.json did not measure it'
           Edit = { param($l, $m, $c) $m.files.Remove('Data/SKSE/Plugins/SkyrimPlatform.dll') } },
        @{ Tag = 'text'; What = 'a text that is not the one licences.json names'; Match = 'fmt\.txt is not the text licences\.json names'
           Edit = { param($l, $m, $c) Put (Join-Path $l 'fmt.txt') 'another text' } },
        @{ Tag = 'notext'; What = 'a port in a file with no text'; Match = 'spdlog is in a client file and the build has no spdlog\.txt'
           Edit = { param($l, $m, $c) Remove-Item -LiteralPath (Join-Path $l 'spdlog.txt') } },
        @{ Tag = 'unlisted'; What = 'a port in a file that licences.json does not list'; Match = 'zlib is in a client file and licences\.json lists no port zlib'
           Edit = { param($l, $m, $c) $m.files['Data/SKSE/Plugins/SkyrimPlatform.dll'].ports = @('zlib') } },
        @{ Tag = 'nolibs'; What = 'a build that did not measure the libraries beside the ports (#3751)'; Match = 'licences\.json has no libraries'
           Edit = { param($l, $m, $c) $m.Remove('libraries') } },
        @{ Tag = 'libfile'; What = 'a library in a file the client record does not record'; Match = 'library viet is in Data\\SKSE\\Plugins\\Other\.dll, which'
           Edit = { param($l, $m, $c) $m.libraries['viet'].in = @('Data/SKSE/Plugins/Other.dll') } },
        @{ Tag = 'libtext'; What = 'a library text that is not the one licences.json names'; Match = 'tilted\.txt is not the text licences\.json names'
           Edit = { param($l, $m, $c) Put (Join-Path $l 'tilted.txt') 'another text' } },
        @{ Tag = 'libnotext'; What = 'a library with no text'; Match = 'library viet is in a client file and the build has no viet\.txt'
           Edit = { param($l, $m, $c) Remove-Item -LiteralPath (Join-Path $l 'viet.txt') } },
        @{ Tag = 'libport'; What = 'a library named like a port'; Match = 'fmt is both a port and a library'
           Edit = { param($l, $m, $c) $m.libraries['fmt'] = $m.libraries['viet'] } }
    )
    foreach ($case in $cases) {
        $k = New-Case $case.Tag $case.Edit
        $r = Try-Case $k
        Yes ("{0} is refused, naming it, and nothing is written" -f $case.What) ($r.Code -ne 0 -and $r.Out -match $case.Match -and -not (Wrote $k))
        if ($r.Code -eq 0 -or $r.Out -notmatch $case.Match) { Write-Host $r.Out }
    }
    $k = New-Case 'nothing' $null
    Remove-Item -LiteralPath (Join-Path $k.Licences 'licences.json')
    $r = Try-Case $k
    Yes 'a build that measured nothing (no licences.json) is refused, and nothing is written' ($r.Code -ne 0 -and $r.Out -match 'did not measure' -and -not (Wrote $k))

} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
