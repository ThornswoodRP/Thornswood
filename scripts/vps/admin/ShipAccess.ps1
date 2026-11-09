<#
  ShipAccess.ps1

  Get-ThornswoodShipAccess: the box admin App's token for one release step
  through the deploy gate (#2841), from scripts\vps\admin\ship-access.js:
  Actions write on the engine fork and Thornswood, Contents read on
  Thornswood, ended by GitHub within the hour. Dot-sourced by the gate's
  box scripts that reach GitHub through gh: Ship-OnBox.ps1 (the Ship signs
  in the fork) and Publish-ServerOnBox.ps1 (CI's engine build of the pin
  comes from the fork's artifacts). The caller hands it to gh through
  GH_TOKEN for that run alone and removes it after.

      . scripts\vps\admin\ShipAccess.ps1
      $token = Get-ThornswoodShipAccess -Repo $repo -AdminState 'C:\Thornswood-Admin\state'

  It returns the token, or throws with what ship-access.js said; nothing of
  the App's key is ever in what it returns or throws.

  Get-ThornswoodOpsAccess: the same App's token for one change to the ops
  repository, from scripts\vps\admin\ops-access.js (#2862): -For runners
  (Administration write, for Install-Runner.ps1 -FromGate) or -For keys
  (Environments write and Actions read, for Renew-BoxKey.ps1). Taken and
  handed over the same way.

      $token = Get-ThornswoodOpsAccess -Repo $repo -For keys
#>
function Invoke-ThornswoodAppMinter {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @(),
        [string]$AdminState = 'C:\Thornswood-Admin\state'
    )
    $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { throw 'there is no node on this machine to mint the App''s token with.' }
    $had = $env:THORNSWOOD_ADMIN_STATE
    $env:THORNSWOOD_ADMIN_STATE = $AdminState
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = 0
        $minted = @(& $node.Source ([IO.Path]::Combine($Repo, 'scripts', 'vps', 'admin', $Script)) @Arguments 2>&1)
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $was
        if ($null -eq $had) { Remove-Item -LiteralPath Env:\THORNSWOOD_ADMIN_STATE -ErrorAction SilentlyContinue } else { $env:THORNSWOOD_ADMIN_STATE = $had }
    }
    # The minter prints the token alone on its standard output and
    # everything else on its standard error, so the two are told apart by the
    # stream, never by the token's shape, which is GitHub's to change.
    $said = @($minted | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    $out = @($minted | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if ($code -ne 0) { throw ($Script + ' ended ' + $code + $(if ($said.Count) { ': ' + ($said -join ' ') } else { ' and said nothing' })) }
    if ($out.Count -ne 1 -or $out[0] -match '\s') { throw ($Script + ' ended 0 but printed ' + $out.Count + ' line(s) where one token belongs' + $(if ($said.Count) { '; it said: ' + ($said -join ' ') } else { '' })) }
    return $out[0]
}

function Get-ThornswoodShipAccess {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [string]$AdminState = 'C:\Thornswood-Admin\state'
    )
    return (Invoke-ThornswoodAppMinter -Repo $Repo -Script 'ship-access.js' -AdminState $AdminState)
}

function Get-ThornswoodOpsAccess {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][ValidateSet('runners', 'keys')][string]$For,
        [string]$AdminState = 'C:\Thornswood-Admin\state'
    )
    return (Invoke-ThornswoodAppMinter -Repo $Repo -Script 'ops-access.js' -Arguments @($For) -AdminState $AdminState)
}
