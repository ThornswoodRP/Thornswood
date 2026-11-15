<#
  Close-Launcher.ps1

  Shared by every script that writes into the build. Dot-source it:

      . (Join-Path $PSScriptRoot 'Close-Launcher.ps1')

  Get-GameProcesses asks for SkyrimSE and skse64_loader only. A Thornswood
  process is the launcher, matched by full path in Get-LauncherProcesses.

  Stop-Game exists because Skyrim does not always let go. A crash, an Alt-F4,
  or one of the multiplayer client's browser helpers can leave a process behind
  with no window, which looks like nothing at all to the person sitting there
  and like a running game to anything that checks. Every script that writes
  into the build closes those itself rather than telling someone to go and find
  a window that is not on screen.
#>

function Get-LauncherProcesses {
    param([Parameter(Mandatory)][string]$Root)

    $exe = Join-Path $Root 'Launcher\Thornswood.exe'
    $mine = @(); $unknown = 0
    foreach ($p in @(Get-Process -Name 'Thornswood' -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.MainModule.FileName } catch { }
        if ($path -and ($path -eq $exe)) { $mine += $p }
        elseif (-not $path) { $unknown++ }
    }
    return [pscustomobject]@{ Mine = $mine; Unknown = $unknown; Exe = $exe }
}

function Get-GameProcesses {
    param([string]$Root)

    # SkyrimSE and skse64_loader only. A Thornswood process is the launcher,
    # not the game. Callers still pass Root; this list does not use it.
    $out = @()
    foreach ($n in 'SkyrimSE', 'skse64_loader') {
        foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) {
            $out += $p
        }
    }
    # The caller wraps this in @() as well. A return unrolls a one element
    # array back into a bare object, and .Count on one of those is an error
    # under StrictMode, which is exactly the shape this hits most often.
    return @($out)
}

function Stop-Game {
    param([string]$Root)

    $found = @(Get-GameProcesses -Root $Root)
    if ($found.Count -eq 0) { return $false }

    $names = ($found | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join ', '
    Write-Host "  Skyrim is still open ($names), closing it" -ForegroundColor Yellow

    foreach ($p in $found) { try { $null = $p.CloseMainWindow() } catch { } }
    for ($i = 0; $i -lt 24; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not ($found | Where-Object { -not $_.HasExited })) { break }
    }
    foreach ($p in $found) {
        try { if (-not $p.HasExited) { $p.Kill() } } catch { }
    }

    # A killed process can sit in the table for a moment after it is gone, so
    # this waits rather than calling it a failure on the first look.
    $left = @()
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 250
        $left = @(Get-GameProcesses -Root $Root)
        if ($left.Count -eq 0) { break }
    }
    if ($left.Count -gt 0) {
        Write-Host "  $($left.Count) would not close. Sign out and back in, or restart." -ForegroundColor Red
        return $false
    }
    Write-Host '  Closed' -ForegroundColor Green
    return $true
}

# Is this install's own game running? Only a game run from <Root>\Game holds
# the files a script that writes into <Root> is about to write.
#
# A game whose path can be read counts when it is under <Root>\, with the
# backslash, so C:\Thornswood is not taken for C:\Thornswood-DevBuild. A game
# whose path cannot be read belongs to another Windows account. Until 12 Oct
# every one of those counted, so on the VPS, where the four build runners are
# four accounts, one runner's stand-in Skyrim (scripts\tests\test-2233-inuse-image.ps1
# runs a copy of ping.exe named SkyrimSE.exe) stopped Install-Thornswood.ps1 in
# another runner's tests\test-build-vs-install.ps1 (#2410). Which folder such a
# process runs from is told from the folder's side, as Build-Generated.ps1 does
# since #2233: a running program's file cannot be opened for writing (Windows
# answers with a sharing violation), whoever runs it.
function Test-GameImageRunning {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
        $fs.Dispose()
        return $false
    } catch {
        $e = $_.Exception
        while ($e -and $e -isnot [IO.IOException] -and $e.InnerException) { $e = $e.InnerException }
        # ERROR_SHARING_VIOLATION (32): the image is mapped by a running process.
        return ($e -is [IO.IOException] -and ($e.HResult -band 0xFFFF) -eq 32)
    }
}

function Test-GameRunning {
    param([Parameter(Mandatory)][string]$Root)

    $prefix = $Root.TrimEnd('\') + '\'
    foreach ($n in 'SkyrimSE', 'skse64_loader') {
        foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) {
            $path = $null
            try { $path = $p.MainModule.FileName } catch { }
            if ($path) {
                if ($path.StartsWith($prefix, 'OrdinalIgnoreCase')) { return $true }
            } elseif (Test-GameImageRunning (Join-Path $Root ('Game\' + $n + '.exe'))) {
                return $true
            }
        }
    }
    return $false
}

# Can the launcher exe be opened for write? A process that has already exited
# can still hold its image for a moment (the loader, or a scanner opening the
# exe after the process ends). Install-Launcher's one Copy-Item lost that race
# on a Ship (issue #1190), so Stop-Launcher waits here before it says Closed.
function Test-LauncherExeWritable {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $fs.Dispose()
        return $true
    } catch {
        return $false
    }
}

# Best-effort name for what still has the exe open. Restart Manager names
# holders that are not the image itself (a scanner, Explorer preview); the
# process table covers the case where the image path still matches.
function Get-LauncherExeHolders {
    param([Parameter(Mandatory)][string]$Path)

    $names = New-Object System.Collections.Generic.List[string]
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
        $img = $null
        try { $img = $p.MainModule.FileName } catch { }
        if ($img -and ($img -eq $Path)) {
            $names.Add("$($p.ProcessName) (pid $($p.Id))")
        }
    }

    try {
        if (-not ([System.Management.Automation.PSTypeName]'Thornswood.RestartMgr').Type) {
            Add-Type -Namespace Thornswood -Name RestartMgr -MemberDefinition @"
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
}
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValTStr, SizeConst = 256)]
    public string strAppName;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValTStr, SizeConst = 64)]
    public string strServiceShortName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    public bool bRestartable;
}
[System.Runtime.InteropServices.DllImport("rstrtmgr.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
[System.Runtime.InteropServices.DllImport("rstrtmgr.dll")]
public static extern int RmEndSession(uint pSessionHandle);
[System.Runtime.InteropServices.DllImport("rstrtmgr.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, System.IntPtr rgApplications, uint nServices, string[] rgsServiceNames);
[System.Runtime.InteropServices.DllImport("rstrtmgr.dll")]
public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [System.Runtime.InteropServices.In, System.Runtime.InteropServices.Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
"@
        }
        $session = [uint32]0
        $key = [Guid]::NewGuid().ToString()
        $rc = [Thornswood.RestartMgr]::RmStartSession([ref]$session, 0, $key)
        if ($rc -eq 0) {
            try {
                $files = @($Path)
                $rc = [Thornswood.RestartMgr]::RmRegisterResources($session, [uint32]$files.Count, $files, 0, [IntPtr]::Zero, 0, $null)
                if ($rc -eq 0) {
                    $needed = [uint32]0
                    $count = [uint32]0
                    $reboot = [uint32]0
                    $rc = [Thornswood.RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reboot)
                    if ($needed -gt 0) {
                        $infos = New-Object 'Thornswood.RestartMgr+RM_PROCESS_INFO[]' $needed
                        $count = $needed
                        $rc = [Thornswood.RestartMgr]::RmGetList($session, [ref]$needed, [ref]$count, $infos, [ref]$reboot)
                        if ($rc -eq 0) {
                            foreach ($info in $infos) {
                                $procId = $info.Process.dwProcessId
                                $label = $info.strAppName
                                if (-not $label) { $label = "pid $procId" }
                                else { $label = "$label (pid $procId)" }
                                if (-not $names.Contains($label)) { $names.Add($label) }
                            }
                        }
                    }
                }
            } finally {
                [void][Thornswood.RestartMgr]::RmEndSession($session)
            }
        }
    } catch { }

    if ($names.Count -eq 0) { return '' }
    return (($names | Select-Object -Unique) -join ', ')
}

function Wait-LauncherExeWritable {
    param(
        [Parameter(Mandatory)][string]$Path,
        [int]$DeadlineSec = 15
    )

    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    $deadline = [datetime]::UtcNow.AddSeconds($DeadlineSec)
    do {
        if (Test-LauncherExeWritable -Path $Path) { return $true }
        Start-Sleep -Milliseconds 250
    } while ([datetime]::UtcNow -lt $deadline)

    if (Test-LauncherExeWritable -Path $Path) { return $true }

    $holders = Get-LauncherExeHolders -Path $Path
    if ($holders) {
        Write-Host "  Still cannot open $Path for write after ${DeadlineSec}s; held by $holders" -ForegroundColor Yellow
    } else {
        Write-Host "  Still cannot open $Path for write after ${DeadlineSec}s; could not name what holds it" -ForegroundColor Yellow
    }
    return $false
}

function Stop-Launcher {
    param([Parameter(Mandatory)][string]$Root)

    $found = Get-LauncherProcesses -Root $Root
    if ($found.Mine.Count -eq 0) {
        if ($found.Unknown -gt 0) {
            Write-Host "  $($found.Unknown) launcher process(es) I cannot identify, left alone." -ForegroundColor Yellow
            Write-Host '  If this fails on a locked file, close the launcher by hand.' -ForegroundColor Yellow
        }
        # Nothing to close, but the exe can still be held (loader, scanner).
        # Wait so Install-Launcher's Copy-Item does not lose that race (#1190).
        $null = Wait-LauncherExeWritable -Path $found.Exe -DeadlineSec 15
        return $false
    }

    Write-Host '  Launcher is open, closing it' -ForegroundColor Yellow
    # Asking first matters: on the way out the launcher puts your Windows
    # Skyrim folders back. Killing it outright leaves them pointed at the build.
    foreach ($p in $found.Mine) { try { $null = $p.CloseMainWindow() } catch { } }
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not ($found.Mine | Where-Object { -not $_.HasExited })) { break }
    }
    foreach ($p in $found.Mine) {
        try { if (-not $p.HasExited) { Write-Host '    it did not close on its own, ending it' -ForegroundColor DarkGray; $p.Kill() } } catch { }
    }
    Start-Sleep -Milliseconds 500
    # Print Closed only once the exe can actually be opened for write (#1190).
    if (Wait-LauncherExeWritable -Path $found.Exe -DeadlineSec 15) {
        Write-Host '  Closed' -ForegroundColor Green
    }
    return $true
}

