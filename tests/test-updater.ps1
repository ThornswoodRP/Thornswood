<#
  test-updater.ps1

      pwsh -NoProfile -File .\tests\test-updater.ps1

  The fence round every file the launcher's own code writes or deletes under
  a folder, asked its own questions: PathFence.Inside (launcher\app\
  PathFence.cs), which the setup program compiles in too, so its unpack is
  held to the same fence.

  WHY THIS EXISTS. Until #5608 this asked six functions of the updater that
  decided what counted as an update and which files a pack might write or
  delete (IsNewer, Parts, Inside, ClaimedElsewhere, Pending, CheckUrl). The
  packs and the update feed went with #5608: the launcher updates through
  Velopack from GitHub, held to the signed release record
  (launcher\tests\test-5608-github-direct.ps1, test-channel-release.ps1), and
  Inside, the one of the six still in use, is what is left here.
  "C:\Thornswood2\anything" starts with "C:\Thornswood", so a plain prefix
  test let a pack reach next door; measured 24 September, Inside as a plain
  prefix turned four of these red.

  HOW. It builds the launcher project itself with the .NET 10 SDK, as the
  build does (Add-LauncherAssembly, tests\Launcher-Csc.ps1), loads it into
  this PowerShell, which runs on .NET 10 as the launcher does, and calls
  Inside by reflection. Nothing in the launcher runs: no Main, no window, no
  network. It runs wherever the SDK is, Linux too (#4823). Inside's fence is
  the system's own separator, so its checks are written in it, and the drive
  letter check is Windows' alone.

  KNOWN lines are behaviours that look wrong and are left for Patrick to
  decide. They print what the launcher returns today and are not counted
  either way, so fixing one does not turn this red.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the launcher's own build, by the .NET 10 SDK (#4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$Src = Join-Path $Here 'launcher\app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Known([string]$what) { Write-Host "KNOWN $what" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsupdater-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }

    # ---- build ---------------------------------------------------------------
    #
    # The launcher project itself, built as the build builds it, and loaded
    # into this PowerShell, which runs on .NET 10 as the launcher does. Nothing
    # in the launcher runs: no Main, no window, no network.
    $asm = $null
    try { $asm = Add-LauncherAssembly }
    catch {
        Yes 'the launcher project builds' $false
        foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "      $l" }
        return
    }
    Yes 'the launcher project builds' ($null -ne $asm)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $F = $asm.GetType('Thornswood.PathFence')
    $script:m = @{ 'Inside' = $(if ($null -ne $F) { $F.GetMethod('Inside', $flags) } else { $null }) }
    Yes 'PathFence.Inside is in the build' ($null -ne $script:m['Inside'])
    if ($null -eq $script:m['Inside']) { return }

    # ---- Inside: the fence round every write and delete ----------------------
    #
    # From the comment above it: "C:\Thornswood2\anything" starts with
    # "C:\Thornswood", so a plain prefix test let a pack reach next door.
    # The fence is the system's own separator (Path.DirectorySeparatorChar),
    # so the paths here are written in it: C:\ and \ on Windows, where the
    # launcher runs, / anywhere else this runs, the same rule either way.
    $s = [string][IO.Path]::DirectorySeparatorChar
    $top = if ($OnWindows) { 'C:' } else { '' }
    function W([string]$p) { return ($top + $s + $p.Replace('\', $s)) }
    Yes 'Inside: a file under the game folder is inside it' ((Within (W 'Thornswood\Game\Data\Thornswood.esp') (W 'Thornswood\Game')) -eq $true)
    Yes 'Inside: Thornswood2\anything is not inside Thornswood' ((Within (W 'Thornswood2\anything') (W 'Thornswood')) -eq $false)
    Yes 'Inside: the folder is not inside itself, so nothing can delete the fence' ((Within (W 'Thornswood\Game') (W 'Thornswood\Game')) -eq $false)
    Yes 'Inside: a folder given with its separator on the end' (
        (Within (W 'Thornswood\Game\x') ((W 'Thornswood\Game') + $s)) -eq $true -and (Within (W 'Thornswood\Game\x') ((W 'Thornswood\Game') + '/')) -eq $true)
    Yes 'Inside: the case of the letters does not matter, as on Windows' ((Within (W 'thornswood\game\data\x') (W 'Thornswood\Game')) -eq $true)
    if ($OnWindows) {
        Yes 'Inside: the same folder on another drive is not inside' ((Within 'D:\Thornswood\Game\x' 'C:\Thornswood\Game') -eq $false)
    }
    Yes 'Inside: nothing given is inside nothing' (
        (Within $null (W 'Thornswood')) -eq $false -and (Within (W 'Thornswood\x') $null) -eq $false -and (Within '' (W 'Thornswood')) -eq $false)

    # Every caller resolves the path first: Combine leaves
    # a .. where it is, and it is Delete that would resolve it, outside the
    # game. This is that pattern, on the lines a bad pack would carry.
    $game = W 'Thornswood\Game'
    $out = @('..\..\Profile\config.json', '..\Game2\x', 'Data\..\..\x', '\Windows\x')
    if ($OnWindows) { $out += 'C:\Windows\System32\x.dll' }
    foreach ($line in $out) {
        Yes "Inside: a pack line '$line', resolved as the callers resolve it, stays out" ((Fenced $game $line.Replace('\', $s)) -eq $false)
    }
    foreach ($line in @('Data\Platform\Plugins\thornswood-front.js', 'Data\..\Data\x.esp')) {
        Yes "Inside: a pack line '$line', resolved the same way, is let in" ((Fenced $game $line.Replace('\', $s)) -eq $true)
    }

    # ---- known, and left for Patrick ------------------------------------------
    #
    # Measured here and written down, not asserted: each is a decision about
    # PathFence.cs, which the setup program shares.
    Write-Host ''
    if ($OnWindows) { Known ("Inside('C:\Thornswood\Game\..\..\Windows\x', 'C:\Thornswood\Game') is {0}, and Inside('C:\Thornswood\Game\x', 'C:/Thornswood/Game') is {1}. It compares text and resolves neither side. Every caller resolves the path with Path.GetFullPath first, which is why the resolved lines above stay out; a new caller that forgets gets the first answer, and a folder written with forward slashes would fence everything out." -f (Within 'C:\Thornswood\Game\..\..\Windows\x' 'C:\Thornswood\Game'), (Within 'C:\Thornswood\Game\x' 'C:/Thornswood/Game')) }
}

# ---- how each function is asked ---------------------------------------------
#
# Every answer goes back through the comma, so a list or an array comes out
# as one value rather than being unrolled into the pipeline on the way. Every
# argument goes in as the value underneath, because a path from Join-Path
# arrives wrapped and reflection will not turn the wrapper into a string.
function Ask($name) {
    $a = New-Object object[] $args.Count
    for ($i = 0; $i -lt $args.Count; $i++) {
        if ($null -ne $args[$i]) { $a[$i] = $args[$i].psobject.BaseObject }
    }
    return , ($script:m[$name].Invoke($null, $a))
}
function Within($full, $folder) { return [bool](Ask 'Inside' $full $folder) }
function Fenced([string]$fence, [string]$line) {
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($fence, $line))
    return (Within $full $fence)
}
try {
    try { Run }
    catch { Yes ('the harness ran to the end, and stopped on: ' + $_.Exception.Message) $false }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
