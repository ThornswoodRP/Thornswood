<#
  Grant-BoxKey.ps1

  Gives one machine its own Administrator key to the box, from the cloud and
  with no step on One, when the key is one main carries. The deploy gate's
  verb Grant-BoxKey runs it, as SYSTEM:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Grant-BoxKey -Name oracle-hermes'

  Made for Patrick's own Hermes on the Oracle VM (Patrick, 10 Nov 2026: B on
  the report page's q-oracle-box-access, an Administrator key, made on the
  VM). Until now only Grant-BoxAccess.ps1, run on One, put a key on the box.

  THE KEY IS MAIN'S. Its name is all the line gives. What goes on the box is
  scripts\vps\box-keys\<name>.json in the checkout the gate has just fetched
  from main: the public half of the key and the SHA-256 of its bridge token,
  the only form of a token the box keeps (bridge.js). Neither is a secret.
  The machine that holds the key made both halves and the token itself, and
  they never left it (TWHermesAgents deploy/install.sh, 6b, puts the public
  ones on the ops ledger). So a key reaches the box only through a reviewed
  merge to main, as the box's drop key reaches the VM through one to
  TWHermesAgents; whoever can ask the gate can only put main's key back.

  WHAT IT TOUCHES, and nothing more:
    - lines named thornswood-<name> in administrators_authorized_keys, which
      it replaces with the one line
          from="127.0.0.1" ssh-ed25519 <key> thornswood-<name>
      (Grant-BoxAccess.ps1's Get-BoxKeyLine: taken only from the box itself,
      so only through the bridge); no other line changes by a byte;
    - the token digest file tokens\<name> in the bridge's folder.
  It stops, changing nothing, for a name that is One's, the cloud's or a
  workflow's (one, cloud, desk, claude), for a key the box already holds
  under another name or in the deploy account's file, when the put back of a
  Grant-BoxAccess.ps1 run is armed, and when the file read back is not what
  it wrote, which puts the key file and token back byte for byte.

  THE PROOF is the holder's login: on the VM, the next install's line on the
  ledger says "login: ok". This holds no private half, so it cannot log in.
  It does prove that ssh-keygen reads the new line as sshd would.

  Taking a key away is Grant-BoxAccess.ps1 -Name <name> -Remove on One, and
  the json comes out of main with it.

  PowerShell 7 (the gate runs its verbs with it).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$BridgeRoot = 'C:\Thornswood-Bridge',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

$PutBack = 'Thornswood box access put back'
$GateUser = 'thornswood-deploy'
# Names other ways in hold, which this never touches.
$Reserved = @('one', 'cloud', 'desk', 'claude')

# The line on the box, as Grant-BoxAccess.ps1's Get-BoxKeyLine makes it for
# a plain key (tests\test-2841-deploy-gate.ps1 holds the two equal).
function Get-KeyLine([string]$Bare, [string]$Who) { return ('from="127.0.0.1" ' + $Bare + ' thornswood-' + $Who) }
# The lines of a file named thornswood-<who>, or holding the key.
function Select-Named([string[]]$Lines, [string]$Who) { @($Lines | Where-Object { (' ' + $_.Trim() + ' ').EndsWith(' thornswood-' + $Who + ' ') }) }
function Select-Holding([string[]]$Lines, [string]$Blob) { @($Lines | Where-Object { (' ' + $_.Trim() + ' ').Contains(' ' + $Blob + ' ') }) }
# main's record for a name: its public key line and token digest, each in its one form.
function Read-KeyRecord([string]$Path, [string]$Who) {
    $r = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ([string]$r.name -cne $Who) { throw "it names $($r.name), not $Who" }
    if ([string]$r.public -cnotmatch '^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$') { throw 'its public is not an ed25519 public key line with no comment' }
    if ([string]$r.token_sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'its token_sha256 is not 64 lower case hex characters' }
    return $r
}

# ------------------------------------------------------------- what came --
if ($Name -cnotmatch '^[a-z0-9][a-z0-9-]{0,31}$') { Die 'the name is one lower case word: oracle-hermes. Nothing was changed.' }
if ($Reserved -ccontains $Name) { Die "$Name is a way in this never touches (One's, the cloud's or a workflow's); Grant-BoxAccess.ps1 on One is how it changes. Nothing was changed." }
$recordPath = Join-Path (Join-Path $Here 'box-keys') ($Name + '.json')
if (-not (Test-Path -LiteralPath $recordPath)) { Die "main carries no scripts/vps/box-keys/$Name.json, so there is no key of that name to put on the box. Nothing was changed." }
try { $rec = Read-KeyRecord $recordPath $Name } catch { Die ("scripts/vps/box-keys/$Name.json is not one this takes: " + $_.Exception.Message + '. Nothing was changed.') }
$bare = [string]$rec.public
$blob = ($bare -split ' ')[1]
$digest = [string]$rec.token_sha256
if ($env:THORNSWOOD_GATE -ne '1') { Die 'this runs on the box through the deploy gate: pwsh scripts/vps/Box-Run.ps1 -Line ''Grant-BoxKey -Name <name>''. Nothing was changed.' }
if (Get-ScheduledTask -TaskName $PutBack -ErrorAction SilentlyContinue) { Die "the put back of a Grant-BoxAccess.ps1 run is still armed ('$PutBack'), and it would put an older key file back over this change. Run this again once it has run or been cancelled. Nothing was changed." }

# ------------------------------------------------------------- the files --
$KeysFile = 'C:\ProgramData\ssh\administrators_authorized_keys'
if (-not (Test-Path -LiteralPath $KeysFile)) { Die "$KeysFile is not there. Nothing was changed." }
$Tokens = Join-Path $BridgeRoot 'tokens'
if (-not (Test-Path -LiteralPath (Join-Path $BridgeRoot 'bridge.js')) -or -not (Test-Path -LiteralPath $Tokens)) { Die "there is no bridge with a tokens folder in $BridgeRoot, and the key comes only through it. Nothing was changed." }
$TokenFile = Join-Path $Tokens $Name
$have = @([IO.File]::ReadAllLines($KeysFile) | Where-Object { $_.Trim() })
$deploy = @()
$gu = Get-LocalUser -Name $GateUser -ErrorAction SilentlyContinue
if ($gu) {
    $pl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $gu.SID.Value
    if (Test-Path -LiteralPath $pl) {
        $dk = Join-Path (Get-ItemProperty -LiteralPath $pl).ProfileImagePath '.ssh\authorized_keys'
        if (Test-Path -LiteralPath $dk) { $deploy = @([IO.File]::ReadAllLines($dk) | Where-Object { $_.Trim() }) }
    }
}
$mine = Select-Named $have $Name
$elsewhere = @(@(Select-Holding $have $blob | Where-Object { $mine -notcontains $_ }) + @(Select-Holding $deploy $blob))
if ($elsewhere.Count) { Die 'that key is already on the box under another name, and a key is never on the box twice with different rules. Nothing was changed.' }
$newLine = Get-KeyLine $bare $Name
$print = Get-ThornswoodSshFingerprint ('x ' + $bare)
foreach ($l in $mine) { Say ('  now   ' + (Get-ThornswoodSshFingerprint ('x ' + [regex]::Match($l, 'ssh-ed25519 [A-Za-z0-9+/=]+').Value)) + "  thornswood-$Name") }
if ($mine.Count -eq 1 -and $mine[0].Trim() -ceq $newLine -and (Test-Path -LiteralPath $TokenFile) -and ([IO.File]::ReadAllText($TokenFile)).Trim() -ceq $digest) {
    Say "  thornswood-$Name is $print, main's key, and its token is main's: nothing to change" 'Green'
    exit 0
}

# ------------------------------------------------------------- the change --
$before = [IO.File]::ReadAllBytes($KeysFile)
$tokenBefore = if (Test-Path -LiteralPath $TokenFile) { [IO.File]::ReadAllBytes($TokenFile) } else { $null }
$utf8 = New-Object Text.UTF8Encoding($false)
$changed = $false
$done = $false
try {
    # ssh-keygen must read the line as sshd would before it goes in.
    if (-not (Get-ThornswoodSshFingerprint $newLine)) { Die 'ssh-keygen did not read the new line. Nothing was changed.' }

    Head "$Name's key"
    $others = @($have | Where-Object { $mine -notcontains $_ })
    # In place, so the file keeps its own access rules; no byte order mark,
    # which sshd would not read past.
    [IO.File]::WriteAllLines($KeysFile, [string[]](@($others) + $newLine), $utf8)
    $changed = $true
    [IO.File]::WriteAllText($TokenFile, $digest, $utf8)

    # Read back: every other line as it was, and this name's as main has it.
    $now = @([IO.File]::ReadAllLines($KeysFile) | Where-Object { $_.Trim() })
    if ((@($now | Where-Object { $_ -cne $newLine }) -join "`n") -cne ($others -join "`n")) { Die "$KeysFile does not read back with every other line as it was. It is put back as it was." }
    $nowMine = Select-Named $now $Name
    if ($nowMine.Count -ne 1 -or $nowMine[0] -cne $newLine) { Die "$KeysFile does not read back with main's line alone for thornswood-$Name. It is put back as it was." }
    if (([IO.File]::ReadAllText($TokenFile)).Trim() -cne $digest) { Die "the token file for $Name does not read back as written. It is put back as it was." }
    $done = $true
    Say ('  ' + $mine.Count + ' line(s) off; thornswood-' + $Name + " is $print, as Administrator, only through the bridge") 'Green'
    Say "  its token's SHA-256 is in the bridge's tokens as $Name" 'Green'
    Say ''
    Say "  The holder proves it: a login from that machine (for oracle-hermes, the VM's next install says login: ok on the ops ledger)." 'White'
}
finally {
    if ($changed -and -not $done) {
        [IO.File]::WriteAllBytes($KeysFile, $before)
        if ($null -ne $tokenBefore) { [IO.File]::WriteAllBytes($TokenFile, $tokenBefore) } else { Remove-Item -LiteralPath $TokenFile -Force -ErrorAction SilentlyContinue }
    }
}
exit 0
