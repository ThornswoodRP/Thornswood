<#
  Fix-Icons.ps1

  Windows keeps the picture it once drew for a shortcut in a cache, and goes on
  showing it long after the icon inside the exe changed. A pinned taskbar item
  is the worst of it: pinning copies the shortcut into its own folder, and that
  copy keeps its own cached icon indefinitely.

  This prints what is actually pinned and where it points, then clears the
  caches and restarts Explorer. Nothing is lost. Explorer comes straight back.

      .\scripts\dev\Fix-Icons.ps1
#>
#Requires -Version 7
[CmdletBinding()]
param([string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install))

$ErrorActionPreference = 'Continue'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

Head 'What the shortcuts point at'
$ws = New-Object -ComObject WScript.Shell
$places = @(
    [Environment]::GetFolderPath('Desktop'),
    $Root,
    (Join-Path $env:AppData 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
    (Join-Path $env:AppData 'Microsoft\Windows\Start Menu\Programs')
)

# The launcher, Thornswood.exe in the launcher folder.
function Get-LauncherExe([string]$dir) {
    return (Join-Path $dir 'Thornswood.exe')
}

$found = 0
foreach ($p in $places) {
    if (-not (Test-Path $p)) { continue }
    foreach ($f in @(Get-ChildItem $p -Filter *.lnk -ErrorAction SilentlyContinue)) {
        $sc = $ws.CreateShortcut($f.FullName)
        if ($sc.TargetPath -notmatch 'Thornswood') { continue }
        $found++
        Say ("  " + $f.Name) 'White'
        Say ("      in    " + $p) 'DarkGray'
        Say ("      runs  " + $sc.TargetPath) 'DarkGray'
        Say ("      icon  " + $sc.IconLocation) 'DarkGray'

        # A pinned copy can still carry the path the launcher used to live at.
        $exe = Get-LauncherExe (Join-Path $Root 'Launcher')
        if ((Test-Path $exe) -and ($sc.IconLocation -notlike "$exe*")) {
            $sc.IconLocation = "$exe,0"
            $sc.Save()
            Say '      icon reset to the launcher' 'Yellow'
        }
    }
}
if (-not $found) { Say '  None found.' 'Yellow' }

Head 'Clearing the icon cache'
Say '  Explorer closes for a second and comes back on its own.' 'DarkGray'
Start-Sleep -Milliseconds 400
taskkill /f /im explorer.exe 2>&1 | Out-Null

$targets = @(
    (Join-Path $env:LocalAppData 'IconCache.db'),
    (Join-Path $env:LocalAppData 'Microsoft\Windows\Explorer\iconcache_*.db'),
    (Join-Path $env:LocalAppData 'Microsoft\Windows\Explorer\thumbcache_*.db')
)
$gone = 0
foreach ($t in $targets) {
    foreach ($f in @(Get-ChildItem $t -Force -ErrorAction SilentlyContinue)) {
        try { Remove-Item $f.FullName -Force -ErrorAction Stop; $gone++ } catch { }
    }
}
Say "  $gone cache files removed" 'Green'

Start-Process explorer.exe
Start-Sleep -Seconds 2

Head 'Done'
Say 'If the taskbar one is still wrong, right click it, Unpin from taskbar,' 'Gray'
Say 'then open the launcher and pin it again. A pinned shortcut is its own' 'Gray'
Say 'copy and that is the only way to make Windows redraw it.' 'Gray'
Write-Host ''
[void](Read-Host 'Enter to close')
