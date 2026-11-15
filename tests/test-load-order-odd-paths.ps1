<#
  test-load-order-odd-paths.ps1

      pwsh -NoProfile -File .\tests\test-load-order-odd-paths.ps1

  The load order and collection scripts on folders whose names PowerShell
  reads as wildcards or that cmd treats specially: [ ], & and spaces, as in a
  Vortex staging folder, a game folder, a user profile or a clone. A -Path
  where -LiteralPath belongs reads nothing at such a path, silently (the
  Setup-Thornswood.ps1 break Anvil found). Covered here:
    - Get-CollectionExportArchive and Get-CollectionJsonPath on a staging folder
      there
    - LoadOrder.ps1's Import-VortexStateReader compiling the shared reader from
      a clone there (Add-Type -LiteralPath)
    - Check-Plugins.ps1 reading a live plugins.txt under a LOCALAPPDATA there
  All in a scratch folder; no Vortex, no VPS, no network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Child([string]$cmd) {
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
function Lines([string]$path, [string[]]$lines) { [IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false))) }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-odd-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\[Thornswood] A & B')
try {
    [void][IO.Directory]::CreateDirectory($T)
    Yes 'the scratch folder has [ ], & and a space in its name' ([IO.Directory]::Exists($T) -and $T -match '\[' -and $T -match '&')

    # ---- the collection's export archive ----------------------------------------
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $staging = Join-Path $T 'staging [7essxf] & co'
    [void][IO.Directory]::CreateDirectory((Join-Path $staging 'export'))
    $zip = Join-Path $staging 'export\collection [rev 3].zip'
    $z = [IO.Compression.ZipFile]::Open($zip, 'Create')
    try { $w = New-Object IO.StreamWriter($z.CreateEntry('collection.json').Open()); $w.Write('{"rev":3}'); $w.Dispose() } finally { $z.Dispose() }
    $lo = Join-Path $Repo 'scripts\mods\LoadOrder.ps1'
    $r = Child (". " + (Q $lo) + "; `$a = @(Get-CollectionExportArchive " + (Q $staging) + "); 'COUNT=' + `$a.Count; `$j = Get-CollectionJsonPath " + (Q $staging) + "; if (`$j) { 'JSON=' + [IO.File]::ReadAllText(`$j); Remove-Item -LiteralPath (Split-Path -Parent `$j) -Recurse -Force }")
    Yes 'the export archive in such a staging folder is found' ($r.Out -match 'COUNT=1')
    Yes '  and its collection.json read' ($r.Out -match 'JSON=\{"rev":3\}')

    # ---- the shared Vortex state reader, from a clone in such a folder -----------
    $clone = Join-Path $T 'clone [x]'
    [void][IO.Directory]::CreateDirectory((Join-Path $clone 'scripts\mods'))
    [void][IO.Directory]::CreateDirectory((Join-Path $clone 'launcher\app'))
    [IO.File]::Copy($lo, (Join-Path $clone 'scripts\mods\LoadOrder.ps1'))
    [IO.File]::Copy((Join-Path $Repo 'launcher\app\VortexProfileState.cs'), (Join-Path $clone 'launcher\app\VortexProfileState.cs'))
    $r = Child (". " + (Q (Join-Path $clone 'scripts\mods\LoadOrder.ps1')) + "; Import-VortexStateReader; 'TYPE=' + [bool]('Thornswood.VortexProfileState' -as [type])")
    Yes 'the shared Vortex state reader compiles from a clone in such a folder' ($r.Out -match 'TYPE=True')

    # ---- Check-Plugins.ps1 under such a LOCALAPPDATA ------------------------------
    $lad = Join-Path $T 'AppData [me]\Local'
    [void][IO.Directory]::CreateDirectory((Join-Path $lad 'Skyrim Special Edition'))
    Lines (Join-Path $lad 'Skyrim Special Edition\plugins.txt') @('*A.esp', '*B.esp', 'C.esp')
    $r = Child ("`$env:LOCALAPPDATA = " + (Q $lad) + "; & " + (Q (Join-Path $Repo 'scripts\mods\Check-Plugins.ps1')))
    Yes 'Check-Plugins reads a live plugins.txt under such a LOCALAPPDATA (2 enabled)' ($r.Out -match 'live\s+:\s+2\s')
}
finally {
    Remove-Item -LiteralPath (Split-Path -Parent $T) -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }