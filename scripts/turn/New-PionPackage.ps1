<# Builds the Windows relay from an immutable source commit and the pinned portable Go archive.
   Produces a new operator package with an executable and dependency receipt. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$GoArchive,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (!$IsWindows) { throw 'Use the pinned Windows Go toolchain on Windows.' }
. (Join-Path $PSScriptRoot 'PionPackage.ps1')
$pin = Read-PionWindowsPin
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$archive = Get-Item -LiteralPath $GoArchive -ErrorAction Stop
if ($archive.PSIsContainer -or ($archive.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    $archive.Length -ne $pin.toolchain.bytes -or (Get-FileHash -LiteralPath $archive.FullName).Hash -ine $pin.toolchain.sha256) {
    throw 'The portable Go archive does not match the reviewed Windows pin.'
}
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$parent = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($destination)) -ErrorAction Stop
if (!$parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    (Test-Path -LiteralPath $destination)) {
    throw 'Choose a new output directory under a plain existing directory.'
}
$scratch = Join-Path $parent.FullName ('tw-pion-build-' + [guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($scratch)
$package = Join-Path $scratch 'package'
[void][IO.Directory]::CreateDirectory($package)
$goEnvironment = @{
    CGO_ENABLED = '0'; GOOS = 'windows'; GOARCH = 'amd64'; GOAMD64 = 'v1'
    GOTOOLCHAIN = 'local'; GOENV = 'off'; GOWORK = 'off'; GOFLAGS = ''
    GOPROXY = 'https://proxy.golang.org'; GOSUMDB = 'sum.golang.org'
    GOPRIVATE = ''; GONOPROXY = ''; GONOSUMDB = ''; GOINSECURE = ''
    GOCACHE = (Join-Path $scratch 'build-cache'); GOMODCACHE = (Join-Path $scratch 'module-cache')
}
$previous = @{}
try {
    $sourceZip = Join-Path $scratch 'source.zip'
    & git -C $repo archive --format=zip "--output=$sourceZip" $SourceCommit tools/turn-relay records/turn/pion-windows.json
    if ($LASTEXITCODE) { throw 'The exact committed TURN source is unavailable.' }
    $tree = Join-Path $scratch 'source'
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceZip,$tree)
    $frozenPin = Join-Path $tree 'records/turn/pion-windows.json'
    if ((Get-FileHash -LiteralPath $frozenPin).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo 'records/turn/pion-windows.json')).Hash) {
        throw 'The build pin differs from the reviewed source commit.'
    }
    $project = Join-Path $tree 'tools/turn-relay'
    $sums = Join-Path $project 'go.sum'
    Assert-PionModuleSums $sums $pin
    $sumHash = (Get-FileHash -LiteralPath $sums).Hash
    [IO.Compression.ZipFile]::ExtractToDirectory($archive.FullName,$scratch)
    $go = Join-Path $scratch 'go/bin/go.exe'
    $goEnvironment.GOROOT = Join-Path $scratch 'go'
    foreach ($name in $goEnvironment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
        [Environment]::SetEnvironmentVariable($name,$goEnvironment[$name],'Process')
    }
    $version = & $go version
    if ($LASTEXITCODE -or $version -cne "go version $($pin.toolchain.version) $($pin.toolchain.target)") {
        throw 'The extracted Go toolchain reports a different version.'
    }
    & $go -C $project mod download
    if ($LASTEXITCODE) { throw 'The locked relay dependencies did not download.' }
    & $go -C $project mod verify
    if ($LASTEXITCODE -or (Get-FileHash -LiteralPath $sums).Hash -ne $sumHash) { throw 'Relay dependencies failed integrity verification.' }
    & $go -C $project test -mod=readonly ./...
    if ($LASTEXITCODE) { throw 'The exact relay source failed its tests.' }
    $exe = Join-Path $package 'thornswood-turn.exe'
    $stamp = "-X main.sourceCommit=$SourceCommit -X main.buildVersion=$($pin.version)"
    & $go -C $project build -mod=readonly -trimpath -buildvcs=false -ldflags $stamp -o $exe .
    if ($LASTEXITCODE -or (Get-FileHash -LiteralPath $sums).Hash -ne $sumHash) { throw 'The locked relay build did not complete.' }
    $result = & $exe -version
    if ($LASTEXITCODE) { throw 'The built relay did not report its version.' }
    $identity = $result | ConvertFrom-Json
    if ($identity.product -cne 'Thornswood TURN' -or $identity.schema -ne 1 -or
        $identity.source -cne $SourceCommit -or $identity.version -cne $pin.version) {
        throw 'The relay build identity differs from this package.'
    }
    $hash = (Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant()
    Copy-Item -LiteralPath $sums -Destination (Join-Path $package 'go.sum')
    $receipt = [ordered]@{
        schema = 1; product = $identity.product; version = $identity.version; source = $SourceCommit
        toolchain = $pin.toolchain.version; target = $pin.toolchain.target; pionVersion = $pin.module.version
        exeSha256 = $hash; goSumSha256 = $sumHash.ToLowerInvariant()
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $package 'package.json') -Encoding utf8
    $null = Assert-PionWindowsPackage -Directory $package -ExpectedSourceCommit $SourceCommit -ExpectedPackageHash $hash
    [IO.Directory]::Move($package,$destination)
    $receipt | ConvertTo-Json -Compress
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $resolved = Get-Item -LiteralPath $scratch -ErrorAction SilentlyContinue
    if ($resolved -and $resolved.Parent.FullName -eq $parent.FullName -and $resolved.Name -cmatch '^tw-pion-build-[a-f0-9]{32}$' -and
        !($resolved.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $resolved.FullName -Recurse -Force
    }
}
