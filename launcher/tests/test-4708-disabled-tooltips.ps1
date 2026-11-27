<#
  test-4708-disabled-tooltips.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4708-disabled-tooltips.ps1

  A greyed control's tooltip shows when it is hovered (#4708). The launcher
  puts the reason Play is greyed in Play's tooltip, in every state where it
  is greyed (Shell.cs), and some of those reasons are said nowhere else. The
  cause: Avalonia shows no tooltip on a disabled control unless
  ToolTip.ShowOnDisabled says so, and nothing in the launcher said so, so
  hovering a greyed Play showed nothing. Since #4708 App.axaml sets it on
  every window, and it is inherited by every control in one.

  HOW. First the source: App.axaml sets ToolTip.ShowOnDisabled on every
  TopLevel, and no file under launcher\app turns it off again. Then it
  builds launcher\app\Thornswood.csproj as it is (Build-LauncherProject,
  tests\Launcher-Csc.ps1), then launcher\tests\window-starts against that
  Thornswood.dll, and runs it with disabled-tips (DisabledTips.cs there):
  the real windows on Avalonia's headless platform, hovered with the pointer.

    1. Hovering Play while it is on shows its tooltip, so the hover works.
    2. Hovering a greyed Play shows the tooltip that says why.
    3. Every control in the main window, hidden pages too, and in the install
       window would show its tooltip while greyed; the install window's
       greyed Install, given a tooltip, shows it when hovered.
    4. A window made in code, as Acceptance.cs makes one, does too.

  On main 2, 3 and 4 fail: the tooltip stays closed on a greyed control.

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

$app = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$appXaml = [IO.File]::ReadAllText((Join-Path $app 'App.axaml'))
Yes 'App.axaml sets ToolTip.ShowOnDisabled on every window' (
    $appXaml -match '(?s)<Style Selector=":is\(TopLevel\)">\s*<Setter Property="ToolTip\.ShowOnDisabled" Value="True" />\s*</Style>')
$off = @(Get-ChildItem -LiteralPath $app -File | Where-Object { $_.Extension -in '.cs', '.axaml' } | Where-Object {
    $t = [IO.File]::ReadAllText($_.FullName)
    $t -match 'ShowOnDisabled="False"' -or $t -match 'SetShowOnDisabled\([^;]*false\)' -or $t -match 'ShowOnDisabledProperty[^;]*false'
} | ForEach-Object { $_.Name })
Yes ('and no file under launcher\app turns it off again' + $(if ($off.Count) { ': ' + ($off -join ', ') } else { '' })) ($off.Count -eq 0)

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $dll = $null
    try { $dll = Build-LauncherProject } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds as it is' ([bool]$dll)
    if ($dll) {
        $work = Join-Path $launcherRepo (Join-Path 'out' (Join-Path 'harness' ('disabled-tips-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
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
                $lines = @(& $LauncherDotnet $exe 'disabled-tips' 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                foreach ($l in $lines) {
                    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
                    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
                    else { Write-Host $l }
                }
                Yes 'the windows were hovered and every check in them ran' ($code -eq 0 -and $lines.Count -gt 0)
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
