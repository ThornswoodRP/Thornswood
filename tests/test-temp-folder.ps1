# test-temp-folder.ps1
#
#     pwsh -NoProfile -File .\tests\test-temp-folder.ps1
#     powershell -NoProfile -File .\tests\test-temp-folder.ps1
#
# The deploy, release and ops scripts run on any developer's machine, and
# since #2903 on a Linux cloud machine too. There $env:TEMP is not set, so
# Join-Path $env:TEMP threw "Cannot bind argument to parameter 'Path' because
# it is null" (measured 20 Oct: Deploy-DevGamemode.ps1 -LoadOrder stopped
# that way from the cloud, after sending the gamemode to the box's store).
# [IO.Path]::GetTempPath() is the same folder on Windows and the system's on
# Linux. This reads every script in those three folders with the PowerShell
# parser and fails on any $env:TEMP or $env:TMP that this machine would read;
# text sent to the box, which is Windows, is not code here and does not count.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$files = @()
foreach ($area in 'deploy', 'release', 'ops') {
    $files += @(Get-ChildItem -LiteralPath (Join-Path (Join-Path $repo 'scripts') $area) -Recurse -File |
                Where-Object { $_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1' })
}
Yes ('there are scripts to read, ' + $files.Count + ' of them') ($files.Count -ge 50)

$found = @()
foreach ($f in $files) {
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
    $reads = $ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $n.VariablePath.UserPath -match '^env:(TEMP|TMP)$' }, $true)
    foreach ($r in $reads) {
        $found += ('{0}:{1}  {2}' -f $f.FullName.Substring($repo.Length + 1), $r.Extent.StartLineNumber, $r.Extent.Text)
    }
}
foreach ($line in $found) { Write-Host "      $line" }
Yes 'no deploy, release or ops script reads $env:TEMP or $env:TMP; [IO.Path]::GetTempPath() is the temp folder on every machine' ($found.Count -eq 0)

# The scan has to see a read for that to mean anything.
$probe = [System.Management.Automation.Language.Parser]::ParseInput('$a = Join-Path $env:TEMP ''x''; $b = "box: `$env:TEMP"', [ref]$null, [ref]$null)
$probeReads = @($probe.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $n.VariablePath.UserPath -match '^env:(TEMP|TMP)$' }, $true))
Yes 'the scan finds a read of $env:TEMP, and not one written for the box with a backtick' ($probeReads.Count -eq 1)

# The harnesses too (#2965): they run in cloud sessions on Linux as well as on
# the Windows runners, and a harness that joined onto $env:TEMP stopped there
# the same way. A harness may still set TEMP for the script it runs, and keep
# the old value to put back: $env:TEMP = ..., $old = $env:TEMP, and a
# hashtable value @{ TEMP = $env:TEMP }. Any other read is a path built on a
# variable only Windows sets.
function Test-TempSaveOrSet($n) {
    $p = $n.Parent
    if ($p -is [System.Management.Automation.Language.AssignmentStatementAst] -and $p.Left -eq $n) { return $true }
    if ($p -is [System.Management.Automation.Language.CommandExpressionAst] -and $p.Expression -eq $n) {
        $q = $p.Parent
        if ($q -is [System.Management.Automation.Language.AssignmentStatementAst] -and $q.Right -eq $p) { return $true }
        if ($q -is [System.Management.Automation.Language.PipelineAst] -and $q.PipelineElements.Count -eq 1 -and
            $q.Parent -is [System.Management.Automation.Language.HashtableAst]) { return $true }
    }
    return $false
}
function Find-TempPathReads($ast) {
    return @($ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $n.VariablePath.UserPath -match '^env:(TEMP|TMP)$' }, $true) | Where-Object { -not (Test-TempSaveOrSet $_) })
}
# In tests and beside each product, in its own tests folder (plan line 42).
. (Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Harness-Files.ps1')
$harnesses = @(@(Join-Path $repo 'tests') + @(Get-ProductTestFolders $repo | ForEach-Object { $_.Path }) | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Recurse -File } | Where-Object { $_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1' })
Yes ('there are harnesses to read, ' + $harnesses.Count + ' of them') ($harnesses.Count -ge 100)
$found = @()
foreach ($f in $harnesses) {
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
    foreach ($r in (Find-TempPathReads $ast)) {
        $found += ('{0}:{1}  {2}' -f $f.FullName.Substring($repo.Length + 1), $r.Extent.StartLineNumber, $r.Parent.Extent.Text)
    }
}
foreach ($line in $found) { Write-Host "      $line" }
Yes 'no harness builds a path on $env:TEMP or $env:TMP; it may only set them for what it runs and put them back' ($found.Count -eq 0)
$probe = [System.Management.Automation.Language.Parser]::ParseInput(
    '$old = $env:TEMP; $env:TEMP = $t; $s = @{ TMP = $env:TMP }; $env:TMP = $env:TEMP; $w = Join-Path $env:TEMP ''x''; New-Item -Path $env:TMP', [ref]$null, [ref]$null)
$probeFound = @(Find-TempPathReads $probe | ForEach-Object { $_.Parent.Extent.Text })
Yes ('the harness scan lets a save, a set and a put back be, and finds the two paths built on them' + $(if ($probeFound.Count -ne 2) { ': ' + ($probeFound -join ' | ') } else { '' })) (
    $probeFound.Count -eq 2 -and $probeFound[0] -like 'Join-Path*' -and $probeFound[1] -like 'New-Item*')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
