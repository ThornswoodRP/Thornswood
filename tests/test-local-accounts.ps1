<#
  test-local-accounts.ps1

      pwsh -NoProfile -File .\tests\test-local-accounts.ps1

  Every local account a script makes or changes fits what Windows takes.

  WHY. New-LocalUser and Set-LocalUser refuse a description over 48
  characters and a name over 20. A script that breaks either stops on the box
  halfway through its install: Install-Runner.ps1 did on 25 Sep, and
  Install-Gate.ps1 (#2841) did on 29 Oct with a 77 character description, after
  making its folder and before making its account. Neither can be seen without
  running the script on Windows, so this reads them.

  HOW. Reads every .ps1 under scripts\ as text, since most of these calls sit
  in a script sent to the box as a string. On each line that calls
  New-LocalUser or Set-LocalUser, -Description must be one quoted literal of
  48 characters or fewer, and a -Name given as a literal must be 20 or fewer.
  A copy of Install-Gate's old line is planted to show the check catches it.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# What is wrong with one line, or nothing.
function Get-AccountLineFault([string]$line) {
    $faults = @()
    $d = [regex]::Match($line, '-Description\s+(\S)')
    if ($d.Success) {
        $lit = [regex]::Match($line, "-Description\s+'((?:[^']|'')*)'")
        if (-not $lit.Success) { $faults += 'its -Description is not one quoted literal, so its length cannot be read' }
        elseif ($lit.Groups[1].Value.Replace("''", "'").Length -gt 48) { $faults += ('its -Description is ' + $lit.Groups[1].Value.Replace("''", "'").Length + ' characters, over 48') }
    }
    $n = [regex]::Match($line, "-Name\s+'((?:[^']|'')*)'")
    if ($n.Success -and $n.Groups[1].Value.Length -gt 20) { $faults += ('its -Name is ' + $n.Groups[1].Value.Length + ' characters, over 20') }
    return $faults
}

$calls = 0
# Not the scripts' own harnesses in scripts\tests (#5341), which plant the very
# calls this looks for.
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '[\\/]scripts[\\/]tests[\\/]' }) {
    $rel = [IO.Path]::GetRelativePath($Repo, $f.FullName).Replace('\', '/')
    $lines = [IO.File]::ReadAllLines($f.FullName)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -notmatch '\b(New|Set)-LocalUser\b' -or $line -match '^\s*#') { continue }
        $calls++
        $faults = @(Get-AccountLineFault $line)
        Yes ("$rel line $($i + 1): " + $(if ($faults.Count) { $faults -join '; ' } else { 'fits' })) ($faults.Count -eq 0)
    }
}
Yes "the scan found the account calls (Install-Runner and Install-Gate at least; found $calls)" ($calls -ge 3)

# ---- planted ----------------------------------------------------------------------
$old = "  ``" + "`$u = New-LocalUser -Name ``" + "`$user -Password ``" + "`$pw -Description 'Thornswood deploy gate (#2841): its key runs C:\Thornswood-Gate\Gate.ps1 only'"
Yes 'planted: the 77 character description of 29 Oct is caught' (@(Get-AccountLineFault $old).Count -eq 1)
Yes 'planted: a description that is not a literal is caught' (@(Get-AccountLineFault 'New-LocalUser -Name x -Description $desc').Count -eq 1)
Yes 'planted: a name over 20 characters is caught' (@(Get-AccountLineFault "New-LocalUser -Name 'thornswood-runner-number-1'").Count -eq 1)
Yes 'planted: 48 characters exactly passes' (@(Get-AccountLineFault ("New-LocalUser -Name 'a' -Description '" + ('x' * 48) + "'")).Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
