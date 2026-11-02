<#
  test-shortcut-icons.ps1

      powershell -NoProfile -File .\tests\test-shortcut-icons.ps1

  Issue #887: the desktop and Start menu shortcuts lost their icons after a
  rebuild into the install folder, a Ship, and some self-updates, and only
  Settings, refresh icons brought them back.

  Two things caused it. Install-Launcher.ps1 named the icon file after the
  repository's app.ico and deleted every other icon-*.ico, while the launcher
  names it after the art inside the exe (app-dev.ico in the dev build, and
  whatever art the CI-built exe of a main Ship carries). So an install deleted
  the file the Start menu and pinned shortcuts name, and Windows drew them
  blank. The launcher then wrote the file back, but those shortcuts' IconLocation
  still read right, so Icons.Ensure changed nothing and never told Explorer;
  the only forced redraw (#816) keyed on Thornswood.exe.old, which a rebuild or
  a Ship never leaves.

  Part 1 compiles the real Icons.cs with the .NET SDK the launcher builds
  with (tests\Launcher-Csc.ps1, #4823) against stand-ins for Paths, Art and
  Swallow, and drives its Due / Remember / IconFile through reflection in a
  scratch folder, on any machine. Ensure itself is never called: it walks the
  real Desktop and Start menu and talks to Explorer. ShortcutsTo and Drop make
  real shortcuts through WScript.Shell, so they run on Windows only.

  Part 2 runs the real Install-Launcher.ps1 on a scratch root (which touches
  nothing outside its own folder, no Desktop, no Explorer) with a build whose
  art is not the repository's, and checks the icon file is named after the
  build's art. Since #4823 the exe is native code, whose resources cannot be
  read back out of it, so Build-Launcher.ps1 writes the two icons the exe
  embeds beside it and Install-Launcher reads those: the stand-in build is a
  folder, an exe, a native library and the two icons. It also checks the
  whole folder goes in, that a dev root takes app-dev.ico, and that a build
  with no icon stops before anything is installed rather than falling back
  to the repository's art. It runs Windows PowerShell and reads shortcuts, so
  it runs on Windows only.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}
function Hash8([byte[]]$b) {
    $sha = [Security.Cryptography.SHA256]::Create()
    ([BitConverter]::ToString($sha.ComputeHash($b), 0, 4)).Replace('-', '').ToLower()
}

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$appIco = Join-Path $Repo 'launcher\app.ico'
$devIco = Join-Path $Repo 'launcher\app-dev.ico'
$iconsCs = Join-Path $Repo 'launcher\app\Icons.cs'
$mainHash = Hash8 ([IO.File]::ReadAllBytes($appIco))
$devHash = Hash8 ([IO.File]::ReadAllBytes($devIco))
Yes 'the two artworks hash to different names (otherwise part 2 proves nothing)' ($mainHash -ne $devHash)

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-icons-887-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    # ---- 1. the real Icons.cs ----------------------------------------------------
    $stub = @'
using System;
namespace Thornswood
{
    public static class Paths { public static string Root, LauncherDir, ProfileDir; }
    public static class Swallow { public static void Note(string where, Exception ex) { } }
}
'@
    $asm = $null
    # Built, then loaded: Add-LauncherType takes no resources, and Icons reads
    # its art from its own assembly's. It uses no package, so nothing else loads.
    try { $asm = [Reflection.Assembly]::LoadFrom((Build-LauncherCode -Source $stub -File $iconsCs, (Join-Path (Split-Path -Parent $iconsCs) 'InstallShortcut.cs') -Resource @{ 'app.ico' = $appIco; 'app-dev.ico' = $devIco })) }
    catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" } }
    Yes 'Icons.cs compiles with the .NET SDK the launcher builds with' ($null -ne $asm)
    if (-not $asm) { Done }

    $icons = $asm.GetType('Thornswood.Icons')
    $paths = $asm.GetType('Thornswood.Paths')
    $nps = [Reflection.BindingFlags]'NonPublic, Static'
    $due = $icons.GetMethod('Due', $nps)
    $remember = $icons.GetMethod('Remember', $nps)
    $iconFile = $icons.GetMethod('IconFile', $nps)
    $wroteField = $icons.GetField('iconWritten', $nps)
    Yes 'Icons has Due, Remember, IconFile and iconWritten' ($due -and $remember -and $iconFile -and $wroteField)
    if (-not ($due -and $remember -and $iconFile -and $wroteField)) { Done }

    $root = Join-Path $work 'root'
    $launcherDir = Join-Path $root 'Launcher'
    $profileDir = Join-Path $root 'Profile'
    New-Item -ItemType Directory -Force -Path $launcherDir, $profileDir | Out-Null
    $paths.GetField('Root').SetValue($null, $root)
    $paths.GetField('LauncherDir').SetValue($null, $launcherDir)
    $paths.GetField('ProfileDir').SetValue($null, $profileDir)

    function IconNow { $wroteField.SetValue($null, $false); $p = $iconFile.Invoke($null, @()); @{ Path = $p; Wrote = [bool]$wroteField.GetValue($null) } }

    # The icon file: written when missing, and says so.
    $r = IconNow
    Yes "IconFile writes icon-$mainHash.ico for the main build" ($r.Path -and (Split-Path -Leaf $r.Path) -eq "icon-$mainHash.ico" -and (Test-Path -LiteralPath $r.Path))
    Yes 'and reports it had to write it' $r.Wrote
    $r = IconNow
    Yes 'an ordinary start finds it in place and writes nothing' (-not $r.Wrote)
    Remove-Item -LiteralPath $r.Path -Force   # what Install-Launcher's sweep used to do
    $r = IconNow
    Yes 'a start after an install deleted it writes it back before any shortcut is touched' ((Test-Path -LiteralPath $r.Path) -and $r.Wrote)

    # #2627: what Ensure would change, said and not done, for Scan. Here the
    # icon file and the stamp count; the shortcuts in the real Desktop and
    # Start menu are not this harness's to write (see below).
    $outOfDate = $icons.GetMethod('OutOfDate', [Reflection.BindingFlags]'Public, Static')
    Yes 'Icons has OutOfDate, what Ensure would change, for Scan (#2627)' ([bool]$outOfDate)
    if ($outOfDate) {
        $iconNow = [string]$r.Path
        Remove-Item -LiteralPath $iconNow -Force
        $seen = { @(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $_.FullName + '|' + $_.Length + '|' + $_.LastWriteTimeUtc.Ticks }) -join "`n" }
        $before = & $seen
        $l = @($outOfDate.Invoke($null, @()))
        Yes 'with the icon file gone, OutOfDate says so' (@($l | Where-Object { "$_" -like '*icon file*' }).Count -eq 1)
        Yes 'and writes nothing: the icon file is still gone, and no stamp or shortcut appeared' (((& $seen) -eq $before) -and -not (Test-Path -LiteralPath $iconNow))
        $r = IconNow
        # The launcher Icons itself names (Icons.Exe, the running process since
        # #4823, so here this PowerShell): what OutOfDate compares the stamp with.
        [string]$thisExe = $icons.GetProperty('Exe').GetValue($null)
        $remember.Invoke($null, @($thisExe, ([string]$r.Path + ',0'))) | Out-Null
        $l = @($outOfDate.Invoke($null, @()))
        # This PowerShell is a file that exists, so on Windows OutOfDate also
        # says the real Desktop and Start menu have no Thornswood.lnk to it.
        # They are not this harness's to write (the header), so those lines
        # are set aside here, by their exact shape, and only those.
        $missing = @($l | Where-Object { "$_" -match '\\Thornswood\.lnk is missing$' })
        $rest = @($l | Where-Object { "$_" -notmatch '\\Thornswood\.lnk is missing$' })
        Yes ('with the icon written and the shortcuts redrawn for this launcher, nothing is out of date' + $(if ($rest.Count) { ' (' + ($rest -join '; ') + ')' } else { '' })) ($rest.Count -eq 0)
        if ($missing.Count) { Write-Host ('      set aside, places this harness does not write: ' + ($missing -join '; ')) }
        Remove-Item -LiteralPath (Join-Path $profileDir 'icons.stamp') -Force
    }
    $want = [string]$r.Path + ',0'

    # The stamp: a rebuild-style change with no .old.
    [string]$exe = Join-Path $launcherDir 'Thornswood.exe'
    [IO.File]::WriteAllBytes($exe, [byte[]](1..200))
    (Get-Item -LiteralPath $exe).LastWriteTimeUtc = [datetime]::new(2026, 9, 27, 16, 33, 32, [DateTimeKind]::Utc)
    $stamp = Join-Path $profileDir 'icons.stamp'
    Yes 'the first start with no stamp redraws' ([bool]$due.Invoke($null, @($exe, $want, $false)))
    $remember.Invoke($null, @($exe, $want)) | Out-Null
    Yes 'Remember writes Profile\icons.stamp' (Test-Path -LiteralPath $stamp)
    Yes 'an unchanged start does not redraw' (-not [bool]$due.Invoke($null, @($exe, $want, $false)))
    Yes 'and again, still quiet' (-not [bool]$due.Invoke($null, @($exe, $want, $false)))

    # Rebuild into the install folder: copied over in place, no .old left.
    [IO.File]::WriteAllBytes($exe, [byte[]](1..250))
    (Get-Item -LiteralPath $exe).LastWriteTimeUtc = [datetime]::new(2026, 9, 28, 1, 22, 53, [DateTimeKind]::Utc)
    Yes 'the rebuild left no Thornswood.exe.old, so the #816 path would not run' (-not (Test-Path -LiteralPath ($exe + '.old')))
    Yes 'a rebuild copied over the exe with no .old redraws' ([bool]$due.Invoke($null, @($exe, $want, $false)))
    $remember.Invoke($null, @($exe, $want)) | Out-Null
    Yes 'and the start after it is quiet again' (-not [bool]$due.Invoke($null, @($exe, $want, $false)))

    # Same size, new build time (a rebuild of the same source).
    (Get-Item -LiteralPath $exe).LastWriteTimeUtc = [datetime]::new(2026, 9, 28, 12, 0, 0, [DateTimeKind]::Utc)
    Yes 'a same-size exe with a new write time redraws' ([bool]$due.Invoke($null, @($exe, $want, $false)))
    $remember.Invoke($null, @($exe, $want)) | Out-Null

    # The icon file had to be written back: redraw even with the exe unchanged.
    Yes 'an icon file written back forces a redraw on an otherwise unchanged start' ([bool]$due.Invoke($null, @($exe, $want, $true)))
    # New artwork, new name.
    Yes 'a different icon file redraws' ([bool]$due.Invoke($null, @($exe, ($launcherDir + '\icon-00000000.ico,0'), $false)))

    # Main and Dev keep their own stamp: each install has its own Profile.
    $devRoot = Join-Path $work 'root-DevBuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $devRoot 'Launcher'), (Join-Path $devRoot 'Profile') | Out-Null
    $paths.GetField('LauncherDir').SetValue($null, (Join-Path $devRoot 'Launcher'))
    $paths.GetField('ProfileDir').SetValue($null, (Join-Path $devRoot 'Profile'))
    $icons.GetField('Dev').SetValue($null, $true)
    $r = IconNow
    Yes "the dev build's IconFile is icon-$devHash.ico (app-dev.ico)" ($r.Path -and (Split-Path -Leaf $r.Path) -eq "icon-$devHash.ico")
    Yes 'the dev install does not read the main install''s stamp' ([bool]$due.Invoke($null, @($exe, $want, $false)))
    $icons.GetField('Dev').SetValue($null, $false)

    # #3205: removal finds shortcuts by what they run, not by name. A pin left
    # behind under Thornswood.lnk made the next pin "Thornswood (2)".
    $to = $icons.GetMethod('ShortcutsTo', [Reflection.BindingFlags]'Public, Static')
    $drop = $icons.GetMethod('Drop', [Reflection.BindingFlags]'Public, Static')
    Yes 'Icons has ShortcutsTo and Drop (#3205)' ($to -and $drop)
    if (-not $OnWindows) {
        Write-Host 'SKIP  ShortcutsTo and Drop on real shortcuts: they are made through WScript.Shell, which only Windows has'
    }
    elseif ($to -and $drop) {
        $ws = New-Object -ComObject WScript.Shell
        function Link([string]$name, [string]$target) {
            $p = Join-Path $root $name
            $sc = $ws.CreateShortcut($p); $sc.TargetPath = $target; $sc.Save()
            $p
        }
        [string]$devExe = Join-Path $devRoot 'Launcher\Thornswood.exe'
        $numbered = Link 'Thornswood (2).lnk' $exe
        $other = Link 'Thornswood.lnk' 'C:\Gone\Launcher\Other.exe'
        $devLnk = Link 'Thornswood Dev.lnk' $devExe
        $found = @($to.Invoke($null, @($exe)))
        Yes 'ShortcutsTo finds the shortcut that runs this exe under a name that is not its own' ($found -contains $numbered)
        Yes 'and not one called Thornswood.lnk that runs something else, nor the dev build''s' (-not ($found -contains $other) -and -not ($found -contains $devLnk))
        $gone = [int]$drop.Invoke($null, @($exe))
        Yes "Drop deletes just that one (said $gone)" ($gone -eq 1 -and -not (Test-Path -LiteralPath $numbered) -and (Test-Path -LiteralPath $other) -and (Test-Path -LiteralPath $devLnk))
        Remove-Item -LiteralPath $other, $devLnk -Force
    }
    $src0 = Get-Content -LiteralPath $iconsCs -Raw
    $toAt = $src0.IndexOf('public static List<string> ShortcutsTo(string exe)')
    Yes 'ShortcutsTo walks the same places as Ensure, the pinned taskbar folder among them' ($toAt -ge 0 -and $src0.IndexOf('foreach (Place spot in Places())', $toAt) -gt $toAt -and $src0.Contains('User Pinned\\TaskBar'))

    # Ensure wires it in before the walk, and remembers after it.
    $src = Get-Content -LiteralPath $iconsCs -Raw
    $ensureAt = $src.IndexOf('public static int Ensure(bool force)')
    $dueAt = $src.IndexOf('Due(exe, want, iconWritten)', $ensureAt)
    $walkAt = $src.IndexOf('foreach (Place spot in Places())', $ensureAt)
    $rememberAt = $src.IndexOf('Remember(exe, want)', $ensureAt)
    Yes 'Ensure asks Due before it walks the shortcuts' ($ensureAt -ge 0 -and $dueAt -gt $ensureAt -and $dueAt -lt $walkAt)
    Yes 'and remembers after the walk' ($rememberAt -gt $walkAt)
    Yes 'IconFile is called before Due, so the file the shortcuts name exists first' ($src.IndexOf('string icon = IconFile();', $ensureAt) -lt $dueAt)
    Yes 'ordinary starts never kill Explorer: taskkill is only in Repair' ($src.IndexOf('taskkill') -gt $src.IndexOf('public static string Repair()'))

    # ---- 2. Install-Launcher.ps1 names the file after the exe's art -------------
    if (-not $OnWindows) {
        Write-Host 'SKIP  2, Install-Launcher.ps1 on a scratch root: it runs in Windows PowerShell and the shortcut it makes is read through WScript.Shell, which only Windows has'
        Done
    }
    $stage = Join-Path $work 'stage'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    # A build whose app.ico is the dev art: what a CI-built launcher with art
    # other than the checkout's looks like to the install. app-dev.ico is the
    # main art, so a dev root taking the other file shows. Install-Launcher
    # reads neither the exe nor the library (#4823), but the exe is a real
    # Windows program: on the gate's runner the shell would not save a
    # shortcut to an exe of stand-in bytes ("Unable to save shortcut"), and
    # saved one to the compiled stand-in this used before. The library is
    # stand-in bytes.
    $standDll = $null
    try { $standDll = Build-LauncherCode -Exe -Property @{ UseAppHost = 'true' } -Source "class P { static void Main() { } }`n" }
    catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" } }
    $standExe = if ($standDll) { [IO.Path]::ChangeExtension($standDll, '.exe') } else { '' }
    Yes 'a stand-in Thornswood.exe that is a real program compiles' ($standExe -and (Test-Path -LiteralPath $standExe))
    if (-not ($standExe -and (Test-Path -LiteralPath $standExe))) { Done }
    Copy-Item -LiteralPath $standExe -Destination (Join-Path $stage 'Thornswood.exe')
    [IO.File]::WriteAllBytes((Join-Path $stage 'libSkiaSharp.dll'), [byte[]](@(0x4D, 0x5A) + [byte[]](201..250)))
    Copy-Item -LiteralPath $devIco -Destination (Join-Path $stage 'app.ico')
    Copy-Item -LiteralPath $appIco -Destination (Join-Path $stage 'app-dev.ico')
    $sroot = Join-Path $work 'scratchroot'
    $ps = Get-WindowsPowerShell
    $inst = Join-Path $Repo 'scripts\release\Install-Launcher.ps1'
    $sLauncher = Join-Path $sroot 'Launcher'
    New-Item -ItemType Directory -Force -Path $sLauncher | Out-Null
    # The file a shortcut named before this install, same art as the exe.
    [IO.File]::WriteAllBytes((Join-Path $sLauncher "icon-$devHash.ico"), [IO.File]::ReadAllBytes($devIco))
    # Continue, so a line on the child's stderr is read as output rather than
    # stopping this script before the checks say what happened.
    $ErrorActionPreference = 'Continue'
    $iout = & $ps -NoProfile -ExecutionPolicy Bypass -File $inst -Root $sroot -From $stage -NoClose -NoPause 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Yes "the scratch install passes (exit $code)" ($code -eq 0)
    if ($code -ne 0) { Write-Host $iout }
    Yes "the install keeps icon-$devHash.ico, the art the exe carries" (Test-Path -LiteralPath (Join-Path $sLauncher "icon-$devHash.ico"))
    Yes "and does not write icon-$mainHash.ico from the repository's app.ico" (-not (Test-Path -LiteralPath (Join-Path $sLauncher "icon-$mainHash.ico")))
    $lnk = Join-Path $sroot 'Thornswood.lnk'
    $loc = ''
    if (Test-Path -LiteralPath $lnk) { $loc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).IconLocation }
    Yes 'the scratch shortcut names that same file' ($loc -like "*\icon-$devHash.ico,0")
    Yes 'a scratch install asks nothing of Explorer' ($iout -notmatch 'Explorer told to redraw' -and $iout -notmatch 'Explorer restarted')
    $sameBytes = { param($a, $b) (Test-Path -LiteralPath $a) -and (Get-FileHash -LiteralPath $a).Hash -eq (Get-FileHash -LiteralPath $b).Hash }
    Yes 'the whole build went in: the exe and the native library beside it, byte for byte (#4823)' (
        (& $sameBytes (Join-Path $sLauncher 'Thornswood.exe') (Join-Path $stage 'Thornswood.exe')) -and
        (& $sameBytes (Join-Path $sLauncher 'libSkiaSharp.dll') (Join-Path $stage 'libSkiaSharp.dll')))

    # A dev root's shortcuts get app-dev.ico, as the dev launcher picks it.
    $droot = Join-Path $work 'scratch-DevBuild'
    $ErrorActionPreference = 'Continue'
    $dout = & $ps -NoProfile -ExecutionPolicy Bypass -File $inst -Root $droot -From $stage -NoClose -NoPause 2>&1 | Out-String
    $dcode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Yes "a dev root installs (exit $dcode)" ($dcode -eq 0)
    if ($dcode -ne 0) { Write-Host $dout }
    Yes "  and names its icon file after the build's app-dev.ico (icon-$mainHash.ico here)" (Test-Path -LiteralPath (Join-Path $droot "Launcher\icon-$mainHash.ico"))

    # A build with no icon beside its exe stops, before it closes or copies
    # anything, rather than taking the repository's art (#887).
    $bare = Join-Path $work 'bare'
    New-Item -ItemType Directory -Force -Path $bare | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $bare 'Thornswood.exe'), [byte[]](@(0x4D, 0x5A) + [byte[]](9..99)))
    $exeBefore = (Get-FileHash -LiteralPath (Join-Path $sLauncher 'Thornswood.exe')).Hash
    $ErrorActionPreference = 'Continue'
    $bout = & $ps -NoProfile -ExecutionPolicy Bypass -File $inst -Root $sroot -From $bare -NoClose -NoPause 2>&1 | Out-String
    $bcode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Yes "a build with no app.ico beside its exe stops (exit $bcode)" ($bcode -eq 1 -and $bout -match 'There is no app\.ico beside Thornswood\.exe')
    Yes '  and installs nothing: the exe in place is the one before' ((Get-FileHash -LiteralPath (Join-Path $sLauncher 'Thornswood.exe')).Hash -eq $exeBefore)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
