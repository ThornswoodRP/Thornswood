# test-temp-folder.ps1
#
#     pwsh -NoProfile -File .\tests\test-temp-folder.ps1
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


# A script run from a checkout keeps its scratch in that checkout's temp
# folder (#4264): scripts\release\Get-ScratchDir.ps1 gives each run its own
# folder there, and in CI a script uses RUNNER_TEMP, which the runner empties.
# The system temp folder is emptied by nobody, so a run that stopped part way
# left its files there, and a fixed name there was shared by every checkout,
# so one run could overwrite another's file before it was sent. This fails on any
# [IO.Path]::GetTempPath(), GetTempFileName() or $env:TEMP read in the
# scripts that run from a checkout, apart from the code below that runs on
# the box or uses the system folder on purpose, each with why.
$systemTempAllowed = [ordered]@{
    'scripts/release/Get-ScratchDir.ps1'           = 'the helper itself: the system folder only when it is not in a checkout'
    'scripts/release/Build-Engine.ps1'             = 'the subst drive holds are for the whole machine on purpose, so every checkout finds them'
    'scripts/deploy/Install-ThornswoodServer.ps1'  = 'its trace function runs on the box'
    'scripts/deploy/StopAndMove.ps1'               = 'its trace function runs on the box'
    'scripts/deploy/Install-Runner.ps1'            = 'runs on the box'
    'scripts/mods/Rebuild-ContentTables.ps1'       = 'a gate verb that runs on the box'
    'scripts/mods/LoadOrder.ps1'                   = 'the collection cache is a cache kept between runs, and the box dot-sources it'
    'scripts/bot/Load-Box.ps1'                     = 'runs on the box'
    'scripts/dev/Clean-Everything.ps1'             = 'empties the temp folder on purpose'
}
function Find-SystemTemp($ast) {
    return @($ast.FindAll({ param($n)
        ($n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
         $n.Member -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
         $n.Member.Value -match '^GetTemp(Path|FileName)$') -or
        ($n -is [System.Management.Automation.Language.VariableExpressionAst] -and
         $n.VariablePath.UserPath -match '^env:(TEMP|TMP)$' -and -not (Test-TempSaveOrSet $n)) }, $true))
}
$checkout = @()
foreach ($area in 'release', 'deploy', 'ops', 'dev', 'mods', 'oneoff', 'bot') {
    $checkout += @(Get-ChildItem -LiteralPath (Join-Path (Join-Path $repo 'scripts') $area) -Recurse -File |
                   Where-Object { $_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1' })
}
Yes ('there are checkout scripts to read, ' + $checkout.Count + ' of them') ($checkout.Count -ge 100)
$found = @(); $used = @{}
foreach ($f in $checkout) {
    $rel = $f.FullName.Substring($repo.Length + 1).Replace('\', '/')
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$null)
    $hits = @(Find-SystemTemp $ast)
    if (-not $hits.Count) { continue }
    if ($systemTempAllowed.Contains($rel)) { $used[$rel] = $true; continue }
    foreach ($h in $hits) { $found += ('{0}:{1}  {2}' -f $rel, $h.Extent.StartLineNumber, $h.Extent.Text) }
}
foreach ($line in $found) { Write-Host "      $line" }
Yes 'no script run from a checkout keeps scratch in the system temp folder; it uses Get-ScratchDir.ps1, or RUNNER_TEMP in CI' ($found.Count -eq 0)
$stale = @($systemTempAllowed.Keys | Where-Object { -not $used.ContainsKey($_) })
foreach ($s in $stale) { Write-Host "      $s no longer uses the system temp folder" }
Yes 'every script on the allowed list still uses the system temp folder, so the list stays true' ($stale.Count -eq 0)
$probe = [System.Management.Automation.Language.Parser]::ParseInput(
    '$a = Join-Path ([IO.Path]::GetTempPath()) ''x''; $b = [System.IO.Path]::GetTempFileName(); $c = $env:TEMP; $d = "box: `$env:TEMP"', [ref]$null, [ref]$null)
Yes 'that scan finds both system temp calls, and lets a saved value and text for the box be' (@(Find-SystemTemp $probe).Count -eq 2)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
