<#
  One-time migration for #6466, after the Owner requested all Dev gameplay
  policies on Main. Only Bramble runs this live gate verb on its normal,
  one-use Main card naming the exact merged commit and line:

      Stage-MainGameplayPolicies -Build <full main commit>

  Sets only load-order refusal and the placed mannequin NPC exclusion.
  Stages the file atomically, keeping its original as .before-6466, without
  stopping, starting or reloading anything. Run immediately before the
  furniture Main promotion so that release's announced restart consumes it.
  The server folders' shared turn excludes a simultaneous deployment or
  backup. A different release/source engine or unexpected policy refuses.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'MainGameplayPolicies.ps1')
. (Join-Path $PSScriptRoot '../deploy/ServerFolderTurn.ps1')
$backupRoot = 'C:\Thornswood-Backup'
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) { throw 'The shared server-folder turn is unavailable. Nothing changed.' }
$turn = Enter-ThornswoodServerFolderTurn $backupRoot 'Stage-MainGameplayPolicies #6466' 0 { param($m) Write-Host $m }
try {
    $record = Get-Content -LiteralPath 'C:\Thornswood-Deploys\current\thornswood-server.json' -Raw | ConvertFrom-Json
    Assert-ThornswoodMainPolicyDeployment $record
    $result = Invoke-ThornswoodMainGameplayPolicies 'C:\Thornswood-Server'
    Write-Host ("Main gameplay policies: $result. No process was restarted or reloaded.")
} finally { if ($null -ne $turn) { $turn.Dispose() } }
