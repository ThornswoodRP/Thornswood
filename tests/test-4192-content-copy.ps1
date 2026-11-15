<#
  test-4192-content-copy.ps1

      pwsh -NoProfile -File .\tests\test-4192-content-copy.ps1

  The content plugin's install, scripts\deploy\Install-ThornswoodContent.ps1,
  stops when copying the plugin fails, and Install-Thornswood.ps1 stops on it
  (#4192).

  WHY. The copy's error did not stop that script: it went on to rewrite the
  plugin lists, said the plugin was installed and exited 0, and
  Install-Thornswood.ps1, which asks only for the exit code and for a
  Thornswood-Content.esp in Data, counted the step as passed with the old
  plugin still there. The usual cause is a program holding the file in Data
  open. Its closing lines also gave counts typed in by hand that the plugin
  had long outgrown.

  What it runs, each in a child shell against folders of its own:
    1. a good install: the plugin is copied, each list gets it in front of
       the plugin -Before names (or at the end where that plugin is missing,
       and says so), and what it says it installed is the description in the
       plugin's own header;
    2. a Data folder that is not there: it stops, exit 1, and no list changes;
    3. on Windows, the plugin in Data held open by another program, the case
       the issue names: it stops, exit 1, says to close the program, and
       neither Data nor any list changes;
    4. on Windows, the same through a copy of Install-Thornswood.ps1 run with
       -Only content: the full install stops on the content step.
  Holding a file open stops a copy only on Windows, so 3 and 4 say SKIP
  anywhere else.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$Utf8 = New-Object Text.UTF8Encoding($false)
$Latin1 = [Text.Encoding]::GetEncoding(28591)
$ps = Get-BoxPowerShell

function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $Utf8)
}

# A plugin header and nothing else: TES4 with HEDR, a description (SNAM) and
# one master, as Add-ContentRecords.py writes it.
function New-Plugin([string]$description) {
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    function Sub([string]$tag, [byte[]]$body) {
        $w.Write([Text.Encoding]::ASCII.GetBytes($tag)); $w.Write([uint16]$body.Length); $w.Write($body)
    }
    $hedr = New-Object byte[] 12
    [BitConverter]::GetBytes([single]1.71).CopyTo($hedr, 0)
    Sub 'HEDR' $hedr
    Sub 'SNAM' ($Latin1.GetBytes($description + [char]0))
    Sub 'MAST' ($Latin1.GetBytes('Skyrim.esm' + [char]0))
    Sub 'DATA' (New-Object byte[] 8)
    $w.Flush()
    $body = $ms.ToArray()
    $out = New-Object IO.MemoryStream
    $h = New-Object IO.BinaryWriter($out)
    $h.Write([Text.Encoding]::ASCII.GetBytes('TES4')); $h.Write([uint32]$body.Length)
    $h.Write([uint32]0); $h.Write([uint32]0); $h.Write([uint32]0); $h.Write([uint16]44); $h.Write([uint16]0)
    $h.Write($body); $h.Flush()
    return $out.ToArray()
}

function Run([string]$file, [string[]]$argList) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $ps -NoProfile -ExecutionPolicy Bypass -File $file @argList 2>&1 | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Code = $code; Out = $out }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4192-' + [Guid]::NewGuid().ToString('N'))
$NewText = 'Thornswood content for the harness: 3 stations and 2 changes to vanilla objects.'
$OldText = 'An older build of the plugin.'
$newEsp = New-Plugin $NewText
$oldEsp = New-Plugin $OldText

# An install: Data with an older plugin in it, and the four plugin lists.
# Default has the anchor; LocalAppData does not.
function New-Install([string]$root) {
    $data = Join-Path $root 'Game\Data'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $data 'Thornswood-Content.esp'), $oldEsp)
    Put (Join-Path $root 'Profile\Default\plugins.txt') "*First.esp`r`n*Anchor.esp`r`n*Last.esp`r`n"
    Put (Join-Path $root 'Profile\Default\loadorder.txt') "First.esp`r`nAnchor.esp`r`nLast.esp`r`n"
    Put (Join-Path $root 'Profile\LocalAppData\Plugins.txt') "*First.esp`r`n*Last.esp`r`n"
    Put (Join-Path $root 'Profile\LocalAppData\loadorder.txt') "First.esp`r`nLast.esp`r`n"
    return $data
}
function Get-Lists([string]$root) {
    return (@('Default\plugins.txt', 'Default\loadorder.txt', 'LocalAppData\Plugins.txt', 'LocalAppData\loadorder.txt') |
        ForEach-Object { [IO.File]::ReadAllText((Join-Path $root ('Profile\' + $_))) }) -join '|'
}
function Same([byte[]]$a, [byte[]]$b) { return ([Convert]::ToBase64String($a) -eq [Convert]::ToBase64String($b)) }

$held = $null
try {
    # The two scripts as they are in this checkout, beside stand-ins for what
    # Install-Thornswood.ps1 loads: the VPS address, the game check, where the
    # install is and the scratch folder, all pointed into this harness's own
    # folder. The plugin it installs is in game\content, where it looks.
    $fake = Join-Path $work 'repo'
    $content = Join-Path $fake 'scripts\deploy\Install-ThornswoodContent.ps1'
    $install = Join-Path $fake 'scripts\dev\Install-Thornswood.ps1'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $content), (Split-Path -Parent $install) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\deploy\Install-ThornswoodContent.ps1') -Destination $content
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\dev\Install-Thornswood.ps1') -Destination $install
    Put (Join-Path $fake 'scripts\vps\Vps.ps1') "function Get-ThornswoodVpsAddress { '192.0.2.1' }`n"
    Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Test-GameRunning { param([string]`$Root) return `$false }`n"
    Put (Join-Path $fake 'scripts\release\Where.ps1') "param([string]`$What)`nif (`$What -eq 'Install') { `$env:TS_4192_ROOT } else { Join-Path `$env:TS_4192_ROOT ('none-' + `$What) }`n"
    Put (Join-Path $fake 'scripts\release\Get-ScratchDir.ps1') "param([string]`$Name)`nJoin-Path `$env:TS_4192_ROOT ('scratch-' + `$Name)`n"
    $esp = Join-Path $fake 'game\content\Thornswood-Content.esp'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $esp) | Out-Null
    [IO.File]::WriteAllBytes($esp, $newEsp)

    # ---- 1. a good install ---------------------------------------------------
    $root = Join-Path $work 'good'
    $data = New-Install $root
    $r = Run $content @('-Data', $data, '-Profile', (Join-Path $root 'Profile'), '-Before', 'Anchor.esp')
    Yes "1. a good install exits 0 (exit $($r.Code))" ($r.Code -eq 0)
    Yes '1.   and Data holds the new plugin' (Same ([IO.File]::ReadAllBytes((Join-Path $data 'Thornswood-Content.esp'))) $newEsp)
    $def = [IO.File]::ReadAllText((Join-Path $root 'Profile\Default\plugins.txt'))
    Yes '1.   and a list with the anchor has it just in front of it' ($def -match '\*First\.esp\r?\n\*Thornswood-Content\.esp\r?\n\*Anchor\.esp')
    $lad = [IO.File]::ReadAllText((Join-Path $root 'Profile\LocalAppData\Plugins.txt'))
    Yes '1.   and a list without it has it at the end' ($lad -match '\*Last\.esp\r?\n\*Thornswood-Content\.esp\r?\n?$')
    Yes '1.   it says which plugin each list now has after it' ($r.Out -match 'plugins\.txt\s+line 2, before Anchor\.esp')
    Yes '1.   and says so where the anchor is missing' ($r.Out -match 'Plugins\.txt\s+line 3, at the end, because Anchor\.esp is not in it')
    Yes '1.   it says it installed the plugin' ($r.Out -match 'done\. Thornswood-Content\.esp is installed')
    Yes '1.   and what it holds is the description in the plugin''s own header' ($r.Out.Contains($NewText))
    Yes '1.   and no count typed into the script' ($r.Out -notmatch '116 crafting|119 fixes')

    # ---- 2. no Data folder ---------------------------------------------------
    $root = Join-Path $work 'nodata'
    $data = New-Install $root
    $listsBefore = Get-Lists $root
    $gone = Join-Path $root 'Game\NotData'
    $r = Run $content @('-Data', $gone, '-Profile', (Join-Path $root 'Profile'), '-Before', 'Anchor.esp')
    Yes "2. a Data folder that is not there stops it, exit 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '2.   it says STOP and where it looked' ($r.Out -match 'STOP\. Thornswood-Content\.esp was not installed' -and $r.Out.Contains($gone))
    Yes '2.   no plugin list changed' ((Get-Lists $root) -eq $listsBefore)
    Yes '2.   and it does not say it installed anything' ($r.Out -notmatch 'done\.')

    # ---- 3 and 4. the plugin in Data held open --------------------------------
    if (-not $OnWindows) {
        Write-Host 'SKIP  3 and 4: a file held open stops a copy over it only on Windows'
    }
    else {
        $root = Join-Path $work 'held'
        $data = New-Install $root
        $listsBefore = Get-Lists $root
        $inData = Join-Path $data 'Thornswood-Content.esp'
        $held = [IO.File]::Open($inData, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        $r = Run $content @('-Data', $data, '-Profile', (Join-Path $root 'Profile'), '-Before', 'Anchor.esp')
        Yes "3. the plugin held open stops it, exit 1 (exit $($r.Code))" ($r.Code -eq 1)
        Yes '3.   it says STOP, names the file and says to close what holds it' (
            $r.Out -match 'STOP\. Thornswood-Content\.esp was not installed' -and $r.Out.Contains($inData) -and $r.Out -match 'close it and run this again')
        Yes '3.   no plugin list changed' ((Get-Lists $root) -eq $listsBefore)
        Yes '3.   and it does not say it installed anything' ($r.Out -notmatch 'done\.')

        $env:TS_4192_ROOT = $root
        $r = Run $install @('-Root', $root, '-Only', 'content', '-NoShip', '-NoPause', '-ServerIp', '192.0.2.1')
        Yes "4. Install-Thornswood.ps1 -Only content stops on it, exit 1 (exit $($r.Code))" ($r.Code -eq 1)
        Yes '4.   and says the content step did not finish' ($r.Out -match 'STOP\. ThornsWood content plugin did not finish')
        Yes '4.   and never counts it as done' ($r.Out -notmatch '\[ok\]\s+Thornswood-Content\.esp')
        Yes '4.   no plugin list changed' ((Get-Lists $root) -eq $listsBefore)
        $held.Dispose(); $held = $null
        Yes '3-4. and Data still holds the older plugin, untouched' (Same ([IO.File]::ReadAllBytes($inData)) $oldEsp)
    }
}
finally {
    if ($held) { $held.Dispose() }
    Remove-Item Env:\TS_4192_ROOT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
