# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Add-Type -Path (Join-Path $repo 'tools/ReleaseNotes/NoteRules.cs')   # the release note rules (#5354)
$source = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'))
$assignment = [regex]::Match($source, '(?m)^\s*\$noteProblems\s*=.*$').Value.Trim()
if (-not $assignment) { throw 'Missing production note validation' }
$Note = "Both builds now match`n- Shared townsfolk and dungeon rewards are available on both servers."
Invoke-Expression $assignment
if ($noteProblems.Count) { throw 'Valid release notes incorrectly block Dev deployment' }
Write-Host 'PASS valid notes allow Dev deployment'
foreach ($Note in "fix`n- A useful detail for the release.", "Both builds now match`n- PR #123 changes gamemode.js for players.") {
  Invoke-Expression $assignment
  if (-not $noteProblems.Count) { throw 'Invalid release notes incorrectly allow Dev deployment' }
}
Write-Host 'PASS short and technical release notes remain refused'
