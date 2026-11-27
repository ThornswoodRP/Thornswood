<#
  test-4570-ready-wait-callers.ps1

      pwsh -NoProfile -File .\tests\test-4570-ready-wait-callers.ps1

  Issue #4570. ServerReadyWait.ps1's header names who takes it, because the
  file is sent to the box and has to stay ASCII for that. It named Swap.ps1,
  Publish-Server.ps1 and Install-ThornswoodServer.ps1, and left out
  Reset-Character.ps1, which reads it as text and runs it on the box inside
  its own script, with no -Wait of its own.

  This finds every script that dot-sources ServerReadyWait.ps1 or reads its
  text, and checks the header names each, and that one that sends the text
  is named among those that do. Read only.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$file = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'ServerReadyWait.ps1')
$text = [IO.File]::ReadAllText($file)
$head = $text.Substring(0, $text.IndexOf('#>'))
# The part of the header that says who takes it, before WHAT IT WAITS FOR.
$who = $head.Substring(0, $head.IndexOf('WHAT IT WAITS FOR'))
Yes 'ServerReadyWait.ps1 stays ASCII' (-not @([IO.File]::ReadAllBytes($file) | Where-Object { $_ -gt 127 }).Count)

Push-Location $Repo
try { $all = @(git ls-files '*.ps1') } finally { Pop-Location }
$takers = @()
foreach ($rel in $all) {
    if ($rel -match '(^|/)tests?/' -or $rel -like '*/ServerReadyWait.ps1') { continue }
    $src = [IO.File]::ReadAllText([IO.Path]::Combine($Repo, $rel))
    if ($src -notmatch 'ServerReadyWait\.ps1') { continue }
    # How it takes it: its text read into the script it sends, or dot-sourced.
    $asText = ($src -match "ReadAllText\(\(Join-Path [^)]*ServerReadyWait\.ps1'\)\)") -or ($src -match 'ReadAllText\(\$readyWait\)')
    $dotted = $src -match "(?m)^\s*\.\s*\(Join-Path [^)]*'ServerReadyWait\.ps1'\)" -or $src -match "(?m)^\s*\.\s*\`$waitLib\s*$"
    if (-not ($asText -or $dotted)) { continue }
    $takers += [pscustomobject]@{ Rel = $rel; Name = [IO.Path]::GetFileName($rel); AsText = $asText }
}
Yes ('the scripts that take it are found (' + (($takers | ForEach-Object { $_.Name }) -join ', ') + ')') ($takers.Count -ge 6)
foreach ($t in $takers) {
    Yes ("the header names $($t.Name)") ($who.Contains($t.Name))
}
$textPart = [regex]::Match($who, '(?s)read as text.*?(?=\n\s*-|\n\s*tests\\)').Value
foreach ($t in @($takers | Where-Object { $_.AsText })) {
    Yes ("and names $($t.Name) among the scripts that send its text to the box") ($textPart.Contains($t.Name))
}
Yes 'Reset-Character.ps1 is one of those' (@($takers | Where-Object { $_.Name -eq 'Reset-Character.ps1' -and $_.AsText }).Count -eq 1)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
