# Actual shared release writer; owned local fixtures only. No wipe is invoked.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\ops\Release-List.ps1')
Invoke-Expression $ThornswoodReleaseList
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4488-release-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $scratch 'private'))
$file = Join-Path $scratch 'private\deleted-characters.json'
$script:passed = 0; $script:failed = 0
function Yes($name, $ok) { if ($ok) { $script:passed++; "PASS $name" } else { $script:failed++; "FAIL $name" } }
function Put($value) { [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 8 -Compress)) }
function Read { return ([IO.File]::ReadAllText($file) | ConvertFrom-Json) }
try {
  $out = @(Write-ThornswoodReleaseList -Root $scratch -ClearFreezes)
  $first = Read
  Yes 'zero-actor full wipe still writes an explicit request' ($first.clearFreezes -eq $true -and @($first.profiles).Count -eq 0 -and @($first.actors).Count -eq 0 -and $out[0] -ne 'RELEASE|none')
  $id = @($first.freezeWipeIds)[0]
  Yes 'the request has a real opaque identifier and no completed restraint mark' ($id -cmatch '^[0-9a-f]{32}$' -and $null -eq $first.done.restraints)
  Write-ThornswoodReleaseList -Root $scratch -Actors @(4278190337) | Out-Null
  $mixed = Read
  Yes 'an ordinary reset preserves an unacknowledged wipe identity' ($mixed.clearFreezes -eq $true -and @($mixed.freezeWipeIds).Count -eq 1 -and $mixed.freezeWipeIds[0] -eq $id)
  $carry = Join-Path $scratch 'private\carry.json'
  [IO.File]::WriteAllText($carry, [IO.File]::ReadAllText($file))
  Remove-Item -LiteralPath $file
  Write-ThornswoodReleaseList -Root $scratch -Actors @(4278190338) -Carry @($carry) | Out-Null
  Yes 'a set-aside pending request keeps its wipe identity through carry' ((Read).freezeWipeIds[0] -eq $id)
  Put @{ profiles = @(); actors = @(4278190337); clearFreezes = $true; freezeWipeIds = @($id); done = @{ restraints = 1 } }
  Write-ThornswoodReleaseList -Root $scratch -Actors @(4278190338) | Out-Null
  $reset = Read
  Yes 'an ordinary reset cannot inherit an acknowledged wipe' ($null -eq $reset.clearFreezes -and $null -eq $reset.freezeWipeIds)
  foreach ($bad in @(@{ clearFreezes = $true; freezeWipeIds = @('bad') }, @{ clearFreezes = 'true'; freezeWipeIds = @($id) }, @{ clearFreezes = $true; freezeWipeIds = @($id, $id) }, @{ clearFreezes = $true })) {
    $row = @{ profiles = @(); actors = @(4278190337) }
    foreach ($key in $bad.Keys) { $row[$key] = $bad[$key] }
    Put $row; $before = [IO.File]::ReadAllText($file)
    $out = @(Write-ThornswoodReleaseList -Root $scratch -Actors @(4278190338))
    Yes 'a malformed wipe request is refused without rewriting it' ($out[0] -like 'RELEASEBAD|*' -and [IO.File]::ReadAllText($file) -ceq $before)
  }
} finally {
  $absolute = [IO.Path]::GetFullPath($scratch)
  if (-not $absolute.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $absolute) -notlike 'thornswood-4488-release-*') { throw 'unowned fixture path' }
  Remove-Item -LiteralPath $absolute -Recurse -Force
}
"$script:passed passed, $script:failed failed"
if ($script:failed) { exit 1 }
