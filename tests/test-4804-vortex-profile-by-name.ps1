<#
  test-4804-vortex-profile-by-name.ps1

      pwsh -NoProfile -File .\tests\test-4804-vortex-profile-by-name.ps1

  #4804. Deploy-Gamemode.ps1 -Vortex took its plugin list from Windows' own
  Skyrim plugins.txt (%LOCALAPPDATA%\Skyrim Special Edition\Plugins.txt),
  which holds whichever Vortex profile deployed last, and checked only that
  the file was there. Ship and Check-ShipReady read the Thornswood profile by
  name (Assert-VortexProfile and Get-VortexProfileDir in
  scripts\mods\LoadOrder.ps1). So with another profile deployed last, the
  servers' order was built from the wrong list, and nothing said so.

  WHAT THIS HOLDS, running a copy of the real Deploy-Gamemode.ps1 -Vortex
  -OrderOnly in a scratch tree laid out like the repository, with a scratch
  Vortex profile tree (two profiles, Thornswood and another) under a scratch
  APPDATA, and the live list under a scratch LOCALAPPDATA:
    A. another profile deployed last, so the live list is its list: a stop
       that says the live list is not the Thornswood profile's, and no order
    B. the Thornswood profile deployed last: its own list is read, by its
       path, into the order
    C. no profile named Thornswood: a stop that says so, and no order
    D. no live list at all: a stop, and no order

  Steam's registry is not in a scratch tree, so the copy's Get-SkyrimPath
  answers the scratch game folder; everything after it is the real script.
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
function Same([string]$what, $got, $want) {
    $g = (@($got) | ForEach-Object { [string]$_ }) -join '|'
    $w = (@($want) | ForEach-Object { [string]$_ }) -join '|'
    Yes $what ([string]::Equals($g, $w, [StringComparison]::Ordinal))
    if ($g -ne $w) {
        Write-Host "      wanted $w" -ForegroundColor Red
        Write-Host "      got    $g" -ForegroundColor Red
    }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4804-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null

function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

# A plugin file: the TES4 record with the flags given (0x1 master, 0x200
# light) and a MAST subrecord for each master.
function New-Plugin([string]$dir, [string]$name, [uint32]$flags, [string[]]$masters = @()) {
    $body = New-Object Collections.Generic.List[byte]
    foreach ($m in $masters) {
        $z = [Text.Encoding]::ASCII.GetBytes($m + [char]0)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('MAST'))
        $body.AddRange([BitConverter]::GetBytes([uint16]$z.Length))
        $body.AddRange($z)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('DATA'))
        $body.AddRange([BitConverter]::GetBytes([uint16]8))
        $body.AddRange((New-Object byte[] 8))
    }
    $b = New-Object Collections.Generic.List[byte]
    $b.AddRange([Text.Encoding]::ASCII.GetBytes('TES4'))
    $b.AddRange([BitConverter]::GetBytes([uint32]$body.Count))
    $b.AddRange([BitConverter]::GetBytes($flags))
    $b.AddRange((New-Object byte[] 12))
    $b.AddRange($body)
    $b.AddRange((New-Object byte[] 64))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $b.ToArray())
}

$masters5 = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')

# A whole server-build record that loads light plugins, as RecordShape.ps1
# holds Deploy-Gamemode's to (#2180).
function ServerRecord {
    $h = 'ab' * 32
    $r = [ordered]@{ binary = 'scam_native.node'; sha256 = $h; bytes = 1; source = [ordered]@{ commit = ('cd' * 20) }
                     files = [ordered]@{ 'scam_native.node' = [ordered]@{ sha256 = $h; bytes = 1 } }; lightPlugins = $true }
    return ($r | ConvertTo-Json -Depth 5)
}

# The scratch tree: the deploy script and what it dot-sources, a game folder
# where Steam would have put it, two Vortex profiles, Thornswood's list
# switching on A.esp and the other's B.esp, and the live list as $live gives
# it ($null for none). $named $false leaves no profile named Thornswood.
function New-Tree([string]$name, $live, [bool]$named = $true) {
    $t = Join-Path $T $name
    foreach ($rel in 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\deploy\MaxOnline.ps1', 'scripts\deploy\ServerOrder.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                     'scripts\release\BuildStamp.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1',
                     'scripts\mods\LoadOrder.ps1', 'records\most-online.json') {
        $from = Join-Path $Repo $rel
        if (-not (Test-Path -LiteralPath $from)) { continue }
        $to = Join-Path $t $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to
    }
    $game = Join-Path $t 'Game'
    $deploy = Join-Path $t 'scripts\deploy\Deploy-Gamemode.ps1'
    $src = [IO.File]::ReadAllText($deploy)
    $stubbed = $src.Replace('function Get-SkyrimPath {', "function Get-SkyrimPath {`n    return '" + $game.Replace("'", "''") + "'")
    Yes ("$name`: the copy's Get-SkyrimPath answers the scratch game folder") ($stubbed -ne $src)
    [IO.File]::WriteAllText($deploy, $stubbed, $utf8)
    Put (Join-Path $t 'records\server-build.json') (ServerRecord)
    [IO.File]::AppendAllText((Join-Path $t 'scripts\mods\LoadOrder.ps1'),
        "`nfunction Get-CollectionState([string]`$Url) { [pscustomobject]@{ Slug = 'ts4804'; Have = 4; Newest = 4; Behind = `$false; Known = `$true } }`n", $utf8)
    Put (Join-Path $t 'game\gamemode.js') "var thornswood4804 = 1;`n"
    Put (Join-Path $t 'game\gamemode-tables\WAY_OUT.json') "{}`n"
    Put (Join-Path $t 'dist\server-settings.json') '{"port":7777,"name":"Thornswood"}'
    $data = Join-Path $game 'Data'
    foreach ($m in $masters5) { New-Plugin $data $m 0x1 }
    New-Plugin $data '_ResourcePack.esl' 0x201
    New-Plugin $data 'A.esp' 0x0 @('Skyrim.esm')
    New-Plugin $data 'B.esp' 0x0
    Put (Join-Path $game 'Skyrim.ccc') ((($masters5 + @('_ResourcePack.esl')) -join "`r`n") + "`r`n")
    Put (Join-Path $game 'config.json') '{"CollectionUrl":"https://next.nexusmods.com/skyrimspecialedition/collections/ts4804"}'
    $profiles = Join-Path $t 'appdata\Vortex\skyrimse\profiles'
    Put (Join-Path $profiles 'twid\plugins.txt') "# Vortex`r`n*A.esp`r`n"
    Put (Join-Path $profiles 'other\plugins.txt') "# Vortex`r`n*B.esp`r`n"
    $state = if ($named) { '{"profileId":"twid","profileName":"Thornswood"}' } else { '{"profileId":"twid","profileName":"Something Else"}' }
    Put (Join-Path $t 'appdata\Vortex\state.v2\000001.log') $state
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'localappdata') | Out-Null
    if ($null -ne $live) { Put (Join-Path $t 'localappdata\Skyrim Special Edition\Plugins.txt') $live }
    return $t
}

function Invoke-Vortex([string]$t) {
    $saved = @{ APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA }
    $env:APPDATA = Join-Path $t 'appdata'
    $env:LOCALAPPDATA = Join-Path $t 'localappdata'
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $shell -NoProfile -File (Join-Path $t 'scripts\deploy\Deploy-Gamemode.ps1') `
                   -Gamemode (Join-Path $t 'game\gamemode.js') -Dist (Join-Path $t 'dist') `
                   -Vortex -Data (Join-Path $t 'not-read\Data') -Plugins (Join-Path $t 'not-read\plugins.txt') `
                   -OrderOnly (Join-Path $t 'order\server-settings.json') 2>&1 |
                 ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
        $env:APPDATA = $saved.APPDATA
        $env:LOCALAPPDATA = $saved.LOCALAPPDATA
    }
    $file = Join-Path $t 'order\server-settings.json'
    $leaves = $null
    if (Test-Path -LiteralPath $file) {
        $leaves = [string[]]@(([IO.File]::ReadAllText($file) | ConvertFrom-Json).loadOrder | ForEach-Object { @(([string]$_) -split '[\\/]')[-1] })
    }
    return [pscustomobject]@{ Code = $code; Text = ($out -join "`n"); Order = $leaves }
}

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Yes 'node is on this machine, which Deploy-Gamemode.ps1 needs to check gamemode.js' $false
        Done
    }

    # A. Another profile deployed last.
    $tree = New-Tree 'other-last' "# Vortex`r`n*B.esp`r`n"
    $r = Invoke-Vortex $tree
    Yes 'A. another profile deployed last: -Vortex stops' ($r.Code -ne 0)
    if ($r.Code -eq 0) { Write-Host $r.Text }
    Yes '  saying the live list is not the Thornswood profile''s list' ($r.Text -match 'is not the Thornswood profile''s list')
    Yes '  and naming where each list differs' ($r.Text -match 'first differ at index')
    Yes '  and no order is written' ($null -eq $r.Order)

    # B. The Thornswood profile deployed last.
    $tree = New-Tree 'thornswood-last' "# Vortex`r`n*A.esp`r`n"
    $r = Invoke-Vortex $tree
    Yes 'B. the Thornswood profile deployed last: the order is written' ($r.Code -eq 0 -and $null -ne $r.Order)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    Yes '  from the Thornswood profile''s own list, by its path' ($r.Text -match 'plugins\s+\S*twid[\\/]plugins\.txt')
    Same '  the masters, Skyrim.ccc''s _ResourcePack.esl, then the profile''s list' $r.Order ($masters5 + @('_ResourcePack.esl', 'A.esp'))

    # C. No profile named Thornswood.
    $tree = New-Tree 'no-profile' "# Vortex`r`n*A.esp`r`n" $false
    $r = Invoke-Vortex $tree
    Yes 'C. no Vortex profile named Thornswood: -Vortex stops' ($r.Code -ne 0)
    if ($r.Code -eq 0) { Write-Host $r.Text }
    Yes '  saying the profile was not found' ($r.Text -match "Vortex profile 'Thornswood' was not found")
    Yes '  and no order is written' ($null -eq $r.Order)

    # D. No live list.
    $tree = New-Tree 'no-live' $null
    $r = Invoke-Vortex $tree
    Yes 'D. no live plugin list: -Vortex stops' ($r.Code -ne 0)
    Yes '  and no order is written' ($null -eq $r.Order)
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
