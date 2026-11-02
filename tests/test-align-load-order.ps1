<#
  test-align-load-order.ps1

      pwsh -NoProfile -File .\tests\test-align-load-order.ps1

  scripts\mods\Align-LoadOrder.ps1, the check that the plugins the game gives
  a normal index to line up with the server's loadOrder, and its -Fix that
  switches the extra ones off in plugins.txt. Run as a child of the same
  PowerShell against made up plugin headers, plugin lists and a stand-in
  server-settings.json in a scratch folder. No Vortex, no VPS, no network, and
  -AlsoFix keeps -Fix away from the machine's real LocalAppData list.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $Repo 'scripts\mods\Align-LoadOrder.ps1'
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-align-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$Data = Join-Path $T 'Data'; $Prof = Join-Path $T 'Profile'
New-Item -ItemType Directory -Force -Path $Data, $Prof | Out-Null

# A TES4 header: flags at offset 8 (0x200 light), then MAST subrecords.
function Plugin([string]$name, [bool]$light = $false, [string[]]$masters = @()) {
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter($ms)
    $w.Write([Text.Encoding]::ASCII.GetBytes('TES4'))
    $w.Write([uint32]0)
    $w.Write([uint32]$(if ($light) { 0x200 } else { 0 }))
    $w.Write([byte[]]::new(12))
    foreach ($m in $masters) {
        $b = [Text.Encoding]::ASCII.GetBytes($m + [char]0)
        $w.Write([Text.Encoding]::ASCII.GetBytes('MAST')); $w.Write([uint16]$b.Length); $w.Write($b)
    }
    $w.Flush()
    [IO.File]::WriteAllBytes((Join-Path $Data $name), $ms.ToArray())
}
function Lines([string]$path, [string[]]$lines) { [IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false))) }
function Settings([string[]]$order) {
    $f = Join-Path $T 'server-settings.json'
    [IO.File]::WriteAllText($f, (@{ loadOrder = $order } | ConvertTo-Json))
    return $f
}
function Align([string]$plugins, [string]$settings, [string]$extra = '') {
    $cmd = "& '$Script' -Data '$Data' -Plugins '$plugins' -Settings '$settings' -AlsoFix @($extra) $(if ($script:fix) { '-Fix' })"
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}
function Masters { foreach ($m in 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm') { Plugin $m } }

try {
    Masters
    Plugin 'A.esp'; Plugin 'B.esp'; Plugin 'C.esp'
    Plugin 'Light.esp' $true; Plugin 'Tiny.esl'
    Plugin 'Rider.esp' $false @('Skyrim.esm', 'Light.esp')
    $base = 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'
    $plugins = Join-Path $Prof 'plugins.txt'
    $script:fix = $false

    # 1. The same lists, light plugins left out, server paths read by file name.
    Lines $plugins @('*A.esp', '*Light.esp', '*Tiny.esl', '*B.esp', 'NotOn.esp', '*C.esp')
    $r = Align $plugins (Settings (@($base) + @('Data/A.esp', 'Data\B.esp', 'C.esp')))
    Yes 'lists that match say so' ($r.Out -match 'match exactly' -and $r.Out -match 'game will index : 8 plugins' -and $r.Out -match 'server lists\s+: 8 plugins')

    # 2. The server lists one the game does not have, in the middle.
    $r = Align $plugins (Settings (@($base) + @('A.esp', 'Gone.esp', 'B.esp', 'C.esp')))
    Yes 'a server entry the game lacks is named as missing' ($r.Out -match 'will not index them' -and $r.Out -match 'Gone\.esp')
    Yes '  and the plugins after it are not called extra (it used to name B.esp and C.esp)' ($r.Out -notmatch 'server does not have them')

    # 3. The game indexes one the server does not have, which masters to a light plugin.
    Lines $plugins @('*A.esp', '*Light.esp', '*Rider.esp', '*B.esp', '*C.esp')
    $settings = Settings (@($base) + @('A.esp', 'B.esp', 'C.esp'))
    $before = [IO.File]::ReadAllText($plugins)
    $r = Align $plugins $settings
    Yes 'an extra plugin is named, with the light master that keeps it off the server' ($r.Out -match 'Rider\.esp\s+masters to a light plugin: Light\.esp')
    Yes '  and only that one' (([regex]::Matches($r.Out, '(?m)^\s+[A-Z]\.esp\s*$')).Count -eq 0)
    Yes '  and without -Fix nothing is written' ([IO.File]::ReadAllText($plugins) -eq $before)

    # 4. -Fix switches it off in plugins.txt only, with no byte order mark.
    $script:fix = $true
    $other = Join-Path $T 'Other-Plugins.txt'
    Lines $other @('*A.esp', '*Rider.esp')
    $r = Align $plugins $settings
    $after = [IO.File]::ReadAllLines($plugins)
    Yes '-Fix switches the extra plugin off' (($after -join '|') -eq '*A.esp|*Light.esp|Rider.esp|*B.esp|*C.esp')
    Yes '  with no byte order mark' ([IO.File]::ReadAllBytes($plugins)[0] -eq [byte][char]'*')
    Yes '  and with -AlsoFix @() leaves every other list alone' (([IO.File]::ReadAllLines($other) -join '|') -eq '*A.esp|*Rider.esp')
    Yes '  and says to rebuild the server list' ($r.Out -match 'Deploy-Gamemode\.ps1')

    # 5. -AlsoFix names another list: that one is switched too.
    Lines $plugins @('*A.esp', '*Light.esp', '*Rider.esp', '*B.esp', '*C.esp')
    $r = Align $plugins $settings "'$other'"
    Yes '-AlsoFix edits the list it names' (([IO.File]::ReadAllLines($other) -join '|') -eq '*A.esp|Rider.esp')

    # 6. A run after -Fix finds the two lists the same.
    $script:fix = $false
    $r = Align $plugins $settings
    Yes 'the next run finds the lists the same' ($r.Out -match 'match exactly')

    # 7. A missing input stops it.
    $r = Align (Join-Path $T 'nope.txt') $settings
    Yes 'a plugin list that is not there stops it, naming the path' ($r.Out -match 'not found: .*nope\.txt')

    # 8. The default -AlsoFix is still the launcher's LocalAppData copy, in
    # the install Where.ps1 finds (#3031).
    $src = [IO.File]::ReadAllText($Script)
    Yes "the default -AlsoFix is the launcher's LocalAppData Plugins.txt" ($src -match "\[string\[\]\]\`$AlsoFix = @\(\(\(& \(Join-Path \`$PSScriptRoot '\.\.\\release\\Where\.ps1'\) Install\) \+ '\\Profile\\LocalAppData\\Plugins\.txt'\)\)")
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }