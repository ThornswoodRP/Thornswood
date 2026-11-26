# Run only the pack and backup selection blocks against disposable files.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'scripts/dev/Clean-Everything.ps1'), [ref]$null, [ref]$null)
$root = Join-Path ([IO.Path]::GetTempPath()) ('ts-5596-' + [guid]::NewGuid().ToString('N'))
$packsDir = Join-Path $root 'packs'
$BackupDir = Join-Path $root 'backups'
$zone = [TimeZoneInfo]::FindSystemTimeZoneById('Mountain Standard Time')
$times = @('2026-11-01T07:40:00Z', '2026-11-01T07:50:00Z', '2026-11-01T08:10:00Z')
function Head($text) { }
function Say($text, $color) { }
function Mb($bytes) { $bytes / 1MB }
function Old-Note($dist) { '' }
function Add-Found($where, $what, $path, $bytes) { $found.Add($path) }
function Get-ChildItem {
    param([string]$LiteralPath, [string]$Filter, [switch]$File, $EA)
    if ($LiteralPath -notin @($packsDir, $BackupDir)) { throw 'Selection tried to leave the scratch folders' }
    # Read the real fixture mtime, but project its local value into Mountain
    # time without changing the runner's clock or timezone.
    Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath -Filter $Filter -File | ForEach-Object {
        [pscustomobject]@{
            Name = $_.Name; FullName = $_.FullName; Length = $_.Length
            LastWriteTimeUtc = $_.LastWriteTimeUtc
            LastWriteTime = [TimeZoneInfo]::ConvertTimeFromUtc($_.LastWriteTimeUtc, $zone)
        }
    }
}
$failures = 0
try {
    [void][IO.Directory]::CreateDirectory($packsDir)
    [void][IO.Directory]::CreateDirectory($BackupDir)
    $dists = @(@{ Path = $packsDir; Label = 'scratch' })
    $KeepBackups = 2
    foreach ($kind in 'Packs', 'Backups') {
        $pattern = if ($kind -eq 'Packs') { 'pack-{0}.zip' } else { 'thornswood-backup-20261101-01{0}.zip.enc' }
        $dir = if ($kind -eq 'Packs') { $packsDir } else { $BackupDir }
        $paths = for ($i = 0; $i -lt $times.Count; $i++) {
            $path = Join-Path $dir ($pattern -f ('{0:00}' -f $i))
            [IO.File]::WriteAllText($path, 'fixture')
            [IO.File]::SetLastWriteTimeUtc($path, ([DateTimeOffset]::Parse($times[$i])).UtcDateTime)
            $path
        }
        $entries = @(Get-ChildItem -LiteralPath $dir -Filter '*' -File)
        $localKeep = @($entries | Sort-Object LastWriteTime -Descending | Select-Object -First 2)
        if ($localKeep.FullName -contains $paths[2]) { throw 'Fixture did not reproduce the repeated-hour inversion' }
        Write-Host "PASS $kind local-time comparison drops the newest copy"
        $blocks = @($ast.EndBlock.Statements | Where-Object {
            $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -eq ('$' + $kind)
        })
        if ($blocks.Count -ne 1) { throw "Expected exactly one $kind selection block" }
        $found = [Collections.Generic.List[string]]::new()
        & ([scriptblock]::Create($blocks[0].Clauses[0].Item2.Extent.Text.Trim().TrimStart('{').TrimEnd('}')))
        $kept = @($paths | Where-Object { $_ -notin $found })
        if ($found.Count -eq 1 -and $found[0] -eq $paths[0] -and ($kept -join '|') -eq ($paths[1..2] -join '|') -and @($paths | Where-Object { [IO.File]::ReadAllText($_) -ne 'fixture' }).Count -eq 0) {
            Write-Host "PASS $kind keep the newest two and list only the oldest, without changing any file"
        } else {
            Write-Host "FAIL $kind should list only $($paths[0]); got $($found -join ', ')"
            $failures++
        }
    }
} finally {
    if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
if ($failures) { exit 1 }
