#Requires -Version 7.0
# Parse only the pure guards: never execute the host reader or inspect a server.
$ErrorActionPreference = 'Stop'
$reader = Join-Path $PSScriptRoot '..\ops\Read-PropertyResetPreview.ps1'
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($reader, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Reader parse failed' }
foreach ($name in @('Test-PreviewProcessRoot', 'Assert-PreviewCounts', 'Assert-StoppedHeld')) {
  $definition = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  if (-not $definition) { throw ('Missing guard: ' + $name) }
  . ([scriptblock]::Create($definition.Extent.Text))
}

$passed = 0
function Check([bool]$condition, [string]$name) {
  if (-not $condition) { throw $name }
  $script:passed++
  Write-Output ('PASS ' + $name)
}
function Refuses($value) {
  try { Assert-PreviewCounts $value ('a' * 40) 'fixture'; return $false } catch { return $true }
}

Check (Test-PreviewProcessRoot 'node "C:\Thornswood-Server\server.js"' 'C:\Thornswood-Server') 'exact Main child matches'
Check (Test-PreviewProcessRoot 'cmd /c C:/Thornswood-Server-Dev/start.bat' 'C:\Thornswood-Server-Dev') 'slash Dev child matches'
Check (-not (Test-PreviewProcessRoot 'node C:\Thornswood-Server-Dev\server.js' 'C:\Thornswood-Server')) 'Main never absorbs Dev prefix'
Check (-not (Test-PreviewProcessRoot 'node D:\copyC:\Thornswood-Server\server.js' 'C:\Thornswood-Server')) 'embedded root never matches'

$countNames = @('forms', 'inventoryStacks', 'candidateStacks', 'candidateUnits', 'legacyNumericStacks',
  'legacyNumericUnits', 'runtimeStacks', 'dropCandidateStacks', 'dropCandidateUnits', 'staticTargetDrops',
  'wornCandidateStacks', 'equipmentCandidateStacks', 'malformedRecords', 'duplicateForms')
$counts = @{}
foreach ($name in $countNames) { $counts[$name] = 0 }
$result = @{ environment = 'fixture'; source = 'a' * 40; mode = 'preview-only'; blocked = $true;
  coverage = @{ world = $true; propertyClaims = $false; farmClaims = $false; privateItems = $false;
    protectedInstances = $false; pendingTransfers = $false }; counts = $counts } | ConvertTo-Json -Depth 5 | ConvertFrom-Json
Assert-PreviewCounts $result ('a' * 40) 'fixture'
Check $true 'exact counts-only shape accepted'
$extra = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$extra | Add-Member privateRows @('PRIVATE')
Check (Refuses $extra) 'extra private result field refused'
$extra = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$extra.counts | Add-Member names @('PRIVATE')
Check (Refuses $extra) 'extra count field refused'
$extra = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$extra.counts.forms = 0.5
Check (Refuses $extra) 'fractional count refused'
$extra = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$extra.coverage.privateItems = $true
Check (Refuses $extra) 'unsupported coverage cannot be claimed'
$extra = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$extra.environment = 'dev'
Check (Refuses $extra) 'environment substitution refused'

# Function stubs keep all task/process/hold/port observations synthetic.
$script:taskName = 'fixture task'
$script:serverRoot = 'C:\Thornswood-Server'
$script:gamePort = 12345
$script:fixtureState = 'Ready'
$script:fixtureUntil = [DateTimeOffset]::UtcNow.AddMinutes(10).ToUnixTimeSeconds()
$script:fixtureModified = [DateTime]::UtcNow
$script:fixtureProcesses = @()
$script:fixturePorts = @()
function Get-ScheduledTask { [pscustomobject]@{ State = $script:fixtureState } }
function Get-ThornswoodHoldFile { return 'fixture-only hold path' }
function Get-Item { [pscustomobject]@{ LastWriteTimeUtc = $script:fixtureModified } }
# The guard's one direct file-read seam is replaced in the parsed AST for these tests.
$holdGuard = $ast.Find({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-StoppedHeld'
}, $true).Extent.Text
$holdGuard = $holdGuard.Replace('[IO.File]::ReadAllText($holdFile)', 'Read-FixtureHold')
. ([scriptblock]::Create($holdGuard))
function Read-FixtureHold { @{ target = $script:taskName; until = $script:fixtureUntil } | ConvertTo-Json -Compress }
function Get-CimInstance { $script:fixtureProcesses }
function Get-NetUDPEndpoint { $script:fixturePorts }
function HoldRefuses { try { Assert-StoppedHeld; return $false } catch { return $true } }
Assert-StoppedHeld
Check $true 'already stopped and held accepted using synthetic observations'
$script:fixtureState = 'Running'
Check (HoldRefuses) 'running target refused'
$script:fixtureState = 'Ready'
$script:fixtureUntil = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToUnixTimeSeconds()
Check (HoldRefuses) 'expired hold refused'
$script:fixtureUntil = [DateTimeOffset]::UtcNow.AddMinutes(10).ToUnixTimeSeconds()
$script:fixtureModified = [DateTime]::UtcNow.AddMinutes(-121)
Check (HoldRefuses) 'watchdog maximum hold age enforced'
$script:fixtureModified = [DateTime]::UtcNow
$script:fixtureProcesses = @([pscustomobject]@{ ProcessId = -1; Name = 'node.exe'; CommandLine = 'node C:\Thornswood-Server-Dev\server.js' })
Assert-StoppedHeld
Check $true 'other environment process does not block target'
$script:fixtureProcesses[0].CommandLine = 'node C:\Thornswood-Server\server.js'
Check (HoldRefuses) 'target wrapper refused'
$script:fixtureProcesses = @()
$script:fixturePorts = @([pscustomobject]@{ LocalPort = 12345 })
Check (HoldRefuses) 'held game port refused'
Write-Output ($passed.ToString() + ' passed, 0 failed; no host or data access')
