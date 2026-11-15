<#
  test-4688-one-load-order-rule.ps1

      pwsh -NoProfile -File .\tests\test-4688-one-load-order-rule.ps1

  #4688. One rule builds the server's load order: Deploy-Gamemode.ps1,
  through scripts\deploy\ServerOrder.ps1 (the five masters, Skyrim.ccc's
  plugins in Data, then the list; the order the server already runs kept for
  each kind apart; light plugins listed when the engine loads them).
  Sync-LoadOrder.ps1, Sync-LoadOrder.py, Align-LoadOrder.ps1 and
  Show-EslCascade.ps1 each built or checked that order by a rule of their
  own. None of them read Skyrim.ccc or kept the order the world is keyed to,
  every one of them left out the light plugins the server now loads, and the
  rebuild page still ran Sync-LoadOrder.ps1 before a publish.

  WHAT THIS HOLDS:
    1. The copies are gone, and no tracked file names them, outside
       docs\archive, scripts\oneoff and the two scripts #1179 retired, which
       refuse to run before they reach the name.
    2. Every script that writes a loadOrder into a server-settings file
       (under scripts\ and tools\) either builds it (Deploy-Gamemode.ps1)
       or carries an order that was built, its paths pointed at another
       folder. A script that writes one and is not named below is a new
       copy of the rule.
    3. Deploy-Gamemode.ps1 -OrderOnly, a copy run in a scratch tree laid out
       like the repository, holds the checks the copies had:
         - a plugin the list switches on twice is refused, by name
         - a plugin the list names that is not in Data is said and left out
         - with an engine that loads no light plugin, the light plugins are
           left out and a plugin that masters one goes with them
         - with one that does, the order is the game's: Skyrim.ccc's plugin
           straight after the masters, the light plugins listed
         - a plugin whose master the order does not hold is refused, naming
           both
         - a plugin list under a Vortex profile other than Thornswood is
           refused, and the Thornswood one is read

  -Repo points it at another checkout, which is how it was shown to fail on
  main before the change.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Same([string]$what, $got, $want) {
    $g = (@($got) | ForEach-Object { [string]$_ }) -join '|'
    $w = (@($want) | ForEach-Object { [string]$_ }) -join '|'
    Yes $what ([string]::Equals($g, $w, [StringComparison]::Ordinal))
    if ($g -ne $w) {
        Write-Host "      wanted $w" -ForegroundColor Red
        Write-Host "      got    $g" -ForegroundColor Red
    }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4688-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null

function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

# A plugin file: the TES4 record with the flags given (0x1 master, 0x200
# light) and a MAST subrecord for each master, which is what
# Read-PluginHeader looks for.
function New-Plugin([string]$dir, [string]$name, [uint32]$flags, [string[]]$masters = @()) {
    $body = New-Object Collections.Generic.List[byte]
    foreach ($m in $masters) {
        $z = [Text.Encoding]::ASCII.GetBytes($m + [char]0)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('MAST'))
        $body.AddRange([BitConverter]::GetBytes([uint16]$z.Length))
        $body.AddRange($z)
        $body.AddRange([Text.Encoding]::ASCII.GetBytes('DATA'))
        $body.AddRange([BitConverter]::GetBytes([uint16]8))
        $body.AddRange((New-Object byte[] 8))
    }
    $b = New-Object Collections.Generic.List[byte]
    $b.AddRange([Text.Encoding]::ASCII.GetBytes('TES4'))
    $b.AddRange([BitConverter]::GetBytes([uint32]$body.Count))
    $b.AddRange([BitConverter]::GetBytes($flags))
    $b.AddRange((New-Object byte[] 12))
    $b.AddRange($body)
    $b.AddRange((New-Object byte[] 64))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $b.ToArray())
}

$masters5 = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm')

try {
    # ---- 1. the copies are gone ---------------------------------------------------
    Write-Host 'the copies'
    $copies = @('Sync-LoadOrder.ps1', 'Sync-LoadOrder.py', 'Align-LoadOrder.ps1', 'Show-EslCascade.ps1')
    foreach ($c in $copies) {
        Yes ("scripts\mods\$c, which builds or checks the server's order by its own rule, is gone") (
            -not (Test-Path -LiteralPath (Join-Path $Repo ('scripts\mods\' + $c))))
    }
    $all = @(& git -C $Repo ls-files)
    Yes ('git lists the checkout''s files (' + $all.Count + ')') ($all.Count -gt 500)
    # The names, built so that this file's own text does not match.
    $nameRx = [regex]('(?i)\b(' + ((@('Sync', 'Align') | ForEach-Object { $_ + '-Load' + 'Order' }) + @('Show-Esl' + 'Cascade') -join '|') + ')\b')
    # Retired by #1179: each stops on its first line, before the name, and is
    # kept for the history of how it was installed.
    $retired = @('scripts/mods/Enable-MCM.ps1', 'scripts/mods/Fix-QuickLoot.ps1')
    foreach ($f in $retired) {
        $full = Join-Path $Repo $f
        if (-not (Test-Path -LiteralPath $full)) { continue }
        $text = [IO.File]::ReadAllText($full)
        $stop = $text.IndexOf("throw ('STOP.")
        $named = $nameRx.Match($text)
        Yes ("$f refuses to run before it reaches a copy's name") ($stop -gt 0 -and (-not $named.Success -or $named.Index -gt $stop))
    }
    $skip = '^(docs/archive/|scripts/oneoff/|tests/test-4688-one-load-order-rule\.ps1$)'
    $hits = @()
    foreach ($f in $all) {
        if ($f -match $skip -or $retired -contains $f) { continue }
        if ($f -notmatch '\.(md|ps1|psm1|js|ts|cs|py|json|yml|yaml|txt|cmd|bat|html)$') { continue }
        $full = Join-Path $Repo $f
        if (-not (Test-Path -LiteralPath $full)) { continue }
        $i = 0
        foreach ($line in ([IO.File]::ReadAllText($full) -split "`n")) {
            $i++
            if ($nameRx.IsMatch($line)) { $hits += ('{0}:{1}' -f $f, $i) }
        }
    }
    foreach ($h in $hits) { Write-Host "      still names a copy: $h" -ForegroundColor Red }
    Yes 'no tracked file tells anybody to run a copy, or reads one' ($hits.Count -eq 0)

    # ---- 2. who writes a server's loadOrder ----------------------------------------
    Write-Host ''
    Write-Host 'who writes a loadOrder'
    $writers = [ordered]@{
        'scripts/deploy/Deploy-Gamemode.ps1'       = 'builds it, by ServerOrder.ps1'
        'scripts/deploy/Deploy-DevGamemode.ps1'    = 'carries the order a build or the dev box has to the dev server'
        'scripts/deploy/ServerSettings.ps1'        = 'the same order, written on the box'
        'scripts/deploy/Deploy-Server.ps1'         = 'the built order, its paths pointed at the box'
        'scripts/release/Export-ServerPayload.ps1' = 'the built order, its paths pointed at the box'
        'scripts/vps/Restore-Server.ps1'           = 'a restored order, its paths pointed at its own folder'
        'scripts/vps/vps-dev-instance.ps1'         = 'the live order, its paths pointed at the dev folder'
        'scripts/mods/Fix-QuickLoot.ps1'           = 'retired by #1179, refuses to run'
        'tools/DeployAgent/BotPass.cs'             = 'the order on the box, each plugin pointed at its cached copy'
    }
    $writeRx = [regex]'(?i)(NotePropertyName\s+loadOrder\b|\.loadOrder\s*=(?!=)|\[\s*[''"]loadOrder[''"]\s*\]\s*=(?!=))'
    $found = [ordered]@{}
    foreach ($f in $all) {
        if ($f -notmatch '^(scripts|tools)/' -or $f -match '^scripts/oneoff/' -or $f -match '^tools/[^/]*Tests/') { continue }
        if ($f -notmatch '\.(ps1|psm1|py|js|cs)$') { continue }
        $full = Join-Path $Repo $f
        if (-not (Test-Path -LiteralPath $full)) { continue }
        $i = 0
        foreach ($line in ([IO.File]::ReadAllText($full) -split "`n")) {
            $i++
            if ($writeRx.IsMatch($line)) { if (-not $found.Contains($f)) { $found[$f] = $i } }
        }
    }
    Yes 'the search finds Deploy-Gamemode.ps1 writing it' ($found.Contains('scripts/deploy/Deploy-Gamemode.ps1'))
    foreach ($f in $found.Keys) {
        if ($writers.Contains($f)) { Yes ("  $f writes one: " + $writers[$f]) $true }
        else { Yes ("  $f writes a server loadOrder at line " + $found[$f] + ' and is not the rule or a carrier of its order') $false }
    }

    # ---- 3. Deploy-Gamemode.ps1 -OrderOnly ------------------------------------------
    Write-Host ''
    Write-Host 'Deploy-Gamemode.ps1'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Yes 'node is on this machine, which Deploy-Gamemode.ps1 needs to check gamemode.js' $false
        Done
    }
    # A whole server-build record, as RecordShape.ps1 holds Deploy-Gamemode's
    # to (#2180), with lightPlugins as given.
    function ServerRecord([bool]$light) {
        $h = 'ab' * 32
        $r = [ordered]@{ binary = 'scam_native.node'; sha256 = $h; bytes = 1; source = [ordered]@{ commit = ('cd' * 20) }
                         files = [ordered]@{ 'scam_native.node' = [ordered]@{ sha256 = $h; bytes = 1 } }; lightPlugins = $light }
        return ($r | ConvertTo-Json -Depth 5)
    }
    # A scratch tree laid out like the repository: the deploy script and what
    # it dot-sources, the real LoadOrder.ps1 with a collection that is
    # current, a game folder with Skyrim.ccc and plugins, and a build folder.
    function New-Tree([string]$name, [bool]$light, [string[]]$list) {
        $t = Join-Path $T $name
        foreach ($rel in 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\deploy\MaxOnline.ps1', 'scripts\deploy\ServerOrder.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                         'scripts\release\BuildStamp.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1',
                         'scripts\mods\LoadOrder.ps1', 'records\most-online.json') {
            $from = Join-Path $Repo $rel
            if (-not (Test-Path -LiteralPath $from)) { continue }
            $to = Join-Path $t $rel
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Copy-Item -LiteralPath $from -Destination $to
        }
        Put (Join-Path $t 'records\server-build.json') (ServerRecord $light)
        [IO.File]::AppendAllText((Join-Path $t 'scripts\mods\LoadOrder.ps1'),
            "`nfunction Get-CollectionState([string]`$Url) { [pscustomobject]@{ Slug = 'ts4688'; Have = 4; Newest = 4; Behind = `$false; Known = `$true } }`n", $utf8)
        Put (Join-Path $t 'game\gamemode.js') "var thornswood4688 = 1;`n"
        Put (Join-Path $t 'game\gamemode-tables\WAY_OUT.json') "{}`n"
        Put (Join-Path $t 'dist\server-settings.json') '{"port":7777,"name":"Thornswood"}'
        $data = Join-Path $t 'Game\Data'
        foreach ($m in $masters5) { New-Plugin $data $m 0x1 }
        New-Plugin $data '_ResourcePack.esl' 0x201
        New-Plugin $data 'A.esp' 0x0 @('Skyrim.esm')
        New-Plugin $data 'B.esp' 0x0
        New-Plugin $data 'Light.esp' 0x200
        New-Plugin $data 'Needs Light.esp' 0x0 @('Skyrim.esm', 'Light.esp')
        New-Plugin $data 'Off.esp' 0x0
        New-Plugin $data 'Needs Off.esp' 0x0 @('Skyrim.esm', 'Off.esp')
        Put (Join-Path $t 'Game\Skyrim.ccc') ((($masters5 + @('_ResourcePack.esl')) -join "`r`n") + "`r`n")
        Put (Join-Path $t 'Game\config.json') '{"CollectionUrl":"https://next.nexusmods.com/skyrimspecialedition/collections/ts4688"}'
        Put (Join-Path $t 'plugins.txt') ((@('# a list') + @($list | ForEach-Object { '*' + $_ })) -join "`r`n")
        New-Item -ItemType Directory -Force -Path (Join-Path $t 'appdata'), (Join-Path $t 'localappdata') | Out-Null
        return $t
    }
    function Invoke-Order([string]$t, [string]$plugins = '') {
        if (-not $plugins) { $plugins = Join-Path $t 'plugins.txt' }
        $saved = @{ APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA }
        $env:APPDATA = Join-Path $t 'appdata'
        $env:LOCALAPPDATA = Join-Path $t 'localappdata'
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = @(& $shell -NoProfile -File (Join-Path $t 'scripts\deploy\Deploy-Gamemode.ps1') `
                       -Gamemode (Join-Path $t 'game\gamemode.js') -Dist (Join-Path $t 'dist') `
                       -Data (Join-Path $t 'Game\Data') -Plugins $plugins -OrderOnly (Join-Path $t 'order\server-settings.json') 2>&1 |
                     ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $eap
            $env:APPDATA = $saved.APPDATA
            $env:LOCALAPPDATA = $saved.LOCALAPPDATA
        }
        $file = Join-Path $t 'order\server-settings.json'
        $leaves = $null
        if (Test-Path -LiteralPath $file) {
            $leaves = [string[]]@(([IO.File]::ReadAllText($file) | ConvertFrom-Json).loadOrder | ForEach-Object { @(([string]$_) -split '[\\/]')[-1] })
        }
        return [pscustomobject]@{ Code = $code; Text = ($out -join "`n"); Order = $leaves }
    }
    $list = @('A.esp', 'Light.esp', 'B.esp', 'Needs Light.esp', 'Gone.esp')

    # An engine that loads light plugins: the order is the game's.
    $t = New-Tree 'light' $true $list
    $r = Invoke-Order $t
    Yes 'an engine that loads light plugins: the order is written' ($r.Code -eq 0 -and $null -ne $r.Order)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    Same '  the masters, Skyrim.ccc''s _ResourcePack.esl, then the list, the light plugins in it' $r.Order ($masters5 + @('_ResourcePack.esl', 'A.esp', 'Light.esp', 'B.esp', 'Needs Light.esp'))
    Yes '  Gone.esp, which Data does not have, is said and left out' ($r.Text -match '1 plugin\(s\) the list names are not in' -and $r.Text -match '(?m)^\s+Gone\.esp\s*$')

    # An engine that loads none: the light plugins are left out, and the
    # plugin that masters one goes with them.
    $t = New-Tree 'no-light' $false $list
    $r = Invoke-Order $t
    Yes 'an engine that loads no light plugin: the order is written' ($r.Code -eq 0 -and $null -ne $r.Order)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    Same '  the light plugins are left out, and Needs Light.esp, which masters one, with them' $r.Order ($masters5 + @('A.esp', 'B.esp'))

    # A plugin switched on twice, in any case.
    $t = New-Tree 'twice' $true @('A.esp', 'B.esp', 'A.esp', 'b.esp')
    $r = Invoke-Order $t
    Yes 'a list that switches a plugin on twice is refused' ($r.Code -ne 0)
    Yes '  naming each plugin once' ($r.Text -match 'STOP\. plugins\.txt switches on A\.esp, B\.esp more than once')
    Yes '  and no order is written' ($null -eq $r.Order)

    # A plugin whose master is in Data and is not switched on.
    $t = New-Tree 'master-off' $true @('A.esp', 'Needs Off.esp')
    $r = Invoke-Order $t
    Yes 'a plugin whose master the order does not hold is refused' ($r.Code -ne 0)
    Yes '  naming the plugin and the master' ($r.Text -match 'Needs Off\.esp needs Off\.esp, which this order does not hold')
    Yes '  and no order is written' ($null -eq $r.Order)

    # A plugin list under a Vortex profile.
    $t = New-Tree 'profile' $true @('A.esp')
    $profiles = Join-Path $t 'appdata\Vortex\skyrimse\profiles'
    Put (Join-Path $profiles 'twid\plugins.txt') "*A.esp`r`n"
    Put (Join-Path $profiles 'other\plugins.txt') "*A.esp`r`n"
    Put (Join-Path $t 'appdata\Vortex\state.v2\000001.log') '{"profileId":"twid","profileName":"Thornswood"}'
    $r = Invoke-Order $t (Join-Path $profiles 'other\plugins.txt')
    Yes 'a plugin list under another Vortex profile is refused' ($r.Code -ne 0 -and $r.Text -match 'reads only the Vortex profile named Thornswood')
    Yes '  and no order is written' ($null -eq $r.Order)
    $r = Invoke-Order $t (Join-Path $profiles 'twid\plugins.txt')
    Yes 'the Thornswood profile''s list is read' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Text }
    Same '  into the order' $r.Order ($masters5 + @('_ResourcePack.esl', 'A.esp'))
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
