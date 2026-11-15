<#
  Start-Thornswood.ps1

  Launches the game the way the launcher's Play() does, without the launcher.

  Skyrim always reads its settings, plugin list and saves from two fixed folders
  under the Windows user profile. It has no concept of a per-build profile. The
  launcher works around that by moving those two folders aside and junctioning
  them onto C:\Thornswood\Profile for the length of a session, then putting
  them back. Launching skse64_loader.exe on its own skips all of that, so the
  game reads whatever plugin list is in the real Windows location, which is why
  QuickLoot could not find its own plugin: it genuinely was not loaded.

  Two details that are not optional:

  Working directory must be the game root. Address Library resolves
  Data\SKSE\Plugins\versionlib-*.bin relative to it, and EngineFixes fails hard
  with "Failed to locate an appropriate address library" when it is wrong, even
  though the file is sitting right there.

  The swap must be undone afterwards, including after a crash. Restore runs in a
  finally block and is safe to call when nothing is swapped, so a stale junction
  from a previous crash gets cleaned up on the next start rather than silently
  pointing a normal Skyrim launch at this build.

  mklink /J makes junctions, which do NOT need administrator. Only symlinks do.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
    [switch]$NoWait,        # return as soon as the game starts
    [switch]$RestoreOnly,   # just undo a stale swap and exit
    [switch]$SkipServerCheck # launch even with no server answering
)

$Game     = Join-Path $Root 'Game'
$Profile_ = Join-Path $Root 'Profile'
$MyGames  = Join-Path $Profile_ 'MyGames'
$LocalAD  = Join-Path $Profile_ 'LocalAppData'
$Golden   = Join-Path $Profile_ 'Default'

$WinMyGames = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'My Games\Skyrim Special Edition'
$WinLocalAD = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Skyrim Special Edition'
$pairs = @(
    @{ Win = $WinMyGames; Ours = $MyGames }
    @{ Win = $WinLocalAD; Ours = $LocalAD }
)

function Test-Junction([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return $false }
    $i = Get-Item -LiteralPath $p -Force
    return [bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Restore-Profile {
    $did = $false
    foreach ($p in $pairs) {
        $bak = $p.Win + '.st-backup'
        if (Test-Junction $p.Win) {
            # Delete the link, never what it points at.
            [IO.Directory]::Delete($p.Win)
            $did = $true
        }
        if ((Test-Path -LiteralPath $bak) -and -not (Test-Path -LiteralPath $p.Win)) {
            Move-Item -LiteralPath $bak -Destination $p.Win -Force
            $did = $true
        }
    }
    return $did
}

if ($RestoreOnly) {
    if (Restore-Profile) { Write-Host 'profile restored' -ForegroundColor Green }
    else { Write-Host 'nothing was swapped' -ForegroundColor DarkGray }
    return
}

# A junction left behind by a crash would otherwise point a normal Skyrim
# launch at this build without anyone noticing.
if (Restore-Profile) { Write-Host 'cleaned up a swap left behind by a previous session' -ForegroundColor Yellow }

foreach ($d in @($MyGames, $LocalAD, (Join-Path $MyGames 'Saves'))) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Golden copies. The plugin lists are always forced, because the server compares
# load orders and a drifted one desyncs everyone. The ini files are only placed
# when missing: gamma, volume, difficulty and view distance all live in
# SkyrimPrefs.ini and are changed from inside the game, so copying the shipped
# one over the top is what makes those changes keep vanishing.
$forced = 'plugins.txt','loadorder.txt'
$copied = 0
if (Test-Path -LiteralPath $Golden) {
    foreach ($f in (Get-ChildItem -LiteralPath $Golden -File)) {
        $dest = if ($f.Extension -eq '.ini') { $MyGames } else { $LocalAD }
        $target = Join-Path $dest $f.Name
        if (($forced -notcontains $f.Name) -and (Test-Path -LiteralPath $target)) { continue }
        Copy-Item -LiteralPath $f.FullName -Destination $target -Force
        $copied++
    }
}
Write-Host "profile: $copied file(s) put in place from Default" -ForegroundColor DarkGray

# ---- swap ------------------------------------------------------------------
foreach ($p in $pairs) {
    $bak = $p.Win + '.st-backup'
    if (Test-Path -LiteralPath $p.Win) {
        if (Test-Path -LiteralPath $bak) {
            Move-Item -LiteralPath $bak -Destination ($bak + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
        }
        Move-Item -LiteralPath $p.Win -Destination $bak -Force
    }
    $parent = Split-Path $p.Win -Parent
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    cmd.exe /c mklink /J "$($p.Win)" "$($p.Ours)" | Out-Null
    if (-not (Test-Junction $p.Win)) {
        Restore-Profile
        throw "could not redirect $($p.Win)"
    }
}
Write-Host 'profile redirected at this build' -ForegroundColor Cyan

# ---------------------------------------------------------------- server ----
# Without a server answering, SkyMP never sends CreateActor, so the client never
# calls loadGame and you sit through a long wait and a black screen before
# landing in what is effectively single player: no character on the server, no
# creation menus, nothing. It looks exactly like the game being broken. It is
# one missing window. Check first and say so.
if (-not $SkipServerCheck) {
    $ip = '127.0.0.1'; $port = 7777
    $settingsFile = Join-Path $Game 'Data\Platform\Plugins\skymp5-client-settings.txt'
    if (Test-Path -LiteralPath $settingsFile) {
        try {
            $j = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
            if ($j.'server-ip')   { $ip = $j.'server-ip' }
            if ($j.'server-port') { $port = [int]$j.'server-port' }
        } catch { }
    }

    # The game traffic is UDP and there is nothing to connect to, so probe the
    # resources folder the server also serves, on the port above it.
    $up = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $null = $c.BeginConnect($ip, 3000, $null, $null).AsyncWaitHandle.WaitOne(700)
        $up = $c.Connected
        $c.Close()
    } catch { }

    if (-not $up -and ($ip -eq '127.0.0.1' -or $ip -eq 'localhost')) {
        $up = [bool](Get-Process -Name node -ErrorAction SilentlyContinue)
    }

    if (-not $up) {
        Write-Host ''
        Write-Host ("Nothing is answering at {0}:{1}." -f $ip, $port) -ForegroundColor Red
        Write-Host 'Start the server first, in its own window:' -ForegroundColor Yellow
        Write-Host ("  Set-Location '{0}'" -f (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist)) -ForegroundColor Yellow
        Write-Host '  node dist_back/skymp5-server.js' -ForegroundColor Yellow
        Write-Host ''
        Write-Host 'Launching anyway gives you a long wait, a black screen, and single player' -ForegroundColor DarkGray
        Write-Host 'with no character creation. Use -SkipServerCheck if that is what you want.' -ForegroundColor DarkGray
        # this block runs before the try/finally below, so put the profile back here
        if (Restore-Profile) { Write-Host 'profile put back' -ForegroundColor Cyan }
        return
    }
    Write-Host ("server is answering at {0}" -f $ip) -ForegroundColor Cyan
}

# ---- launch ----------------------------------------------------------------
try {
    $loader = Join-Path $Game 'skse64_loader.exe'
    if (-not (Test-Path -LiteralPath $loader)) { throw "not found: $loader" }
    Write-Host 'starting Skyrim' -ForegroundColor Green
    # The plugins only wake up for a session the launcher started. This script
    # starts the game itself, so it leaves the same note the launcher would.
    try {
        $ms = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        [IO.File]::WriteAllText((Join-Path $Game 'Data\Platform\thornswood-session.txt'), "$ms Start-Thornswood", (New-Object Text.UTF8Encoding($false)))
    } catch { }
    $proc = Start-Process -FilePath $loader -WorkingDirectory $Game -PassThru

    if ($NoWait) {
        Write-Host ''
        Write-Host 'Leaving the profile redirected. Put it back when you are done with:' -ForegroundColor Yellow
        Write-Host '  Start-Thornswood.ps1 -RestoreOnly' -ForegroundColor Yellow
        return
    }

    # skse64_loader starts SkyrimSE and exits, so waiting on the loader returns
    # almost immediately. Wait on the game itself.
    Start-Sleep -Seconds 5
    while (Get-Process -Name 'SkyrimSE' -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 3 }
    Write-Host 'game exited' -ForegroundColor DarkGray
}
finally {
    if (-not $NoWait) {
        Start-Sleep -Seconds 2
        if (Restore-Profile) { Write-Host 'profile put back' -ForegroundColor Cyan }
    }
}
