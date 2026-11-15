<#
  test-4203-delete-unread.ps1

      pwsh -NoProfile -File .\tests\test-4203-delete-unread.ps1

  Issue #4203: Delete-Person.ps1 skipped and only counted a file in its scope
  that would not parse in three places (a launcher log, a change form, a
  game server's other data file), then finished and recorded the request.
  This runs the script's own node core, lifted from the script, against
  stand-ins with a truncated save, a truncated launcher log and a truncated
  data file:
    - apply and the dry run both stop, naming each of the three files, and
      never reach DONE;
    - nothing is written: a copy set aside that holds their character is
      still there;
    - the same stores with whole files finish (DONE|apply), so the stop is
      the truncated files and nothing else;
    - the script refuses on a STOP before it writes the record row.
  Nothing leaves this machine.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $Repo (Join-Path 'scripts' (Join-Path 'vps' 'Delete-Person.ps1'))

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$errors)
Yes 'Delete-Person.ps1 parses' ($errors.Count -eq 0)
$assign = @($ast.FindAll({ param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and "$($a.Left)" -eq '$core' }, $true))
Yes 'the node core is in the script' ($assign.Count -eq 1)
$core = $assign[0].Right.Expression.Value

$node = Get-Command node -ErrorAction SilentlyContinue
Yes 'node is here to run the core' ([bool]$node)
if (-not $node) { Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1 }

$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4203-' + [Guid]::NewGuid().ToString('N'))
$ME = '111111111111111111'; $P1 = 5001
function Put([string]$p, [string]$t) { [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p)); [IO.File]::WriteAllText($p, $t) }
function P([string[]]$parts) { $p = $T; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }

$logBad   = P 'site', 'data', 'session-logs', 's1.json'
$formBad  = P 'live', 'world', 'changeForms', 'ff000a02.json'
$dataBad  = P 'live', 'private', 'property.json'
$setAside = P 'live', 'world-before-20261101-000000', 'changeForms', 'ff000a06.json'
function Build([bool]$broken) {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
    Put (P 'site', 'data', 'linked.json') ('{"' + $ME + '":{"profiles":[' + $P1 + ']}}')
    Put $logBad $(if ($broken) { '{"session":"s1","who":"' + $ME } else { '{"session":"s1","who":"' + $ME + '"}' })
    Put (P 'live', 'world', 'changeForms', 'ff000a01.json') ('{"formDesc":"a01","profileId":' + $P1 + '}')
    Put $formBad $(if ($broken) { '{"formDesc":"a02","profi' } else { '{"formDesc":"a02","profileId":6001}' })
    Put $setAside ('{"formDesc":"a06","profileId":' + $P1 + '}')
    [void][IO.Directory]::CreateDirectory((P 'live', 'private'))
    Put $dataBad $(if ($broken) { '{"claims":{"b1":{"by":' } else { '{"claims":{}}' })
    foreach ($d in 'dev', 'voice', 'voice-dev', 'bot') { [void][IO.Directory]::CreateDirectory((P $d)) }
}
function Core([string]$mode) {
    $plan = @{ mode = $mode; now = 1; people = @(@{ discordId = $ME; profiles = @() }); site = (P 'site')
               servers = @(@{ tag = 'live'; root = (P 'live') }, @{ tag = 'dev'; root = (P 'dev') })
               voices = @(@{ tag = 'live'; root = (P 'voice') }, @{ tag = 'dev'; root = (P 'voice-dev') }); bot = (P 'bot') }
    $w = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4203-core-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($w)
    try {
        [IO.File]::WriteAllText((Join-Path $w 'a.json'), (ConvertTo-Json -InputObject $plan -Depth 6))
        [IO.File]::WriteAllText((Join-Path $w 'core.js'), $core)
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { return @(& $node.Source (Join-Path $w 'core.js') (Join-Path $w 'a.json') 2>&1 | ForEach-Object { "$_" }) }
        finally { $ErrorActionPreference = $eap }
    } finally { Remove-Item -LiteralPath $w -Recurse -Force -ErrorAction SilentlyContinue }
}
function StopLine($lines) { $s = @($lines | Where-Object { $_ -like 'STOP|*' }); if ($s.Count) { return $s[0] } return '' }

try {
    Build $true
    $out = Core 'apply'
    $stop = StopLine $out
    Yes ('apply with truncated files never finishes (' + (($out | Select-Object -Last 2) -join ' / ') + ')') (-not @($out | Where-Object { $_ -like 'DONE|*' }).Count -and [bool]$stop)
    Yes '  and names the truncated launcher log' ($stop.Contains($logBad))
    Yes '  and names the truncated character save' ($stop.Contains($formBad))
    Yes '  and names the truncated data file' ($stop.Contains($dataBad))
    Yes '  and writes nothing: the copy set aside that holds their character is still there' (Test-Path -LiteralPath $setAside)
    Build $true
    $out = Core 'plan'
    Yes 'the dry run stops the same way, so -Delete is never reached' (-not @($out | Where-Object { $_ -like 'DONE|*' }).Count -and (StopLine $out).Contains($formBad))
    Build $false
    $out = Core 'apply'
    Yes ('the same stores with whole files finish (' + (($out | Select-Object -Last 1) -join '') + ')') (@($out | Where-Object { $_ -eq 'DONE|apply' }).Count -eq 1 -and -not (Test-Path -LiteralPath $setAside))
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

# The PowerShell half: a STOP from the apply refuses before the record row.
$text = [IO.File]::ReadAllText($Script)
$applyAt = $text.IndexOf("Run-Core 'apply'")
$refuseAt = $text.IndexOf('if ($why) { Refuse $why }', $applyAt)
$rowAt = $text.IndexOf('AppendAllText($record, (ConvertTo-Json', $applyAt)
Yes 'a STOP from the apply refuses before the record row is written' ($applyAt -gt 0 -and $refuseAt -gt $applyAt -and $rowAt -gt $refuseAt)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
