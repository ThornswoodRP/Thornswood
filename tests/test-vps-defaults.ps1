<#
  test-vps-defaults.ps1

  Issue #459: one place holds the VPS address and user, every script reads
  it, and a machine can point somewhere else without editing a tracked file.
  scripts\vps\vps.json is the place, read through scripts\vps\Vps.ps1.

  Checks:
    1. Vps.ps1 and every script that uses it parse (Parser.ParseFile).
    2. No script defaults $Vps or $VpsHost to an address, or $User or
       $VpsUser to a user; no script names user@ itself; every script with a
       user parameter fills it from Vps.ps1; nothing but Vps.ps1 reads
       vps.json.
    3. The address, from vps.json, is in no tracked file outside the one
       place, except what cannot read vps.json at run time: the launcher's
       default (Config.cs, config.example.json) and the game plugin that
       checks whose server it is on. Prose (the .md files and the site's
       board) may name it. Those baked copies must say the same address as
       vps.json. Since #3690 that address is the game's own name, never the
       box's address, and the box's address (what the name resolves to now)
       is in no tracked file at all, prose included.
    4. Vps.ps1 resolves the same address with an empty default and with an
       explicit override (the fill pattern every script uses).
    5. Per machine: THORNSWOOD_VPS_LOCAL or %LOCALAPPDATA%\Thornswood\vps.json
       overrides any field, THORNSWOOD_VPS and THORNSWOOD_VPS_USER override
       that, and the tracked file is left exactly as it was.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$VpsPs1 = Join-Path $Repo 'scripts\vps\Vps.ps1'
$VpsJson = Join-Path $Repo 'scripts\vps\vps.json'
Yes 'scripts\vps\Vps.ps1 exists' (Test-Path -LiteralPath $VpsPs1)
Yes 'scripts\vps\vps.json exists' (Test-Path -LiteralPath $VpsJson)
Yes 'the tools\Vps.ps1 forwarding copy is gone (issue #440)' (-not (Test-Path -LiteralPath ([IO.Path]::Combine($Repo, 'tools', 'Vps.ps1'))))

$tracked = Get-Content -LiteralPath $VpsJson -Raw | ConvertFrom-Json
$expectedAddress = [string]$tracked.address
$expectedUser = [string]$tracked.user
Yes 'vps.json has an address' (-not [string]::IsNullOrWhiteSpace($expectedAddress))
Yes 'vps.json has a user' (-not [string]::IsNullOrWhiteSpace($expectedUser))

# Nothing on this machine may bend what the tracked-file checks below see.
$saved = @{}
foreach ($n in 'THORNSWOOD_VPS', 'THORNSWOOD_VPS_USER', 'THORNSWOOD_VPS_LOCAL', 'LOCALAPPDATA') {
    $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process')
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-vps-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
function Set-Env([string]$n, $v) { [Environment]::SetEnvironmentVariable($n, $v, 'Process') }
Set-Env 'THORNSWOOD_VPS' $null; Set-Env 'THORNSWOOD_VPS_USER' $null
Set-Env 'THORNSWOOD_VPS_LOCAL' (Join-Path $tmp 'none.json')

try {
# ---- 1. ParseFile over Vps.ps1 and every script that dotsources it ---------
$all = @(Get-ChildItem -Path (Join-Path $Repo 'scripts') -Filter *.ps1 -Recurse -File)
$changed = @($all | Where-Object {
        $raw = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        $raw -and ($raw.Contains('Get-ThornswoodVpsAddress') -or $_.Name -eq 'Vps.ps1')
    })
Yes ("found the scripts that use Vps.ps1 ({0})" -f $changed.Count) ($changed.Count -ge 30)

$asts = @{}
$parseFails = @()
foreach ($f in $all) {
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
    if (@($errs).Count -gt 0) {
        if ($changed -contains $f) { $parseFails += ('{0}: {1}' -f $f.FullName.Substring($Repo.Length + 1), $errs[0].Message) }
    } else { $asts[$f.FullName] = $ast }
}
Yes 'every script that uses Vps.ps1 parses' ($parseFails.Count -eq 0)
foreach ($p in $parseFails) { Write-Host "  $p" -ForegroundColor Red }

# ---- 2. no address or user written into a script ---------------------------
$badDefaults = @()
$namesUser = @()
$noFill = @()
$readsJson = @()
foreach ($f in $all) {
    $ast = $asts[$f.FullName]
    if (-not $ast) { continue }
    $rel = $f.FullName.Substring($Repo.Length + 1)
    $isVps = ($f.Name -eq 'Vps.ps1')
    $userParam = $false
    foreach ($p in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ParameterAst] }, $true)) {
        $name = $p.Name.VariablePath.UserPath
        if ($name -notin 'Vps', 'VpsHost', 'User', 'VpsUser') { continue }
        if ($name -in 'User', 'VpsUser') { $userParam = $true }
        if ($p.DefaultValue -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $p.DefaultValue.Value) {
            $badDefaults += ('{0}: ${1} = ''{2}''' -f $rel, $name, $p.DefaultValue.Value)
        }
    }
    if (-not $isVps) {
        foreach ($s in $ast.FindAll({ param($n)
                $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
                $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] }, $true)) {
            if ($s.Extent.Text -match 'Administrator@') { $namesUser += ('{0}:{1}' -f $rel, $s.Extent.StartLineNumber) }
        }
        $raw = $ast.Extent.Text
        if ($userParam -and $raw.Contains('Get-ThornswoodVpsAddress') -and -not $raw.Contains('Get-ThornswoodVpsUser')) { $noFill += $rel }
        if ($raw -match 'vps\.json[''"]\)\s*-Raw[^\r\n]*ConvertFrom-Json') { $readsJson += $rel }
    }
}
Yes 'no script defaults $Vps, $VpsHost, $User or $VpsUser to a value' ($badDefaults.Count -eq 0)
foreach ($b in $badDefaults) { Write-Host "  $b" -ForegroundColor Red }
Yes 'no script names the VPS user in an ssh target itself' ($namesUser.Count -eq 0)
foreach ($b in $namesUser) { Write-Host "  $b" -ForegroundColor Red }
Yes 'every script with a user parameter fills it with Get-ThornswoodVpsUser' ($noFill.Count -eq 0)
foreach ($b in $noFill) { Write-Host "  $b" -ForegroundColor Red }
Yes 'nothing but Vps.ps1 reads vps.json, so the per machine override reaches every script' ($readsJson.Count -eq 0)
foreach ($b in $readsJson) { Write-Host "  $b" -ForegroundColor Red }

# ---- 3. the address is written nowhere else --------------------------------
# Baked: code that runs on somebody's machine or in the game and cannot read
# vps.json. Set-Vps.ps1 rewrites these when the box moves.
$baked = @(
    'launcher/app/Config.cs',
    'config.example.json',
    # The whose-game gate's one copy (#485); the other plugins read it from front.
    'game/plugins/thornswood-front.js'
)

Push-Location $Repo
try {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $carriers = @(git grep -F -l -e $expectedAddress 2>$null | ForEach-Object { ([string]$_).Replace('\', '/') })
    $ErrorActionPreference = $old
} finally { Pop-Location }
Yes 'vps.json is among the files carrying the address' ($carriers -contains 'scripts/vps/vps.json')
# Prose that names the box for a person reading it: the .md files. The
# site's copy of the hub's boards was here too until they went in #4359.
$prose = @()
$outside = @($carriers | Where-Object {
        $_ -ne 'scripts/vps/vps.json' -and $baked -notcontains $_ -and $prose -notcontains $_ -and $_ -notmatch '\.md$'
    })
Yes ("the address is written in no script or other code outside vps.json ({0} tracked files carry it)" -f $carriers.Count) ($outside.Count -eq 0)
foreach ($u in $outside) { Write-Host "  hardcoded: $u" -ForegroundColor Red }
$drifted = @($baked | Where-Object { $carriers -notcontains $_ })
Yes 'every baked copy says the address vps.json says, so they have not drifted apart' ($drifted.Count -eq 0)
foreach ($d in $drifted) { Write-Host "  not $($expectedAddress): $d" -ForegroundColor Red }

# #3690: the repository is going public, so what vps.json holds is a name, and
# the box's address is written nowhere. Which address that is gets asked of
# DNS here, so this file does not name it either.
$parsedIp = $null
Yes ('vps.json''s address is a name, not an IP address (' + $expectedAddress + ')') (-not [Net.IPAddress]::TryParse($expectedAddress, [ref]$parsedIp))
$boxAddresses = @()
$dnsSaid = ''
try { $boxAddresses = @([Net.Dns]::GetHostAddresses($expectedAddress) | ForEach-Object { $_.IPAddressToString }) } catch { $dnsSaid = $_.Exception.Message }
Yes ('the name resolves, so the launcher, the game and the scripts can reach the box by it' + $(if ($dnsSaid) { ' (' + $dnsSaid + ')' } else { '' })) ($boxAddresses.Count -gt 0)
$naming = @()
Push-Location $Repo
try {
    foreach ($a in $boxAddresses) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $naming += @(git grep -F -l -e $a 2>$null | ForEach-Object { ([string]$_).Replace('\', '/') })
        $ErrorActionPreference = $old
    }
} finally { Pop-Location }
$naming = @($naming | Sort-Object -Unique)
Yes ('no tracked file names the box''s address (' + $naming.Count + ' do)') ($boxAddresses.Count -gt 0 -and $naming.Count -eq 0)
foreach ($n in $naming) { Write-Host "  names the box's address: $n" -ForegroundColor Red }

# ---- 4. fill pattern: empty default vs explicit -Vps -----------------------
. $VpsPs1
Yes 'Vps.ps1 resolves the json address' ((Get-ThornswoodVpsAddress) -eq $expectedAddress)
Yes 'Vps.ps1 resolves the json user' ((Get-ThornswoodVpsUser) -eq $expectedUser)

$Vps = ''
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
Yes 'empty default fills from Vps.ps1' ($Vps -eq $expectedAddress)

$Vps = '203.0.113.9'
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
Yes 'explicit -Vps still wins' ($Vps -eq '203.0.113.9')

$User = ''
if (-not $User) { $User = Get-ThornswoodVpsUser }
Yes 'empty $User fills from Vps.ps1' ($User -eq $expectedUser)

$User = 'someone'
if (-not $User) { $User = Get-ThornswoodVpsUser }
Yes 'explicit -User still wins' ($User -eq 'someone')

# ---- 5. per machine, without editing a tracked file ------------------------
$before = (Get-FileHash -LiteralPath $VpsJson).Hash
$mine = Join-Path $tmp 'mine.json'
[IO.File]::WriteAllText($mine, '{ "address": "203.0.113.9", "user": "deployer" }', (New-Object Text.UTF8Encoding($false)))
Set-Env 'THORNSWOOD_VPS_LOCAL' $mine
Yes "this machine's file moves the address" ((Get-ThornswoodVpsAddress) -eq '203.0.113.9')
Yes 'and the user' ((Get-ThornswoodVpsUser) -eq 'deployer')
Yes 'and keeps every field it does not name' ([string](Get-ThornswoodVps).livePort -eq [string]$tracked.livePort)

Set-Env 'THORNSWOOD_VPS' '198.51.100.4'
Set-Env 'THORNSWOOD_VPS_USER' 'other'
Yes 'THORNSWOOD_VPS wins over the file' ((Get-ThornswoodVpsAddress) -eq '198.51.100.4')
Yes 'THORNSWOOD_VPS_USER wins over the file' ((Get-ThornswoodVpsUser) -eq 'other')
Set-Env 'THORNSWOOD_VPS' $null
Set-Env 'THORNSWOOD_VPS_USER' $null

# The default place, %LOCALAPPDATA%\Thornswood\vps.json.
Set-Env 'THORNSWOOD_VPS_LOCAL' $null
$appData = Join-Path $tmp 'appdata'
New-Item -ItemType Directory -Force -Path (Join-Path $appData 'Thornswood') | Out-Null
[IO.File]::WriteAllText((Join-Path $appData 'Thornswood\vps.json'), '{ "address": "192.0.2.44" }', (New-Object Text.UTF8Encoding($false)))
Set-Env 'LOCALAPPDATA' $appData
Yes "the file in LOCALAPPDATA\Thornswood is this machine's without naming it" ((Get-ThornswoodVpsAddress) -eq '192.0.2.44' -and (Get-ThornswoodVpsUser) -eq $expectedUser)

[IO.File]::WriteAllText((Join-Path $appData 'Thornswood\vps.json'), 'not json', (New-Object Text.UTF8Encoding($false)))
$threw = $false
try { $null = Get-ThornswoodVpsAddress } catch { $threw = $true }
Yes "a machine file that does not read stops rather than falling back quietly" $threw

# A script started in its own process, dot-sourcing Vps.ps1 and filling its
# parameters the way every script does, so the environment is proved to reach
# one and not only this harness.
Set-Env 'LOCALAPPDATA' $saved['LOCALAPPDATA']
Set-Env 'THORNSWOOD_VPS_LOCAL' (Join-Path $tmp 'none.json')
Set-Env 'THORNSWOOD_VPS' '203.0.113.77'
$child = Join-Path $tmp 'child.ps1'
[IO.File]::WriteAllText($child, ('. ''' + $VpsPs1.Replace("'", "''") + "'`r`n" + '$Vps = ''''; $User = ''''' + "`r`n" +
    'if (-not $User) { $User = Get-ThornswoodVpsUser }' + "`r`n" + 'if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }' + "`r`n" + '"$User@$Vps"' + "`r`n"), (New-Object Text.UTF8Encoding($false)))
$exe = (Get-Process -Id $PID).Path
$said = (@(& $exe -NoProfile -ExecutionPolicy Bypass -File $child) | Select-Object -Last 1)
Yes 'a script started with THORNSWOOD_VPS set targets that box, as the same user' ($said -eq ($expectedUser + '@203.0.113.77'))
Set-Env 'THORNSWOOD_VPS' $null

Yes 'the tracked vps.json was not touched by any of it' ((Get-FileHash -LiteralPath $VpsJson).Hash -eq $before)
} finally {
    foreach ($n in $saved.Keys) { Set-Env $n $saved[$n] }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
