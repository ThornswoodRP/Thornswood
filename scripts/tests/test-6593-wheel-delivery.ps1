#Requires -Version 7.0
# Actual extracted runner primitives against managed fixtures. No user32 calls,
# launcher/game launch, installed paths, physical input or publication.
param([string]$Runner = (Join-Path $PSScriptRoot '..\dev\Run-RealClient.ps1'))
$ErrorActionPreference = 'Stop'
$file = $Runner
$text = [IO.File]::ReadAllText($file)
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Runner parse failed' }
$function = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-GameWheel'
}, $true)
if (-not $function) { throw 'Missing wheel admission' }

Add-Type -TypeDefinition @'
using System;
namespace ThornswoodRealClient {
  public static class Win {
    public static IntPtr Foreground = new IntPtr(42);
    public static bool Activate = true, Move = true, Lose = false, Throw = false;
    public static uint Sent = 1;
    public static int Calls, Delta;
    public static IntPtr GetForegroundWindow() { return Foreground; }
    public static bool SetForegroundWindow(IntPtr value) { if (Activate && Move) Foreground=value; return Activate; }
    public static uint SendWheel(int value) {
      Calls++; Delta=value;
      if (Throw) throw new Exception("synthetic");
      if (Lose) Foreground=new IntPtr(99);
      return Sent;
    }
  }
}
'@
. ([scriptblock]::Create($function.Extent.Text))
$passed = 0
function Check([bool]$condition, [string]$name) {
    if (-not $condition) { throw $name }
    $script:passed++
    Write-Output ('PASS ' + $name)
}
function Reset-Fixture {
    [ThornswoodRealClient.Win]::Foreground = [IntPtr]42
    [ThornswoodRealClient.Win]::Activate = $true
    [ThornswoodRealClient.Win]::Move = $true
    [ThornswoodRealClient.Win]::Lose = $false
    [ThornswoodRealClient.Win]::Throw = $false
    [ThornswoodRealClient.Win]::Sent = 1
    [ThornswoodRealClient.Win]::Calls = 0
}
foreach ($delta in @(120, -120)) {
    Reset-Fixture
    $r = Invoke-GameWheel ([IntPtr]42) $delta
    Check ($r.ok -and [ThornswoodRealClient.Win]::Calls -eq 1 -and [ThornswoodRealClient.Win]::Delta -eq $delta) ('one signed detent ' + $delta)
}
foreach ($delta in @(0, 240, 120.5, 'x')) {
    Reset-Fixture
    $r = Invoke-GameWheel ([IntPtr]42) $delta
    Check (-not $r.ok -and [ThornswoodRealClient.Win]::Calls -eq 0) ('invalid delta refused ' + $delta)
}
Reset-Fixture
$r = Invoke-GameWheel ([IntPtr]::Zero) 120
Check (-not $r.ok -and [ThornswoodRealClient.Win]::Calls -eq 0) 'missing window sends nothing'
Reset-Fixture
[ThornswoodRealClient.Win]::Foreground = [IntPtr]99
[ThornswoodRealClient.Win]::Activate = $false
$r = Invoke-GameWheel ([IntPtr]42) 120
Check (-not $r.ok -and [ThornswoodRealClient.Win]::Calls -eq 0) 'denied focus sends nothing'
Reset-Fixture
[ThornswoodRealClient.Win]::Foreground = [IntPtr]99
[ThornswoodRealClient.Win]::Move = $false
$r = Invoke-GameWheel ([IntPtr]42) 120
Check (-not $r.ok -and [ThornswoodRealClient.Win]::Calls -eq 0) 'nominal focus success still must match the target'
foreach ($failure in @('Sent', 'Lose', 'Throw')) {
    Reset-Fixture
    if ($failure -eq 'Sent') { [ThornswoodRealClient.Win]::Sent = 0 }
    if ($failure -eq 'Lose') { [ThornswoodRealClient.Win]::Lose = $true }
    if ($failure -eq 'Throw') { [ThornswoodRealClient.Win]::Throw = $true }
    $r = Invoke-GameWheel ([IntPtr]42) 120
    Check (-not $r.ok -and [ThornswoodRealClient.Win]::Calls -eq 1) ('no retry after ' + $failure)
}

# Compile the exact payload method/struct declarations, replacing only its
# unmanaged SendInput boundary with a managed packet recorder.
$method = [regex]::Match($text, '(?s)public static uint SendWheel\(int delta\) \{.*?\r?\n    \}').Value
$structs = [regex]::Matches($text, '(?m)^    \[StructLayout[^\r\n]+struct (KEYBDINPUT|MOUSEINPUT|INPUTUNION|INPUT) \{[^\r\n]+').Value -join "`n"
if (-not $method -or -not $structs) { throw 'Missing actual packet source' }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WheelPacketFixture {
$structs
  public static uint Type, Data, Flags;
  public static int Size, X, Y;
  static uint SendInput(uint count, INPUT[] inputs, int size) {
    if(count!=1 || inputs.Length!=1) throw new Exception("not one event");
    Type=inputs[0].type; Data=inputs[0].u.mi.mouseData; Flags=inputs[0].u.mi.dwFlags;
    Size=size; X=inputs[0].u.mi.dx; Y=inputs[0].u.mi.dy; return 1;
  }
$method
}
"@
foreach ($delta in @(120, -120)) {
    [void][WheelPacketFixture]::SendWheel($delta)
    $expected = if ($delta -gt 0) { [uint32]120 } else { [uint32]4294967176 }
    Check ([WheelPacketFixture]::Type -eq 0 -and [WheelPacketFixture]::Flags -eq 0x0800 -and
        [WheelPacketFixture]::Data -eq $expected -and [WheelPacketFixture]::X -eq 0 -and [WheelPacketFixture]::Y -eq 0 -and
        [WheelPacketFixture]::Size -eq $(if ([IntPtr]::Size -eq 8) { 40 } else { 28 })) ('actual wheel-only packet ' + $delta)
}

# Execute only the actual wheel ask clause, with synthetic request/plan/process.
$clause = $null
foreach ($node in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.IfStatementAst] }, $true)) {
    foreach ($candidate in $node.Clauses) {
        if ($candidate.Item1.Extent.Text -eq "`$o.do -eq 'wheel'") { $clause = $candidate.Item2.Extent.Text }
    }
}
if (-not $clause) { throw 'Missing planned-wheel dispatch' }
$clause = $clause.Substring(1, $clause.Length - 2)
function Say { }
$proc = [pscustomobject]@{ MainWindowHandle = [IntPtr]42 }
$stepsJson = @{ steps = @(@{ do = 'wheel'; delta = 120; cameraTrace = $true }, @{ do = 'key'; delta = 120; cameraTrace = $true }) }
$wheelRequests = [Collections.Generic.HashSet[int]]::new()
$reply = @{}
$runId = 'synthetic-run'
$o = [pscustomobject]@{ i = 0; arg = 120; run = $runId }
Reset-Fixture
& ([scriptblock]::Create($clause))
Check ($reply.ok -and [ThornswoodRealClient.Win]::Calls -eq 1) 'only the unused opted-in planned wheel is routed'
& ([scriptblock]::Create($clause))
Check (-not $reply.ok -and [ThornswoodRealClient.Win]::Calls -eq 1) 'replayed plan step cannot send again'
foreach ($index in @(-1, 1, 2, '0.5')) {
    $o.i = $index
    & ([scriptblock]::Create($clause))
    Check (-not $reply.ok -and [ThornswoodRealClient.Win]::Calls -eq 1) ('foreign plan step refused ' + $index)
}
$wheelRequests.Clear()
$o.i = 0
$o.run = 'foreign-run'
& ([scriptblock]::Create($clause))
Check (-not $reply.ok -and [ThornswoodRealClient.Win]::Calls -eq 1) 'foreign run cannot send a planned wheel'
Write-Output ($passed.ToString() + ' passed, 0 failed; managed fixtures only, no physical input')
