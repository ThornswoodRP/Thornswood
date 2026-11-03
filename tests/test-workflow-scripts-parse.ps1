<#
  test-workflow-scripts-parse.ps1

      pwsh -NoProfile -File .\tests\test-workflow-scripts-parse.ps1

  Every PowerShell step in .github\workflows parses as PowerShell. On 3 Nov
  2026 the first run of promote-main.yml stopped before it checked anything:
  "dev ran $tag: Deployment" reads $tag: as a drive-qualified variable, a
  parse error, so the whole step failed, and no harness had read the step as
  PowerShell. A workflow's script runs only on GitHub, often only by hand,
  so a parse error there is found by the one run that needed it.

  Checks:
    - each `run: |` step whose shell is pwsh or powershell, with GitHub's
      ${{ }} expressions stood in by a word, parses with no error;
    - the reading finds steps at all, and promote-main.yml's among them;
    - the reading itself catches the 3 Nov line, so a pass means something.

  Read only. Exit 1 when any check fails.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Indent([string]$l) { return $l.Length - $l.TrimStart().Length }

# The PowerShell steps of one workflow file: its name, the line its script
# starts on, and the script.
function Get-PwshSteps([string]$path) {
    $lines = @(Get-Content -LiteralPath $path)
    $out = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^(\s*)(- )?run:\s*[|>][-+]?\s*$') { continue }
        $dashed = $Matches.ContainsKey(2)
        $key = $Matches[1].Length + $(if ($dashed) { 2 } else { 0 })
        # The step is the list item the run: key is in: from its "- " line
        # down to the next line at the dash's indent or less.
        $dash = $i
        if (-not $dashed) {
            while ($dash -gt 0 -and -not ($lines[$dash] -match '^\s*- ' -and (Indent $lines[$dash]) -lt $key)) { $dash-- }
        }
        $dashInd = Indent $lines[$dash]
        $end = $i + 1
        while ($end -lt $lines.Count -and ($lines[$end].Trim().Length -eq 0 -or (Indent $lines[$end]) -gt $dashInd)) { $end++ }
        $shell = ''
        for ($k = $dash; $k -lt $end; $k++) {
            if ($lines[$k] -match '^\s*(- )?shell:\s*(\S+)' -and ((Indent $lines[$k]) + $(if ($Matches.ContainsKey(1)) { 2 } else { 0 })) -eq $key) { $shell = $Matches[2] }
        }
        if ($shell -notin 'pwsh', 'powershell') { continue }
        $body = @(); $ind = -1; $j = $i + 1
        while ($j -lt $lines.Count) {
            $l = $lines[$j]
            if ($l.Trim().Length -eq 0) { $body += ''; $j++; continue }
            if ($ind -lt 0) { $ind = Indent $l }
            if ((Indent $l) -lt $ind) { break }
            $body += $l.Substring($ind); $j++
        }
        $out += [pscustomobject]@{ File = (Split-Path -Leaf $path); Line = $i + 2; Script = ($body -join "`n") }
    }
    return , $out
}
function Get-ParseErrors([string]$script) {
    $code = [regex]::Replace($script, '\$\{\{.*?\}\}', 'expr')
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors)
    return , @($errors)
}

$steps = @()
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $Repo '.github\workflows') -File | Where-Object { $_.Extension -in '.yml', '.yaml' }) {
    $steps += Get-PwshSteps $f.FullName
}
Yes ("the workflows' PowerShell steps are read (" + $steps.Count + ' of them)') ($steps.Count -gt 50)
Yes 'promote-main.yml''s steps are among them' (@($steps | Where-Object File -eq 'promote-main.yml').Count -ge 2)

$broken = @()
foreach ($s in $steps) {
    foreach ($e in (Get-ParseErrors $s.Script)) {
        $broken += ('{0}:{1}: {2}' -f $s.File, ($s.Line + $e.Extent.StartLineNumber - 1), $e.Message)
    }
}
Yes 'every PowerShell step in the workflows parses' ($broken.Count -eq 0)
foreach ($b in $broken) { Write-Host "      $b" }

# The line that stopped promote-main.yml on 3 Nov, through the same reading.
$caught = Get-ParseErrors ('$tag = ''build-1''' + "`n" + 'Write-Host "dev ran $tag: Deployment ${{ github.run_id }}"')
Yes 'the reading catches "$tag:" in a string, the 3 Nov parse error' ($caught.Count -gt 0)
$fixed = Get-ParseErrors ('$tag = ''build-1''' + "`n" + 'Write-Host "dev ran ${tag}: Deployment ${{ github.run_id }}"')
Yes 'and passes it written as ${tag}:' ($fixed.Count -eq 0)

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
