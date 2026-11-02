<#
  test-2612-backup-principal.ps1

  Issue #2612, the follow-up to #2578. The nightly backup ran as SYSTEM,
  Highest, though it only reads the service folders and writes its own. Held
  here:
    - Install-Backup.ps1 names no SYSTEM principal or Highest run level of
      its own: it takes New-ThornswoodServicePrincipal (LOCAL SERVICE,
      Limited, a SID of the task's own), has -AsSystem as the way back, runs
      the fail-safe before Register-ScheduledTask, grants only the task's SID
      (never LOCAL SERVICE as a whole) and goes back on SYSTEM when it cannot;
    - vps-nightly-backup.ps1 gives its stage in the shared TEMP to the task's
      SID when it runs as LOCAL SERVICE, and says NO ACCESS by name and ends
      non-zero for a folder it cannot read, or a file in a folder it cannot
      list (the deletion record, #2833), run for real on scratch folders
      only SYSTEM may read;
    - every other SYSTEM, Highest principal under scripts\ is on the list
      below with the reason it needs SYSTEM, so a new one copied in fails
      here until someone says why. That covers schtasks /ru SYSTEM /rl
      HIGHEST as well as Register-ScheduledTask: three watch tasks were made
      that way and the list never saw them (#2578). Patrick, 22 Oct 2026:
      the tasks that watch, keep or repair the box stay SYSTEM by design;
      only the services that run code we deploy get accounts of their own
      (the ops repo's DEPLOY-IDENTITIES.md section 8).
  Windows only. Under a minute.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
. (Join-Path $Repo 'scripts\deploy\ServiceAccount.ps1')  # Set-ThornswoodServiceAcl
function Text([string]$p) { return [IO.File]::ReadAllText((Join-Path $Repo $p)) }
$sysRe = "-UserId\s+'SYSTEM'|-User\s+'SYSTEM'|-RunLevel\s+Highest|/ru\s+SYSTEM|/rl\s+HIGHEST"

# ---- the installer -------------------------------------------------------------
$inst = Text 'scripts\deploy\Install-Backup.ps1'
Yes 'Install-Backup.ps1 names no SYSTEM principal or Highest run level of its own' (-not [regex]::IsMatch($inst, $sysRe))
Yes 'Install-Backup.ps1 loads ServiceAccount.ps1 and sends its functions to the box' (
    $inst.Contains(". (Join-Path `$Here 'ServiceAccount.ps1')") -and $inst.Contains('$(Get-ThornswoodServiceAccountScript)'))
Yes 'it takes its principal from New-ThornswoodServicePrincipal, -AsSystem the way back' (
    $inst.Contains('New-ThornswoodServicePrincipal -AsSystem:`$asSystem') -and [regex]::IsMatch($inst, '\[switch\]\$AsSystem'))
$reg = $inst.IndexOf('Register-ScheduledTask -TaskName')
Yes 'the fail-safe on the backups and the passphrase runs before the task is touched' (
    $inst.IndexOf("Test-ThornswoodServiceCannotReach @('`$Root', '`$keyFile')") -gt 0 -and
    $inst.IndexOf('Test-ThornswoodServiceCannotReach') -lt $reg -and $inst.Contains("-match 'FAIL-SAFE'"))
Yes "it grants the task's own SID and goes back on SYSTEM when it cannot" (
    $inst.Contains('Get-ThornswoodTaskSid') -and $inst.Contains('(New-ThornswoodServicePrincipal -AsSystem)') -and
    $inst.Contains("'BACK ON SYSTEM: '"))
Yes 'nothing in it grants LOCAL SERVICE as a whole' (-not [regex]::IsMatch($inst, "S-1-5-19|'LOCAL SERVICE'|NT AUTHORITY\\\\LOCAL SERVICE"))
foreach ($src in 'C:\Thornswood-Server', 'C:\Thornswood-Server-Dev', 'C:\Thornswood-Docs', 'C:\Thornswood-Bot',
                 'C:\Thornswood-Caddy', 'C:\Thornswood-Voice', 'C:\Thornswood-Deletions') {
    Yes "the task is given read on $src" ($inst.Contains("'$src'"))
}
Yes 'the read rule reaches folders that take no rules from above (a server''s private)' ($inst.Contains('AreAccessRulesProtected'))
Yes '  and files in those folders that take no rules from above, read on the file alone (bot.env.json, #2836)' (
    $inst.Contains('Where-Object { (Get-Acl -LiteralPath `$_.FullName).AreAccessRulesProtected }') -and
    $inst.Contains('FileSystemAccessRule(`$who, ''Read'', ''Allow'')'))
$writerText = Text 'scripts\vps\Write-BotToken.ps1'
Yes '  and every writer of bot.env.json gives the backup''s own task account read on it again (Protect-ThornswoodBotEnv)' (
    $writerText.Contains("[string]`$BackupTask = 'Thornswood Backup'") -and $writerText.Contains("NTAccount('NT TASK', `$BackupTask)"))
$err = $null
[void][Management.Automation.Language.Parser]::ParseInput($inst, [ref]$null, [ref]$err)
Yes 'Install-Backup.ps1 parses' (-not $err -or $err.Count -eq 0)

# ---- the runner ----------------------------------------------------------------
$nightlyPath = Join-Path $Repo 'scripts\vps\vps-nightly-backup.ps1'
$run = [IO.File]::ReadAllText($nightlyPath)
Yes "as LOCAL SERVICE the stage goes to the task's SID, and it stops without one" (
    $run.Contains("-eq 'S-1-5-19'") -and $run.Contains("-like 'S-1-5-87-*'") -and $run.Contains('without a SID of its own'))
Yes 'a place it cannot read is said by name and the run ends non-zero' (
    $run.Contains('NO ACCESS') -and $run.Contains('could not be read by the backup task'))

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the backup run as the task: it runs against folders only SYSTEM may read, a Windows ACL, and this is not Windows'
} else {
    $boxPs = Get-BoxPowerShell
    $root = Join-Path ([IO.Path]::GetTempPath()) ('tw-2612-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
    $locked = Join-Path $root 'game\private'
    # The deletion record's folder as Delete-Person.ps1 locked it on the box on
    # 19 Oct, before #2833: the record is a file inside a folder the task may not
    # list, where Test-Path throws instead of saying no.
    $lockedRecord = Join-Path $root 'deletions'
    try {
        [void][IO.Directory]::CreateDirectory((Join-Path $root 'game\world'))
        [void][IO.Directory]::CreateDirectory($locked)
        [void][IO.Directory]::CreateDirectory($lockedRecord)
        [IO.File]::WriteAllText((Join-Path $root 'game\world\0.json'), '{"profileId":1}')
        [IO.File]::WriteAllText((Join-Path $locked 'characters.json'), '{}')
        [IO.File]::WriteAllText((Join-Path $lockedRecord 'requests.jsonl'), '{"discordId":"100000000000000001","profiles":[]}')
        [IO.File]::WriteAllText((Join-Path $root 'key.txt'), 'disposable-2612-key')
        # Only SYSTEM may read them: not Administrators, not whoever runs this.
        foreach ($dir in $locked, $lockedRecord) {
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
                (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
            Set-ThornswoodServiceAcl $dir $acl
        }
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $said = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $nightlyPath `
                -GameRoot (Join-Path $root 'game') -DevGameRoot (Join-Path $root 'no-dev') -SiteRoot (Join-Path $root 'no-site') `
                -BotRoot (Join-Path $root 'no-bot') -CaddyRoot (Join-Path $root 'no-web') -VoiceRoot (Join-Path $root 'no-voice') `
                -DeletionRoot $lockedRecord -Out (Join-Path $root 'out') -KeyFile (Join-Path $root 'key.txt') 2>&1 | ForEach-Object { "$_" })
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $old }
        $all = $said -join "`n"
        Yes 'a folder the task cannot read is named NO ACCESS' ($all -match 'NO ACCESS .*private')
        Yes '  and so is a file in a folder it cannot list, the deletion record (#2833)' ($all -match 'NO ACCESS .*deletions\\requests\.jsonl')
        Yes '  and the run ends non-zero' ($code -ne 0)
        Yes '  and the rest was still backed up' (@(Get-ChildItem -LiteralPath (Join-Path $root 'out') -Filter 'thornswood-*.zip.enc' -EA SilentlyContinue).Count -eq 1)
        if ($code -eq 0 -or $all -notmatch 'NO ACCESS') { $said | Select-Object -Last 15 | Write-Host }
    } finally {
        # The owner may always rewrite the rules; give them back, then remove it.
        foreach ($dir in $locked, $lockedRecord) {
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
                [Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
            try { Set-ThornswoodServiceAcl $dir $acl } catch { }
        }
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- every SYSTEM principal left, and why ---------------------------------------
# File, then the text on its line. Each one here needs SYSTEM for the reason
# given; anything else under scripts\ that names SYSTEM or Highest fails.
$allowed = @(
    @('scripts/deploy/ServiceAccount.ps1', "-UserId 'SYSTEM'", '-AsSystem, the way back (#2578)'),
    @('scripts/deploy/Install-ThornswoodServer.ps1', "-UserId 'SYSTEM'", 'its copy of ServiceAccount.ps1, -AsSystem (#2578)'),
    @('scripts/vps/vps-dev-instance.ps1', "-UserId 'SYSTEM'", 'its copy of ServiceAccount.ps1, -AsSystem (#2578)'),
    @('scripts/vps/vps-harden.ps1', "-UserId 'SYSTEM'", 'one-shot sshd restart and config rollback: rewrites ProgramData\ssh\sshd_config and restarts sshd, which need administrator, and must outlive the ssh session they cut (#2612)'),
    @('scripts/vps/vps-ssh-scope.ps1', "-UserId 'SYSTEM'", 'one-shot firewall rollback: sets rules'' remote addresses, which needs administrator, and must outlive a session the change may lock out (#2612)'),
    @('scripts/vps/vps-openssh.ps1', "-UserId 'SYSTEM'", 'one-shot OpenSSH swap and put back (#1043): removing a Windows capability, installing an MSI and its services, and setting port 22 rules need administrator, and both must outlive the ssh session the swap stops; each runs once (-Once), removes itself, and runs phase.ps1 from C:\ProgramData\Thornswood-OpenSSH, which only SYSTEM and Administrators may open; tests\test-1043-openssh-upgrade.ps1 holds it'),
    @('scripts/vps/Grant-BoxAccess.ps1', "-UserId 'SYSTEM'", 'one-shot put back of the ssh key file and the bridge tokens: rewrites ProgramData\ssh\administrators_authorized_keys, which needs administrator, and must outlive a session the change may lock out (#2891); inline, removes itself, tests\test-2891-box-access.ps1 holds it'),
    @('scripts/vps/Watch-Services.ps1', "-UserId 'SYSTEM'", 'the watchdog: restarts the other services (Restart-Service, schtasks /run of tasks run by other accounts) and reads every service, task and folder it checks, which need administrator; it was SYSTEM through schtasks /ru SYSTEM until it took Register-ScheduledTask for its priority (#3212)'),
    @('scripts/vps/vps-capture-443.ps1', "-UserId 'SYSTEM'", 'one-shot end of the #2946 packet capture: pktmon stop, filter remove and etl2txt need administrator, and the end must come at its time with no ssh session held open over the path that resets (#2970); inline cmd.exe line, deletes itself, tests\test-capture-443.ps1 holds it'),
    @('scripts/dev/Trace-Gate-Box.ps1', "-UserId 'SYSTEM'", 'the gate trace task (#3114, Patrick''s option A on q-3114-map-refresh): only an administrator, SYSTEM or Performance Log Users may start a kernel trace session, and putting LOCAL SERVICE in that group would give it to every service; it reads what a build asks as checked data and runs nothing it is handed (scripts/dev/Trace-Gate-Task.ps1)'),
    @('scripts/vps/Watch-Load.ps1', '/ru SYSTEM /rl HIGHEST', 'the load record (Thornswood Load): reads the processor time, memory and I/O of every service''s processes, each under an account of its own, and writes beside the watchdog in C:\Thornswood-Watch; SYSTEM by design (#2578)'),
    @('scripts/vps/Forecast-Storage.ps1', '/ru SYSTEM /rl HIGHEST', 'the disk history (Thornswood Disk History): writes its history and alerts into the watchdog''s folder and outbox, C:\Thornswood-Watch, which only SYSTEM and Administrators may write; SYSTEM by design (#2578)'),
    @('scripts/vps/Send-Backups.ps1', "-UserId 'SYSTEM'", 'sends each nightly off the box to the Oracle VM (Thornswood Send Backups, #2862): it opens each backup with the passphrase, which only SYSTEM, Administrators and the backup task may read, and its ssh key must be readable by nobody but SYSTEM and Administrators or ssh refuses it, so it cannot run as the backup task''s LOCAL SERVICE, whose key every LOCAL SERVICE service could reach; it runs its own copy from C:\Thornswood-Backup\offbox, which only SYSTEM and Administrators may open'),
    @('scripts/vps/gate/Update-Gate.ps1', "-UserId 'SYSTEM'", 'one-shot restart of the deploy gate on main''s files (Thornswood Gate Update, #5178): stopping and starting the SYSTEM task Thornswood Gate and putting the broker''s files back need administrator, and the restart must outlive the verb run that asked for it; it runs update\restart.ps1 from C:\Thornswood-Gate, which only SYSTEM and Administrators may change, and removes itself; tests\test-2841-deploy-gate.ps1 holds it'),
    @('scripts/deploy/Install-Gate.ps1', "-UserId 'SYSTEM'", 'the deploy gate''s broker (Thornswood Gate, #2841): it runs the verbs of scripts/vps/gate/verbs.json, each a script of main read from GitHub with a read-only key, and their box halves need administrator; it holds every line to that list itself and runs nothing it is handed but those words, and its folder, C:\Thornswood-Gate, only SYSTEM and Administrators may change; tests\test-2841-deploy-gate.ps1 holds it'),
    @('scripts/deploy/New-RunnerDrive.ps1', "-UserId 'SYSTEM'", 'the runner drive at startup (Thornswood Runner Drive, #3861): attaching a disk file, giving its partition a letter and starting services need administrator, before anybody signs in; it runs start.ps1 from the disk file''s folder, which only SYSTEM and Administrators may open; tests\test-runner-drive.ps1 holds it'),
    @('scripts/vps/Keep-RunnerLogs.ps1', '/ru SYSTEM /rl HIGHEST', 'the runner log keeper (Thornswood Runner Logs): removes old logs from the _diag folder of every runner, each under its own runner account; SYSTEM by design (#2578)')
)
$names = @($allowed | ForEach-Object { $_[0] })
$found = @()
foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Include '*.ps1', '*.psm1')) {
    $rel = $f.FullName.Substring($Repo.Length + 1).Replace('\', '/')
    foreach ($m in @(Select-String -LiteralPath $f.FullName -Pattern $sysRe)) { $found += ($rel + ':' + $m.LineNumber) }
}
$stray = @($found | Where-Object { $names -notcontains ($_ -replace ':\d+$', '') })
# #2613: the site's -RunAs SYSTEM is ServiceAccount.ps1's -AsSystem, so
# Deploy-Docs is off the list and names no SYSTEM principal of its own.
Yes 'Deploy-Docs is not on the list, and takes -RunAs SYSTEM from New-ThornswoodServicePrincipal -AsSystem (#2613)' (
    $names -notcontains 'scripts/deploy/Deploy-Docs.ps1' -and
    (Text 'scripts\deploy\Deploy-Docs.ps1') -notmatch $sysRe -and
    (Text 'scripts\deploy\Deploy-Docs.ps1').Contains('New-ThornswoodServicePrincipal -AsSystem'))
Yes 'every SYSTEM or Highest principal under scripts\ is on the list with its reason' ($stray.Count -eq 0)
foreach ($s in $stray) { Write-Host "      not on the list: $s" }

# The SYSTEM ones that stay are one-shot, delete themselves, and carry their
# whole command inline, with paths only under ProgramData\ssh, which only
# SYSTEM and Administrators may change.
foreach ($pair in @(@('scripts\vps\vps-harden.ps1', 'Start-SshdRestart'), @('scripts\vps\vps-harden.ps1', 'Register-Rollback'),
                    @('scripts\vps\vps-ssh-scope.ps1', 'Register-Rollback'))) {
    $t = Text $pair[0]
    $m = [regex]::Match($t, '(?s)function ' + $pair[1] + '\b.*?\r?\n}')
    $body = $m.Value
    Yes "$($pair[0]) $($pair[1]) runs once and removes itself" (
        $m.Success -and $body.Contains('Unregister-ScheduledTask -TaskName') -and -not [regex]::IsMatch($body, '-Daily|-Weekly|-AtStartup|-AtLogOn|RepetitionInterval'))
    Yes "$($pair[0]) $($pair[1]) carries its command inline, no script file" ($body.Contains("-NoProfile -Command") -and -not $body.Contains('-File'))
}
$h = Text 'scripts\vps\vps-harden.ps1'; $sc = Text 'scripts\vps\vps-ssh-scope.ps1'
Yes 'the paths in them are under ProgramData\ssh' (
    $h.Contains("[string]`$SshdConfig = (Join-Path `$env:ProgramData 'ssh\sshd_config')") -and
    $h.Contains("`$backup = `$SshdConfig + '.before-harden-'") -and
    $sc.Contains("function Get-SaveFolder { return (Join-Path `$env:ProgramData 'ssh') }"))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
