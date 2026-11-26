<#
  #6932. Drive the actual compiler helper with a small stand-in executable:
  markers identify a build before it returns, without changing its result,
  refusal, cache or compiler arguments. No SDK or package download is needed.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$condition) {
    if ($condition) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}
$area = Join-Path ([IO.Path]::GetTempPath()) ('ts-6932-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $area 'tests'))
[void][IO.Directory]::CreateDirectory((Join-Path $area 'launcher/app'))
try {
    foreach ($file in 'Launcher-Csc.ps1', 'Windows.ps1') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $area ('tests/' + $file))
    }
    [IO.File]::WriteAllText((Join-Path $area 'launcher/app/Thornswood.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><LangVersion>latest</LangVersion><OutputType>WinExe</OutputType></PropertyGroup><ItemGroup><EmbeddedResource Include="resource.json"><LogicalName>project.json</LogicalName></EmbeddedResource></ItemGroup></Project>')
    [IO.File]::WriteAllText((Join-Path $area 'launcher/app/resource.json'), 'private-project-resource')
    $fake = Join-Path $area 'fake-dotnet.ps1'
    [IO.File]::WriteAllText($fake, @'
$project = [xml][IO.File]::ReadAllText($args[1])
$bin = $args[[Array]::IndexOf($args, '-o') + 1]
$sourceFile = Join-Path (Split-Path -Parent $args[1]) 'source0.cs'
$source = if (Test-Path -LiteralPath $sourceFile) { [IO.File]::ReadAllText($sourceFile) } else { '' }
if ($source -eq 'reject-private-source') {
    Write-Output 'compiler stdout refusal'
    Write-Error 'compiler stderr refusal' -ErrorAction Continue
    $global:LASTEXITCODE = 9
    return
}
[void][IO.Directory]::CreateDirectory($bin)
$assembly = $project.SelectSingleNode('//AssemblyName')
$assemblyName = if ($assembly) { $assembly.InnerText } else { 'Thornswood' }
[IO.File]::WriteAllText((Join-Path $bin ($assemblyName + '.dll')), 'stand-in assembly')
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $args[1]) '..' 'last-arguments.json'), (ConvertTo-Json -InputObject @($args) -Compress))
$global:LASTEXITCODE = 0
'@)
    . (Join-Path $area 'tests/Launcher-Csc.ps1')
    $LauncherDotnet = $fake
    $resource = Join-Path $area 'private-resource.txt'
    [IO.File]::WriteAllText($resource, 'private-resource-contents')
    $records = @(& { Build-LauncherCode -Source 'private-source' -Exe -Main 'Driver.Main' -Resource @{ 'sample.json' = $resource } -Property @{ GenerateAssemblyInfo = 'false'; langversion = 'preview'; OtherProperty = 'private-property-value' } } 6>&1)
    $values = @($records | Where-Object { $_ -isnot [Management.Automation.InformationRecord] })
    $markers = @($records | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('LAUNCHER_BUILD ') } | ForEach-Object { $_.ToString().Substring(15) | ConvertFrom-Json })
    Yes 'diagnostic output does not add values to the returned assembly path' ($values.Count -eq 1 -and (Test-Path -LiteralPath $values[0]))
    Yes 'the actual helper marks invocation start and compiler exit' ($markers.Count -eq 2 -and $markers[0].stage -eq 'compile-start' -and $markers[1].stage -eq 'compile-exit')
    if ($markers.Count -eq 2) {
        Yes 'both events identify the same input key and selected executable' ($markers[0].key -match '^[0-9a-f]{24}$' -and $markers[0].key -eq $markers[1].key -and $markers[0].dotnet -eq $fake)
        Yes 'final project options include the caller version override' ($markers[0].options.GenerateAssemblyInfo -eq 'false' -and $markers[0].options.LangVersion -eq 'preview' -and $markers[0].options.TargetFramework -eq 'net10.0' -and $markers[0].options.OutputType -eq 'Exe' -and $markers[0].options.StartupObject -eq 'Driver.Main')
        Yes 'resources are identified by logical name' (@($markers[0].resources).Count -eq 1 -and $markers[0].resources[0] -eq 'sample.json')
        Yes 'the compiler exit code is recorded without changing success' ($markers[1].exitCode -eq 0)
    }
    $diagnostics = ($records | Where-Object { $_ -is [Management.Automation.InformationRecord] }) -join "`n"
    Yes 'markers omit source resource contents and unrelated property values' ($diagnostics -notmatch 'private-source|private-resource-contents|private-property-value')
    $arguments = @(Get-Content -LiteralPath (Join-Path $area 'out/harness/last-arguments.json') -Raw | ConvertFrom-Json)
    Yes 'existing build-server and captured-error flags reach the compiler stand-in' ($arguments -contains '--disable-build-servers' -and $arguments -contains '-nologo' -and $arguments -contains '-clp:NoSummary;ErrorsOnly')
    $cached = @(& { Build-LauncherCode -Source 'private-source' -Exe -Main 'Driver.Main' -Resource @{ 'sample.json' = $resource } -Property @{ GenerateAssemblyInfo = 'false'; langversion = 'preview'; OtherProperty = 'private-property-value' } } 6>&1)
    $cacheMarkers = @($cached | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('LAUNCHER_BUILD ') } | ForEach-Object { $_.ToString().Substring(15) | ConvertFrom-Json })
    Yes 'a cache hit is distinct from an active compiler invocation' ($cacheMarkers.Count -eq 1 -and $cacheMarkers[0].stage -eq 'cache-hit')
    $refusal = ''
    $rejected = @(& { try { Build-LauncherCode -Source 'reject-private-source' } catch { $script:refusal = $_.Exception.Message } } 6>&1)
    $rejectMarkers = @($rejected | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('LAUNCHER_BUILD ') } | ForEach-Object { $_.ToString().Substring(15) | ConvertFrom-Json })
    Yes 'compiler refusal preserves both captured output streams and the throw' ($refusal -match 'compiler stdout refusal' -and $refusal -match 'compiler stderr refusal' -and $refusal -match 'SDK refused')
    Yes 'refusal has start and nonzero exit markers' ($rejectMarkers.Count -eq 2 -and $rejectMarkers[0].stage -eq 'compile-start' -and $rejectMarkers[1].stage -eq 'compile-exit' -and $rejectMarkers[1].exitCode -eq 9)
    if ($rejectMarkers.Count -eq 2 -and $markers.Count -eq 2) {
        Yes 'different version options and sources have different invocation keys' ($rejectMarkers[0].key -ne $markers[0].key -and $rejectMarkers[0].options.GenerateAssemblyInfo -eq 'SDK default')
    }
    $projectRecords = @(& { Build-LauncherProject } 6>&1)
    $projectMarkers = @($projectRecords | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('LAUNCHER_BUILD ') } | ForEach-Object { $_.ToString().Substring(15) | ConvertFrom-Json })
    $projectValues = @($projectRecords | Where-Object { $_ -isnot [Management.Automation.InformationRecord] })
    Yes 'whole-project build still returns only its existing assembly path' ($projectValues.Count -eq 1 -and (Split-Path -Leaf $projectValues[0]) -eq 'Thornswood.dll' -and (Test-Path -LiteralPath $projectValues[0]))
    Yes 'whole-project invocation has its own start and exit identity' ($projectMarkers.Count -eq 2 -and $projectMarkers[0].kind -eq 'project' -and $projectMarkers[0].stage -eq 'compile-start' -and $projectMarkers[1].stage -eq 'compile-exit' -and $projectMarkers[1].exitCode -eq 0)
    Yes 'whole-project resource metadata uses the project LogicalName element' ($projectMarkers.Count -eq 2 -and @($projectMarkers[0].resources).Count -eq 1 -and $projectMarkers[0].resources[0] -eq 'project.json')
    $projectCached = @(& { Build-LauncherProject } 6>&1)
    $projectCacheMarkers = @($projectCached | Where-Object { $_ -is [Management.Automation.InformationRecord] -and $_.ToString().StartsWith('LAUNCHER_BUILD ') } | ForEach-Object { $_.ToString().Substring(15) | ConvertFrom-Json })
    Yes 'whole-project cache hit is marked without another compiler invocation' ($projectCacheMarkers.Count -eq 1 -and $projectCacheMarkers[0].stage -eq 'cache-hit' -and $projectCacheMarkers[0].kind -eq 'project')
} finally {
    $resolvedArea = [IO.Path]::GetFullPath($area)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedArea.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedArea) -notmatch '^ts-6932-[0-9a-f]{32}$') { throw 'Unexpected diagnostic fixture path' }
    Remove-Item -LiteralPath $resolvedArea -Recurse -Force
}
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
