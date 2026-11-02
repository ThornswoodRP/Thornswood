<#
  test-temp-short-path.ps1

      pwsh -NoProfile -File .\tests\test-temp-short-path.ps1

  Issue #1156. A relative path cut from a file's FullName by the length of a
  root that is still the short 8.3 form of TEMP comes out wrong. Restore-Server
  was already fixed. This sets TEMP to a short path and runs
  vps-nightly-backup.ps1, which keeps its stage there, and then runs that
  script's Mend function on a world file that does not parse, so the copy
  back has to use the relative path.

  No Ship, no Skyrim install, and nothing under C:\Thornswood.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  a short TEMP is an 8.3 name, which only Windows has'; exit 0 }
$boxPs = Get-BoxPowerShell
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Nightly = Join-Path (Join-Path (Split-Path -Parent $Here) 'scripts\vps') 'vps-nightly-backup.ps1'

$work = & (Join-Path (Split-Path -Parent $Here) 'scripts\release\Get-ScratchDir.ps1') ('longtemp-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$long = Join-Path $work 'LongTempNameForShortPath'
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
    [void][IO.Directory]::CreateDirectory($long)
    $fso = New-Object -ComObject Scripting.FileSystemObject
    $short = $fso.GetFolder($long).ShortPath
    $isShort = ($short -match '~') -and ($short -ne $long)
    Yes "TEMP can be set to a short 8.3 path ($short)" ([bool]$isShort)
    if (-not $isShort) { throw 'this volume did not make an 8.3 name, so the short-path run cannot prove the cut' }

    $env:TEMP = $short
    $env:TMP = $short

    function Put([string]$path, [string]$text) {
        $dir = Split-Path -Parent $path
        if (-not [IO.Directory]::Exists($dir)) { [void][IO.Directory]::CreateDirectory($dir) }
        [IO.File]::WriteAllText($path, $text)
    }

    $live = Join-Path $short 'live'
    $good = '{"profileId":7,"isDeleted":false}'
    Put (Join-Path $live 'data\keep.txt') 'keep'
    Put (Join-Path $live 'data\game\data\keep.txt') 'nested'
    Put (Join-Path $live 'world\changeForms\0.json') $good
    Put (Join-Path $short 'key.txt') 'not-used'
    $out = Join-Path $short 'out'
    [void][IO.Directory]::CreateDirectory($out)

    $arg = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Nightly,
        '-GameRoot', $live,
        '-DevGameRoot', (Join-Path $short 'no-dev'),
        '-SiteRoot', (Join-Path $short 'no-site'),
        '-BotRoot', (Join-Path $short 'no-bot'),
        '-CaddyRoot', (Join-Path $short 'no-caddy'),
        '-VoiceRoot', (Join-Path $short 'no-voice'),
        '-DeletionRoot', (Join-Path $short 'no-del'),
        '-Out', $out,
        '-KeyFile', (Join-Path $short 'key.txt'),
        '-Plain'
    )
    $nightlyOut = & $boxPs @arg 2>&1 | Out-String
    $code = $LASTEXITCODE
    Yes "vps-nightly-backup.ps1 runs with TEMP short (exit $code)" ($code -eq 0)
    if ($code -ne 0) { Write-Host $nightlyOut }

    $zip = @(Get-ChildItem -LiteralPath $out -Filter 'thornswood-*.zip' -File -ErrorAction SilentlyContinue)
    Yes 'and it left one plain zip' ($zip.Count -eq 1)
    if ($zip.Count -eq 1) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip[0].FullName)
        try { $names = @($z.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }) }
        finally { $z.Dispose() }
        Yes '  game/data/keep.txt is itself, not a longer path' ($names -contains 'game/data/keep.txt')
        Yes '  game/data/game/data/keep.txt is itself' ($names -contains 'game/data/game/data/keep.txt')
        Yes '  the character is game/world/changeForms/0.json' ($names -contains 'game/world/changeForms/0.json')
        $bad = @($names | Where-Object { $_ -match 'THORNS~|LongTemp|SHORT8~' })
        Yes '  no entry is still a temp path' ($bad.Count -eq 0)
        if ($bad.Count) { $bad | ForEach-Object { Write-Host "        $_" } }
    }

    # Mend, the function inside that script. A world file that does not parse
    # is copied again from the path cut off the same string it was listed from.
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Nightly, [ref]$null, [ref]$errs)
    $defs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Mend' }, $true))
    Yes 'Mend is in vps-nightly-backup.ps1' ($defs.Count -eq 1)
    if ($defs.Count -eq 1) {
        Invoke-Expression $defs[0].Extent.Text
        $from = Join-Path $long 'mend-src'
        Put (Join-Path $from 'changeForms\0.json') $good
        $stage = $short
        $destFile = Join-Path $short 'game\world\changeForms\0.json'
        Put $destFile '{bad'
        function Note([string]$m) { Write-Host $m }
        $script:torn = @{}
        Mend $from 'game\world'
        $after = ''
        if (Test-Path -LiteralPath $destFile) { $after = [IO.File]::ReadAllText($destFile) }
        Yes 'Mend recopied the character off the long path' ($after -eq $good)
        if ($after -ne $good) { Write-Host "        file is now: $after" }
    }
}
finally {
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
