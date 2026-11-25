# Run the real audit over scratch Steam libraries with a fixture registry.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ('ts-4614-' + [guid]::NewGuid())
$tools = Join-Path $root 'tools'
function Put($path, $text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text)
}
function Snapshot($path) {
    (Get-ChildItem -LiteralPath $path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        if ($_.PSIsContainer) { 'dir ' + $_.FullName }
        else { '{0} {1} {2}' -f $_.FullName, $_.LastWriteTimeUtc.Ticks, (Get-FileHash -LiteralPath $_.FullName).Hash }
    }) -join "`n"
}
function Get-ItemProperty($Path, $Name, $EA) {
    if ($Path -eq 'HKCU:\Software\Valve\Steam' -and $script:registryRoot) {
        return @{ SteamPath = $script:registryRoot }
    }
    throw 'No Steam registry value in the fixture'
}
# The old audit names these two paths literally. Do not let it inspect them.
function Test-Path {
    param($LiteralPath, $PathType = 'Any')
    if ($LiteralPath -in @('C:\SkyrimRP', 'C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition')) { return $false }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath -PathType $PathType
}
$names = @('USERPROFILE', 'LOCALAPPDATA', 'ProgramFiles(x86)')
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$fail = 0; $pass = 0
function Yes($label, $ok) {
    if ($ok) { $script:pass++; Write-Host "PASS $label" }
    else { $script:fail++; Write-Host "FAIL $label" }
}
try {
    foreach ($rel in 'dev/Audit-Leftovers.ps1', 'dev/Leftovers.ps1', 'mods/SteamLibrary.ps1') {
        $src = Join-Path $repo "scripts/$rel"
        if ([IO.File]::Exists($src)) {
            $dst = Join-Path $tools $rel
            [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dst))
            Copy-Item -LiteralPath $src -Destination $dst
        }
    }
    Put (Join-Path $tools 'release/Where.ps1') 'param($Kind) Join-Path $env:USERPROFILE $Kind'
    foreach ($case in 'secondary', 'default', 'missing') {
        $machine = Join-Path $root $case
        $env:USERPROFILE = Join-Path $machine 'home'
        $env:LOCALAPPDATA = Join-Path $machine 'local'
        ${env:ProgramFiles(x86)} = Join-Path $machine 'Program Files (x86)'
        $steam = Join-Path ${env:ProgramFiles(x86)} 'Steam'
        $secondary = Join-Path $machine 'Second library'
        $script:registryRoot = if ($case -eq 'default') { $null } else { $steam }
        $escaped = $secondary.Replace('\', '\\')
        Put (Join-Path $steam 'config/libraryfolders.vdf') "`"libraryfolders`"`n{`n `"1`"`n {`n  `"path`" `"$escaped`"`n }`n}"
        $game = Join-Path $(if ($case -eq 'default') { $steam } else { $secondary }) 'steamapps/common/Skyrim Special Edition'
        if ($case -ne 'missing') { Put (Join-Path $game 'SkyrimSE.exe') 'fixture' }
        $backup = Join-Path $game 'Data/game.bak'
        Put $backup ''
        $file = [IO.File]::OpenWrite($backup)
        try { $file.SetLength(32MB) } finally { $file.Dispose() }
        $before = Snapshot $machine
        $report = Join-Path $root "$case.txt"
        $console = (& (Join-Path $tools 'dev/Audit-Leftovers.ps1') -Report $report -NoPause 6>&1 | Out-String)
        $text = [IO.File]::ReadAllText($report)
        $expectedGB = if ($case -eq 'missing') { '{0:n2}' -f 0 } else { '{0:n2}' -f (32MB / 1GB) }
        if ($case -eq 'missing') {
            Yes 'missing copy is reported and no unrelated folder is measured as the Steam copy' ($console -match 'missing:.*Steam copy|missing:.*Skyrim Special Edition' -and $text -notmatch 'DO NOT TOUCH')
        } else {
            Yes "$case copy is measured and marked DO NOT TOUCH" ($text -match ('(?m)^.*2 files\s+' + [regex]::Escape($game) + '\s+vanilla Steam copy\. DO NOT TOUCH'))
        }
        Yes "$case total includes only the installed copy" ($text.Contains("$expectedGB GB  in total across every folder"))
        Yes "$case leaves the fixture tree unchanged and reports no cleanup targets" ((Snapshot $machine) -ceq $before -and $text -match 'Clean-Leftovers -Go frees .* in 0 file\(s\)')
    }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
