<#
  test-4550-play-after-quit.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4550-play-after-quit.ps1

  A key pressed as the game closes does not start it again (#4550). On One
  on 26 Nov 2026 the game closed at 21:02:04Z and Space pressed Play 0.4 s
  later, so the game started again by itself (Profile\launcher.log: "Play
  pressed by the keyboard (last key Space, 0 ms ago), window active, 0.4 s
  after the last game closed."). The cause: the launcher's window keeps the
  last control that had focus and gives it back whenever the window is
  active again. Play had it from the press that started the game, and when
  the game closes the launcher comes back to the front (Shell.Wire), so the
  key went to Play. Turning Play off while the game runs does not change
  what the window gives back. Since #4550 the game's start moves the
  keyboard onto the window's frame (MainWindow.FocusOffButtons), which acts
  on no key and is no tab stop.

  HOW. Builds launcher\app\Thornswood.csproj as it is (Build-LauncherProject,
  tests\Launcher-Csc.ps1), then launcher\tests\window-starts against that
  Thornswood.dll, and runs it with play-after-quit (PlayAfterQuit.cs there):
  the real window on Avalonia's headless platform. Play is clicked with the
  mouse, the game runs and closes as Shell does it, and Space and Enter are
  pressed:

    1. With the launcher's own start, the window comes back with no button
       focused, Space and Enter press nothing, Tab still reaches a button,
       and a click on Play still starts the game.
    2. Without it, which is how it was, Play has the focus back and Space
       presses it: the restart on One, so the harness can see it.
    3. ShellPlay makes the call as the game starts, before Play turns off,
       and Shell still brings the window to the front when the game closes.

  No screen is needed, so it runs on Linux and Windows alike.

  Builds under out\harness\ (which git ignores) and deletes its own folder.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK and settings
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $dll = $null
    try { $dll = Build-LauncherProject } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds as it is' ([bool]$dll)
    if ($dll) {
        $work = Join-Path $launcherRepo (Join-Path 'out' (Join-Path 'harness' ('play-after-quit-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
        $null = New-Item -ItemType Directory -Force -Path $work
        try {
            $sep = [IO.Path]::DirectorySeparatorChar
            $bin = Join-Path $work 'bin'
            $proj = Join-Path $PSScriptRoot (Join-Path 'window-starts' 'WindowStarts.csproj')
            $said = & $LauncherDotnet build $proj -c Release -o $bin ('-p:LauncherDll=' + $dll) ('-p:BaseIntermediateOutputPath=' + (Join-Path $work 'obj') + $sep) ('-p:BaseOutputPath=' + (Join-Path $work 'out') + $sep) -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
            $exe = Join-Path $bin 'WindowStarts.dll'
            $built = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe))
            if (-not $built) { Write-Host ('      ' + $said.Trim()) }
            Yes 'the headless window builds against that launcher' $built
            if ($built) {
                $lines = @(& $LauncherDotnet $exe 'play-after-quit' $launcherRepo 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                foreach ($l in $lines) {
                    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
                    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
                    else { Write-Host $l }
                }
                Yes 'the window was worked through a game that closes and every check in it ran' ($code -eq 0 -and $lines.Count -gt 0)
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
