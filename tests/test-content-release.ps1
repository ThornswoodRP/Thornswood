# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Ship-Rules.ps1')
$pass = 0; $fail = 0
function Yes($label, $ok) {
    if($ok) { $script:pass++; Write-Host "PASS  $label" }
    else { $script:fail++; Write-Host "FAIL  $label" }
}
# Publish-Update packs what the feed carries, and Velopack's Setup.exe installs
# those packs, so its Test-FromCollection decides for both. The old installer's
# own copy in Package-Thornswood.ps1 went with it (#4824).
foreach($name in 'Publish-Update.ps1') {
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "scripts\release\$name"),[ref]$tokens,[ref]$errors)
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-FromCollection'},$true)
    . ([scriptblock]::Create($function.Extent.Text))
    $vortexFiles=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [void]$vortexFiles.Add('Data\Thornswood-Content.esp')
    [void]$vortexFiles.Add('Data\AnotherMod.esp')
    foreach($Dev in $false,$true) {
        Yes "$name includes our completed Content update on channel Dev=$Dev" (-not (Test-FromCollection 'Data\Thornswood-Content.esp'))
        Yes "$name still leaves the other author's plugin to the collection" (Test-FromCollection 'Data\AnotherMod.esp')
    }
}
$scratch=Join-Path ([IO.Path]::GetTempPath()) ('content-release-'+[Guid]::NewGuid().ToString('N'))
try {
    $fixtureRepo=Join-Path $scratch 'repo'
    $game=Join-Path $scratch 'Game'
    $source=Join-Path $fixtureRepo 'game\content\Thornswood-Content.esp'
    $dest=Join-Path $game 'Data\Thornswood-Content.esp'
    $staged=Join-Path $scratch 'staged.esp'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $source))
    [void][IO.Directory]::CreateDirectory((Join-Path $fixtureRepo 'game\required-data'))
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dest))
    [IO.File]::WriteAllText($source,'completed owned Content')
    [IO.File]::WriteAllText($staged,'published collection base')
    New-Item -ItemType HardLink -Path $dest -Value $staged | Out-Null
    $placed=@(Ensure-ShipRequiredData $game $fixtureRepo)
    Yes 'the committed Content update is placed before either pack scan' ([IO.File]::ReadAllText($dest) -eq 'completed owned Content')
    Yes 'placing it breaks the hard link and preserves the collection base' ([IO.File]::ReadAllText($staged) -eq 'published collection base')
    Yes 'the placement names the updated plugin' ($placed -contains 'Data\Thornswood-Content.esp')
    Yes 'a second placement is a no-op' (@(Ensure-ShipRequiredData $game $fixtureRepo).Count -eq 0)
} finally {
    if([IO.Path]::GetFullPath($scratch).StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
Write-Host "$pass passed, $fail failed"
if($fail) { exit 1 }
