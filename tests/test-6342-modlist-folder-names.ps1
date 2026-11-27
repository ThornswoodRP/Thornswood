<#
  test-6342-modlist-folder-names.ps1

      pwsh -NoProfile -File .\tests\test-6342-modlist-folder-names.ps1

  Install-NexusRevision.ps1 -Modlist names each mod's folder in
  thornswood.wabbajack (mods\<name>\...) from the mod's name (#6342). It took
  out <>:"/\|?*, control characters and trailing dots and spaces, but let a
  Windows device name through: CON, PRN, AUX, NUL, COM1 to COM9 and LPT1 to
  LPT9, in any case, alone or before an extension. Windows makes no folder
  by such a name, so a mod named "Aux" or "nul.txt" gave a modlist the
  launcher could not install.

  WHAT IT HOLDS: Get-ModlistFolderName, read out of the script itself, gives
  the existing "Mod <file id>" for a device name, any case, with or without
  an extension or a space before it, and for a name that strips to nothing;
  it leaves every other name as it was, a device name inside a longer word
  too; and the modlist step names its folders with it.

  Reads the repository only; writes nothing.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$detail = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($detail) { Write-Host "      $detail" } }
}

$path = Join-Path $Repo 'scripts/release/Install-NexusRevision.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ModlistFolderName' }, $true)
Yes 'Install-NexusRevision.ps1 has Get-ModlistFolderName' ($null -ne $fn)
if ($null -eq $fn) { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1 }
. ([scriptblock]::Create($fn.Extent.Text))

foreach ($n in 'Aux', 'CON', 'prn', 'nUl', 'COM1', 'com9', 'LPT1', 'Lpt9', 'nul.txt', 'Con.tar.gz', 'AUX .esp', 'Aux.', 'nul ') {
    $got = Get-ModlistFolderName $n 123456
    Yes ("'" + $n + "' becomes 'Mod 123456'") ($got -eq 'Mod 123456') ("got '" + $got + "'")
}
Yes 'a name that strips to nothing becomes Mod <file id>, as before' ((Get-ModlistFolderName '?*:' 7) -eq 'Mod 7')
foreach ($n in 'Auxiliary Armors', 'Console Tweaks', 'COM10', 'LPT0', 'Null Pointer', 'Nul Point.esp', 'Common Clothes and Armors') {
    $got = Get-ModlistFolderName $n 1
    Yes ("'" + $n + "' is kept") ($got -eq $n) ("got '" + $got + "'")
}
Yes 'the characters Windows refuses still go, and trailing dots and spaces' ((Get-ModlistFolderName 'A <B>: C?. ' 1) -eq 'A B C')

$text = [IO.File]::ReadAllText($path)
Yes 'the modlist step names each folder with it' ($text.Contains('$nm = Get-ModlistFolderName $e.Name $e.FileId'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
