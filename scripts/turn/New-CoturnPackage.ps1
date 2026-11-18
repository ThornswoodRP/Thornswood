<# Prepare an exact reviewed runtime from a retained official CI archive.
   Never runs vendor installers, opens listeners, creates services/firewall rules,
   generates credentials or changes the voice issuer. Keep this archive in the
   protected tool store: upstream CI artifact retention is not durable storage. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CoturnPackage.ps1')
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pin = Get-Content -LiteralPath (Join-Path $repo 'records/turn/coturn-windows.json') -Raw | ConvertFrom-Json
$destination = Assert-NewCoturnStagingPath -Path $OutputDirectory
$files = Read-CoturnRuntime -Archive $Archive -Pin $pin
[void][IO.Directory]::CreateDirectory($destination)
foreach ($file in $files) {
    $path = Join-Path $destination $file.Path
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($file.Bytes) } finally { $stream.Dispose() }
}
$receipt = [ordered]@{ schema = 1; preparedOnly = $true; supplier = $pin.supplier; sourceCommit = $pin.sourceCommit; sourceTag = $pin.tag; artifactSha256 = $pin.artifactSha256; files = @($pin.files) }
$receipt | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $destination 'package.json') -Encoding utf8
Write-Output ('Prepared the reviewed native relay package; no activation: ' + $destination)
