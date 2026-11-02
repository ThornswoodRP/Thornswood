<#
  Grant-BoxAccess.ps1

  Gives one person, or one machine, its own way into the box, or takes it
  away, and touches nobody else's (#2891). Everybody reaches the box's ssh
  through the bridge (wss://thornswood.net/box/, #2753), each with a key and
  a token of their own, so port 22 needs no outside address and a home
  address that changes stops nothing. Run it on a machine whose own way in
  already works (One).

      .\scripts\vps\Grant-BoxAccess.ps1 -Name djinn -FromClipboard
      .\scripts\vps\Grant-BoxAccess.ps1 -Name djinn -PublicKey 'ssh-ed25519 AAAA... thornswood'
                       a person: their PC's public key line (Setup-SshKey.ps1
                       prints it), and a token made here for them
      .\scripts\vps\Grant-BoxAccess.ps1 -Name one -ThisMachine
                       this machine: its own key and a token, and this
                       machine's ssh pointed through the bridge
      .\scripts\vps\Grant-BoxAccess.ps1 -Name cloud -MakeKey
                       cloud Claude threads: a key made here, and both halves
                       into one file for the cloud environment
      .\scripts\vps\Grant-BoxAccess.ps1 -Name codex -MakeKey -NoticesOnly
                       an agent that only posts staff notices: a key that can
                       do nothing on the box but put one in #staff-updates
      .\scripts\vps\Grant-BoxAccess.ps1 -Name claude -MakeKey -NoticesOnly -ToEnvironment notices
                       the same, for the ops repository's staff-notice.yml:
                       the key goes into that GitHub environment, not a file
      .\scripts\vps\Grant-BoxAccess.ps1 -Name desk -Deploy -MakeKey -ToEnvironment desk
                       the release desk's deploy key (#2841): a key that logs
                       in as thornswood-deploy and runs only the deploy gate's
                       verbs, into the GitHub environment the ops repository's
                       box-run.yml reads
      .\scripts\vps\Grant-BoxAccess.ps1 -Name djinn -Remove
                       take that one name's key and token off the box
      .\scripts\vps\Grant-BoxAccess.ps1 -List
                       who has a way in, read only

  A second grant for a name replaces that name's key and token, so the old
  pair stops working.

  A NOTICES KEY (-NoticesOnly, with -MakeKey; #2934). Every other key logs
  in as the box's Administrator. This one's line carries
      restrict,command="pwsh ... -File C:\Thornswood-Watch\say-staff.ps1 -From <name>"
  so sshd runs say-staff.ps1 whatever the client asks for, with no shell,
  no file copy and no forwarding, and the notice it queues says it is from
  <name>. That script only appends one notice line to the watchdog's outbox
  (scripts\vps\vps-say-staff.ps1 says its limits), which the bot says in
  #staff-updates. It is for an agent that needs to post the notices
  Developer-Guide.md asks for and nothing else on the box. The grant stops
  first when say-staff.ps1 is not on the box (Watch-Services.ps1 -Install
  puts it there). Its file is <OutDir>\notice-access.txt, with
  THORNSWOOD_NOTICE_KEY_B64=... and THORNSWOOD_NOTICE_TOKEN=..., for that
  agent's environment; scripts\ops\Say-Staff.ps1 uses them.

  A DEPLOY KEY (-Deploy, with -MakeKey; #2841). It goes on the box not as
  Administrator but in the authorized_keys of thornswood-deploy, an account
  with no administrator rights that scripts\deploy\Install-Gate.ps1 makes,
  as
      from="127.0.0.1",restrict,command="pwsh ... -File C:\Thornswood-Gate\Gate.ps1"
  so whatever the client asks for, sshd runs the gate's dispatcher, which
  hands the line to the gate's broker; the broker runs only the verbs in
  scripts\vps\gate\verbs.json, each one a script of main with the switches
  allowed there. The grant stops first when Gate.ps1 or the account is not
  on the box. Its proof asks the gate for ping, which also reads main through
  the gate's GitHub deploy key, and then asks for a command, which the gate
  must refuse. With -ToEnvironment it goes into the secret DESK_KEY_B64 of
  that GitHub environment on -GitHubRepo, where the ops repository's
  box-run.yml reads it (#4013);
  without, into <OutDir>\deploy-access.txt as THORNSWOOD_DESK_KEY_B64=...

  -ToEnvironment <name> (with -MakeKey -NoticesOnly; #3045) puts the key
  instead into the secret NOTICE_KEY_B64 of that environment on GitHub, on
  -GitHubRepo, the private ops repository ThornswoodRP/Thornswood-Ops where
  the VPS runners are registered (#4013), whose staff-notice.yml reads it:
  the way a cloud thread posts. Before anything on the box changes, it makes the environment usable
  by main alone (a branch policy for main and nothing else), and stops,
  changing nothing, when the environment already lets another branch in or
  gh cannot reach it. After the proof the key goes to gh secret set on its
  standard input, so no file holds it and nothing prints it. The workflow runs
  on the box and reaches sshd on 127.0.0.1 itself, so it needs no bridge
  token: the token this makes is proved like every notices key's and then
  held by nobody.

  THE TWO HALVES, and why neither is any use alone:
    the key     the public half goes on the box as
                    from="127.0.0.1" <type> <key> thornswood-<name>
                so sshd takes it only from the box itself, which means only
                through the bridge. A line holding the same key under
                another comment is taken off, so a key is never on the box
                twice with different rules. A person's private half never
                leaves their own PC.
    the token   what bridge.js asks for before it opens a WebSocket at all.
                The box holds only its SHA-256, in tokens\<name> in the
                bridge's folder, so nothing read off the box opens the
                bridge, and the token itself never leaves this machine except
                to its holder. bridge.js reads the folder at every
                connection, so a grant counts and a removal refuses at once.

  NOT LOCKING ANYBODY OUT. Before it changes anything the box saves the key
  file and the token folder and arms a task that puts them back in ten
  minutes ("Thornswood box access put back"). Then a NEW login from this
  machine has to get in, and only then is the task cancelled. A change that
  would cut this machine off is undone by the box itself. -ThisMachine also
  puts this machine's ssh config back as it was when its proof fails.

  WHERE THE TOKEN GOES, readable by the account running this only:
    a person     <OutDir>\<name>\box-token.txt. Send it to them alone (a Discord
                 DM), and delete the file. They paste it when Setup-SshKey.ps1
                 asks. Without their private key it opens nothing but sshd's
                 login.
    this machine .ssh\thornswood-box-token, where connect.js reads it.
    cloud        <OutDir>\cloud-access.txt with two lines,
                 THORNSWOOD_BOX_KEY_B64=... and THORNSWOOD_BOX_TOKEN=..., for
                 the cloud environment's variables (Project settings, Cloud
                 environment). Then delete the file. A cloud thread runs
                 scripts/vps/Setup-CloudSsh.ps1.
  No token or private key is printed by anything here.
#>
[CmdletBinding()]
param(
    [string]$Name = '',
    [string]$PublicKey = '',
    [switch]$FromClipboard,
    [switch]$ThisMachine,
    [switch]$MakeKey,
    # With -MakeKey: a key that can only post a staff notice (see above).
    [switch]$NoticesOnly,
    # With -MakeKey: a key that runs only the deploy gate's verbs (see above).
    [switch]$Deploy,
    # With -MakeKey -NoticesOnly or -MakeKey -Deploy: the GitHub environment the key goes into.
    [string]$ToEnvironment = '',
    # Where staff-notice.yml and the VPS runners are (#4013).
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops',
    [switch]$Remove,
    [switch]$List,
    # -ThisMachine: this machine's key, the one Setup-SshKey.ps1 makes.
    [string]$KeyPath = '',
    # Where a token waits to be handed over: the scratch folder
    # Get-ScratchDir.ps1 names, so no script carries the path itself.
    [string]$OutDir = '',
    [string]$BridgeRoot = 'C:\Thornswood-Bridge',
    # Where -MakeKey's proof connects, the same address connect.js uses.
    [string]$BoxUrl = 'wss://thornswood.net/box/',
    [string]$VpsHost = '',
    [string]$VpsUser = '',
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here 'Lock-Folder.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
if (-not $KeyPath) { $KeyPath = Join-Path (Join-Path $HOME '.ssh') 'thornswood_ed25519' }
if (-not $OutDir) { $OutDir = & (Join-Path (Join-Path (Split-Path -Parent $Here) 'release') 'Get-ScratchDir.ps1') 'box-access' }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$PutBack = 'Thornswood box access put back'
$BridgeDir = Join-Path $Here 'bridge'
# What a notices key may run, and all it may run (scripts\vps\vps-say-staff.ps1).
$SayStaff = 'C:\Thornswood-Watch\say-staff.ps1'
# What a deploy key may run, and all it may run (scripts\vps\gate\Gate.ps1),
# and the account it logs in as (scripts\deploy\Install-Gate.ps1).
$GateScript = 'C:\Thornswood-Gate\Gate.ps1'
$GateUser = 'thornswood-deploy'

# ------------------------------------------------------ the box's line ----
# The line the box holds for a name: taken only from 127.0.0.1, so only
# through the bridge, and for a notices key only to run say-staff.ps1 as that
# name. The name is already one lower case word, so nothing in it can close
# the quotes.
function Get-BoxKeyLine([string]$Bare, [string]$Who, [bool]$Notices, [bool]$Gate = $false) {
    $opts = 'from="127.0.0.1"'
    if ($Gate) { $opts += ',restrict,command="pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $GateScript + '"' }
    elseif ($Notices) { $opts += ',restrict,command="pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $SayStaff + ' -From ' + $Who + '"' }
    return ($opts + ' ' + $Bare + ' thornswood-' + $Who)
}

# A line off the box in parts: its options, its key ("type key"), and what
# they allow. '' for the key when the line holds none.
function Read-BoxKeyLine([string]$Line) {
    $m = [regex]::Match($Line.Trim(), '^(?:(?<opts>(?:[A-Za-z-]+(?:="(?:[^"\\]|\\.)*")?)(?:,(?:[A-Za-z-]+(?:="(?:[^"\\]|\\.)*")?))*)\s+)?(?<key>(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+)(?:\s|$)')
    if (-not $m.Success) { return [pscustomobject]@{ Options = ''; Key = ''; Bridge = $false; Notices = $false; Gate = $false } }
    $o = $m.Groups['opts'].Value
    return [pscustomobject]@{
        Options = $o
        Key     = $m.Groups['key'].Value
        Bridge  = ($o -match '(^|,)from="127\.0\.0\.1"(,|$)')
        Notices = ($o -match '(^|,)command="[^"]*\\say-staff\.ps1 -From [a-z0-9-]+"(,|$)' -and $o -match '(^|,)restrict(,|$)')
        Gate    = ($o -match '(^|,)command="[^"]*-File C:\\Thornswood-Gate\\Gate\.ps1"(,|$)' -and $o -match '(^|,)restrict(,|$)')
    }
}

# ------------------------------------------------------------- the line ----
# A public key line however it was copied: on its own, inside a Discord
# message with words around it, in a code block, or split over two lines by
# a narrow window. Returns "type key" with no comment (the box's line gets
# thornswood-<name>), or '' when there is none.
function Find-PublicKeyLine([string]$Text) {
    $pattern = '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) ([A-Za-z0-9+/=]+)( .*)?$'
    # A whole key decodes as base64; an ed25519 one is always 68 characters.
    # A line cut by a console at its window width is neither.
    function Test-Body([string]$type, [string]$body) {
        if ($type -eq 'ssh-ed25519' -and $body.Length -ne 68) { return $false }
        try { [void][Convert]::FromBase64String($body); return $true } catch { return $false }
    }
    $lines = @($Text -replace '`', ' ' -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\b') { continue }
        if ($lines[$i] -match $pattern -and (Test-Body $Matches[1] $Matches[2])) { return ($Matches[1] + ' ' + $Matches[2]) }
        # Wrapped: the type word, then the key cut into pieces over the next
        # line or two, then the comment. The pieces are glued back together
        # until they make a whole key.
        $last = [Math]::Min($i + 3, $lines.Count - 1)
        $words = @((($lines[$i..$last]) -join ' ') -split '\s+' | Where-Object { $_ })
        $type = $words[0]; $body = ''; $k = 1
        while ($k -lt $words.Count -and $words[$k] -match '^[A-Za-z0-9+/=]+$') {
            $body += $words[$k]; $k++
            if (Test-Body $type $body) { break }
        }
        if (Test-Body $type $body) { return ($type + ' ' + $body) }
    }
    return ''
}

# ------------------------------------------------------- on the box -------
# The change, as one script. It saves what is there and arms the put back
# before it changes anything, and says ARMED, then CHANGED lines, then DONE.
# $Digest and $KeyLine both '' take the name away.
# $Need, when given, is a file the key's forced command runs: without it on
# the box the key would open nothing, so nothing is changed.
# $Gate: the key goes into the deploy gate account's authorized_keys, not
# Administrator's (#2841).
function Get-BoxChangeScript([string]$Who, [string]$Digest, [string]$KeyLine, [string]$Blob, [string]$Need = '', [bool]$Gate = $false) {
    $lock = 'function Lock-ThornswoodFolder {' + ${function:Lock-ThornswoodFolder}.ToString() + '}'
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$keys = 'C:\ProgramData\ssh\administrators_authorized_keys'
if ('$Gate' -eq 'True') {
  `$gu = Get-LocalUser -Name '$GateUser' -EA SilentlyContinue
  `$pl = if (`$gu) { 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + `$gu.SID.Value } else { '' }
  if (-not `$pl -or -not (Test-Path -LiteralPath `$pl)) { 'STOP there is no account $GateUser with a profile on the box, and a deploy key logs in as it. Run scripts\deploy\Install-Gate.ps1 first. Nothing was changed.'; exit 1 }
  `$keys = Join-Path (Get-ItemProperty -LiteralPath `$pl).ProfileImagePath '.ssh\authorized_keys'
  if (-not (Test-Path -LiteralPath `$keys)) { 'STOP ' + `$keys + ' is not there. Run scripts\deploy\Install-Gate.ps1 first; it makes it with the rules sshd needs. Nothing was changed.'; exit 1 }
}
`$tokens = '$BridgeRoot\tokens'
`$save = 'C:\ProgramData\ssh\box-access-before'
`$task = '$PutBack'
if (-not (Test-Path -LiteralPath '$BridgeRoot\bridge.js')) { 'STOP there is no bridge in $BridgeRoot. Run scripts\deploy\Install-Bridge.ps1 first. Nothing was changed.'; exit 1 }
`$need = '$Need'
if (`$need -and -not (Test-Path -LiteralPath `$need)) { 'STOP there is no ' + `$need + ' on the box, and a notices key runs only that. Run scripts\vps\Watch-Services.ps1 -Install first. Nothing was changed.'; exit 1 }
if (Get-ScheduledTask -TaskName `$task -EA SilentlyContinue) { 'STOP the put back from an earlier run is still armed, so that run is not finished: it puts its key file and tokens back within ten minutes of when it started. Run this again after that. Nothing was changed.'; exit 1 }

# What is there now, for the put back, in a folder only SYSTEM and
# Administrators may open (#3034). ProgramData\ssh itself gives every signed
# in account read, as Windows OpenSSH installs it, and a folder made there
# takes that rule, so the copies of the key file and the token digests would
# be open to every account on the box. It is locked while it is empty.
$lock
if (Test-Path -LiteralPath `$save) { Remove-Item -LiteralPath `$save -Recurse -Force }
New-Item -ItemType Directory -Path `$save -Force | Out-Null
Lock-ThornswoodFolder -Path `$save -Only
New-Item -ItemType Directory -Path (Join-Path `$save 'tokens') -Force | Out-Null
if (Test-Path -LiteralPath `$keys) { Copy-Item -LiteralPath `$keys -Destination (Join-Path `$save 'keys') }
if (Test-Path -LiteralPath `$tokens) { Get-ChildItem -LiteralPath `$tokens -File | Copy-Item -Destination (Join-Path `$save 'tokens') }
# The put back runs once as SYSTEM and removes itself, its whole command
# inline (no script file a later change could swap), with every path under
# ProgramData\ssh, the bridge's folder or the deploy gate account's .ssh,
# which only SYSTEM and Administrators may change (#2612, Install-Gate.ps1). One statement to a line, no double
# quote, so the lines join into one -Command.
`$back = @'
`$keys = '__KEYS__'
`$tokens = '$BridgeRoot\tokens'
`$save = 'C:\ProgramData\ssh\box-access-before'
if (Test-Path -LiteralPath (Join-Path `$save 'keys')) { [IO.File]::WriteAllBytes(`$keys, [IO.File]::ReadAllBytes((Join-Path `$save 'keys'))) } else { Remove-Item -LiteralPath `$keys -Force -EA SilentlyContinue }
if (Test-Path -LiteralPath `$keys) { icacls `$keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null }
if (-not (Test-Path -LiteralPath `$tokens)) { New-Item -ItemType Directory -Path `$tokens -Force | Out-Null }
Get-ChildItem -LiteralPath `$tokens -File | Remove-Item -Force
Get-ChildItem -LiteralPath (Join-Path `$save 'tokens') -File | Copy-Item -Destination `$tokens
Remove-Item -LiteralPath `$save -Recurse -Force
Unregister-ScheduledTask -TaskName '$PutBack' -Confirm:`$false
'@
# The file the put back restores is the one this run changes; it is written
# in place, so a deploy account's read rule on its file stays.
`$back = `$back.Replace('__KEYS__', `$keys)
`$cmd = (@(`$back -split '\r?\n' | Where-Object { `$_.Trim() }) -join '; ')
`$a = New-ScheduledTaskAction -Execute (Join-Path `$env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -Command "' + `$cmd + '"')
`$t = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(10))
`$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName `$task -Action `$a -Trigger `$t -Principal `$p -Force | Out-Null
'ARMED the box puts the key file and tokens back by itself in ten minutes, unless a new login proves the change'

# The key: every line for this name, or holding this key under another
# comment, goes; the new one comes.
`$who = '$Who'
`$blob = '$Blob'
`$line = '$($KeyLine.Replace("'", "''"))'
`$have = @()
if (Test-Path -LiteralPath `$keys) { `$have = @(Get-Content -LiteralPath `$keys | Where-Object { `$_.Trim() }) }
`$after = @(`$have | Where-Object { `$l = ' ' + `$_.Trim() + ' '; -not (`$l.EndsWith(' thornswood-' + `$who + ' ') -or (`$blob -and `$l.Contains(' ' + `$blob + ' '))) })
`$gone = `$have.Count - `$after.Count
if (`$line) { `$after += `$line }
# No byte order mark: sshd silently ignores a file it cannot parse.
[IO.File]::WriteAllLines(`$keys, [string[]]`$after, (New-Object Text.UTF8Encoding(`$false)))
icacls `$keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null

# The token's digest, in the bridge's folder, whose rules it takes.
if (-not (Test-Path -LiteralPath `$tokens)) { New-Item -ItemType Directory -Path `$tokens -Force | Out-Null }
`$tf = Join-Path `$tokens `$who
`$digest = '$Digest'
if (`$digest) { [IO.File]::WriteAllText(`$tf, `$digest, (New-Object Text.UTF8Encoding(`$false))) }
else { Remove-Item -LiteralPath `$tf -Force -EA SilentlyContinue }
'CHANGED ' + `$who + ': ' + `$gone + ' key line(s) taken off' + `$(if (`$line) { ', its key put on, only through the bridge' } else { '' }) + `$(if (`$digest) { ', its token written' } else { ', its token taken off' })
'CHANGED now ' + `$after.Count + ' key line(s), and tokens for: ' + ((@(Get-ChildItem -LiteralPath `$tokens -File | ForEach-Object { `$_.Name }) -join ', '))
'DONE'
"@
}

# Once a new login has got in: the put back is cancelled and its copy goes.
function Get-BoxKeepScript {
    return @"
Unregister-ScheduledTask -TaskName '$PutBack' -Confirm:`$false -EA SilentlyContinue
if (Get-ScheduledTask -TaskName '$PutBack' -EA SilentlyContinue) { 'PUT BACK STILL ARMED' }
else { Remove-Item -LiteralPath 'C:\ProgramData\ssh\box-access-before' -Recurse -Force -EA SilentlyContinue; 'KEPT' }
"@
}

# Read only: every key line and every token name.
function Get-BoxListScript {
    return @"
`$ErrorActionPreference = 'SilentlyContinue'
`$keys = 'C:\ProgramData\ssh\administrators_authorized_keys'
if (Test-Path -LiteralPath `$keys) { Get-Content -LiteralPath `$keys | Where-Object { `$_.Trim() } | ForEach-Object { 'KEY ' + `$_.Trim() } }
`$gu = Get-LocalUser -Name '$GateUser'
if (`$gu) {
  `$gk = Join-Path (Get-ItemProperty -LiteralPath ('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + `$gu.SID.Value)).ProfileImagePath '.ssh\authorized_keys'
  if (Test-Path -LiteralPath `$gk) { Get-Content -LiteralPath `$gk | Where-Object { `$_.Trim() } | ForEach-Object { 'DKEY ' + `$_.Trim() } }
}
Get-ChildItem -LiteralPath '$BridgeRoot\tokens' -File | ForEach-Object { 'TOKEN ' + `$_.Name + ' ' + `$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
if (Get-ScheduledTask -TaskName '$PutBack') { 'ARMED' }
'LISTED'
"@
}

function Clean($lines) {
    @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

# A new connection from this machine, the way every script here makes one.
function Test-Login {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -o ConnectTimeout=20 $target 'echo THORNSWOOD_OK' } 2>&1 | ForEach-Object { "$_" })
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = (($out -join '') -match 'THORNSWOOD_OK'); Out = $out }
}

# gh api, with a JSON body on its standard input when there is one.
function Invoke-GitHub([string]$Method, [string]$Path, [string]$Body = '') {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if ($Body) { $o = @($Body | & gh api -X $Method $Path --input - 2>&1 | ForEach-Object { "$_" }) }
    else { $o = @(& gh api -X $Method $Path 2>&1 | ForEach-Object { "$_" }) }
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = ($c -eq 0); Text = ($o -join "`n") }
}

# The GitHub environment a workflow's notices key goes into, usable by main
# and no other branch, so a workflow on a pull request branch cannot read the
# key. Stops, changing nothing, when it already lets another branch in.
function Set-MainOnlyEnvironment([string]$EnvName) {
    $base = "repos/$GitHubRepo/environments/$EnvName"
    $now = Invoke-GitHub GET $base
    $policy = $null
    $haveMain = $false
    if ($now.Ok) {
        $policy = ($now.Text | ConvertFrom-Json).deployment_branch_policy
        if ($policy -and $policy.custom_branch_policies) {
            $list = Invoke-GitHub GET "$base/deployment-branch-policies?per_page=100"
            if (-not $list.Ok) { Die ("GitHub did not list the branches the environment $EnvName lets in: " + $list.Text + ' Nothing was changed.') }
            $all = @(($list.Text | ConvertFrom-Json).branch_policies)
            $others = @($all | Where-Object { -not ($_.name -eq 'main' -and $_.type -eq 'branch') } | ForEach-Object { $_.type + ' ' + $_.name })
            if ($others.Count) { Die ("the environment $EnvName on GitHub also lets in " + ($others -join ', ') + ', so a workflow there could read the key. Take those off it (the repository''s Settings, Environments) first. Nothing was changed.') }
            $haveMain = ($all.Count -eq 1)
        }
    } elseif ($now.Text -notmatch 'HTTP 404') {
        Die ("GitHub did not answer for the environment $EnvName on $GitHubRepo with gh here: " + $now.Text + ' Nothing was changed.')
    }
    if ($haveMain -and $policy -and -not $policy.protected_branches) { Say "  the GitHub environment $EnvName is there, for main only" 'Green'; return }
    $put = Invoke-GitHub PUT $base '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
    if (-not $put.Ok) { Die ("GitHub refused to make the environment $EnvName for chosen branches: " + $put.Text + ' Nothing was changed on the box.') }
    if (-not $haveMain) {
        $add = Invoke-GitHub POST "$base/deployment-branch-policies" '{"name":"main","type":"branch"}'
        if (-not $add.Ok) { Die ("the environment $EnvName on GitHub lets no branch in now, and GitHub refused to let main in: " + $add.Text + ' Nothing was changed on the box.') }
    }
    Say "  the GitHub environment $EnvName is there, for main only" 'Green'
}

foreach ($t in 'ssh', 'ssh-keygen') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client." }
}
$ways = @(@($PublicKey -or $FromClipboard, $ThisMachine, $MakeKey, $Remove, $List) | Where-Object { $_ }).Count
if ($ways -ne 1) { Die 'Pass one of: -PublicKey (or -FromClipboard), -ThisMachine, -MakeKey, -Remove, -List. Nothing was changed.' }
# A notices key is made here, so its private half is never asked of anybody
# and its file names what it is for.
if ($NoticesOnly -and -not $MakeKey) { Die '-NoticesOnly goes with -MakeKey. Nothing was changed.' }
if ($Deploy -and -not $MakeKey) { Die '-Deploy goes with -MakeKey. Nothing was changed.' }
if ($Deploy -and $NoticesOnly) { Die 'A key is a notices key or a deploy key, not both. Nothing was changed.' }
if ($ToEnvironment -and -not ($NoticesOnly -or $Deploy)) { Die '-ToEnvironment goes with -MakeKey -NoticesOnly or -MakeKey -Deploy. Nothing was changed.' }
if ($ToEnvironment -and $ToEnvironment -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { Die '-ToEnvironment is one lower case word, the way the workflow names it: notices, or desk. Nothing was changed.' }
# The secret each kind of key goes into, the name its workflow reads.
$SecretName = if ($Deploy) { 'DESK_KEY_B64' } else { 'NOTICE_KEY_B64' }
if ($ToEnvironment -and -not (Get-Command gh -ErrorAction SilentlyContinue)) { Die '-ToEnvironment puts the key on GitHub with gh, and gh is not on PATH. Nothing was changed.' }

Write-Host ''
Write-Host '  THORNSWOOD  -  who may reach the box' -ForegroundColor White
Say "  $target, through $BoxUrl" 'DarkGray'

# ------------------------------------------------------------------ list ----
if ($List) {
    Head 'On the box'
    $said = Clean (Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script (Get-BoxListScript))
    if ($said -notcontains 'LISTED') { $said | ForEach-Object { Say "  $_" 'DarkGray' }; Die 'the box did not answer the list. The lines above say why.' }
    foreach ($l in @($said | Where-Object { $_ -like 'KEY *' })) {
        $k = $l.Substring(4)
        $who = if ($k -match ' thornswood-([a-z0-9][a-z0-9-]*)$') { $Matches[1] } else { '(no thornswood- name)' }
        $parts = Read-BoxKeyLine $k
        $fp = if ($parts.Key) { Get-ThornswoodSshFingerprint ('x ' + $parts.Key) } else { '(no key on the line)' }
        $how = if ($parts.Bridge) { 'only through the bridge' } else { 'from any address that reaches port 22' }
        if ($parts.Notices) { $how += ', and only to post a staff notice' }
        Say ('  key    {0,-22} {1}  {2}' -f $who, $fp, $how) $(if ($how -like 'only*') { 'Green' } else { 'Yellow' })
    }
    foreach ($l in @($said | Where-Object { $_ -like 'DKEY *' })) {
        $k = $l.Substring(5)
        $who = if ($k -match ' thornswood-([a-z0-9][a-z0-9-]*)$') { $Matches[1] } else { '(no thornswood- name)' }
        $parts = Read-BoxKeyLine $k
        $fp = if ($parts.Key) { Get-ThornswoodSshFingerprint ('x ' + $parts.Key) } else { '(no key on the line)' }
        $ok = $parts.Bridge -and $parts.Gate
        Say ('  key    {0,-22} {1}  {2}' -f $who, $fp, $(if ($ok) { "as $GateUser, only from the box, and only the deploy gate's verbs" } else { "as $GateUser, WITHOUT the gate's forced command or from=" })) $(if ($ok) { 'Green' } else { 'Yellow' })
    }
    foreach ($l in @($said | Where-Object { $_ -like 'TOKEN *' })) {
        $bits = $l.Substring(6) -split ' ', 2
        Say ('  token  {0,-22} since {1}' -f $bits[0], $bits[1]) 'Green'
    }
    if ($said -contains 'ARMED') { Say "  the put back task is armed, so a run is unfinished or failed its proof" 'Yellow' }
    Done 0
}

# ------------------------------------------------------------- the name ----
if ($Name -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { Die 'The name is one word, lower case letters, digits and hyphens, the way the bridge logs it: djinn, one, cloud. Nothing was changed.' }
if ($MakeKey -and -not $NoticesOnly -and $Name -ne 'cloud') { Say "  -MakeKey makes a key here, for the cloud environment; it is named $Name." 'Yellow' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (($ThisMachine -or $MakeKey) -and -not $node) { Die 'node is not on PATH, and the bridge client is node. Nothing was changed.' }

if ($ToEnvironment) {
    Head "Where the key goes: the GitHub environment $ToEnvironment"
    Set-MainOnlyEnvironment $ToEnvironment
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-access-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$tokenPath = Get-ThornswoodBridgeTokenPath
$hadToken = $null
$cfgBefore = $null
try {
    # -------------------------------------------------------------- key ----
    $keyLine = ''
    $newKey = ''
    $bare = ''
    if ($Remove) {
        Head "Taking $Name's way in away"
    } else {
        Head "$Name's key"
        if ($FromClipboard) { $PublicKey = [string](Get-Clipboard -Raw) }
        if ($ThisMachine) {
            if (-not (Test-Path -LiteralPath "$KeyPath.pub")) { Die "this machine has no key at $KeyPath. Run .\scripts\vps\Setup-SshKey.ps1 first; it makes one. Nothing was changed." }
            $PublicKey = [IO.File]::ReadAllText("$KeyPath.pub")
        }
        if ($MakeKey) {
            # An empty passphrase through PowerShell: '""' in some versions and ''
            # in others (Setup-SshKey.ps1 says why), so both are tried and proved.
            $newKey = Join-Path $work 'cloud_ed25519'
            $made = $false
            foreach ($empty in '""', '') {
                Remove-Item -LiteralPath $newKey, "$newKey.pub" -Force -ErrorAction SilentlyContinue
                $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                Invoke-ThornswoodNative { & ssh-keygen -q -t ed25519 -N $empty -C "thornswood-$Name" -f $newKey } 2>&1 | Out-Null
                if (Test-Path -LiteralPath "$newKey.pub") {
                    $null = Invoke-ThornswoodNative { & ssh-keygen -y -P '' -f $newKey } 2>&1
                    if ($LASTEXITCODE -eq 0) { $made = $true }
                }
                $ErrorActionPreference = $old
                if ($made) { break }
            }
            if (-not $made) { Die 'could not make a key without a passphrase. Nothing was put on the box.' }
            $PublicKey = [IO.File]::ReadAllText("$newKey.pub")
        }
        if ($PublicKey -match 'PRIVATE KEY') { Die 'That is a private key. It never leaves the PC it was made on; ask for the line Setup-SshKey.ps1 prints instead. Nothing was changed.' }
        $bare = Find-PublicKeyLine $PublicKey
        if (-not $bare) {
            Die 'No public key line in what was given. It starts with ssh-ed25519 or ssh-rsa, then a long run of letters and digits; Setup-SshKey.ps1 prints it on the PC it was made on. Nothing was changed.'
        }
        $keyLine = Get-BoxKeyLine $bare $Name ([bool]$NoticesOnly) ([bool]$Deploy)
        Say ('  ' + (Get-ThornswoodSshFingerprint ('x ' + $bare)) + ', taken only through the bridge' + $(if ($NoticesOnly) { ', and only to post a staff notice as ' + $Name } elseif ($Deploy) { ', as ' + $GateUser + ', and only to ask the deploy gate for its verbs' } else { '' })) 'Green'
    }
    $blob = if ($bare) { ($bare -split ' ')[1] } else { '' }
    $token = ''
    $digest = ''
    if (-not $Remove) {
        $token = New-ThornswoodBridgeToken
        $digest = Get-ThornswoodBridgeDigest $token
    }

    # ---------------------------------------------------------- the box ----
    Head 'On the box'
    $need = if ($NoticesOnly) { $SayStaff } elseif ($Deploy) { $GateScript } else { '' }
    $said = Clean (Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script (Get-BoxChangeScript $Name $digest $keyLine $blob $need ([bool]$Deploy)))
    foreach ($l in $said) { Say "  $l" $(if ($l -like 'STOP*') { 'Red' } elseif ($l -like 'CHANGED*') { 'Green' } else { 'Gray' }) }
    if ($said -notcontains 'DONE') {
        if (@($said | Where-Object { $_ -like 'ARMED*' }).Count) { Die "the box did not finish. It puts the key file and tokens back by itself within ten minutes (the task '$PutBack')." }
        Die 'the box changed nothing. The lines above say why.'
    }

    # ------------------------------------------------------ this machine ---
    if ($ThisMachine) {
        Head 'This machine'
        if (Test-Path -LiteralPath $tokenPath) { $hadToken = [IO.File]::ReadAllText($tokenPath) }
        Write-ThornswoodPrivateFile -Path $tokenPath -Text $token
        Say "  the token is in $tokenPath, readable by this account only" 'Green'
        $client = Install-ThornswoodBridgeClient $BridgeDir
        $cfgBefore = Set-ThornswoodBridgeSsh -Address $VpsHost -User $VpsUser -KeyPath $KeyPath -Node $node.Source -Connect (Join-Path $client 'connect.js')
        Say "  ssh to $VpsHost now goes through the bridge (.ssh\config, the client in $client)" 'Green'
        try { $n = Add-ThornswoodKnownHostThroughBridge -Address $VpsHost -Node $node.Source -Listen (Join-Path $client 'listen.js') }
        catch { $n = -1; Say ('  ' + $_.Exception.Message) 'Red' }
        if ($n -gt 0) { Say "  added $n pinned host key line(s) to known_hosts" 'Green' }
    }

    # ------------------------------------------------------------ proof ----
    Head 'A new login from this machine'
    $w = Test-Login
    if (-not $w.Ok) {
        $w.Out | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }
        if ($ThisMachine) {
            [IO.File]::WriteAllText((Join-Path (Join-Path $HOME '.ssh') 'config'), $cfgBefore, (New-Object Text.UTF8Encoding($false)))
            if ($null -ne $hadToken) { Write-ThornswoodPrivateFile -Path $tokenPath -Text $hadToken } else { Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue }
            Say '  this machine''s ssh config and token file are back as they were' 'Yellow'
        }
        Die ("it does not get in, so the change is not kept: the box puts the key file and tokens back by itself within ten minutes (the task '$PutBack'), and ssh from here works again after that. " +
             'A "box bridge:" line is the bridge, Caddy or the token; "Permission denied" is the key.')
    }
    Say '  it gets in' 'Green'
    $kept = Clean (Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script (Get-BoxKeepScript))
    if ($kept -notcontains 'KEPT') { Die "could not cancel the put back ('$PutBack'), so the box puts the old key file and tokens back within ten minutes. Run this again after that." }
    Say '  the put back is cancelled, so the change stays' 'Green'

    # -------------------------------------------------------- the holder ---
    if ($Remove) {
        Say "  $Name has no way in now. Everybody else's is as it was." 'Green'
    } elseif ($ThisMachine) {
        Say "  This machine reaches the box through the bridge with its own key and token, named $Name." 'Green'
    } elseif ($MakeKey) {
        Head 'Proving the new key through the bridge'
        # The way a cloud thread goes: connect.js as the ProxyCommand with the
        # token in its environment, the new key, and the box's host key checked
        # as every script checks it. The token is in this process's environment
        # for the length of the call and on no command line.
        $env:THORNSWOOD_BOX_TOKEN = $token
        $env:THORNSWOOD_BOX_URL = $BoxUrl
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        # A notices key runs say-staff.ps1 whatever is asked; with nothing on
        # its input (-n) that says READY and writes nothing. A deploy key
        # logs in as the gate's account and runs Gate.ps1 whatever is asked,
        # so the command is refused and ping answers GATE READY.
        $proved = if ($NoticesOnly) { '^READY$' } elseif ($Deploy) { '^\| GATE READY' } else { 'THORNSWOOD_OK' }
        $proofTarget = if ($Deploy) { "$GateUser@$VpsHost" } else { $target }
        $asks = if ($Deploy) { @('echo THORNSWOOD_OK', 'ping') } else { @('echo THORNSWOOD_OK') }
        $proof = @()
        foreach ($ask in $asks) {
            $proof += @(Invoke-ThornswoodNative {
                & ssh -n -F none -i $newKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 `
                    -o ("ProxyCommand=`"" + $node.Source + "`" `"" + (Join-Path $BridgeDir 'connect.js') + "`"") $proofTarget $ask
            } 2>&1 | ForEach-Object { "$_".Trim() })
        }
        $ErrorActionPreference = $old
        Remove-Item Env:THORNSWOOD_BOX_TOKEN, Env:THORNSWOOD_BOX_URL -ErrorAction SilentlyContinue
        if (($NoticesOnly -or $Deploy) -and @($proof | Where-Object { $_ -match 'THORNSWOOD_OK' }).Count) {
            Die "the box ran the command it was asked for, so the key's forced command is not holding and the key can do anything. No file was written. Take it off now: .\scripts\vps\Grant-BoxAccess.ps1 -Name $Name -Remove"
        }
        if (-not @($proof | Where-Object { $_ -match $proved }).Count) {
            $proof | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }
            Die "it did not get in, so no file was written. Its key and token are on the box; run this again once the lines above are dealt with, or -Name $Name -Remove to take them off."
        }
        $ran = if ($Deploy) { 'the gate refused a command and answered ping' } else { 'it ran say-staff.ps1 and nothing else' }
        if ($ToEnvironment) {
            Say "  ssh through the bridge with the new key got in, and $ran" 'Green'
            Head "The key into the GitHub environment $ToEnvironment"
            # On gh's standard input: no file holds it and no command line shows it.
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $set = @([Convert]::ToBase64String([IO.File]::ReadAllBytes($newKey)) | & gh secret set $SecretName --env $ToEnvironment --repo $GitHubRepo 2>&1 | ForEach-Object { "$_" })
            $setCode = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($setCode -ne 0) { Die ("GitHub refused the secret: " + ($set -join ' ') + " The key is on the box and holds nowhere else; run this again, which replaces it, or -Name $Name -Remove.") }
            Say "  $SecretName in $ToEnvironment, which only main may use. Nothing here holds it." 'Green'
            if ($Deploy) { Say "  Any session now runs a gate verb with scripts/vps/Box-Run.ps1 <verb> [switches], through box-run.yml on $GitHubRepo." 'White' }
            else { Say "  A session with no ssh now posts with scripts/ops/Say-Staff.ps1 -Text `"...`", as $Name, through staff-notice.yml on $GitHubRepo." 'White' }
        } elseif ($Deploy) {
            Say "  ssh through the bridge with the new key got in, and $ran" 'Green'
            $out = Join-Path $OutDir 'deploy-access.txt'
            Write-ThornswoodPrivateFile -Path $out -Text ("THORNSWOOD_DESK_KEY_B64=" + [Convert]::ToBase64String([IO.File]::ReadAllBytes($newKey)) + "`n")
            Head "The file for $Name"
            Say "  $out" 'Green'
            Say '  It is for a runner on the box, where Box-Run.ps1 -OnTheBox reads it; the key is taken only from 127.0.0.1. Delete the file once it is placed.' 'White'
        } elseif ($NoticesOnly) {
            Say '  ssh through the bridge with the new key got in, and it ran say-staff.ps1 and nothing else' 'Green'
            $out = Join-Path $OutDir 'notice-access.txt'
            Write-ThornswoodPrivateFile -Path $out -Text ("THORNSWOOD_NOTICE_KEY_B64=" + [Convert]::ToBase64String([IO.File]::ReadAllBytes($newKey)) + "`nTHORNSWOOD_NOTICE_TOKEN=$token`n")
            Head "The file for $Name's environment"
            Say "  $out" 'Green'
            Say "  Its two lines go into the environment variables of the agent named $Name, as they are. Then delete the file." 'White'
            Say '  There, scripts/ops/Say-Staff.ps1 -Text "..." posts a notice in #staff-updates with them.' 'White'
        } else {
            Say '  ssh through the bridge with the new key got in' 'Green'
            $out = Join-Path $OutDir 'cloud-access.txt'
            Write-ThornswoodPrivateFile -Path $out -Text ("THORNSWOOD_BOX_KEY_B64=" + [Convert]::ToBase64String([IO.File]::ReadAllBytes($newKey)) + "`nTHORNSWOOD_BOX_TOKEN=$token`n")
            Head 'The file for the cloud environment'
            Say "  $out" 'Green'
            Say '  Its two lines go into the cloud environment''s variables as they are: Project settings, Cloud environment, the gear' 'White'
            Say '  beside the environment. Then delete the file. A new cloud session picks them up and runs scripts/vps/Setup-CloudSsh.ps1.' 'White'
        }
    } else {
        $out = Join-Path (Join-Path $OutDir $Name) 'box-token.txt'
        Write-ThornswoodPrivateFile -Path $out -Text ($token + "`n")
        Head "$Name's token"
        Say "  $out" 'Green'
        Say "  Send what is in it to $Name alone (a Discord DM), then delete the file and its folder. They paste it when" 'White'
        Say '  .\scripts\vps\Setup-SshKey.ps1 asks, on their own PC. It opens nothing without their private key.' 'White'
    }
    $token = $null
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done 0
