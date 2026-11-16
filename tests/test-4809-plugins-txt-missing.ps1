<#
  test-4809-plugins-txt-missing.ps1

      pwsh -NoProfile -File .\tests\test-4809-plugins-txt-missing.ps1

  #4809. Find-MissingMasters.ps1 read a plugins.txt it could not find as an
  empty list, so every plugin counted as switched off, and it printed its
  verdict anyway: "all affected plugins are already disabled. nothing will
  crash." when some were switched on, or the green "every dependency
  present". #4760 made that run exit 1, with nothing saying why. A
  plugins.txt it could not read threw a bare error.

  A missing or unreadable plugins.txt now stops the script before any
  verdict, with a sentence naming the path. This runs the script as a child
  against a scratch Data folder: no game, no Vortex.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Run([string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script:fmm @a 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Show($r) { ($r.Out -split "\r?\n") | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "      $_" } }
# A plugin whose TES4 header declares $masters: 'MAST', a UInt16 length, the
# name and its zero, the way Find-MissingMasters reads them.
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

$script:fmm = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'Find-MissingMasters.ps1'
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4809-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $data = Join-Path $T 'Data'
    [void][IO.Directory]::CreateDirectory($data)
    Plugin (Join-Path $data 'Skyrim.esm')
    Plugin (Join-Path $data 'A.esp') @('Skyrim.esm')
    # Switched on in the person's real list, and its master is gone: a crash at load.
    Plugin (Join-Path $data 'C.esp') @('Skyrim.esm', 'Gone.esm')

    # 1. No plugins.txt at the path it was given.
    $none = Join-Path $T 'Profile\plugins.txt'
    $r = Run @('-Data', $data, '-Plugins', $none, '-NoPause')
    Show $r
    Yes '1. no plugins.txt: exit 1' ($r.Code -eq 1)
    Yes '1. it stops with a sentence naming the path' ($r.Out -match 'STOP\.' -and $r.Out.Contains($none))
    Yes '1. it never says nothing will crash' (-not ($r.Out -match 'nothing will crash'))
    Yes '1. nor that every dependency is present' (-not ($r.Out -match 'every dependency present'))
    Yes '1. nor prints a table of masters as if it knew what is switched on' (-not ($r.Out -match 'Gone\.esm'))

    # 2. A plugins.txt with every master present but no list: still no verdict.
    [IO.File]::Delete((Join-Path $data 'C.esp'))
    $r = Run @('-Data', $data, '-Plugins', $none, '-NoPause')
    Yes '2. every master present and no plugins.txt: exit 1, the same STOP, no green verdict' ($r.Code -eq 1 -and $r.Out -match 'STOP\.' -and $r.Out.Contains($none) -and -not ($r.Out -match 'no missing masters'))
    Plugin (Join-Path $data 'C.esp') @('Skyrim.esm', 'Gone.esm')

    # 3. A plugins.txt that is there but cannot be read (a folder by that name).
    $odd = Join-Path $T 'Odd\plugins.txt'
    [void][IO.Directory]::CreateDirectory($odd)
    $r = Run @('-Data', $data, '-Plugins', $odd, '-NoPause')
    Show $r
    Yes '3. an unreadable plugins.txt: exit 1' ($r.Code -eq 1)
    Yes '3. it stops with a sentence naming the path' ($r.Out -match 'STOP\.' -and $r.Out.Contains($odd))
    Yes '3. and gives no verdict' (-not ($r.Out -match 'nothing will crash|every dependency present|Gone\.esm'))

    # 4. A real list still gives the real verdict.
    $real = Join-Path $T 'plugins.txt'
    [IO.File]::WriteAllLines($real, @('*A.esp', '*C.esp'))
    $r = Run @('-Data', $data, '-Plugins', $real, '-NoPause')
    Yes '4. with the list read, the enabled plugin with a missing master is named and exits 1' ($r.Code -eq 1 -and $r.Out -match 'Gone\.esm' -and $r.Out -match '1 ENABLED plugin\(s\) have a missing master' -and -not ($r.Out -match 'STOP\.'))
    [IO.File]::WriteAllLines($real, @('*A.esp', 'C.esp'))
    $r = Run @('-Data', $data, '-Plugins', $real, '-NoPause')
    Yes '4. and switched off in the list, it says nothing will crash and exits 0' ($r.Code -eq 0 -and $r.Out -match 'nothing will crash')

    $head = [IO.File]::ReadAllText($script:fmm)
    Yes 'its header says a missing or unreadable plugins.txt stops it (#4809)' ($head -match '(?s)^.{0,200}<#.*#4809.*#>')
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
