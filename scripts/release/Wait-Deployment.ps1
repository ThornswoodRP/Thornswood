<#
  Wait-Deployment.ps1

      pwsh scripts/release/Wait-Deployment.ps1 -Repo ThornswoodRP/Thornswood -Id 7648693742 [-Id ...] [-Minutes 15]

  A release counts as shipped only when the box says it is running it. Holds
  each Deployment named to the box deploy agent's status on it, and ends 0
  only when every one is "success" (or "inactive": the agent applied a newer
  Deployment of that environment instead, tools/DeployAgent/Agent.cs).
  "failure" or "error" ends 1 with the agent's own words, and so does a
  Deployment that still has no status from the agent after -Minutes.

  WHY (9 Nov 2026). promote-main.yml made a Deployment to Main and finished
  green, and so did merge-release.yml with its Deployment to Dev, whatever the
  box did next. The agent's agent.json named dev, site and discord and never
  main (#5181 said "Done when ... Install-DeployAgent -Main has run on the
  box", and it had not), so the Main Deployments of build-20261108.5,
  build-1.3.0 and build-1.3.4 sat with no status at all: the live server
  never took them, #news never heard of them, and every run said success.
  The agent marks a Deployment within about a minute of seeing it (dev took
  build-1.3.4 in 79 s), so silence past -Minutes means nobody on the box is
  looking after that environment.

  Read only: it asks GitHub through gh, signed in with GH_TOKEN.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][long[]]$Id,
    [int]$Minutes = 15,
    [int]$EverySeconds = 15
)

$ErrorActionPreference = 'Stop'

# The newest status on a Deployment, by the agent or anybody: $null while
# there is none. GitHub lists statuses newest first.
function Get-DeploymentState([string]$Repo, [long]$Id) {
    $raw = gh api "repos/$Repo/deployments/$Id/statuses?per_page=1"
    if ($LASTEXITCODE -ne 0) { throw "GitHub would not list the statuses of deployment $Id" }
    $list = @(($raw -join "`n") | ConvertFrom-Json)
    if ($list.Count -eq 0 -or $null -eq $list[0]) { return $null }
    return [pscustomobject]@{ State = [string]$list[0].state; Description = [string]$list[0].description; By = [string]$list[0].creator.login }
}

$until = (Get-Date).AddMinutes($Minutes)
$left = [System.Collections.Generic.List[long]]::new()
foreach ($d in $Id) { $left.Add($d) }
$bad = 0
while ($left.Count -gt 0) {
    foreach ($d in @($left)) {
        $s = Get-DeploymentState $Repo $d
        if ($null -eq $s -or $s.State -in @('queued', 'pending', 'in_progress', 'waiting')) { continue }
        [void]$left.Remove($d)
        switch ($s.State) {
            'success'  { Write-Host "deployment ${d}: success by $($s.By): $($s.Description)" }
            'inactive' { Write-Host "deployment ${d}: inactive by $($s.By), a newer one of its environment was applied instead: $($s.Description)" }
            default    { $bad++; Write-Host "::error::deployment ${d}: $($s.State) by $($s.By): $($s.Description)" }
        }
    }
    if ($left.Count -eq 0) { break }
    if ((Get-Date) -ge $until) {
        foreach ($d in $left) {
            $s = Get-DeploymentState $Repo $d
            $now = if ($null -eq $s) { 'no status at all' } else { "only ""$($s.State)"" ($($s.Description))" }
            Write-Host "::error::deployment ${d} has $now after $Minutes minutes: the box deploy agent is not looking after its environment (C:\Thornswood-Agent\agent.json), or it is not running. scripts\deploy\Install-DeployAgent.ps1 -Status says what the box sees."
        }
        $bad += $left.Count
        break
    }
    Start-Sleep -Seconds $EverySeconds
}
if ($bad -gt 0) { exit 1 }
exit 0
