<#
  Renew-BoxKey.ps1

  Gives one of the two keys a workflow of the ops repository holds a new key
  pair, on the box, and puts the new private half straight into that
  workflow's GitHub environment (#2862, Patrick's A on the report page's
  q-retire-box-keys, 31 Oct 2026: box keys are renewed from the cloud, never
  made new, and never from One). The deploy gate's verb Renew-BoxKey runs it,
  as SYSTEM, so a cloud session renews a key with

      pwsh scripts/vps/Box-Run.ps1 Renew-BoxKey -Which desk      the desk key: box-run.yml's DESK_KEY_B64
      pwsh scripts/vps/Box-Run.ps1 Renew-BoxKey -Which notices   the notices key: staff-notice.yml's NOTICE_KEY_B64

  Until now only Grant-BoxAccess.ps1 -MakeKey -ToEnvironment on One did it.

  RENEW ONLY. Each -Which is one key the box already holds, fixed here: its
  name, the file its line is in, the environment and secret it goes into.
  The new line takes the old line's options word for word (from="127.0.0.1",
  restrict, and the forced command: the deploy gate for desk, say-staff.ps1
  as claude for notices), but for the forced command's program, which is
  pwsh since #5356 where an older line named powershell.exe. The run stops,
  changing nothing, when there is no such line or its options are not
  those. No new name, person, file or
  environment can come of it; Grant-BoxAccess.ps1 stays the way to make one.
  The private half is written nowhere but a folder only SYSTEM and
  Administrators may open, for the length of the run, and into the secret by
  gh's standard input; nothing prints it.

  THE ORDER, so the key that works is never taken away before its successor
  is proved:
    1. the box admin App's token for the ops repository's environments
       (scripts\vps\admin\ops-access.js keys, Environments write and nothing
       more), and a read that the environment lets in main alone, so no
       branch's workflow can read what goes into it. Nothing has changed yet.
    2. a new ed25519 pair, and its line put on BESIDE the old one.
    3. a new login with it, from this box to its own sshd on 127.0.0.1, its
       host key held to scripts\vps\vps.json's pins. The forced command has
       to answer as itself and must not run the command asked for: say-staff
       says READY to an empty input; the gate's Gate.ps1 says the broker did
       not answer, because the broker is busy running this very verb (or
       GATE READY, were it free). sshd refusing the key ends it here.
    4. the new private half into the secret, with gh and that token.
    5. only then the old line comes off, and the file is read back.
  A failure before 5 puts the key file back byte for byte, so the old key
  works as before and the secret is unchanged (a failure in 4 means GitHub
  refused it). The next box-run.yml or staff-notice.yml run is the proof
  that the secret holds the new key; before it, nothing else holds it.

  It stops when the put back of a Grant-BoxAccess.ps1 run is still armed
  ("Thornswood box access put back"), which would put an older key file
  back over this change ten minutes after that run.

  PowerShell 7 (the gate runs its verbs with it).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('desk', 'notices')][string]$Which,
    [string]$AdminState = 'C:\Thornswood-Admin\state',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $Here '..\..'))
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Lock-Folder.ps1')
. (Join-Path $Here 'admin\ShipAccess.ps1')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# Each key this can renew, and all it can renew. Where it goes on GitHub is
# fixed here, never said by the caller.
$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
$Kinds = @{
    desk    = @{ Name = 'desk'; Environment = 'desk'; Secret = 'DESK_KEY_B64'; User = 'thornswood-deploy'; Gate = $true;
                 Proved = '^(@REFUSED the gate broker did not answer|\| GATE READY)' }
    notices = @{ Name = 'claude'; Environment = 'notices'; Secret = 'NOTICE_KEY_B64'; User = ''; Gate = $false;
                 Proved = '^READY$' }
}
$K = $Kinds[$Which]
$PutBack = 'Thornswood box access put back'

if ($env:THORNSWOOD_GATE -ne '1') { Die 'this runs on the box through the deploy gate: pwsh scripts/vps/Box-Run.ps1 Renew-BoxKey -Which desk (or notices). Nothing was changed.' }
if (Get-ScheduledTask -TaskName $PutBack -ErrorAction SilentlyContinue) { Die "the put back of a Grant-BoxAccess.ps1 run is still armed ('$PutBack'), and it would put an older key file back over this change. Run this again once it has run or been cancelled. Nothing was changed." }
# The OpenSSH client the gate itself found (Install-Gate.ps1), and its ssh-keygen beside it.
$ssh = @(@((Get-Command ssh.exe -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })) + @((Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) | Select-Object -First 1
if (-not $ssh) { Die 'there is no ssh.exe on the box. Nothing was changed.' }
$keygen = Join-Path (Split-Path -Parent $ssh) 'ssh-keygen.exe'
if (-not (Test-Path -LiteralPath $keygen)) { Die "there is no ssh-keygen.exe beside $ssh. Nothing was changed." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'gh is not on the gate''s PATH (Install-Gate.ps1 pins it). Nothing was changed.' }

# ------------------------------------------------------------ the old line --
$pinned = Get-ThornswoodVpsCommitted
if ($K.Gate) {
    $gu = Get-LocalUser -Name $K.User -ErrorAction SilentlyContinue
    $pl = if ($gu) { 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $gu.SID.Value } else { '' }
    if (-not $pl -or -not (Test-Path -LiteralPath $pl)) { Die ('there is no account ' + $K.User + ' with a profile on the box. Nothing was changed.') }
    $KeysFile = Join-Path (Get-ItemProperty -LiteralPath $pl).ProfileImagePath '.ssh\authorized_keys'
} else {
    $KeysFile = 'C:\ProgramData\ssh\administrators_authorized_keys'
    $K.User = [string]$pinned.user
    if (-not $K.User) { $K.User = 'Administrator' }
}
if (-not (Test-Path -LiteralPath $KeysFile)) { Die "$KeysFile is not there, so there is no key to renew. Nothing was changed." }
$tag = ' thornswood-' + $K.Name
$have = @([IO.File]::ReadAllLines($KeysFile) | Where-Object { $_.Trim() })
$old = @($have | Where-Object { (' ' + $_.Trim() + ' ').EndsWith($tag + ' ') })

# A line in parts: its options and its key ("type key").
function Split-KeyLine([string]$Line) {
    $m = [regex]::Match($Line.Trim(), '^(?<opts>(?:[A-Za-z-]+(?:="(?:[^"\\]|\\.)*")?)(?:,(?:[A-Za-z-]+(?:="(?:[^"\\]|\\.)*")?))*)\s+(?<key>ssh-ed25519 [A-Za-z0-9+/=]+) thornswood-[a-z0-9-]+$')
    if (-not $m.Success) { return $null }
    return [pscustomobject]@{ Options = $m.Groups['opts'].Value; Key = $m.Groups['key'].Value }
}
if (-not $old.Count) { Die ("the box holds no key named thornswood-" + $K.Name + " in $KeysFile, and this only renews one that is there. Grant-BoxAccess.ps1 makes a new one. Nothing was changed.") }
$parts = @($old | ForEach-Object { Split-KeyLine $_ })
if (@($parts | Where-Object { -not $_ }).Count) { Die ("a line for thornswood-" + $K.Name + " is not the shape this renews (options, an ed25519 key, its name). Nothing was changed.") }
$opts = @($parts | ForEach-Object { $_.Options } | Select-Object -Unique)
if ($opts.Count -ne 1) { Die ("the lines for thornswood-" + $K.Name + " carry different options, so which to keep is not this script's to choose. Nothing was changed.") }
$opts = [string]$opts[0]
# The forced command's program is PowerShell 7 (#5356): a line Grant-BoxAccess
# made before then starts Windows PowerShell, and its renewed line starts
# pwsh with the same arguments. The login below proves pwsh runs it.
$opts = $opts -replace '(^|,)command="powershell\.exe ', '$1command="pwsh '
$wantCommand = if ($K.Gate) { 'command="[^"]*-File C:\\Thornswood-Gate\\Gate\.ps1"' } else { 'command="[^"]*\\say-staff\.ps1 -From ' + $K.Name + '"' }
foreach ($need in '(^|,)from="127\.0\.0\.1"(,|$)', '(^|,)restrict(,|$)', ('(^|,)' + $wantCommand + '(,|$)')) {
    if ($opts -notmatch $need) { Die ("the line for thornswood-" + $K.Name + " lacks what it must hold (from=""127.0.0.1"", restrict and its forced command), so a key renewed from it could do more than the old one. Nothing was changed.") }
}
foreach ($p in $parts) { Say ('  now   ' + (Get-ThornswoodSshFingerprint ('x ' + $p.Key)) + '  thornswood-' + $K.Name) }

# ------------------------------------------------------------- the token --
Head "Where it goes: $($K.Secret) in the $($K.Environment) environment of $GitHubRepo"
try { $env:GH_TOKEN = Get-ThornswoodOpsAccess -Repo $RepoRoot -For keys -AdminState $AdminState }
catch { Die ('the box admin App gave no token for the environments of ' + $GitHubRepo + ': ' + $_.Exception.Message + ' Nothing was changed.') }
function Invoke-Api([string]$Path) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& gh api $Path 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($c -ne 0) { Die ("GitHub did not answer $Path`: " + ($o -join ' ') + ' Nothing was changed.') }
    return (($o -join "`n") | ConvertFrom-Json)
}
$base = "repos/$GitHubRepo/environments/$($K.Environment)"
$envNow = Invoke-Api $base
$policy = $envNow.deployment_branch_policy
if (-not $policy -or -not $policy.custom_branch_policies -or $policy.protected_branches) { Die ("the environment $($K.Environment) does not let in main alone, so a workflow on another branch could read the key. Grant-BoxAccess.ps1 -ToEnvironment sets that. Nothing was changed.") }
$branches = @((Invoke-Api "$base/deployment-branch-policies?per_page=100").branch_policies)
if ($branches.Count -ne 1 -or $branches[0].name -ne 'main' -or $branches[0].type -ne 'branch') { Die ("the environment $($K.Environment) lets in " + (@($branches | ForEach-Object { $_.type + ' ' + $_.name }) -join ', ') + ', not main alone. Nothing was changed.') }
Say "  the token, for that repository's environments alone; $($K.Environment) lets in main alone" 'Green'

$work = Join-Path 'C:\ProgramData\ssh' ('renew-' + [Guid]::NewGuid().ToString('N'))
$before = [IO.File]::ReadAllBytes($KeysFile)
$changed = $false
$done = $false
try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Lock-ThornswoodFolder -Path $work -Only
    # ---------------------------------------------------------- the new key --
    Head 'A new key, beside the old one'
    $keyFile = Join-Path $work 'key'
    # An empty passphrase through PowerShell: '""' in some versions and '' in
    # others (Setup-SshKey.ps1 says why), so both are tried and proved.
    $made = $false
    foreach ($empty in '', '""') {
        Remove-Item -LiteralPath $keyFile, "$keyFile.pub" -Force -ErrorAction SilentlyContinue
        $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & $keygen -q -t ed25519 -N $empty -C ('thornswood-' + $K.Name) -f $keyFile 2>&1 | Out-Null
        if (Test-Path -LiteralPath "$keyFile.pub") { & $keygen -y -P '' -f $keyFile 2>&1 | Out-Null; $made = ($LASTEXITCODE -eq 0) }
        $ErrorActionPreference = $was
        if ($made) { break }
    }
    if (-not $made) { Die 'ssh-keygen made no key without a passphrase. Nothing was changed.' }
    $bare = (([IO.File]::ReadAllText("$keyFile.pub")).Trim() -split '\s+')[0..1] -join ' '
    $newLine = $opts + ' ' + $bare + $tag
    $newPrint = Get-ThornswoodSshFingerprint ('x ' + $bare)
    # In place, so the file keeps its own access rules; no byte order mark,
    # which sshd would not read past.
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($KeysFile, [string[]](@($have) + $newLine), $utf8)
    $changed = $true
    Say "  new   $newPrint  thornswood-$($K.Name), with the old line's options" 'Green'

    # ----------------------------------------------------------- the proof --
    Head 'A new login with it, on the box''s own sshd'
    $knownHosts = Join-Path $work 'known_hosts'
    try { $null = Add-ThornswoodKnownHost -Address '127.0.0.1' -KnownHosts $knownHosts -Pinned @($pinned.hostKeys) }
    catch { Die ('the box''s own sshd on 127.0.0.1: ' + $_.Exception.Message + ' The key file is put back.') }
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $proof = @(& $ssh -n -F none -i $keyFile -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ("UserKnownHostsFile=" + $knownHosts) -o ConnectTimeout=20 ($K.User + '@127.0.0.1') 'echo THORNSWOOD_OK' 2>&1 | ForEach-Object { "$_".Trim() })
    $ErrorActionPreference = $was
    if (@($proof | Where-Object { $_ -match 'THORNSWOOD_OK' }).Count) { Die 'the box ran the command it was asked for, so the forced command is not holding. The key file is put back as it was; nothing else changed.' }
    if (-not @($proof | Where-Object { $_ -match $K.Proved }).Count) {
        $proof | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }
        Die 'sshd did not take the new key and run its forced command (the lines above say what it said). The key file is put back as it was; nothing else changed.'
    }
    Say ('  sshd took it and ran ' + $(if ($K.Gate) { 'the gate''s Gate.ps1' } else { 'say-staff.ps1' }) + ' and nothing else') 'Green'

    # ---------------------------------------------------------- the secret --
    Head "The new key into $($K.Secret)"
    # On gh's standard input: no command line shows it and no other file holds it.
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $set = @([Convert]::ToBase64String([IO.File]::ReadAllBytes($keyFile)) | & gh secret set $K.Secret --env $K.Environment --repo $GitHubRepo 2>&1 | ForEach-Object { "$_" })
    $setCode = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($setCode -ne 0) { Die ('GitHub refused the secret: ' + ($set -join ' ') + ' The key file is put back as it was, so the old key works and the secret is as it was.') }
    Say "  $($K.Secret) in $($K.Environment) holds the new key" 'Green'

    # ------------------------------------------------------- the old one off --
    Head 'The old key off'
    [IO.File]::WriteAllLines($KeysFile, [string[]](@($have | Where-Object { $old -notcontains $_ }) + $newLine), $utf8)
    $done = $true
    $now = @([IO.File]::ReadAllLines($KeysFile) | Where-Object { (' ' + $_.Trim() + ' ').EndsWith($tag + ' ') })
    if ($now.Count -ne 1 -or $now[0] -ne $newLine) { Die ("$KeysFile does not read back with the new line alone for thornswood-" + $K.Name + '. The secret holds the new key; Grant-BoxAccess.ps1 -List shows what is there.') }
    Say ('  ' + $old.Count + ' old line(s) off; thornswood-' + $K.Name + " is $newPrint alone") 'Green'
    Say ''
    Say ("  The next $(if ($K.Gate) { 'box-run.yml' } else { 'staff-notice.yml' }) run uses the new key, and is the proof the secret holds it.") 'White'
}
finally {
    if ($changed -and -not $done) { [IO.File]::WriteAllBytes($KeysFile, $before) }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath Env:\GH_TOKEN -ErrorAction SilentlyContinue
}
exit 0
