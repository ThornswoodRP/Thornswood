<#
.SYNOPSIS
  Runs ON THE VPS, read-only: prints what each GitHub Actions runner account can reach (groups, rights on production paths, leftovers in its work folders, firewall rules, setting names) as JSON for Check-RunnerIsolation.ps1, never a secret value (issue #2161).

.DESCRIPTION
  Nothing here writes, starts, stops or changes anything, and no file's
  contents are read: only ACLs, names, sizes and dates. Check-RunnerIsolation
  runs it beside Get-ProdFacts.ps1 (issue #2165), whose listeners say which
  loopback services any account on the box, a runner's included, can reach.

  A read that fails is said, never left empty (#4286): an empty value reads
  as nothing to worry about in Check-RunnerIsolation. The service list stops
  the script if it cannot be read, so an empty list means no runner is
  installed; an account that does not translate keeps an empty SID and no
  firewall count (an empty SID matched every rule); a local group whose
  members cannot be listed is named in groupsUnread; a path whose ACL cannot
  be read is 'not read', and only one that does not exist is 'missing'.

  For each actions.runner.* service:
    account, SID and local groups;
    for each production path in -Paths, which rights its ACL gives that
    account through the account itself or a group it is in (read, write,
    denied), as read from the ACL;
    its runner folder: whether .credentials and .runner exist (never their
    contents), how many folders sit in _work, and files left in _work\_temp
    with the oldest one's age;
    how many Windows Firewall rules name its SID.
  -Define loads the functions without collecting, for the offline test.
#>
[CmdletBinding()]
param(
    [switch]$Define,
    # Every path records\runner-isolation.json lists under noReach and
    # writeOnly; tests\test-runner-isolation.ps1 holds the two together.
    [string[]]$Paths = @(
        'C:\Thornswood-Docs\config.json', 'C:\Thornswood-Docs\feed', 'C:\Thornswood-Docs\feed-dev',
        'C:\Thornswood-Bot\bot.env.json', 'C:\Thornswood-Backup', 'C:\Thornswood-Backup\key.txt',
        'C:\Thornswood-Server\private', 'C:\Thornswood-Server-Dev\private', 'C:\Thornswood-Server\world',
        'C:\Thornswood-Deploys', 'C:\Thornswood-Caddy', 'C:\Thornswood-Watch', 'C:\Thornswood-Admin', 'C:\Thornswood-Agent', 'C:\Thornswood-BotPass', 'C:\Thornswood-Dumps',
        'C:\ProgramData\ssh', 'C:\Users\Administrator')
)

$ReadBits  = [int]([Security.AccessControl.FileSystemRights]'ReadData, ListDirectory, ReadAttributes, ReadExtendedAttributes, ReadPermissions')
$WriteBits = [int]([Security.AccessControl.FileSystemRights]'WriteData, AppendData, WriteAttributes, WriteExtendedAttributes, Delete, ChangePermissions, TakeOwnership')
$ReadDataBit = [int][Security.AccessControl.FileSystemRights]::ReadData
$WriteDataBit = [int][Security.AccessControl.FileSystemRights]::WriteData

# What an ACL gives a set of SIDs, from the rules alone. Deny beats allow for
# the same right. This reads the ACL; it is not Windows' effective access
# (no privileges, no integrity levels, no share), so the report says so.
function Get-AclReach($Rules, [string[]]$Sids) {
    $allow = 0; $deny = 0
    foreach ($r in $Rules) {
        $sid = [string]$r.Sid
        if ($Sids -notcontains $sid) { continue }
        if ([string]$r.Type -eq 'Deny') { $deny = $deny -bor [int]$r.Rights } else { $allow = $allow -bor [int]$r.Rights }
    }
    $eff = $allow -band (-bnot $deny)
    [ordered]@{
        read  = [bool]($eff -band $ReadDataBit)
        write = [bool]($eff -band ($WriteDataBit -bor [int][Security.AccessControl.FileSystemRights]::AppendData))
        denied = [bool]($deny -band ($ReadDataBit -bor $WriteDataBit))
    }
}

# A Get-Acl result as plain rules with SIDs, so the offline test can feed the
# same shape without a real file.
function ConvertTo-PlainRules($Acl) {
    @($Acl.Access | ForEach-Object {
        $sid = try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { [string]$_.IdentityReference }
        [ordered]@{ Sid = $sid; Type = [string]$_.AccessControlType; Rights = [int]$_.FileSystemRights }
    })
}

function Get-RunnerFacts {
    $ErrorActionPreference = 'Stop'
    $runners = @()
    $svcs = @(Get-CimInstance Win32_Service | Where-Object Name -like 'actions.runner.*')
    $localGroups = @(Get-LocalGroup)
    foreach ($s in $svcs) {
        $acct = ([string]$s.StartName) -replace '^\.\\', ''
        $sid = try { (New-Object Security.Principal.NTAccount($acct)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { '' }
        $groups = @(); $unread = @()
        if ($sid) {
            foreach ($g in $localGroups) {
                try { if (@(Get-LocalGroupMember -Group $g | ForEach-Object { [string]$_.SID }) -contains $sid) { $groups += $g.Name } }
                catch { $unread += $g.Name }
            }
        }
        $gsids = @($localGroups | Where-Object { $groups -contains $_.Name } | ForEach-Object { [string]$_.SID })
        # Every service logon also carries Everyone, Authenticated Users and SERVICE.
        $sids = @(@($sid) + $gsids + @('S-1-1-0', 'S-1-5-11', 'S-1-5-6') | Where-Object { $_ })
        $reach = [ordered]@{}
        foreach ($p in $Paths) {
            if (-not (Test-Path -LiteralPath $p)) { $reach[$p] = 'missing'; continue }
            $reach[$p] = try { Get-AclReach (ConvertTo-PlainRules (Get-Acl -LiteralPath $p)) $sids } catch { 'not read' }
        }
        $exe = ([string]$s.PathName).Trim('"') -replace '"?\s.*$', ''
        $root = Split-Path -Parent (Split-Path -Parent $exe)
        $temp = Join-Path $root '_work\_temp'
        $left = @(Get-ChildItem -LiteralPath $temp -Recurse -File -Force -EA SilentlyContinue)
        # With no SID there is nothing to count rules for: an empty one matched every rule.
        $fw = $null
        if ($sid) { $fw = @(Get-NetFirewallRule -PolicyStore ActiveStore | Where-Object { $_.Owner -eq $sid -or ([string]($_ | Get-NetFirewallSecurityFilter).LocalUser) -match [regex]::Escape($sid) }).Count }
        $runners += [ordered]@{
            service = $s.Name; account = $acct; sid = $sid; state = $s.State; groups = $groups; groupsUnread = $unread
            root = $root; hasCredentials = (Test-Path -LiteralPath (Join-Path $root '.credentials'))
            workFolders = @(Get-ChildItem -LiteralPath (Join-Path $root '_work') -Directory -Force -EA SilentlyContinue).Count
            tempLeftFiles = $left.Count
            tempOldestHours = if ($left) { [math]::Round(((Get-Date) - ($left | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime).TotalHours, 1) } else { 0 }
            firewallRules = $fw
            reach = $reach
        }
    }
    $envNames = @([Environment]::GetEnvironmentVariables('Machine').Keys | Where-Object { $_ -match 'THORNSWOOD|TOKEN|KEY|SECRET|PASS|GH_|GITHUB' } | Sort-Object)
    [ordered]@{ takenUtc = (Get-Date).ToUniversalTime().ToString('o'); host = $env:COMPUTERNAME; runners = $runners; machineEnvNames = $envNames }
}

if (-not $Define) { Get-RunnerFacts | ConvertTo-Json -Depth 7 -Compress }
