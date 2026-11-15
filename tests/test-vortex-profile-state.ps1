param([string]$Scratch)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
if(-not $Scratch){$Scratch=Join-Path ([IO.Path]::GetTempPath()) ('thornswood-vortex-state-'+[guid]::NewGuid().ToString('N'))}
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
& python (Join-Path $PSScriptRoot 'fixtures\vortex-profile-state.py') $Scratch
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
    # The cases above loaded VortexProfileState.cs through LoadOrder.ps1's
    # own Add-Type in this pwsh, as Deploy-Gamemode and Ship load it (#5968).
    Write-Host ($count.ToString()+' profile cases passed, with the file loaded by LoadOrder.ps1''s Add-Type')
} finally {$env:APPDATA=$oldAppData}
