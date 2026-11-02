<#
  Launcher-Csc.ps1
  Dot-sourced by every harness that compiles launcher files.

      . (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')

  The launcher is a .NET 10 project (launcher\app\Thornswood.csproj, #4823),
  so its code is compiled the way that project compiles it: by the .NET 10
  SDK, at the project's LangVersion, against the project's target framework
  and its packages. That works on Linux as well as on Windows, so a harness
  compiles and runs launcher code everywhere, and only says SKIP where the
  code under test itself does something only Windows has.

  It sets these variables, and the functions below them, and nothing else
  (apart from $OnWindows, which it gets from tests\Windows.ps1, and its own
  workings, whose names all start with launcher, so none can replace a
  variable of the harness that dot-sources it):

    $LauncherDotnet       the dotnet that builds the launcher: the one on
                          PATH, else $env:DOTNET_ROOT's, else ~/.dotnet's.
                          A path that does not exist when there is none, so a
                          harness's "the SDK is here" check says so plainly.
    $LauncherLangVersion  the LangVersion launcher\app\Thornswood.csproj says.
    $LauncherFramework    the TargetFramework it says (net10.0-windows).

  Build-LauncherCode -Source <code>[, ...] [-File <path>[, ...]] [-Exe]
                     [-Launcher] [-Main <type>] [-Resource @{ name = path }]
                     [-Property @{ name = value }]:
  builds the C# given (strings the harness writes, and launcher files by
  path) as a library, or with -Exe as a program, the way the project builds:
  the same target framework, LangVersion, Nullable, ImplicitUsings,
  AllowUnsafeBlocks, compiled bindings and every PackageReference, so
  launcher code that uses Avalonia or any other package compiles here as it
  does in the build. -Launcher adds the whole launcher as the project has
  it: every launcher\app\*.cs, every *.axaml there as Avalonia XAML, and
  every EmbeddedResource under its LogicalName. -Main names the class whose
  Main starts the program (StartupObject), which a driver beside the whole
  launcher needs, since Shell.Main is in the build too. -Resource embeds
  files under the names given (the LogicalName the code asks for): one the
  project already embeds under that name is replaced by the file given, any
  other name is added. Their bytes are in the hash like every other file, so
  a changed stand-in is built again. -Property adds MSBuild properties to the
  project, after its own, so one given here wins (GenerateAssemblyInfo =
  'false' for a stand-in that carries its own AssemblyFileVersion); they are
  in the project text, and so in the hash. It returns the path of the built
  dll. A refusal throws, with what the compiler said.

      $exe = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.ScanFixTest' -Resource @{ 'skyrim-files.json' = $standIn }
      $said = Invoke-LauncherExe $exe $work

  Add-LauncherAssembly: the launcher itself, built from
  launcher\app\Thornswood.csproj as it is (dotnet build -c Release), loaded
  into this PowerShell and returned, for a harness that calls Updater, Paths
  or VersionDoc by reflection. The build is named by a hash of every file
  under launcher\app and every resource the project embeds, so it is made
  once for each state of the launcher. Build-LauncherProject is the same
  build without the load, and returns the path of Thornswood.dll.

      $asm = Add-LauncherAssembly
      $U = $asm.GetType('Thornswood.Updater')

  Invoke-LauncherExe <dll> [args...]: runs a program Build-LauncherCode -Exe
  built, through $LauncherDotnet, and returns what it printed, one string a
  line. $LASTEXITCODE is the program's exit code.

  Add-LauncherType -Source <code>[, ...] [-File <path>[, ...]] [-Launcher]:
  what a harness calls where it would have called Add-Type on launcher code.
  It builds a library with Build-LauncherCode and loads it into this
  PowerShell, which runs on .NET 10 as well (pwsh 7.6), and returns the
  assembly. The packages built beside it load from its folder when its code
  first asks for them.

      $asm = Add-LauncherType -File (Join-Path $App 'FeedNotice.cs') -Source $standIn
      $T = $asm.GetType('Thornswood.FeedNotice')

  WHERE THE BUILDS GO. Under out\harness\ in the repository, which git
  ignores, in a folder named by a hash of the project and every source, so
  the same code is built once and the next run of any harness reuses it. A
  build is made in a folder of its own and then renamed into place, so two
  harnesses run side by side by the gate never write into one folder. A
  loaded assembly holds its file open on Windows, so the folders are never
  removed under a harness; deleting out\ clears them. A harness build is for
  this machine's runtime identifier, so it carries the native libraries of
  this machine only, beside the dll where .NET looks for them, and every
  package file in a build is a hard link to the NuGet cache where the disk
  allows one, so a build costs the disk only what it compiled. Copied, one
  build of the whole launcher was 580 MB (the native libraries of seventeen
  platforms) and the launcher project itself 224 MB.

  Add-Type and CodeDom were never the build's compiler (#2821): they compile
  with whatever runtime PowerShell runs on, not with the project's settings
  and packages. Every harness compiles launcher code through here so a
  harness and the build cannot drift. WHY ONE PLACE (#498): a harness that
  kept a compiler of its own passed code the build refused, or refused code
  the build took.

  Until #4823 this file found the Roslyn csc beside MSBuild in Visual Studio's
  Build Tools and the .NET Framework 4.8.1 reference assemblies, which only
  Windows has, so every compile here was SKIP off Windows.
#>
. (Join-Path $PSScriptRoot 'Windows.ps1')

$launcherRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcherProjPath = Join-Path $launcherRepo (Join-Path 'launcher' (Join-Path 'app' 'Thornswood.csproj'))
$launcherProjXml = [xml][IO.File]::ReadAllText($launcherProjPath)

function Get-LauncherProjectValue([string]$name) {
    $n = $launcherProjXml.SelectSingleNode('//PropertyGroup/' + $name)
    if ($null -eq $n) { return $null }
    $n.InnerText.Trim()
}

$LauncherLangVersion = Get-LauncherProjectValue 'LangVersion'
if (-not $LauncherLangVersion) { throw 'launcher\app\Thornswood.csproj names no LangVersion, so the harnesses cannot compile at the version the build does.' }
$LauncherFramework = Get-LauncherProjectValue 'TargetFramework'
if (-not $LauncherFramework) { throw 'launcher\app\Thornswood.csproj names no TargetFramework, so the harnesses cannot compile against what the build does.' }

# A harness dot-sources this file, so whatever it sets at the top lands
# among the harness's own variables, and a loop variable here once replaced a
# harness's $root (test-963 then looked for its scripts under ~/.dotnet). So
# every value below is worked out inside & { }, a scope of its own, and only
# names that start with Launcher or launcher are set here.

# The project's own settings that change what compiles, copied as they are.
$launcherCopied = @(& {
    foreach ($name in @('Nullable', 'ImplicitUsings', 'AllowUnsafeBlocks', 'EnableWindowsTargeting', 'AvaloniaUseCompiledBindingsByDefault')) {
        $value = Get-LauncherProjectValue $name
        if ($null -ne $value) { '    <' + $name + '>' + [Security.SecurityElement]::Escape($value) + '</' + $name + '>' }
    }
})
$launcherPackages = @(& {
    # Each with the assets it leaves out, as the project says (the project
    # leaves Avalonia.BuildServices out whole).
    foreach ($ref in $launcherProjXml.SelectNodes('//ItemGroup/PackageReference')) {
        $line = '    <PackageReference Include="' + [Security.SecurityElement]::Escape($ref.Include) + '" Version="' + [Security.SecurityElement]::Escape($ref.Version) + '"'
        foreach ($a in 'ExcludeAssets', 'PrivateAssets') { if ($ref.HasAttribute($a)) { $line += ' ' + $a + '="' + [Security.SecurityElement]::Escape($ref.GetAttribute($a)) + '"' } }
        $line + ' />'
    }
})
# For -Launcher: the project's resources, each as a full path and the name
# the code asks for, read from the project the way the packages are.
$launcherAppDir = Split-Path -Parent $launcherProjPath
$launcherResources = @(& {
    foreach ($res in $launcherProjXml.SelectNodes('//ItemGroup/EmbeddedResource')) {
        $rel = $res.Include.Replace('\', [string][IO.Path]::DirectorySeparatorChar)
        [pscustomobject]@{ Path = [IO.Path]::GetFullPath((Join-Path $launcherAppDir $rel)); Name = $res.LogicalName }
    }
})

$LauncherDotnet = & {
    $onPath = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { return $onPath.Source }
    $exeName = if ($OnWindows) { 'dotnet.exe' } else { 'dotnet' }
    foreach ($dotnetRoot in @($env:DOTNET_ROOT, (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dotnet'))) {
        if (-not $dotnetRoot) { continue }
        $candidate = Join-Path $dotnetRoot $exeName
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    Join-Path ([IO.Path]::GetTempPath()) (Join-Path 'no-dotnet-sdk' 'dotnet')
}

function Build-LauncherCode {
    param(
        [string[]]$Source = @(),
        [string[]]$File = @(),
        [switch]$Exe,
        [switch]$Launcher,
        [string]$Main,
        [hashtable]$Resource = @{},
        [hashtable]$Property = @{}
    )
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { throw ('Build-LauncherCode: the .NET SDK the launcher builds with is not on this machine (' + $LauncherDotnet + '). docs/guide/set-up-a-machine.md "Setting up a machine" has the install line.') }
    if (@($Source).Count + @($File).Count -eq 0 -and -not $Launcher) { throw 'Build-LauncherCode: nothing to build.' }
    $files = @(foreach ($f in $File) {
        if (-not (Test-Path -LiteralPath $f)) { throw ('Build-LauncherCode: ' + $f + ' is not there.') }
        (Resolve-Path -LiteralPath $f).Path
    })
    $xaml = @()
    $resources = @()
    if ($Launcher) {
        $whole = @(Get-ChildItem -LiteralPath $launcherAppDir -File -Filter '*.cs' | Sort-Object Name | ForEach-Object { $_.FullName })
        $files = @($whole) + @($files | Where-Object { $whole -notcontains $_ })
        $xaml = @(Get-ChildItem -LiteralPath $launcherAppDir -File -Filter '*.axaml' | Sort-Object Name | ForEach-Object { $_.FullName })
        $resources = $launcherResources
        foreach ($r in $resources) { if (-not (Test-Path -LiteralPath $r.Path)) { throw ('Build-LauncherCode: ' + $r.Path + ', a resource the project embeds, is not there.') } }
    }
    # The harness's own resources, in ordinal order of their names, each in
    # place of the project's resource of the same name.
    $names = [string[]]@($Resource.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    foreach ($n in $names) {
        $p = [string]$Resource[$n]
        if (-not (Test-Path -LiteralPath $p)) { throw ('Build-LauncherCode: ' + $p + ', the file given for the resource ' + $n + ', is not there.') }
        $resources = @($resources | Where-Object { $_.Name -cne $n }) + @([pscustomobject]@{ Path = (Resolve-Path -LiteralPath $p).Path; Name = $n })
    }

    $proj = @(
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup>',
        ('    <OutputType>' + $(if ($Exe) { 'Exe' } else { 'Library' }) + '</OutputType>'),
        ('    <TargetFramework>' + $LauncherFramework + '</TargetFramework>'),
        ('    <LangVersion>' + $LauncherLangVersion + '</LangVersion>')
    ) + $launcherCopied + @(
        '    <AssemblyName>ASSEMBLY_NAME</AssemblyName>',
        '    <RootNamespace>Thornswood</RootNamespace>',
        '    <EnableDefaultItems>false</EnableDefaultItems>',
        '    <UseAppHost>false</UseAppHost>',
        '    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>',
        '    <CreateHardLinksForCopyLocalIfPossible>true</CreateHardLinksForCopyLocalIfPossible>',
        ('    <RuntimeIdentifier>' + [Runtime.InteropServices.RuntimeInformation]::RuntimeIdentifier + '</RuntimeIdentifier>'),
        '    <SelfContained>false</SelfContained>',
        '    <GenerateDocumentationFile>false</GenerateDocumentationFile>',
        '    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>'
    ) + @(if ($Main) { '    <StartupObject>' + [Security.SecurityElement]::Escape($Main) + '</StartupObject>' }) + @(
        $props = [string[]]@($Property.Keys)
        [Array]::Sort($props, [StringComparer]::Ordinal)
        foreach ($n in $props) {
            if ($n -cnotmatch '^[A-Za-z_][A-Za-z0-9_.-]*$') { throw ('Build-LauncherCode: ' + $n + ' is not a name MSBuild takes for a property.') }
            '    <' + $n + '>' + [Security.SecurityElement]::Escape([string]$Property[$n]) + '</' + $n + '>'
        }
    ) + @(
        '  </PropertyGroup>',
        '  <ItemGroup>'
    ) + $launcherPackages + @('  </ItemGroup>', '  <ItemGroup>') +
        @(for ($i = 0; $i -lt @($Source).Count; $i++) { '    <Compile Include="source' + $i + '.cs" />' }) +
        @($files | ForEach-Object { '    <Compile Include="' + [Security.SecurityElement]::Escape($_) + '" />' }) +
        @($xaml | ForEach-Object { '    <AvaloniaXaml Include="' + [Security.SecurityElement]::Escape($_) + '" />' }) +
        @($resources | ForEach-Object { '    <EmbeddedResource Include="' + [Security.SecurityElement]::Escape($_.Path) + '" LogicalName="' + [Security.SecurityElement]::Escape($_.Name) + '" />' }) +
        @('  </ItemGroup>', '</Project>')
    $projText = ($proj -join "`n") + "`n"

    # The folder is named by everything that goes into the build: the
    # project, each source, and the bytes of each file it reads, by their own
    # sha256 (tests\launcher-csc.js does the same).
    $sha = [Security.Cryptography.SHA256]::Create()
    $all = New-Object Text.StringBuilder
    [void]$all.Append($projText)
    foreach ($s in $Source) { [void]$all.Append("`0").Append($s) }
    foreach ($f in @($files) + @($xaml) + @($resources | ForEach-Object { $_.Path })) {
        [void]$all.Append("`0").Append((-join ($sha.ComputeHash([IO.File]::ReadAllBytes($f)) | ForEach-Object { $_.ToString('x2') })))
    }
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($all.ToString())) | ForEach-Object { $_.ToString('x2') })
    # The assembly is named by the hash too: .NET loads one assembly of a
    # name, so two builds both called the same would be one in a harness.
    $name = 'launcher-code-' + $hash.Substring(0, 24)
    $projText = $projText.Replace('ASSEMBLY_NAME', $name)
    $base = Join-Path $launcherRepo (Join-Path 'out' 'harness')
    $done = Join-Path $base $hash.Substring(0, 24)
    $dll = Join-Path $done ($name + '.dll')
    if (Test-Path -LiteralPath $dll) { return $dll }

    $work = Join-Path $base ('building-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
    $null = New-Item -ItemType Directory -Force -Path $work
    try {
        $utf8 = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText((Join-Path $work 'launcher-code.csproj'), $projText, $utf8)
        for ($i = 0; $i -lt @($Source).Count; $i++) {
            [IO.File]::WriteAllText((Join-Path $work ('source' + $i + '.cs')), $Source[$i], $utf8)
        }
        $bin = Join-Path $work 'bin'
        # --disable-build-servers: no MSBuild node or compiler server outlives
        # the build. One that did kept files under the build's own folder open,
        # and on Windows that folder could then be neither moved into place
        # nor removed ("being used by another process", the first Windows run
        # of these harnesses, 2 Nov 2026), and it was left running after the
        # harness ended.
        $said = & $LauncherDotnet build (Join-Path $work 'launcher-code.csproj') -c Release -o $bin -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $bin ($name + '.dll')))) {
            throw ('Build-LauncherCode: the .NET SDK refused it:' + [Environment]::NewLine + $said.Trim())
        }
        # Into place in one rename. Another harness may have built the same
        # code meanwhile; its copy is the same, and is used.
        try { [IO.Directory]::Move($bin, $done) }
        catch [IO.IOException] { if (-not (Test-Path -LiteralPath $dll)) { throw } }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
    $dll
}

# Every file a build of the project reads that can change: each file under
# launcher\app and each resource the project embeds, as its path and the
# sha256 of its bytes, in ordinal order. tests\launcher-csc.js does the same.
function Get-LauncherProjectHash {
    $sha = [Security.Cryptography.SHA256]::Create()
    $paths = @(Get-ChildItem -LiteralPath $launcherAppDir -File -Recurse -Force | ForEach-Object { $_.FullName }) + @($launcherResources | ForEach-Object { $_.Path })
    $rel = [string[]]@($paths | ForEach-Object { [IO.Path]::GetRelativePath($launcherRepo, $_).Replace('\', '/') } | Select-Object -Unique)
    [Array]::Sort($rel, [StringComparer]::Ordinal)
    $all = New-Object Text.StringBuilder
    foreach ($r in $rel) {
        $bytes = [IO.File]::ReadAllBytes((Join-Path $launcherRepo $r))
        [void]$all.Append($r).Append("`0").Append((-join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }))).Append("`n")
    }
    (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($all.ToString())) | ForEach-Object { $_.ToString('x2') })).Substring(0, 24)
}

function Build-LauncherProject {
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { throw ('Build-LauncherProject: the .NET SDK the launcher builds with is not on this machine (' + $LauncherDotnet + '). docs/guide/set-up-a-machine.md "Setting up a machine" has the install line.') }
    $base = Join-Path $launcherRepo (Join-Path 'out' 'harness')
    $done = Join-Path $base ('project-' + (Get-LauncherProjectHash))
    $dll = Join-Path $done 'Thornswood.dll'
    if (Test-Path -LiteralPath $dll) { return $dll }

    # A folder of its own for the build, obj included: the project's
    # Directory.Build.props puts obj under out\obj\launcher, which two
    # harnesses building at once would share, so both bases are given here.
    $work = Join-Path $base ('building-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
    $null = New-Item -ItemType Directory -Force -Path $work
    try {
        $bin = Join-Path $work 'bin'
        $sep = [IO.Path]::DirectorySeparatorChar
        $said = & $LauncherDotnet build $launcherProjPath -c Release -o $bin ('-p:BaseIntermediateOutputPath=' + (Join-Path $work 'obj') + $sep) ('-p:BaseOutputPath=' + (Join-Path $work 'out') + $sep) '-p:CreateHardLinksForCopyLocalIfPossible=true' -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $bin 'Thornswood.dll'))) {
            throw ('Build-LauncherProject: the .NET SDK refused launcher\app\Thornswood.csproj:' + [Environment]::NewLine + $said.Trim())
        }
        # Into place in one rename, as Build-LauncherCode does.
        try { [IO.Directory]::Move($bin, $done) }
        catch [IO.IOException] { if (-not (Test-Path -LiteralPath $dll)) { throw } }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
    $dll
}

function Invoke-LauncherExe {
    param([Parameter(Mandatory = $true, Position = 0)][string]$Path, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments = @())
    & $LauncherDotnet $Path @Arguments
}

# What finds a package a loaded build asks for: its own folder. .NET looks
# beside PowerShell, not beside the build, so the folders are named to it.
# A plain class written out here, not launcher code (#2821).
if (-not ('ThornswoodHarness.BuildFolders' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

namespace ThornswoodHarness
{
    public static class BuildFolders
    {
        static readonly List<string> folders = new List<string>();
        static bool hooked;

        public static void Add(string folder)
        {
            lock (folders)
            {
                if (!folders.Contains(folder)) folders.Add(folder);
                if (hooked) return;
                hooked = true;
                AppDomain.CurrentDomain.AssemblyResolve += Find;
            }
        }

        static Assembly Find(object sender, ResolveEventArgs e)
        {
            string file = new AssemblyName(e.Name).Name + ".dll";
            lock (folders)
            {
                foreach (string f in folders)
                {
                    string p = Path.Combine(f, file);
                    if (File.Exists(p)) return Assembly.LoadFrom(p);
                }
            }
            return null;
        }
    }
}
'@
}

function Add-LauncherType {
    param(
        [string[]]$Source = @(),
        [string[]]$File = @(),
        [switch]$Launcher
    )
    $dll = Build-LauncherCode -Source $Source -File $File -Launcher:$Launcher
    [ThornswoodHarness.BuildFolders]::Add((Split-Path -Parent $dll))
    [Reflection.Assembly]::LoadFrom($dll)
}

function Add-LauncherAssembly {
    $dll = Build-LauncherProject
    [ThornswoodHarness.BuildFolders]::Add((Split-Path -Parent $dll))
    [Reflection.Assembly]::LoadFrom($dll)
}
