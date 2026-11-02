<#
  test-native-stderr.ps1

      powershell -NoProfile -File .\tests\test-native-stderr.ps1
      pwsh -NoProfile -File .\tests\test-native-stderr.ps1

  Native programs other than git, run under $ErrorActionPreference = 'Stop'.
  Windows PowerShell 5.1 turns any stderr line into a terminating
  NativeCommandError, even through 2>$null or 2>&1, so these stopped before
  reading the exit code:
    1. Sign-Artifact.ps1: signtool's "SignTool Error" ended the script at the
       first failed file, with no count, no next file and no read-back.
    2. Install-Runner.ps1 Invoke-Gh: a notice gh writes on stderr stopped a call
       that succeeded; a failure came out as NativeCommandError, not its message.
  The third, the old installer's stub signature strip in
  Package-Thornswood.ps1, went with that installer (#4824).
  Stub executables only: one small console program, compiled here with the
  .NET Framework compiler, prints what STUB_OUT and STUB_ERR say and exits
  with STUB_CODE. No real signtool, gh, GitHub or network.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the stand-in program is built with the .NET Framework csc, and what it proves is how Windows PowerShell 5.1 takes stderr, so this runs only on Windows'; exit 0 }
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-native-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($T)
$keep = @{ OUT = $env:STUB_OUT; ERR = $env:STUB_ERR; CODE = $env:STUB_CODE; PATH = $env:Path }
function Stub([string]$out, [string]$err, [int]$code) { $env:STUB_OUT = $out; $env:STUB_ERR = $err; $env:STUB_CODE = [string]$code }
try {
    $csc = Get-WindowsPath 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $csc)) { $csc = Get-WindowsPath 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    $src = Join-Path $T 'stub.cs'
    [IO.File]::WriteAllText($src, @"
using System;
static class P { static int Main(string[] a) {
  string o = Environment.GetEnvironmentVariable("STUB_OUT"), e = Environment.GetEnvironmentVariable("STUB_ERR"), c = Environment.GetEnvironmentVariable("STUB_CODE");
  if (!string.IsNullOrEmpty(o)) Console.Out.WriteLine(o);
  if (!string.IsNullOrEmpty(e)) Console.Error.WriteLine(e);
  int n = 0; int.TryParse(c, out n); return n; } }
"@)
    $stubExe = Join-Path $T 'stub.exe'
    & $csc /nologo /out:$stubExe $src | Out-Null
    Yes 'the stand-in program compiled' (Test-Path -LiteralPath $stubExe)

    # ---- 1. Sign-Artifact --------------------------------------------------------
    # signtool is looked for under Program Files\Windows Kits\10\bin\...\x64; the
    # child gets both Program Files pointed at a scratch folder holding the stub.
    $pf = Join-Path $T 'pf'
    $kit = Join-Path $pf 'Windows Kits\10\bin\10.0.1\x64'
    [void][IO.Directory]::CreateDirectory($kit)
    [IO.File]::Copy($stubExe, (Join-Path $kit 'signtool.exe'))
    $cfg = Join-Path $T 'signing.json'
    [IO.File]::WriteAllText($cfg, '{"method":"thumbprint","thumbprint":"0123456789ABCDEF0123456789ABCDEF01234567","timestampUrl":"http://timestamp.invalid"}')
    $a = Join-Path $T 'a.exe'; $b = Join-Path $T 'b.exe'
    [IO.File]::Copy($stubExe, $a); [IO.File]::Copy($stubExe, $b)
    function Sign {
        $ErrorActionPreference = 'Continue'
        $pfWas = $env:ProgramFiles; $x86Was = ${env:ProgramFiles(x86)}
        $env:ProgramFiles = $pf; ${env:ProgramFiles(x86)} = $pf
        $q = { param($x) "'" + $x.Replace("'", "''") + "'" }
        $cmd = "& {0} -Path {1},{2} -ConfigPath {3}; exit `$LASTEXITCODE" -f (& $q (Join-Path $Repo 'scripts\release\Sign-Artifact.ps1')), (& $q $a), (& $q $b), (& $q $cfg)
        try { $o = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String }
        finally { $env:ProgramFiles = $pfWas; ${env:ProgramFiles(x86)} = $x86Was }
        return @{ Code = $LASTEXITCODE; Out = $o }
    }
    Stub 'Done Adding Additional Store' 'SignTool Error: No certificates were found that met all the given criteria.' 1
    $r = Sign
    Yes 'Sign-Artifact uses the stand-in signtool' ($r.Out -match [regex]::Escape($kit))
    Yes '  a failing signtool is reported by its exit code, for each file' (([regex]::Matches($r.Out, 'signtool exited with 1 on')).Count -eq 2)
    Yes '  its error line is shown, and no NativeCommandError' ($r.Out -match 'SignTool Error' -and $r.Out -notmatch 'NativeCommandError')
    Yes ("  and the script exits 1 ({0})" -f $r.Code) ($r.Code -eq 1)
    Stub 'Successfully signed' 'SignTool Warning: the timestamp server took a while' 0
    $r = Sign
    Yes 'a warning on stderr with exit 0 goes on to read the signature back' ($r.Out -match 'still reports NotSigned after signing' -and $r.Out -notmatch 'NativeCommandError')

    # ---- 2. Install-Runner Invoke-Gh ---------------------------------------------
    $bin = Join-Path $T 'bin'
    [void][IO.Directory]::CreateDirectory($bin)
    [IO.File]::Copy($stubExe, (Join-Path $bin 'gh.exe'))
    $env:Path = $bin + ';' + $env:Path
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\deploy\Install-Runner.ps1'), [ref]$null, [ref]$null)
    $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Gh' }, $true)
    Yes 'Invoke-Gh lifted out of Install-Runner.ps1' ($null -ne $fn)
    . ([scriptblock]::Create($fn.Extent.Text))
    $ErrorActionPreference = 'Stop'
    Yes '  the gh it finds is the stand-in' ((Get-Command gh -CommandType Application | Select-Object -First 1).Source -eq (Join-Path $bin 'gh.exe'))
    Stub '{"total_count":0,"runners":[]}' 'A new release of gh is available: 2.0.0 -> 2.1.0' 0
    $o = $null; $threw = ''
    try { $o = Invoke-Gh api 'repos/x/y/actions/runners' } catch { $threw = $_.FullyQualifiedErrorId + ' ' + $_.Exception.Message }
    Yes ("under Stop, a notice on stderr with exit 0 hands back gh's output ({0})" -f $(if ($threw) { $threw } else { 'ok' })) (-not $threw -and (($o | Out-String) -match 'total_count'))
    Stub '' 'HTTP 404: Not Found' 1
    $threw = ''
    try { $null = Invoke-Gh api 'repos/x/y/actions/runners' } catch { $threw = $_.Exception.Message }
    Yes ("a failure throws Invoke-Gh's own message ({0})" -f $threw) ($threw -match '^gh api repos/x/y/actions/runners failed$')
    Yes '  and the caller''s Stop is as it was' ($ErrorActionPreference -eq 'Stop')
}
finally {
    $env:STUB_OUT = $keep.OUT; $env:STUB_ERR = $keep.ERR; $env:STUB_CODE = $keep.CODE; $env:Path = $keep.PATH
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }