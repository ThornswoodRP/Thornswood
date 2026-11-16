<#
  test-4077-service-owner.ps1

  Issue #4077: every box service runs as LOCAL SERVICE, and a file a LOCAL
  SERVICE task makes is owned by LOCAL SERVICE, so CREATOR OWNER and the
  owner's own rights reached every service. This holds the fix to what
  scripts\deploy\ServiceAccount.ps1's header says:
    - the task SID worked out from a name is the one Windows gave the box's
      tasks (measured on 27 Oct 2026);
    - the launcher's source compiles, and its action round-trips: the SID,
      then the program and its arguments as they were;
    - every installer that puts a task on LOCAL SERVICE runs
      Set-ThornswoodTaskOwner in the same try as its grants, so a failure
      puts the task back on SYSTEM with its plain action;
    - the site's grants name its task's SID and take LOCAL SERVICE's off,
      its task starts through the launcher, and its start gives it what
      LOCAL SERVICE made; Setup-Domain no longer sets the site's action;
    - on Windows, the launcher is built with the .NET Framework compiler,
      ends with its program's exit code, makes the SID it is given the owner
      of what its program makes, and starts nothing for a SID its token
      does not hold; and, as an elevated Administrator, a scratch folder of
      LOCAL SERVICE files is given to a task SID with CREATOR OWNER's rule
      made again for it.
  The text checks run anywhere; the runs need Windows and say SKIP off it.
  A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Deploy = Join-Path $Repo 'scripts\deploy'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Text([string]$p) { return [IO.File]::ReadAllText($p).Replace("`r`n", "`n") }
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$lib = Join-Path $Deploy 'ServiceAccount.ps1'
. $lib
$sent = Get-ThornswoodServiceAccountScript

# ---- the pieces ----------------------------------------------------------------
foreach ($n in 'Get-ThornswoodTaskSidFromName', 'Get-ThornswoodOwnerLaunchSource', 'Install-ThornswoodOwnerLaunch',
               'New-ThornswoodOwnedAction', 'Get-ThornswoodPlainAction', 'Enable-ThornswoodRestorePrivilege',
               'Get-ThornswoodServiceItemAcl', 'Repair-ThornswoodServiceOwner', 'Set-ThornswoodTaskOwner') {
    Yes "$n goes to the box with the other functions" ($sent.Contains('function ' + $n + ' {'))
}
Yes 'the functions sent to the box parse' ($(try { $null = [scriptblock]::Create($sent); $true } catch { $false }))
Yes 'Thornswood Bridge''s task SID is the one Windows gave it on the box' (
    (Get-ThornswoodTaskSidFromName 'Thornswood Bridge') -eq 'S-1-5-87-1211388278-3493103995-716127635-1752329929-2514242409')
Yes 'Thornswood Docs''s task SID is the one Windows gave it on the box' (
    (Get-ThornswoodTaskSidFromName 'Thornswood Docs') -eq 'S-1-5-87-2225370698-1347417088-938651668-3587368396-959210032')

$src = Get-ThornswoodOwnerLaunchSource
Yes 'the launcher sets the token''s default owner and reads it back' ($src.Contains('SetTokenInformation(token, TokenOwnerClass') -and $src.Contains('EqualSid('))
Yes 'the launcher ends with 77 and starts nothing when the owner cannot be set' ($src.Contains('const int NotStarted = 77;') -and $src.Contains('Nothing was started.'))
Yes 'the launcher lets go of the task''s folder once its program runs' ($src.Contains('Environment.CurrentDirectory = Environment.SystemDirectory;'))
Yes 'the launcher''s source compiles' ($(try { Add-Type -TypeDefinition $src -ErrorAction Stop; $true } catch { Write-Host ('      ' + $_.Exception.Message); $false }))

# The launcher's arguments taken off again: the dev server copies live's action.
$wrapped = [pscustomobject]@{
    Execute = 'C:\Program Files\Thornswood\thornswood-owner-0123456789ab.exe'
    Arguments = 'S-1-5-87-1-2-3-4-5 "C:\Windows\System32\cmd.exe" /c "start "" /b /wait /high "node.exe" x --log "C:\Thornswood-Server\server.log""'
    WorkingDirectory = 'C:\Thornswood-Server'
}
$plain = Get-ThornswoodPlainAction $wrapped
Yes 'an action through the launcher comes back as its program' ($plain.Execute -eq 'C:\Windows\System32\cmd.exe')
Yes 'and its arguments as they were' ($plain.Argument -eq '/c "start "" /b /wait /high "node.exe" x --log "C:\Thornswood-Server\server.log""')
$bare = Get-ThornswoodPlainAction ([pscustomobject]@{ Execute = 'C:\Windows\System32\cmd.exe'; Arguments = '/c x'; WorkingDirectory = 'C:\x' })
Yes 'an action not through the launcher comes back as it is' ($bare.Execute -eq 'C:\Windows\System32\cmd.exe' -and $bare.Argument -eq '/c x')

# ---- the installers ------------------------------------------------------------
# Each puts the launcher on in the same try as its grants, after them, so a
# failure of either takes the existing way back to SYSTEM.
$inTry = '(?s)try\s*\{[^}]*?Grant-ThornswoodServiceFolder[^\n]*\n(?:[^\n]*\n){0,6}?[^\n]*Set-ThornswoodTaskOwner -TaskName'
foreach ($f in 'scripts\deploy\Install-ThornswoodServer.ps1', 'scripts\vps\vps-dev-instance.ps1', 'scripts\deploy\Install-Voice.ps1',
               'scripts\deploy\Install-Bridge.ps1', 'scripts\deploy\Install-AdminService.ps1', 'scripts\deploy\Setup-Domain.ps1') {
    $t = Text (Join-Path $Repo $f)
    Yes "$(Split-Path -Leaf $f) puts the launcher on after the grants, in the same try" ([regex]::IsMatch($t, $inTry))
}
$backup = Text (Join-Path $Deploy 'Install-Backup.ps1')
$bAt = $backup.IndexOf('Set-ThornswoodTaskOwner -TaskName ''$TaskName'' -Sid `$sid -Action `$a -Roots ''$Root''')
$bRead = $backup.IndexOf('''read '' + `$src')
$bSaid = $backup.IndexOf('''on LOCAL SERVICE, Limited, as '' + `$sid')
Yes 'Install-Backup.ps1 puts the launcher on after its grants, before it says the task is on LOCAL SERVICE' (
    $bRead -gt 0 -and $bAt -gt $bRead -and $bSaid -gt $bAt)
$domain = Text (Join-Path $Deploy 'Setup-Domain.ps1')
Yes 'Caddy''s way back to SYSTEM gives the task its plain action back' (
    $domain.Contains("Set-ScheduledTask -TaskName 'Thornswood Web' -Action ``" + '$a -Principal (New-ThornswoodServicePrincipal -AsSystem)'))
Yes 'Setup-Domain.ps1 no longer sets the site''s action, which is Deploy-Docs.ps1''s' (
    -not [regex]::IsMatch($domain, "Set-ScheduledTask -TaskName 'Thornswood Docs' -Action"))
$dev = Text (Join-Path $Repo 'scripts\vps\vps-dev-instance.ps1')
Yes 'the dev server copies live''s action without the launcher and live''s SID' ($dev.Contains('$a = Get-ThornswoodPlainAction $liveTask.Actions[0]'))

# ---- the site ------------------------------------------------------------------
$docs = Text (Join-Path $Deploy 'Deploy-Docs.ps1')
Yes 'the site''s grants name its task''s SID' ($docs.Contains("``" + '$own = Get-ThornswoodTaskSidFromName ''$Task''') -and $docs.Contains("/grant ('*' + ``" + '$own + '':'''))
Yes 'and no longer LOCAL SERVICE' (-not $docs.Contains("/grant ('*' + ``" + '$sid'))
Yes 'its feed deny names its task''s SID and takes LOCAL SERVICE''s off' (
    $docs.Contains("``" + '$who = New-Object Security.Principal.SecurityIdentifier(`$own)') -and
    $docs.Contains("_.IdentityReference.Value -eq 'S-1-5-19' })) { [void]``" + '$acl.RemoveAccessRuleSpecific(`$r) }'))
Yes 'LOCAL SERVICE''s old rules come off every server, chat and deploy-record copy' (
    $docs.Contains("/remove:g '*S-1-5-19'") -and $docs.Contains("Name -like 'Thornswood-Server*'") -and $docs.Contains("Name -like 'Thornswood-Voice*'"))
Yes 'its task starts through the launcher' ($docs.Contains("``" + '$a = New-ThornswoodOwnedAction -Launcher `$launcher -Sid `$own'))
Yes 'its start gives it what LOCAL SERVICE made, with it stopped' ($docs.Contains('try { Repair-ThornswoodServiceOwner -Root $Root -Sid $Owner }'))
Yes 'a deploy with nothing to swap still restarts it onto the launcher' ($docs.Contains("if (`$ownerNew) { `$restartWhy = 'the site starts through the launcher now' }") -and $docs.Contains('if ($restartWhy) {') -and $docs.Contains("'RESTART OK'"))
$server = Text (Join-Path $Deploy 'Install-ThornswoodServer.ps1')
Yes 'the server installer looks for the site''s rule by its task''s SID' ($server.Contains("if (`$siteSid -eq 'S-1-5-19') { `$siteSid = Get-ThornswoodTaskSidFromName 'Thornswood Docs' }"))

if (-not $OnWindows) {
    Write-Host 'SKIP  the launcher''s runs and the repair on scratch folders: the .NET Framework compiler, process tokens and NTFS owners are only on Windows'
    Done
}

# ---- the launcher, run -----------------------------------------------------------
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-4077-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
try {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent()
    # The scratch bin folder stands in for Program Files\Thornswood: it keeps
    # nothing from the temp folder above it, where a build runner's folder
    # gives other accounts FullControl, and has SYSTEM, Administrators and
    # whoever runs this, the one -AlsoMay names.
    $bin = Join-Path $scratch 'bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $binAcl = New-Object Security.AccessControl.DirectorySecurity
    $binAcl.SetAccessRuleProtection($true, $false)
    foreach ($s in @('S-1-5-18', 'S-1-5-32-544', $me.User.Value)) {
        $binAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl',
            [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit', [Security.AccessControl.PropagationFlags]::None, 'Allow')))
    }
    Set-Acl -LiteralPath $bin -AclObject $binAcl
    $exe = Install-ThornswoodOwnerLaunch -Dir (Join-Path $scratch 'bin') -AlsoMay @($me.User.Value)
    Yes 'the launcher builds with the .NET Framework compiler, named by its source''s hash' (
        (Test-Path -LiteralPath $exe) -and (Split-Path -Leaf $exe) -match '^thornswood-owner-[0-9a-f]{12}\.exe$')
    Yes 'a second install uses the one already built' ((Install-ThornswoodOwnerLaunch -Dir (Join-Path $scratch 'bin') -AlsoMay @($me.User.Value)) -eq $exe)
    $refused = $false
    try { $null = Install-ThornswoodOwnerLaunch -Dir (Join-Path $scratch 'bin') } catch { $refused = $_.Exception.Message -match 'could change it' }
    Yes 'it refuses a launcher an account other than SYSTEM, Administrators and TrustedInstaller could change' $refused

    $cmd = Get-WindowsPath 'System32\cmd.exe'
    $work = Join-Path $scratch 'work'
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    # The owner it is given, from this token, and one Windows would not have
    # picked by itself when there is one: an elevated Administrator's default
    # owner is Administrators, so the user's own SID shows the change.
    $want = $me.User.Value
    $p = Start-Process -FilePath $exe -ArgumentList @($want, ('"' + $cmd + '"'), '/c', '"echo made> made.txt & exit 3"') -WorkingDirectory $work -Wait -PassThru -WindowStyle Hidden
    Yes 'the launcher ends with its program''s exit code' ($p.ExitCode -eq 3)
    $made = Join-Path $work 'made.txt'
    Yes 'its program ran in the task''s working directory' (Test-Path -LiteralPath $made)
    if (Test-Path -LiteralPath $made) {
        Yes 'what its program made is owned by the SID it was given' ((Get-Acl -LiteralPath $made).GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $want)
    }
    if ($me.Owner.Value -ne $want) { Yes 'which is not the owner this token gives by itself' $true }
    else { Write-Host 'SKIP  that the owner changed: this token''s own owner is its user already (not an elevated Administrator)' }

    $none = Join-Path $work 'none.txt'
    $p = Start-Process -FilePath $exe -ArgumentList @('S-1-5-87-1-2-3-4-5', ('"' + $cmd + '"'), '/c', '"echo no> none.txt"') -WorkingDirectory $work -Wait -PassThru -WindowStyle Hidden
    Yes 'a SID its token does not hold ends with 77' ($p.ExitCode -eq 77)
    Yes 'and starts nothing' (-not (Test-Path -LiteralPath $none))
    $p = Start-Process -FilePath $exe -ArgumentList @('S-1-5-87-1-2-3-4-5') -WorkingDirectory $work -Wait -PassThru -WindowStyle Hidden
    Yes 'a SID with no program ends with 77' ($p.ExitCode -eq 77)

    $owned = New-ThornswoodOwnedAction -Launcher $exe -Sid $want -Execute $cmd -Argument '/c "x y"' -WorkingDirectory $work
    $back = Get-ThornswoodPlainAction $owned
    Yes 'a task action through the launcher names the launcher, the SID and the program' (
        $owned.Execute -eq $exe -and $owned.Arguments -eq ($want + ' "' + $cmd + '" /c "x y"') -and $owned.WorkingDirectory -eq $work)
    Yes 'and comes back as the program and its arguments' ($back.Execute -eq $cmd -and $back.Argument -eq '/c "x y"')

    # ---- the repair, as an elevated Administrator ------------------------------
    $admin = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
        Write-Host 'SKIP  the repair on a scratch folder: making a file LOCAL SERVICE''s and giving it to a task takes the restore privilege, which only an elevated Administrator holds'
    } else {
        $root = Join-Path $scratch 'svc'
        New-Item -ItemType Directory -Path (Join-Path $root 'world') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $root 'server.log') -Value 'x'
        Set-Content -LiteralPath (Join-Path $root 'world\a.json') -Value 'x'
        $ls = New-Object Security.Principal.SecurityIdentifier('S-1-5-19')
        $co = New-Object Security.Principal.SecurityIdentifier('S-1-3-0')
        $acl = Get-Acl -LiteralPath $root
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($co, 'Modify', 'ContainerInherit, ObjectInherit', 'InheritOnly', 'Allow')))
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($ls, 'ReadAndExecute', 'None', 'None', 'Allow')))
        Set-ThornswoodServiceAcl $root $acl
        Enable-ThornswoodRestorePrivilege
        foreach ($f in 'server.log', 'world\a.json', 'world') {
            $i = Get-Item -LiteralPath (Join-Path $root $f) -Force
            $a = Get-ThornswoodServiceItemAcl $i
            $a.SetOwner($ls)
            Set-ThornswoodServiceAcl $i.FullName $a
        }
        # As a LOCAL SERVICE task's files are on the box: owned by LOCAL
        # SERVICE, with CREATOR OWNER's rule made for LOCAL SERVICE.
        $a = Get-Acl -LiteralPath $root
        $a.SetAccessRuleProtection($a.AreAccessRulesProtected, $true)
        Set-ThornswoodServiceAcl $root $a
        $before = @((Get-Acl -LiteralPath (Join-Path $root 'world\a.json')).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq 'S-1-5-19' })
        Yes 'the scratch file starts as the box''s do, with a LOCAL SERVICE rule from CREATOR OWNER' ($before.Count -gt 0)
        $task = Get-ThornswoodTaskSidFromName 'Thornswood 4077 Harness'
        $said = @(Repair-ThornswoodServiceOwner -Root $root -Sid $task)
        Yes 'the repair says what it gave the task' (($said -join ' ') -match 'gave the task 3 file')
        Yes 'and that it took the LOCAL SERVICE rule off' (($said -join ' ') -match 'took 1 LOCAL SERVICE rule')
        $left = @()
        foreach ($i in @(Get-Item -LiteralPath $root -Force) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)) {
            $a = Get-Acl -LiteralPath $i.FullName
            if ($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-19') { $left += ($i.Name + ' owner') }
            foreach ($r in @($a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) { if ($r.IdentityReference.Value -eq 'S-1-5-19') { $left += ($i.Name + ' rule') } }
        }
        Yes 'nothing in the folder is LOCAL SERVICE''s or names it after the repair' ($left.Count -eq 0)
        if ($left.Count) { Write-Host ('      ' + ($left -join ', ')) }
        $log = Get-Acl -LiteralPath (Join-Path $root 'server.log')
        Yes 'the files go to the task''s SID' ($log.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $task)
        $deep = @((Get-Acl -LiteralPath (Join-Path $root 'world\a.json')).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
                  Where-Object { $_.IdentityReference.Value -eq $task -and $_.IsInherited -and ([long][int]$_.FileSystemRights -band 0x2) })
        Yes 'and CREATOR OWNER''s rule is made again for it' ($deep.Count -gt 0)
        Yes 'a second repair finds nothing to do' ((@(Repair-ThornswoodServiceOwner -Root $root -Sid $task) -join ' ') -match 'nothing in .* is LOCAL SERVICE')
    }
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
