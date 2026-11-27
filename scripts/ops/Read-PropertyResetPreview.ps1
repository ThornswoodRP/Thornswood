<#
.SYNOPSIS
  Counts candidate property items in a stopped, held server's saved world.
.DESCRIPTION
  Counts only, for #7070. Does not stop/start services or change a world/private store.
  Ordinary use borrows an existing target hold and requires the game already stopped.
  The fixture route accepts only a nonce-bound disposable MongoDB data directory.
#>
#Requires -Version 7.0
[CmdletBinding(DefaultParameterSetName = 'Server')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Server')]
  [ValidateSet('main', 'dev')][string]$Server,
  [Parameter(Mandatory, ParameterSetName = 'Fixture')][string]$FixtureScope,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$Source,
  [ValidateRange(1, 200000)][int]$MaxForms = 100000,
  [string]$MongoShell = 'C:\Thornswood-Mongo\bin\mongosh.exe'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $repo 'scripts\deploy\ServerFolderTurn.ps1')
. (Join-Path $repo 'scripts\vps\ServerHold.ps1')
$turn = $null
$scratch = $null

function Test-PreviewProcessRoot([string]$Line, [string]$Root) {
  # Same exact path-boundary rule as Restore-Server; Main is not a prefix of Dev.
  $normalized = $Root.Replace('/', '\').TrimEnd('\')
  if (-not $normalized -or -not $Line) { return $false }
  $pattern = '(?:^|[\s"''])' + [regex]::Escape($normalized) + '(?=[\\\s"'']|$)'
  return [regex]::IsMatch($Line.Replace('/', '\'), $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function Assert-PreviewCounts($Result, [string]$ExpectedSource, [string]$Environment) {
  function ExactFields($Object, [string[]]$Names) {
    if ($null -eq $Object -or $Object -isnot [pscustomobject]) { throw 'Invalid preview shape' }
    $actual = @($Object.PSObject.Properties.Name)
    if ($actual.Count -ne $Names.Count -or @($actual | Where-Object { $_ -cnotin $Names }).Count) {
      throw 'Unexpected preview fields'
    }
  }
  ExactFields $Result @('environment', 'source', 'mode', 'blocked', 'coverage', 'counts')
  if ($Result.environment -cne $Environment -or $Result.source -cne $ExpectedSource -or
      $Result.mode -cne 'preview-only' -or $Result.blocked -isnot [bool] -or -not $Result.blocked) {
    throw 'Preview identity mismatch'
  }
  $coverage = @('world', 'propertyClaims', 'farmClaims', 'privateItems', 'protectedInstances', 'pendingTransfers')
  ExactFields $Result.coverage $coverage
  foreach ($name in $coverage) {
    if ($Result.coverage.$name -isnot [bool] -or ($name -ne 'world' -and $Result.coverage.$name)) {
      throw 'Unsupported preview coverage'
    }
  }
  $counts = @('forms', 'inventoryStacks', 'candidateStacks', 'candidateUnits', 'legacyNumericStacks',
    'legacyNumericUnits', 'runtimeStacks', 'dropCandidateStacks', 'dropCandidateUnits', 'staticTargetDrops',
    'wornCandidateStacks', 'equipmentCandidateStacks', 'malformedRecords', 'duplicateForms')
  ExactFields $Result.counts $counts
  foreach ($name in $counts) {
    $value = $Result.counts.$name
    if (($value -isnot [long] -and $value -isnot [int]) -or $value -lt 0 -or $value -gt 9007199254740991) {
      throw 'Invalid preview count'
    }
  }
}

function Assert-StoppedHeld {
  $task = Get-ScheduledTask -TaskName $script:taskName -ErrorAction Stop
  if ([string]$task.State -eq 'Running') { throw 'Target task is running' }
  $holdFile = Get-ThornswoodHoldFile -Target $script:taskName
  $hold = Get-Item -LiteralPath $holdFile -ErrorAction Stop
  $row = [IO.File]::ReadAllText($holdFile) | ConvertFrom-Json
  if ($row.target -cne $script:taskName -or -not $row.until) { throw 'Target hold cannot be verified' }
  $until = [DateTimeOffset]::FromUnixTimeSeconds([long]$row.until).UtcDateTime
  $maximum = $hold.LastWriteTimeUtc.AddMinutes(120)
  if ($until -gt $maximum) { $until = $maximum }
  if ([DateTime]::UtcNow -ge $until) { throw 'Target hold has expired' }
  $owned = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and
    ($_.Name -match '^(node|cmd|skymp5-server)(\.exe)?$') -and
    (Test-PreviewProcessRoot $_.CommandLine $script:serverRoot)
  })
  if ($owned.Count) { throw 'Target process or wrapper still exists' }
  if (@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object LocalPort -eq $script:gamePort).Count) {
    throw 'Target game port is held'
  }
}

try {
  if ((git -C $repo rev-parse HEAD) -cne $Source -or $LASTEXITCODE -ne 0) { throw 'Source does not match checkout' }
  $record = Get-Content -LiteralPath (Join-Path $repo 'records\mongodb.json') -Raw | ConvertFrom-Json
  $version = @(& $MongoShell --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or ($version -join '').Trim() -cne $record.shell.version) { throw 'Mongo shell version mismatch' }

  if ($PSCmdlet.ParameterSetName -eq 'Fixture') {
    $scope = Get-Content -LiteralPath $FixtureScope -Raw | ConvertFrom-Json
    if ($scope.kind -cne 'local-disposable-mongo-fixture' -or $scope.nonce -notmatch '^[a-f0-9]{16}$') {
      throw 'Fixture scope cannot be verified'
    }
    $plan = @{ version = 1; environment = 'fixture'; database = $scope.database;
      uriFile = (Join-Path $scope.root 'connection.uri'); maxForms = $MaxForms; source = $Source; fixtureRoot = $scope.root }
  } else {
    $changes = @(git -C $repo status --porcelain=v1 --untracked-files=normal)
    if ($LASTEXITCODE -ne 0 -or $changes.Count) { throw 'Ordinary preview requires a clean source checkout' }
    $script:serverRoot = if ($Server -eq 'dev') { 'C:\Thornswood-Server-Dev' } else { 'C:\Thornswood-Server' }
    $script:taskName = if ($Server -eq 'dev') { 'Thornswood Dev Server' } else { 'Thornswood Server' }
    $database = if ($Server -eq 'dev') { 'thornswood-dev' } else { 'thornswood-live' }
    $uriFile = if ($Server -eq 'dev') { 'C:\Thornswood-Mongo\access\dev.uri' } else { 'C:\Thornswood-Mongo\access\live.uri' }
    $turn = Enter-ThornswoodServerFolderTurn 'C:\Thornswood-Backup' ('property reset preview for ' + $Server) 30 { param($message) }
    if (-not $turn) { throw 'Server-folder turn is unavailable' }
    $settings = Get-Content -LiteralPath (Join-Path $script:serverRoot 'server-settings.json') -Raw | ConvertFrom-Json
    if ($settings.thornswoodServer -cne $Server -or $settings.databaseDriver -cne 'mongodb' -or
        $settings.databaseName -cne $database -or [IO.Path]::GetFullPath($settings.databaseUriFile) -ine $uriFile) {
      throw 'Environment binding mismatch'
    }
    $script:gamePort = [int]$settings.port
    if ($script:gamePort -lt 1024 -or $script:gamePort -gt 65535) { throw 'Target port cannot be verified' }
    Assert-StoppedHeld
    $plan = @{ version = 1; environment = $Server; database = $database; uriFile = $uriFile;
      maxForms = $MaxForms; source = $Source; fixtureRoot = '' }
  }

  $scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-reset-preview-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($scratch)
  $planFile = Join-Path $scratch 'plan.json'
  [IO.File]::WriteAllText($planFile, ($plan | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $info = [Diagnostics.ProcessStartInfo]::new($MongoShell)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in @('--nodb', '--quiet', '--eval')) { $info.ArgumentList.Add($argument) }
  $info.ArgumentList.Add('(async()=>{try{const r=await require(process.env.TW_PREVIEW_MODULE).run({Mongo,EJSON},process.env.TW_PREVIEW_PLAN);print(JSON.stringify(r));}catch(_){print("RESET PREVIEW FAILED");quit(1);}})();')
  $info.Environment['TW_PREVIEW_MODULE'] = Join-Path $PSScriptRoot 'PropertyResetMongoPreview.js'
  $info.Environment['TW_PREVIEW_PLAN'] = $planFile
  $info.Environment['MONGOSH_DISABLE_TELEMETRY'] = '1'
  $info.Environment['DO_NOT_TRACK'] = '1'
  $process = [Diagnostics.Process]::Start($info)
  try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(90000)) { $process.Kill($true); $process.WaitForExit(); throw 'Preview timed out' }
    if ($process.ExitCode -ne 0) { throw 'Mongo reader did not complete' }
    $result = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json
    [void]$stderr.GetAwaiter().GetResult()
    Assert-PreviewCounts $result $Source $plan.environment
    if ($PSCmdlet.ParameterSetName -eq 'Server') { Assert-StoppedHeld }
    $result | ConvertTo-Json -Depth 5 -Compress
  } finally { $process.Dispose() }
} catch {
  Write-Output 'RESET PREVIEW FAILED'
  exit 1
} finally {
  if ($turn) { $turn.Dispose() }
  if ($scratch -and (Test-Path -LiteralPath $scratch)) {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if ((Split-Path -Parent $resolved) -cne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
        (Split-Path -Leaf $resolved) -notmatch '^thornswood-reset-preview-[a-f0-9]{32}$') { throw 'Preview cleanup scope' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
