<#
  test-4409-setup-look.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4409-setup-look.ps1

  The setup window follows Windows' look (#4409). It drew in Thornswood's own
  dark colours with a Windows contrast theme on, every text size in it was
  fixed so Windows' text size changed nothing, and the progress bar was 5
  pixels high in the same fixed colours. The cause: InstallWindow.cs applied
  Forge and literal sizes unconditionally, and nothing in the launcher read
  Windows' contrast state or its text size.

  HOW. Builds launcher\app\Thornswood.csproj as it is (Build-LauncherProject,
  tests\Launcher-Csc.ps1), then launcher\tests\window-starts against that
  Thornswood.dll, and runs it with setup-look (SetupLook.cs there): the real
  install window on Avalonia's headless platform, handed a planted
  SystemLook.

    1. A contrast theme on: the window's ground is the theme's Window colour,
       and every brush drawn in it, as it opens, with every box ticked, the
       pointer on Install, a button pressed, and while it installs, is one of
       the theme's colours. The planted theme's colours are in no palette of
       the launcher's or Fluent's, so a leftover cannot pass by chance.
    2. No contrast theme: the window is Forge as before.
    3. Windows' text size at 125%, 150% and 225%: every text in the window is
       that much bigger than at 100%.
    4. At 100%, 150% and 225%, in the usual 700 by 800 and the smallest 560
       by 520, before and while it installs: nothing runs off the side or the
       bottom of what holds it, nothing gets less room than it needs, and no
       text is cut short. At 100% in 700 by 800 only the middle scrolls, as
       it always has.
    5. On Windows only, SystemLook.Read reads this machine: a text size of
       100% to 225% and every colour as #RRGGBB. Off Windows there is no
       contrast theme or text size to read, so 1 to 4 run on the planted look
       there and 5 is not run; the harness says so.

  Red before #4409: there was no SystemLook and the window took none.

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
        $work = Join-Path $launcherRepo (Join-Path 'out' (Join-Path 'harness' ('setup-look-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
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
                $lines = @(& $LauncherDotnet $exe 'setup-look' 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                foreach ($l in $lines) {
                    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
                    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
                    else { Write-Host $l }
                }
                Yes 'the setup window was drawn and every check in it ran' ($code -eq 0 -and $lines.Count -gt 0)
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
