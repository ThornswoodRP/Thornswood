<#
  test-publish-old-dist.ps1

      pwsh -NoProfile -File .\scripts\tests\test-publish-old-dist.ps1

  Publish-Update.ps1 counts what is left in the old <Root>\_dist folder and
  says so. Measure-Object hands back nothing when no file comes in, and the
  script runs under Set-StrictMode -Version Latest, so reading .Sum off that
  nothing threw "The property 'Sum' cannot be found on this object" and
  stopped a main Ship before anything was published, on a machine whose old
  _dist folder was there but empty (27 Oct 2026).

  This takes the block that does the count out of Publish-Update.ps1 as it is,
  and runs it under StrictMode against:
    1. an empty old folder: no error, and it says 0.0 MB;
    2. an old folder holding one file of 2 MB: it says 2.0 MB;
    3. the old one-line count, on the empty folder: it throws, so this test
       can tell a broken count from a working one.

  Read only: it writes only under its own temp folder.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$pub = Join-Path $repo 'scripts\release\Publish-Update.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Yes 'scripts\release\Publish-Update.ps1 is there' (Test-Path -LiteralPath $pub)
if (-not (Test-Path -LiteralPath $pub)) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}

# The block from "$OldDist = Join-Path $Root '_dist'" to the closing brace of
# its if, as the file has it.
$text = [IO.File]::ReadAllText($pub)
$m = [regex]::Match($text, '(?ms)^\$OldDist = Join-Path \$Root ''_dist''\r?\n.*?^\}')
Yes 'the old _dist count is found in Publish-Update.ps1' $m.Success
if (-not $m.Success) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}
$block = $m.Value

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('old-dist-' + [guid]::NewGuid().ToString('N'))
try {
    function Run-Block([string]$root, [string]$code) {
        $out = & {
            Set-StrictMode -Version Latest
            $ErrorActionPreference = 'Stop'
            $Root = $root
            $DistDir = Join-Path $root 'new-dist'
            function Write-Host { param([Parameter(ValueFromRemainingArguments = $true)]$a) ($a | Where-Object { $_ -isnot [ConsoleColor] -and $_ -notmatch '^-' }) -join ' ' }
            Invoke-Expression $code
        } 6>&1 2>&1
        return @($out | ForEach-Object { "$_" })
    }

    # 1. empty
    $empty = Join-Path $tmp 'empty'
    New-Item -ItemType Directory -Path (Join-Path $empty '_dist') -Force | Out-Null
    $err = $null; $lines = @()
    try { $lines = Run-Block $empty $block } catch { $err = $_ }
    Yes 'an empty old _dist folder is counted without an error' ($null -eq $err)
    if ($err) { Write-Host "  $($err.Exception.Message)" }
    Yes 'and it says 0.0 MB' ((@($lines) -join "`n") -match 'still holds 0\.0 MB')

    # 2. one file of 2 MB
    $full = Join-Path $tmp 'full'
    New-Item -ItemType Directory -Path (Join-Path $full '_dist') -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $full '_dist\pack-old.zip'), (New-Object byte[] (2MB)))
    $err = $null; $lines = @()
    try { $lines = Run-Block $full $block } catch { $err = $_ }
    Yes 'an old _dist folder holding a file is counted without an error' ($null -eq $err)
    Yes 'and it says 2.0 MB' ((@($lines) -join "`n") -match 'still holds 2\.0 MB')

    # 3. the old count fails on the empty folder, so the check above can fail
    $oldCount = $block -replace '(?ms)\$oldMeasure = .*?\r?\n\s*\$oldMb = [^\r\n]*', '$oldMb = ([double](@(Get-ChildItem -LiteralPath $OldDist -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable oldUnread) | Measure-Object Length -Sum).Sum) / 1MB'
    Yes 'the planted old count is a different block' ($oldCount -ne $block)
    $err = $null
    try { Run-Block $empty $oldCount | Out-Null } catch { $err = $_ }
    Yes 'the old one-line count throws on an empty folder (the harness is not a no-op)' ($null -ne $err -and "$err" -match "property 'Sum' cannot be found")
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$self = [IO.File]::ReadAllText($MyInvocation.MyCommand.Path)
Yes 'no em dash in this harness' (-not $self.Contains([string][char]0x2014))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit $(if ($script:fail -gt 0) { 1 } else { 0 })
