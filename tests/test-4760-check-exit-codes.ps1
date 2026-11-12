<#
  test-4760-check-exit-codes.ps1

      pwsh -NoProfile -File .\tests\test-4760-check-exit-codes.ps1

  The exit codes of scripts\mods\Find-MissingMasters.ps1 and Check-Plugins.ps1
  (#4760). Both printed what they found and ended with exit 0, so a script or
  harness that ran them read a pass. Each now exits 1 when it reports a problem
  or cannot find or read what it needs, and 0 only when it found nothing wrong.
  Check-Manifest.ps1's exit codes are held in tests\test-check-manifest-remote.ps1,
  which has the stand-in box it needs.

  Each script runs as a child against a scratch folder: no game, no Vortex, no
  network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Run([string]$script, [string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @a 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Lines([string]$path, [string[]]$lines) { [IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false))) }
# A plugin whose TES4 header declares $masters, the way Find-MissingMasters reads
# them: 'MAST', a UInt16 length, the name and its zero.
function Plugin([string]$path, [string[]]$masters = @()) {
    $b = New-Object Collections.Generic.List[byte]
    $b.AddRange([Text.Encoding]::ASCII.GetBytes('TES4'))
    $b.AddRange([byte[]]::new(20))
    foreach ($m in $masters) {
        $name = [Text.Encoding]::ASCII.GetBytes($m + [char]0)
        $b.AddRange([Text.Encoding]::ASCII.GetBytes('MAST'))
        $b.AddRange([BitConverter]::GetBytes([uint16]$name.Length))
        $b.AddRange($name)
    }
    [IO.File]::WriteAllBytes($path, $b.ToArray())
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4760-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    # ---- Find-MissingMasters.ps1 ------------------------------------------------
    $fmm = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'Find-MissingMasters.ps1'
    $data = Join-Path $T 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    $plugins = Join-Path $T 'plugins.txt'
    Plugin (Join-Path $data 'Skyrim.esm')
    Plugin (Join-Path $data 'A.esp') @('Skyrim.esm')
    Plugin (Join-Path $data 'B.esp') @('Skyrim.esm', 'A.esp')
    Lines $plugins @('*A.esp', '*B.esp')
    function Fmm { return (Run $fmm @('-Data', $data, '-Plugins', $plugins, '-NoPause')) }

    $r = Fmm
    Yes 'Find-MissingMasters: every master present, exit 0' ($r.Code -eq 0 -and $r.Out -match 'no missing masters: 3 plugin\(s\)')

    Plugin (Join-Path $data 'C.esp') @('Skyrim.esm', 'Gone.esm')
    Lines $plugins @('*A.esp', '*B.esp', '*C.esp')
    $r = Fmm
    Yes 'an enabled plugin with a missing master: exit 1, saying it crashes at load' ($r.Code -eq 1 -and $r.Out -match 'Gone\.esm' -and $r.Out -match '1 ENABLED plugin\(s\) have a missing master')

    Lines $plugins @('*A.esp', '*B.esp', 'C.esp')
    $r = Fmm
    Yes 'the same plugin switched off in plugins.txt: listed, and exit 0, since nothing loads it' ($r.Code -eq 0 -and $r.Out -match 'Gone\.esm' -and $r.Out -match 'already disabled')

    Remove-Item -LiteralPath $plugins -Force
    $r = Fmm
    Yes 'no plugins.txt to say what is enabled: exit 1' ($r.Code -eq 1)
    [IO.File]::Delete((Join-Path $data 'C.esp'))
    $r = Fmm
    Yes '  even with every master present, since what is enabled was never read' ($r.Code -eq 1)
    Lines $plugins @('*A.esp', '*B.esp')

    $r = Run $fmm @('-Data', (Join-Path $T 'NoData'), '-Plugins', $plugins, '-NoPause')
    Yes 'no Data folder: exit 1' ($r.Code -eq 1 -and $r.Out -match 'There is no Data folder')
    $empty = Join-Path $T 'EmptyData'
    [void][IO.Directory]::CreateDirectory($empty)
    $r = Run $fmm @('-Data', $empty, '-Plugins', $plugins, '-NoPause')
    Yes 'a Data folder with no plugins: exit 1' ($r.Code -eq 1 -and $r.Out -match 'has no plugins in it')

    $head = [IO.File]::ReadAllText($fmm)
    Yes 'its header says when it exits 0 and when 1' ($head -match '(?s)^.{0,200}<#.*Exit 0 when.*Exit 1\s+when.*#>')

    # ---- Check-Plugins.ps1 ------------------------------------------------------
    $cp = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'Check-Plugins.ps1'
    $live = Join-Path $T 'live.txt'
    $ref = Join-Path $T 'reference.txt'
    # Not "Cp": on Windows that is Copy-Item's alias, and an alias wins over a
    # function of the same name.
    function CheckPlugins { return (Run $cp @('-Live', $live, '-Reference', $ref)) }

    Lines $ref @('*A.esp', '*B.esp', 'C.esp')
    Lines $live @('*A.esp', '*B.esp', 'C.esp')
    $r = CheckPlugins
    Yes 'Check-Plugins: the same plugins enabled in both, exit 0' ($r.Code -eq 0 -and $r.Out -match 'live\s+:\s+2\s' -and $r.Out -match 'reference\s+:\s+2\s')

    Lines $live @('*A.esp', '*B.esp', '*C.esp')
    $r = CheckPlugins
    Yes 'one enabled that the build does not enable: exit 1, named under EXTRA' ($r.Code -eq 1 -and $r.Out -match 'EXTRA, enabled but not part of the build \(1\)' -and $r.Out -match '\s C\.esp')

    Lines $live @('*A.esp')
    $r = CheckPlugins
    Yes 'one the build enables that is not enabled: exit 1, named under MISSING' ($r.Code -eq 1 -and $r.Out -match 'MISSING, part of the build but not enabled \(1\)')

    Remove-Item -LiteralPath $live -Force
    $r = CheckPlugins
    Yes 'no live plugins.txt: exit 1' ($r.Code -eq 1)
    Lines $live @('*A.esp', '*B.esp')
    Remove-Item -LiteralPath $ref -Force
    $r = CheckPlugins
    Yes 'no reference plugins.txt: exit 1' ($r.Code -eq 1)

    $head = [IO.File]::ReadAllText($cp)
    Yes 'its header says when it exits 0 and when 1' ($head -match '(?s)^(#[^\r\n]*\r?\n)*#[^\r\n]*Exit 0 when' -and $head -match '(?s)^(#[^\r\n]*\r?\n)*#[^\r\n]*Exit 1\s+(#\s*)?when')
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
