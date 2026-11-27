<#
  test-4252-rollback-ui.ps1

      pwsh -NoProfile -File .\tests\test-4252-rollback-ui.ps1

  Issue #4252. scripts\release\Rollback-Feed.ps1 kept the six client runtime
  files with the launcher, which is not rolled back, and took everything else
  from the release it went back to, the in-game UI build among them. So a
  rollback past a UI change put an older build.js beside the current client,
  built from two fork commits, and the pack's SOURCE CODE.txt named the
  checkout's commit for a build.js that was not built from it.

  The UI build is build.js, the hashed assets it names and the list of them
  (Ship-Rules.ps1, "What is ours under UI"), built by every Ship from the same
  fork commit as the client. Now it stays with the client in a rollback.
  This lifts the block that decides what stays, runs it over a rollback past
  a UI change, and holds the note to what the pack carries:

    1. build.js, the hashed assets and their list stay as the feed has them;
    2. a hashed asset only the older release had is not handed out again;
    3. index.html, thornswood-* files and the game's own files go back;
    4. the six client files still stay;
    5. so the pack carries no SkyMP file, and its source note names no commit.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$RollPath = Join-Path $Repo 'scripts\release\Rollback-Feed.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

. (Join-Path $Repo 'scripts\release\Read-JsonFile.ps1')
. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
. (Join-Path $Repo 'scripts\release\Source-Notice.ps1')

$roll = [IO.File]::ReadAllText($RollPath)
$a = $roll.IndexOf('# ==== thornswood what stays with the launcher in a rollback ====')
$b = $roll.IndexOf('# ==== end thornswood what stays with the launcher in a rollback ====')
Yes 'the block that decides what stays is in Rollback-Feed.ps1' ($a -ge 0 -and $b -gt $a)
if (-not ($a -ge 0 -and $b -gt $a)) { Done }
$block = $roll.Substring($a, $b - $a)

$clientRecord = Join-Path $Repo 'records\client-build.json'
$client = @((Get-Content -LiteralPath $clientRecord -Raw | ConvertFrom-Json).files.PSObject.Properties.Name)
$plugin = 'Data\SKSE\Plugins\MpClientPlugin.dll'
$build = 'Data\Platform\UI\build.js'
$list = $ShipUiAssetsRel
$both = 'Data\Platform\UI\4b2950a2781132b82147.ttf'
$newOnly = 'Data\Platform\UI\02687b2110d1a50a6b4e194282ab8deb.svg'
$oldOnly = 'Data\Platform\UI\0123456789abcdef0123456789abcdef.png'

# The feed now, and the release gone back to: a UI change between them.
$curMap = @{
    $plugin = '10:new'; $build = '20:new'; $list = '30:new'; $both = '40:new'; $newOnly = '41:new'
    'Data\Platform\UI\index.html' = '50:new'; 'Data\Platform\UI\thornswood-hints.js' = '60:new'
    'Data\Thornswood.esp' = '70:new'
}
$tgtMap = @{
    $plugin = '10:old'; $build = '20:old'; $list = '30:old'; $both = '40:old'; $oldOnly = '42:old'
    'Data\Platform\UI\index.html' = '50:old'; 'Data\Platform\UI\thornswood-hints.js' = '60:old'
    'Data\Thornswood.esp' = '70:old'
}
Invoke-Expression $block

Yes ('1. build.js stays as the feed has it (' + $newMap[$build] + ')') ($newMap[$build] -eq '20:new')
Yes '   and so do the hashed assets build.js names, and their list' ($newMap[$both] -eq '40:new' -and $newMap[$newOnly] -eq '41:new' -and $newMap[$list] -eq '30:new')
Yes '2. a hashed asset only the older release had is not handed out again' (-not $newMap.ContainsKey($oldOnly))
Yes '3. index.html, a thornswood-* file and the plugin go back' (
    $newMap['Data\Platform\UI\index.html'] -eq '50:old' -and $newMap['Data\Platform\UI\thornswood-hints.js'] -eq '60:old' -and $newMap['Data\Thornswood.esp'] -eq '70:old')
Yes ('4. the six client files still stay (' + $client.Count + ' in the record)') ($client.Count -eq 6 -and $newMap[$plugin] -eq '10:new' -and
    @($client | Where-Object { Test-StaysWithLauncher $_ }).Count -eq 6)
Yes '   a nested file under UI is not taken as the front''s' (-not (Test-StaysWithLauncher 'Data\Platform\UI\fonts\0123456789abcdef0123456789abcdef.ttf'))

# As Rollback-Feed works out what to write.
$write = @(@($newMap.Keys | Where-Object { -not $_.StartsWith(':') -and (-not $curMap.ContainsKey($_) -or [string]$curMap[$_] -ne [string]$newMap[$_]) }) | Sort-Object)
$skymp = @($write | Where-Object { $SourceNoticeFiles.Contains($_) })
Yes ('5. the pack carries no SkyMP file (' + ($write -join ', ') + ')') ($skymp.Count -eq 0 -and $write.Count -eq 3)
$entries = @(Get-SourceNoticeEntries $clientRecord $write 'pack' (Join-Path $Repo 'installer\licences'))
Yes '   so it carries no source note naming a commit for one' ($entries.Count -eq 0)

Done
