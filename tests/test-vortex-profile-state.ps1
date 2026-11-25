param([string]$Scratch)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
if(-not $Scratch){$Scratch=Join-Path ([IO.Path]::GetTempPath()) ('thornswood-vortex-state-'+[guid]::NewGuid().ToString('N'))}
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
$python = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }
& $python (Join-Path $PSScriptRoot 'fixtures\vortex-profile-state.py') $Scratch
if($LASTEXITCODE){throw 'Fixture generation failed'}
. (Join-Path $repo 'scripts\mods\LoadOrder.ps1')
$oldAppData=$env:APPDATA
$count=0
function Check($case,$expected,$name='Thornswood',$throws=$false){
    $env:APPDATA=Join-Path $Scratch $case
    $got=$null; $didThrow=$false
    try{$got=Get-VortexProfileDir $name}catch{$didThrow=$true}
    if($didThrow -ne $throws -or (-not $throws -and (($expected -eq $null -and $got) -or ($expected -ne $null -and (Split-Path -Leaf $got) -ne $expected)))) {
        throw ('Profile check failed: '+$case)
    }
    $script:count++; Write-Host ('PASS '+$case)
}
try {
    Check 'compressed' 'active'
    Check 'renamed' $null
    Check 'deleted' $null
    Check 'different-game' $null
    Check 'duplicate' $null 'Thornswood' $true
    Check 'escaped' 'active' 'Thorns"wood'
    Check 'obsolete' $null
    Check 'corrupt' $null 'Thornswood' $true
    Check 'partial' $null 'Thornswood' $true
    Check 'fragmented' $null
    Check 'unknown-manifest' $null 'Thornswood' $true
    Check 'missing-manifest-fields' $null 'Thornswood' $true
    Check 'current-no-newline' $null 'Thornswood' $true
    Check 'duplicate-missing-list' $null 'Thornswood' $true
    Check 'invalid-kind' $null 'Thornswood' $true
    Check 'equal-conflict' $null 'Thornswood' $true
    Check 'equal-identical' 'active'
    Check 'short-header' $null 'Thornswood' $true
    Check 'interrupted' $null 'Thornswood' $true
    Check 'two-large-fragments' $null
    Check 'trailing-json' $null 'Thornswood' $true
    Check 'number-json' $null 'Thornswood' $true
    $locked=Join-Path $Scratch 'compressed\Vortex\state.v2\MANIFEST-000002'
    $handle=[IO.File]::Open($locked,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{Check 'compressed' $null 'Thornswood' $true}finally{$handle.Dispose()}
    # Run just the real caller statements, never Check-ShipReady or Ship itself.
    function Read-Statements($scriptName, $pattern) {
        $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "scripts/release/$scriptName.ps1"), [ref]$null, [ref]$null)
        $ast.FindAll({ param($node) $node -is [Management.Automation.Language.StatementAst] -and $node -isnot [Management.Automation.Language.CommandAst] -and $node.Extent.Text -match $pattern }, $true)
    }
    $ready = [scriptblock]::Create(((Read-Statements 'Check-ShipReady' '^(\$vpDir = \$null|\$vpWhy = ''''|try \{ \$vpDir = Assert-VortexProfile|Ready ''Vortex has a profile named Thornswood)') | ForEach-Object { $_.Extent.Text }) -join "`n")
    $ship = [scriptblock]::Create((Read-Statements 'Ship' '^\$twProfile = Assert-VortexProfile').Extent.Text + "`n" + '$twProfile')
    function Ready($label, $ok, $detail, $fix) { [pscustomobject]@{ Ok = $ok; Fix = $fix } }
    $failures = @()
    foreach ($row in @(
        @{ Case = 'duplicate'; Why = '^More than one Vortex profile has this name' },
        @{ Case = 'duplicate-missing-list'; Why = '^More than one Vortex profile has this name' },
        @{ Case = 'corrupt'; Why = '^Vortex profile metadata cannot be verified.*Do not create another profile' },
        @{ Case = 'renamed'; Why = "^Vortex profile 'Thornswood' was not found" },
        @{ Case = 'compressed'; Why = '' }
    )) {
        $env:APPDATA = Join-Path $Scratch $row.Case
        $report = & $ready
        $shipWhy = ''; $dir = $null
        try { $dir = & $ship } catch { $shipWhy = $_.Exception.Message }
        $ok = if ($row.Why) {
            $report -and -not $report.Ok -and $shipWhy -match $row.Why -and $report.Fix -eq $shipWhy
        } else {
            $report.Ok -and -not $shipWhy -and $dir -eq (Join-Path $env:APPDATA 'Vortex/skyrimse/profiles/active')
        }
        if ($ok) { $count++; Write-Host ('PASS both callers: ' + $row.Case) }
        else { $failures += "$($row.Case): readiness '$($report.Fix)', Ship '$shipWhy'" }
    }
    if ($failures.Count) { throw ($failures -join "`n") }
    # The cases above loaded VortexProfileState.cs through LoadOrder.ps1's
    # own Add-Type in this pwsh, as Deploy-Gamemode and Ship load it (#5968).
    Write-Host ($count.ToString()+' profile cases passed, with the file loaded by LoadOrder.ps1''s Add-Type')
} finally {$env:APPDATA=$oldAppData}
