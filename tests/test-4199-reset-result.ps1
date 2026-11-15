<#
  test-4199-reset-result.ps1

      pwsh -NoProfile -File .\tests\test-4199-reset-result.ps1

  Issue #4199. Throwing a character away on this machine said it worked
  when it had not:

    - scripts\ops\Reset-Character.ps1 -UseLocal ran the reset in its own
      PowerShell and never read how it ended, so it always said "Done.
      Press Play and creation runs from the top." and exited 0;
    - the reset itself said "could not move" for a change form it could not
      move and still ended 0 ("there was no character on the server to throw
      away" when none moved), so the VPS path read 0 too;
    - scripts\ops\New-Character.ps1 said "could not discard" and went on to
      "nothing changed" or "N character(s) gone" with exit 0.

  A change form that cannot be moved is made here the same way on any
  machine: a file stands where the reset's _discarded-<stamp> folder goes,
  for every second the run could take, so nothing can be moved into it.
  The -UseLocal branch is lifted from the script and run with no server
  process to stop (Get-Process stood in for), since the real one would stop
  every node on the machine. New-Character.ps1 runs whole, as
  launcher\tests\test-2673-new-character-release.ps1 runs it.

    1. Reset-Character -UseLocal: a change form it could not move exits 1,
       names it, and never says Done;
    2. and a reset that worked still says Done and exits 0;
    3. New-Character.ps1: a change form it could not discard exits 1 and
       names it, and never says the character is gone;
    4. and one that worked still ends 0, the character gone.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$ResetPs = Join-Path $Repo 'scripts\ops\Reset-Character.ps1'
$NewPs = Join-Path $Repo 'scripts\ops\New-Character.ps1'
$ListPs = Join-Path $Repo 'scripts\ops\Release-List.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4199-' + [Guid]::NewGuid().ToString('N'))
function Put([string]$path, [string]$text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text)
}
# A server folder with one character, 0.json, and the world's own form.
function Server([string]$name) {
    $root = Join-Path $T $name
    Put (Join-Path $root 'server-settings.json') '{"port":45777,"loadOrder":[]}'
    Put (Join-Path $root 'world\changeForms\0.json') '{"formDesc":"a01","profileId":5001,"appearanceDump":{"name":"A"}}'
    Put (Join-Path $root 'world\changeForms\13164_Skyrim.esm.json') '{"formDesc":"13164:Skyrim.esm","profileId":-1}'
    return $root
}
# A file where each _discarded-<stamp> folder would go, for the next three
# minutes, so no change form can be moved into it.
function Block([string]$forms) {
    $at = Get-Date
    foreach ($s in 0..180) { Put (Join-Path $forms ('_discarded-' + $at.AddSeconds($s).ToString('yyyyMMdd-HHmmss'))) 'in the way' }
}
function Run([string]$file, [string[]]$arg) {
    $said = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @arg 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
}

# ---- the -UseLocal branch, lifted --------------------------------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ResetPs, [ref]$tokens, [ref]$errors)
Yes 'Reset-Character.ps1 parses' (@($errors).Count -eq 0)
$bodyAssign = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$body' }, $true))
$useLocal = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and "$($n.Clauses[0].Item1)" -eq '$UseLocal' }, $true))
Yes 'the reset''s body and its -UseLocal branch are found' ($bodyAssign.Count -eq 1 -and $useLocal.Count -eq 1)
function Run-UseLocal([string]$root) {
    $f = Join-Path $T ('uselocal-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    $text = @"
`$ErrorActionPreference = 'Stop'
. '$ListPs'
`$body = $($bodyAssign[0].Right.Extent.Text)
`$Local = '$root'
`$NoPause = `$true
`$stopAndMove = '$(Join-Path $Repo 'scripts\deploy\StopAndMove.ps1')'
function Say(`$m, `$c) { Write-Host `$m }
function Head(`$m) { Write-Host `$m }
function Die(`$m) { Write-Host ('STOP. ' + `$m); exit 1 }
# No server process here: the real one would stop every node on this machine.
function Get-Process { }
if (`$true) $($useLocal[0].Clauses[0].Item2.Extent.Text)
exit 0
"@
    [IO.File]::WriteAllText($f, $text)
    return (Run $f @())
}

try {
    # ---- 1. a reset whose move fails -------------------------------------------------
    $bad = Server 'reset-blocked'
    Block (Join-Path $bad 'world\changeForms')
    $r = Run-UseLocal $bad
    Yes ('1. -UseLocal with a change form it could not move exits 1 (exit ' + $r.Code + ')') ($r.Code -eq 1)
    Yes '   and names it' ($r.Said -match 'could not move 0\.json')
    Yes '   and never says Done' ($r.Said -notmatch 'Done\. Press Play')
    Yes '   and the character is still there' (Test-Path -LiteralPath (Join-Path $bad 'world\changeForms\0.json'))
    if ($r.Code -ne 1) { Write-Host ('      it said: ' + ($r.Said -replace "`n", ' / ')) }

    # ---- 2. a reset that works --------------------------------------------------------
    $good = Server 'reset-good'
    $r = Run-UseLocal $good
    Yes ('2. -UseLocal whose reset worked says Done and exits 0 (exit ' + $r.Code + ')') ($r.Code -eq 0 -and $r.Said -match 'Done\. Press Play')
    Yes '   and the character is gone, the world''s form kept' (
        -not (Test-Path -LiteralPath (Join-Path $good 'world\changeForms\0.json')) -and
        (Test-Path -LiteralPath (Join-Path $good 'world\changeForms\13164_Skyrim.esm.json')))
    if ($r.Code -ne 0) { Write-Host ('      it said: ' + ($r.Said -replace "`n", ' / ')) }

    # ---- 3. New-Character whose discard fails ----------------------------------------
    $badNew = Server 'new-blocked'
    $forms = Join-Path $badNew 'world\changeForms'
    Block $forms
    $r = Run $NewPs @('-World', $forms)
    Yes ('3. New-Character with a change form it could not discard exits 1 (exit ' + $r.Code + ')') ($r.Code -eq 1)
    Yes '   and names it' ($r.Said -match 'could not discard 0\.json')
    Yes '   and never says the character is gone' ($r.Said -notmatch 'character\(s\) gone')
    if ($r.Code -ne 1) { Write-Host ('      it said: ' + ($r.Said -replace "`n", ' / ')) }

    # ---- 4. New-Character that works ---------------------------------------------------
    $goodNew = Server 'new-good'
    $forms = Join-Path $goodNew 'world\changeForms'
    $r = Run $NewPs @('-World', $forms)
    Yes ('4. New-Character whose discard worked exits 0, the character gone (exit ' + $r.Code + ')') (
        $r.Code -eq 0 -and $r.Said -match '1 character\(s\) gone' -and -not (Test-Path -LiteralPath (Join-Path $forms '0.json')))
    if ($r.Code -ne 0) { Write-Host ('      it said: ' + ($r.Said -replace "`n", ' / ')) }
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
