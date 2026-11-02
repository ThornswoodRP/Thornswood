# tests/test-5175-rehearse-on-box.ps1
#
# #5175. scripts\vps\Rehearse-OnBox.ps1, the gate's Rehearse-Restore verb:
# the monthly restore rehearsal on the box with the bot loading the character.
# A rehearsal server has no join pass hold, so what this holds it to is that
# node never starts before the firewall is read, never on a port open to
# anywhere but the box, and that the unpacked world never outlives the run.
#
#   - the firewall rule reader: which inbound Allow rules count as letting a
#     rehearsal port in (run on rule objects, not on a firewall)
#   - the folder rule: only an empty folder or one this script made is cleared
#   - the order: restore, then the firewall, then node, then the bot
#   - the end: node stopped and both folders deleted in finally
#   - the bot runs against 127.0.0.1 and the restore against -Rehearse
#
# pwsh -NoProfile -File tests/test-5175-rehearse-on-box.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $Root 'scripts\vps\Rehearse-OnBox.ps1'
$src = [IO.File]::ReadAllText($path)
$fails = 0; $passes = 0
function Yes([string]$what, [bool]$ok) {
  if ($ok) { $script:passes++; Write-Host "PASS  $what" } else { $script:fails++; Write-Host "FAIL  $what" }
}

# The script's own functions, taken out of it without running it.
$ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
Yes 'the script parses' ($null -ne $ast)
$fns = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($f in $fns) { if ($f.Name -in 'Test-RuleTakes', 'Test-Ours') { . ([scriptblock]::Create($f.Extent.Text)) } }
$Mark = '.thornswood-rehearsal'

function Rule($proto, $ports, $remote, $program = 'Any', $package = '', $service = 'Any') {
  [pscustomobject]@{ Name = 'r'; DisplayName = 'r'; Protocol = $proto; Ports = @($ports); Remote = @($remote); Program = $program; Package = $package; Service = $service }
}
Yes 'a rule for UDP 7800 from anywhere takes the game port' (Test-RuleTakes (Rule 'UDP' '7800' 'Any') 'UDP' 7800)
Yes 'a rule for any protocol and any port takes it' (Test-RuleTakes (Rule 'Any' @() 'Any') 'TCP' 7801)
Yes 'a port range around it takes it' (Test-RuleTakes (Rule 'TCP' '7790-7810' 'Any') 'TCP' 7802)
Yes 'a rule from one outside address still takes it' (Test-RuleTakes (Rule 'UDP' '7800' '203.0.113.5') 'UDP' 7800)
Yes 'a rule for node.exe on every port takes it' (Test-RuleTakes (Rule 'Any' 'Any' 'Any' 'C:\Program Files\nodejs\node.exe') 'UDP' 7800)
Yes 'the dev game rule, UDP 7787, does not' (-not (Test-RuleTakes (Rule 'UDP' '7787' 'Any') 'UDP' 7800))
Yes 'a TCP rule does not take a UDP port' (-not (Test-RuleTakes (Rule 'TCP' '7800' 'Any') 'UDP' 7800))
Yes 'a rule only from 127.0.0.1 does not' (-not (Test-RuleTakes (Rule 'UDP' '7800' '127.0.0.1') 'UDP' 7800))
Yes 'a rule for another program does not' (-not (Test-RuleTakes (Rule 'Any' 'Any' 'Any' 'C:\Windows\System32\svchost.exe') 'UDP' 7800))
Yes 'a rule bound to a Store app does not' (-not (Test-RuleTakes (Rule 'Any' 'Any' 'Any' 'Any' 'S-1-15-2-1') 'UDP' 7800))
Yes 'a rule for one service does not' (-not (Test-RuleTakes (Rule 'Any' 'Any' 'Any' 'Any' '' 'Dhcp') 'UDP' 7800))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('t5175-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $empty = Join-Path $tmp 'empty'; New-Item -ItemType Directory -Path $empty | Out-Null
  $mine = Join-Path $tmp 'mine'; New-Item -ItemType Directory -Path $mine | Out-Null; Set-Content (Join-Path $mine $Mark) 'x'
  $rh = Join-Path $tmp 'rh'; New-Item -ItemType Directory -Path $rh | Out-Null; Set-Content (Join-Path $rh 'rehearsal.json') '{}'
  $other = Join-Path $tmp 'other'; New-Item -ItemType Directory -Path $other | Out-Null; Set-Content (Join-Path $other 'notes.txt') 'x'
  Yes 'a missing folder may be cleared' (Test-Ours (Join-Path $tmp 'none'))
  Yes 'an empty folder may be cleared' (Test-Ours $empty)
  Yes 'a folder with the mark may be cleared' (Test-Ours $mine)
  Yes 'a folder with rehearsal.json may be cleared' (Test-Ours $rh)
  Yes 'a folder holding anything else may not' (-not (Test-Ours $other))
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force }

function At([string]$s) { return $src.IndexOf($s) }
$restore = At "Join-Path `$Here 'Restore-Server.ps1'"
$wall = At "Step '5. the firewall"
$start = At 'Start-Process -FilePath $nodeExe'
$bot = At '$out7 = & $nodeExe $check'
$fin = At 'finally {'
Yes 'the order is restore, firewall, node, bot' ($restore -gt 0 -and $restore -lt $wall -and $wall -lt $start -and $start -lt $bot)
Yes 'the restore is a rehearsal held to the profile id' ($src -match "Restore-Server\.ps1'\) -Backup \`$Backup -Root \`$Root -Which \`$Which -KeyFile \`$KeyFile -Expect \`$ProfileId -Work \`$Work -Rehearse")
Yes 'it needs RESTORE OK and REHEARSAL READY before it goes on' ($src -match "notmatch 'RESTORE OK'" -and $src -match "notmatch 'REHEARSAL READY'")
Yes 'it stops when door.json is still there' ($src -match "private\\door\.json'\)\) \{ Fail")
Yes 'every firewall profile must be on and block inbound' ($src -match "DefaultInboundAction -ne 'Block'" -and $src -match "Enabled -ne 'True'")
Yes 'the firewall is read from the active store, enabled Allow rules only' ($src -match 'Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Action Allow -Enabled True')
Yes 'it checks the game port on UDP and TCP, resources and voice on TCP' ($src -match "@\('UDP', \`$rh\.port\), @\('TCP', \`$rh\.port\), @\('TCP', \`$rh\.resources\), @\('TCP', \`$rh\.voicePort\)")
Yes 'the bot runs against 127.0.0.1 on the rehearsal port' ($src -match '--host 127\.0\.0\.1 --port \(\[string\]\$rh\.port\)')
Yes 'a pass needs CHARACTER CHECK OK' ($src -match "notmatch 'CHARACTER CHECK OK'")
$tail = $src.Substring($fin)
Yes 'finally stops node and deletes both folders' ($fin -gt $bot -and $tail -match 'Stop-Rehearsal' -and $tail -match 'foreach \(\$d in \$Root, \$Work\)' -and $tail -match 'Remove-Item -LiteralPath \$d -Recurse -Force')
Yes 'a server folder is never -Root or -Work' ($src -match "C:\\Thornswood-Server-Dev'" -and $src -match '-Root and -Work are never a server folder')
Yes 'it never writes RESTORING.md or the Last rehearsed line' ($src -notmatch 'Set-Content[^\n]*RESTORING' -and $src -notmatch 'Last rehearsed:')
Yes 'the backup key is never printed' ($src -notmatch 'Get-Content[^\n]*\$KeyFile')

# 1 Nov 2026, the first run on the box: $script:Node and $node were one
# variable (PowerShell names are not case sensitive), so step 8 called
# WaitForExit on the node path and threw before the folders were deleted.
$vars = @{}
foreach ($v in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.VariableExpressionAst] }, $true)) {
  $n = $v.VariablePath.UserPath -replace '^script:', ''
  $k = $n.ToLowerInvariant()
  if (-not $vars.ContainsKey($k)) { $vars[$k] = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal) }
  [void]$vars[$k].Add($n)
}
$twice = @($vars.Keys | Where-Object { $vars[$_].Count -gt 1 })
Yes 'no variable is spelled two ways, which PowerShell would take as one' ($twice.Count -eq 0)
Yes 'the server process is $script:Server and the node path $nodeExe' ($src -match '\$script:Server = Start-Process -FilePath \$nodeExe' -and $src -notmatch '\$script:Node =')
Yes 'step 8 stops node only when it holds a process' ($src -match '\$script:Server -is \[Diagnostics\.Process\]')
Yes 'step 8 stops node inside its own try, so the folders are deleted whatever it throws' ($tail -match 'try \{ Stop-Rehearsal \} catch')

# The character counters read hex names (#5168): the engine names a runtime
# form with FormDesc::ToString, %x, so slot 10 is a.json.
$rs = Join-Path $Root 'scripts\vps\Restore-Server.ps1'
$rast = [Management.Automation.Language.Parser]::ParseFile($rs, [ref]$null, [ref]$null)
$people = $rast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'People' }, $false) | Select-Object -First 1
. ([scriptblock]::Create($people.Extent.Text))
$nb = Join-Path $Root 'scripts\vps\vps-nightly-backup.ps1'
$nast = [Management.Automation.Language.Parser]::ParseFile($nb, [ref]$null, [ref]$null)
$count = $nast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'People' }, $false) | Select-Object -First 1
$countText = $count.Extent.Text -replace '^function People', 'function Count-People'
. ([scriptblock]::Create($countText))
$w = Join-Path ([IO.Path]::GetTempPath()) ('t5168-' + [Guid]::NewGuid().ToString('N'))
$cf = Join-Path $w 'game-dev\changeForms'
New-Item -ItemType Directory -Path $cf -Force | Out-Null
try {
  Set-Content (Join-Path $cf '3.json') '{"profileId": 111}'
  Set-Content (Join-Path $cf '1f.json') '{"profileId": 1909688825}'
  Set-Content (Join-Path $cf 'a.json') '{"profileId": -1, "isDeleted": true}'
  Set-Content (Join-Path $cf 'b.json') '{"profileId": -1, "recType": 1}'
  Set-Content (Join-Path $cf '1a2b_Skyrim.esm.json') '{"profileId": 5151}'
  $got = @(People (Join-Path $w 'game-dev'))
  Yes 'Restore-Server counts a character whose file name has a letter (1f.json)' (@($got | ForEach-Object { $_.Id }) -contains 1909688825)
  Yes '  and the digit one, and nothing else: no NPC, no deleted slot, no placed form' ($got.Count -eq 2 -and (@($got | ForEach-Object { $_.Id }) -contains 111))
  Yes '  in slot order, read as hex' ($got[0].File.Name -eq '3.json' -and $got[1].File.Name -eq '1f.json')
  Yes '  and counts the deleted slot alone as deleted, not the NPC' ($script:deleted -eq 1)
  $stage = $w
  Yes 'the nightly backup counts the same two people' ((Count-People 'game-dev') -eq 2)
} finally { Remove-Item -LiteralPath $w -Recurse -Force }

Write-Host ''
Write-Host "$passes passed, $fails failed"
if ($fails) { exit 1 }
