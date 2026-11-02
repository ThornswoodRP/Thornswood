<#
  Deploy-Release.ps1

  Puts one signed build Release on the dev server, the site or the Discord
  bot by its tag (#5180, the deploy gate verb that comes first, Patrick 31
  Oct 2026; the site and the bot since #5190 and #5187). The deploy agent
  on the box does the work (C:\Thornswood-Agent\thornswood-agent.exe deploy):
  it downloads the Release, holds manifest.cat to launcher\app\Signature.cs
  for the signer the agent was built with and the files to the signed
  manifest, and puts the gamemode in by the reload Deploy-DevGamemode.ps1
  uses (Reload.ps1, #3196), so nobody is dropped. When the new gamemode does
  not load, or the server stops answering its health address after it, the
  previous one goes back and has to load again.

      .\scripts\deploy\Deploy-Release.ps1 -Tag build-20261101.12
      .\scripts\deploy\Deploy-Release.ps1 -Tag build-20261101.12 -Environment site
      .\scripts\deploy\Deploy-Release.ps1 -Tag build-20261101.12 -Environment discord

  For the site and the bot the agent swaps the Release's site.zip or
  discord.zip in the way their Deployments do (tools\DeployAgent\App.cs):
  staged while it runs, stopped under a hold, swapped, started and asked,
  and put back when it does not answer.

  From a cloud thread, which has no ssh, the deploy gate runs it with main's
  script (scripts\vps\gate\verbs.json):

      pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-Release -Tag build-20261101.12'

  A ROLLBACK is this with the Release before: the gamemode reloads to it the
  same way, and the site or the bot gets that Release's files back. Not
  main: main waits on its own approval (#5181).

  WHAT IT LEAVES. The box's deploy record (data\thornswood-deploy.json,
  C:\Thornswood-Deploys\current\<part>.json and history.log, the shape
  Artifact.ps1 writes), the replaced files in the server folder's
  .prev-<stamp> (Deploy-DevGamemode.ps1 -PutBack puts them back), and the
  whole log as deploy-<tag>-<stamp>.log in the dev server's data folder,
  served on its resources port; the last line here names its address.

  WHAT IT NEEDS. The agent, installed by Install-DeployAgent (a gate verb).
  The Release is published by .github\workflows\merge-release.yml when a
  change to one of its parts reaches main. Reading a Release needs no token beyond the
  one the agent mints from the box admin App.

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads what is sent as
  ANSI.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [ValidateSet('dev', 'site', 'discord')][string]$Environment = 'dev',
    [string]$VpsHost = '',
    [string]$VpsUser = '',
    [string]$Root    = 'C:\Thornswood-Agent',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# The same rule the agent holds a tag to; checked here too so nothing is sent
# for a tag it would refuse.
if ($Tag -notmatch '^build-[A-Za-z0-9._-]{1,80}$') { Die "-Tag $Tag is not a build-<...> Release tag. Nothing was sent." }
if ($Root -notmatch '^[A-Za-z]:\\[A-Za-z0-9._\\-]+$') { Die "-Root $Root is not a plain folder on the box. Nothing was sent." }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
function Remote($script) { return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script }
$exe = $Root.TrimEnd('\') + '\thornswood-agent.exe'

Say "Deploying $Tag to $Environment through the deploy agent on $VpsHost..." Cyan
$out = @(Remote @"
if (-not (Test-Path -LiteralPath '$exe')) { 'NOT INSTALLED: there is no $exe; run the Install-DeployAgent verb first'; exit 1 }
& '$exe' deploy --environment '$Environment' --tag '$Tag' 2>&1 | ForEach-Object { "`$_" }
if (`$LASTEXITCODE -eq 0) { 'DEPLOYED: $Tag runs on $Environment' } else { 'NOT DEPLOYED: the agent ended with ' + `$LASTEXITCODE + '; the lines above say why' }
"@)
foreach ($l in $out) { Say ("  $l") }
if ($out -match '^DEPLOYED: ') { Say "$Tag is on $Environment." Green; exit 0 }
Die "$Tag is not on $Environment; the lines above say why."
