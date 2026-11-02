<# Compile the real Keep and ClientRuntime classes with a recorded fixture.
   Only the download and install environment is replaced; no network or game
   installation is touched. Exercises the repair followed by Play sequence. #>
param([string]$Repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
# Built with the .NET SDK on any machine (#4823); a refusal throws here. Run
# on Windows only: Keep walks the game's folders by Windows paths
# (Data\Platform), so elsewhere its names do not line up with real folders.
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-runtime-keep-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $good = [Text.Encoding]::UTF8.GetBytes('recorded client')
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $sha = ([BitConverter]::ToString($hash.ComputeHash($good))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    $record = @{ files = @{ 'Data\Platform\Plugins\skymp5-client.js' = [ordered]@{ sha256 = $sha; bytes = $good.Length } } } | ConvertTo-Json -Depth 5
    $recordPath = Join-Path $work 'client-build.json'
    [IO.File]::WriteAllText($recordPath, $record)
    $app = [IO.Path]::Combine($Repo, 'launcher', 'app')
    $dll = Build-LauncherCode -Exe -Resource @{ 'client-build.json' = $recordPath } -File (Join-Path $app 'Keep.cs'), (Join-Path $app 'ClientRuntime.cs'), ([IO.Path]::Combine($Repo, 'tests', 'fixtures', 'RuntimeKeepTest.cs'))
    Write-Host 'PASS Keep.cs, ClientRuntime.cs and the fixture build with the .NET SDK the launcher builds with'
    if (-not $OnWindows) {
        Write-Host 'SKIP the repair and Play sequence, run: Keep walks the game''s folders by Windows paths (Data\Platform), which only Windows has'
    } else {
        Invoke-LauncherExe $dll $work | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE) { throw 'Runtime/Keep regression failed' }
    }
} finally {
    $target = [IO.Path]::GetFullPath($work)
    # This machine's separator: off Windows the temp folder ends in / (#2989).
    $sep = [IO.Path]::DirectorySeparatorChar
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd($sep) + $sep
    if (-not $target.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notlike 'thornswood-runtime-keep-*') { throw 'Unsafe fixture cleanup target' }
    Remove-Item -LiteralPath $target -Recurse -Force
}
