<#
  test-runner-offbox.ps1

  Issue #1306. Install-Runner.ps1 -OffBox puts the pull request runner
  (label thornswood-pr) on a machine that is not the VPS. This proves what it
  would do there without doing any of it: every run here is -DryRunTo, which
  writes the scripts down and runs none, with stand-ins for gh, and a gh on
  PATH that only records being called proves GitHub is never asked. The one
  real ACL work is Close-RunnerAccount, lifted out of the script and run on
  scratch folders under TEMP for ANONYMOUS LOGON (*S-1-5-7), the same way
  tests\test-runner-lock.ps1 does. No account, service, Defender setting,
  C:\ folder or runner registration is touched. The firewall guards run
  against stand-ins for the NetSecurity cmdlets, so no real rule is read or
  made; the read guards deny ANONYMOUS LOGON on scratch folders only.
  Issue #2161: -NetworkOnly writes the outbound rules alone (no read deny,
  lock, account or service step), may name a VPS-label runner, and full
  -OffBox still refuses that label.
  Issue #4033: no runner signs since release.yml signs on GitHub's runner
  alone (#4013), so runner 3 is registered with the VPS label alone and its
  -NetworkOnly rules are the same as any other runner's.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
$script = Join-Path $Repo 'scripts\deploy\Install-Runner.ps1'
$ps = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-runner-offbox-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$oldPath = $env:PATH
try {
    # A gh that only says it was called.
    $fakeBin = Join-Path $work 'bin'; New-Item -ItemType Directory -Path $fakeBin | Out-Null
    $ghCalled = Join-Path $work 'gh-called.txt'
    [IO.File]::WriteAllText((Join-Path $fakeBin 'gh.cmd'), "@echo called>>`"$ghCalled`"`r`n@exit /b 1`r`n")
    $env:PATH = $fakeBin + ';' + $env:PATH

    # A dry run writes the same scripts for the same switches and changes
    # nothing the next one reads, so each set of switches runs once and a
    # later check of the same set reads that run: 22 PowerShell starts, not
    # 30, where one costs the gate box about ten times a node start (#3168).
    $dryRuns = @{}
    function Dry([string[]]$more) {
        $key = @($more) -join "`n"
        if ($dryRuns.ContainsKey($key)) { return $dryRuns[$key] }
        $dryRuns[$key] = Dry-Run $more
        return $dryRuns[$key]
    }
    function Dry-Run([string[]]$more) {
        $f = Join-Path $work ('dry-' + [Guid]::NewGuid().ToString('N') + '.txt')
        $ErrorActionPreference = 'Continue'
        $said = @(& $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @more -DryRunTo $f -NoPause 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        $text = $(if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { '' })
        return @{ Code = $rc; Said = ($said -join "`n"); Text = $text }
    }

    $comp = [Environment]::MachineName.ToLower()
    $r = Dry @('-OffBox')
    Yes "-OffBox dry run ends 0 (got $($r.Code))" ($r.Code -eq 0)
    Yes '  it ran nothing: every step says DRY RUN' ($r.Said -match 'DRY RUN, nothing ran' -and $r.Said -match 'on this machine')
    # The pull request build label only when records\pr-build-runners.json
    # names this machine's runner (One's, 26 Oct 2026), so the answer depends
    # on where the test runs. Never the build label: off the box it is not
    # carried (#4010).
    $prRec = Get-Content -LiteralPath (Join-Path $repo 'records\pr-build-runners.json') -Raw | ConvertFrom-Json
    $prNamed = $prRec.PSObject.Properties['offBox'] -and (@($prRec.offBox) -contains ('thornswood-pr-' + $comp))
    $wantLabels = 'thornswood-pr' + $(if ($prNamed) { ',thornswood-pr-build' } else { '' })
    Yes "  registers thornswood-pr-$comp with the label(s) $wantLabels" ($r.Text -match ("--name 'thornswood-pr-" + [regex]::Escape($comp) + "' --labels '" + [regex]::Escape($wantLabels) + "'"))
    Yes '  never the VPS label' ($r.Text -notmatch "--labels 'thornswood-vps" -and $r.Text -notmatch "--labels '[^']*thornswood-vps")
    Yes '  nor the build label, which is the box''s alone (#2994, #4010)' ($r.Text -notmatch '\bthornswood-build\b')
    Yes '  in C:\Thornswood-RunnerPR, as the account thornswood-pr' ($r.Text -match [regex]::Escape("`$root = 'C:\Thornswood-RunnerPR'") -and $r.Text -match [regex]::Escape("`$acct = 'thornswood-pr'"))
    Yes '  its own folder is still locked before config.cmd writes into it' ($r.Text -match '(?m)^Lock-RunnerRoot \$root \$acct')
    Yes '  the install shuts it out of every C:\Thornswood* folder, hyphen or not, Dumps included (#2488)' ($r.Text -match [regex]::Escape("Close-RunnerAccount `$acct `$root 'C:\' 'Thornswood*' @() @()"))
    Yes '  and the lock after leaves nothing out either' ($r.Text -match [regex]::Escape("`$leave = @()"))
    Yes '  and so does the lock of every runner after' ($r.Text -match [regex]::Escape("`$liveFilter = 'Thornswood*'") -and $r.Text -match [regex]::Escape('Close-RunnerAccount $acct $root ''C:\'' $liveFilter $alsoDeny'))
    Yes '  Defender keeps scanning its folder' ($r.Text -match '(?m)^if \(\$false\) \{\s*$')
    Yes '  the stand-in registration token is in none of the scripts (it goes on standard input)' ($r.Text -notmatch 'DRY-RUN-TOKEN-NOT-REAL')
    Yes '  the install script is marked as taking a secret on standard input' ($r.Text -match 'with a secret on standard input')
    Yes '  dry-run profile recovery names an approved restart of THIS PC, never a VPS script (#4048)' ($r.Text -match 'approved local PC restart' -and $r.Text -notmatch 'Set-TimeWait.ps1 -Restart')
    Yes '  GitHub was never asked (the gh on PATH was not called)' (-not (Test-Path -LiteralPath $ghCalled))

    $r = Dry @('-OffBox', '-DefenderSkip', '-AlsoDeny', 'D:\Somewhere Else')
    Yes '-DefenderSkip lets Defender skip it, as on the VPS' ($r.Text -match '(?m)^if \(\$true\) \{\s*$')
    Yes '-AlsoDeny is in the install''s deny list and the lock''s' (($r.Text -match [regex]::Escape("'Thornswood*' @('D:\Somewhere Else') @()")) -and ($r.Text -match [regex]::Escape("`$alsoDeny = @('D:\Somewhere Else')")))

    $r = Dry @('-OffBox', '-Number', '2')
    Yes '-OffBox -Number 2 numbers its folder, account and name' ($r.Text -match [regex]::Escape("`$root = 'C:\Thornswood-RunnerPR2'") -and $r.Text -match [regex]::Escape("`$acct = 'thornswood-pr2'") -and $r.Text -match ("--name 'thornswood-pr-" + [regex]::Escape($comp) + "-2'"))

    # Its own install folder (#3860), never Patrick's game: the .env it writes
    # names one under its root.
    $r = Dry @('-OffBox', '-Number', '3')
    Yes '-OffBox writes THORNSWOOD_INSTALL into its .env, under its own root' ($r.Code -eq 0 -and $r.Text -match "(?m)^Set-RunnerTemp \`$root '[^']+' \`$true\s*$" -and $r.Text -match [regex]::Escape("`$want += ('THORNSWOOD_INSTALL=' + (Join-Path `$root 'install'))"))
    $r = Dry @()
    Yes '  and a VPS runner does not' ($r.Code -eq 0 -and $r.Text -match "(?m)^Set-RunnerTemp \`$root '[^']+' \`$false\s*$")

    # Build runners on One (Patrick, 26 Oct 2026): a name the pull request
    # record's offBox lists takes its label too, and never the build or the
    # VPS label (#4010).
    $r = Dry @('-OffBox', '-RunnerName', 'thornswood-pr-one')
    Yes 'an off-box runner records\pr-build-runners.json names takes its label, not the build label (#4010)' ($r.Code -eq 0 -and $r.Text -match "--name 'thornswood-pr-one' --labels 'thornswood-pr,thornswood-pr-build'(?!,)")
    $r = Dry @('-OffBox', '-RunnerName', 'thornswood-pr-elsewhere')
    Yes '  and one it does not name keeps the pull request label alone' ($r.Code -eq 0 -and $r.Text -match "--name 'thornswood-pr-elsewhere' --labels 'thornswood-pr'(?!,)")

    $r = Dry @('-OffBox', '-Label', 'thornswood-vps')
    Yes "-OffBox refuses the VPS label (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match 'never takes the VPS label' -and -not $r.Text)

    $r = Dry @('-OffBox', '-Status')
    Yes '-OffBox -Status runs here, not over ssh' ($r.Code -eq 0 -and $r.Text -match 'runner    in C:\\Thornswood-RunnerPR')
    $r = Dry @('-OffBox', '-Remove')
    Yes '-OffBox -Remove takes its denies off every C:\Thornswood* folder' ($r.Code -eq 0 -and $r.Text.Contains("Open-RunnerAccount 'thornswood-pr' 'C:\Thornswood-RunnerPR' 'C:\' 'Thornswood*' @("))

    # The VPS, unchanged: what an install on the box would send.
    $r = Dry @()
    Yes "without -OffBox the dry run still ends 0 (got $($r.Code))" ($r.Code -eq 0)
    # A reinstall never takes off a runner mid-job or by halves (#3889, 30 Oct).
    Yes '  a reinstall stops before anything is touched when the runner is running a job' ($r.Text -match [regex]::Escape("throw ('this runner is running a job") -and $r.Text -match '(?m)^Assert-RunnerIdle \$root\s*$')
    Yes '  then stops it whole: no process left under its folder and the service gone, or it says which' ($r.Text -match '(?m)^Stop-RunnerHere \$root ' -and $r.Text -match [regex]::Escape("throw ('still running from '") -and $r.Text -match [regex]::Escape("Stop-Service -Name `$svc -Force -EA Stop"))
    Yes '  it clears the broker''s .runner_migrated and .credentials_migrated as well, and stops when any of the old configuration is left' ($r.Text -match [regex]::Escape("@('.runner', '.runner_migrated', '.credentials', '.credentials_migrated', '.credentials_rsaparams')") -and $r.Text -match [regex]::Escape("throw ('the old configuration is still there: '"))
    Yes '  and no stop is passed over silently' ($r.Text -notmatch 'Stop-Service[^\r\n]*-EA SilentlyContinue')
    Yes '  both come before the account''s password changes, so a refusal leaves the old service able to log on' ($r.Text.IndexOf("Assert-RunnerIdle `$root") -ge 0 -and $r.Text.IndexOf("Assert-RunnerIdle `$root") -lt $r.Text.IndexOf('Set-LocalUser -Name') -and $r.Text.IndexOf("Stop-RunnerHere `$root") -lt $r.Text.IndexOf('Set-LocalUser -Name'))
    Yes '  the install names its service before anything reads it, so the read back is that one service and not every service on the box' ($r.Text -match "(?m)^\`$svc = 'actions\.runner\.[^']+thornswood-vps'\s*$" -and $r.Text.IndexOf("`$svc = 'actions.runner.") -lt $r.Text.IndexOf("`$s = Get-Service -Name `$svc"))
    Yes '  and a process list that cannot be read stops them, never reads as empty' ($r.Text -match [regex]::Escape('@(Get-CimInstance Win32_Process -EA Stop | Where-Object'))
    $rm = Dry @('-Number', '3', '-Remove')
    $irText = [IO.File]::ReadAllText($script)
    Yes '  -Remove stops before changing anything when GitHub gives no removal token, and reads GitHub back after the box''s part (#5565)' ($rm.Code -eq 0 -and $rm.Said -match 'GitHub lists no runner called thornswood-vps-3' -and $irText.Contains("catch { Die ('GitHub gave no removal token for ") -and $irText -notmatch 'GitHub is left to forget')
    Yes '  -Remove refuses a runner running a job before GitHub is told, and stops it the same way' ($rm.Text -match "(?m)^Assert-RunnerIdle 'C:\\Thornswood-Runner3'" -and $rm.Text -match "(?m)^Stop-RunnerHere 'C:\\Thornswood-Runner3' " -and $rm.Text -notmatch 'Stop-Service[^\r\n]*-EA SilentlyContinue' -and $rm.Text.IndexOf('Assert-RunnerIdle ''C:\Thornswood-Runner3''') -lt $rm.Text.IndexOf('config.cmd remove'))
    Yes '  remote VPS recovery retains VPS restart guidance (#4048)' ($r.Text -match 'Restart the VPS \(scripts\\vps\\Set-TimeWait.ps1 -Restart\)')
    Yes '  the VPS runner keeps its label, name and folder, runner 1 takes builds (#2994) but no pull request builds (#4010)' ($r.Text -match "--name 'thornswood-vps' --labels 'thornswood-vps,thornswood-build'(?!,)" -and $r.Text -match [regex]::Escape("`$root = 'C:\Thornswood-Runner'"))
    $r2 = Dry @('-Number', '2')
    Yes '  runner 2 takes builds and pull request builds (#4010)' ($r2.Code -eq 0 -and $r2.Text -match "--name 'thornswood-vps-2' --labels 'thornswood-vps,thornswood-build,thornswood-pr-build'(?!,)")
    $r = Dry @('-Number', '4')
    Yes "  runner 4, the light one, takes no builds and no check label, which went with the flip (#4033, exit $($r.Code))" ($r.Code -eq 0 -and $r.Text -match "--name 'thornswood-vps-4' --labels 'thornswood-vps'(?!,)")
    # #2161, 21 Oct: the record's no-reach folders outside C:\Thornswood-* are denied on the box too.
    $vpsAlso = "@('C:\ProgramData\ssh', 'C:\Users\Administrator')"
    Yes '  and its C:\Thornswood-* filter and Defender skip' ($r.Text -match [regex]::Escape("Close-RunnerAccount `$acct `$root 'C:\' 'Thornswood-*' $vpsAlso") -and $r.Text -match '(?m)^if \(\$true\) \{\s*$')
    Yes '  and Dumps left to Lock-VpsFolders.ps1, at install and in the lock after (#2127, #2488)' ($r.Text -match [regex]::Escape("'Thornswood-*' $vpsAlso @('Thornswood-Dumps')") -and $r.Text -match [regex]::Escape("`$leave = @('Thornswood-Dumps')"))
    Yes '  and sshd''s folder and the administrator''s profile, from records\runner-isolation.json, at install' ($r.Text -match [regex]::Escape($vpsAlso))
    $r = Dry @('-Lock')
    Yes "  and in -Lock, for every runner on the box (exit $($r.Code))" ($r.Code -eq 0 -and $r.Text -match [regex]::Escape("`$alsoDeny = $vpsAlso"))
    $r = Dry @('-Number', '5')
    Yes '  runner 5, which records\build-runners.json does not list, gets the VPS label alone and takes no builds (#2994)' ($r.Code -eq 0 -and $r.Text -match "--name 'thornswood-vps-5' --labels 'thornswood-vps' --work")
    # #4033: runner 3 signed until #4013; now it is a light runner like any other.
    $r = Dry @('-Number', '3')
    Yes '  runner 3 gets the VPS label alone, no signing label and no build label (#4033)' ($r.Code -eq 0 -and $r.Text -match "--name 'thornswood-vps-3' --labels 'thornswood-vps' --work")
    Yes '  and Install-Runner.ps1 reads no signing record' ([IO.File]::ReadAllText($script) -notmatch 'sign-runners')
    $irAll = [IO.File]::ReadAllText($script)
    Yes '  and has no Hermes runner, proxy or Python part (#5565, #5577)' ($irAll -notmatch '\[switch\]\$Hermes' -and $irAll -notmatch 'Set-RunnerProxy' -and $irAll -notmatch 'RunnerEgress' -and $irAll -notmatch 'Install-RunnerPython')
    Yes '  GitHub still never asked' (-not (Test-Path -LiteralPath $ghCalled))

    # ---- Close-RunnerAccount on scratch folders, the off-box filter ---------
    $src = [IO.File]::ReadAllText($script)
    $lib = [regex]::Match($src, "(?s)\`$lockLib = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
    Yes 'the lock library is where it was' ($lib -match 'function Close-RunnerAccount')
    . ([scriptblock]::Create($lib))
    if ($OnWindows) {
        $parent = Join-Path $work 'c'
        $names = 'Thornswood-Server', 'ThornswoodTemps&Worktrees', 'Thornswood Vault', 'Thornswood-RunnerPR', 'Other'
        foreach ($n in $names) { New-Item -ItemType Directory -Path (Join-Path $parent $n) | Out-Null }
        $extra = Join-Path $work 'elsewhere'; New-Item -ItemType Directory -Path $extra | Out-Null
        $own = Join-Path $parent 'Thornswood-RunnerPR'
        $said = @(Close-RunnerAccount '*S-1-5-7' $own $parent 'Thornswood*' @($extra, (Join-Path $work 'not-there')))
        function Denied([string]$p) { return [bool]@((Get-Acl -LiteralPath $p).Access | Where-Object { "$($_.AccessControlType)" -eq 'Deny' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-7' }).Count }
        Yes 'off the box it shuts the account out of Thornswood-Server' (Denied (Join-Path $parent 'Thornswood-Server'))
        Yes '  and out of ThornswoodTemps&Worktrees, which has no hyphen' (Denied (Join-Path $parent 'ThornswoodTemps&Worktrees'))
        Yes '  and out of Thornswood Vault' (Denied (Join-Path $parent 'Thornswood Vault'))
        Yes '  and out of an -AlsoDeny folder' (Denied $extra)
        Yes '  but not its own folder' (-not (Denied $own))
        Yes '  and not a folder that is not Thornswood''s' (-not (Denied (Join-Path $parent 'Other')))
        Yes '  an -AlsoDeny folder that is not there is passed over' (-not ($said -join ' ' -match 'not-there'))
        $parent2 = Join-Path $work 'c2'
        foreach ($n in 'Thornswood-Server', 'ThornswoodTemps') { New-Item -ItemType Directory -Path (Join-Path $parent2 $n) | Out-Null }
        $null = Close-RunnerAccount '*S-1-5-7' (Join-Path $parent2 'none') $parent2
        Yes 'the VPS default filter is unchanged: Thornswood-* only' ((Denied (Join-Path $parent2 'Thornswood-Server')) -and -not (Denied (Join-Path $parent2 'ThornswoodTemps')))
    } else {
        Write-Host 'SKIP  Close-RunnerAccount on scratch folders: it denies with icacls and reads the deny back with Get-Acl, which only Windows has'
    }

    # ---- the guards in the dry run (WHAT A PULL REQUEST JOB MAY REACH) -----
    $r = Dry @('-OffBox')
    $t = $r.Text
    Yes '-OffBox install puts outbound block rules on for the account alone' ($t -match [regex]::Escape('Set-RunnerFirewall $grdAcct $grdGroup $grdBlocks') -and $t -match '-Direction Outbound -Action Block' -and $t -match [regex]::Escape("-LocalUser ('D:(A;;CC;;;'"))
    Yes '  in a group named for the account' ($t -match [regex]::Escape("`$grdGroup = 'Thornswood PR runner thornswood-pr'"))
    Yes '  blocking everything outside GitHub''s published lists (stand-in meta)' ($t -match [regex]::Escape("'0.0.0.0-4.147.255.255'") -and $t -match [regex]::Escape("'4.149.0.0-126.255.255.255'") -and $t -match [regex]::Escape("'128.0.0.0-140.82.111.255'"))
    Yes '  loopback and GitHub''s ranges are not in the block list' ($t -notmatch "'127\.0\.0\.0-" -and $t -notmatch [regex]::Escape("'140.82.112.0") -and $t -notmatch [regex]::Escape("'192.30.252.0"))
    Yes '  IPv6 too: everything but ::1 and GitHub''s 2a0a:a440::/29' ($t -match [regex]::Escape("'::'") -and $t -match [regex]::Escape("'::2-2a0a:a43f:ffff:ffff:ffff:ffff:ffff:ffff'") -and $t -match [regex]::Escape("'2a0a:a448::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'"))
    Yes '  and shuts it out of other drives, profiles and ProgramData secrets' ($t -match [regex]::Escape('Close-RunnerReads $grdAcct (Get-RunnerReadDenies $grdAcct -Own $grdOwn)'))
    Yes '  every drive but C:, its folder being on C: (#3861)' ($t -match [regex]::Escape("`$grdOwn = ''"))
    Yes '  and the service starts with Windows as before' ($t -notmatch 'start= demand')
    $iG = $t.IndexOf('Set-RunnerFirewall $grdAcct'); $iC = $t.IndexOf('.\config.cmd --unattended')
    Yes '  both before config.cmd can start the runner' ($iG -gt 0 -and $iC -gt $iG)
    Yes '  GitHub''s lists came from a stand-in: gh never called' (-not (Test-Path -LiteralPath $ghCalled))
    # localhost, so the harness needs no network to resolve it.
    $r = Dry @('-OffBox', '-AllowHost', 'localhost')
    Yes '-AllowHost lets its address through (stand-in 203.0.113.7)' ($r.Text -match [regex]::Escape("-203.0.113.6'") -and $r.Text -match [regex]::Escape("'203.0.113.8-"))
    # #2161, 21 Oct: through pwsh -File (this Dry) a,b reached the script as one
    # name, the real run failed to resolve it and the dry run never asked.
    $r = Dry @('-OffBox', '-AllowHost', 'localhost,localhost')
    Yes "  a comma list given through -File is split into its names (exit $($r.Code))" ($r.Code -eq 0 -and ([regex]::Matches($r.Said, '-AllowHost localhost:')).Count -eq 2 -and $r.Said -notmatch 'localhost,localhost')
    $r = Dry @('-OffBox', '-AllowHost', 'no-such-host.invalid')
    Yes "  the dry run resolves each name and stops on one that does not resolve, writing nothing (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match 'no-such-host\.invalid does not resolve|no-such-host\.invalid resolves to nothing' -and $r.Text -notmatch 'Set-RunnerFirewall \$grdAcct')
    $r = Dry @('-OffBox', '-AlsoDeny', 'D:\One,D:\Two')
    Yes '  -AlsoDeny given as a comma list through -File is two folders' ($r.Text -match [regex]::Escape("`$alsoDeny = @('D:\One', 'D:\Two')"))
    $r = Dry @('-OffBox', '-Lock')
    Yes "-OffBox -Lock fetches the lists again and puts the guards back (exit $($r.Code))" ($r.Code -eq 0 -and $r.Text -match [regex]::Escape('Set-RunnerFirewall $grdAcct $grdGroup $grdBlocks') -and $r.Text -match [regex]::Escape('Close-RunnerReads'))
    $r = Dry @('-OffBox', '-Remove')
    Yes '-OffBox -Remove takes the firewall rules and the read denies off' ($r.Text -match [regex]::Escape('Remove-RunnerFirewall $grdGroup') -and $r.Text -match [regex]::Escape('Open-RunnerReads $grdAcct (Get-RunnerReadDenies $grdAcct -Own $grdOwn)'))
    # ON THE RUNNER DRIVE (#3861): explicit R: is fixture metadata, not a
    # lookup of One's attached labelled drive (#4048). Defaults above are C:.
    $r = Dry @('-OffBox', '-Number', '3', '-Root', 'R:\Thornswood-RunnerPR3')
    $t = $r.Text
    Yes "-OffBox on the runner drive installs there (exit $($r.Code))" ($r.Code -eq 0 -and $t -match [regex]::Escape("`$root = 'R:\Thornswood-RunnerPR3'"))
    Yes '  shuts the account out of the other runners'' folders on that drive as on C:' ($t -match [regex]::Escape("Close-RunnerAccount `$acct `$root 'C:\' 'Thornswood*'") -and $t -match [regex]::Escape("Close-RunnerAccount `$acct `$root 'R:\' 'Thornswood*'"))
    Yes '  leaves that drive''s root out of the read denies, as New-RunnerDrive.ps1 locks it' ($t -match [regex]::Escape("`$grdOwn = 'R:'"))
    $iD = $t.IndexOf('start= demand'); $iC = $t.IndexOf('.\config.cmd --unattended')
    Yes '  and has the service start by hand, after config.cmd made it, for the drive''s task to start' ($iD -gt $iC -and $iC -gt 0)
    $r = Dry @('-OffBox', '-Number', '3', '-Root', 'R:\Thornswood-RunnerPR3', '-Remove')
    Yes '  -Remove there opens the other runners'' folders on the drive again' ($r.Text -match [regex]::Escape("Open-RunnerAccount 'thornswood-pr3' 'R:\Thornswood-RunnerPR3' 'R:\' 'Thornswood*'"))
    $r = Dry @('-OffBox', '-Status')
    Yes '-OffBox -Status says what the firewall has' ($r.Text -match [regex]::Escape('Get-RunnerFirewall $grdGroup'))
    $r = Dry @('-OffBox', '-Number', '2')
    Yes '-Number 2 gets a firewall group of its own' ($r.Text -match [regex]::Escape("`$grdGroup = 'Thornswood PR runner thornswood-pr2'"))
    foreach ($m in @(@('-Lock'), @('-Status'))) {
        $r = Dry $m
        Yes ("the VPS (no -OffBox) $($m -join ' ') gets no firewall rule and no read deny") ($r.Code -eq 0 -and $r.Text -notmatch 'RunnerFirewall|RunnerReads')
    }
    # #3956: an install on the VPS puts its outbound rules on in the same run,
    # before the runner can take a job; until 27 Oct 2026 it took a -NetworkOnly
    # run after it. Still no read deny there.
    $r = Dry @('-Number', '4', '-AllowHost', 'localhost')
    $iFw = $r.Text.IndexOf('Set-RunnerFirewall $grdAcct $grdGroup $grdBlocks'); $iCfg = $r.Text.IndexOf('config.cmd --unattended')
    Yes 'the VPS install puts the account''s outbound rules on in the same run (#3956)' ($r.Code -eq 0 -and $r.Text -match [regex]::Escape("`$grdGroup = 'Thornswood PR runner thornswood-runner4'") -and $iFw -gt 0)
    Yes '  before config.cmd registers the runner, so it takes no job without them' ($iCfg -gt $iFw)
    Yes '  with -AllowHost let through' ($r.Said -match '-AllowHost localhost: ')
    Yes '  and no read deny on the VPS' ($r.Text -notmatch 'Close-RunnerReads \$grdAcct')
    # Since #2161 a VPS account may carry -NetworkOnly's rules, so its removal takes them off, and still no read deny.
    $r = Dry @('-Remove')
    Yes 'the VPS (no -OffBox) -Remove takes off its outbound rules and touches no read deny' ($r.Code -eq 0 -and $r.Text -match [regex]::Escape('Remove-RunnerFirewall $grdGroup') -and $r.Text -notmatch 'Set-RunnerFirewall \$grdAcct|Open-RunnerReads \$grdAcct|Close-RunnerReads \$grdAcct')

    # ---- -NetworkOnly (#2161): the outbound rules alone ---------------------
    # A step run, not a function the guard library defines: a line that starts with it.
    $noLock = '(?m)^\s*(&\s*icacls|Close-RunnerReads|Open-RunnerReads|Lock-RunnerRoot|Close-RunnerAccount|New-LocalUser|Remove-LocalUser|Remove-RunnerWatchers)\b|config\.cmd|ExclusionPath'
    Yes 'the lock-step pattern does catch a full -OffBox install (a control)' ((Dry @('-OffBox')).Text -match $noLock)
    $r = Dry @('-NetworkOnly', '-Number', '4', '-AllowHost', 'localhost')
    $t = $r.Text
    Yes "-NetworkOnly -Number 4 dry run ends 0 and goes to the VPS names (exit $($r.Code))" ($r.Code -eq 0 -and $t -match [regex]::Escape("`$grdAcct = 'thornswood-runner4'"))
    Yes '  it writes the outbound block rules for that account alone' ($t -match [regex]::Escape('Set-RunnerFirewall $grdAcct $grdGroup $grdBlocks') -and $t -match '-Direction Outbound -Action Block' -and $t -match [regex]::Escape("`$grdGroup = 'Thornswood PR runner thornswood-runner4'"))
    Yes '  blocking everything outside GitHub''s lists, with the -AllowHost hole' ($t -match [regex]::Escape("'128.0.0.0-140.82.111.255'") -and $t -match [regex]::Escape("-203.0.113.6'") -and $t -match [regex]::Escape("'203.0.113.8-") -and $t -notmatch [regex]::Escape("'140.82.112.0"))
    Yes '  and no read deny, folder lock, account, service or Defender step' ($t -notmatch $noLock)
    Yes '  only one script, and GitHub was never asked' (([regex]::Matches($t, '# ==== a script it would run')).Count -eq 1 -and -not (Test-Path -LiteralPath $ghCalled))
    $r = Dry @('-OffBox', '-NetworkOnly', '-Label', 'thornswood-vps')
    Yes "-NetworkOnly is let through with the VPS label (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -notmatch 'never takes the VPS label' -and $r.Text -match [regex]::Escape('Set-RunnerFirewall $grdAcct $grdGroup $grdBlocks') -and $r.Text -notmatch $noLock)
    $r = Dry @('-OffBox', '-Label', 'thornswood-vps')
    Yes "  while full -OffBox with the VPS label is still refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match 'never takes the VPS label' -and -not $r.Text)
    $r = Dry @('-Number', '5', '-Remove')
    Yes '-Remove on the VPS takes off the outbound rules, the Defender skip and, once the account is gone, its profile too (#3119)' ($r.Code -eq 0 -and $r.Text -match [regex]::Escape('Remove-RunnerFirewall $grdGroup') -and $r.Text -match [regex]::Escape("`$grdGroup = 'Thornswood PR runner thornswood-runner5'") -and $r.Text -match [regex]::Escape("Remove-MpPreference -ExclusionPath 'C:\Thornswood-Runner5'") -and $r.Text -match 'Remove-CimInstance' -and $r.Text.IndexOf("Remove-LocalUser -Name 'thornswood-runner5'") -gt 0 -and $r.Text.IndexOf("Remove-LocalUser -Name 'thornswood-runner5'") -lt $r.Text.IndexOf("Remove-LeftProfiles @('thornswood-runner5', 'thornswood-runner5.*')"))
    $r = Dry @('-NetworkOnly', '-Number', '4', '-Remove')
    Yes '-NetworkOnly -Remove takes the firewall group off and nothing else' ($r.Code -eq 0 -and $r.Text -match [regex]::Escape('Remove-RunnerFirewall $grdGroup') -and $r.Text -notmatch $noLock)
    $r = Dry @('-NetworkOnly', '-Number', '4', '-Status')
    Yes '-NetworkOnly -Status counts the rules' ($r.Code -eq 0 -and $r.Text -match [regex]::Escape('Get-RunnerFirewall $grdGroup'))
    $r = Dry @('-NetworkOnly', '-Lock')
    Yes "-NetworkOnly with -Lock is refused (exit $($r.Code))" ($r.Code -eq 1 -and -not $r.Text)

    # ---- runner 3's rules are any runner's (#4033) --------------------------
    $three = Dry @('-NetworkOnly', '-Number', '3')
    $four = Dry @('-NetworkOnly', '-Number', '4')
    $ranges = { param($t) [regex]::Match($t, '\$grdBlocks = (@\([^\r\n]*\))').Groups[1].Value }
    Yes "-NetworkOnly -Number 3 ends 0 (exit $($three.Code))" ($three.Code -eq 0 -and $three.Text -match [regex]::Escape("`$grdAcct = 'thornswood-runner3'"))
    Yes '  and blocks exactly what runner 4''s rules block: no Microsoft hole is left for signing' ((& $ranges $three.Text) -and (& $ranges $three.Text) -eq (& $ranges $four.Text) -and $three.Said -notmatch 'Service Tags|api\.nuget\.org')
    # ---- the range arithmetic ----------------------------------------------
    $rl = [regex]::Match($src, "(?s)\`$rangeLib = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
    Yes 'the range library is where it was' ($rl -match 'function Get-RunnerBlockRanges')
    . ([scriptblock]::Create($rl))
    $b = @(Get-RunnerBlockRanges @('10.0.0.0/8'))
    Yes 'one IPv4 range: the rest of IPv4, and all of IPv6' (($b -join ',') -eq '0.0.0.0-9.255.255.255,11.0.0.0-255.255.255.255,::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    $b = @(Get-RunnerBlockRanges @('10.0.0.0/8', '10.1.0.0/16', '11.0.0.0/8', '13.0.0.5', '0.0.0.0/32', '::/0'))
    Yes 'overlapping and touching ranges merge; a lone address stays lone' (($b -join ',') -eq '0.0.0.1-9.255.255.255,12.0.0.0-13.0.0.4,13.0.0.6-255.255.255.255')
    $b = @(Get-RunnerBlockRanges @('10.0.0.1/8'))
    Yes 'host bits in a CIDR are ignored' ($b[0] -eq '0.0.0.0-9.255.255.255')
    Yes 'nothing to allow blocks everything' ((@(Get-RunnerBlockRanges @()) -join ',') -eq '0.0.0.0-255.255.255.255,::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    Yes 'the Service Tags reader went with the signing runner' ($rl -notmatch 'Read-RunnerServiceTags|Get-RunnerReachMisses')

    # ---- the guards themselves, on stand-ins and scratch folders -----------
    $gl = [regex]::Match($src, "(?s)\`$guardLib = \(Get-ThornswoodFirewallScript\) \+ @'\r?\n(.*?)\r?\n'@").Groups[1].Value
    Yes 'the guard library is where it was' ($gl -match 'function Set-RunnerFirewall')
    $script:fw = New-Object Collections.ArrayList
    $script:gone = New-Object Collections.ArrayList
    # Stand-ins: functions win over the cmdlets, so no real rule is read or made.
    # Every store each one is asked for, and each refresh, are kept (#3896).
    $script:stores = New-Object Collections.ArrayList
    $script:syncs = 0
    function New-NetFirewallRule { param($PolicyStore, $DisplayName, $Group, $Direction, $Action, $Profile, $LocalUser, $RemoteAddress, $Description, $ErrorAction) [void]$script:stores.Add($PolicyStore); [void]$script:fw.Add(@{ Name = $DisplayName; Group = $Group; Direction = $Direction; Action = $Action; LocalUser = $LocalUser; Remote = @($RemoteAddress) }) }
    function Get-NetFirewallRule { param($PolicyStore, $Group, $ErrorAction) [void]$script:stores.Add($PolicyStore); @($script:fw | Where-Object { $_.Group -eq $Group } | ForEach-Object { New-Object PSObject -Property @{ Name = $_.Name; Enabled = 'True'; Remote = $_.Remote } }) }
    function Get-NetFirewallAddressFilter { param([Parameter(ValueFromPipeline = $true)]$Rule) process { New-Object PSObject -Property @{ RemoteAddress = @($Rule.Remote) } } }
    function Remove-NetFirewallRule { param($PolicyStore, $Name) [void]$script:stores.Add($PolicyStore); [void]$script:gone.Add($Name); $keep = @($script:fw | Where-Object { $_.Name -ne $Name }); $script:fw.Clear(); foreach ($k in $keep) { [void]$script:fw.Add($k) } }
    function Sync-ThornswoodFirewall { $script:syncs++ }
    # On the box the head sets the box's policy store, the only one its firewall takes rules from.
    $grdStore = 'localhost'
    . ([scriptblock]::Create($gl))
    $many = @(1..1203 | ForEach-Object { '10.0.' + [int][Math]::Floor($_ / 256) + '.' + ($_ % 256) })
    $said = Set-RunnerFirewall '*S-1-5-7' 'TS test group' $many
    Yes 'Set-RunnerFirewall: 1,203 ranges in three rules of 500' ($script:fw.Count -eq 3 -and $script:fw[2].Remote.Count -eq 203 -and $said -match '3 outbound rule')
    Yes '  every rule outbound, block, for that account''s SID only' (@($script:fw | Where-Object { $_.Direction -eq 'Outbound' -and $_.Action -eq 'Block' -and $_.LocalUser -eq 'D:(A;;CC;;;S-1-5-7)' -and $_.Group -eq 'TS test group' }).Count -eq 3)
    $null = Set-RunnerFirewall '*S-1-5-7' 'TS test group' @('1.2.3.4')
    Yes '  run again it replaces its rules, never piles them up' ($script:fw.Count -eq 1 -and $script:gone.Count -eq 3)
    Yes '  status counts them' (@(@(Get-RunnerFirewall 'TS test group') -match '1 outbound block rule').Count -eq 1)
    # The reach lines: each host a runner needs, resolved and held against the
    # rules. localhost stands in for GitHub's hosts, so nothing leaves here.
    $grdNeeds = @('localhost')
    $null = Set-RunnerFirewall '*S-1-5-7' 'TS test group' @('127.0.0.0-127.255.255.255', '10.0.0.0/255.0.0.0')
    $reach = @(Get-RunnerFirewall 'TS test group' | Where-Object { $_ -like 'reach*' })
    Yes ('  status says a host the rules block is BLOCKED (' + ($reach -join ' | ') + ')') ($reach.Count -eq 1 -and $reach[0] -match '127\.0\.0\.1 BLOCKED')
    $null = Set-RunnerFirewall '*S-1-5-7' 'TS test group' @('10.0.0.0/8')
    $reach = @(Get-RunnerFirewall 'TS test group' | Where-Object { $_ -like 'reach*' })
    Yes '  and one they leave open, open' ($reach.Count -eq 1 -and $reach[0] -match '127\.0\.0\.1 open' -and $reach[0] -notmatch 'BLOCKED')
    $null = Set-RunnerFirewall '*S-1-5-7' 'TS test group' @('1.2.3.4')
    $threw = $false; try { $null = Set-RunnerFirewall '*S-1-5-7' 'TS test group' @() } catch { $threw = $true }
    Yes '  an empty list changes nothing and says so' ($threw -and $script:fw.Count -eq 1)
    $null = Remove-RunnerFirewall 'TS test group'
    Yes 'Remove-RunnerFirewall takes the group off' ($script:fw.Count -eq 0 -and (Get-RunnerFirewall 'TS test group') -match 'NO RULES')
    Yes '  every rule read, made and taken away in the store the head names, and the policy refreshed after each change (#3896)' (
        @($script:stores | Where-Object { $_ -ne 'localhost' }).Count -eq 0 -and $script:stores.Count -gt 0 -and $script:syncs -eq 6)

    $u = Join-Path $work 'Users'; $pd = Join-Path $work 'ProgramData'; $dv = Join-Path $work 'D-root'
    foreach ($n in 'alice', 'Public', 'Default', 'thornswood-pr', 'thornswood-pr.ONE') { New-Item -ItemType Directory -Path (Join-Path $u $n) | Out-Null }
    foreach ($n in 'ssh', 'Docker', 'chocolatey') { New-Item -ItemType Directory -Path (Join-Path $pd $n) | Out-Null }
    New-Item -ItemType Directory -Path $dv | Out-Null
    $deny = @(Get-RunnerReadDenies 'thornswood-pr' $u $pd @($dv, (Join-Path $work 'no-drive')))
    $want = @($dv, (Join-Path $u 'alice'), (Join-Path $u 'Public'), (Join-Path $pd 'ssh'), (Join-Path $pd 'Docker'))
    Yes 'the read list: other drives, other profiles and Public, ProgramData ssh and Docker' ((@($deny | Sort-Object) -join '|') -eq (@($want | Sort-Object) -join '|'))
    Yes '  not its own profile, not Default, not the rest of ProgramData' (-not ($deny -match 'thornswood-pr|Default|chocolatey'))
    $dr = Join-Path $work 'R-root'; New-Item -ItemType Directory -Path $dr | Out-Null
    $deny = @(Get-RunnerReadDenies 'thornswood-pr' $u $pd @($dv, $dr) -Own $dr)
    Yes '  with its folder on the runner drive, every other drive but not that one (#3861)' (($deny -contains $dv) -and -not @($deny | Where-Object { $_.TrimEnd('\', '/') -eq $dr }).Count)
    if ($OnWindows) {
        $said = @(Close-RunnerReads '*S-1-5-7' $deny)
        Yes 'Close-RunnerReads denies the account each one' (@($deny | Where-Object { Denied $_ }).Count -eq $deny.Count -and -not ($said -match 'COULD NOT'))
        Yes '  and nothing else' (-not (Denied (Join-Path $u 'thornswood-pr')) -and -not (Denied (Join-Path $pd 'chocolatey')))
        $kid = Join-Path $u 'alice\Documents'; New-Item -ItemType Directory -Path $kid | Out-Null
        Yes '  the deny reaches what is inside' (Denied $kid)
        $null = Open-RunnerReads '*S-1-5-7' $deny
        Yes 'Open-RunnerReads takes every one off again' (@($deny | Where-Object { Denied $_ }).Count -eq 0 -and -not (Denied $kid))
    } else {
        Write-Host 'SKIP  Close-RunnerReads and Open-RunnerReads on scratch folders: they deny with icacls and are read back with Get-Acl, which only Windows has'
    }
} finally {
    $env:PATH = $oldPath
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
