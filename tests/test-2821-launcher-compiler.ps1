<#
  test-2821-launcher-compiler.ps1

      pwsh -NoProfile -File .\tests\test-2821-launcher-compiler.ps1

  Issue #2821. Seventeen harnesses compiled launcher or setup code with
  PowerShell's Add-Type or a CSharpCodeProvider, not the compiler the build
  runs. Under Windows PowerShell 5.1 that is the in-box .NET Framework csc,
  which stops at C# 5, so a harness refused a line the build takes, and five
  text checks held Secrets.cs, Swallow.cs, OwnGame*.cs and the Downgrade pin
  methods to C# 5 for them; under pwsh 7 it is .NET's Roslyn against .NET 8's
  libraries, so a harness passed code the build refuses on .NET Framework
  4.8.1. Each harness had copied the call from the one before it. Now they
  call Add-LauncherType (tests\Launcher-Csc.ps1), which builds with the .NET
  10 SDK the way launcher\app\Thornswood.csproj does: its target framework,
  its LangVersion and its packages (#4823). This fails on:
    1. a harness in tests\ that names launcher\app or installer\setup and
       hands Add-Type C# that is not a plain string written in the harness
       itself (a variable, a sum, a string with $ in it, or -Path): that is
       code lifted out of the launcher, compiled the wrong way;
    2. a harness in tests\ that makes a CSharpCodeProvider or calls
       CompileAssemblyFromSource or CompileAssemblyFromFile.
  A stand-in the harness writes out in full (a local server, a probe of a
  Windows call) is a plain string and is not a hit. The same reader is run
  over planted harnesses, so one that finds nothing anywhere cannot pass by
  accident. Then Add-LauncherType itself, on any machine with the SDK: it
  takes C# past 5, it compiles against the project's packages (Avalonia), two
  different builds load side by side, the same code is built once, a program
  built with -Exe runs and gives back its exit code, and a refusal comes back
  as a throw with the compiler's words. Build-LauncherCode -Launcher builds
  the whole launcher beside a driver whose Main -Main names, with the
  project's resources and a stand-in in place of one by -Resource, and a
  changed stand-in is built again; -Property reaches the project; and
  Add-LauncherAssembly gives back the launcher itself, built from its project.

  Read only, apart from the planted folder and the stand-ins under TEMP,
  which it removes, and the builds under out\harness, which git ignores.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# What one harness compiles the wrong way, as "line N: what", read from its
# syntax tree so a comment or the text of a script it writes is not a hit.
function Get-WrongCompile([string]$path) {
    $hits = New-Object System.Collections.Generic.List[string]
    $text = [IO.File]::ReadAllText($path)
    $tokens = $null; $errs = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errs)
    $names = $text -match '(?i)launcher[\\/]app|installer[\\/]setup'
    foreach ($c in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type' }, $true)) {
        if (-not $names) { break }
        $at = 'line ' + $c.Extent.StartLineNumber + ': '
        $bound = [Management.Automation.Language.StaticParameterBinder]::BindCommand($c, $true)
        foreach ($p in 'TypeDefinition', 'MemberDefinition') {
            if (-not $bound.BoundParameters.ContainsKey($p)) { continue }
            $v = $bound.BoundParameters[$p].Value
            if ($v -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
                $hits.Add($at + 'Add-Type -' + $p + ' ' + $v.Extent.Text.Split("`n")[0].Trim())
            }
        }
        foreach ($p in 'Path', 'LiteralPath') {
            if ($bound.BoundParameters.ContainsKey($p)) { $hits.Add($at + 'Add-Type -' + $p + ' ' + $bound.BoundParameters[$p].Value.Extent.Text) }
        }
    }
    foreach ($n in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -or
                                            $n -is [Management.Automation.Language.TypeExpressionAst] -or
                                            $n -is [Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
        $at = 'line ' + $n.Extent.StartLineNumber + ': '
        if ($n -is [Management.Automation.Language.InvokeMemberExpressionAst]) {
            $m = $n.Member.Extent.Text
            if ($m -match '^CompileAssemblyFrom(Source|File)$') { $hits.Add($at + 'CodeDom ' + $m) }
        }
        elseif ($n -is [Management.Automation.Language.TypeExpressionAst]) {
            if ($n.TypeName.FullName -match 'CSharpCodeProvider$') { $hits.Add($at + 'CodeDom ' + $n.TypeName.FullName) }
        }
        elseif ($n.Value -match '^(Microsoft\.CSharp\.)?CSharpCodeProvider$' -and $n.Parent -is [Management.Automation.Language.CommandAst]) {
            $hits.Add($at + 'CodeDom ' + $n.Value)
        }
    }
    , $hits
}

# ---- 1. every harness here --------------------------------------------------
# Here and beside each product, in its own tests folder (plan line 42).
. (Join-Path (Join-Path (Join-Path (Split-Path -Parent $Here) 'scripts') 'dev') 'Harness-Files.ps1')
$harnesses = @(@($Here) + @(Get-ProductTestFolders (Split-Path -Parent $Here) | ForEach-Object { $_.Path }) | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -File -Filter '*.ps1' } | Where-Object { $_.FullName -ne $PSCommandPath })
Yes ('there are harnesses to read (' + $harnesses.Count + ')') ($harnesses.Count -gt 300)
$bad = 0
foreach ($h in $harnesses) {
    $hits = Get-WrongCompile $h.FullName
    if ($hits.Count) {
        $bad++
        Write-Host ('FAIL  ' + $h.Name + ' compiles C# another way; call Add-LauncherType (tests\Launcher-Csc.ps1):')
        foreach ($x in $hits) { Write-Host ('      ' + $x) }
    }
}
Yes 'every harness compiles launcher and setup code with Add-LauncherType, the compiler the build runs' ($bad -eq 0)

# ---- 2. the reader, over planted harnesses -----------------------------------
$plant = Join-Path ([IO.Path]::GetTempPath()) ('ts-2821-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($plant)
try {
    $app = "`$app = Join-Path `$root 'launcher\app'`r`n"
    $cases = [ordered]@{
        'Add-Type of a file read out of launcher\app' = @(($app + '$cs = [IO.File]::ReadAllText((Join-Path $app ''Swallow.cs''))' + "`r`n" + 'Add-Type -TypeDefinition $cs -Language CSharp'), 1)
        'the same, as its first argument' = @(($app + 'Add-Type $cs'), 1)
        'lifted methods added to a plain head' = @(($app + "Add-Type -TypeDefinition (@'`r`npublic static class T {`r`n'@ + `$start + '}')"), 1)
        'lifted methods inside a string with $ in it' = @(($app + "Add-Type -TypeDefinition @`"`r`npublic static class T { `$lifted }`r`n`"@"), 1)
        'the files themselves, by -Path' = @("Add-Type -Path (Join-Path `$root 'installer\setup\Bootstrap.cs')", 1)
        'a CSharpCodeProvider' = @(($app + '$provider = New-Object Microsoft.CSharp.CSharpCodeProvider' + "`r`n" + '$built = $provider.CompileAssemblyFromSource($cp, $src)'), 2)
        'a CSharpCodeProvider by its type' = @(($app + '$provider = [Microsoft.CSharp.CSharpCodeProvider]::new()'), 1)
        'a stand-in server written out in full' = @(($app + "Add-Type -TypeDefinition @'`r`npublic static class Server { public static int Port; }`r`n'@"), 0)
        'a probe of a Windows call, as members' = @(($app + "Add-Type -Name W -Namespace P -MemberDefinition '[DllImport(`"kernel32.dll`")] public static extern IntPtr GetConsoleWindow();'"), 0)
        'an assembly by name' = @(($app + 'Add-Type -AssemblyName System.IO.Compression'), 0)
        'Add-LauncherType' = @(($app + '$asm = Add-LauncherType -Source $cs'), 0)
        'history told in a comment' = @(($app + "# before #2821 this ran Add-Type -TypeDefinition `$cs and a CSharpCodeProvider`r`n`$x = 1"), 0)
        'Add-Type in the text of a script it writes' = @(($app + "`$stand = @'`r`nAdd-Type -TypeDefinition `$x`r`n'@"), 0)
        'a harness that never names launcher code' = @('Add-Type -TypeDefinition $probe', 0)
    }
    $k = 0
    foreach ($name in $cases.Keys) {
        $k++
        $f = Join-Path $plant ('test-plant-' + $k + '.ps1')
        [IO.File]::WriteAllText($f, $cases[$name][0])
        $n = (Get-WrongCompile $f).Count
        Yes ('planted, ' + $name + ': ' + $(if ($cases[$name][1]) { 'found' } else { 'not a hit' }) + ' (' + $n + ')') ($n -eq $cases[$name][1])
    }
} finally {
    Remove-Item -LiteralPath $plant -Recurse -Force
}

# ---- 3. Add-LauncherType itself ----------------------------------------------
# A harness dot-sources the helper, so what the helper sets lands among the
# harness's own variables: a loop variable in it once replaced test-963's
# $root. Names a harness uses are set first, and must come through as they were.
$root = 'harness root'; $p = 'harness p'; $v = 'harness v'; $rel = 'harness rel'; $name = 'harness name'; $value = 'harness value'
$before = @(Get-Variable -Scope Script | ForEach-Object { $_.Name })
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$added = @(Get-Variable -Scope Script | ForEach-Object { $_.Name } | Where-Object { $before -notcontains $_ -and $_ -ne 'before' })
Yes ('dot-sourcing the helper leaves the harness''s variables as they were') (
    $root -eq 'harness root' -and $p -eq 'harness p' -and $v -eq 'harness v' -and $rel -eq 'harness rel' -and $name -eq 'harness name' -and $value -eq 'harness value')
$stray = @($added | Where-Object { $_ -cnotmatch '^(Launcher|launcher)' -and $_ -ne 'OnWindows' })
Yes ('and every name it adds starts with Launcher or launcher (' + (@($stray) -join ', ') + ')') ($stray.Count -eq 0)
$said = ''
if (-not (Test-Path -LiteralPath $LauncherDotnet)) {
    Yes ('the .NET SDK the build runs is on this machine (' + $LauncherDotnet + ')') $false
}
else {
    $ns = 'Ts2821' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $asm = $null
    # Past C# 5: an interpolated string, an expression body, a pattern.
    try { $asm = Add-LauncherType -Source ('namespace ' + $ns + ' { public static class A { public static string Say(object o) => o is string s ? $"said {s}" : "not text"; } }') }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes ('it compiles C# past 5, at the project''s LangVersion ' + $LauncherLangVersion) ($null -ne $asm)
    if ($asm) {
        Yes 'and gives back the assembly, loaded' ($asm.GetType($ns + '.A')::Say('x') -eq 'said x')
    }
    # Avalonia is one of the project's packages, not part of .NET: Add-Type
    # cannot compile this, the build can.
    $asmB = $null
    try { $asmB = Add-LauncherType -Source ('namespace ' + $ns + 'B { public static class B { public static bool M() { return Avalonia.Threading.Dispatcher.UIThread.CheckAccess(); } } }') }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'it compiles against the project''s packages, Avalonia among them' ($null -ne $asmB)
    if ($asmB -and $asm) {
        Yes 'two different builds load side by side, each its own assembly' ($asmB.GetName().Name -ne $asm.GetName().Name -and $asmB.GetType($ns + 'B.B')::M())
    }
    $code = 'namespace ' + $ns + 'C { public static class P { public static int Main(string[] a) { System.Console.WriteLine("got " + string.Join(",", a)); return 7; } } }'
    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Source $code } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'Build-LauncherCode -Exe builds a program' ($null -ne $exe)
    if ($exe) {
        $out = @(Invoke-LauncherExe $exe one two)
        Yes 'Invoke-LauncherExe runs it with its arguments and gives back its exit code' (($out -join '') -eq 'got one,two' -and $LASTEXITCODE -eq 7)
        $at = Get-Date
        $again = Build-LauncherCode -Exe -Source $code
        Yes 'the same code is built once, and the next ask finds it' ($again -eq $exe -and ((Get-Date) - $at).TotalSeconds -lt 2)
    }
    $said = ''
    try { $null = Add-LauncherType -Source 'class C { void M() { int x = "s"; } }' } catch { $said = $_.Exception.Message }
    Yes 'a refusal throws with what the compiler said' ($said -match 'CS0029')

    # The whole launcher and a driver of its own, with one resource stood in
    # for and one added. The same names and contents each run, so the next run
    # finds these builds made.
    $stand = Join-Path ([IO.Path]::GetTempPath()) ('ts2821-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = New-Item -ItemType Directory -Path $stand
    try {
        $standIn = Join-Path $stand 'skyrim-files.json'
        $added = Join-Path $stand 'added.txt'
        [IO.File]::WriteAllText($standIn, '{"stand":"one"}')
        [IO.File]::WriteAllText($added, 'added')
        $driver = 'namespace Ts2821D { public static class Run { static string R(string n) { var s = typeof(Thornswood.Shell).Assembly.GetManifestResourceStream(n); if (s == null) return "none"; using var r = new System.IO.StreamReader(s); return r.ReadToEnd(); } public static int Main(string[] a) { System.Console.WriteLine(R("skyrim-files.json") + "|" + R("added.txt") + "|" + (R("Thornswood.ini") != "none") + "|" + typeof(Thornswood.MainWindow).Name); return 0; } } }'
        $one = $null
        try { $one = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Ts2821D.Run' -Resource @{ 'skyrim-files.json' = $standIn; 'added.txt' = $added } }
        catch { Write-Host ('      ' + $_.Exception.Message) }
        Yes 'Build-LauncherCode -Launcher -Main builds the whole launcher beside a driver of its own' ($null -ne $one)
        if ($one) {
            $out = (@(Invoke-LauncherExe $one) -join '')
            Yes ('the driver''s Main is the one that runs, and the project''s resources are in it, MainWindow''s XAML with them (' + $out + ')') ($LASTEXITCODE -eq 0 -and $out -like '*|True|MainWindow')
            Yes '-Resource puts the stand-in in place of the project''s resource of that name, and adds one the project has not' ($out -like '{"stand":"one"}|added|*')
            [IO.File]::WriteAllText($standIn, '{"stand":"two"}')
            $two = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Ts2821D.Run' -Resource @{ 'skyrim-files.json' = $standIn; 'added.txt' = $added }
            Yes 'a changed stand-in is built again' ($two -ne $one -and ((@(Invoke-LauncherExe $two) -join '') -like '{"stand":"two"}|*'))
        }
    } finally {
        Remove-Item -LiteralPath $stand -Recurse -Force
    }

    # A program that carries its own AssemblyFileVersion: the SDK writes one
    # too, unless the project says not to.
    $versioned = '[assembly: System.Reflection.AssemblyFileVersion("2.8.2.1")] namespace Ts2821V { public static class P { public static int Main() { System.Console.WriteLine(System.Diagnostics.FileVersionInfo.GetVersionInfo(typeof(P).Assembly.Location).FileVersion); return 0; } } }'
    $said = ''
    try { $null = Build-LauncherCode -Exe -Source $versioned } catch { $said = $_.Exception.Message }
    $exeV = $null
    try { $exeV = Build-LauncherCode -Exe -Source $versioned -Property @{ GenerateAssemblyInfo = 'false' } } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes '-Property reaches the project: GenerateAssemblyInfo false lets a program carry its own version, which is refused without it' ($said -match 'CS0579' -and $exeV -and ((@(Invoke-LauncherExe $exeV) -join '') -eq '2.8.2.1'))

    $whole = $null
    try { $whole = Add-LauncherAssembly } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'Add-LauncherAssembly builds launcher\app\Thornswood.csproj and gives back Thornswood, loaded' ($whole -and $whole.GetName().Name -eq 'Thornswood' -and $whole.GetType('Thornswood.Updater') -and $whole.GetType('Thornswood.Paths'))
    if ($whole) {
        $at = Get-Date
        Yes 'the launcher is built once for each state of its files, and the next ask finds it' ((Build-LauncherProject) -eq $whole.Location -and ((Get-Date) - $at).TotalSeconds -lt 2)
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
