<#
  test-4684-client-record-check.ps1

  The launcher build checks the shape of every record it compiles in before
  anything is compiled (#4684). Thornswood.csproj embeds four records
  (client-build, skyrim-files, ui-gone, generated); until #4684
  Build-Launcher.ps1 checked three from a list of its own, and a bad
  records\client-build.json went into the exe, where it shows only in a
  tester's launcher as a record it cannot read (ClientRuntime.cs).

  This runs the real Build-Launcher.ps1 in a scratch copy of the parts of the
  repository it reads, with a stand-in dotnet that answers the SDK question
  and leaves a mark if it is asked to publish:
    1. a client-build.json with no forkCommit stops the build with
       RecordShape.ps1's own message, and dotnet publish is never run
    2. the committed records pass the record step, and the build goes on to
       publish

  Offline. Read only apart from its own scratch folder, which it removes.
#>
[CmdletBinding()]
param([string]$Root)
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }
. (Join-Path (Join-Path $Root 'tests') 'Windows.ps1')        # $OnWindows (#2957)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { $p = $parts[0]; for ($i = 1; $i -lt $parts.Count; $i++) { $p = Join-Path $p $parts[$i] }; return $p }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-4684-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
    # The parts of the repository Build-Launcher reads before it publishes.
    $rel = P @($scratch, 'scripts', 'release')
    New-Item -ItemType Directory -Path $rel -Force | Out-Null
    foreach ($f in 'Build-Launcher.ps1', 'RecordShape.ps1', 'Read-JsonFile.ps1', 'Where.ps1', 'LauncherVersion.ps1', 'Get-ScratchDir.ps1') {
        Copy-Item -LiteralPath (P @($Root, 'scripts', 'release', $f)) -Destination (Join-Path $rel $f)
    }
    $app = P @($scratch, 'launcher', 'app')
    New-Item -ItemType Directory -Path $app -Force | Out-Null
    Copy-Item -LiteralPath (P @($Root, 'launcher', 'app', 'Thornswood.csproj')) -Destination (Join-Path $app 'Thornswood.csproj')
    $recs = Join-Path $scratch 'records'
    New-Item -ItemType Directory -Path $recs -Force | Out-Null
    foreach ($f in 'client-build.json', 'skyrim-files.json', 'ui-gone.json', 'generated.json') {
        Copy-Item -LiteralPath (P @($Root, 'records', $f)) -Destination (Join-Path $recs $f)
    }

    # A dotnet that says it is the .NET 10 SDK and marks a publish.
    $bin = Join-Path $scratch 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $mark = Join-Path $scratch 'published.txt'
    if ($OnWindows) {
        [IO.File]::WriteAllText((Join-Path $bin 'dotnet.cmd'),
            "@echo off`r`nif ""%1""==""--list-sdks"" ( echo 10.0.100 [C:\sdk] & exit /b 0 )`r`nif ""%1""==""publish"" ( echo publish> ""$mark"" & exit /b 1 )`r`nexit /b 1`r`n", $utf8)
    } else {
        $sh = Join-Path $bin 'dotnet'
        [IO.File]::WriteAllText($sh, "#!/bin/sh`nif [ ""`$1"" = ""--list-sdks"" ]; then echo '10.0.100 [/sdk]'; exit 0; fi`nif [ ""`$1"" = ""publish"" ]; then echo publish > '$mark'; exit 1; fi`nexit 1`n", $utf8)
        & chmod +x $sh
    }

    $pwsh = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    function Build {
        if (Test-Path -LiteralPath $mark) { Remove-Item -LiteralPath $mark }
        $old = $env:PATH
        $env:PATH = $bin + [IO.Path]::PathSeparator + $old
        try {
            $out = @(& $pwsh -NoProfile -File (Join-Path $rel 'Build-Launcher.ps1') -Src $app -Root (Join-Path $scratch 'install') -NoPause -NoSign -Version 1.0.0 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
        } finally { $env:PATH = $old }
        return [pscustomobject]@{ Code = $code; Out = ($out -join "`n"); Published = (Test-Path -LiteralPath $mark) }
    }

    # 1. a client build record with no forkCommit.
    $good = [IO.File]::ReadAllText((Join-Path $recs 'client-build.json'))
    $bad = $good | ConvertFrom-Json
    $bad.PSObject.Properties.Remove('forkCommit')
    [IO.File]::WriteAllText((Join-Path $recs 'client-build.json'), ($bad | ConvertTo-Json -Depth 10), $utf8)
    $r = Build
    Yes "a client-build.json with no forkCommit stops the build (exit $($r.Code))" ($r.Code -ne 0)
    Yes '  with the record check''s message, naming the record' ($r.Out -match 'forkCommit is missing' -and $r.Out -match 'client-build\.json' -and $r.Out -match 'Nothing was built')
    Yes '  before anything is published' (-not $r.Published)
    if ($script:fail) { Write-Host ('      the build said: ' + (($r.Out -split "`n" | Select-Object -Last 4) -join ' | ')) }

    # 2. the committed records.
    [IO.File]::WriteAllText((Join-Path $recs 'client-build.json'), $good, $utf8)
    $r = Build
    Yes 'the committed records pass the record step, and the build goes on to publish' ($r.Published -and $r.Out -notmatch 'Nothing was built')
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit $(if ($script:fail) { 1 } else { 0 })
