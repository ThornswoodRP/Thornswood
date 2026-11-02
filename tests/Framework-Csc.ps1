<#
  Framework-Csc.ps1
  Dot-sourced by a harness that holds launcher files to what Windows
  PowerShell 5.1's Add-Type compiles: C# 5 against the .NET Framework.

      . (Join-Path $PSScriptRoot 'Framework-Csc.ps1')

  The launcher itself is .NET 10 (#4823), but scripts still load a few of its
  files with Add-Type, and in Windows PowerShell 5.1 that is the .NET
  Framework's own compiler, which stops at C# 5 and has none of .NET 10's
  libraries: scripts\mods\LoadOrder.ps1 loads VortexProfileState.cs,
  scripts\mods\Generated.ps1 loads Generated.cs, GeneratedBuild.cs and
  CoveredBodies.cs, and scripts\release\Go.ps1 loads LastPlugin.cs and the
  FromGame*.cs files. A harness for one of those builds it here as well as
  with Build-LauncherCode, so a file that only .NET 10 compiles fails here
  and not on the machine that runs the script.

  It loads tests\Launcher-Csc.ps1, for $LauncherDotnet, and adds one function:

  Build-FrameworkCode -File <path>[, ...] [-Source <code>[, ...]]
                      [-Reference <name>[, ...]] [-Exe] [-Main <type>]
                      [-LangVersion <n>]:
  builds the files and sources as a .NET Framework 4.8 project (net48) at C#
  -LangVersion (5 when not given), with the framework assemblies -Reference
  names (System.Xml, System.Security, ...; System and System.Core are always
  there), through the .NET SDK the launcher builds with. The SDK fetches the
  .NET Framework reference assemblies as a package
  (Microsoft.NETFramework.ReferenceAssemblies), so this works on Linux too.
  It returns the path of what it built. What it builds is for compiling only:
  off Windows there is no .NET Framework to run it on. A refusal throws, with
  what the compiler said.

      $null = Build-FrameworkCode -File (Join-Path $App 'VortexProfileState.cs') -Reference System.Xml

  WHERE THE BUILDS GO. Under out\harness\ beside Launcher-Csc.ps1's, in a
  folder named framework- and a hash of the project and every source, so the
  same code is built once; a build is made in a folder of its own and renamed
  into place, so two harnesses side by side never write into one folder.
#>
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')

function Build-FrameworkCode {
    param(
        [string[]]$File = @(),
        [string[]]$Source = @(),
        [string[]]$Reference = @(),
        [switch]$Exe,
        [string]$Main,
        [string]$LangVersion = '5'
    )
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { throw ('Build-FrameworkCode: the .NET SDK the launcher builds with is not on this machine (' + $LauncherDotnet + '). docs/guide/set-up-a-machine.md "Setting up a machine" has the install line.') }
    if (@($Source).Count + @($File).Count -eq 0) { throw 'Build-FrameworkCode: nothing to build.' }
    $files = @(foreach ($f in $File) {
        if (-not (Test-Path -LiteralPath $f)) { throw ('Build-FrameworkCode: ' + $f + ' is not there.') }
        (Resolve-Path -LiteralPath $f).Path
    })
    $proj = @(
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup>',
        ('    <OutputType>' + $(if ($Exe) { 'Exe' } else { 'Library' }) + '</OutputType>'),
        '    <TargetFramework>net48</TargetFramework>',
        ('    <LangVersion>' + [Security.SecurityElement]::Escape($LangVersion) + '</LangVersion>'),
        '    <AssemblyName>framework-code</AssemblyName>',
        '    <EnableDefaultItems>false</EnableDefaultItems>',
        '    <GenerateDocumentationFile>false</GenerateDocumentationFile>',
        '    <NoWarn>$(NoWarn);CS0649;CS1701</NoWarn>'
    ) + @(if ($Main) { '    <StartupObject>' + [Security.SecurityElement]::Escape($Main) + '</StartupObject>' }) + @(
        '  </PropertyGroup>',
        '  <ItemGroup>'
    ) + @($Reference | ForEach-Object { '    <Reference Include="' + [Security.SecurityElement]::Escape(($_ -replace '\.dll$', '')) + '" />' }) +
        @(for ($i = 0; $i -lt @($Source).Count; $i++) { '    <Compile Include="source' + $i + '.cs" />' }) +
        @($files | ForEach-Object { '    <Compile Include="' + [Security.SecurityElement]::Escape($_) + '" />' }) +
        @('  </ItemGroup>', '</Project>')
    $projText = ($proj -join "`n") + "`n"

    $sha = [Security.Cryptography.SHA256]::Create()
    $all = New-Object Text.StringBuilder
    [void]$all.Append($projText)
    foreach ($s in $Source) { [void]$all.Append("`0").Append($s) }
    foreach ($f in $files) { [void]$all.Append("`0").Append([IO.File]::ReadAllText($f)) }
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($all.ToString())) | ForEach-Object { $_.ToString('x2') })
    $base = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) (Join-Path 'out' 'harness')
    $done = Join-Path $base ('framework-' + $hash.Substring(0, 24))
    $built = Join-Path $done ('framework-code' + $(if ($Exe) { '.exe' } else { '.dll' }))
    if (Test-Path -LiteralPath $built) { return $built }

    $work = Join-Path $base ('building-framework-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
    $null = New-Item -ItemType Directory -Force -Path $work
    try {
        $utf8 = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText((Join-Path $work 'framework-code.csproj'), $projText, $utf8)
        for ($i = 0; $i -lt @($Source).Count; $i++) {
            [IO.File]::WriteAllText((Join-Path $work ('source' + $i + '.cs')), $Source[$i], $utf8)
        }
        $bin = Join-Path $work 'bin'
        # --disable-build-servers, as in Launcher-Csc.ps1: nothing of the
        # build may hold this folder once it is done.
        $said = & $LauncherDotnet build (Join-Path $work 'framework-code.csproj') -c Release -o $bin -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $bin (Split-Path -Leaf $built)))) {
            throw ('Build-FrameworkCode: the .NET SDK refused it at C# ' + $LangVersion + ' against the .NET Framework:' + [Environment]::NewLine + $said.Trim())
        }
        # Into place in one rename. Another harness may have built the same
        # code meanwhile; its copy is the same, and is used.
        try { [IO.Directory]::Move($bin, $done) }
        catch [IO.IOException] { if (-not (Test-Path -LiteralPath $built)) { throw } }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
    $built
}
