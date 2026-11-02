<#
  Install-Launcher.ps1
  Puts a launcher that Build-Launcher.ps1 has already built into an install,
  and does the things around it that only an install should do.

      .\scripts\release\Build-Launcher.ps1 -Root C:\Thornswood-DevBuild -OutDir $env:TEMP\tsl -NoPause
      .\scripts\release\Install-Launcher.ps1 -Root C:\Thornswood-DevBuild -From $env:TEMP\tsl -NoPause

  In order: closes a game and a launcher left running (Close-Launcher.ps1),
  copies the launcher from -From into <Root>\Launcher, writes the icon file
  and the shortcuts, tells Explorer to redraw, and clears Explorer's icon
  cache when the artwork is new.

  THE LAUNCHER IS A FOLDER (#4823). Compiled to native code, Thornswood.exe
  needs the native libraries Avalonia draws with beside it, so every file
  Build-Launcher.ps1 left in -From goes in, Thornswood.exe last: an exe in
  place that is the new one means everything before it went in too, which
  is what Ship reads back. Until #4823 this copied the one exe.

  Split out of Build-Launcher.ps1 on 24 September, To Do List entry 243,
  "Build-Launcher.ps1 is an installer wearing a build script's name". Every
  compile check used to do all of this, closing whatever Skyrim was running on
  the machine before csc had even started. Ship.ps1 runs this after a build
  that worked, and Install-Thornswood.ps1 runs it for its launcher step.
  Nothing else should: something that only needs to know the launcher
  compiles calls Build-Launcher.ps1 and stops there.

  Without -From the exe is taken as already in place, which is what a hand
  build with Build-Launcher's default -OutDir leaves behind.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Root,
    # The folder Build-Launcher.ps1 published the launcher into (its -OutDir):
    # Thornswood.exe, the native libraries, and the two icons it embeds.
    [string]$From,
    # When set, do not Stop-Game / Stop-Launcher. Ship -DryRun uses this so a
    # dry run can still put the built exe in place without closing a running game.
    [switch]$NoClose,
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\dev\Close-Launcher.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

Head 'Thornswood - launcher install'
Say ("  installing into $Root") 'DarkGray'

$outDir = Join-Path $Root 'Launcher'
if (-not $From) { $From = $outDir }
$built = Join-Path $From 'Thornswood.exe'
# Checked before anything is closed, so a build that produced nothing never
# costs anybody their game or their launcher.
if (-not (Test-Path -LiteralPath $built)) { Die "There is no Thornswood.exe in $From. Run Build-Launcher.ps1 first." }

# THE ICON IS THE ONE THE EXE CARRIES (#887). The name of the icon file has to
# be the one the launcher itself writes (Icons.IconFile: icon-<the first eight
# hex digits of the artwork's SHA-256>.ico), or the sweep below deletes the
# file the Start menu and pinned shortcuts name and Windows draws them blank.
# Measured 28 Sep: this took the repository's app.ico, while the dev launcher
# uses app-dev.ico and a main Ship installs the exe CI built from the tag,
# which can carry older art. Until #4823 the bytes were read out of the exe
# with Reflection; a native exe is not an assembly, and its resources cannot
# be read that way. So Build-Launcher.ps1 writes the two icons the project
# embeds beside the exe it publishes, app.ico and app-dev.ico, byte for byte,
# and they travel with that exe (release.yml drafts them with it). They are
# read here, and checked for before anything is closed. The repository's art
# is never the answer: it is the fault #887 was.
#
# Which one: the dev build's shortcuts get app-dev.ico, the main build's
# app.ico, as Icons.IconBytes picks with Art.Dev.
$isDevArt = $Root.TrimEnd('\') -match '-DevBuild$'
$iconName = if ($isDevArt) { 'app-dev.ico' } else { 'app.ico' }
$iconFrom = Join-Path $From $iconName
if (-not (Test-Path -LiteralPath $iconFrom)) {
    Die ("There is no $iconName beside Thornswood.exe in $From. Build-Launcher.ps1 writes the icons the launcher embeds there, " +
         "and a launcher taken from a release comes with them; without it the shortcuts would name an icon file the launcher does not write (#887). Nothing was closed or installed.")
}
$iconBytes = [IO.File]::ReadAllBytes($iconFrom)
if ($iconBytes.Length -eq 0) { Die "$iconFrom is empty. Nothing was closed or installed." }

$null = New-Item -ItemType Directory -Force -Path $outDir
$exe = Join-Path $outDir 'Thornswood.exe'

# Shared with the other scripts that write into the build. Both match on the
# full path, because the multiplayer client carries the same file name as the
# launcher and killing by name would take the game down with it.
#
# Moved here from Build-Launcher.ps1 as it was. Stop-Game matches SkyrimSE and
# skse64_loader by name alone, wherever they run from, so installing the dev
# build still closes a game running from the play install. Publish-Update.ps1
# makes the same call during every Ship; Ship -DryRun passes -NoClose to both
# so a dry run closes neither (issue #494).
if ($NoClose) {
    $running = @(Get-GameProcesses -Root $Root)
    if ($running.Count -gt 0) {
        $names = ($running | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join ', '
        Say ("  -NoClose: would close running game (" + $names + "), leaving it alone") 'Yellow'
    }
    $found = Get-LauncherProcesses -Root $Root
    if ($found.Mine.Count -gt 0) {
        Say '  -NoClose: would close the launcher, leaving it alone' 'Yellow'
    }
} else {
    $null = Stop-Game -Root $Root
    $null = Stop-Launcher -Root $Root
}

# Copied rather than published in place, so the build never has to write
# over a launcher that is still running. Every file of the build goes in,
# Thornswood.exe last (header). Ship reads back that the exe in place is this
# one by its sha256 (until #5156 by its write time, which Copy-Item keeps).
$same = (Resolve-Path -LiteralPath $From).ProviderPath.TrimEnd('\') -ieq (Resolve-Path -LiteralPath $outDir).ProviderPath.TrimEnd('\')
if (-not $same) {
    $files = @(Get-ChildItem -LiteralPath $From -File | Where-Object { $_.Name -ne 'Thornswood.exe' } | Sort-Object Name) + @(Get-Item -LiteralPath $built)
    foreach ($f in $files) {
        try { Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $outDir $f.Name) -Force }
        catch { Die ("Could not put the new $($f.Name) into $outDir, so the old Thornswood.exe is still there. " +
                     "It is probably still open. " + $_.Exception.Message) }
    }
    Say ('  the launcher put in place from ' + $From + ' (' + $files.Count + ' files)') 'Green'
}

# ------------------------------------------------------------ shortcut
Head 'Shortcut'

# Windows caches the bitmap it once drew for an icon against the path it came
# from. Point every build at one fixed "exe,0" and that cache key never
# changes, so a new icon inside the exe can go on being ignored for days, and
# a reboot does not clear it. Giving the icon its own file, named after its
# own contents, changes the key the moment the artwork changes and leaves it
# alone when it has not. The bytes are the ones read above, out of the build.
$sha = [Security.Cryptography.SHA256]::Create()
$iconHash = ([BitConverter]::ToString($sha.ComputeHash($iconBytes), 0, 4)).Replace('-', '').ToLower()
$iconFile = Join-Path $outDir ("icon-$iconHash.ico")
if (-not (Test-Path $iconFile) -or (Get-Item -LiteralPath $iconFile).Length -ne $iconBytes.Length) { [IO.File]::WriteAllBytes($iconFile, $iconBytes) }
foreach ($old in @(Get-ChildItem $outDir -Filter 'icon-*.ico' -ErrorAction SilentlyContinue)) {
    if ($old.Name -ne "icon-$iconHash.ico") { Remove-Item $old.FullName -Force -ErrorAction SilentlyContinue }
}
Say ("  icon-$iconHash.ico") 'DarkGray'

# A build names its shortcut after the build it is.
#
# MEASURED 22 SEPTEMBER on Patrick's machine. This block wrote Thornswood.lnk
# to the Desktop pointing at whatever -Root was, and -Root defaults to
# C:\Thornswood-DevBuild. So every compile, including the compile check a
# Claude runs and the one inside Ship, silently repointed the Desktop icon
# called "Thornswood" at the DEV launcher, which joins the dev server on
# 7787. The icon read 9/21 23:47:03, the minute the dev build was last
# compiled, and it had been pointing at the dev build ever since. Nothing
# said so, because the shortcut still had the right name and the right
# artwork. The Start menu entries were correct the whole time, which is why
# it went unnoticed: Thornswood.lnk there points at C:\Thornswood and
# Thornswood Dev.lnk at the dev build.
#
# The dev build gets its own name, so the two can never overwrite each other,
# and a dev build never touches the Desktop icon the play install owns.
#
# The dev build is the one folder C:\Thornswood-DevBuild, asked by its whole
# name like the play install below. MEASURED 20 OCTOBER on One (#2900): this
# asked only for a name ending in -DevBuild, and -match ignores case, so the
# dev release folder local\release-devbuild in the repository counted as the
# dev install. A dev Ship installs its launcher there, so every one rewrote
# the Desktop's Thornswood Dev.lnk to start the release folder's launcher
# (2:57 PM that day) instead of the dev build Patrick plays, and a Ship dry
# run's Play-DevBuild test folder did the same.
#
# Both installs are what Where.ps1 InstallDev and Install answer (#3031), so
# a developer whose launcher is on another drive gets the same shortcuts.
$devInstall  = [string](& (Join-Path $Here 'Where.ps1') InstallDev)
$playInstall = [string](& (Join-Path $Here 'Where.ps1') Install)
$isDevRoot = $Root.TrimEnd('\') -ieq $devInstall
$lnkName   = if ($isDevRoot) { 'Thornswood Dev.lnk' } else { 'Thornswood.lnk' }

# AND A SCRATCH BUILD TOUCHES THE DESKTOP AT ALL.
#
# The 22 September fix above told the dev build apart from the play install and
# stopped there, and there is a third kind of root: a throwaway one. A compile
# check, the build step in .github/workflows/build.yml which builds into
# $RUNNER_TEMP, or a Claude proving that Keys.cs still compiles. None of those
# match -DevBuild, so every one of them wrote Thornswood.lnk to the Desktop
# pointing into a temporary folder, and then the folder was deleted.
#
# MEASURED 23 SEPTEMBER by doing exactly that for the fourth time: a compile
# into %TEMP%\ts-keycheck repointed the real Desktop icon at
# %TEMP%\ts-keycheck\Launcher\Thornswood.exe and restarted Explorer to be
# sure the change took. It has happened often enough to have its own entry on
# the To Do List.
#
# So a root that is neither of the two real installs gets its shortcut inside
# its own folder and nowhere else. It still builds and it still gets an icon;
# nothing outside that folder changes.
$playRoot  = $Root.TrimEnd('\') -ieq $playInstall
$isScratch = -not ($isDevRoot -or $playRoot)

# A .lnk is made through Windows' own shell (WScript.Shell), which no other
# machine has. Off Windows (a cloud Ship, for one) the launcher and its icon
# are put in place as above and no shortcut is made (#2989).
$canLink = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$places = if (-not $canLink) { @() } elseif ($isScratch) { @($Root) } else { @([Environment]::GetFolderPath('Desktop'), $Root) }
if ($canLink) { $ws = New-Object -ComObject WScript.Shell }
foreach ($dest in $places) {
    # A dev build that previously wrote the play install's name here left a
    # shortcut behind pointing at the dev exe. Take it away rather than leave
    # it lying, but only when it really does point into this dev root: a
    # correct Thornswood.lnk aimed at the play install is not ours to remove.
    if ($isDevRoot) {
        $stale = Join-Path $dest 'Thornswood.lnk'
        if (Test-Path -LiteralPath $stale) {
            # A tidy up of a shortcut an older build left: one that cannot be
            # read or removed is said, and the install goes on.
            try {
                $old = $ws.CreateShortcut($stale)
                if ($old.TargetPath -and $old.TargetPath.StartsWith($Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
                    Remove-Item -LiteralPath $stale -Force -ErrorAction Stop
                    Say "  removed a Thornswood.lnk in $dest that pointed at the dev build" 'Yellow'
                }
            } catch { Say "  could not read or remove the Thornswood.lnk in $dest that may point at the dev build: $($_.Exception.Message)" 'Yellow' }
        }
    }

    $sc = $ws.CreateShortcut((Join-Path $dest $lnkName))
    $sc.TargetPath       = $exe
    $sc.Arguments        = ''
    $sc.WorkingDirectory = $outDir
    $sc.IconLocation     = "$iconFile,0"
    $sc.Description      = if ($isDevRoot) { 'Thornswood Dev' } else { 'Thornswood' }
    $sc.Save()
}
if ($canLink) { Say ("  $lnkName points at the exe now, no PowerShell in the chain") 'Green' }
else { Say "  no $lnkName made: a shortcut is made through Windows' shell, which this machine does not have" 'Yellow' }
if ($isDevRoot) { Say '  the play install''s own Thornswood.lnk is left alone' 'DarkGray' }
if ($isScratch) { Say '  a throwaway build, so the Desktop is left alone entirely' 'DarkGray' }

# A scratch install asks nothing of Explorer either. The comment above promises
# that nothing outside its folder changes, and these two were the exception:
# they ran on every compile check. They stay exactly as they were for the two
# real installs. Skipping them here is also what lets
# tests\test-build-vs-install.ps1 run this script on every pull request, and on
# a machine in the middle of a playtest, without touching the shell.
if (-not $isScratch) {
    # Telling the shell an association changed is what actually makes Explorer
    # redraw, and unlike clearing the cache it costs nothing and interrupts
    # nobody. ie4uinit stays as a second opinion.
    try {
        if (-not ([System.Management.Automation.PSTypeName]'Thornswood.Shell32').Type) {
            Add-Type -Namespace Thornswood -Name Shell32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@
        }
        [Thornswood.Shell32]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
        Say '  Explorer told to redraw' 'DarkGray'
    } catch { Say "  Explorer could not be told to redraw, so the icon may look old until it does: $($_.Exception.Message)" 'Yellow' }

    $ie4 = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
    if (Test-Path -LiteralPath $ie4) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $global:LASTEXITCODE = 0
            & $ie4 -show 2>&1 | Out-Null
            $ie4Code = $LASTEXITCODE
            if ($ie4Code -ne 0) { & $ie4 -ClearIconCache 2>&1 | Out-Null; $ie4Code = $LASTEXITCODE }
        } finally { $ErrorActionPreference = $old }
        if ($ie4Code -eq 0) { Say '  Icon cache asked to refresh' 'DarkGray' }
        else { Say "  ie4uinit did not refresh the icon cache (exit $ie4Code), so the icon may look old until Explorer redraws it" 'Yellow' }
    }
}

# The belt and braces pass, only when the artwork itself is new. Clearing the
# cache means closing Explorer for a second, which is too rude to do on every
# build but exactly right on the one build where the icon changed.
$stamp    = Join-Path $outDir '.iconstamp'
$lastIcon = ''
# An empty stamp (a write cut short) reads back as $null, and .Trim() on that
# stopped the install under StrictMode. Wrapping it in a string makes it ''.
if (Test-Path $stamp) { $lastIcon = "$(Get-Content $stamp -Raw -ErrorAction SilentlyContinue)".Trim() }
# AND NOT ON A THROWAWAY BUILD EITHER. Killing and restarting Explorer is
# already described below as too rude to do on every build; doing it because a
# compile check ran is ruder still, and a scratch build's icon is not on
# anybody's Desktop to be stale. A compile check on 23 September restarted
# Explorer twice in as many minutes.
if ($lastIcon -ne $iconHash -and -not $isScratch) {
    Say '  New artwork, clearing the cache properly' 'Yellow'
    # No cache file is the ordinary case (Test-Path, and a wildcard that
    # matches nothing), so only one that is there and will not go is said.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { taskkill /f /im explorer.exe 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
    $kept = @()
    $caches = @(
        (Join-Path $env:LocalAppData 'IconCache.db'),
        (Join-Path $env:LocalAppData 'Microsoft\Windows\Explorer\iconcache_*.db')
    )
    foreach ($c in $caches) {
        if (-not (Test-Path -Path $c)) { continue }
        foreach ($f in @(Get-ChildItem -Path $c -Force -File)) {
            try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop }
            catch { $kept += ($f.Name + ' (' + $_.Exception.Message + ')') }
        }
    }
    if ($kept.Count) {
        Say ('  {0} icon cache file(s) could not be removed, so the old icon may still show: {1}' -f $kept.Count, ($kept -join '; ')) 'Yellow'
    }
    Set-Content -Path $stamp -Value $iconHash -Encoding ASCII
    try {
        Start-Process explorer.exe -ErrorAction Stop
        Say '  Explorer restarted, icon is the new one' 'Green'
    } catch {
        Say "  Explorer did not start again: $($_.Exception.Message)" 'Red'
        Say '  Start it from Task Manager: File, Run new task, explorer.' 'Red'
    }
}

Head 'Done'
Say $exe 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }

# Said out loud for the same reason as Build-Launcher.ps1: ie4uinit and
# taskkill leave their own exit codes behind, and Ship.ps1 reads this one to
# decide whether the release goes on.
exit 0
