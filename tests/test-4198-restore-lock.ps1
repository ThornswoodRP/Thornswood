<#
  test-4198-restore-lock.ps1

      pwsh -NoProfile -File .\tests\test-4198-restore-lock.ps1

  Issue #4198. scripts\vps\vps-restore-services.ps1 puts the bot's settings
  (bot.env.json, which holds its token) back and locks them to SYSTEM and
  Administrators, as Install-Bot.ps1 leaves them. When the lock failed it
  printed one COULD NOT LOCK line and still ended "SERVICES OK" with exit
  0, so Restore-Box.ps1 counted the restore good and the token kept the
  folder's looser permissions.

  This lifts the script from where it places the bot's settings to its
  end, runs it in its own PowerShell with a stand-in Place and the file in a
  scratch folder, and holds:

    1. a lock that fails names the file and why, ends SERVICES INCOMPLETE
       naming it, and exits 1 (Set-Acl made to refuse, on any machine);
    2. a lock that works still ends SERVICES OK with exit 0 (Windows only:
       the lock is Windows' access rules).

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = [IO.File]::ReadAllText((Join-Path $Repo ('scripts\vps\vps-restore-services.ps1'.Replace('\', [IO.Path]::DirectorySeparatorChar))))
$from = $text.IndexOf("Place 'bot\bot.env.json'")
Yes 'the script places the bot''s settings and locks them' ($from -ge 0 -and $text.IndexOf('Set-Acl', $from) -gt $from)
$tail = $text.Substring($from)

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4198-' + [Guid]::NewGuid().ToString('N'))
$bot = Join-Path $work 'Thornswood-Bot'
$null = New-Item -ItemType Directory -Force -Path $bot, (Join-Path $work 'empty')

# Runs the tail in a PowerShell of its own, since it ends with exit.
function Run-Tail([string]$stub) {
    $envFile = Join-Path $bot 'bot.env.json'
    [IO.File]::WriteAllText($envFile, '{"token":"stand-in"}')
    $head = @"
`$ErrorActionPreference = 'Stop'
`$From = '$(Join-Path $work 'empty')'
`$BotRoot = '$bot'
`$CaddyRoot = '$(Join-Path $work 'caddy')'
`$GameRoot = '$(Join-Path $work 'game')'
`$DevGameRoot = '$(Join-Path $work 'game-dev')'
`$missing = @()
`$essential = @()
function Place([string]`$rel, [string]`$dst, [switch]`$Essential) { 'placed    ' + `$rel }
$stub
"@
    $f = Join-Path $work ('tail-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $head + "`n" + $tail)
    $said = @(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File $f 2>&1 | ForEach-Object { "$_" })
    return @{ Code = $LASTEXITCODE; Said = ($said -join "`n"); File = $envFile }
}

try {
    # ---- 1. a lock that fails ---------------------------------------------------
    $r = Run-Tail @'
function Get-Acl { param([string]$LiteralPath)
  $a = [pscustomobject]@{ Access = @() }
  $a | Add-Member ScriptMethod SetAccessRuleProtection { param($x, $y) }
  $a | Add-Member ScriptMethod RemoveAccessRule { param($r) $true }
  $a | Add-Member ScriptMethod AddAccessRule { param($r) }
  return $a }
function Set-Acl { param([string]$LiteralPath, $AclObject) throw 'Attempted to perform an unauthorized operation.' }
'@
    Yes ('1. a lock that fails exits 1 (exit ' + $r.Code + ')') ($r.Code -eq 1)
    Yes '   and names the file it could not lock' ($r.Said -match ('COULD NOT LOCK ' + [regex]::Escape($r.File)))
    Yes '   and ends SERVICES INCOMPLETE, naming the bot''s settings' ($r.Said -match '(?m)^SERVICES INCOMPLETE:.*bot\.env\.json')
    Yes '   and never says SERVICES OK' ($r.Said -notmatch 'SERVICES OK')
    if ($script:fail) { Write-Host ('      it said: ' + ($r.Said -replace "`n", ' / ')) }

    # ---- 2. a lock that works -----------------------------------------------------
    if (-not $OnWindows) {
        Write-Host 'SKIP  2. a lock that works: the lock is Windows'' access rules, and this is not Windows'
    } else {
        $r = Run-Tail ''
        Yes ('2. a lock that works ends SERVICES OK (exit ' + $r.Code + ')') ($r.Code -eq 0 -and $r.Said -match 'SERVICES OK' -and $r.Said -match ('locked\s+' + [regex]::Escape($r.File)))
        Yes '   and the file is shut to all but SYSTEM, Administrators and whoever ran it' ((Get-Acl -LiteralPath $r.File).AreAccessRulesProtected)
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
