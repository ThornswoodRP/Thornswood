<#
  test-2320-short-load-order.ps1

      pwsh -NoProfile -File .\tests\test-2320-short-load-order.ps1

  #2320. On 5 Oct at 9:56 PM Publish-Server.ps1 -Channel dev sent a payload
  built from a fresh engine build whose server-settings.json still held the
  engine's own load order, the five base masters. Install-ThornswoodServer.ps1
  takes loadOrder from the release and checked only that every plugin it named
  was there, so the dev server, which ran 48 plugins, started on five: nine
  Riekling characters set aside with "bad raceId", every Populated Cities NPC
  change "not found", and the NPC runtime refusing to start.

  Now an install or deploy that takes loadOrder over a running server's
  refuses an order that leaves out a plugin the running one loads, unless the
  run names each with -DropPlugins (ServerSettings.ps1,
  Test-ThornswoodLoadOrderDrop). This proves:

  1. The rule itself: five masters over a 102-plugin order drops 97 and is a
     refusal naming them and -DropPlugins; a plugin added, or the same ones in
     another order, is not; a dropped plugin named in any case and with any
     folder in front goes, and only the unnamed ones are refused; a running
     server with no order has nothing to keep.
  2. The names cross an ssh command line and the carry script whole: base64
     there and back, and the carry's line, with spaces and a quote in a name.
  3. The real installer, run by PowerShell 7 the way the box runs it
     (#5356), against a scratch root running 102 plugins: a payload of the five
     masters is INSTALL REFUSED, naming what it leaves out, with the root's
     settings byte for byte as they were and no stage left; with -DropPlugins
     naming them it gets past this check; a payload that adds one gets past it
     too; -PutBack with -DropPlugins is refused.
  4. Deploy-Server's carry, run here on a scratch stage: CARRY REFUSED for the
     five masters over 102, the stage cleared, and CARRIED with the 97 named.
  5. Every route that writes an order over a running server's holds it:
     Publish-Server passes -DropPlugins to the installer, Deploy-Server puts it
     in front of the carry, and Deploy-DevGamemode -LoadOrder -Dist checks the
     build's order against the dev server's before anything is sent.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$env:THORNSWOOD_HARNESS = '1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

. (Join-Path $repo 'scripts\deploy\ServerSettings.ps1')
. (Join-Path $PSScriptRoot 'Windows.ps1')

# The dev server's order of 5 Oct after the 10:01 PM start had the shape of:
# the five masters, then 97 more, full and light, at the box's plugin folder.
$masters = 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'
$others = @(1..95 | ForEach-Object { 'Mod {0:D3}.esp' -f $_ }) + @('Playable Rieklings.esp', 'Populated Cities Towns Villages Legendary.esp')
$box = 'C:/Thornswood-Server-Dev/plugins/'
$running102 = @($masters + $others | ForEach-Object { $box + $_ })
function Settings([string[]]$order) { return [pscustomobject]@{ port = 7787; thornswoodRequirePass = $true; loadOrder = $order } }

# ================================================================= 1. the rule
Write-Host 'the rule'
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings @($masters | ForEach-Object { 'C:/Thornswood-Server-Dev/plugins/' + $_ }))
Yes 'five masters over a 102-plugin order drops the other 97' (@($r.Dropped).Count -eq 97 -and @($r.Unasked).Count -eq 97)
Yes '  and is a refusal that says how many of how many, names them and says -DropPlugins' (
    $r.Problem -match 'leaves out 97 of the 102' -and $r.Problem -match 'Playable Rieklings\.esp|Mod 001\.esp' -and $r.Problem -match '-DropPlugins' -and $r.Problem -match '#2320')
Yes '  naming twelve and counting the rest, so the line stays readable' ($r.Problem -match 'and 85 more')
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings @($running102 + ($box + 'New One.esp')))
Yes 'a plugin added on the end is not this check''s' (-not $r.Problem -and @($r.Dropped).Count -eq 0)
$shuffled = @($running102[0..4]) + @($running102[5..101] | Sort-Object -Descending)
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings $shuffled)
Yes 'nor the same plugins in another order' (-not $r.Problem)
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings @($running102 | Where-Object { $_ -notmatch 'Rieklings|Mod 007' }))
Yes 'two dropped with none named is a refusal naming both' ($r.Problem -match 'leaves out 2 of the 102' -and $r.Problem -match 'Playable Rieklings\.esp' -and $r.Problem -match 'Mod 007\.esp')
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings @($running102 | Where-Object { $_ -notmatch 'Rieklings|Mod 007' })) @('c:\elsewhere\PLAYABLE RIEKLINGS.ESP')
Yes 'one named, in another case and with a folder in front, and the other not: only the other is refused' (
    $r.Problem -match 'leaves out 1 of the 102' -and $r.Problem -match 'Mod 007\.esp' -and $r.Problem -notmatch 'Rieklings' -and @($r.Unasked).Count -eq 1)
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings @($running102 | Where-Object { $_ -notmatch 'Rieklings|Mod 007' })) @('Playable Rieklings.esp', 'Mod 007.esp')
Yes 'both named: no refusal' (-not $r.Problem -and @($r.Dropped).Count -eq 2)
Yes '  and what goes is said, as named' (($r.Said -join ' ') -match 'drops 2 plugin\(s\) this run named with -DropPlugins: Mod 007\.esp, Playable Rieklings\.esp|drops 2 plugin\(s\) this run named with -DropPlugins: Playable Rieklings\.esp, Mod 007\.esp')
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) (Settings $running102) @('Mod 001.esp')
Yes 'a name -DropPlugins gives that the order keeps is said, and nothing goes for it' (-not $r.Problem -and ($r.Said -join ' ') -match 'named Mod 001\.esp, which the load order keeps')
$r = Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ port = 7787 }) (Settings @($masters))
Yes 'a running server with no order has nothing to keep' (-not $r.Problem)
$r = Test-ThornswoodLoadOrderDrop (Settings $running102) ([pscustomobject]@{ port = 7787 })
Yes 'and a release with no order keeps the running one' (-not $r.Problem)

# ================================================================ 2. the names
Write-Host ''
Write-Host 'the names, across the command line and into the carry'
$names = @('Populated Cities Towns Villages Legendary.esp', 'Playable Rieklings.esp', "Bob's Patch.esp")
$arg = ConvertTo-ThornswoodNamesArg $names
Yes 'the installer''s argument has no space or quote in it' ($arg -match '^[A-Za-z0-9+/=]+$')
Yes '  and reads back to the same names' ((@(ConvertFrom-ThornswoodNamesArg $arg) -join '|') -eq ($names -join '|'))
Yes '  and none is none' ((ConvertTo-ThornswoodNamesArg @()) -eq '' -and @(ConvertFrom-ThornswoodNamesArg '').Count -eq 0)
$line = Get-ThornswoodDropLine $names
$DropPlugins = $null
. ([scriptblock]::Create($line))
Yes 'the carry''s line sets $DropPlugins to the same names' ((@($DropPlugins) -join '|') -eq ($names -join '|'))
. ([scriptblock]::Create((Get-ThornswoodDropLine @())))
Yes '  and to none when none were given' (@($DropPlugins).Count -eq 0)

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-2320-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    # ======================================================== 3. the installer
    Write-Host ''
    Write-Host 'Install-ThornswoodServer.ps1, by PowerShell 7'
    # The installer and the files it dot-sources from beside it, the way the
    # box holds them. Not named tools: that folder is retired, and
    # test-tools-retired.ps1 refuses any code that builds a path into it.
    $installer = Join-Path $T 'installer'
    foreach ($f in 'Install-ThornswoodServer.ps1', 'ServerSettings.ps1', 'ServerBuild.ps1', 'ServerReadyWait.ps1') {
        New-Item -ItemType Directory -Force -Path $installer | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo "scripts\deploy\$f") -Destination (Join-Path $installer $f)
    }
    # The record contracts the installer loads from beside itself (#2180).
    foreach ($f in 'Read-JsonFile.ps1', 'RecordShape.ps1') { Copy-Item -LiteralPath (Join-Path $repo "scripts\release\$f") -Destination (Join-Path $installer $f) }
    # The log writer the server's task runs (#2349), which the installer refuses without.
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\vps\Server-Log.js') -Destination (Join-Path $installer 'Server-Log.js')
    $boxPs = Get-BoxPowerShell
    function New-Payload([string]$name, [string[]]$order) {
        $d = Join-Path $T ('payload-' + $name)
        Put (Join-Path $d 'server-settings.json') (ConvertTo-Json -InputObject (Settings $order) -Depth 5)
        $z = Join-Path $T ($name + '.zip')
        Compress-Archive -Path (Join-Path $d '*') -DestinationPath $z -Force
        return $z
    }
    function Install([string]$zip, [string]$root, [string[]]$more = @()) {
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $installer 'Install-ThornswoodServer.ps1'),
               '-Zip', $zip, '-Root', $root, '-NoTask', '-AllowGamingPc') + $more
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $boxPs @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
        return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($o -join "`n") }
    }
    $root = Join-Path $T 'Thornswood-Server-Dev'
    Put (Join-Path $root 'server-settings.json') (ConvertTo-Json -InputObject (Settings $running102) -Depth 5)
    Put (Join-Path $root 'world\w.txt') 'every character'
    $before = [IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))
    function Same { return ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))) -eq [Convert]::ToBase64String($before)) }
    function NoStage { return (@(Get-ChildItem -LiteralPath $T -Directory | Where-Object { $_.Name -like 'Thornswood-Server-Dev.stage-*' }).Count -eq 0) }

    $five = New-Payload 'five' @($masters | ForEach-Object { $root.Replace('\', '/') + '/plugins/' + $_ })
    $r = Install $five $root
    Yes 'a payload of the five masters over a server running 102 is INSTALL REFUSED' ($r.Code -eq 1 -and $r.Text -match 'INSTALL REFUSED')
    Yes '  saying what it leaves out and how to go past it' ($r.Text -match 'REFUSED: the load order this run would install has 5 plugins and leaves out 97 of the 102' -and $r.Text -match '-DropPlugins')
    Yes '  before it looks for a single plugin' ($r.Text -notmatch 'not in the payload or on disk')
    Yes '  with the running server''s settings byte for byte as they were' (Same)
    Yes '  the world where it was, and no stage left behind' ((Test-Path -LiteralPath (Join-Path $root 'world\w.txt')) -and (NoStage))

    $r = Install $five $root @('-DropPlugins', (ConvertTo-ThornswoodNamesArg $others))
    Yes 'with -DropPlugins naming the 97, the order gets past this check' ($r.Text -notmatch 'leaves out' -and $r.Text -match 'drops 97 plugin\(s\) this run named with -DropPlugins')
    Yes '  and on to the next ones (here, plugins this scratch box does not hold), with the settings as they were' ($r.Text -match 'not in the payload or on disk' -and (Same) -and (NoStage))

    $r = Install (New-Payload 'more' (@($running102 | ForEach-Object { $_.Replace('C:/Thornswood-Server-Dev', $root.Replace('\', '/')) }) + @($root.Replace('\', '/') + '/plugins/New One.esp'))) $root
    Yes 'a payload that keeps all 102 and adds one gets past this check' ($r.Text -notmatch 'leaves out' -and $r.Text -match 'not in the payload or on disk')

    $r = Install $five $root @('-PutBack', '-DropPlugins', (ConvertTo-ThornswoodNamesArg @('Mod 001.esp')))
    Yes '-PutBack with -DropPlugins is refused, nothing changed' ($r.Code -eq 1 -and $r.Text -match 'does not take -DropPlugins' -and (Same))

    # ====================================================== 4. Deploy-Server's carry
    Write-Host ''
    Write-Host 'Deploy-Server.ps1''s carry, on a scratch stage'
    function Carry([string[]]$order, [string[]]$named) {
        $croot = Join-Path $T ('carry-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        Put (Join-Path $croot 'server-settings.json') (ConvertTo-Json -InputObject (Settings $running102) -Depth 5)
        Put (Join-Path $croot 'stage\server-settings.json') (ConvertTo-Json -InputObject (Settings $order) -Depth 5)
        $text = '$Root = ''' + $croot + '''' + "`r`n" + '$Stage = ''stage''' + "`r`n" + '$ReleaseKeys = @(''loadOrder'')' + "`r`n" +
                (Get-ThornswoodAskedLine ([ordered]@{})) + (Get-ThornswoodDropLine $named) + $settingsCarryBlock
        $o = @(& ([scriptblock]::Create($text)) | ForEach-Object { "$_" })
        return [pscustomobject]@{ Text = ($o -join "`n"); Stage = (Test-Path -LiteralPath (Join-Path $croot 'stage')) }
    }
    $c = Carry @($masters | ForEach-Object { $box + $_ }) @()
    Yes 'the five masters over 102: CARRY REFUSED, naming what goes' ($c.Text -match 'CARRY REFUSED' -and $c.Text -match 'leaves out 97 of the 102')
    Yes '  and the stage cleared' (-not $c.Stage)
    $c = Carry @($masters | ForEach-Object { $box + $_ }) $others
    Yes 'with the 97 named: CARRIED' ($c.Text -match 'CARRIED [0-9a-f]{64}' -and $c.Text -notmatch 'CARRY REFUSED')
    $c = Carry @($running102 + ($box + 'New One.esp')) @()
    Yes 'and an order that keeps all 102: CARRIED' ($c.Text -match 'CARRIED [0-9a-f]{64}')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

# ========================================================== 5. every route holds it
Write-Host ''
Write-Host 'every route that writes an order over a running server''s'
$pub = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Server.ps1'))
Yes 'Publish-Server takes -DropPlugins and passes it to the installer as the names argument' (
    $pub -match '\[string\[\]\]\$DropPlugins' -and $pub -match [regex]::Escape("' -DropPlugins ' + (ConvertTo-ThornswoodNamesArg `$DropPlugins)"))
Yes '  and refuses it with -PutBack before anything is sent' ($pub -match [regex]::Escape('if ($PutBack -and @($DropPlugins).Count)'))
$ds = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-Server.ps1'))
Yes 'Deploy-Server puts -DropPlugins in front of the carry' ($ds -match '\[string\[\]\]\$DropPlugins' -and $ds -match [regex]::Escape('(Get-ThornswoodDropLine $DropPlugins) + $settingsCarryBlock'))
Yes '  and the carry checks the order it writes' ($settingsCarryBlock -match [regex]::Escape('Test-ThornswoodLoadOrderDrop $run $m.Settings $DropPlugins'))
$dev = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'))
$check = $dev.IndexOf('Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ loadOrder = @($boxContent.Order) })')
$firstSend = $dev.IndexOf('& scp')
Yes 'Deploy-DevGamemode -Dist holds the build''s order to the dev server''s, before anything is sent' ($check -gt 0 -and ($firstSend -lt 0 -or $check -lt $firstSend) -and $dev -match '\[string\[\]\]\$DropPlugins')
$inst = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Install-ThornswoodServer.ps1'))
$dropAt = $inst.IndexOf('Test-ThornswoodLoadOrderDrop $script:running $s $dropNames')
Yes 'the installer checks before it writes the stage''s settings or looks for a plugin' (
    $dropAt -gt 0 -and $dropAt -lt $inst.IndexOf('[IO.File]::WriteAllText($settingsPath') -and $dropAt -lt $inst.IndexOf('in the load order are not in the payload or on disk'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
