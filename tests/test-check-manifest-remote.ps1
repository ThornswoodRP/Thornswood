<#
  test-check-manifest-remote.ps1

      pwsh -NoProfile -File .\tests\test-check-manifest-remote.ps1

  scripts\mods\Check-Manifest.ps1: the two scripts it runs on the VPS (find the
  server root on C:, then read the manifests under it) and what it does with
  their answer. The real script runs as a child from a scratch copy of the
  repo whose scripts\vps\Vps.ps1 and Send-Script.ps1 are stubs: the "remote"
  script runs here, in a child of the same PowerShell, with C:\ swapped for a
  scratch folder standing in for the VPS's C: drive. No ssh, no network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-manifest-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$Fake = Join-Path $T 'repo'; $Drive = Join-Path $T 'vpsC'; $Client = Join-Path $T 'client'; $Log = Join-Path $T 'remote.log'
function W([string]$p, [string]$t) { [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p)); [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($false))) }
$base = 'Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'
function Server([string]$rel, [string[]]$order, [string]$dataDir = '') {
    $root = Join-Path $Drive $rel
    $settings = if ($dataDir) { '{"dataDir":"' + $dataDir + '"}' } else { '{}' }
    W (Join-Path $root 'server-settings.json') $settings
    if ($order) {
        $doc = (@{ loadOrder = $order; mods = @($order | ForEach-Object { @{ filename = $_ } }) } | ConvertTo-Json -Depth 4)
        $d = if ($dataDir) { $dataDir } else { 'data' }
        W (Join-Path $root "$d\manifest.json") $doc
        W (Join-Path $root "$d\client\manifest.json") $doc
    }
}
function Reset { if (Test-Path -LiteralPath $Drive) { Remove-Item -LiteralPath $Drive -Recurse -Force }; [void][IO.Directory]::CreateDirectory($Drive); if (Test-Path -LiteralPath $Log) { Remove-Item -LiteralPath $Log -Force } }
function Run([string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Fake 'scripts\mods\Check-Manifest.ps1') @a -Client $Client -NoPause 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}

try {
    foreach ($d in 'scripts\mods', 'scripts\vps', 'launcher\app') { [void][IO.Directory]::CreateDirectory((Join-Path $Fake $d)) }
    [IO.File]::Copy((Join-Path $Repo 'scripts\mods\Check-Manifest.ps1'), (Join-Path $Fake 'scripts\mods\Check-Manifest.ps1'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\mods\LoadOrder.ps1'), (Join-Path $Fake 'scripts\mods\LoadOrder.ps1'))
[void][IO.Directory]::CreateDirectory((Join-Path $Fake 'scripts\release'))
[IO.File]::Copy((Join-Path $Repo 'scripts\release\Read-JsonFile.ps1'), (Join-Path $Fake 'scripts\release\Read-JsonFile.ps1'))
    W (Join-Path $Fake 'scripts\vps\Vps.ps1') "function Get-ThornswoodVpsUser { 'stub-user' }`nfunction Get-ThornswoodVpsAddress { '192.0.2.1' }`n"
    $q = { param($s) $s.Replace("'", "''") }
    W (Join-Path $Fake 'scripts\vps\Send-Script.ps1') @"
function Invoke-ThornswoodRemote {
    param([string]`$Target, [string[]]`$SshArgs, [string]`$Script)
    Add-Content -LiteralPath '$(& $q $Log)' -Value ('remote ' + `$Target)
    `$body = `$Script.Replace("'C:\'", "'$(& $q (& $q ($Drive + '\')))'")
    `$f = Join-Path '$(& $q $T)' ('remote-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText(`$f, `$body, (New-Object Text.UTF8Encoding(`$true)))
    `$was = `$ErrorActionPreference; `$ErrorActionPreference = 'Continue'
    try { & '$(& $q $Shell)' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `$f 2>&1 | ForEach-Object { "`$_" } }
    finally { `$ErrorActionPreference = `$was; Remove-Item -LiteralPath `$f -Force -ErrorAction SilentlyContinue }
}
"@
    # The client: five masters, A.esp, B.esp, enabled in that order.
    foreach ($m in @($base) + @('A.esp', 'B.esp')) { $h = [byte[]]::new(24); [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($h, 0); W (Join-Path $Client "Game\Data\$m") ''; [IO.File]::WriteAllBytes((Join-Path $Client "Game\Data\$m"), $h) }
    W (Join-Path $Client 'Profile\LocalAppData\plugins.txt') "*A.esp`r`n*B.esp`r`n"
    $order = @($base) + @('A.esp', 'B.esp')

    # 1. Live and dev beside each other on C:.
    Reset
    Server 'Thornswood-Server' $order
    Server 'Thornswood-Server-Dev' (@($base) + @('A.esp'))
    $r = Run @()
    Yes 'the remote is asked as the configured user at the configured address' ((Get-Content -LiteralPath $Log)[0] -eq 'remote stub-user@192.0.2.1')
    Yes 'both roots are found on the first pass' ($r.Out -match 'ROOT .*Thornswood-Server\b' -and $r.Out -match 'ROOT .*Thornswood-Server-Dev')
    Yes '  the live one is read without -Dev' ($r.Out -match 'reading .*Thornswood-Server \(live\)')
    Yes '  and its two copies of the manifest count once' ($r.Out -match 'same list as above, not counted twice' -and $r.Out -match 'server wants\s+7 plugins')
    Yes '  against this build: identical' ($r.Out -match 'POSITION BY POSITION: identical' -and $r.Code -eq 0)
    $r = Run @('-Dev')
    Yes '-Dev reads the -Dev root' ($r.Out -match 'reading .*Thornswood-Server-Dev \(dev\)' -and $r.Out -match 'server wants\s+6 plugins')
    Yes '  and says the build has one the dev server does not list, with dev advice' ($r.Out -match 'B\.esp' -and $r.Out -match 'one list runs out')

    # 2. A server one level down, in a folder with [ ] in its name.
    Reset
    Server 'Games\[Thornswood] Server' $order
    $r = Run @()
    Yes 'the second pass finds a server one folder down, [ ] in its name' ($r.Out -match 'ROOT .*\[Thornswood\] Server')
    Yes '  and reads its manifest' ($r.Out -match 'server wants\s+7 plugins' -and $r.Code -eq 0)

    # 3. A root with an apostrophe, and a dataDir of its own.
    Reset
    Server "O'Neill Server" $order 'world data'
    $r = Run @()
    Yes "a root with an apostrophe is read (it broke the remote script's quoting)" ($r.Out -match "server wants\s+7 plugins" -and $r.Out -match "dataDir\s+.*O'Neill Server[\\/]world data")

    # 4. Nothing there.
    Reset
    $r = Run @()
    Yes 'no server-settings.json anywhere: exit 1, saying so' ($r.Code -eq 1 -and $r.Out -match 'No server-settings\.json anywhere on C:')
    Server 'Thornswood-Server' $order
    $r = Run @('-Dev')
    Yes '-Dev with no dev root: exit 1, naming vps-dev-instance.ps1' ($r.Code -eq 1 -and $r.Out -match 'No dev server on the box' -and $r.Out -match 'vps-dev-instance\.ps1')

    # 5. A root with no manifest yet.
    Reset
    Server 'Thornswood-Server' @()
    $r = Run @()
    Yes 'a server that has written no manifest: exit 1, saying it has not started' ($r.Code -eq 1 -and $r.Out -match 'has not written a manifest')

    # 6. The server order differs in the middle.
    Reset
    Server 'Thornswood-Server' (@($base) + @('B.esp', 'A.esp'))
    $r = Run @('-Full')
    Yes 'an order that parts company names the slot and says to press Fix, not redeploy' ($r.Out -match 'part company at slot 6' -and $r.Out -match 'Press Fix' -and $r.Out -match 'Do not redeploy')
    Yes '  and -Full prints the server list' ($r.Out -match '\s7\s+A\.esp')
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }