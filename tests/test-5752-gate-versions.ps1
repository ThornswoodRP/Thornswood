<#
  test-5752-gate-versions.ps1

      pwsh -NoProfile -File .\tests\test-5752-gate-versions.ps1

  Issue #5752. A Linux gate share's pwsh aborted with exit 134 on an
  assembly name garbled in memory, in a share that had passed minutes before
  on the same image, and which PowerShell and .NET each share ran was only in
  the job log, which no Bot can read. scripts\dev\Run-Gate.ps1 now writes a
  ::notice on every share run, before its harnesses, naming PowerShell, .NET,
  the OS and GitHub's image. This holds Get-RunnerSaid, taken out of
  Run-Gate.ps1 as written:

    1. it names this PowerShell's version, this .NET and this OS;
    2. on GitHub's runner, the image from ImageOS and ImageVersion; off it,
       no image;
    3. a % or a new line in a value cannot cut or garble the notice;
    4. Run-Gate.ps1 writes it for every share, after the pick's exit and
       before it runs any harness.

  Read only.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$gate = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Run-Gate.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$ast = [Management.Automation.Language.Parser]::ParseFile($gate, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-RunnerSaid' }, $true)
Yes 'Run-Gate.ps1 has Get-RunnerSaid' ($null -ne $fn)
if ($null -ne $fn) {
    . ([scriptblock]::Create($fn.Extent.Text))
    $was = @{ ImageOS = $env:ImageOS; ImageVersion = $env:ImageVersion }
    try {
        $env:ImageOS = $null; $env:ImageVersion = $null
        $off = Get-RunnerSaid 'Linux Gate harnesses, share 3 of 4'
        $net = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
        $os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription.Trim()
        Yes ('1. it names PowerShell, .NET and the OS (' + $off + ')') (
            $off -eq ('::notice title=Gate runner::Linux Gate harnesses, share 3 of 4 ran on PowerShell ' + $PSVersionTable.PSVersion + ', ' + $net.Replace('%', '%25') + ', ' + $os.Replace('%', '%25')))
        Yes '2. off GitHub''s runner it names no image' ($off -notmatch 'image ')
        $env:ImageOS = 'ubuntu26'; $env:ImageVersion = '20261101.186.1'
        $on = Get-RunnerSaid 'Gate harnesses, share 1 of 5'
        Yes ('2. on GitHub''s runner it names the image (' + $on + ')') ($on.EndsWith(', image ubuntu26 20261101.186.1'))
        $env:ImageVersion = "50%`nsplit"
        $odd = Get-RunnerSaid 'Gate harnesses'
        Yes ('3. a % and a new line go in encoded, on one line (' + $odd + ')') ($odd.EndsWith('image ubuntu26 50%25%0Asplit') -and $odd -notmatch "`n")
    } finally { $env:ImageOS = $was.ImageOS; $env:ImageVersion = $was.ImageVersion }
}

$text = [IO.File]::ReadAllText($gate)
$atPickExit = $text.IndexOf("Set-StepOutput 'whole' `$(if (`$whole) { 'true' } else { 'false' })`n    exit 0")
$atSaid = $text.IndexOf('Write-Host (Get-RunnerSaid')
$atRun = $text.IndexOf("& (Join-Path `$Here 'Nightly-Harnesses.ps1') @with")
Yes ('4. Run-Gate.ps1 says it for every share, after the pick and before any harness (' + $atPickExit + ' < ' + $atSaid + ' < ' + $atRun + ')') ($atPickExit -gt 0 -and $atSaid -gt $atPickExit -and $atRun -gt $atSaid)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
