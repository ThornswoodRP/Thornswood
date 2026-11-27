<#
  test-1804-install-pass-switch.ps1

      pwsh -NoProfile -File .\scripts\tests\test-1804-install-pass-switch.ps1

  #1804. Since #1319 the gamemode reads thornswoodRequirePass as on (the join
  pass hold) for anything but false, so a server whose settings have no value,
  or one that is neither true nor false, starts holding the moment a new
  gamemode reaches it. Deploy-Server.ps1 and Deploy-DevGamemode.ps1 refuse
  such a server until -RequirePass says which. The third route a gamemode
  takes to a server, Publish-Server.ps1 through Install-ThornswoodServer.ps1,
  kept the running server's value and said nothing. Since #1223 no build
  carries the switch, so every first install was such a server too.

  The installer is run whole, as its own process, against scratch folders, as
  far as its stage: the payloads here carry no server-build.json, so a run
  that gets past the join pass ends refused for that instead, before anything
  would be stopped. The swap, and an install that goes all the way with
  -RequirePass, need Windows and run in test-install-server.ps1.

  1. A running server with no switch, or with one that is neither true nor
     false, is INSTALL REFUSED with the reason ServerSettings.ps1 gives,
     naming Publish-Server.ps1 -RequirePass, with the server folder as it was
     and no stage left. The payload's own value does not count: the running
     server's is the one that is carried.
  2. With -RequirePass on, the same server gets past it and the run says it
     set the switch; one whose switch is false gets past it with none.
  3. A first install whose payload has no switch is refused and makes no
     folder; with -RequirePass off it gets past it.
  4. -PutBack with -RequirePass is refused, by the installer and by
     Publish-Server.ps1 before it sends anything.
  5. Publish-Server.ps1 hands -RequirePass to the installer.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}
function Text([string]$file) { if (Test-Path -LiteralPath $file) { return [IO.File]::ReadAllText($file) } return $null }

# ---- the reason ------------------------------------------------------------------
Write-Host 'ServerSettings.ps1'
. (Join-Path $repo 'scripts\deploy\ServerSettings.ps1')
$none = [pscustomobject]@{ port = 7777 }
Yes 'the reason names Deploy-Server.ps1 by default, as the carry on the box gives it' (
    (Get-ThornswoodPassSwitchProblem $none) -match 'Deploy-Server\.ps1 -RequirePass on, or off')
$why = Get-ThornswoodPassSwitchProblem $none '.\scripts\release\Publish-Server.ps1'
Yes '  and the script it is told, for the installer' ($why -match 'Publish-Server\.ps1 -RequirePass on, or off' -and $why -notmatch 'Deploy-Server')
Yes '  and true or false is no problem' (
    -not (Get-ThornswoodPassSwitchProblem ([pscustomobject]@{ thornswoodRequirePass = $true })) -and
    -not (Get-ThornswoodPassSwitchProblem ([pscustomobject]@{ thornswoodRequirePass = $false })))

$node = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not $node) { Write-Host 'SKIP  the installer runs need node, which this machine lacks'; Done }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1804-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
# The try opens where the folder is made, so a stop while the box is laid out
# still removes it (#4264).
try {
# The installer and what it loads from beside it, as Publish-Server sends them.
$box = Join-Path $T 'box'
foreach ($f in 'Install-ThornswoodServer.ps1', 'ServerSettings.ps1', 'ServerBuild.ps1', 'ServerReadyWait.ps1') {
    Put (Join-Path $box $f) ([IO.File]::ReadAllText((Join-Path $repo "scripts\deploy\$f")))
}
foreach ($f in 'Read-JsonFile.ps1', 'RecordShape.ps1') {
    Put (Join-Path $box $f) ([IO.File]::ReadAllText((Join-Path $repo "scripts\release\$f")))
}
# The log writer the server's task runs (#2349), which the installer refuses without.
Put (Join-Path $box 'Server-Log.js') ([IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Server-Log.js')))
$installer = Join-Path $box 'Install-ThornswoodServer.ps1'

# A payload for $root, with $pass as its join pass switch ('' for none). It
# carries no server-build.json, so a run that gets past the join pass is
# refused for that, at the end of the stage's checks.
$script:zipN = 0
function Payload([string]$root, $pass) {
    $script:zipN++
    $dir = Join-Path $T ('payload-' + $script:zipN)
    Put (Join-Path $dir 'plugins\Skyrim.esm') 'plugin'
    Put (Join-Path $dir 'gamemode.js') '// gamemode'
    Put (Join-Path $dir 'dist_back\skymp5-server.js') '// server'
    $st = [ordered]@{ port = 7777; name = 'Thornswood Test'; dataDir = 'data'; loadOrder = @((($root -replace '\\', '/') + '/plugins/Skyrim.esm')) }
    if ($null -ne $pass) { $st['thornswoodRequirePass'] = $pass }
    Put (Join-Path $dir 'server-settings.json') ($st | ConvertTo-Json -Depth 5)
    $zip = Join-Path $T ('payload-' + $script:zipN + '.zip')
    Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $zip -Force
    return $zip
}
# A running server's folder, with $pass as its switch ($null for none).
function Running([string]$name, $pass) {
    $root = Join-Path $T $name
    $st = [ordered]@{ port = 7777; name = 'Thornswood Own'; dataDir = 'data'; loadOrder = @((($root -replace '\\', '/') + '/plugins/Skyrim.esm')) }
    if ($null -ne $pass) { $st['thornswoodRequirePass'] = $pass }
    Put (Join-Path $root 'server-settings.json') ($st | ConvertTo-Json -Depth 5)
    Put (Join-Path $root 'world\w.txt') 'every character'
    return $root
}
function Invoke-Installer([string[]]$argv) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = @(& $shell -NoProfile -File $installer @argv -NoTask -AllowGamingPc 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $ErrorActionPreference = $eap }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
}
function Stages([string]$root) {
    return @(Get-ChildItem -LiteralPath (Split-Path -Parent $root) -Directory -Force |
             Where-Object { $_.Name -like ((Split-Path -Leaf $root) + '.*') })
}
$passRefusal = 'thornswoodRequirePass is (missing|neither true nor false) on this server and this run did not say which'

    # ---- 1. a running server with no switch ------------------------------------
    Write-Host ''
    Write-Host 'a running server'
    $root = Running 'missing' $null
    $was = Text (Join-Path $root 'server-settings.json')
    $r = Invoke-Installer @('-Zip', (Payload $root $true), '-Root', $root)
    Yes 'with no switch is INSTALL REFUSED' ($r.Code -ne 0 -and $r.Lines -contains 'INSTALL REFUSED')
    Yes '  saying the switch is missing and how to give one' (
        $r.Text -match 'REFUSED: thornswoodRequirePass is missing on this server' -and $r.Text -match 'Publish-Server\.ps1 -RequirePass on, or off')
    Yes '  though the payload had one, since the running server''s is the one carried' ($r.Text -notmatch 'set as this run asked')
    Yes '  and the folder is as it was, with no stage left' (
        (Text (Join-Path $root 'server-settings.json')) -eq $was -and (Text (Join-Path $root 'world\w.txt')) -eq 'every character' -and
        @(Stages $root).Count -eq 0)

    $root = Running 'text' 'true'
    $r = Invoke-Installer @('-Zip', (Payload $root $null), '-Root', $root)
    Yes 'with "true" as text is INSTALL REFUSED as neither true nor false' (
        $r.Code -ne 0 -and $r.Text -match 'REFUSED: thornswoodRequirePass is neither true nor false on this server')

    # ---- 2. -RequirePass, and a server that has false -----------------------------
    $root = Running 'asked' $null
    $r = Invoke-Installer @('-Zip', (Payload $root $null), '-Root', $root, '-RequirePass', 'on')
    Yes 'with no switch and -RequirePass on gets past it, and says it set the switch' (
        $r.Text -match 'set as this run asked: thornswoodRequirePass' -and $r.Text -notmatch $passRefusal)
    Yes '  and goes on to the stage''s other checks (here refused for the record it lacks)' (
        $r.Text -match 'carries no server-build\.json' -and @(Stages $root).Count -eq 0)

    $root = Running 'false' $false
    $r = Invoke-Installer @('-Zip', (Payload $root $null), '-Root', $root)
    Yes 'with false gets past it with no -RequirePass' ($r.Text -notmatch $passRefusal -and $r.Text -match 'carries no server-build\.json')

    # ---- 3. a first install --------------------------------------------------------
    Write-Host ''
    Write-Host 'a first install'
    $root = Join-Path $T 'first\Thornswood-Server'
    $r = Invoke-Installer @('-Zip', (Payload $root $null), '-Root', $root)
    Yes 'of a payload with no switch is INSTALL REFUSED' ($r.Code -ne 0 -and $r.Lines -contains 'INSTALL REFUSED')
    Yes '  saying how to give one' ($r.Text -match 'REFUSED: thornswoodRequirePass is missing' -and $r.Text -match 'Publish-Server\.ps1 -RequirePass on, or off')
    Yes '  and makes no server folder' (-not (Test-Path -LiteralPath $root) -and @(Stages $root).Count -eq 0)
    $r = Invoke-Installer @('-Zip', (Payload $root $null), '-Root', $root, '-RequirePass', 'off')
    Yes 'with -RequirePass off gets past it, and says it set the switch' (
        $r.Text -match 'set as this run asked: thornswoodRequirePass' -and $r.Text -notmatch $passRefusal -and $r.Text -match 'carries no server-build\.json')

    # ---- 4. -PutBack ---------------------------------------------------------------
    Write-Host ''
    Write-Host '-PutBack'
    $root = Running 'putback' $true
    Put (Join-Path $T 'putback.prev-20000101-000000\server-settings.json') '{}'
    $r = Invoke-Installer @('-Root', $root, '-PutBack', '-RequirePass', 'off')
    Yes 'the installer refuses -PutBack with -RequirePass' ($r.Code -ne 0 -and $r.Text -match '-PutBack sets no setting' -and $r.Lines -contains 'INSTALL REFUSED')
    Yes '  and puts nothing back' ((Test-Path -LiteralPath (Join-Path $T 'putback.prev-20000101-000000')) -and
                                   (Text (Join-Path $root 'world\w.txt')) -eq 'every character')

    $publish = Join-Path $repo 'scripts\release\Publish-Server.ps1'
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $shell -NoProfile -File $publish -PutBack -RequirePass on -NoPause -VpsHost 127.0.0.1 -VpsUser nobody `
                   -Dist (Join-Path $T 'no-dist') -Zip (Join-Path $T 'no.zip') 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap }
    $said = $out -join "`n"
    Yes 'Publish-Server.ps1 refuses -PutBack with -RequirePass' ($code -eq 1 -and $said -match 'STOP\. -PutBack sets no setting')
    Yes '  before it puts anything back or sends anything' ($said -notmatch 'Putting the previous server back' -and $said -match 'Nothing was sent')

    # ---- 5. Publish-Server hands it on ---------------------------------------------
    $src = [IO.File]::ReadAllText($publish)
    Yes 'Publish-Server.ps1 hands -RequirePass to the installer' ($src -match '\$instArgs \+= " -RequirePass \$RequirePass"')
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
