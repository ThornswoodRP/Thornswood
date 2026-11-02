<#
  Sign-OnRunner.ps1

  Signs files with ThornswoodRelease on GitHub's Windows runner, in a run of
  main's own workflow, and holds each to the launcher's own check before it
  says yes (#5180). Two workflows use it: deploy-agent.yml for the agent
  program and its catalog, and merge-release.yml for the launcher, the
  Velopack packages' files and each Release's catalog (#5179).

      pwsh -File scripts/release/Sign-OnRunner.ps1 -Path <file> [-Path <file> ...]

  HOW IT SIGNS. The way release.yml signs the launcher (its header, HOW IT
  SIGNS, #2163 section 8): Microsoft's signing client at the version and
  sha256 Setup-ShipMachine.ps1 pins, lifted out of it by the parser so the pin
  lives in one place; signing.json from the tracked template; a federated
  (OIDC) token GitHub mints for this job in the "release" environment, kept in
  a file under RUNNER_TEMP for the length of the signing and removed after.
  No secret is stored anywhere. Sign-Artifact.ps1 -Required does the signing.

  WHAT IT HOLDS EACH FILE TO. Get-PublishSignRefusal (Assert-PublishSigned.ps1):
  Authenticode Valid, the Subject naming ExpectedSigner from
  launcher\app\Updater.cs, and launcher\app\Signature.cs passing, which is
  the same check the agent makes on the box before it applies anything.

  WHAT IT REFUSES. A run that is not on GitHub's runner, not a run on main
  (only main's workflow may sign, #3930), or has no OIDC token to ask for.
  Exit 0 when every file is signed and passes, 1 otherwise, with why.

  Keep it ASCII.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string[]]$Path)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (-not $env:GITHUB_ACTIONS) { Write-Host '::error::Sign-OnRunner.ps1 signs on GitHub''s runner only'; exit 1 }
if ($env:GITHUB_REF -ne 'refs/heads/main') { Write-Host "::error::only a run on main signs (#3930); this run is on $($env:GITHUB_REF)"; exit 1 }
if (-not $env:AZURE_CLIENT_ID -or -not $env:AZURE_TENANT_ID) { Write-Host '::error::the AZURE_SIGNING_CLIENT_ID and AZURE_SIGNING_TENANT_ID repository variables are not set'; exit 1 }
if (-not $env:ACTIONS_ID_TOKEN_REQUEST_URL -or -not $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) { Write-Host '::error::GitHub gave this job no OIDC token to ask for (id-token: write and the release environment)'; exit 1 }
foreach ($p in $Path) { if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Write-Host "::error::there is no file at $p to sign"; exit 1 } }

# The signing client, at the pin Setup-ShipMachine.ps1 holds.
$src = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Setup-ShipMachine.ps1'))
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$t, [ref]$e)
foreach ($name in 'Get-SigningClientPin', 'Get-Sha256', 'Save-Url', 'Save-SigningClient') {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { Write-Host "::error::Setup-ShipMachine.ps1 has no $name"; exit 1 }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$why = Save-SigningClient $repo (Get-SigningClientPin) ${function:Save-Url} (Join-Path $env:RUNNER_TEMP 'signing-client')
if ($why) { Write-Host ('::error::' + $why); exit 1 }
$cfg = Join-Path $repo 'records\signing\signing.json'
Copy-Item -LiteralPath (Join-Path $repo 'records\signing\signing.template.json') -Destination $cfg -Force

. (Join-Path $repo 'scripts\release\Assert-PublishSigned.ps1')
$expected = Get-ExpectedSignerFragment -RepoRoot $repo

$tokenFile = Join-Path $env:RUNNER_TEMP 'azure-federated-token'
$rc = 0
try {
  $answer = Invoke-RestMethod -Uri ($env:ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=api://AzureADTokenExchange') -Headers @{ Authorization = ('bearer ' + $env:ACTIONS_ID_TOKEN_REQUEST_TOKEN) } -ErrorAction Stop
  if (-not $answer.value) { Write-Host '::error::GitHub answered the OIDC request with no token'; exit 1 }
  Write-Host ('::add-mask::' + $answer.value)
  [IO.File]::WriteAllText($tokenFile, [string]$answer.value)
  $env:AZURE_FEDERATED_TOKEN_FILE = $tokenFile
  foreach ($p in $Path) {
    & (Join-Path $repo 'scripts\release\Sign-Artifact.ps1') -Path $p -Required
    if ($LASTEXITCODE -ne 0) { Write-Host "::error::signing $p failed"; $rc = 1; break }
  }
} finally {
  Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\AZURE_FEDERATED_TOKEN_FILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $cfg -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $repo 'records\signing\client') -Recurse -Force -ErrorAction SilentlyContinue
}
if ($rc -ne 0) { exit 1 }

foreach ($p in $Path) {
  $refusal = Get-PublishSignRefusal -Path $p -ExpectedSigner $expected
  if ($refusal) { Write-Host ('::error::' + $refusal); exit 1 }
  Write-Host ('signed and accepted by the launcher''s own check: ' + (Split-Path -Leaf $p))
}
exit 0
