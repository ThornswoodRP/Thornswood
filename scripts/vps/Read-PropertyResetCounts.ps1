<#
.SYNOPSIS
  Runs the source-pinned property-item count preview for the gate's fixed target.
.DESCRIPTION
  The gate fixes the target and checkout. No caller-selected paths are forwarded.
#>
#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('dev', 'main')][string]$Server)

$ErrorActionPreference = 'Stop'
try {
    if ($env:THORNSWOOD_GATE -cne '1') { throw 'The deployment gate is required' }
    $repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    # The broker has already held this checkout to the approved -Build value.
    $source = @(git -C $repo rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $source.Count -ne 1 -or $source[0] -cnotmatch '^[0-9a-f]{40}$') {
        throw 'Source does not match the gate checkout'
    }
    & (Join-Path $repo 'scripts/ops/Read-PropertyResetPreview.ps1') -Server $Server -Source $source[0]
    exit $LASTEXITCODE
} catch {
    Write-Output 'RESET PREVIEW FAILED'
    exit 1
}
