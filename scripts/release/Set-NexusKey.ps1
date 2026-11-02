<#
  Set-NexusKey.ps1

  Puts Patrick's Nexus Mods API key on One, asked at a prompt and never shown,
  or says whether the key this machine has works (#2914).

      .\scripts\release\Set-NexusKey.ps1           ask for the key, check it, keep it
      .\scripts\release\Set-NexusKey.ps1 -Check    whether there is one and whether Nexus takes it
      .\scripts\release\Set-NexusKey.ps1 -ToEnvironment desk
                                                 puts One's key in the "desk" environment
                                                 on GitHub, for nexus-run.yml

  WHERE IT GOES. %LOCALAPPDATA%\Thornswood\Nexus\api-key.txt on this machine,
  the place Nexus.ps1 reads it from on One. The key is his own, from
  https://www.nexusmods.com/settings/api-keys (Personal API Key, at the bottom
  of that page).

  NOT IN A CLOUD SESSION (#2841, Patrick's answer A, 27 Oct 2026). The key
  left the default cloud environment: a cloud session runs these scripts
  through scripts\release\Nexus-Run.ps1, whose workflow (nexus-run.yml) has
  the key as the secret NEXUS_API_KEY of the GitHub environment "desk", which
  only main may use. -ToEnvironment desk puts it there from One, once the
  environment is there for main alone (Grant-BoxAccess.ps1 -Name desk -Deploy
  -MakeKey -ToEnvironment desk makes it), after checking the key works. The
  key goes to gh secret set on its standard input, never on a command line
  or into a file, and is never printed. In that workflow -Check checks the
  secret.

  THE CHECK asks Nexus which mods the key's account owns
  (GET /v3/team-mods?affiliation=owner) and says whether Thornswood Content
  (192001) and the Thornswood Client Runtime (192762) are among them, because
  a key that cannot see those two cannot upload to them. It prints the mods'
  names and never the key.

.PARAMETER Check
  Writes nothing. Says where the key was found and whether Nexus takes it.

.PARAMETER ToEnvironment
  Puts the key this machine has into the secret NEXUS_API_KEY of this GitHub
  environment, which must let main in and nothing else. desk, for
  nexus-run.yml.

.PARAMETER GitHubRepo
  The repository whose environment -ToEnvironment writes to.
  ThornswoodRP/Thornswood unless said otherwise.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [string]$ToEnvironment = '',
  [string]$GitHubRepo = 'ThornswoodRP/Thornswood',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Nexus.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

# The mods a key has to own, read from the scripts that upload to them.
$ours = @('192001', '192762')

function Test-Key {
  $a = $null
  try { $a = Invoke-NexusApi 'GET' '/v3/team-mods?affiliation=owner&page_size=100' '' 'Asking Nexus which mods this key owns' }
  catch { Die $_.Exception.Message }
  $mods = @(@(Get-NexusField (Get-NexusField $a 'data') 'mods') | Where-Object { $_ })
  $have = @{}
  foreach ($t in $mods) {
    $m = Get-NexusField $t 'mod'
    $have[[string](Get-NexusField $m 'game_scoped_id')] = [string](Get-NexusField $m 'name')
  }
  $missing = @($ours | Where-Object { -not $have.ContainsKey($_) })
  foreach ($id in $ours) {
    if ($have.ContainsKey($id)) { Say ('  owns ' + $id + ', ' + $have[$id]) 'Green' }
    else { Say ('  does not own ' + $id) 'Red' }
  }
  return ($missing.Count -eq 0)
}

Write-Host ''
Write-Host '  THORNSWOOD  -  the Nexus Mods API key' -ForegroundColor White
Write-Host ''

if ($Check) {
  try { [void](Read-NexusKey) } catch { Die $_.Exception.Message }
  Say ('  read from ' + $script:NexusKeyFrom + ', ' + $script:NexusKey.Length + ' characters')
  if (-not (Test-Key)) { Die 'Nexus takes the key, but its account does not own both of our mods, so uploads to them would be refused.' }
  Write-Host ''
  Say 'The key works for both mods.' 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

# One gh api read, as text: @{ Ok; Text }.
function Get-GitHub([string]$Path) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $o = @(& gh api $Path 2>&1 | ForEach-Object { "$_" })
  $c = $LASTEXITCODE
  $ErrorActionPreference = $old
  return @{ Ok = ($c -eq 0); Text = ($o -join "`n") }
}

if ($ToEnvironment) {
  if ($Check) { Die '-ToEnvironment checks the key itself; give it without -Check. Nothing was written.' }
  if ($ToEnvironment -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { Die '-ToEnvironment is one lower case word, the way the workflow names it: desk. Nothing was written.' }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die '-ToEnvironment puts the key on GitHub with gh, and gh is not on PATH. Nothing was written.' }
  try { [void](Read-NexusKey) } catch { Die $_.Exception.Message }
  Say ('  read from ' + $script:NexusKeyFrom + ', ' + $script:NexusKey.Length + ' characters')
  if (-not (Test-Key)) { Die 'Nexus takes the key, but its account does not own both of our mods, so it is not put on GitHub.' }
  # Main alone, or a branch's workflow could read it.
  $base = "repos/$GitHubRepo/environments/$ToEnvironment"
  $e = Get-GitHub $base
  if (-not $e.Ok) { Die ("GitHub has no environment $ToEnvironment on $GitHubRepo that gh here can read (" + $e.Text.Trim() + '). Grant-BoxAccess.ps1 -Name desk -Deploy -MakeKey -ToEnvironment desk makes it, for main alone. Nothing was written.') }
  $policy = ($e.Text | ConvertFrom-Json).deployment_branch_policy
  $names = @()
  if ($policy -and $policy.custom_branch_policies) {
    $l = Get-GitHub "$base/deployment-branch-policies"
    if (-not $l.Ok) { Die ("GitHub did not list the branches the environment $ToEnvironment lets in: " + $l.Text.Trim() + ' Nothing was written.') }
    $names = @(($l.Text | ConvertFrom-Json).branch_policies | ForEach-Object { [string]$_.name })
  }
  if (-not $policy -or -not $policy.custom_branch_policies -or $policy.protected_branches -or $names.Count -ne 1 -or $names[0] -ne 'main') {
    Die ("the environment $ToEnvironment on GitHub does not let in main alone, so a workflow on another branch could read the key. Grant-BoxAccess.ps1 -Name desk -Deploy -MakeKey -ToEnvironment desk sets it to main alone. Nothing was written.")
  }
  Say "  the GitHub environment $ToEnvironment lets in main alone" 'Green'
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $set = @($script:NexusKey | & gh secret set NEXUS_API_KEY --env $ToEnvironment --repo $GitHubRepo 2>&1 | ForEach-Object { "$_" })
  $c = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($c -ne 0) { Die ('gh secret set NEXUS_API_KEY refused: ' + (($set | Select-Object -Last 2) -join ' ')) }
  Write-Host ''
  Say ("NEXUS_API_KEY is in the environment $ToEnvironment, which only main may use. Nothing printed it. A cloud session checks it with: pwsh scripts/release/Nexus-Run.ps1 -Line 'Set-NexusKey'") 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

if (Test-NexusStandIn) { Die 'THORNSWOOD_NEXUS_STANDIN is set, and this keeps the real key; nothing was written.' }
$file = Get-NexusKeyFile
if (-not $file) { Die 'This machine has no %LOCALAPPDATA%, so there is no place for the key file. A cloud session holds no key: it runs the Nexus scripts through scripts/release/Nexus-Run.ps1.' }
Say '  Paste the Personal API Key from https://www.nexusmods.com/settings/api-keys.' 'DarkGray'
Say '  It is not shown while you paste it.' 'DarkGray'
Write-Host ''
$secure = Read-Host '  Nexus API key' -AsSecureString
$key = ([string](New-Object Net.NetworkCredential('', $secure)).Password).Trim()
if (-not $key) { Die 'Nothing was pasted, so nothing was written.' }
if ($key -match '\s') { Die 'What was pasted has a space or a line break inside it, so it is not one key. Nothing was written.' }

# Checked with the pasted key before it is kept, so a wrong paste never
# replaces a key that worked.
$script:NexusKey = $key
$script:NexusKeyFrom = 'the key just pasted'
if (-not (Test-Key)) { Die 'Nexus takes that key, but its account does not own both of our mods. Nothing was written.' }

$dir = Split-Path -Parent $file
New-Item -ItemType Directory -Force -Path $dir | Out-Null
[IO.File]::WriteAllText($file, $key, (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Say ('Kept in ' + $file + '. Send-NexusFile.ps1, Set-NexusDescription.ps1 and New-NexusRevision.ps1 read it from there.') 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
