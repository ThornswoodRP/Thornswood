<#
  Vps.ps1

  The one place every script gets the VPS address, user, and ports from.
  Dot-source it under Stop, so a copy without it ends on the load instead of
  going on with no address (#3006, tests\test-3006-loads-under-stop.ps1):

      $ErrorActionPreference = 'Stop'
      . (Join-Path $PSScriptRoot '..\vps\Vps.ps1')

  Then, after the param block:

      if (-not $User) { $User = Get-ThornswoodVpsUser }
      if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

  An explicit -Vps or -User on the command line still wins, because the param
  keeps whatever was passed; only an empty default is filled from here.

  WHERE THE ANSWER COMES FROM, last one wins (issue #459):

    1. scripts\vps\vps.json, tracked, the box everybody uses.
    2. This machine's own file, never tracked:
       %LOCALAPPDATA%\Thornswood\vps.json, or the file THORNSWOOD_VPS_LOCAL
       names. Any field in it replaces the same field from the tracked one,
       so {"address": "203.0.113.9"} on its own points this machine at
       another box and keeps the rest.
    3. The environment: THORNSWOOD_VPS for the address, THORNSWOOD_VPS_USER
       for the user. For one shell or one scheduled task.

  So a machine that reaches the box by another address, or a new box being
  set up before its name points at it (docs\MOVING-THE-SERVER.md, step 3),
  needs no edit to a tracked file. The tracked address is the game's name,
  never the box's address (#3690).
  tests\test-vps-defaults.ps1 fails on the address written anywhere else in a
  script.
#>

function Get-ThornswoodVps {
    $j = Get-ThornswoodVpsCommitted
    $local = Get-ThornswoodVpsLocalPath
    if ($local -and (Test-Path -LiteralPath $local)) {
        $mine = $null
        try { $mine = Get-Content -LiteralPath $local -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
        if (-not ($mine -is [Management.Automation.PSCustomObject])) { throw "This machine's VPS file does not read as a JSON object: $local" }
        foreach ($p in $mine.PSObject.Properties) { $j | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force }
    }
    if ($env:THORNSWOOD_VPS) { $j | Add-Member -NotePropertyName address -NotePropertyValue ([string]$env:THORNSWOOD_VPS) -Force }
    if ($env:THORNSWOOD_VPS_USER) { $j | Add-Member -NotePropertyName user -NotePropertyValue ([string]$env:THORNSWOOD_VPS_USER) -Force }
    if (-not $j.address) { throw "vps.json has no address: $path" }
    return $j
}

# vps.json as the checkout holds it, with no machine's own file and no
# environment over it. Say-Staff.ps1 -OnTheBox takes the pins and the user
# from this alone: on a runner, a machine's own file is whatever an earlier
# job on the same account left (#3045).
function Get-ThornswoodVpsCommitted {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $path = Join-Path $here 'vps.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "VPS defaults not found: $path"
    }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

# This machine's own VPS file, which nothing in git carries. It need not exist.
function Get-ThornswoodVpsLocalPath {
    if ($env:THORNSWOOD_VPS_LOCAL) { return [string]$env:THORNSWOOD_VPS_LOCAL }
    if (-not $env:LOCALAPPDATA) { return '' }
    return (Join-Path (Join-Path $env:LOCALAPPDATA 'Thornswood') 'vps.json')
}

function Get-ThornswoodVpsAddress {
    return [string](Get-ThornswoodVps).address
}

function Get-ThornswoodVpsUser {
    $u = [string](Get-ThornswoodVps).user
    if (-not $u) { $u = 'Administrator' }
    return $u
}

# ------------------------------------------------------ ssh and scp -----
# Every ssh, scp, ssh-keygen and ssh-keyscan a script runs goes through this:
#
#     $out = Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" $cmd } 2>&1
#     $wire | Invoke-ThornswoodNative { $input | & ssh @ssh $target $cmd } 2>&1
#
# so a line the program writes on stderr is never an error by itself, and
# whether it worked is its exit code ($LASTEXITCODE), the same in Windows
# PowerShell 5.1 and PowerShell 7. Issue #941: from 28 September the box's
# OpenSSH (9.5) made the client here print "** WARNING: connection is not
# using a post-quantum key exchange algorithm" on stderr for every
# connection, until the box moved to OpenSSH 10.4 on 26 Oct 2026 (#1043). Under Windows PowerShell 5.1 a native program's stderr line
# becomes an error record whenever stderr is redirected (2>&1, 2>$null, or a
# caller that redirected the whole script), and with $ErrorActionPreference
# = 'Stop', which every script here sets, the first one stops the script.
# PowerShell 7 never does that, which is why Ship still worked and
# Install-Voice.ps1 under powershell.exe did not.
#
# Inside this function the preference is Continue, for the call in the block
# and nothing else, so the stderr lines still come out as they always did: in
# the pipeline as error records under 2>&1 (Where-Object { $_ -is [string] }
# still drops them, [string]$_ still reads them), gone under 2>$null, and on
# the screen with no redirection. A real failure is still a failure: ssh and
# scp exit non-zero (255 when they cannot connect), and the caller reads
# $LASTEXITCODE as before. Keep the block to the one native call, so nothing
# else in a script is softened. tests\test-ssh-stderr.ps1 runs a stand-in ssh
# that prints the warning, under both PowerShells.
#
# A plain function on purpose: an advanced one (with [Parameter]) refuses
# pipeline input it has no parameter for, and the secret goes in by pipe.
function Invoke-ThornswoodNative($ThornswoodNativeCall) {
    if (-not ($ThornswoodNativeCall -is [scriptblock])) { throw 'Invoke-ThornswoodNative takes a script block: { & ssh ... }' }
    $ErrorActionPreference = 'Continue'
    if ($MyInvocation.ExpectingInput) { $input | & $ThornswoodNativeCall }
    else { & $ThornswoodNativeCall }
}

# ------------------------------------------------------- from outside ----
# Whether a port on the box answers from this machine: ONE try (#2975, the
# shape #2961 gave Install-Voice). Publish-Server and Deploy-Server ask the
# resources port this way once the box has said the new server answers on
# both its ports from 127.0.0.1. Until 21 Oct 2026 each tried up to 30 (or
# 10) times two seconds apart, which waited for nothing: the server listens
# on every address with one socket (skymp5-server ui.ts listens on the port
# with no host), so the socket the box found is the one outside reaches, and
# the inbound rules for 3000 and 7788 are standing rules made when the box was
# set up, not by an install. Measured on the box that day: 3000 and 7788 each
# listened on :: (one node process each), and their allow rules were there
# with remote Any. Nothing changes between the box's answer and this try, so
# a second try can only say what the first said.
#
# The try gets 5 s so TCP's own resends of a lost SYN (at 1 s and 3 s) are
# inside it. It says what it got: answered, refused (an answer from the box:
# nothing takes connections there), silent, or why it could not try (a name
# that does not resolve has not looked, so that is not called shut).
function Get-ThornswoodPortTry([string]$Address, [int]$Port) {
    $c = New-Object Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect($Address, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(5000)) { return 'silent for 5 s' }
        $c.EndConnect($ar)
        return 'answered'
    } catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        if ($e -is [Net.Sockets.SocketException] -and $e.SocketErrorCode -eq 'ConnectionRefused') { return 'refused' }
        return 'not tried: ' + $e.Message
    } finally { $c.Close() }
}

# A port that did not answer is only a fault if this machine reaches the
# box's raw ports at all. A cloud thread's container reaches nothing but
# HTTPS, through its proxy (3000, 7788 and 7789 were all silent for 5 s from
# one, 21 Oct 2026), so from there every raw port is silent whatever the box
# does. -Witness is another port on the box that answers everybody (the other
# server's resources port): when it is silent too, this port was not measured
# from here, and NotKnown says why. Answered, Said (what the try got) and
# NotKnown (empty when the try was a measurement) come back.
function Test-ThornswoodFromOutside([string]$Address, [int]$Port, [int]$Witness) {
    $said = Get-ThornswoodPortTry $Address $Port
    $notKnown = ''
    if ($said -like 'not tried: *') { $notKnown = 'it could not be tried: ' + $said.Substring(11) }
    elseif ($said -ne 'answered') {
        $w = Get-ThornswoodPortTry $Address $Witness
        if ($w -ne 'answered') { $notKnown = "this machine reaches no raw port on the box: $Witness, which answers everybody, was $w as well" }
    }
    [pscustomobject]@{ Answered = ($said -eq 'answered'); Said = $said; NotKnown = $notKnown }
}

# ------------------------------------------------------------ host key ----
# Every script that reaches the box runs ssh and scp with
# StrictHostKeyChecking=yes (issue #450), so ssh only talks to a machine whose
# key is already in this machine's known_hosts, and never adds one by itself.
# What goes into known_hosts is decided here: vps.json "hostKeys" holds the
# box's public host key fingerprints (SHA256), and a key is written only when
# the machine answering at the address shows one of them. A fingerprint is
# public: anybody who connects to port 22 is shown it. Read on 28 September
# with ssh-keyscan and matched against Patrick's known_hosts, which had held
# them since the box was set up.
#
# A rebuilt box has new keys. Put its fingerprints in vps.json (read them in
# the provider's console on the box itself: for each
# C:\ProgramData\ssh\ssh_host_*_key.pub, ssh-keygen -lf <file>), then
# ssh-keygen -R <address> on each machine and Setup-SshKey.ps1 again.

function Get-ThornswoodVpsHostKeys {
    return @(@((Get-ThornswoodVps).hostKeys) | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim() })
}

# The SHA256 fingerprint of one known_hosts or ssh-keyscan line
# ("host keytype base64"), from ssh-keygen itself. '' when it is not a key.
function Get-ThornswoodSshFingerprint([string]$Line) {
    $tmp = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($tmp, $Line.Trim() + "`n", (New-Object Text.UTF8Encoding($false)))
        $out = @(Invoke-ThornswoodNative { & ssh-keygen -l -E sha256 -f $tmp } 2>$null)
        foreach ($o in $out) {
            $m = [regex]::Match([string]$o, 'SHA256:[A-Za-z0-9+/]+')
            if ($m.Success) { return $m.Value }
        }
        return ''
    }
    finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# The known_hosts file ssh itself reads for -Address: the first
# UserKnownHostsFile that `ssh -G` (which reads the config and connects
# nowhere) gives for it. On the box through the deploy gate that is the
# gate's own box_known_hosts, which SYSTEM's ssh config names for the box
# (Install-Gate.ps1); until 1 Nov 2026 this always gave $HOME\.ssh\known_hosts,
# which the gate does not use, so Set-InboundRules -Check through the gate
# stopped saying known_hosts held no pinned key. With no address, or an ssh
# that will not say, the user's own file. One folder at a time, so the path
# is right in a cloud thread too (#2753): PowerShell on Linux takes
# '.ssh\known_hosts' as one file name in $HOME.
function Get-ThornswoodKnownHostsPath {
    param([string]$Address = '')
    $own = Join-Path (Join-Path $HOME '.ssh') 'known_hosts'
    if (-not $Address -or -not (Get-Command ssh -ErrorAction SilentlyContinue)) { return $own }
    $said = @(Invoke-ThornswoodNative { & ssh -G -o StrictHostKeyChecking=yes $Address } 2>$null)
    foreach ($l in $said) {
        $m = [regex]::Match([string]$l, '^userknownhostsfile\s+("[^"]+"|\S+)')
        if (-not $m.Success) { continue }
        $f = $m.Groups[1].Value.Trim('"')
        if ($f -eq '~' -or $f.StartsWith('~/') -or $f.StartsWith('~\')) { $f = Join-Path $HOME $f.Substring([Math]::Min(2, $f.Length)) }
        return [IO.Path]::GetFullPath($f)
    }
    return $own
}

# What known_hosts holds for the address, against the pin. Read only.
#   Status 'trusted'  every key held for the address is a pinned one
#          'wrong'    it holds a key that is not pinned: a rebuilt box, or
#                     something that once answered in its place
#          'none'     nothing for the address yet
function Test-ThornswoodKnownHost {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [string]$KnownHosts = (Get-ThornswoodKnownHostsPath -Address $Address),
        [string[]]$Pinned = (Get-ThornswoodVpsHostKeys)
    )
    $held = @()
    if (Test-Path -LiteralPath $KnownHosts) {
        $out = @(Invoke-ThornswoodNative { & ssh-keygen -F $Address -f $KnownHosts -l -E sha256 } 2>$null)
        foreach ($o in $out) {
            if ([string]$o -match '^\s*#') { continue }
            $m = [regex]::Match([string]$o, 'SHA256:[A-Za-z0-9+/]+')
            if ($m.Success) { $held += $m.Value }
        }
    }
    $good = @($held | Where-Object { $Pinned -contains $_ })
    $bad = @($held | Where-Object { $Pinned -notcontains $_ })
    $status = 'none'
    if ($bad.Count) { $status = 'wrong' } elseif ($good.Count) { $status = 'trusted' }
    return [pscustomobject]@{ Status = $status; Pinned = $good; Wrong = $bad }
}

# The setup step. Asks the machine at the address for its host keys and writes
# into known_hosts only the ones vps.json pins. Throws, writing nothing, when
# known_hosts already holds a key that is not pinned or when the machine shows
# none of the pinned keys. Returns how many lines it added (0 when it already
# trusted the box).
#   -Scanned  the key lines, already asked for some other way, in place of
#             ssh-keyscan, which cannot go through a ProxyCommand. A cloud
#             thread reaches the box only through the bridge (#2753), so
#             Setup-CloudSsh.ps1 has ssh itself write the key it was shown to
#             a scratch file and hands those lines here, where they meet the
#             same pin.
function Add-ThornswoodKnownHost {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [string]$KnownHosts = (Get-ThornswoodKnownHostsPath -Address $Address),
        [string[]]$Pinned = (Get-ThornswoodVpsHostKeys),
        [string[]]$Scanned = $null
    )
    if (-not $Pinned.Count) { throw 'scripts\vps\vps.json pins no host keys, so there is nothing to check the box against. Nothing was written.' }
    $now = Test-ThornswoodKnownHost -Address $Address -KnownHosts $KnownHosts -Pinned $Pinned
    if ($now.Status -eq 'wrong') {
        throw ("$KnownHosts holds a key for $Address that is not the one scripts\vps\vps.json pins (" + ($now.Wrong -join ', ') +
               '). Either the box was rebuilt, and its new fingerprints go in vps.json first, or something else answered in its place once. Nothing was written.')
    }
    if ($now.Status -eq 'trusted') { return 0 }

    if ($null -ne $Scanned) { $scan = @($Scanned) }
    else { $scan = @(Invoke-ThornswoodNative { & ssh-keyscan -T 10 $Address } 2>$null) }
    $keep = @()
    foreach ($line in $scan) {
        $l = ([string]$line).Trim()
        if (-not $l -or $l.StartsWith('#')) { continue }
        $fp = Get-ThornswoodSshFingerprint $l
        if ($fp -and ($Pinned -contains $fp)) { $keep += $l }
    }
    if (-not $keep.Count) {
        throw ("The machine answering at $Address did not show any host key scripts\vps\vps.json pins (it showed " + $scan.Count +
               ' key line(s)). Do not go on from this network. Nothing was written.')
    }
    $dir = Split-Path -Parent $KnownHosts
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $text = ''
    if (Test-Path -LiteralPath $KnownHosts) { $text = [IO.File]::ReadAllText($KnownHosts) }
    if ($text -and -not $text.EndsWith("`n")) { $text += "`n" }
    $text += (($keep -join "`n") + "`n")
    [IO.File]::WriteAllText($KnownHosts, $text, (New-Object Text.UTF8Encoding($false)))
    return $keep.Count
}

# ------------------------------------------------------------ the bridge ----
# Every machine reaches the box's ssh through the bridge (#2753 for cloud
# threads, #2891 for One and each person's PC): ssh's ProxyCommand is
# connect.js, which carries the session inside a WebSocket to
# wss://thornswood.net/box/, and bridge.js on the box joins it to sshd on
# 127.0.0.1. Each machine sends a token of its own (Grant-BoxAccess.ps1
# issues and takes them away one name at a time) and logs in with a key of
# its own, which the box takes only from 127.0.0.1, so only through here.
# Port 22 then needs no outside address, and a home address that changes
# stops nothing. A Host block for the box's address in .ssh\config, between
# two marker lines, points plain "ssh Administrator@<address>" through it, so
# every script that runs ssh and scp goes this way without being told.

# Where a PC keeps its token: readable by its owner only, read by connect.js
# when THORNSWOOD_BOX_TOKEN is not set (a cloud thread sets that instead).
function Get-ThornswoodBridgeTokenPath {
    return (Join-Path (Join-Path $HOME '.ssh') 'thornswood-box-token')
}

# What a token looks like: 32 random bytes as base64url, 43 characters.
function Test-ThornswoodBridgeToken([string]$Token) {
    return ($Token -match '^[A-Za-z0-9_-]{40,}$')
}

function New-ThornswoodBridgeToken {
    $bytes = New-Object byte[] 32
    ([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# What the box holds for a token: its SHA-256 in lower case hex, never the
# token itself, so nothing read off the box opens the bridge.
function Get-ThornswoodBridgeDigest([string]$Token) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $h = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Token)) } finally { $sha.Dispose() }
    return (-join ($h | ForEach-Object { $_.ToString('x2') }))
}

# A file nobody but this account can read, from its first byte: made empty,
# locked, then filled. The rules are written whole, one for this account and
# nothing else. icacls /inheritance:r takes off only the inherited rules, and
# a file made in a folder that passes nothing down (TEMP on GitHub's runners)
# holds the maker's default rules, SYSTEM and Administrators, as its own, so
# those stayed beside this account's (#5062).
function Write-ThornswoodPrivateFile([string]$Path, [string]$Text) {
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($Path, '')
    if ($env:OS -eq 'Windows_NT') {
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
        try {
            $acl = New-Object Security.AccessControl.FileSecurity
            $acl.SetAccessRuleProtection($true, $false)
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'Allow')))
            $item = Get-Item -LiteralPath $Path -Force
            [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, $acl)
            # Read back, not taken from the call (#3034).
            $got = Get-Acl -LiteralPath $Path
            $who = @($got.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
            if (-not $got.AreAccessRulesProtected -or ($who -join ',') -ne $me.Value) { throw ('it holds rules for ' + ($who -join ', ')) }
        } catch { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue; throw "could not make $Path readable by this account alone, so nothing was written to it ($($_.Exception.Message))" }
    } else {
        & chmod 600 $Path
    }
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# The bridge client, copied out of the checkout into .ssh\thornswood-bridge,
# so ssh keeps working when the checkout it came from moves or goes (a
# worktree is removed after its merge). Run again to take a newer one.
# Returns the folder.
function Install-ThornswoodBridgeClient([string]$From) {
    $to = Join-Path (Join-Path $HOME '.ssh') 'thornswood-bridge'
    if (-not (Test-Path -LiteralPath $to)) { New-Item -ItemType Directory -Path $to -Force | Out-Null }
    foreach ($f in 'connect.js', 'listen.js', 'ws.js') {
        $src = Join-Path $From $f
        if (-not (Test-Path -LiteralPath $src)) { throw "not found: $src" }
        Copy-Item -LiteralPath $src -Destination (Join-Path $to $f) -Force
    }
    return $to
}

# Writes the Host block that sends ssh to the address through the bridge,
# first in .ssh\config. ssh takes the first value it finds for each option,
# so this block's User, key, host key checking and ProxyCommand win over any
# Host entry for the address further down, which can only add to what
# accumulates (another IdentityFile to try); nothing here has to read,
# rewrite or refuse a block it did not write. A second run replaces this
# one. Returns what the file held before, for a caller that has to put it
# back.
function Set-ThornswoodBridgeSsh {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$KeyPath,
        [string]$Node = '',
        [string]$Connect = '',
        # A box with no bridge yet (Setup-SshKey.ps1 -NewBox): the same block
        # without the ProxyCommand, so ssh goes straight to port 22 until
        # Grant-BoxAccess.ps1 -ThisMachine writes the block over it.
        [switch]$Direct,
        [string]$Begin = '# >>> thornswood bridge (Setup-SshKey.ps1)',
        [string]$End = '# <<< thornswood bridge',
        [string]$Config = (Join-Path (Join-Path $HOME '.ssh') 'config')
    )
    $before = ''
    if (Test-Path -LiteralPath $Config) { $before = [IO.File]::ReadAllText($Config) }
    $rest = [regex]::Replace($before, '(?s)' + [regex]::Escape($Begin) + '.*?' + [regex]::Escape($End) + '\r?\n?', '')
    if (-not $Direct -and (-not $Node -or -not $Connect)) { throw 'Set-ThornswoodBridgeSsh needs -Node and -Connect, or -Direct.' }
    $block = @(
        $Begin,
        "Host $Address",
        "    User $User",
        "    IdentityFile $KeyPath",
        '    IdentitiesOnly yes',
        '    StrictHostKeyChecking yes',
        $(if ($Direct) { '    # straight to port 22: this box has no bridge yet' } else { "    ProxyCommand `"$Node`" `"$Connect`"" }),
        $End
    ) -join "`n"
    $text = $block + "`n" + $(if ($rest.Trim()) { "`n" + $rest.TrimStart() } else { '' })
    $dir = Split-Path -Parent $Config
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($Config, $text, (New-Object Text.UTF8Encoding($false)))
    if ($env:OS -ne 'Windows_NT') { & chmod 600 $Config }
    return $before
}

# Whether ssh to the address goes through the bridge from here, by what ssh
# itself makes of its config (ssh -G), so a Host block anywhere counts.
function Test-ThornswoodBridgeSsh([string]$Address) {
    $out = @(Invoke-ThornswoodNative { & ssh -o StrictHostKeyChecking=yes -G $Address } 2>$null | ForEach-Object { [string]$_ })
    return [bool](@($out | Where-Object { $_ -match '^proxycommand .*connect\.js' }).Count)
}

# The box's host key through the bridge. ssh-keyscan cannot run a
# ProxyCommand, so it asks listen.js, a port on this machine's loopback that
# carries each connection to the box through the bridge the same way, and
# what it is shown goes through the same pin as every other key
# (Add-ThornswoodKnownHost -Scanned). The token comes from the environment or
# the token file, as it does for ssh. Returns how many lines were added.
function Add-ThornswoodKnownHostThroughBridge {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$Node,
        [Parameter(Mandatory = $true)][string]$Listen
    )
    $now = Test-ThornswoodKnownHost -Address $Address
    if ($now.Status -eq 'wrong') {
        throw ("known_hosts here holds a key for $Address that scripts\vps\vps.json does not pin (" + ($now.Wrong -join ', ') + "). ssh-keygen -R $Address, then run this again.")
    }
    if ($now.Status -eq 'trusted') { return 0 }
    # listen.js prints the port it took, then carries each connection to the
    # box until its standard input closes. Arguments as one string, which
    # Windows PowerShell 5.1's .NET takes as well as 7's.
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $Node
    $psi.Arguments = '"' + $Listen + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $listener = [Diagnostics.Process]::Start($psi)
    try {
        $port = [string]$listener.StandardOutput.ReadLine()
        if ($port -notmatch '^\d+$') { throw 'the bridge listener did not start, so the box''s key could not be asked for. Nothing was written.' }
        $scan = @(Invoke-ThornswoodNative { & ssh-keyscan -T 20 -p $port 127.0.0.1 } 2>&1 | ForEach-Object { "$_" })
        # Each line names [127.0.0.1]:port, the listener; the key is the box's,
        # so it is written under the box's address, after the pin has seen it.
        $lines = @($scan | Where-Object { $_ -match '^\[127\.0\.0\.1\]:\d+ ' } | ForEach-Object { $Address + ' ' + ($_ -replace '^\S+\s+', '') })
        if (-not $lines.Count) {
            throw ('the box showed no host key through the bridge, so nothing was written. ssh-keyscan said: ' + (($scan | Select-Object -Last 3) -join ' '))
        }
        return (Add-ThornswoodKnownHost -Address $Address -Scanned $lines)
    }
    finally {
        # Closing its input is how listen.js is told to stop. Either step can
        # find it already gone, which is the end wanted, so neither says more.
        try { $listener.StandardInput.Close() } catch { <# already ended, its input closed with it #> }
        if (-not $listener.WaitForExit(3000)) { try { $listener.Kill() } catch { <# ended between the wait and the kill #> } }
    }
}
