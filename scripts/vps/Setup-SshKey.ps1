<#
  Setup-SshKey.ps1

  Sets a PC up to reach the box over ssh, through the bridge, with a key and
  a token of its own (#2891). Every script that touches the box shells out
  to ssh and scp; after this they all go through, with no password and
  nothing typed.

      .\scripts\vps\Setup-SshKey.ps1          set it up, or finish setting it up
      .\scripts\vps\Setup-SshKey.ps1 -Test    only check, change nothing
      .\scripts\vps\Setup-SshKey.ps1 -NewBox  a box with no bridge yet (a move,
                                             MOVING-THE-SERVER.md in the ops repo)

  HOW IT GETS IN. Port 22 on the box takes no outside address, so a home
  address that changes stops nothing. ssh goes inside a WebSocket on 443
  instead: connect.js, as ssh's ProxyCommand, opens
  wss://thornswood.net/box/ with this PC's token, Caddy hands it to the
  bridge on the box, and the bridge joins it to the box's own sshd. sshd
  then takes this PC's key, which the box accepts only through the bridge.
  The person's guide is the ops repo's BOX-ACCESS.md.

  IN ORDER, each step skipped when it is already done, so it is run again
  until the last one passes:
    1. The key, .ssh\thornswood_ed25519, made here with no passphrase. Its
       private half never leaves this PC.
    2. The bridge client (connect.js and the two files it needs), copied to
       .ssh\thornswood-bridge, and a Host block for the box in .ssh\config
       that sends ssh through it (Set-ThornswoodBridgeSsh in Vps.ps1).
    3. The token, which Patrick makes for this PC with Grant-BoxAccess.ps1
       from the public key line this prints. It is asked for here, typed or
       pasted where nothing shows it, and kept in .ssh\thornswood-box-token,
       readable by this account only. Enter alone stops here until it comes.
    4. The box's own key, asked for through the bridge and written into
       known_hosts only when scripts\vps\vps.json pins it (issue #450).
    5. A login, which proves all of it.

  -NEWBOX. A new box has no bridge and still takes the Administrator
  password on port 22, so the first key goes on that way: ssh asks for the
  password once, on the line below where it says so, and nothing here reads
  it. The Host block it writes goes straight to port 22. Then
  Install-Bridge.ps1, and Grant-BoxAccess.ps1 -Name one -ThisMachine, which
  writes the bridge block over this one. A box that takes no password
  (Harden-VPS.ps1 has run) refuses it, and the console is the way in.

  NEEDS: the OpenSSH Client (Windows ships it: Settings, Apps, Optional
  features) and node (https://nodejs.org, the LTS), both on PATH.
#>
[CmdletBinding()]
param(
    [string]$VpsHost = '',
    [string]$VpsUser = '',
    [string]$KeyPath,
    [switch]$Test,
    [switch]$NewBox,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

$target = "$VpsUser@$VpsHost"
if (-not $KeyPath) { $KeyPath = Join-Path (Join-Path $HOME '.ssh') 'thornswood_ed25519' }
$tokenPath = Get-ThornswoodBridgeTokenPath

foreach ($t in 'ssh', 'ssh-keygen', 'ssh-keyscan') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client."
    }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'node is not on PATH, and the bridge client is node. Install the LTS from https://nodejs.org, open a new PowerShell, and run this again.' }

function Works {
    # BatchMode means ssh fails rather than falling back to asking, so this is
    # a real answer about the key instead of a prompt.
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 $target 'echo THORNSWOOD_OK' } 2>&1 | ForEach-Object { "$_" })
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = (($out -join '') -match 'THORNSWOOD_OK'); Out = $out }
}

function SayPublicLine([string]$why) {
    Head 'Send this line to Patrick'
    Say "  $why" 'DarkGray'
    Say '  It is the public half of the key, safe to paste anywhere; only this PC holds the private half.' 'DarkGray'
    Write-Host ''
    Write-Host ((Get-Content -LiteralPath "$KeyPath.pub" -Raw).Trim()) -ForegroundColor White
}

Write-Host ''
Write-Host '  THORNSWOOD  -  ssh to the box through the bridge' -ForegroundColor White
Say "  $target" 'DarkGray'

if ($Test) {
    Head 'Checking'
    Say ('  key:          ' + $(if (Test-Path -LiteralPath "$KeyPath.pub") { $KeyPath } else { 'none yet' }))
    Say ('  bridge:       ' + $(if (Test-ThornswoodBridgeSsh $VpsHost) { 'ssh to the box goes through it' } else { 'ssh to the box does NOT go through it' }))
    Say ('  token:        ' + $(if (Test-Path -LiteralPath $tokenPath) { $tokenPath } else { 'none yet' }))
    Say ('  known_hosts:  ' + (Test-ThornswoodKnownHost -Address $VpsHost).Status)
    $w = Works
    if ($w.Ok) { Say '  ssh to the box works' 'Green'; Done 0 }
    Say '  ssh to the box does not work yet:' 'Yellow'
    $w.Out | Select-Object -Last 5 | ForEach-Object { Say "    $_" 'DarkGray' }
    Done 1
}

# ------------------------------------------------------------------- key ----
Head '1. The key'
$dir = Split-Path $KeyPath -Parent
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
if (Test-Path -LiteralPath "$KeyPath.pub") {
    Say "  using the one already at $KeyPath" 'DarkGray'
} else {
    # No passphrase on purpose. A passphrase here would mean typing something
    # every time a script runs ssh. The key only opens this one box, and only
    # with this PC's token as well.
    #
    # Handing ssh-keygen an EMPTY argument through PowerShell is genuinely
    # awkward: '""' works in some versions and arrives as two literal quote
    # characters in others, and the failure is a key with a passphrase on it
    # rather than an error. So rather than bet on one spelling, try them and
    # check what actually came out.
    $made = $false
    foreach ($empty in '""', '') {
        Remove-Item -LiteralPath $KeyPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$KeyPath.pub" -Force -ErrorAction SilentlyContinue
        $old = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        Invoke-ThornswoodNative { & ssh-keygen -t ed25519 -N $empty -C 'thornswood' -f $KeyPath } 2>&1 | Out-Null
        $ErrorActionPreference = $old
        if (-not (Test-Path -LiteralPath "$KeyPath.pub")) { continue }

        # And prove it opens without one, because a key that needs a passphrase
        # would put a prompt in front of every script.
        $ErrorActionPreference = 'Continue'
        $null = Invoke-ThornswoodNative { & ssh-keygen -y -P '' -f $KeyPath } 2>&1
        $ok = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $old
        if ($ok) { $made = $true; break }
    }
    if (-not $made) {
        Die ('Could not make a key without a passphrase. Do it by hand, press Enter twice when it asks:' + [Environment]::NewLine +
             '    ssh-keygen -t ed25519 -f "' + $KeyPath + '"' + [Environment]::NewLine +
             'then run this again.')
    }
    Say "  made $KeyPath" 'Green'
}

# ---------------------------------------------------------------- new box ---
if ($NewBox) {
    Head "2. The box's own key"
    try { $n = Add-ThornswoodKnownHost -Address $VpsHost }
    catch { Die $_.Exception.Message }
    Say $(if ($n) { "  added $n pinned key line(s) to known_hosts" } else { '  known_hosts holds the pinned key' }) 'Green'

    Head '3. Putting the key on the box'
    Say '  ssh will ask for the Administrator password now, once.' 'Yellow'
    $pub = (Get-Content -LiteralPath "$KeyPath.pub" -Raw).Trim()
    $remote = @"
`$ErrorActionPreference = 'Stop'
# Progress records come back as a wall of CLIXML when stdout is not a console.
`$ProgressPreference = 'SilentlyContinue'
`$f = 'C:\ProgramData\ssh\administrators_authorized_keys'
`$key = '$pub'
if (-not (Test-Path -LiteralPath (Split-Path `$f -Parent))) { New-Item -ItemType Directory -Path (Split-Path `$f -Parent) -Force | Out-Null }
`$have = @()
if (Test-Path -LiteralPath `$f) { `$have = @(Get-Content -LiteralPath `$f | Where-Object { `$_.Trim() }) }
if (`$have -notcontains `$key) { `$have += `$key }
# No byte order mark and no UTF16: sshd reads this as plain ASCII and silently
# ignores a file it cannot parse, which looks exactly like a wrong key.
[IO.File]::WriteAllLines(`$f, [string[]]`$have, (New-Object Text.UTF8Encoding(`$false)))
icacls `$f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
# The server has to be running for any of this to matter, and it has to be
# restarted before a permissions change is picked up.
Set-Service sshd -StartupType Automatic
Restart-Service sshd
'installed ' + `$have.Count + ' key(s)'
"@
    $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))
    # The Windows PowerShell a new Windows Server comes with: this is the
    # first thing done on a new box, before Bootstrap-VPS.ps1 puts PowerShell
    # 7 there, so it is the only PowerShell the box has yet. Everything after
    # it runs in pwsh (#5356).
    Invoke-ThornswoodNative { & ssh -o StrictHostKeyChecking=yes $target "powershell -NoProfile -EncodedCommand $b64" }
    if ($LASTEXITCODE -ne 0) { Die "that did not go through (ssh exited with $LASTEXITCODE). Nothing was changed here. Permission denied means this box takes no password: the VNC console is the way in." }
    try { $null = Set-ThornswoodBridgeSsh -Address $VpsHost -User $VpsUser -KeyPath $KeyPath -Direct } catch { Die $_.Exception.Message }
    Say "  ssh to $VpsHost goes straight to port 22 for now (.ssh\config)" 'Green'
    Start-Sleep -Seconds 2
    $w = Works
    if (-not $w.Ok) { $w.Out | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }; Die 'the key went up but the box does not take it yet. The lines above say why.' }
    Say "  ssh $target works. Next: .\scripts\deploy\Install-Bridge.ps1, then .\scripts\vps\Grant-BoxAccess.ps1 -Name one -ThisMachine." 'Green'
    Done 0
}

# ---------------------------------------------------------------- bridge ----
Head '2. ssh through the bridge'
try {
    $client = Install-ThornswoodBridgeClient (Join-Path $Here 'bridge')
    $null = Set-ThornswoodBridgeSsh -Address $VpsHost -User $VpsUser -KeyPath $KeyPath -Node $node.Source -Connect (Join-Path $client 'connect.js')
} catch { Die $_.Exception.Message }
Say "  the client is in $client" 'Green'
Say "  ssh to $VpsHost goes through it (.ssh\config)" 'Green'

# ----------------------------------------------------------------- token ----
Head '3. The token'
if (Test-Path -LiteralPath $tokenPath) {
    Say "  using the one in $tokenPath" 'DarkGray'
} else {
    SayPublicLine 'Patrick puts it on the box with Grant-BoxAccess.ps1 and sends you a token for this PC.'
    Write-Host ''
    # Read where nothing shows it, so it is in no history and on no screen.
    $sec = Read-Host -AsSecureString '  Paste the token he sent (Enter alone if it has not come yet)'
    $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
    if (-not $token) { Say '  No token yet. Run this again once it comes; the steps above are kept.' 'Yellow'; Done 0 }
    if (-not (Test-ThornswoodBridgeToken $token)) { Die 'That is not a whole token: it is one run of 43 letters, digits, - and _. Paste it again; nothing was kept.' }
    Write-ThornswoodPrivateFile -Path $tokenPath -Text $token
    $token = $null
    Say "  kept in $tokenPath, readable by this account only" 'Green'
}

# ------------------------------------------------------------- host key ----
Head "4. The box's own key"
try { $n = Add-ThornswoodKnownHostThroughBridge -Address $VpsHost -Node $node.Source -Listen (Join-Path $client 'listen.js') }
catch { Die $_.Exception.Message }
if ($n) { Say "  added $n pinned key line(s) to known_hosts" 'Green' }
else { Say ('  known_hosts holds the pinned key') 'Green' }

# ----------------------------------------------------------------- login ----
Head '5. Logging in'
$w = Works
if ($w.Ok) {
    Say "  ssh $target works. Every script that talks to the box goes through now." 'Green'
    Done 0
}
$w.Out | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }
if (($w.Out -join ' ') -match 'Permission denied') {
    SayPublicLine 'The bridge let this PC in, but the box does not hold its key. Patrick runs Grant-BoxAccess.ps1 with this line.'
} elseif (($w.Out -join ' ') -match 'refused this token') {
    Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
    Say '  The box does not hold that token (it was replaced or taken away), so it was deleted here. Ask Patrick for a new one and run this again.' 'Yellow'
}
Die 'ssh to the box did not get in. The lines above say why: a "box bridge:" line is the bridge, Caddy or the token; "Permission denied" is the key.'
