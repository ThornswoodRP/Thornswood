<#
  test-window-starts.ps1

      pwsh -NoProfile -File .\launcher\tests\test-window-starts.ps1

  The launcher's window starts (2 Nov 2026). A scroll bar theme in
  MainWindow.axaml had two /template/ steps in one selector. It compiled and
  every check passed, but Avalonia refused it the first time a scroll bar was
  drawn, so the launcher stopped at start for Patrick with "ControlTemplate
  styles cannot contain multiple template selectors". Avalonia builds a theme
  only when something first asks for it, so only starting the window finds
  that.

  HOW. Builds launcher\app\Thornswood.csproj as it is (Build-LauncherProject,
  tests\Launcher-Csc.ps1), then launcher\tests\window-starts against that
  Thornswood.dll, and runs it: Avalonia's headless platform, the real App and
  MainWindow, shown and laid out as at start, then every style and theme the
  app and the window hold built and drawn, and every hidden part of the
  window shown and laid out. Its lines are this harness's, one PASS or FAIL a
  check. No screen is needed, so it runs on Linux and Windows alike.

  It also works the Settings music slider from the keyboard (#4327): Tab from
  the music tick box lands on the slider, the slider shows the buttons' focus
  ring, and the arrow keys move it. Its theme had made it unfocusable, so Tab
  passed it by and only a mouse could set the volume.

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
        $work = Join-Path $launcherRepo (Join-Path 'out' (Join-Path 'harness' ('window-starts-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
        $null = New-Item -ItemType Directory -Force -Path $work
        try {
            $sep = [IO.Path]::DirectorySeparatorChar
            $bin = Join-Path $work 'bin'
            $proj = Join-Path $PSScriptRoot (Join-Path 'window-starts' 'WindowStarts.csproj')
            $said = & $LauncherDotnet build $proj -c Release -o $bin ('-p:LauncherDll=' + $dll) ('-p:BaseIntermediateOutputPath=' + (Join-Path $work 'obj') + $sep) ('-p:BaseOutputPath=' + (Join-Path $work 'out') + $sep) -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
            $exe = Join-Path $bin 'WindowStarts.dll'
            $built = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe))
            if (-not $built) { Write-Host ('      ' + $said.Trim()) }
            Yes 'the headless start builds against that launcher' $built
            if ($built) {
                $lines = @(& $LauncherDotnet $exe 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                foreach ($l in $lines) {
                    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
                    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
                    else { Write-Host $l }
                }
                Yes 'the window started and every check in it ran' ($code -eq 0 -and $lines.Count -gt 0)
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
