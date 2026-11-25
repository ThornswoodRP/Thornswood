$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$file = Join-Path $repo 'scripts/turn/Switch-MainTurnRelay.ps1'
$errorsFound = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errorsFound)
if ($errorsFound.Count) { throw 'The Main relay transaction must parse.' }

$functions = 'Add-MainTurnSetting','Restore-MainIssuer','Stop-MainVoice'
$definitions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($name in $functions) {
    $definition = @($definitions | Where-Object Name -CEQ $name)
    if ($definition.Count -ne 1) { throw "Expected the transaction function $name." }
    . ([scriptblock]::Create($definition[0].Extent.Text))
}

$portSetting = 'set THORNSWOOD_VOICE_PORT=7778&& '
$relayUrl = 'turn:192.0.2.1:3479?transport=udp'
$original = 'owner set THORNSWOOD_SITE=http://127.0.0.1:3001&& ' + $portSetting + 'set THORNSWOOD_VOICE_BIND=127.0.0.1&& start voice'
$withTurn = Add-MainTurnSetting $original
$desired = 'owner set THORNSWOOD_SITE=http://127.0.0.1:3001&& ' + $portSetting + 'set THORNSWOOD_TURN_URL=' + $relayUrl + '&& set THORNSWOOD_VOICE_BIND=127.0.0.1&& start voice'
if ($withTurn -cne $desired) { throw 'The Main command must preserve all other settings.' }

function Expect-Rejection([scriptblock]$Case) {
    $refused = $false
    try { $null = & $Case } catch { $refused = $true }
    if (!$refused) { throw 'Expected transaction rejection.' }
}
Expect-Rejection { Add-MainTurnSetting $withTurn }
Expect-Rejection { Add-MainTurnSetting ($original + ' ' + $portSetting) }
Expect-Rejection { Add-MainTurnSetting ($original.Replace('7778','7789')) }

$voiceKey = 'fixture-key'
$taskSid = 'fixture-sid'
$script:present = $true
$script:hash = 'unexpected'
$script:removed = $false
$script:restored = $null
function Test-Path { param([string]$LiteralPath) $LiteralPath -ceq $voiceKey -and $script:present }
function Assert-PionSecretAcl { param($Path,$Sid) if ($Path -cne $voiceKey -or $Sid -cne $taskSid) { throw 'Unexpected protected path.' } }
function Get-FileHash { param([string]$LiteralPath) @{Hash=$script:hash} }
function Remove-Item { param([string]$LiteralPath) if ($LiteralPath -cne $voiceKey) { throw 'Unexpected deletion.' }; $script:removed=$true }
function Start-MainVoice($action) { $script:restored = $action }
function Wait-MainIssuer([bool]$TurnEnabled) { if ($TurnEnabled) { throw 'Rollback must restore the previous no-relay issuer.' } }
$receipt = @{original=@{arguments=$original};keyHash='expected'}
Expect-Rejection { Restore-MainIssuer $receipt }
if ($script:removed -or $null -ne $script:restored) { throw 'Rollback must leave an unexpected key and action untouched.' }
$script:hash = 'expected'
Restore-MainIssuer $receipt
if (!$script:removed -or $script:restored.arguments -cne $original) { throw 'Rollback must remove its own key and restore the original action.' }

$script:removed = $false
$script:restored = $null
$script:disabled = $false
$script:stops = 0
$script:stopIssued = $false
$script:mainHealthy = $true
$originalStopped = $false
$Step = 'Switch'
$taskName = 'fixture Main voice'
function Get-NetTCPConnection { @{OwningProcess=123} }
function Get-ScheduledTask { @{State='Running'} }
function Assert-MainDrained { }
function Disable-ScheduledTask { $script:disabled = $true }
function Enable-ScheduledTask { $script:disabled = $false }
function Stop-ScheduledTask { $script:stops++; throw 'Fixture task did not stop.' }
function Wait-MainVoiceStopped { throw 'Fixture original voice still running.' }
function Clear-ThornswoodHold { throw 'The unresolved stop must retain the hold.' }
$transaction = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })
if ($transaction.Count -ne 1) { throw 'Expected one Main stop and restore transaction.' }
Expect-Rejection { . ([scriptblock]::Create($transaction[0].Extent.Text)) }
if ($script:disabled -or $script:stops -ne 1 -or $script:removed -or $null -ne $script:restored -or $script:mainHealthy) {
    throw 'An uncertain stop must re-enable only the unchanged task, keep its hold, and refuse to edit or restart it.'
}
'7 passed, 0 failed'
