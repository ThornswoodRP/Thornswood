<#
  test-4693-setup-reader.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4693-setup-reader.ps1

  A screen reader can use the setup window (#4693). Its drive buttons were
  read as their letter alone, as buttons, with the chosen drive shown by
  colour only, the progress bar and the install's log had no name, two links
  were both "Read them", and each new status line was never told to Windows.
  The cause: launcher\app\InstallWindow.cs gave UI Automation nothing of its
  own. A button whose content is a panel is named by its first line, a
  plain Button has no selected state, and a control's live setting is Off
  until it is set.

  HOW. Builds launcher\app\Thornswood.csproj as it is (Build-LauncherProject,
  tests\Launcher-Csc.ps1), then launcher\tests\window-starts against that
  Thornswood.dll, and runs it with setup-reader (SetupReader.cs there): the
  real install window on Avalonia's headless platform, read through the
  automation peers Windows' UI Automation reads on a PC.

    1. Every drive button is a radio button named by its letter, its free
       space and, on Skyrim's, Skyrim is here. The drive the install would
       go on reads as selected, the others not, and each change is raised.
    2. The three links are named by the page each opens, all different.
    3. The progress bar is a progress bar named for the install, and its
       value changes are raised as the install moves.
    4. The log has a name, and the status line is a live region whose new
       lines are raised.

  Enter and Esc are test-4459-setup-keys.ps1's. What Narrator itself says
  on a PC is for a person to hear: this reads what the window hands it.
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
        $work = Join-Path $launcherRepo (Join-Path 'out' (Join-Path 'harness' ('setup-reader-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
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
                $lines = @(& $LauncherDotnet $exe 'setup-reader' 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                foreach ($l in $lines) {
                    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
                    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
                    else { Write-Host $l }
                }
                Yes 'the setup window was read and every check in it ran' ($code -eq 0 -and $lines.Count -gt 0)
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
