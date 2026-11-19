# Windows TURN package checks shared by the builder and installer.
function Read-PionWindowsPin([string]$Path = '') {
    $repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    if (!$Path) { $Path = Join-Path $repo 'records/turn/pion-windows.json' }
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The TURN pin must be a plain, bounded file.'
    }
    $pin = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    if ($pin.schema -ne 1 -or $pin.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
        $pin.toolchain.target -cne 'windows/amd64' -or $pin.toolchain.version -cnotmatch '^go\d+\.\d+\.\d+$' -or
        $pin.toolchain.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $pin.toolchain.bytes -le 0 -or
        $pin.module.path -cne 'github.com/pion/turn/v5' -or $pin.module.version -cnotmatch '^v5\.\d+\.\d+$' -or
        $pin.module.sum -cnotmatch '^h1:[A-Za-z0-9+/]{43}=$' -or $pin.module.goModSum -cnotmatch '^h1:[A-Za-z0-9+/]{43}=$') {
        throw 'The TURN toolchain or module pin is invalid.'
    }
    return $pin
}

function Assert-PionModuleSums([string]$File, $Pin) {
    $sums = Get-Content -LiteralPath $File
    $module = $Pin.module
    if ("$($module.path) $($module.version) $($module.sum)" -cnotin $sums -or
        "$($module.path) $($module.version)/go.mod $($module.goModSum)" -cnotin $sums) {
        throw 'The locked Pion module hashes differ from the supplier pin.'
    }
}

function Assert-PionWindowsPackage {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSourceCommit,
        [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedPackageHash,
        [string]$PinPath = ''
    )
    $pin = Read-PionWindowsPin $PinPath
    $root = Get-Item -LiteralPath $Directory -ErrorAction Stop
    if (!$root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The TURN package must be a plain directory.'
    }
    $manifest = Join-Path $root.FullName 'package.json'
    $exe = Join-Path $root.FullName 'thornswood-turn.exe'
    $sums = Join-Path $root.FullName 'go.sum'
    $licenses = Join-Path $root.FullName 'LICENSES.txt'
    foreach ($file in $manifest, $exe, $sums, $licenses) {
        $item = Get-Item -LiteralPath $file -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'The TURN package has an unexpected file type.'
        }
    }
    $licenseLength = (Get-Item -LiteralPath $licenses).Length
    if ((Get-Item -LiteralPath $manifest).Length -gt 8192 -or (Get-Item -LiteralPath $sums).Length -gt 65536 -or
        $licenseLength -eq 0 -or $licenseLength -gt 262144) {
        throw 'The TURN package metadata is too large.'
    }
    $record = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($record.schema -ne 1 -or $record.product -cne 'Thornswood TURN' -or $record.version -cne $pin.version -or
        $record.source -cne $ExpectedSourceCommit -or $record.toolchain -cne $pin.toolchain.version -or
        $record.target -cne $pin.toolchain.target -or $record.pionVersion -cne $pin.module.version -or
        $record.exeSha256 -ine $ExpectedPackageHash -or (Get-FileHash -LiteralPath $exe).Hash -ine $ExpectedPackageHash -or
        (Get-FileHash -LiteralPath $sums).Hash -ine $record.goSumSha256 -or
        (Get-FileHash -LiteralPath $licenses).Hash -ine $record.licensesSha256) {
        throw 'The TURN package does not match the reviewed build and dependency hashes.'
    }
    Assert-PionModuleSums $sums $pin
    return $record
}
