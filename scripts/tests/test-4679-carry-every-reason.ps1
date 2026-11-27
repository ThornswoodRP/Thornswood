<#
  test-4679-carry-every-reason.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4679-carry-every-reason.ps1

  #4679. A settings carry refused for the load order (#2320) hid a join pass
  switch problem (#1319) found in the same run. Deploy-Server.ps1's carry
  ($settingsCarryBlock in ServerSettings.ps1) put the load order's reason over
  the pass switch's, and Install-ThornswoodServer.ps1 refused on the load
  order before it asked about the switch. So a run wrong on both was told one,
  fixed it, and was refused again for the other.

  This runs both on a scratch root whose server runs 102 plugins and has no
  thornswoodRequirePass, and holds:
    1. Deploy-Server's carry, with an order that drops 97 of them, is CARRY
       REFUSED with both reasons before that line, and the stage cleared;
       with only one of the two wrong, only that one is said.
    2. The installer, by PowerShell 7 the way the box runs it, with a payload
       that drops them, is INSTALL REFUSED with both reasons, and the running
       server's settings byte for byte as they were; with only one wrong,
       only that one is said.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
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
. (Join-Path (Join-Path $repo 'tests') 'Windows.ps1')

$masters = 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'
$others = @(1..97 | ForEach-Object { 'Mod {0:D3}.esp' -f $_ })
# The pass switch on or missing, as asked.
function Settings([string[]]$order, [bool]$withPass) {
    $s = [ordered]@{ port = 7787; loadOrder = $order }
    if ($withPass) { $s.thornswoodRequirePass = $true }
    return [pscustomobject]$s
}
$orderText = 'leaves out 97 of the 102'
$passText = 'thornswoodRequirePass is missing on this server'

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4679-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    # ==================================================== 1. Deploy-Server's carry
    Write-Host 'Deploy-Server.ps1''s carry, on a scratch stage'
    $box = 'C:/Thornswood-Server/plugins/'
    $running = @($masters + $others | ForEach-Object { $box + $_ })
    $short = @($masters | ForEach-Object { $box + $_ })
    function Carry([string[]]$order, [bool]$withPass) {
        $croot = Join-Path $T ('carry-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        Put (Join-Path $croot 'server-settings.json') (ConvertTo-Json -InputObject (Settings $running $withPass) -Depth 5)
        Put (Join-Path $croot 'stage\server-settings.json') (ConvertTo-Json -InputObject (Settings $order $withPass) -Depth 5)
        $text = '$Root = ''' + $croot + '''' + "`r`n" + '$Stage = ''stage''' + "`r`n" + '$ReleaseKeys = @(''loadOrder'')' + "`r`n" +
                (Get-ThornswoodAskedLine ([ordered]@{})) + (Get-ThornswoodDropLine @()) + $settingsCarryBlock
        $o = @(& ([scriptblock]::Create($text)) | ForEach-Object { "$_" })
        $at = [Array]::IndexOf($o, 'CARRY REFUSED')
        $before = ''
        if ($at -ge 0) { $before = ($o[0..$at] -join "`n") }
        return [pscustomobject]@{ Text = ($o -join "`n"); Before = $before; Stage = (Test-Path -LiteralPath (Join-Path $croot 'stage')) }
    }
    $c = Carry $short $false
    Yes 'an order that drops 97 on a server with no pass switch: CARRY REFUSED' ($c.Text -match 'CARRY REFUSED' -and $c.Text -cnotmatch '(?m)^CARRIED [0-9a-f]{64}')
    Yes '  saying the load order before that line' ($c.Before -match $orderText)
    Yes '  and the pass switch too, in the same run' ($c.Before -match $passText)
    Yes '  with the stage cleared' (-not $c.Stage)
    $c = Carry $short $true
    Yes 'the order alone wrong: refused for the order, and the switch not named' ($c.Before -match $orderText -and $c.Before -notmatch 'thornswoodRequirePass is')
    $c = Carry $running $false
    Yes 'the switch alone wrong: refused for the switch, and the order not named' ($c.Before -match $passText -and $c.Before -notmatch 'leaves out')
    $c = Carry $running $true
    Yes 'neither wrong: CARRIED' ($c.Text -cmatch 'CARRIED [0-9a-f]{64}' -and $c.Text -notmatch 'CARRY REFUSED')

    # ======================================================== 2. the installer
    Write-Host ''
    Write-Host 'Install-ThornswoodServer.ps1, by PowerShell 7'
    $installer = Join-Path $T 'installer'
    New-Item -ItemType Directory -Force -Path $installer | Out-Null
    foreach ($f in 'Install-ThornswoodServer.ps1', 'ServerSettings.ps1', 'ServerBuild.ps1', 'ServerReadyWait.ps1') {
        Copy-Item -LiteralPath (Join-Path $repo "scripts\deploy\$f") -Destination (Join-Path $installer $f)
    }
    foreach ($f in 'Read-JsonFile.ps1', 'RecordShape.ps1') { Copy-Item -LiteralPath (Join-Path $repo "scripts\release\$f") -Destination (Join-Path $installer $f) }
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\vps\Server-Log.js') -Destination (Join-Path $installer 'Server-Log.js')
    $boxPs = Get-BoxPowerShell
    function New-Payload([string]$name, [string[]]$order, [bool]$withPass) {
        $d = Join-Path $T ('payload-' + $name)
        Put (Join-Path $d 'server-settings.json') (ConvertTo-Json -InputObject (Settings $order $withPass) -Depth 5)
        $z = Join-Path $T ($name + '.zip')
        Compress-Archive -Path (Join-Path $d '*') -DestinationPath $z -Force
        return $z
    }
    function Install([string]$name, [string[]]$order, [bool]$withPass) {
        $root = Join-Path $T ('Thornswood-Server-' + $name)
        $rootBox = $root.Replace('\', '/') + '/plugins/'
        Put (Join-Path $root 'server-settings.json') (ConvertTo-Json -InputObject (Settings @($masters + $others | ForEach-Object { $rootBox + $_ }) $withPass) -Depth 5)
        $was = [IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))
        $zip = New-Payload $name @($order | ForEach-Object { $rootBox + $_ }) $withPass
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $installer 'Install-ThornswoodServer.ps1'),
               '-Zip', $zip, '-Root', $root, '-NoTask', '-AllowGamingPc')
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $boxPs @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
        $same = ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))) -eq [Convert]::ToBase64String($was))
        return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($o -join "`n"); Same = $same }
    }
    $r = Install 'both' $masters $false
    Yes 'a payload that drops 97 over a server with no pass switch: INSTALL REFUSED' ($r.Code -eq 1 -and $r.Text -match 'INSTALL REFUSED')
    Yes '  saying the load order' ($r.Text -match ('REFUSED: the load order this run would install has 5 plugins and ' + $orderText))
    Yes '  and the pass switch too, in the same run' ($r.Text -match ('REFUSED: ' + $passText))
    Yes '  with the running server''s settings as they were' ($r.Same)
    $r = Install 'order' $masters $true
    Yes 'the order alone wrong: refused for the order, and the switch not named' ($r.Code -eq 1 -and $r.Text -match $orderText -and $r.Text -notmatch 'thornswoodRequirePass is')
    $r = Install 'pass' @($masters + $others) $false
    Yes 'the switch alone wrong: refused for the switch, and the order not named' ($r.Code -eq 1 -and $r.Text -match $passText -and $r.Text -notmatch 'leaves out')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
