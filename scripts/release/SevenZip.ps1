<#
  SevenZip.ps1

  Where this machine's 7-Zip is, by one rule for every script (#4424).
  Dot-sourced by Nexus.ps1 (so every Nexus script), scripts\mods\LoadOrder.ps1
  (Check-CollectionRules), Get-SevenZip.ps1 and the retired Add scripts in
  scripts\oneoff. Until #4424 Nexus.ps1 and LoadOrder.ps1 each had a list of
  their own and the Add scripts a third, so one machine could unpack a
  collection revision with the Nexus scripts while Check-CollectionRules said
  it had no 7-Zip.

  Find-SevenZip gives the first of these that is there, or '':
    1. 7-Zip installed: Program Files, Program Files (x86), then the per-user
       Programs folder.
    2. Vortex's own 7z.exe: under Program Files, then the per-user Programs
       folder. A machine with Vortex on it has one.
    3. Off Windows, 7-Zip's own Linux build where Get-SevenZip.ps1 puts it
       (Get-SevenZipOwnBuild): Ubuntu's 7z cannot unpack RAR (#2969).
    4. On PATH: 7zz, 7z, 7za, in that order, so 7-Zip's own build comes
       before a distribution's 7z.
  It only looks: nothing is fetched or installed.

  Get-SevenZipLooked says the same places in words, for a script's "no
  7-Zip" message.
#>

# 7-Zip's own Linux build: the version, where it is fetched from and its
# sha256 (read on 21 Oct 2026 from 7-zip.org and from the same release on
# 7-Zip's GitHub, ip7z/7zip tag 25.01), and where Get-SevenZip.ps1 puts it:
# $XDG_DATA_HOME/thornswood/7zip-<version>/7zz, or ~/.local/share when
# XDG_DATA_HOME is not set. Path is '' when neither is there.
function Get-SevenZipOwnBuild {
    $version = '25.01'
    $data = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } elseif ($HOME) { Join-Path (Join-Path $HOME '.local') 'share' } else { '' }
    $dir = if ($data) { Join-Path (Join-Path $data 'thornswood') ('7zip-' + $version) } else { '' }
    return [pscustomobject]@{
        Version = $version
        Url     = 'https://www.7-zip.org/a/7z2501-linux-x64.tar.xz'
        Sha256  = '4ca3b7c6f2f67866b92622818b58233dc70367be2f36b498eb0bdeaaa44b53f4'
        Dir     = $dir
        Path    = $(if ($dir) { Join-Path $dir '7zz' } else { '' })
    }
}

function Get-SevenZipSpots {
    $spots = New-Object Collections.Generic.List[string]
    $pf = $env:ProgramFiles; $pf86 = ${env:ProgramFiles(x86)}; $local = $env:LOCALAPPDATA
    if ($pf) { [void]$spots.Add((Join-Path (Join-Path $pf '7-Zip') '7z.exe')) }
    if ($pf86) { [void]$spots.Add((Join-Path (Join-Path $pf86 '7-Zip') '7z.exe')) }
    if ($local) { [void]$spots.Add((Join-Path (Join-Path (Join-Path $local 'Programs') '7-Zip') '7z.exe')) }
    if ($pf) { [void]$spots.Add((Join-Path (Join-Path (Join-Path (Join-Path $pf 'Black Tree Gaming Ltd') 'Vortex') 'resources') '7z.exe')) }
    if ($local) { [void]$spots.Add((Join-Path (Join-Path (Join-Path (Join-Path $local 'Programs') 'Vortex') 'resources') '7z.exe')) }
    if (-not $IsWindows) { $own = (Get-SevenZipOwnBuild).Path; if ($own) { [void]$spots.Add($own) } }
    return $spots
}

function Find-SevenZip {
    foreach ($p in (Get-SevenZipSpots)) { if (Test-Path -LiteralPath $p -PathType Leaf) { return $p } }
    foreach ($n in '7zz', '7z', '7za') {
        $c = @(Get-Command $n -CommandType Application -ErrorAction SilentlyContinue) | Select-Object -First 1
        if ($c) { return $c.Source }
    }
    return ''
}

function Get-SevenZipLooked {
    $w = '7z.exe in Program Files, Program Files (x86) or the per-user Programs folder, Vortex''s own 7z.exe'
    if (-not $IsWindows) { $w += ', 7-Zip''s own Linux build (pwsh scripts/release/Get-SevenZip.ps1 puts it in place)' }
    return ($w + ', or 7zz, 7z or 7za on PATH')
}
