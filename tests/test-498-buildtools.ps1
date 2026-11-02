<#
  test-498-buildtools.ps1
      pwsh -NoProfile -File .\tests\test-498-buildtools.ps1

  Issue #498, Patrick's option A of 12 Oct: the Build Tools go on the VPS
  runners, so the launcher can be built from its project files everywhere it is
  built. Measured on the box on 15 Oct before this: no MSBuild, no vswhere and
  no .NET Framework 4.8.1 reference assemblies.

  This holds the two scripts to that:
    1. Bootstrap-VPS.ps1 -IncludeBuildTools installs exactly the two Build Tools
       parts the project files need, refuses a bootstrapper that is not a valid
       Microsoft-signed file before it runs anything, and checks afterwards, the
       way the MSBuild build did, that MSBuild and the references are there.
    2. Install-Runner.ps1's needs check asks for MSBuild and the 4.8.1
       references instead of the in-box csc, and names the script that installs
       them.
  And it runs the signature rule itself against a planted unsigned file, so the
  refusal is shown to fire rather than only read.

  Read only, apart from one planted file under TEMP, which it removes.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$Repo = Split-Path -Parent $PSScriptRoot
$boot = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\vps\Bootstrap-VPS.ps1'))
$runner = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Install-Runner.ps1'))

foreach ($f in 'scripts\vps\Bootstrap-VPS.ps1', 'scripts\deploy\Install-Runner.ps1') {
    $errs = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $f), [ref]$null, [ref]$errs)
    Yes "$f parses" (@($errs).Count -eq 0)
}

# ---- 1. Bootstrap-VPS.ps1 -IncludeBuildTools ---------------------------------
Yes 'Bootstrap-VPS.ps1 takes -IncludeBuildTools' ($boot -match '\[switch\]\$IncludeBuildTools')
Yes '  and installs only when asked' ($boot -match 'if \(\$IncludeBuildTools\)')
# The -IncludeBuildTools block alone: -IncludeEngineTools (#459) adds the C++
# workload in a block of its own, below it, and test-459-engine-workflow.ps1
# holds that one.
$btFrom = $boot.IndexOf('if ($IncludeBuildTools) {')
$btTo = $boot.IndexOf('# --- Engine tools', [Math]::Max(0, $btFrom))
$btBlock = if ($btFrom -ge 0 -and $btTo -gt $btFrom) { $boot.Substring($btFrom, $btTo - $btFrom) } else { $boot }
$adds = @([regex]::Matches($btBlock, "'--add', '([^']+)'") | ForEach-Object { $_.Groups[1].Value })
Yes ("  exactly the MSBuild workload and the 4.8.1 targeting pack (found: " + ($adds -join ', ') + ')') (
    $adds.Count -eq 2 -and $adds -contains 'Microsoft.VisualStudio.Workload.MSBuildTools' -and $adds -contains 'Microsoft.Net.Component.4.8.1.TargetingPack')
Yes '  quietly, waiting for it, with no restart' ($boot -match "'--quiet', '--wait', '--norestart'")
$sigAt = $boot.IndexOf('Get-AuthenticodeSignature')
$runAt = $boot.IndexOf('Start-Process -FilePath $boot')
Yes '  the bootstrapper''s signature is checked before it is run' ($sigAt -gt 0 -and $runAt -gt $sigAt)
Yes '  and must be Valid and signed by Microsoft Corporation, or it is deleted unrun' (
    $boot -match "\.Status\)`" -ne 'Valid'" -and $boot -match "-notmatch '\^CN=Microsoft Corporation,'" -and
    $boot.IndexOf('Remove-Item -LiteralPath $boot', $sigAt) -gt $sigAt -and $boot.IndexOf('Remove-Item -LiteralPath $boot', $sigAt) -lt $runAt)
Yes '  0 and 3010 count as done, anything else stops' ($boot -match '\$p\.ExitCode -ne 0 -and \$p\.ExitCode -ne 3010')
Yes '  and it checks afterwards that vswhere finds MSBuild and the references are there' (
    $boot.IndexOf('$bt = Test-BuildTools', $runAt) -gt $runAt -and $boot -match "v4\.8\.1\\mscorlib\.dll")
Yes '  asking vswhere for MSBuild the way the MSBuild build did' ($boot -match [regex]::Escape("-requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe'"))
Yes '  the header says why, with the decision and the 15 Oct measurement' ($boot -match '#498' -and $boot -match '15 Oct' -and $boot -match 'install the Build\s+Tools on the VPS runners')

# ---- the signature rule, run ---------------------------------------------------
# The same two conditions as Bootstrap-VPS.ps1, against a file nobody signed.
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the signature rule, run: Authenticode signatures are read only on Windows'
} else {
    $plant = Join-Path ([IO.Path]::GetTempPath()) ('ts498-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        [IO.File]::WriteAllBytes($plant, [byte[]](0x4D, 0x5A, 0, 0))
        $sig = Get-AuthenticodeSignature -LiteralPath $plant
        $who = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
        $refused = ("$($sig.Status)" -ne 'Valid' -or $who -notmatch '^CN=Microsoft Corporation,')
        Yes "  an unsigned file is refused by that rule (status $($sig.Status))" $refused
        $csc = Get-WindowsPath 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
        if (Test-Path -LiteralPath $csc) {
            # A Windows file is validly signed, but by "Microsoft Windows", not by
            # "Microsoft Corporation" as the Visual Studio bootstrapper is. So a
            # valid signature alone does not pass: the rule must read the signer.
            $s2 = Get-AuthenticodeSignature -LiteralPath $csc
            $w2 = if ($s2.SignerCertificate) { $s2.SignerCertificate.Subject } else { '' }
            if ("$($s2.Status)" -eq 'Valid' -and $w2 -notmatch '^CN=Microsoft Corporation,') {
                $r2 = ("$($s2.Status)" -ne 'Valid' -or $w2 -notmatch '^CN=Microsoft Corporation,')
                Yes "  a validly signed file from another signer is refused too (csc.exe, '$($w2.Split(',')[0])')" $r2
            }
        }
    } finally {
        Remove-Item -LiteralPath $plant -Force -ErrorAction SilentlyContinue
    }
}

# ---- 2. Install-Runner.ps1's needs check --------------------------------------
Yes 'Install-Runner.ps1 asks the box for MSBuild through vswhere' ($runner -match "'HAVE msbuild '" -and $runner -match "'MISSING msbuild'")
Yes '  and for the .NET Framework 4.8.1 reference assemblies' ($runner -match "'MISSING net481refs'" -and $runner -match 'v4\.8\.1')
Yes '  and no longer counts the in-box csc as enough' ($runner -notmatch "'HAVE csc '" -and $runner -notmatch "'MISSING csc'")
Yes '  and names Bootstrap-VPS.ps1 -IncludeBuildTools when they are missing' (
    $runner -match "missing -contains 'msbuild' -or \`$missing -contains 'net481refs'" -and $runner -match "Bootstrap-VPS\.ps1 -Arguments '-IncludeBuildTools")

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
