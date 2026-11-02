<#
  Install-Gate.ps1

  Puts the deploy gate on the box (#2841): the account thornswood-deploy,
  which has no administrator rights, its forced command, and the broker that
  runs the verbs. Run it on One, whose own way into the box is
  Administrator, with gh signed in as an admin of the repository. It changes
  no key anybody holds, and nobody can use the gate until
  Grant-BoxAccess.ps1 -Deploy gives a key to it.

      .\scripts\deploy\Install-Gate.ps1            install it, or this commit of it
      .\scripts\deploy\Install-Gate.ps1 -Status    what is there, read only

  WHAT THE GATE IS (Patrick's pick on #2841, 25 Oct 2026: a restricted,
  non-admin deploy account whose key runs one dispatcher with only the named
  Deploy, Install and Get-Logs verbs, held only by the release desk):
    thornswood-deploy   a local account in no group. Its authorized_keys,
                        which only SYSTEM and Administrators may change,
                        holds the desk's key with
                        restrict,from="127.0.0.1",command=<Gate.ps1>, so the
                        key runs Gate.ps1 and nothing else, and only from the
                        box itself (a box runner, or the bridge).
    Gate.ps1            hands the line it was asked to the broker over the
                        pipe \\.\pipe\thornswood-gate and prints the answer.
    GateBroker.ps1      the task "Thornswood Gate", SYSTEM from boot: holds
                        the line to main's verbs.json (GateRules.ps1), pulls the tip
                        of main with a read-only GitHub deploy key, and runs
                        that verb's script from main, which reaches the box as
                        Administrator over loopback with the gate's own key
                        (thornswood-gate, from="127.0.0.1"). Section 2a of the
                        ops repo's DEPLOY-IDENTITIES.md says why the deploys'
                        box halves need administrator.
  So a stolen desk key can run main's named deploys with the allowed
  switches, and nothing else: no shell, no file copy, no other script,
  branch or commit.

  WHAT IT DOES ON THE BOX, each step only when it is not already so:
    C:\Thornswood-Gate         locked to SYSTEM and Administrators;
                               Gate.ps1 readable by thornswood-deploy
                               keys\    the GitHub deploy key, the gate's box
                                        key and their known_hosts
                               log\, runs\  the broker's record
                               tools\gh-<version>\  the GitHub CLI the Ship
                                        verbs sign through, pinned by its
                                        SHA-256 (Ship-OnBox.ps1)
    the account and its profile, made with Windows' CreateProfile so sshd
    finds its .ssh folder; authorized_keys left as it is, or empty
    administrators_authorized_keys   the gate's line, thornswood-gate,
                               replacing an older one; every other line stays
    SYSTEM's .ssh\config       a block, between two marker lines, sending
                               the box's address to 127.0.0.1 with the gate's
                               key and the box's host keys as vps.json pins them
    the task Thornswood Gate   registered again and started
  Then, here, the deploy key goes on the repository through gh, read only,
  titled "thornswood-gate (box, read only)", replacing an older one of that
  title.

  WHAT IT SENDS. The gate's three files out of HEAD (git show), never the
  working tree, so it stops when they have uncommitted changes. Nothing
  secret leaves this machine: the two keys are made on the box and only
  their public halves come back.
#>
[CmdletBinding()]
param(
    [string]$VpsHost = '',
    [string]$VpsUser = '',
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood',
    [switch]$Status,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$Vps = Join-Path (Split-Path -Parent $Here) 'vps'
. (Join-Path $Vps 'Vps.ps1')
. (Join-Path $Vps 'Send-Script.ps1')
. (Join-Path $Vps 'Lock-Folder.ps1')
# The hold the install writes while it has the gate stopped (#5155).
. (Join-Path $Vps 'ServerHold.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$Root = 'C:\Thornswood-Gate'
$TaskName = 'Thornswood Gate'
$DeployUser = 'thornswood-deploy'
$KeyTitle = 'thornswood-gate (box, read only)'
$Remote = "ssh://git@ssh.github.com:443/$GitHubRepo.git"
# Not verbs.json: the broker reads main's own at each run (Patrick's A, 30 Oct
# 2026), so a merged verb needs no install.
$Files = @('scripts/vps/gate/Gate.ps1', 'scripts/vps/gate/GateBroker.ps1', 'scripts/vps/gate/GateRules.ps1')
# The GitHub CLI the Ship verbs sign through (Ship-OnBox.ps1), pinned: bump
# both together from https://github.com/cli/cli/releases, the windows_amd64
# line of that release's checksums file.
$GhVersion = '2.89.0'
$GhSha = 'F3326F6406C98C99701B257D77E2B040EEDF83D0176C2C2E9809AA339CEB467E'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Here)

function Clean($lines) {
    @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -notmatch 'post-quantum|store now, decrypt later|openssh\.com/pq\.html' })
}

# gh, with a JSON body on its standard input when there is one.
function Invoke-GitHub([string]$Method, [string]$Path, [string]$Body = '') {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if ($Body) { $o = @($Body | & gh api -X $Method $Path --input - 2>&1 | ForEach-Object { "$_" }) }
    else { $o = @(& gh api -X $Method $Path 2>&1 | ForEach-Object { "$_" }) }
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = ($c -eq 0); Text = ($o -join "`n") }
}

# ------------------------------------------------------------ read only ---
function Get-GateStatusScript {
    return @"
`$ErrorActionPreference = 'SilentlyContinue'
`$u = Get-LocalUser -Name '$DeployUser'
if (`$u) { 'ACCOUNT ' + `$u.SID.Value + ' enabled=' + `$u.Enabled + ' admin=' + [bool](Get-LocalGroupMember -Group Administrators | Where-Object { `$_.SID.Value -eq `$u.SID.Value }) } else { 'ACCOUNT none' }
`$t = Get-ScheduledTask -TaskName '$TaskName'
if (`$t) { 'TASK ' + `$t.State + ' as ' + `$t.Principal.UserId } else { 'TASK none' }
`$cfg = '$Root\gate.json'
if (Test-Path -LiteralPath `$cfg) { 'INSTALLED ' + ((Get-Content -LiteralPath `$cfg -Raw | ConvertFrom-Json).commit) }
`$log = '$Root\log\gate.log'
if (Test-Path -LiteralPath `$log) { Get-Content -LiteralPath `$log -Tail 5 | ForEach-Object { 'LOG ' + `$_ } }
'STATUS'
"@
}

# ------------------------------------------------------------ the change ---
# One script, sent as a whole file (Send-Script.ps1 copies it by scp when it
# is long). It says CHANGED or ALREADY per step, STOP and exits 1 when a
# step cannot be done, and DONE at the end.
function Get-GateInstallScript([hashtable]$Content, [string]$Commit, [string[]]$GitHubHosts, [string[]]$Pins, [string]$Address) {
    $lock = 'function Lock-ThornswoodFolder {' + ${function:Lock-ThornswoodFolder}.ToString() + '}'
    $files = ($Content.Keys | ForEach-Object { "@{ Name = '" + (Split-Path -Leaf $_) + "'; B64 = '" + $Content[$_] + "' }" }) -join ",`n    "
    $gh = ($GitHubHosts | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $pinned = ($Pins | ForEach-Object { "'" + $_ + "'" }) -join ', '
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$root = '$Root'
`$user = '$DeployUser'
`$task = '$TaskName'
`$utf8 = New-Object Text.UTF8Encoding(`$false)
$lock

# ---- the tools the broker runs, as SYSTEM sees them
`$pwsh = Join-Path `$env:ProgramFiles 'PowerShell\7\pwsh.exe'
if (-not (Test-Path -LiteralPath `$pwsh)) { 'STOP there is no PowerShell 7 at ' + `$pwsh + ', and the verbs run under it. Nothing was changed.'; exit 1 }
`$git = @(@((Get-Command git.exe -CommandType Application -EA SilentlyContinue | ForEach-Object { `$_.Source })) + @((Join-Path `$env:ProgramFiles 'Git\cmd\git.exe')) | Where-Object { `$_ -and (Test-Path -LiteralPath `$_) }) | Select-Object -First 1
if (-not `$git) { 'STOP there is no git on the box for the broker to read main with. Nothing was changed.'; exit 1 }
`$ssh = @(@((Get-Command ssh.exe -CommandType Application -EA SilentlyContinue | ForEach-Object { `$_.Source })) + @((Join-Path `$env:SystemRoot 'System32\OpenSSH\ssh.exe')) | Where-Object { `$_ -and (Test-Path -LiteralPath `$_) }) | Select-Object -First 1
if (-not `$ssh) { 'STOP there is no ssh client on the box. Nothing was changed.'; exit 1 }
`$keygen = Join-Path (Split-Path -Parent `$ssh) 'ssh-keygen.exe'
'ALREADY PowerShell 7, git and ssh: ' + `$pwsh + ', ' + `$git + ', ' + `$ssh

# ---- the folder, SYSTEM and Administrators only
foreach (`$d in `$root, (Join-Path `$root 'keys'), (Join-Path `$root 'log'), (Join-Path `$root 'runs')) {
  if (-not (Test-Path -LiteralPath `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null }
}
Lock-ThornswoodFolder -Path `$root -Only
foreach (`$d in (Join-Path `$root 'keys'), (Join-Path `$root 'log'), (Join-Path `$root 'runs')) { Lock-ThornswoodFolder -Path `$d -Only }
'CHANGED ' + `$root + ' locked to SYSTEM and Administrators'

# ---- the account: in no group, a password nobody is told
`$u = Get-LocalUser -Name `$user -EA SilentlyContinue
if (-not `$u) {
  `$bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes(`$bytes)
  `$pw = ConvertTo-SecureString ([Convert]::ToBase64String(`$bytes) + 'aA1!') -AsPlainText -Force
  # New-LocalUser refuses a description over 48 characters (29 Oct: the
  # first install stopped here). tests\test-local-accounts.ps1 holds it.
  `$u = New-LocalUser -Name `$user -Password `$pw -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description 'Thornswood deploy gate (#2841), Gate.ps1 only'
  `$pw = `$null
  'CHANGED made the account ' + `$user + ', in no group'
} else { 'ALREADY the account ' + `$user }
foreach (`$g in Get-LocalGroup) {
  if (@(Get-LocalGroupMember -Group `$g.Name -EA SilentlyContinue | Where-Object { `$_.SID.Value -eq `$u.SID.Value }).Count) { Remove-LocalGroupMember -Group `$g.Name -Member `$u.SID.Value; 'CHANGED took ' + `$user + ' out of ' + `$g.Name }
}
`$sid = `$u.SID.Value

# ---- its profile, where sshd looks for .ssh\authorized_keys
`$pl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + `$sid
if (-not (Test-Path -LiteralPath `$pl)) {
  Add-Type -Namespace Thornswood -Name Profile -MemberDefinition '[DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int CreateProfile(string sid, string name, System.Text.StringBuilder path, uint size);'
  `$sb = New-Object Text.StringBuilder 260
  `$hr = [Thornswood.Profile]::CreateProfile(`$sid, `$user, `$sb, 260)
  if (`$hr -ne 0) { 'STOP Windows did not make the profile of ' + `$user + ' (HRESULT 0x' + `$hr.ToString('X8') + ').'; exit 1 }
  'CHANGED made the profile ' + `$sb.ToString()
}
`$prof = (Get-ItemProperty -LiteralPath `$pl).ProfileImagePath
`$dot = Join-Path `$prof '.ssh'
`$ak = Join-Path `$dot 'authorized_keys'
if (-not (Test-Path -LiteralPath `$dot)) { New-Item -ItemType Directory -Path `$dot -Force | Out-Null }
if (-not (Test-Path -LiteralPath `$ak)) { [IO.File]::WriteAllText(`$ak, '', `$utf8) }
# Only SYSTEM and Administrators may change them; the account may read
# them, which sshd needs, and nothing more.
foreach (`$p in `$dot, `$ak) {
  `$isDir = (Get-Item -LiteralPath `$p -Force).PSIsContainer
  `$acl = if (`$isDir) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
  `$acl.SetAccessRuleProtection(`$true, `$false)
  `$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  `$inh = if (`$isDir) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach (`$s in 'S-1-5-18', 'S-1-5-32-544') { `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', `$inh, 'None', 'Allow'))) }
  `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$sid)), 'ReadAndExecute', `$inh, 'None', 'Allow')))
  Set-Acl -LiteralPath `$p -AclObject `$acl
}
'CHANGED ' + `$ak + ': SYSTEM and Administrators change it, ' + `$user + ' reads it'

# ---- the gate's files, from the commit
foreach (`$f in @(
    $files)) {
  [IO.File]::WriteAllBytes((Join-Path `$root `$f.Name), [Convert]::FromBase64String(`$f.B64))
}
`$gate = Join-Path `$root 'Gate.ps1'
`$acl = Get-Acl -LiteralPath `$gate
`$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$sid)), 'ReadAndExecute', 'Allow')))
Set-Acl -LiteralPath `$gate -AclObject `$acl
'CHANGED Gate.ps1, GateBroker.ps1 and GateRules.ps1 from $Commit; ' + `$user + ' may read Gate.ps1 alone'
# The verbs are main's own now, read at each run; an installed copy would only mislead.
if (Test-Path -LiteralPath (Join-Path `$root 'verbs.json')) { Remove-Item -LiteralPath (Join-Path `$root 'verbs.json') -Force; 'CHANGED the installed verbs.json removed: the broker reads main''s' }

# ---- the GitHub CLI the Ship verbs sign through, pinned and checked
`$ghDir = Join-Path `$root ('tools\gh-$GhVersion')
`$gh = Join-Path `$ghDir 'bin\gh.exe'
if (-not (Test-Path -LiteralPath `$gh)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  `$zip = Join-Path `$root 'tools\gh.zip'
  New-Item -ItemType Directory -Path (Split-Path -Parent `$zip) -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cli/cli/releases/download/v$GhVersion/gh_$($GhVersion)_windows_amd64.zip' -OutFile `$zip
  `$got = (Get-FileHash -LiteralPath `$zip -Algorithm SHA256).Hash
  if (`$got -ne '$GhSha') { Remove-Item -LiteralPath `$zip -Force -EA SilentlyContinue; 'STOP the GitHub CLI $GhVersion does not match the SHA-256 its release published (got ' + `$got + '), so it was not installed.'; exit 1 }
  Expand-Archive -LiteralPath `$zip -DestinationPath `$ghDir -Force
  Remove-Item -LiteralPath `$zip -Force
  'CHANGED the GitHub CLI $GhVersion, checksum matched, in ' + `$ghDir
} else { 'ALREADY the GitHub CLI $GhVersion in ' + `$ghDir }

# ---- the keys, made here and never sent anywhere
function New-GateKey([string]`$path, [string]`$comment) {
  if (Test-Path -LiteralPath `$path) { return }
  # Windows PowerShell 5.1 drops an empty argument, so the empty passphrase
  # goes as '""', which reaches ssh-keygen as an empty one; '' is tried too,
  # and each key is proved to open with no passphrase the same way.
  # What ssh-keygen writes to stderr must not stop this under 'Stop' in
  # Windows PowerShell 5.1 before the second way is tried; its exit code and
  # the files it leaves are what count.
  `$ErrorActionPreference = 'Continue'
  foreach (`$empty in '""', '') {
    Remove-Item -LiteralPath `$path, (`$path + '.pub') -Force -EA SilentlyContinue
    & `$keygen -q -t ed25519 -N `$empty -C `$comment -f `$path 2>&1 | Out-Null
    if (Test-Path -LiteralPath (`$path + '.pub')) { & `$keygen -y -P `$empty -f `$path 2>&1 | Out-Null; if (`$LASTEXITCODE -eq 0) { 'CHANGED made ' + `$path; return } }
  }
  'STOP could not make a key without a passphrase at ' + `$path + '.'; exit 1
}
`$ghKey = Join-Path `$root 'keys\github_ed25519'
`$boxKey = Join-Path `$root 'keys\box_ed25519'
New-GateKey `$ghKey 'thornswood-gate-github'
New-GateKey `$boxKey 'thornswood-gate'
# ssh, run by SYSTEM, refuses a private key any account but SYSTEM and
# Administrators may read, and the folder lock also names whoever ran it.
function Set-SystemAdminsOnly([string]`$path) {
  `$a = New-Object Security.AccessControl.FileSecurity
  `$a.SetAccessRuleProtection(`$true, `$false)
  `$a.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  foreach (`$s in 'S-1-5-18', 'S-1-5-32-544') { `$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', 'Allow'))) }
  Set-Acl -LiteralPath `$path -AclObject `$a
}
foreach (`$k in `$ghKey, `$boxKey) { Set-SystemAdminsOnly `$k }
'GITHUBKEY ' + ([IO.File]::ReadAllText(`$ghKey + '.pub').Trim())

# ---- GitHub's host keys, as GitHub's API gave them to One
`$ghHosts = @($gh)
[IO.File]::WriteAllLines((Join-Path `$root 'keys\github_known_hosts'), [string[]](`$ghHosts | ForEach-Object { '[ssh.github.com]:443 ' + `$_ }), `$utf8)
'CHANGED GitHub''s ' + `$ghHosts.Count + ' host key(s) pinned for ssh.github.com:443'

# ---- the box's own host keys, held to vps.json's pins
# Each fingerprint is worked out here, as vps-openssh.ps1's Get-KeyPrint does,
# not by ssh-keygen's -l: the box's OpenSSH no longer reads its old DSA key, and
# what ssh-keygen says about that stops this script under 'Stop' in Windows
# PowerShell 5.1, 2>`$null or not (29 Oct, the second install).
`$pins = @($pinned)
`$lines = @()
`$sha = [Security.Cryptography.SHA256]::Create()
foreach (`$pub in @(Get-ChildItem -LiteralPath (Join-Path `$env:ProgramData 'ssh') -Filter 'ssh_host_*_key.pub')) {
  `$t = @(([IO.File]::ReadAllText(`$pub.FullName).Trim()) -split '\s+')
  if (`$t.Count -lt 2) { continue }
  try { `$blob = [Convert]::FromBase64String(`$t[1]) } catch { continue }
  `$fp = 'SHA256:' + [Convert]::ToBase64String(`$sha.ComputeHash(`$blob)).TrimEnd('=')
  if (`$pins -contains `$fp) { `$lines += ('$Address ' + `$t[0] + ' ' + `$t[1]) }
}
`$sha.Dispose()
if (-not `$lines.Count) { 'STOP none of the box''s host keys is one vps.json pins, so the gate would not know the box. Nothing more was changed.'; exit 1 }
[IO.File]::WriteAllLines((Join-Path `$root 'keys\box_known_hosts'), [string[]]`$lines, `$utf8)
'CHANGED ' + `$lines.Count + ' pinned host key(s) of the box for the gate'

# ---- the gate's own way in as Administrator, from 127.0.0.1 alone
`$keys = Join-Path `$env:ProgramData 'ssh\administrators_authorized_keys'
`$bare = (([IO.File]::ReadAllText(`$boxKey + '.pub').Trim()) -split '\s+')[0..1] -join ' '
`$have = @()
if (Test-Path -LiteralPath `$keys) { `$have = @(Get-Content -LiteralPath `$keys | Where-Object { `$_.Trim() }) }
`$want = 'from="127.0.0.1" ' + `$bare + ' thornswood-gate'
if (`$have -contains `$want) { 'ALREADY the gate''s key line, thornswood-gate' }
else {
  `$after = @(`$have | Where-Object { -not (' ' + `$_.Trim() + ' ').EndsWith(' thornswood-gate ') }) + `$want
  [IO.File]::WriteAllLines(`$keys, [string[]]`$after, `$utf8)
  icacls `$keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
  'CHANGED the gate''s key line, thornswood-gate, taken only from 127.0.0.1; ' + (`$after.Count - 1) + ' other line(s) as they were'
}

# ---- SYSTEM's ssh: the box's address goes to 127.0.0.1 with the gate's key
`$sp = Join-Path `$env:SystemRoot 'System32\config\systemprofile\.ssh'
if (-not (Test-Path -LiteralPath `$sp)) { New-Item -ItemType Directory -Path `$sp -Force | Out-Null }
`$cfgPath = Join-Path `$sp 'config'
`$begin = '# >>> thornswood gate (Install-Gate.ps1)'
`$end = '# <<< thornswood gate'
`$block = @(`$begin, 'Host $Address',
  '  HostName 127.0.0.1', '  HostKeyAlias $Address',
  ('  IdentityFile ' + `$boxKey.Replace('\', '/')), '  IdentitiesOnly yes',
  ('  UserKnownHostsFile ' + (Join-Path `$root 'keys\box_known_hosts').Replace('\', '/')),
  '  StrictHostKeyChecking yes', '  BatchMode yes', `$end)
`$old = @()
if (Test-Path -LiteralPath `$cfgPath) { `$old = @(Get-Content -LiteralPath `$cfgPath) }
`$keep = @(); `$in = `$false
foreach (`$l in `$old) { if (`$l -eq `$begin) { `$in = `$true; continue }; if (`$l -eq `$end) { `$in = `$false; continue }; if (-not `$in) { `$keep += `$l } }
[IO.File]::WriteAllLines(`$cfgPath, [string[]](`$block + `$keep), `$utf8)
Set-SystemAdminsOnly `$cfgPath
foreach (`$k in 'github_known_hosts', 'box_known_hosts') { Set-SystemAdminsOnly (Join-Path `$root ('keys\' + `$k)) }
'CHANGED SYSTEM''s ssh sends $Address to 127.0.0.1 with the gate''s key'

# ---- what the broker reads
[IO.File]::WriteAllText((Join-Path `$root 'gate.json'), ((@{ commit = '$Commit'; git = `$git; pwsh = `$pwsh; ssh = `$ssh; gh = `$gh; remote = '$Remote'; deploySid = `$sid } | ConvertTo-Json)), `$utf8)

# ---- the task, SYSTEM from boot, started again on this commit
# Held from the stop until it is started again (#5155, ServerHold.ps1), like
# every stop on purpose on the box.
$(Get-ThornswoodHoldScript -Script 'Install-Gate.ps1')
Set-ThornswoodHold -Target `$task -Why 'installing the gate broker on a new commit' -By `$HoldBy
`$t = Get-ScheduledTask -TaskName `$task -EA SilentlyContinue
if (`$t) { Stop-ScheduledTask -TaskName `$task -EA SilentlyContinue; Unregister-ScheduledTask -TaskName `$task -Confirm:`$false }
`$action = New-ScheduledTaskAction -Execute `$pwsh -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path `$root 'GateBroker.ps1') + '"')
`$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
`$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName `$task -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal `$principal | Out-Null
Start-ScheduledTask -TaskName `$task
Start-Sleep -Seconds 5
Clear-ThornswoodHold -Target `$task
`$state = (Get-ScheduledTask -TaskName `$task).State
if (`$state -ne 'Running') { 'STOP the task ' + `$task + ' is ' + `$state + ' after its start. Its log: ' + (Join-Path `$root 'log\gate.log'); exit 1 }
'CHANGED the task ' + `$task + ', SYSTEM from boot, running'
'DONE'
"@
}

foreach ($t in 'ssh', 'git', 'gh') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Nothing was changed." }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  the deploy gate' -ForegroundColor White
Say "  $target" 'DarkGray'

if ($Status) {
    Head 'On the box'
    $said = Clean (Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script (Get-GateStatusScript))
    $said | Where-Object { $_ -ne 'STATUS' } | ForEach-Object { Say "  $_" }
    if ($said -notcontains 'STATUS') { Die 'the box did not answer. The lines above say why.' }
    Done 0
}

# ------------------------------------------------------------- the commit ---
Head 'What goes up'
$dirty = @(& git -C $RepoRoot status --porcelain -- $Files 2>&1)
if ($LASTEXITCODE -ne 0) { Die ('git could not read this checkout: ' + ($dirty -join ' ')) }
if ($dirty.Count) { Die ('the gate''s files have uncommitted changes, and only a commit goes to the box: ' + ($dirty -join '; ') + '. Nothing was changed.') }
$commit = (& git -C $RepoRoot rev-parse HEAD).Trim()
$content = @{}
foreach ($f in $Files) {
    # The blob's own bytes: Start-Process writes git's output to the file as
    # it comes, where a PowerShell pipe would decode and re-encode it.
    $tmp = [IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath (Get-Command git).Source -ArgumentList @('-C', "`"$RepoRoot`"", 'cat-file', 'blob', "HEAD:$f") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $tmp
        if ($p.ExitCode -ne 0) { Die "HEAD has no $f. Nothing was changed." }
        $content[$f] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tmp))
    } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
Say "  the gate's four files from $commit" 'Green'

$meta = Invoke-GitHub GET 'meta'
if (-not $meta.Ok) { Die ('GitHub did not give its ssh host keys: ' + $meta.Text + ' Nothing was changed.') }
$ghHosts = @(($meta.Text | ConvertFrom-Json).ssh_keys | Where-Object { $_ -match '^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+$' })
if (-not $ghHosts.Count) { Die 'GitHub''s API listed no ssh host keys. Nothing was changed.' }
$pins = @(Get-ThornswoodVpsHostKeys)
if (-not $pins.Count) { Die 'scripts\vps\vps.json pins no host keys. Nothing was changed.' }

# ------------------------------------------------------------------ box ----
Head 'On the box'
$said = Clean (Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script (Get-GateInstallScript $content $commit $ghHosts $pins $VpsHost))
foreach ($l in $said) {
    if ($l -like 'GITHUBKEY *') { continue }
    Say "  $l" $(if ($l -like 'STOP*') { 'Red' } elseif ($l -like 'CHANGED*') { 'Green' } else { 'Gray' })
}
if ($said -notcontains 'DONE') { Die 'the box did not finish. The lines above say how far it got; running this again picks up from there.' }
$ghPub = @($said | Where-Object { $_ -like 'GITHUBKEY *' } | ForEach-Object { $_.Substring(10).Trim() }) | Select-Object -First 1
$ghBare = (($ghPub -split '\s+')[0..1]) -join ' '
if ($ghBare -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]{68}$') { Die 'the box did not send the public half of its GitHub key.' }

# ------------------------------------------------------------- GitHub ------
Head 'The deploy key on GitHub, read only'
$list = Invoke-GitHub GET "repos/$GitHubRepo/keys?per_page=100"
if (-not $list.Ok) { Die ('GitHub did not list the repository''s deploy keys: ' + $list.Text) }
$have = @(($list.Text | ConvertFrom-Json) | Where-Object { $_.title -eq $KeyTitle })
$same = @($have | Where-Object { ((($_.key -split '\s+')[0..1]) -join ' ') -eq $ghBare -and $_.read_only })
if ($same.Count) { Say '  already there, read only' 'Green' }
else {
    foreach ($k in $have) {
        $gone = Invoke-GitHub DELETE "repos/$GitHubRepo/keys/$($k.id)"
        if (-not $gone.Ok) { Die ('GitHub did not remove the older gate key ' + $k.id + ': ' + $gone.Text) }
        Say "  removed the older gate key $($k.id)" 'Yellow'
    }
    $body = @{ title = $KeyTitle; key = $ghBare; read_only = $true } | ConvertTo-Json -Compress
    $add = Invoke-GitHub POST "repos/$GitHubRepo/keys" $body
    if (-not $add.Ok) { Die ('GitHub refused the deploy key: ' + $add.Text) }
    Say "  added, read only: $KeyTitle" 'Green'
}

Head 'Next'
Say '  The gate runs, and nobody can use it yet. Give the release desk its key:' 'White'
Say '      .\scripts\vps\Grant-BoxAccess.ps1 -Name desk -Deploy -MakeKey -ToEnvironment desk' 'White'
Say '  Its proof asks the gate for ping, which reads main through the deploy key.' 'DarkGray'
Done 0
