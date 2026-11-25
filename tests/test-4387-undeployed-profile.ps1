<#
  test-4387-undeployed-profile.ps1

      pwsh -NoProfile -File .\tests\test-4387-undeployed-profile.ps1

  #4387. Ship's load order check and Check-ShipReady passed a Thornswood
  Vortex profile that holds no plugins.txt, which is a profile the
  collection was never deployed into. Get-VortexProfileDir handed back the
  profile folder whether or not it held plugins.txt (and the first folder it
  found, though a later one held it), so Assert-VortexProfile passed.
  Get-LoadOrderCopyDiffs skipped every copy whose file was missing and said
  nothing when fewer than two were left, so Ship printed in green that the
  copies agree; and a copy that is there but cannot be read came back as a
  difference at index 0 against an empty list.

  WHAT THIS HOLDS, with a scratch Vortex profile tree under a scratch
  APPDATA and scratch plugin lists, never Vortex or Patrick's profile:
    1. a Thornswood profile with no plugins.txt stops Assert-VortexProfile,
       and the message says to deploy it
    2. a deployed one is found, by name, and a later folder that holds
       plugins.txt wins over an earlier one that does not
    3. Check-ShipReady's Vortex row asks Assert-VortexProfile, so it fails
       the same profile with the same step
    4. the copy check names a copy that is not there and one that cannot be
       read, says when too few copies were there to compare, and asks
       nothing when it is given none

  -Repo points it at another checkout, which is how it was shown to fail on
  main before the change. Nothing leaves this machine.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$utf8 = New-Object Text.UTF8Encoding($false)
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4387-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

# A scratch APPDATA: Vortex's state text names each profile id with its
# name, as test-4804 lays it out; $ids are folders under profiles, and
# $deployed the ones that get a plugins.txt.
function New-Appdata([string]$name, [string[]]$ids, [string[]]$deployed) {
    $app = Join-Path $T $name
    $state = ($ids | ForEach-Object { '{"profileId":"' + $_ + '","profileName":"Thornswood"}' }) -join "`n"
    Put (Join-Path $app 'Vortex\state.v2\000001.log') $state
    foreach ($id in $ids) {
        $dir = Join-Path $app ('Vortex\skyrimse\profiles\' + $id)
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        if ($deployed -contains $id) { Put (Join-Path $dir 'plugins.txt') "# Vortex`r`n*A.esp`r`n" }
    }
    return $app
}
function With-Appdata([string]$app, [scriptblock]$do) {
    $saved = $env:APPDATA
    $env:APPDATA = $app
    try { return (& $do) } finally { $env:APPDATA = $saved }
}

try {
    . (Join-Path $Repo 'scripts\mods\LoadOrder.ps1')

    # ---- 1. no plugins.txt ----------------------------------------------------------
    Write-Host 'a Thornswood profile with no plugins.txt'
    $bare = New-Appdata 'bare' @('twid') @()
    $why = ''
    $got = With-Appdata $bare { try { Assert-VortexProfile 'Thornswood' } catch { $script:why = $_.Exception.Message; $null } }
    $why = $script:why
    Yes 'Assert-VortexProfile stops on it' ($null -eq $got -and $why)
    Yes '  saying it holds no plugins.txt' ($why -match 'plugins\.txt')
    Yes '  and that the fix is to deploy it in Vortex' ($why -match 'Vortex' -and $why -match '\bdeploy')
    Yes '  naming the folder it found' ($why.Contains((Join-Path $bare 'Vortex\skyrimse\profiles\twid')))

    # ---- 2. a deployed one -----------------------------------------------------------
    Write-Host ''
    Write-Host 'a deployed Thornswood profile'
    $ok = New-Appdata 'ok' @('twid') @('twid')
    $got = With-Appdata $ok { Assert-VortexProfile 'Thornswood' }
    Yes 'Assert-VortexProfile gives its folder' ([string]$got -eq (Join-Path $ok 'Vortex\skyrimse\profiles\twid'))
    $two = New-Appdata 'two' @('empty', 'full') @('full')
    $got = With-Appdata $two { Get-VortexProfileDir 'Thornswood' }
    Yes '  of two folders named Thornswood, the one holding plugins.txt is the profile, though the empty one comes first' ([string]$got -eq (Join-Path $two 'Vortex\skyrimse\profiles\full'))

    # ---- 3. Check-ShipReady --------------------------------------------------------
    Write-Host ''
    Write-Host 'Check-ShipReady'
    $csr = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Check-ShipReady.ps1'))
    Yes 'its Vortex row asks Assert-VortexProfile, the check Ship stops on' ($csr -match "try \{ \`$vpDir = Assert-VortexProfile 'Thornswood' \} catch \{ \`$vpWhy = \`$_\.Exception\.Message \}")
    Yes '  and gives its message as the fix, so a profile with no plugins.txt fails with the deploy step' ($csr -match "Ready 'Vortex has a profile named Thornswood, deployed' \(\[bool\]\`$vpDir\)" -and $csr -match 'if \(\$vpWhy\) \{ \$vpWhy \}')
    Yes '  and no longer asks Get-VortexProfileDir, which finds a folder but not whether it was deployed' ($csr -notmatch "\`$vpDir = Get-VortexProfileDir")

    # ---- 4. the copy check ----------------------------------------------------------
    Write-Host ''
    Write-Host 'the load order copy check'
    $a = Join-Path $T 'copies\a\plugins.txt'
    $b = Join-Path $T 'copies\b\plugins.txt'
    Put $a "*SkyUI_SE.esp`r`n*Immersive Armors.esp`r`n"
    Put $b "*SkyUI_SE.esp`r`n*Immersive Armors.esp`r`n"
    $gone = Join-Path $T 'copies\gone\plugins.txt'
    $dirCopy = Join-Path $T 'copies\dir\plugins.txt'
    New-Item -ItemType Directory -Force -Path $dirCopy | Out-Null

    Yes 'given no copies it asks nothing' (@(Get-LoadOrderCopyDiffs @{}).Count -eq 0)
    Yes 'two that agree agree' (@(Get-LoadOrderCopyDiffs @{ 'A' = $a; 'B' = $b }).Count -eq 0)
    $one = @(Get-LoadOrderCopyDiffs @{ 'Vortex Thornswood\plugins.txt' = $a })
    Yes 'one copy alone is said: there is nothing to compare it with' ($one.Count -eq 1 -and $one[0] -match 'Vortex Thornswood\\plugins\.txt' -and $one[0] -match 'nothing to compare')
    $miss = @(Get-LoadOrderCopyDiffs @{ 'Vortex Thornswood\plugins.txt' = $gone; 'Profile\OwnGame\plugins.txt' = $a })
    Yes 'a copy that is not there is named, with its path' (@($miss | Where-Object { $_ -match 'Vortex Thornswood\\plugins\.txt is not there' -and $_.Contains($gone) }).Count -eq 1)
    Yes '  and the check says too few were left to compare' (@($miss | Where-Object { $_ -match 'only 1 of the 2' -and $_ -match 'not checked' }).Count -eq 1)
    $bad = @(Get-LoadOrderCopyDiffs @{ 'Vortex Thornswood\plugins.txt' = $dirCopy; 'Profile\OwnGame\plugins.txt' = $a })
    Yes 'a copy that is there but cannot be read is named as unreadable' (@($bad | Where-Object { $_ -match 'Vortex Thornswood\\plugins\.txt cannot be read' }).Count -eq 1)
    Yes '  not as a difference at index 0' (@($bad | Where-Object { $_ -match 'index 0' }).Count -eq 0)
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
