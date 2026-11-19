$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts/turn/PionPackage.ps1')

$pin = Read-PionWindowsPin
$parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$directory = Join-Path $parent ('tw-pion-package-test-' + [guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($directory)
$manifest = Join-Path $directory 'package.json'
$exe = Join-Path $directory 'thornswood-turn.exe'
$sums = Join-Path $directory 'go.sum'
$source = 'a' * 40
$count = 0

function Expect-Refusal([scriptblock]$Check) {
    try { $null = & $Check } catch { $script:count++; return }
    throw 'Expected the package check to refuse different bytes or identity.'
}

try {
    $module = $pin.module
    [IO.File]::WriteAllText($exe,'a reviewed executable is represented by this fixture')
    [IO.File]::WriteAllLines($sums,@("$($module.path) $($module.version) $($module.sum)",
        "$($module.path) $($module.version)/go.mod $($module.goModSum)"))
    $hash = (Get-FileHash -LiteralPath $exe).Hash
    $record = @{
        schema=1; product='Thornswood TURN'; version=$pin.version; source=$source; toolchain=$pin.toolchain.version
        target=$pin.toolchain.target; pionVersion=$pin.module.version; exeSha256=$hash
        goSumSha256=(Get-FileHash -LiteralPath $sums).Hash
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8
    $candidate = Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit $source -ExpectedPackageHash $hash
    if ($candidate.source -cne $source) { throw 'The matching package was not returned.' }
    $count++
    Expect-Refusal { Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit ('b' * 40) -ExpectedPackageHash $hash }
    Expect-Refusal { Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit $source -ExpectedPackageHash ('b' * 64) }
    [IO.File]::AppendAllText($sums,"`nthornswood.invalid/changed v1.0.0 h1:invalid=`n")
    Expect-Refusal { Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit $source -ExpectedPackageHash $hash }
    [IO.File]::WriteAllText($sums,'a different module lock with the matching manifest hash')
    $record.goSumSha256 = (Get-FileHash -LiteralPath $sums).Hash
    $record | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8
    Expect-Refusal { Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit $source -ExpectedPackageHash $hash }
    [IO.File]::WriteAllText($exe,'replacement bytes')
    Expect-Refusal { Assert-PionWindowsPackage -Directory $directory -ExpectedSourceCommit $source -ExpectedPackageHash $hash }
    Write-Output "$count passed, 0 failed"
} finally {
    $item = Get-Item -LiteralPath $directory -ErrorAction SilentlyContinue
    if ($item -and $item.Parent.FullName -eq $parent -and $item.Name -cmatch '^tw-pion-package-test-[a-f0-9]{32}$' -and
        !($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
}
