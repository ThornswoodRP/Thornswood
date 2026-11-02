<#
  Install-Runner.ps1

  Puts a GitHub Actions runner on the VPS, so the build check runs on every
  pull request without paying for minutes. Run it from this machine; it
  does the remote half over ssh, the same way Install-Backup.ps1 does.

      .\scripts\deploy\Install-Runner.ps1              install the first one, or put it right
      .\scripts\deploy\Install-Runner.ps1 -Number 3    the third, beside the others
      .\scripts\deploy\Install-Runner.ps1 -Status      what is there and whether GitHub sees it
      .\scripts\deploy\Install-Runner.ps1 -Remove      take it off the box and off GitHub
      .\scripts\deploy\Install-Runner.ps1 -Lock        lock every runner on the box again,
                                                    touching no runner and no job, and
                                                    take off the old priority watchers
      .\scripts\deploy\Install-Runner.ps1 -OffBox      a pull request runner on THIS machine,
                                                    not the VPS (#1306), run elevated
      .\scripts\deploy\Install-Runner.ps1 -NetworkOnly -Number 4 -AllowHost pypi.org
                                                    the outbound firewall rules alone for
                                                    the fourth VPS runner's account (#2161)

  THROUGH THE DEPLOY GATE (-FromGate; #2862, Patrick's A on the report
  page's q-retire-box-keys, 31 Oct 2026: runners are renewed from the cloud,
  never from One). The gate's verb Install-Runner runs this on the box as
  SYSTEM, with -FromGate, the box's VPS names for -Number, and -AllowHost for
  the package feeds records\runner-isolation.json's decision names, so a
  cloud session puts a box runner back with
      pwsh scripts/vps/Box-Run.ps1 Install-Runner -Number 2
  (-Status, -Lock and -NetworkOnly go the same way). It reaches the box over
  loopback as every gate verb does, and GitHub with a token the box admin App
  mints for that run alone (scripts\vps\admin\ops-access.js runners:
  Administration write on the ops repository and nothing more), in GH_TOKEN
  for that run. The runners are the ops repository's (#4013), so that is the
  repository, whatever was asked. Renew only: an install names a runner the
  build records list or one already registered there; -Remove, -OffBox,
  -Migrate and hand-picked names and folders are refused.

  OFF THE BOX (-OffBox, issue #1306). build.yml sends a pull request to the
  label thornswood-pr, which no runner on the VPS carries, so code nobody has
  merged never runs beside the live server. -OffBox puts that runner on the
  machine this is run on (One, or a spare PC), in an elevated PowerShell, with
  no ssh at all: the same scripts the VPS gets run here instead. Its defaults
  are C:\Thornswood-RunnerPR, the account thornswood-pr, the runner name
  thornswood-pr-<computer> and the label thornswood-pr (-Number n puts the
  number on the end of each, the same as on the box). What changes from the box:
    - The account is shut out of every C:\Thornswood* folder, not only
      C:\Thornswood-*: on a developer machine the play build and the vault
      are C:\Thornswood and C:\Thornswood Vault, and neither has the hyphen
      (nor had C:\ThornswoodTemps&Worktrees, the worktrees until #2900).
      -AlsoDeny adds any other folder (another drive, say) to that list.
    - Defender keeps scanning the runner's folder unless -DefenderSkip is given.
      On the VPS the speed was worth it; on a machine people work on, a pull
      request's code is exactly what the scanner is for.
  Kept as on the box: an account in Users and nothing else with a password
  nobody sees, the runner's own folder locked to SYSTEM, Administrators and that
  account with nothing taken from C:\, the pinned runner zip, the service at
  normal priority, and the old priority tasks taken off. -Status, -Remove and
  -Lock take -OffBox too. -DryRunTo <file> writes the scripts it would run to
  that file and runs none of them, with a stand-in for every gh call, so
  tests\test-runner-offbox.ps1 can read them without touching an ACL, a
  service, an account or GitHub.

  NETWORK ONLY (-NetworkOnly, issue #2161). Patrick decided on 11 October 2026
  that the VPS runner accounts get the same outbound limit as an off-box
  runner. -NetworkOnly puts on THE NETWORK guard below and nothing else, for
  the one account -Number (or -Account) names: no account, service, runner,
  folder lock, read deny or Defender setting is touched, and no runner job is
  stopped. Without -OffBox it goes to the VPS over ssh like -Lock; with
  -OffBox it is this machine. It is the one mode that may name an account
  carrying the VPS label (full -OffBox still refuses it). -NetworkOnly -Status
  counts the rules, -NetworkOnly -Remove takes only that group off (the
  rollback), and -DryRunTo writes the script instead, as everywhere else.
  Fetch the lists again now and then the same way (run it again). An
  install on the box puts the same rules on in the same run, before the
  runner can take a job; until 27 Oct 2026 it put none on, and runner 4
  needed a -NetworkOnly run after its install (#3956).

  WHAT A PULL REQUEST JOB MAY REACH (-OffBox, or -NetworkOnly for the network
  alone). Two guards, put on by the
  install and by -OffBox -Lock, taken off by -OffBox -Remove, shown by -Status
  and written out by -DryRunTo like everything else:
    - THE NETWORK. Outbound block rules in Windows Firewall, in a group of
      their own ('Thornswood PR runner <account>'), that match only programs
      running as the runner's account (-LocalUser, the account's SID) and
      cover every address except GitHub's (the web, api, git and actions
      lists of https://api.github.com/meta, fetched when it runs, on the
      machine the rules go on, #3312), loopback, and whatever -AllowHost
      names resolve to then. Windows Firewall puts a
      block rule above any allow rule, so "block everything, allow GitHub"
      cannot be two rules: the block rules ARE the complement of GitHub's
      ranges. What that does not do: it has no idea of host names (a rule is
      addresses; the actions list is broad Azure space shared with others);
      the lists change, so -OffBox -Lock fetches them again and puts the
      rules back (a new GitHub range is blocked until then, which fails
      closed); DNS questions go out through the DNS Client service, not the
      account, so a job can still ask a name server (a DNS tunnel is possible);
      a job that asks a service running as another account to fetch for it
      (BITS, say) is not this account's traffic. build.yml installs the pinned
      ruff from PyPI, which is not GitHub: that step fails closed unless
      -AllowHost pypi.org,files.pythonhosted.org is given (their addresses at
      that moment; a CDN moves them).
    - WHAT IT MAY READ outside C:\Thornswood*. A deny for the account on the
      root of every other fixed or removable drive, on every profile in
      C:\Users but its own and Default (Public included), and on
      C:\ProgramData\ssh and C:\ProgramData\Docker. Each deny sits on that one
      folder and is inherited below it; -Remove takes exactly those off. What
      that does not do: a child with inheritance switched off keeps its own
      rules; Windows, Program Files and the rest of ProgramData stay readable,
      as every account's are, because the tools a build needs live there;
      and the runner and its jobs are one account, so a job can read the
      runner's own .credentials (GitHub's design, the same on the VPS).

  WHY. Every run of .github\workflows\build.yml has failed in seconds since
  02:10 on 25 September, because GitHub's own runners are blocked on billing.
  Decided by Patrick on 25 September (issue #437): a runner on the VPS rather
  than paying for minutes. build.yml asks for [self-hosted, Windows,
  thornswood-vps], which is every runner this puts there and nothing else.

  SEVERAL OF THEM. A runner takes one job at a time. On 4 October the queue
  was an hour long: eleven checks waiting while one ran, because the lanes
  open pull requests in bursts (five in seven seconds at 17:46) and every
  merge to main runs the check again. Patrick added a second runner that
  evening and asked for more. -Number n puts the nth beside the others: its
  own folder, account and runner name, each with the number on the end
  (C:\Thornswood-Runner3, thornswood-runner3, thornswood-vps-3), and the
  same label, so GitHub hands a waiting job to whichever is free. 1 is the
  first, with the names it has always had. -Status and -Remove take -Number
  the same way; -Lock does every runner on the box.

  HOW MANY BUILD AT ONCE (#2994). More runners than the box's six cores can
  carry only slow every build down: with seven at once on 21 October each
  harness step took 34 to 39 minutes and the 40-minute limit cancelled
  builds that were passing. The heavy jobs ask for a second label,
  thornswood-build, which only the runners records\build-runners.json lists
  carry (1 and 2 since 22 Oct 2026, #3114). This install registers a listed runner with it;
  Set-BuildRunners.ps1 puts GitHub right for runners already there.

  BUILD RUNNERS ON ONE (Patrick, 26 Oct 2026; history since #4983, when the
  public repository's builds left every runner of ours). The pull request
  build's fallback (build-pr.yml, launcher-vps) needed nothing of the box, so it asked
  for thornswood-pr-build alone; main's (build.yml) stayed on the box, which
  traces the gate (#3114, #3874). An -OffBox runner whose name
  records\pr-build-runners.json's offBox lists (thornswood-pr-one,
  thornswood-pr-one-2, ... on One) is registered with thornswood-pr-build
  too and takes them, on One's own cores. It never carries thornswood-build,
  which only ever means one of the box's build slots (#4010), nor
  thornswood-vps, so staff notices, the admin service, the release jobs and
  every other job that needs the box never reach it. Pass -AllowHost pypi.org,files.pythonhosted.org, or the build's
  ruff install fails closed (WHAT A PULL REQUEST JOB MAY REACH, above).
  -OffBox -Number n -Remove takes one off again.

  ON THE RUNNER DRIVE (#4048, #3861, Patrick's A on 27 Oct 2026). Off the box
  Defender scans each runner's folder (step 6), and a fresh runner's first
  build on One took 7 to 11 times the box's processor time for it. So One's
  runners live on the Dev Drive scripts\deploy\New-RunnerDrive.ps1 makes,
  where Defender scans in performance mode instead of not at all. When a
  volume labelled Thornswood Runners is there and -Root is not given, -OffBox
  puts the runner in <drive>:\Thornswood-RunnerPR<n>. Its account is shut
  out of the other runners' folders on that drive as on C:, the drive's own
  root is left out of the read denies (New-RunnerDrive.ps1 locks it), and
  the service starts by hand: the drive's startup task attaches the drive
  and then starts it. -OffBox refuses a -Root on any other drive. To move a
  runner there, one at a time, after preventing new assignments and draining
  the selected runner in an operator-approved maintenance window, run elevated:
      .\scripts\deploy\Install-Runner.ps1 -OffBox -Number 2 -Root R:\Thornswood-RunnerPR2 -Migrate -MaintenanceWindow -AllowHost pypi.org,files.pythonhosted.org
  Substitute the selected number and labelled drive; -Root names the explicit
  canonical destination, never a custom source folder.
  Or use Move-RunnersToDrive.ps1 to coordinate the selected cohort. Migration
  preserves the existing account SID and live profile; missing accounts or
  services need that coordinator's separate -Recover path. Source data is
  retained on failure, not automatically rolled back: resetting a password and
  replacing registration requires explicit service/registration repair.
  A busy read is not an atomic drain. -MaintenanceWindow confirms the operator
  has prevented new assignments for this runner, not merely checked idle once.

  WHAT IT DOES ON THE BOX, in order:
    1. Checks what the build check needs is there: pwsh, node, python and git
       on the machine PATH, MSBuild and the .NET Framework 4.8.1 reference
       assemblies the launcher's project files build with (#498; until
       15 Oct it checked the in-box csc, which builds nothing past C# 5), and
       WPF in Windows PowerShell. It installs none of them; it names the
       script that does.
    2. Makes a local account, thornswood-runner, that is in no group but
       Users. Its password is made on the box, handed to the service once and
       never printed, stored or sent anywhere.
    3. Denies that account every C:\Thornswood-* folder but its own and
       C:\Thornswood-Dumps (CRASH DUMPS, below), so a job cannot read the
       site's config, the bot's token or the backups, and cannot write into
       anything live. And locks its own folder to SYSTEM, Administrators and
       that account (below).
    4. Downloads a pinned actions/runner win-x64 zip (version + SHA-256
       hardcoded below, #1372), checked against that pin, and registers it as a
       service that runs as that account.
    5. Takes off the priority watcher task an older install left (NO
       PRIORITY TASK, below).
    6. Tells Windows Defender to skip the runner's own folder, so the few
       hundred processes a check starts are not each scanned on the way in.
    7. Writes the runner's .env so its jobs keep their temp files in its own
       folder (TEMP IN ITS OWN FOLDER, below).

  TEMP IN ITS OWN FOLDER (#3117). A job's TEMP and TMP were the runner
  account's own, C:\Users\thornswood-runnerN\AppData\Local\Temp, outside the
  folder step 6 has Defender skip and outside the job temp folder
  (_work\_temp) actions/runner empties for every job. Measured on the box on
  21 October 2026 with four builds running: the box at 80% CPU on average and
  99.7% at the top, Defender 15 to 31% of it, and 26,214 to 28,472 entries
  left in each build runner's temp folder, the oldest from 4 October. Each
  runner's .env (actions/runner reads it when its service starts) now sets
  TEMP and TMP to its _work\_temp, so what the tests write there is not
  scanned and is gone after the job. The install writes it before the
  service first starts; -Lock writes it for every runner on the box and says
  which runners take it only at their next start.

  It needs gh on this machine, signed in as somebody who can administer the
  repository (Patrick): the registration token comes from
  gh api -X POST repos/<repo>/actions/runners/registration-token. The token
  lasts an hour and is never printed.

  ITS OWN FOLDER TAKES NOTHING FROM C:\. A folder made under C:\ inherits
  Windows' rule that BUILTIN\Users may read it, and every service account on
  the box is in Users, every other runner's included. A runner's folder holds
  the credentials GitHub gave it (.runner, .credentials), so until 4 October
  the first runner's account could read the second's: the second's install
  shut its own account out of the first's folder, and nothing shut the first
  out of the second's, which did not exist when the first was installed. Now
  each runner's folder is locked the way #1105 locked the server folders:
  inheritance off, SYSTEM and Administrators Full Control, its own account
  Modify, and nobody else, which holds for runners added later as well.

  -LOCK puts that right on a box as it is, without replacing anything: for
  every runner service there, it locks the runner's folder, and shuts its
  account out of every C:\Thornswood-* folder but its own and Dumps, saying
  which it had to close, takes off a deny an earlier install put on Dumps
  for it, it takes off every priority watcher task left on the box, and it
  writes each runner's .env (TEMP IN ITS OWN FOLDER). No service is stopped
  and no job is touched. An install ends by doing the
  same for every runner, so adding one leaves all of them locked.

  CRASH DUMPS (#2127, #2488). Patrick decided on 11 October 2026 (#2127)
  that C:\Thornswood-Dumps is read by SYSTEM and Administrators only, and that
  LOCAL SERVICE and every local thornswood-runner* account may make and write
  files there and read nothing: Windows Error Reporting writes a crashing
  node.exe's dump there as the account that node ran as, a build's included.
  scripts\vps\Lock-VpsFolders.ps1 gives the folder those rules. Until 12
  October this script still put a full-control deny for each runner account
  on every C:\Thornswood-* folder, Dumps included, and a deny beats the write
  allow, so a build that crashed node left no dump: adding runners 5 and 6
  that day put the deny back on runners 1 to 4 (#2488). icacls /deny also
  takes away the account's own allow rules on that folder (measured 12
  October on a scratch folder), so the deny took the write with it. Now the
  folder is Lock-VpsFolders.ps1's alone on the VPS: the install, -Lock and
  the lock at the end of an install put no deny on it, take off the one an
  earlier install left there for a runner account and say so, and say when
  Users still reach it, which means Lock-VpsFolders.ps1 has not been run
  since. After a deny comes off, Lock-VpsFolders.ps1 is run again to give
  the write back.
  Off the box (-OffBox) nothing gives a pull request runner write there, so
  Dumps is shut to it like every other C:\Thornswood* folder.
  tests\test-runner-lock.ps1 holds it.

  NO PRIORITY TASK (#1969). Until 5 October each install registered a task,
  Thornswood Runner Priority (Thornswood Runner N Priority from the second
  on), that set Runner.Listener and Runner.Worker to Normal at start and
  every five minutes: a timer that repairs state, which docs/guide/rules.md
  "Fix the cause, no band-aids" does not allow. Until 25 September it set
  them to BelowNormal, which is where they ran then; since then it had nothing
  to repair. The runner is a Windows service (config.cmd --runasservice),
  and the service control manager starts a service at Normal, I/O priority 2
  and memory priority 5; the runner sets no priority of its own on Windows
  (actions/runner lowers a job's processes only on Linux, through
  oom_score_adj, in ProcessInvoker.cs). On the VPS on 5 October the runners
  measured Normal, 2 and 5 (PR #1967), and the watcher could not have given
  them the 2 and the 5: its line changes the class only, so a program a
  priority 7 task started went from BelowNormal, I/O 1, memory 2 to Normal,
  1 and 2, measured the same day (tests\test-runner-priority.ps1). The
  install, -Lock and -Remove take every such task off the box and name it;
  -Status says when one is still there. A build shares the box's six cores
  at Normal with the site, Caddy and the bot, never above them. Since
  12 Oct 2026 the game servers and voice run High, above every build:
  Patrick's decision, "we need to fix it so the servers run on high
  priority" (#2491, Install-ThornswoodServer.ps1 and Install-Voice.ps1).

  A REMOVED ACCOUNT'S PROFILE (#3119). Removing an account leaves its
  profile, C:\Users\<account>, and Windows gives a later account of the same
  name C:\Users\<account>.<computer> beside it. A runner's account is a
  service's, and Windows keeps a service account's registry loaded until the
  box restarts, even after the service stops and the account is gone; while
  it is loaded the profile cannot be taken off. Measured on the VPS on 22 Oct
  2026: removed runners 4 to 8 had their registry loaded hours later, with no
  logon session and nothing running as them, reg unload was refused, and
  stopping the Program Compatibility Assistant changed nothing; a new
  runner 3's registry was still loaded 60 seconds after its service stopped;
  the restart at 8:45 PM let go of every one. So -Remove, -Lock and the next
  install of that name take off each profile under a runner account's name
  whose account is gone, once Windows has let go of it, and say LEFT for one
  still loaded, until a restart. An install makes no new account while a
  profile of its name is LEFT, so it never makes a second one. Off-box, arrange
  an explicitly approved local PC restart on THIS machine, never a VPS script.
  In remote VPS mode only, restart the VPS with
  scripts\vps\Set-TimeWait.ps1 -Restart and run it again.

  Safe to run again. An existing runner is replaced, the account keeps its
  name and gets a new password, and the folder denials are made again.
  Replacing or removing one refuses while it is running a job, and touches nothing (#3889); -Lock does not stop jobs either.
#>
[CmdletBinding()]
param(
  [string]$VpsHost    = '',
  [string]$VpsUser    = '',
  [string]$Repo       = 'ThornswoodRP/Thornswood',
  # Which runner. 1 is the first, with the names below; from 2 up, the three
  # names after it get the number on the end unless they are given.
  [ValidateRange(1, 99)][int]$Number = 1,
  [string]$Root       = 'C:\Thornswood-Runner',
  [string]$Account    = 'thornswood-runner',
  [string]$RunnerName = 'thornswood-vps',
  # The label build.yml asks for. Change the two together.
  [string]$Label      = 'thornswood-vps',
  [switch]$Status,
  [switch]$Remove,
  [switch]$Lock,
  # A pull request runner on this machine rather than the VPS (#1306).
  [switch]$OffBox,
  # Healthy existing accounts only; deleted accounts need the separate recovery.
  [switch]$Migrate,
  # Operator has prevented new assignments and drained this runner's jobs.
  [switch]$MaintenanceWindow,
  # The outbound firewall rules alone for one runner account (#2161, NETWORK
  # ONLY above). With -Status or -Remove, those rules alone.
  [switch]$NetworkOnly,
  # Folders the runner's account is shut out of as well as C:\Thornswood*.
  [string[]]$AlsoDeny = @(),
  # Host names a job may reach besides GitHub, resolved to addresses when it
  # runs (WHAT A PULL REQUEST JOB MAY REACH), on an install, -Lock or -NetworkOnly.
  [string[]]$AllowHost = @(),
  # -OffBox only: let Defender skip the runner's folder as it does on the VPS.
  [switch]$DefenderSkip,
  # Write the scripts it would run to this file and run none of them; every gh
  # call gets a stand-in answer. For tests\test-runner-offbox.ps1.
  [string]$DryRunTo = '',
  # Run on the box by the deploy gate's Install-Runner verb (THROUGH THE
  # DEPLOY GATE above), with the box admin App's token.
  [switch]$FromGate,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
if ($Migrate) {
  if (-not $OffBox -or -not $MaintenanceWindow) { Write-Host 'STOP. Migrate requires -OffBox and -MaintenanceWindow. Prevent new assignments and drain the selected runner first; a busy read is not an atomic drain.'; exit 1 }
  if (-not $PSBoundParameters.ContainsKey('Root')) { Write-Host 'STOP. Migrate requires an explicit canonical -Root destination on the labelled runner drive.'; exit 1 }
  if ($Remove -or $Lock -or $Status -or $NetworkOnly -or $DefenderSkip -or $PSBoundParameters.ContainsKey('Account') -or $PSBoundParameters.ContainsKey('RunnerName') -or $PSBoundParameters.ContainsKey('Label') -or $VpsHost -or $VpsUser) { Write-Host 'STOP. Migrate cannot combine modes or custom account, runner name, label or remote source.'; exit 1 }
  if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository name' }
} elseif ($MaintenanceWindow) { Write-Host 'STOP. -MaintenanceWindow is only for -Migrate.'; exit 1 }
# A list typed as a,b,c reaches [string[]] as three items in this PowerShell
# (& .\Install-Runner.ps1) but as ONE string through pwsh -File, which then
# failed to resolve "pypi.org,files.pythonhosted.org,..." on the box (#2161,
# 21 Oct) or, for -AlsoDeny, named one folder that is not there and was passed
# over. Both are split on commas here, however the script was started. No
# host name has a comma, and no folder these deny does.
$AllowHost = @($AllowHost | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$AlsoDeny = @($AlsoDeny | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
# Where the box keeps its firewall rules, and the refresh that makes the
# firewall take a change to them (#3896).
. (Join-Path $Here '..\vps\BoxFirewall.ps1')
# THROUGH THE DEPLOY GATE (-FromGate, the header's section of that name).
if ($FromGate) {
  if ($env:THORNSWOOD_GATE -ne '1') { Write-Host 'STOP. -FromGate is for the deploy gate''s Install-Runner verb, which runs this on the box: scripts/vps/Box-Run.ps1 Install-Runner -Number <n>. Nothing was changed.' -ForegroundColor Red; exit 1 }
  $handPicked = @('Repo', 'Root', 'Account', 'RunnerName', 'Label', 'VpsHost', 'VpsUser', 'AlsoDeny') | Where-Object { $PSBoundParameters.ContainsKey($_) }
  if ($OffBox -or $Migrate -or $Remove -or $DryRunTo -or $DefenderSkip -or @($handPicked).Count) { Write-Host 'STOP. Through the gate a runner is installed, locked, read or given its network rules with the names and folders its number gives it, on the box, and never removed. Nothing was changed.' -ForegroundColor Red; exit 1 }
  $Repo = 'ThornswoodRP/Thornswood-Ops'
  . (Join-Path $Here '..\vps\admin\ShipAccess.ps1')
  # In this run's environment only: the gate starts every verb as a process
  # of its own, so the token goes with it, and GitHub ends it within the hour.
  try { $env:GH_TOKEN = Get-ThornswoodOpsAccess -Repo ([IO.Path]::GetFullPath((Join-Path $Here '..\..'))) -For runners }
  catch { Write-Host ('STOP. The box admin App gave no token for the runners of ' + $Repo + ': ' + $_.Exception.Message + ' Nothing was changed.') -ForegroundColor Red; exit 1 }
}
if (-not $OffBox) {
  if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
  if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
}

# The nth runner's names, the header's SEVERAL OF THEM. A name given on the
# command line wins. 'thornswood-runner99' is 19 characters, inside the 20 a
# local account may have.
if ($Number -gt 1) {
  if (-not $PSBoundParameters.ContainsKey('Root'))       { $Root = 'C:\Thornswood-Runner' + $Number }
  if (-not $PSBoundParameters.ContainsKey('Account'))    { $Account = 'thornswood-runner' + $Number }
  if (-not $PSBoundParameters.ContainsKey('RunnerName')) { $RunnerName = 'thornswood-vps-' + $Number }
}
# Off the box (the header's OFF THE BOX). Its own names, so it can never be
# mistaken for, or replace, a runner on the VPS. thornswood-pr99 is 15
# characters, inside the 20 a local account may have.
$liveFilter = 'Thornswood-*'
$runnerDrive = ''; $onRunnerDrive = $false
if ($OffBox) {
  $n = $(if ($Number -gt 1) { '' + $Number } else { '' })
  if (-not $PSBoundParameters.ContainsKey('Root'))       { $Root = 'C:\Thornswood-RunnerPR' + $n }
  # ON THE RUNNER DRIVE (#3861): New-RunnerDrive.ps1's Dev Drive, found by
  # its label, is where a runner goes when the command line names no folder.
  $runnerDrive = ''
  # Dry-run metadata is hermetic: no label lookup; an explicit non-C: root
  # simulates the runner drive. Otherwise the documented C: fixture wins.
  if (-not $DryRunTo) {
    try { $runnerDrive = @(Get-Volume -FileSystemLabel 'Thornswood Runners' -ErrorAction Stop | Where-Object { $_.DriveLetter } | ForEach-Object { [string]$_.DriveLetter + ':' })[0] } catch { $runnerDrive = '' }
  } elseif ($PSBoundParameters.ContainsKey('Root') -and $Root -match '^[D-Zd-z]:\\') { $runnerDrive = $Root.Substring(0, 2).ToUpper() }
  if (-not $runnerDrive) { $runnerDrive = '' }
  if ($runnerDrive -and -not $PSBoundParameters.ContainsKey('Root')) { $Root = $runnerDrive + '\Thornswood-RunnerPR' + $n }
  if (-not $PSBoundParameters.ContainsKey('Account'))    { $Account = 'thornswood-pr' + $n }
  if (-not $PSBoundParameters.ContainsKey('RunnerName')) { $RunnerName = 'thornswood-pr-' + [Environment]::MachineName.ToLower() + $(if ($n) { '-' + $n } else { '' }) }
  if (-not $PSBoundParameters.ContainsKey('Label'))      { $Label = 'thornswood-pr' }
  $liveFilter = 'Thornswood*'
  $rootDrive = $Root.Substring(0, 2).ToUpper()
  $onRunnerDrive = ($rootDrive -match '^[A-Z]:$' -and $rootDrive -ne 'C:' -and ($rootDrive -eq $runnerDrive.ToUpper() -or $DryRunTo))
  if ($rootDrive -ne 'C:' -and $rootDrive -ne $runnerDrive.ToUpper() -and -not $DryRunTo) { Write-Host ('STOP. ' + $Root + ' is on ' + $rootDrive + ', which is not the runner drive (New-RunnerDrive.ps1). A runner goes on C: or on that drive only: the read denies shut its account out of every other drive.') -ForegroundColor Red; exit 1 }
  if ($Label -match 'thornswood-vps' -and -not $NetworkOnly) { Write-Host 'STOP. -OffBox never takes the VPS label: every job that needs the box itself (staff notices, the admin service, the release jobs) asks for it.' -ForegroundColor Red; exit 1 }
}
# HOW MANY BUILD AT ONCE (#2994). A VPS runner that records\build-runners.json
# lists is registered with its build label as well, so a reinstall keeps the
# cap Set-BuildRunners.ps1 put on GitHub. An off-box runner never carries it:
# One's take the pull request build's fallback by the label below (#4010).
$registerLabels = $Label
$buildRecord = Get-Content -LiteralPath (Join-Path $Here '..\..\records\build-runners.json') -Raw | ConvertFrom-Json
if (-not $OffBox -and -not $PSBoundParameters.ContainsKey('Label')) {
  if (@($buildRecord.runners | ForEach-Object { [int]$_ }) -contains $Number) { $registerLabels = $Label + ',' + $buildRecord.label }
}
# PULL REQUEST BUILDS (#4010). records\pr-build-runners.json's label is the
# one the pull request build's fallback asks for: a VPS runner its runners
# list names carries it (2, not 1, which is kept for main's builds), and so
# does an off-box runner its offBox names, which still never carries
# thornswood-vps, so no box-only job reaches it.
$prRecord = Get-Content -LiteralPath (Join-Path $Here '..\..\records\pr-build-runners.json') -Raw | ConvertFrom-Json
if (-not $PSBoundParameters.ContainsKey('Label')) {
  $takesPr = $(if ($OffBox) { $prRecord.PSObject.Properties['offBox'] -and @($prRecord.offBox) -contains $RunnerName } else { @($prRecord.runners | ForEach-Object { [int]$_ }) -contains $Number })
  if ($takesPr) { $registerLabels = $registerLabels + ',' + $prRecord.label }
}
# On the box, the folders records\runner-isolation.json says no runner may
# reach that are not C:\Thornswood-* (C:\ProgramData\ssh, the
# administrator's profile) are denied with the Thornswood ones, at every
# install and every -Lock. Until 21 Oct only C:\Thornswood-* and a hand-given
# -AlsoDeny were, and Check-RunnerIsolation.ps1 -Collect read on 21 Oct that
# every runner account's rights on C:\ProgramData\ssh included read (#2161).
# A noReach entry that is a file, or under C:\Thornswood-*, is passed over
# here: the box script skips anything that is not a folder, and the
# Thornswood folders are denied by $liveFilter already.
if (-not $OffBox) {
  $isolation = Get-Content -LiteralPath (Join-Path $Here '..\..\records\runner-isolation.json') -Raw | ConvertFrom-Json
  $AlsoDeny = @(@($AlsoDeny) + @($isolation.noReach | Where-Object { $_ -and $_ -notlike 'C:\Thornswood-*' }) | Select-Object -Unique)
}
# The lists the scripts below are given, as PowerShell source. $leaveList is
# the folders under C:\ that Lock-VpsFolders.ps1 gives the runner accounts
# write on, which this script never denies them (the header's CRASH DUMPS).
$alsoDenyList = '@(' + ((@($AlsoDeny | Where-Object { $_ }) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ') + ')'
$leaveList = $(if ($OffBox) { '@()' } else { "@('Thornswood-Dumps')" })
$defenderOn = $(if ($OffBox -and -not $DefenderSkip) { '$false' } else { '$true' })
$where = $(if ($OffBox) { 'this machine' } else { 'the VPS' })
$guardGroup = 'Thornswood PR runner ' + $Account

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }
function Done() { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit 0 }

$target = "$VpsUser@$VpsHost"
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$tools = @('ssh', 'scp', 'gh')
if ($OffBox) { $tools = @('gh') }
if ($DryRunTo) { $tools = @() }
if ($NetworkOnly -and $Lock) { Write-Host 'STOP. -NetworkOnly and -Lock are two different jobs: run them one at a time.' -ForegroundColor Red; exit 1 }
if ($OffBox -and -not $DryRunTo) {
  $me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Die '-OffBox makes an account, a service and folder rules on this machine, so it needs PowerShell run as administrator.' }
}
foreach ($t in $tools) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    if ($t -ne 'gh') { Die "$t is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client." }
    Die 'gh is not on PATH. Install GitHub CLI from https://cli.github.com and run gh auth login.'
  }
}

# Short scripts go on the command line; the install is longer than cmd.exe's
# 8,191 characters once encoded, so it goes as a file and is deleted after,
# the same way Setup-Domain.ps1 does it. The registration token is never in
# the file: it goes on ssh's standard input (Send-Secret.ps1, issue #451).
# -OffBox runs the same scripts here, in a Windows PowerShell of their own (they
# end with exit, which would close this one), from a file removed after. A
# secret goes on that PowerShell's standard input, never in the file or on its
# command line, the same promise Send-Secret.ps1 keeps over ssh. -DryRunTo
# writes them down instead and runs nothing.
function Invoke-Here([string]$script, $secret = $null) {
  if ($DryRunTo) {
    Add-Content -LiteralPath $DryRunTo -Value ("# ==== a script it would run" + $(if ($null -ne $secret) { ', with a secret on standard input' } else { '' }) + " ====`r`n" + $script) -Encoding UTF8
    $global:LASTEXITCODE = 0
    return @('DRY RUN, nothing ran', 'service Running')
  }
  $pre = $(if ($null -ne $secret) { '$ThornswoodSecret = [Console]::In.ReadToEnd().Trim()' + "`r`n" } else { '' })
  $file = Join-Path ([IO.Path]::GetTempPath()) ('ts-runner-' + [Guid]::NewGuid().ToString('N') + '.ps1')
  [IO.File]::WriteAllText($file, $pre + $script, (New-Object Text.UTF8Encoding $true))
  $ErrorActionPreference = 'Continue'
  try {
    if ($null -ne $secret) { $out = @([string]$secret | & pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }) }
    else { $out = @(& pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" }) }
    $code = $LASTEXITCODE
  } finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  $global:LASTEXITCODE = $code
  return $out
}
function Remote($script) {
  if ($OffBox -or $DryRunTo) { return Invoke-Here $script }
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script
}
function Send-WithSecret($secret, [string]$script) {
  if ($OffBox -or $DryRunTo) { return Invoke-Here $script $secret }
  return Invoke-ThornswoodSecretRemote -Target $target -SshArgs $ssh -Secret $secret -Script $script
}
# gh with its output kept apart from its errors, and a failure that says which
# call it was. Named so it never shadows gh itself.
function Invoke-Gh {
  # The exit code decides, not stderr: under Stop, Windows PowerShell 5.1 threw
  # on any line gh wrote there (a notice, a warning) even through 2>$null, and
  # a failure came out as NativeCommandError instead of the message below.
  $ErrorActionPreference = 'Continue'
  if ($DryRunTo) {
    # Stand-ins, so a dry run asks GitHub nothing.
    $a = $args -join ' '
    if ($a -match 'registration-token|remove-token') { return 'DRY-RUN-TOKEN-NOT-REAL' }
    return ('{"runners":[{"name":"' + $RunnerName + '","status":"online","busy":false,"labels":[{"name":"' + $Label + '"}]}]}')
  }
  $out = & gh @args 2>$null
  if ($LASTEXITCODE -ne 0) { throw ('gh ' + ($args -join ' ') + ' failed') }
  return $out
}

$service = 'actions.runner.' + $Repo.Replace('/', '-') + '.' + $RunnerName
# A runner's Windows service is named for the repository it was registered
# to, and keeps that name when the repository moves: every runner registered
# before the move to ThornswoodRP on 1 Nov 2026 has an EvilPatrick06 service
# (#5184). So the one already there is looked for under both names
# (Find-RunnerService), and config.cmd gives a runner registered now the first.
$serviceNames = @($service)
$repoOwner, $repoName = $Repo.Split('/', 2)
if ($repoOwner -ne 'EvilPatrick06') { $serviceNames += ('actions.runner.EvilPatrick06-' + $repoName + '.' + $RunnerName) }
$serviceList = "@('" + ($serviceNames -join "', '") + "')"

# ------------------------------------------------------------- the locks --
# Run on the box, by the install for its own folder and by -Lock and the end
# of every install for each runner there (the header's ITS OWN FOLDER TAKES
# NOTHING FROM C:\ and -LOCK). Windows PowerShell 5.1 turns a native
# program's stderr into an error record, so these run with Continue and judge
# icacls by its exit code (#941).
$lockLib = @'
$broadSids = @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0')
# The header's TEMP IN ITS OWN FOLDER (#3117): the runner's .env sends its
# jobs' TEMP and TMP to the job temp folder actions/runner empties for every
# job, inside the folder Defender skips. Lines of the runner's own are kept.
# It is read when the runner's service starts, so one written while the
# runner runs is said, and waits for its next start.
# An off-box runner ($ownInstall) also names its own install folder,
# THORNSWOOD_INSTALL (#3860, Where.ps1 Install): on One the install rule finds
# Patrick's own game, C:\Thornswood, which its account is denied, and builds
# stopped on it. Under its own root, never made here, as a box runner sees a
# machine with no install at all, so no job looks in or writes to his game.
function Set-RunnerTemp([string]$root, [string]$svcName, [bool]$ownInstall = $false) {
  $file = Join-Path $root '.env'
  $temp = Join-Path $root '_work\_temp'
  $want = @(('TEMP=' + $temp), ('TMP=' + $temp))
  if ($ownInstall) { $want += ('THORNSWOOD_INSTALL=' + (Join-Path $root 'install')) }
  $had = @()
  if (Test-Path -LiteralPath $file) { $had = @(Get-Content -LiteralPath $file -EA Stop) }
  $keep = @($had | Where-Object { $_ -notmatch '^(TEMP|TMP|THORNSWOOD_INSTALL)=' })
  $new = @($keep) + $want
  if (($had -join "`n") -eq ($new -join "`n")) { return ($root + ' sends its jobs'' temp files to ' + $temp + ' already') }
  [IO.File]::WriteAllText($file, (($new -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  $line = $root + ' now sends its jobs'' temp files to ' + $temp
  $svc = Get-CimInstance Win32_Service -Filter ("Name='" + $svcName + "'") -EA SilentlyContinue
  if ($svc -and $svc.State -eq 'Running') { $line += '; its runner is running, so this takes effect when ' + $svcName + ' next starts' }
  return $line
}
function Lock-RunnerRoot([string]$root, [string]$acct) {
  $ErrorActionPreference = 'Continue'
  $out = & icacls.exe $root /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ($acct + ':(OI)(CI)M') /C /Q 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('icacls could not give ' + $root + ' its rules: ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
  $out = & icacls.exe $root /inheritance:r /C /Q 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('icacls could not stop ' + $root + ' taking rules from C:\: ' + (($out | ForEach-Object { "$_" }) -join ' ')) }
  $null = & icacls.exe $root /remove:g '*S-1-5-32-545' '*S-1-1-0' '*S-1-5-11' '*S-1-3-0' /C /Q 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('icacls could not remove broad grants from ' + $root) }
  # Read back: nothing taken from C:\, and nothing broad left on it.
  $acl = Get-Acl -LiteralPath $root
  $open = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
            Where-Object { "$($_.AccessControlType)" -eq 'Allow' -and $broadSids -contains $_.IdentityReference.Value })
  if (-not $acl.AreAccessRulesProtected -or $open.Count) {
    throw ($root + ' is still open: ' + $(if (-not $acl.AreAccessRulesProtected) { 'it takes rules from C:\' } else { (@($open | ForEach-Object { $_.IdentityReference.Value }) -join ', ') + ' may read it' }))
  }
  # By name where Windows still knows the account, by SID where it does not
  # (a runner taken off since leaves its deny behind). A collection translates
  # without throwing for one it cannot name, and hands that one back as its SID.
  $ids = New-Object Security.Principal.IdentityReferenceCollection
  foreach ($r in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { "$($_.AccessControlType)" -eq 'Allow' })) { $ids.Add($r.IdentityReference) }
  $who = @($ids.Translate([Security.Principal.NTAccount], $false) | ForEach-Object { ("$($_.Value)" -split '\\')[-1] } | Sort-Object -Unique)
  $root + ' is locked: only ' + ($who -join ', ') + ' may use it'
}
# Shuts the account out of every C:\Thornswood-* folder but its own, and says
# which of them it could have read until now: one with a rule letting it or
# Users, Everyone or Authenticated Users in, and no deny for it. An account
# may be given as *<SID>, the way icacls takes one. $parent is C:\ except in
# tests\test-runner-lock.ps1, which runs both of these on scratch folders.
# $filter is 'Thornswood-*' on the VPS and 'Thornswood*' off it (-OffBox), where
# the worktrees and the play build have no hyphen. $also is -AlsoDeny.
# $leave names the folders under $parent that Lock-VpsFolders.ps1 gives the
# runner accounts write on (Thornswood-Dumps on the VPS, the header's CRASH
# DUMPS): never denied, and a deny an earlier install put there for this
# account is taken off and named.
function Close-RunnerAccount([string]$acct, [string]$own, [string]$parent = 'C:\', [string]$filter = 'Thornswood-*', [string[]]$also = @(), [string[]]$leave = @()) {
  $ErrorActionPreference = 'Continue'
  $sid = ''
  if ($acct.StartsWith('*')) { $sid = $acct.Substring(1) }
  else {
    try { $sid = (New-Object Security.Principal.NTAccount($acct)).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { throw ('there is no account called ' + $acct + ' on this box: ' + $_.Exception.Message) }
  }
  if (-not $sid) { throw ('there is no account called ' + $acct + ' on this box') }
  $had = 0; $shut = 0; $wasOpen = @()
  $dirs = @(@(Get-ChildItem -LiteralPath $parent -Directory -Filter $filter -EA SilentlyContinue) +
            @($also | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | ForEach-Object { Get-Item -LiteralPath $_ }))
  foreach ($d in $dirs) {
    if ($d.FullName -eq $own) { continue }
    if ($leave -contains $d.Name -and $d.Parent.FullName.TrimEnd('\') -eq $parent.TrimEnd('\')) {
      $mine = @((Get-Acl -LiteralPath $d.FullName).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
                Where-Object { "$($_.AccessControlType)" -eq 'Deny' -and $_.IdentityReference.Value -eq $sid })
      if ($mine.Count) {
        $null = & icacls.exe $d.FullName /remove:d ('*' + $sid) /C /Q 2>&1
        $left = @((Get-Acl -LiteralPath $d.FullName).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
                  Where-Object { "$($_.AccessControlType)" -eq 'Deny' -and $_.IdentityReference.Value -eq $sid })
        if ($LASTEXITCODE -ne 0 -or $left.Count) { throw ('icacls could not take ' + $acct + '''s deny off ' + $d.FullName + ', which Lock-VpsFolders.ps1 gives it write on (#2127)') }
        $acct + ': took off the deny an earlier install put on ' + $d.FullName + '; that deny also took its write away, so run Lock-VpsFolders.ps1 to give it write and no read there again (#2127, #2488)'
      }
      continue
    }
    $rules = $null
    # Rules that cannot be read are taken as open, so the folder is denied and
    # named with those it could read, and why they could not be read is said.
    try { $rules = @((Get-Acl -LiteralPath $d.FullName -ErrorAction Stop).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
    catch { $acct + ': the rules on ' + $d.FullName + ' could not be read (' + $_.Exception.Message + '), so it is counted as one it could read' }
    if ($null -ne $rules -and @($rules | Where-Object { "$($_.AccessControlType)" -eq 'Deny' -and $_.IdentityReference.Value -eq $sid }).Count) { $had++; continue }
    # CREATOR OWNER (S-1-3-0) is not counted for the runner's account: Windows
    # gives it only on what an account makes there itself, and a runner
    # account that may make nothing there gets nothing from it. The admin
    # service's folder carries one for its log and state (ServiceAccount.ps1),
    # and on 27 Oct 2026 that alone named it as one runners 1 to 3 COULD READ,
    # which they could not (#3956). What it gives the service that does write
    # there, and every other task running as that same account, is not this
    # check's question (#4076, #4077). The deny goes on either way.
    $open = ($null -eq $rules) -or @($rules | Where-Object { "$($_.AccessControlType)" -eq 'Allow' -and $_.IdentityReference.Value -ne 'S-1-3-0' -and ($broadSids -contains $_.IdentityReference.Value -or $_.IdentityReference.Value -eq $sid) }).Count
    $null = & icacls.exe $d.FullName /deny ($acct + ':(OI)(CI)F') /C /Q 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('icacls could not shut ' + $acct + ' out of ' + $d.FullName) }
    if ($open) { $wasOpen += $d.FullName } else { $shut++ }
  }
  foreach ($w in $wasOpen) { $acct + ' COULD READ ' + $w + ' until now; shut out of it' }
  $acct + ': already shut out of ' + $had + ' folder(s)' + $(if ($shut) { ', and a deny added on ' + $shut + ' that were closed to it anyway' } else { '' })
}
# What -Remove runs: takes the account's deny off the same folders
# Close-RunnerAccount puts it on, its own folder aside, and reads each one
# back. The deny sits on each folder only, (OI)(CI) and inherited below, so
# taking it off there takes it off what is below too. Until #3112 -Remove
# took it off with icacls /T, which rewrote every file under each folder one
# by one: on 21 Oct 2026 removing runner 8 sat over ten minutes on
# C:\Users\Administrator alone. Read on the box on 22 Oct 2026: 13,987
# folders under the 27 that are denied, and not one deny by name for a runner
# account below them, so there was nothing below for /T to find. A line that
# starts COULD NOT names a folder the deny is still on.
function Open-RunnerAccount([string]$acct, [string]$own, [string]$parent = 'C:\', [string]$filter = 'Thornswood-*', [string[]]$also = @()) {
  $ErrorActionPreference = 'Continue'
  $sid = ''
  if ($acct.StartsWith('*')) { $sid = $acct.Substring(1) }
  else {
    try { $sid = (New-Object Security.Principal.NTAccount($acct)).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { return ($acct + ': no account of that name on this box, so it has no deny to take off: ' + $_.Exception.Message) }
  }
  $off = 0
  $dirs = @(@(Get-ChildItem -LiteralPath $parent -Directory -Filter $filter -EA SilentlyContinue) +
            @($also | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | ForEach-Object { Get-Item -LiteralPath $_ }))
  foreach ($d in $dirs) {
    if ($d.FullName -eq $own) { continue }
    $mine = { @((Get-Acl -LiteralPath $d.FullName -ErrorAction Stop).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { "$($_.AccessControlType)" -eq 'Deny' -and $_.IdentityReference.Value -eq $sid }) }
    try {
      if (-not (& $mine).Count) { continue }
      $null = & icacls.exe $d.FullName /remove:d ('*' + $sid) /C /Q 2>&1
      if ($LASTEXITCODE -ne 0 -or (& $mine).Count) { 'COULD NOT take ' + $acct + '''s deny off ' + $d.FullName; continue }
      $off++
    } catch { 'COULD NOT read the rules on ' + $d.FullName + ', so ' + $acct + '''s deny may still be on it: ' + $_.Exception.Message }
  }
  $acct + ': deny taken off ' + $off + ' folder(s)'
}
# Says, once for the box, what each $leave folder is: Lock-VpsFolders.ps1's,
# and whether Users, Everyone or Authenticated Users still reach it, which
# means that script has not been run on it, and every runner may read it.
function Show-LeftFolders([string]$parent = 'C:\', [string[]]$leave = @()) {
  foreach ($n in $leave) {
    $p = Join-Path $parent $n
    if (-not (Test-Path -LiteralPath $p -PathType Container)) { continue }
    $acl = Get-Acl -LiteralPath $p
    $broad = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { "$($_.AccessControlType)" -eq 'Allow' -and $broadSids -contains $_.IdentityReference.Value })
    if ($broad.Count) { $p + ' is left to Lock-VpsFolders.ps1 (#2127), and USERS STILL REACH IT, so every runner may read it: run .\scripts\vps\Remote.ps1 -File .\scripts\vps\Lock-VpsFolders.ps1 from the repository' }
    else { $p + ' is left to Lock-VpsFolders.ps1 (#2127): no deny from here, and Users do not reach it' }
  }
}
# The profile a removed runner account leaves (#3119, the header's A REMOVED
# ACCOUNT'S PROFILE). $like is the folder names under C:\Users to look at
# ('thornswood-runner3' and 'thornswood-runner3.*' for one account,
# 'thornswood-runner*' for the box). A profile whose SID still names an
# account is that account's and is left alone. One whose account is gone is
# taken off once Windows has let go of its registry, and said LEFT while it
# has not; a folder of that name no profile owns goes too. Each line it says
# that starts LEFT names one still there and why. Test-RunnerSidAlive is its
# own function so tests\test-runner-lock.ps1 can stand in for it off Windows.
function Test-RunnerSidAlive([string]$sid) {
  if (Get-LocalUser -SID $sid -EA SilentlyContinue) { return $true }
  try { $null = (New-Object Security.Principal.SecurityIdentifier($sid)).Translate([Security.Principal.NTAccount]); $true } catch { $false }
}
function Remove-LeftProfiles([string[]]$like, [string]$users = 'C:\Users') {
  $ErrorActionPreference = 'Continue'
  $owned = @{}
  foreach ($p in @(Get-CimInstance Win32_UserProfile -EA SilentlyContinue)) {
    $path = '' + $p.LocalPath
    $leaf = Split-Path -Leaf $path
    if (-not @($like | Where-Object { $leaf -like $_ }).Count) { continue }
    $owned[$leaf.ToLowerInvariant()] = $true
    if (Test-RunnerSidAlive $p.SID) { continue }
    if ($p.Loaded) { 'LEFT ' + $path + ': its account is gone and Windows keeps its registry loaded until the box restarts; the next -Lock or install after a restart takes it off'; continue }
    try { $p | Remove-CimInstance -EA Stop; 'took off ' + $path + ', the profile of a removed account (#3119)' }
    catch { 'LEFT ' + $path + ': its account is gone and it could not be taken off: ' + $_.Exception.Message }
  }
  foreach ($d in @(Get-ChildItem -LiteralPath $users -Directory -EA SilentlyContinue)) {
    if ($owned.ContainsKey($d.Name.ToLowerInvariant()) -or -not @($like | Where-Object { $d.Name -like $_ }).Count) { continue }
    Remove-Item -LiteralPath $d.FullName -Recurse -Force -EA SilentlyContinue
    if (Test-Path -LiteralPath $d.FullName) { 'LEFT ' + $d.FullName + ': no profile owns it and something holds a file in it' }
    else { 'took off ' + $d.FullName + ', a profile folder no account owned (#3119)' }
  }
}
# A runner is never taken off mid-job or by halves (#3889, 30 Oct: a job
# started between the idle check and a reinstall, Stop-Service and the removal
# of the old configuration failed without a word, the old listener kept running
# with its files open, and runner 3 was left with no service). The install and
# -Remove both ask this first, and stop with what is wrong.
function Get-RunnerProcesses([string]$root) {
  # -EA Stop: a process list that cannot be read is a stop, never an empty list.
  @(Get-CimInstance Win32_Process -EA Stop | Where-Object { ('' + $_.ExecutablePath) -like ($root.TrimEnd('\') + '\*') })
}
function Assert-RunnerIdle([string]$root) {
  $worker = @(Get-RunnerProcesses $root | Where-Object { $_.Name -eq 'Runner.Worker.exe' })
  if ($worker.Count) { throw ('this runner is running a job (Runner.Worker ' + (($worker | ForEach-Object { $_.ProcessId }) -join ', ') + '); nothing was changed. Run it again once -Status says it is idle.') }
}
# The service of a runner already here, under any of the names it may have
# (the first is the name a runner registered now gets), or that first name
# when there is none.
function Find-RunnerService([string[]]$names) {
  $found = @($names | Where-Object { Get-Service -Name $_ -EA SilentlyContinue })
  if ($found.Count -gt 1) { throw ('this runner has more than one service: ' + ($found -join ', ') + '; nothing was changed') }
  if ($found.Count) { return $found[0] }
  $names[0]
}
function Stop-RunnerHere([string]$root, [string[]]$names) {
  $svc = Find-RunnerService $names
  if (Get-Service -Name $svc -EA SilentlyContinue) { Stop-Service -Name $svc -Force -EA Stop }
  $left = @(Get-RunnerProcesses $root)
  if ($left.Count) { throw ('still running from ' + $root + ' after the stop: ' + (($left | ForEach-Object { $_.Name + ' ' + $_.ProcessId }) -join ', ')) }
  if (Get-Service -Name $svc -EA SilentlyContinue) {
    & sc.exe delete $svc 2>&1 | Out-Null
    if (Get-Service -Name $svc -EA SilentlyContinue) { throw ('the service ' + $svc + ' is still registered after sc.exe delete') }
    'the service that was there is removed'
  }
}
'@

# ------------------------------------------------------ the old watchers --
# The header's NO PRIORITY TASK. Sent with the install, -Lock, -Remove and
# -Status. A watcher is a task named the way installs before #1969 named
# theirs: '<prefix> Priority' or '<prefix> <n> Priority'. $prefix is
# 'Thornswood Runner' except in tests\test-runner-priority.ps1, which runs
# these on scratch tasks of its own.
$watcherLib = @'
function Get-RunnerWatchers([string]$prefix = 'Thornswood Runner') {
  $like = '^' + [regex]::Escape($prefix) + '( \d+)? Priority$'
  @(Get-ScheduledTask -EA SilentlyContinue | Where-Object { $_.TaskName -match $like })
}
function Remove-RunnerWatchers([string]$prefix = 'Thornswood Runner') {
  $found = @(Get-RunnerWatchers $prefix)
  if (-not $found.Count) { 'no priority watcher task on this box'; return }
  foreach ($w in $found) {
    try {
      Unregister-ScheduledTask -TaskName $w.TaskName -TaskPath $w.TaskPath -Confirm:$false -ErrorAction Stop
      'took off the priority watcher task ' + $w.TaskName + ' (#1969)'
    } catch { 'COULD NOT TAKE OFF the priority watcher task ' + $w.TaskName + ': ' + $_.Exception.Message }
  }
}
'@

# ------------------------------------------------- the off-box guards --
# The header's WHAT A PULL REQUEST JOB MAY REACH. $rangeLib runs here, on the
# machine that runs this script, and turns the address lists GitHub publishes
# into the ranges to block; tests\test-runner-offbox.ps1 lifts it out and
# checks its arithmetic. $guardLib runs where the runner is.
$rangeLib = @'
function ConvertTo-RunnerRange([string]$cidr) {
  $parts = $cidr.Trim().Split('/')
  $ip = [Net.IPAddress]::Parse($parts[0])
  $bytes = $ip.GetAddressBytes()
  $bits = $bytes.Length * 8
  $len = $(if ($parts.Count -gt 1) { [int]$parts[1] } else { $bits })
  if ($len -lt 0 -or $len -gt $bits) { throw ('not an address range: ' + $cidr) }
  $n = [bigint]0
  foreach ($b in $bytes) { $n = $n * 256 + $b }
  $size = [bigint]::Pow(2, $bits - $len)
  $lo = $n - ($n % $size)
  New-Object PSObject -Property @{ V = $(if ($bits -eq 32) { 4 } else { 6 }); Lo = $lo; Hi = $lo + $size - 1 }
}
function ConvertFrom-RunnerNumber([bigint]$n, [int]$v) {
  $count = $(if ($v -eq 4) { 4 } else { 16 })
  $bytes = New-Object byte[] $count
  for ($i = $count - 1; $i -ge 0; $i--) { $bytes[$i] = [byte][int]($n % 256); $n = [bigint]::Divide($n, 256) }
  ([Net.IPAddress]$bytes).ToString()
}
# Every address, IPv4 and IPv6, that is in none of $allow, as Windows Firewall
# ranges (a-b, or a lone address).
function Get-RunnerBlockRanges([string[]]$allow) {
  $out = New-Object Collections.Generic.List[string]
  $all = @($allow | Where-Object { $_ } | ForEach-Object { ConvertTo-RunnerRange $_ })
  foreach ($v in 4, 6) {
    $top = [bigint]::Pow(2, $(if ($v -eq 4) { 32 } else { 128 })) - 1
    $next = [bigint]0
    foreach ($r in @($all | Where-Object { $_.V -eq $v } | Sort-Object -Property Lo)) {
      if ($r.Lo -gt $next) {
        $a = ConvertFrom-RunnerNumber $next $v; $b = ConvertFrom-RunnerNumber ($r.Lo - 1) $v
        $out.Add($(if ($a -eq $b) { $a } else { $a + '-' + $b }))
      }
      if ($r.Hi + 1 -gt $next) { $next = $r.Hi + 1 }
    }
    if ($next -le $top) { $out.Add((ConvertFrom-RunnerNumber $next $v) + '-' + (ConvertFrom-RunnerNumber $top $v)) }
  }
  $out.ToArray()
}
'@
# The rules go where the runner is: on the box into its own policy store, the
# only one its firewall takes rules from, with Group Policy refreshed after
# (scripts\vps\BoxFirewall.ps1, #3896); off the box (-OffBox) into that
# machine's local store, as before, since its firewall is not run that way.
$guardLib = (Get-ThornswoodFirewallScript) + @'
# Outbound block rules for the account alone, replacing any it had.
function Set-RunnerFirewall([string]$acct, [string]$group, [string[]]$blocks, [int]$per = 500) {
  $sid = $(if ($acct.StartsWith('*')) { $acct.Substring(1) } else { (New-Object Security.Principal.NTAccount($acct)).Translate([Security.Principal.SecurityIdentifier]).Value })
  if (-not @($blocks).Count) { throw 'there is no address list to block, so the firewall was left as it was' }
  @(Get-NetFirewallRule -PolicyStore $grdStore -Group $group -EA SilentlyContinue) | ForEach-Object { Remove-NetFirewallRule -PolicyStore $grdStore -Name $_.Name }
  $why = 'Install-Runner.ps1 (#1306, #2161): this account reaches GitHub, loopback and the -AllowHost names only. -NetworkOnly -Remove takes it off.'
  $n = 0
  for ($i = 0; $i -lt $blocks.Count; $i += $per) {
    $n++
    $chunk = @($blocks[$i..([Math]::Min($i + $per, $blocks.Count) - 1)])
    New-NetFirewallRule -PolicyStore $grdStore -DisplayName ($group + ' ' + $n) -Group $group -Direction Outbound -Action Block -Profile Any -LocalUser ('D:(A;;CC;;;' + $sid + ')') -RemoteAddress $chunk -Description $why -EA Stop | Out-Null
  }
  if ($grdStore -eq 'localhost') { Sync-ThornswoodFirewall }
  'firewall: ' + $acct + ' may reach GitHub, this machine and what it was given only, ' + $blocks.Count + ' blocked range(s) in ' + $n + ' outbound rule(s), group ' + $group
}
function Remove-RunnerFirewall([string]$group) {
  $r = @(Get-NetFirewallRule -PolicyStore $grdStore -Group $group -EA SilentlyContinue)
  if (-not $r.Count) { 'firewall: no rule in ' + $group; return }
  $r | ForEach-Object { Remove-NetFirewallRule -PolicyStore $grdStore -Name $_.Name }
  if ($grdStore -eq 'localhost') { Sync-ThornswoodFirewall }
  'firewall: took off ' + $r.Count + ' rule(s) in ' + $group
}
function Get-RunnerFirewall([string]$group) {
  $r = @(Get-NetFirewallRule -PolicyStore $grdStore -Group $group -EA SilentlyContinue)
  if ($r.Count) { 'firewall  ' + $r.Count + ' outbound block rule(s), ' + @($r | Where-Object { "$($_.Enabled)" -eq 'True' }).Count + ' on (group ' + $group + ')' } else { 'firewall  NO RULES: a pull request job may reach anywhere. -OffBox -Lock puts them on' }
}
# The folders outside C:\Thornswood* it is shut out of. $users, $programData
# and $drives are C:\Users, C:\ProgramData and the other drives except in
# tests\test-runner-offbox.ps1, which gives scratch folders.
# $Own is the runner drive (New-RunnerDrive.ps1) when the runner's folder is
# on it: that drive's root is locked by New-RunnerDrive.ps1 and each folder
# on it by Lock-RunnerRoot, so its root is not denied, which would leave the
# account unable to look at the drive its own folder is on.
function Get-RunnerReadDenies([string]$acct, [string]$users = 'C:\Users', [string]$programData = $env:ProgramData, $drives = $null, [string]$Own = '') {
  if ($null -eq $drives) {
    $sys = '' + $env:SystemDrive
    $drives = @(Get-CimInstance Win32_LogicalDisk -EA SilentlyContinue | Where-Object { ($_.DriveType -eq 2 -or $_.DriveType -eq 3) -and $_.DeviceID -ne $sys } | ForEach-Object { $_.DeviceID + '\' })
  }
  if ($Own) { $drives = @($drives | Where-Object { $_ -and $_.TrimEnd('\') -ne $Own.TrimEnd('\') }) }
  $name = $acct.Split('\')[-1]
  $keep = @('Default', 'Default User', 'All Users')
  $out = @($drives | Where-Object { $_ })
  $out += @(Get-ChildItem -LiteralPath $users -Directory -Force -EA SilentlyContinue |
            Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $keep -notcontains $_.Name -and $_.Name -ne $name -and $_.Name -notlike ($name + '.*') } |
            ForEach-Object { $_.FullName })
  foreach ($p in 'ssh', 'Docker') { $out += (Join-Path $programData $p) }
  @($out | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
}
function Close-RunnerReads([string]$acct, [string[]]$paths) {
  $ErrorActionPreference = 'Continue'
  foreach ($p in $paths) {
    $null = & icacls.exe $p /deny ($acct + ':(OI)(CI)F') /C /Q 2>&1
    if ($LASTEXITCODE -eq 0) { 'shut out of: ' + $p } else { 'COULD NOT shut ' + $acct + ' out of ' + $p }
  }
}
function Open-RunnerReads([string]$acct, [string[]]$paths) {
  $ErrorActionPreference = 'Continue'
  foreach ($p in $paths) { $null = & icacls.exe $p /remove:d $acct /C /Q 2>&1 }
  'deny taken off ' + @($paths).Count + ' folder(s) outside C:\Thornswood*'
}
'@
. ([scriptblock]::Create($rangeLib))
# Where the runner is: the guards, as source. $mode is apply, remove or status.
function Get-GuardScript([string]$mode, [string[]]$blocks = @()) {
  $list = '@(' + ((@($blocks) | ForEach-Object { "'" + $_ + "'" }) -join ', ') + ')'
  $head = $guardLib + "`n`$grdAcct = '" + $Account.Replace("'", "''") + "'`n`$grdGroup = '" + $guardGroup.Replace("'", "''") + "'`n`$grdOwn = '" + $(if ($onRunnerDrive) { $rootDrive } else { '' }) + "'`n`$grdStore = '" + $(if ($OffBox) { 'PersistentStore' } else { 'localhost' }) + "'`n"
  if ($mode -eq 'status') { return $head + 'Get-RunnerFirewall $grdGroup' }
  if ($mode -eq 'network-remove') { return $head + "Remove-RunnerFirewall `$grdGroup`n" }
  if ($mode -eq 'network') { return $head + "`$grdBlocks = " + $list + "`nSet-RunnerFirewall `$grdAcct `$grdGroup `$grdBlocks`n" }
  if ($mode -eq 'remove') { return $head + "Remove-RunnerFirewall `$grdGroup`nOpen-RunnerReads `$grdAcct (Get-RunnerReadDenies `$grdAcct -Own `$grdOwn)`n" }
  return $head + "`$grdBlocks = " + $list + "`nSet-RunnerFirewall `$grdAcct `$grdGroup `$grdBlocks`nClose-RunnerReads `$grdAcct (Get-RunnerReadDenies `$grdAcct -Own `$grdOwn)`n"
}
# WHERE THE LISTS ARE READ (#3312). GitHub's lists are read on the machine
# the rules go on, the box or (-OffBox) this one, by $listLib: its own
# traffic is what the rules hold. That also lets a cloud session run this:
# its GitHub access refuses api.github.com/meta ("sessions are bound to their
# configured repositories", 22 Oct 2026), and the box's does not. The script
# prints one line per range, which the parse below reads, and stops at the
# first thing it cannot read.
$listLib = @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
function Get-RunnerLists {
  try {
    $meta = ([Text.Encoding]::UTF8.GetString((Invoke-WebRequest -Uri 'https://api.github.com/meta' -UseBasicParsing -TimeoutSec 300).RawContentStream.ToArray())).TrimStart([char]0xFEFF) | ConvertFrom-Json
    foreach ($k in 'web', 'api', 'git', 'actions') { foreach ($p in @($meta.$k | Where-Object { $_ })) { "list`tgithub-$k`t$p" } }
  } catch { "error`t" + $_.Exception.Message; exit 1 }
}
'@
# GitHub's lists, as a hashtable of name to prefixes: github-web, github-api,
# github-git and github-actions. The dry run asks no one and gives stand-ins.
function Get-PublishedLists {
  $out = @{}
  if ($DryRunTo) {
    $out['github-web'] = @('140.82.112.0/20', '2a0a:a440::/29'); $out['github-api'] = @('192.30.252.0/22')
    $out['github-git'] = @('140.82.112.0/20'); $out['github-actions'] = @('4.148.0.0/16')
    return $out
  }
  $said = @(Remote ($listLib + "`nGet-RunnerLists`n"))
  $code = $LASTEXITCODE
  foreach ($line in $said) {
    $f = ([string]$line).Split("`t")
    if ($f[0] -eq 'error' -and $f.Count -ge 2) { throw ('reading the published lists on ' + $where + ': ' + $f[1]) }
    if ($f[0] -eq 'list' -and $f.Count -eq 3) { if (-not $out.ContainsKey($f[1])) { $out[$f[1]] = @() }; $out[$f[1]] += $f[2] }
  }
  if ($code -ne 0) { throw ('reading the published lists on ' + $where + ' stopped (exit ' + $code + '): ' + (@($said | Select-Object -Last 3) -join ' ')) }
  return $out
}
# GitHub's published lists, loopback and -AllowHost, as the ranges to block.
function Get-GuardBlocks {
  $lists = Get-PublishedLists
  $allow = @('127.0.0.0/8', '::1/128')
  foreach ($k in 'web', 'api', 'git', 'actions') {
    $got = @($lists['github-' + $k] | Where-Object { $_ })
    if (-not $got.Count) { throw ('api.github.com/meta has no ' + $k + ' list, so no firewall rule was made') }
    $allow += $got
  }
  # Ordinary install dry runs still check host resolution. Migration dry runs
  # are wholly fixture-driven, including DNS, so they can be reviewed off-PC.
  # Both write the stand-in 203.0.113.7, not real addresses, to the plan.
  foreach ($h in @($AllowHost | Where-Object { $_ })) {
    $ips = @()
    if ($DryRunTo -and $Migrate) { $ips = @('203.0.113.7') }
    else { try { $ips = @([Net.Dns]::GetHostAddresses($h) | ForEach-Object { $_.IPAddressToString }) } catch { throw ('-AllowHost ' + $h + ' does not resolve: ' + $_.Exception.Message) } }
    if (-not $ips.Count) { throw ('-AllowHost ' + $h + ' resolves to nothing') }
    if ($DryRunTo) {
      $allow += '203.0.113.7/32'
      Say ('  -AllowHost ' + $h + ': ' + ($ips -join ', ') + ' (dry run writes 203.0.113.7; migration uses fixture DNS)') 'Yellow'
      continue
    }
    $allow += $ips
    Say ('  -AllowHost ' + $h + ': ' + ($ips -join ', ') + ' (as of now)') 'Yellow'
  }
  Get-RunnerBlockRanges $allow
}

# Every runner service on the box, by what Windows says it is: its folder is
# the one its RunnerService.exe is in, its account the one it runs as. Then
# the old priority watchers, which belong to no one runner.
$profileLike = $(if ($OffBox) { 'thornswood-pr*' } else { 'thornswood-runner*' })
$lockAll = $lockLib + $watcherLib + "`n`$liveFilter = '" + $liveFilter + "'`n`$alsoDeny = " + $alsoDenyList + "`n`$leave = " + $leaveList + "`n`$profileLike = '" + $profileLike + "'`n" + @'

$ErrorActionPreference = 'Continue'
$bad = 0
foreach ($line in @(Remove-RunnerWatchers)) { $line; if ($line -like 'COULD NOT*') { $bad++ } }
$services = @(Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'" -EA SilentlyContinue)
if (-not $services.Count) { 'no runner service on this box' }
foreach ($svc in $services) {
  $exe = ('' + $svc.PathName).Trim().Trim('"')
  $root = Split-Path -Parent (Split-Path -Parent $exe)
  $acct = (('' + $svc.StartName) -split '\\')[-1]
  if ($root -notmatch '^[A-Za-z]:\\Thornswood-Runner') { $svc.Name + ' runs from ' + $exe + ', not a Thornswood-Runner folder at the root of a drive, so it was left alone'; $bad++; continue }
  if (-not $acct -or $acct -match '^(LocalSystem|LocalService|NetworkService)$') { $svc.Name + ' runs as ' + $svc.StartName + ', not an account of its own, so it was left alone'; $bad++; continue }
  try {
    Lock-RunnerRoot $root $acct
    Close-RunnerAccount $acct $root 'C:\' $liveFilter $alsoDeny $leave
    # ON THE RUNNER DRIVE (New-RunnerDrive.ps1): the other runners' folders there too.
    if ($root -notlike 'C:\*') { Close-RunnerAccount $acct $root $root.Substring(0, 3) $liveFilter }
  } catch { 'NOT LOCKED: ' + $svc.Name + ': ' + $_.Exception.Message; $bad++ }
  try { Set-RunnerTemp $root $svc.Name ($acct -like 'thornswood-pr*') } catch { 'TEMP NOT SET: ' + $svc.Name + ': ' + $_.Exception.Message; $bad++ }
}
Show-LeftFolders 'C:\' $leave
# A removed runner's profile is not a lock, so one still left is said and
# does not fail the lock (A REMOVED ACCOUNT'S PROFILE).
Remove-LeftProfiles @($profileLike)
if ($bad) { exit 1 }
'@

# ------------------------------------------------------------ network only --
# The header's NETWORK ONLY: the firewall group for one account, nothing else.
if ($NetworkOnly) {
  if ($Status) {
    Head ('Outbound rules for ' + $Account + ' on ' + $where)
    Remote (Get-GuardScript 'status') | ForEach-Object { Say "  $_" }
    Done
  }
  if ($Remove) {
    Head ('Outbound rules for ' + $Account + ' on ' + $where + ', taken off')
    $said = @(Remote (Get-GuardScript 'network-remove'))
    $code = $LASTEXITCODE
    $said | ForEach-Object { Say "  $_" }
    if ($code -ne 0) { Die "the rules may not all be off (exit $code); the lines above say which." }
    Done
  }
  Head ('What ' + $Account + ' may reach from ' + $where)
  try { $blocks = @(Get-GuardBlocks) } catch { Die ('no firewall rule was changed: ' + $_.Exception.Message) }
  $said = @(Remote (Get-GuardScript 'network' $blocks))
  $code = $LASTEXITCODE
  $said | ForEach-Object { Say "  $_" }
  if ($code -ne 0) { Die "the firewall rules did not go on (exit $code); the lines above say which. Nothing else was changed." }
  Done
}

# ------------------------------------------------------------------ status --
if ($Status) {
  Head 'On the VPS'
  Remote ($lockLib + $watcherLib + @"
`$ErrorActionPreference = 'SilentlyContinue'
if (Test-Path '$Root\config.cmd') { 'runner    in $Root' } else { 'runner    NOT THERE' }
`$svc = Find-RunnerService $serviceList
`$s = Get-Service -Name `$svc
if (`$s) { 'service   ' + `$svc + ', ' + `$s.Status + ', starts ' + `$s.StartType } else { 'service   NOT REGISTERED' }
`$w = Get-CimInstance Win32_Service -Filter "Name='`$svc'"
if (`$w) { 'runs as   ' + `$w.StartName }
foreach (`$p in (Get-Process Runner.Listener, Runner.Worker)) { 'process   ' + `$p.ProcessName + ' at ' + `$p.PriorityClass }
if (Get-LocalUser -Name '$Account') { 'account   $Account' } else { 'account   NOT THERE' }
if (Test-Path '$Root') {
  `$a = Get-Acl -LiteralPath '$Root'
  `$wide = @(`$a.GetAccessRules(`$true, `$true, [Security.Principal.SecurityIdentifier]) | Where-Object { "`$(`$_.AccessControlType)" -eq 'Allow' -and @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0') -contains `$_.IdentityReference.Value })
  if (`$a.AreAccessRulesProtected -and -not `$wide.Count) { 'folder    locked: takes nothing from C:\' } else { 'folder    OPEN to every account on the box: -Lock locks it' }
}
`$old = @(Get-RunnerWatchers)
if (`$old.Count) { 'priority  OLD WATCHER TASK still here: ' + ((`$old | ForEach-Object { `$_.TaskName }) -join ', ') + '. -Lock takes it off' }
else { 'priority  no watcher task; the service starts the runner at normal' }
"@) | ForEach-Object { Say "  $_" }
  if ($OffBox) { Remote (Get-GuardScript 'status') | ForEach-Object { Say "  $_" } }
  Head 'On GitHub'
  try {
    $r = (Invoke-Gh api "repos/$Repo/actions/runners" | Out-String) | ConvertFrom-Json
    $mine = @($r.runners | Where-Object { $_.name -eq $RunnerName })
    if ($mine.Count) { foreach ($m in $mine) { Say ('  ' + $m.name + ', ' + $m.status + $(if ($m.busy) { ', running a job' } else { '' }) + ', labels ' + (($m.labels | ForEach-Object { $_.name }) -join ', ')) } }
    else { Say "  no runner called $RunnerName is registered" 'Yellow' }
  }
  catch { Say ('  could not ask GitHub: ' + $_.Exception.Message) 'Yellow' }
  Done
}

# ------------------------------------------------------------------ remove --
if ($Remove) {
  Head 'Removing the runner'
  $tok = $null
  try { $tok = (Invoke-Gh api -X POST "repos/$Repo/actions/runners/remove-token" --jq .token | Out-String).Trim() } catch { Say '  could not get a removal token; the box is cleaned and GitHub is left to forget it' 'Yellow' }
  # The removal token goes on ssh's standard input and reaches config.cmd in
  # its environment, never on a command line (Send-Secret.ps1, issue #451).
  # The far side's exit code decides, as for -NetworkOnly -Remove: until
  # #3214 it was not read, so two removals whose ssh was cut 8 minutes in
  # ended with exit 0 and half their lines.
  $said = @(Send-WithSecret ([string]$tok) ($lockLib + $watcherLib + "`n" + @"
`$ErrorActionPreference = 'Continue'
`$t = `$ThornswoodSecret; `$ThornswoodSecret = `$null
# Never mid-job, before GitHub is told anything (#3889).
Assert-RunnerIdle '$Root'
if ((Test-Path '$Root\config.cmd') -and `$t) {
  Push-Location '$Root'
  `$env:ACTIONS_RUNNER_INPUT_TOKEN = `$t; `$t = `$null
  & .\config.cmd remove 2>&1 | Select-Object -Last 3
  Remove-Item Env:\ACTIONS_RUNNER_INPUT_TOKEN -EA SilentlyContinue
  Pop-Location
}
Stop-RunnerHere '$Root' $serviceList
Remove-RunnerWatchers
Open-RunnerAccount '$Account' '$Root' 'C:\' '$liveFilter' $alsoDenyList
$(if ($onRunnerDrive) { "Open-RunnerAccount '" + $Account + "' '" + $Root + "' '" + $rootDrive + "\' '" + $liveFilter + "'" })
$(if ($OffBox) { Get-GuardScript 'remove' } else { Get-GuardScript 'network-remove' })
# What the install put outside the folder goes too: the Defender skip, which
# would leave a later folder at this path unscanned, and the account's
# profile, which Remove-LocalUser leaves (a later account of the same name
# then gets a <name>.<computer> profile beside it). Measured on the VPS on
# 20 Oct 2026: C:\Users\thornswood-runner5 and 6 left from removed runners.
# The profile goes once the account has (A REMOVED ACCOUNT'S PROFILE).
if (@((Get-MpPreference -EA SilentlyContinue).ExclusionPath) -contains '$Root') {
  try { Remove-MpPreference -ExclusionPath '$Root' -EA Stop; 'Defender scans $Root again' } catch { 'COULD NOT take off the Defender skip for $Root' + ': ' + `$_.Exception.Message }
}
Remove-LocalUser -Name '$Account' -EA SilentlyContinue
Remove-LeftProfiles @('$Account', '$Account.*')
Remove-Item -LiteralPath '$Root' -Recurse -Force -EA SilentlyContinue
if (Test-Path '$Root') { 'the folder is still there, something holds a file in it' } else { 'runner, account and folder removed' }
"@))
  $code = $LASTEXITCODE
  $said | ForEach-Object { Say "  $_" }
  if ($code -ne 0) { Die "the removal did not say it finished (exit $code); the lines above say how far it got, and -Status says what is left." }
  Done
}

# -------------------------------------------------------------------- lock --
if ($Lock) {
  Head 'Every runner on the box, locked'
  $said = @(Remote $lockAll)
  $code = $LASTEXITCODE
  $said | ForEach-Object { Say "  $_" }
  if ($code -ne 0) { Die "the lock did not finish for every runner (exit $code); the lines above say which." }
  if ($OffBox) {
    # The header's WHAT A PULL REQUEST JOB MAY REACH: GitHub's lists fetched
    # again, so a range GitHub added since is let through.
    Head 'What a pull request job may reach and read'
    try { $blocks = @(Get-GuardBlocks) } catch { Die ('no firewall rule was changed: ' + $_.Exception.Message) }
    $said = @(Remote (Get-GuardScript 'apply' $blocks))
    $code = $LASTEXITCODE
    $said | ForEach-Object { Say "  $_" }
    if ($code -ne 0 -or ($said -join ' ') -match 'COULD NOT') { Die "the guards did not all go on (exit $code); the lines above say which." }
  }
  Done
}

# Healthy migration keeps identity; recovery is deliberately a different operation.
$migrateLib = @'
function Invoke-RunnerMigrationNative([string]$command, [string[]]$arguments) {
  $ErrorActionPreference = 'Continue'
  $text = @(& $command @arguments 2>&1 | ForEach-Object { "$_" })
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw ($command + ' failed (exit ' + $code + ')') }
  $text
}
function Clear-RunnerMigrationDeny($plan, [string]$path) {
  if ($path -ne ($plan.Drive + '\') -and $path -ne $plan.Root) { throw 'Deny removal is restricted to the validated own drive root and own target' }
  $mine = { @((Get-Acl -LiteralPath $path).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { [string]$_.AccessControlType -eq 'Deny' -and $_.IdentityReference.Value -eq $plan.SID }) }
  $before = @(& $mine)
  if (@($before | Where-Object { $_.IsInherited }).Count) { throw 'An inherited blocking deny needs explicit ACL review; migration will not open an ancestor' }
  if ($before.Count) { $null = Invoke-RunnerMigrationNative 'icacls.exe' @($path, '/remove:d', ('*' + $plan.SID), '/C', '/Q') }
  if (@(& $mine).Count) { throw ('Selected SID still has a blocking deny on ' + $path) }
}
function Get-RunnerMigrationProcesses($plan) {
  foreach ($p in @(Get-CimInstance Win32_Process -EA Stop)) {
    # The dedicated SID finds child tools outside the runner directory too.
    # Protected system processes need not disclose ownership; an unreadable
    # process under the selected root, however, cannot be assumed unrelated.
    $inRoot = ([string]$p.ExecutablePath).StartsWith($plan.Source + '\', [StringComparison]::OrdinalIgnoreCase) -or ([string]$p.ExecutablePath).StartsWith($plan.Root + '\', [StringComparison]::OrdinalIgnoreCase)
    $owner = $null
    try { $owner = Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -EA Stop } catch { if ($inRoot) { throw }; continue }
    if ($owner.ReturnValue -ne 0) { if ($inRoot) { throw 'Cannot identify a selected runner process owner' }; continue }
    if ($owner.Sid -eq $plan.SID) { $p }
    elseif ($inRoot) { throw 'A selected runner executable has an unexpected owner' }
  }
}
function Stop-RunnerForMigration($plan) {
  if (@(Get-RunnerMigrationProcesses $plan | Where-Object { $_.Name -eq 'Runner.Worker.exe' }).Count) { throw 'Selected runner has a worker: maintenance window is not drained' }
  Stop-Service -Name $plan.Service -Force -EA Stop
  $selected = Get-Service -Name $plan.Service -EA Stop
  try { $selected.WaitForStatus('Stopped', [timespan]::FromSeconds(30)) }
  finally { $selected.Dispose() } # Do not keep SCM deletion pending ourselves.
  # Service stop and listener shutdown are asynchronous OS operations, not a
  # job-drain guarantee. Wait a bounded time for this SID only; never kill jobs.
  $until = [datetime]::UtcNow.AddSeconds(30)
  while (@(Get-RunnerMigrationProcesses $plan).Count) {
    if ([datetime]::UtcNow -ge $until) { throw 'Selected account processes did not exit; password was not reset' }
    Start-Sleep -Milliseconds 250
  }
}
function Assert-RunnerMigrationService($plan) {
  if ([string](Get-LocalUser -Name $plan.Account -EA Stop).SID -ne $plan.SID) { throw 'Migration changed the account SID' }
  $s = Get-CimInstance Win32_Service -Filter ("Name='" + $plan.Service + "'") -EA Stop
  $names = @(('.\' + $plan.Account), ([Environment]::MachineName + '\' + $plan.Account))
  if (-not $s -or $s.Name -ne $plan.Service -or ([string]$s.PathName).Trim().Trim('"') -ne ($plan.Root + '\bin\RunnerService.exe') -or $names -notcontains $s.StartName -or $s.StartMode -ne 'Manual' -or $s.State -ne 'Running') { throw 'Selected service path, StartName, manual start or running state did not verify' }
  $profiles = @(Get-CimInstance Win32_UserProfile -EA Stop | Where-Object { $_.SID -eq $plan.SID -or $_.LocalPath -eq $plan.Profile -or $_.LocalPath -like ($plan.Profile + '.*') })
  if ($profiles.Count -ne 1 -or $profiles[0].SID -ne $plan.SID -or $profiles[0].LocalPath -ne $plan.Profile) { throw 'Live profile identity/path changed' }
  $listeners = @(Get-RunnerMigrationProcesses $plan | Where-Object { $_.Name -eq 'Runner.Listener.exe' -and $_.ExecutablePath -eq ($plan.Root + '\bin\Runner.Listener.exe') })
  if ($listeners.Count -ne 1) { throw 'Selected destination listener did not verify' }
}
function Assert-RunnerMigrationAccess($plan) {
  $applies = @($plan.SID, 'S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0')
  foreach ($path in @(($plan.Drive + '\'), $plan.Root)) {
    $acl = Get-Acl -LiteralPath $path
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (@($rules | Where-Object { [string]$_.AccessControlType -eq 'Deny' -and $applies -contains $_.IdentityReference.Value }).Count) { throw ('A selected SID/group deny still blocks own access on ' + $path) }
    if ($path -eq $plan.Root) {
      $allows = @($rules | Where-Object { [string]$_.AccessControlType -eq 'Allow' })
      $own = @($allows | Where-Object { $_.IdentityReference.Value -eq $plan.SID -and ([long]$_.FileSystemRights -band [long][Security.AccessControl.FileSystemRights]::Modify) -eq [long][Security.AccessControl.FileSystemRights]::Modify })
      if (-not $acl.AreAccessRulesProtected -or $own.Count -ne 1 -or @($allows | Where-Object { $_.IdentityReference.Value -notin @($plan.SID,'S-1-5-18','S-1-5-32-544') }).Count) { throw 'Destination must be protected with selected SID Modify and only SYSTEM/Administrators beside it' }
    }
  }
}
function Assert-RunnerMigrationPath([string]$path) {
  $p = $path
  while ($p) {
    if (Test-Path -LiteralPath $p) {
      $item = Get-Item -LiteralPath $p -Force -EA Stop
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('Migration refuses a reparse path: ' + $p) }
    }
    $parent = Split-Path -Parent $p
    if ($parent -eq $p) { break }; $p = $parent
  }
}
function Assert-RunnerMigrationDriveRoot([string]$path) {
  $acl = Get-Acl -LiteralPath $path
  if (-not $acl.AreAccessRulesProtected) { throw 'Runner drive root must have protected access rules' }
  foreach ($r in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
    if ([string]$r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Value -in @('S-1-5-18', 'S-1-5-32-544')) { continue }
    $allowed = [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize
    if ($r.IdentityReference.Value -ne 'S-1-5-11' -or [string]$r.InheritanceFlags -ne 'None' -or ([long]$r.FileSystemRights -band (-bnot [long]$allowed))) { throw 'Runner drive root allows more than authenticated read/traverse on the root only' }
  }
}
function Get-RunnerMigrationState([string]$acct, [string]$svc, [string]$root) {
  $facts = @{ Account=(Get-LocalUser -Name $acct -EA SilentlyContinue); Service=(Get-CimInstance Win32_Service -Filter ("Name='" + $svc + "'") -EA Stop) }
  if (-not $facts.Account -or -not $facts.Service) { return Assert-RunnerMigrationFacts $facts $acct $svc $root }
  $facts.Volumes = @(Get-Volume -FileSystemLabel 'Thornswood Runners' -EA Stop)
  $facts.Defender = Get-MpComputerStatus -EA Stop
  $preference = Get-MpPreference -EA Stop
  $facts.Performance = $preference.PerformanceModeStatus
  foreach ($field in 'ExclusionPath','ExclusionProcess','ExclusionExtension') { $facts[$field]=@($preference.$field | Where-Object { $_ }) }
  $facts.Profiles = @(Get-CimInstance Win32_UserProfile -EA Stop | Where-Object { $_.SID -eq [string]$facts.Account.SID -or $_.LocalPath -eq ('C:\Users\' + $acct) -or $_.LocalPath -like ('C:\Users\' + $acct + '.*') })
  $facts.DestinationExists = Test-Path -LiteralPath $root
  $facts.Workers = @()
  # Never pass ambiguous/unvalidated volume names to the native query.
  if ($facts.Volumes.Count -ne 1 -or [string]$facts.Volumes[0].DriveLetter -notmatch '^[D-Z]$') { throw 'Migration needs exactly one attached labelled Dev Drive' }
  $queryDrive = [string]$facts.Volumes[0].DriveLetter + ':'
  $facts.VolumeQuery = (Invoke-RunnerMigrationNative 'fsutil.exe' @('devdrv', 'query', $queryDrive)) -join "`n"
  $facts.GlobalQuery = (Invoke-RunnerMigrationNative 'fsutil.exe' @('devdrv', 'query')) -join "`n"
  $plan = Assert-RunnerMigrationFacts $facts $acct $svc $root
  $facts.Workers = @(Get-RunnerMigrationProcesses $plan | Where-Object { $_.Name -eq 'Runner.Worker.exe' })
  $plan = Assert-RunnerMigrationFacts $facts $acct $svc $root
  foreach ($p in @($plan.Source, ($plan.Source + '\bin'), ($plan.Source + '\bin\RunnerService.exe'), $root, $plan.Profile)) { Assert-RunnerMigrationPath $p }
  if (-not (Test-Path -LiteralPath ($plan.Source + '\bin\RunnerService.exe') -PathType Leaf)) { throw 'Source service executable is missing; use separate recovery' }
  Assert-RunnerMigrationDriveRoot ($plan.Drive + '\')
  # Only the existing, unprivileged dedicated local account may migrate.
  foreach ($g in @(Get-LocalGroup -EA Stop)) {
    if ([string]$g.SID -eq 'S-1-5-32-545') { continue }
    if (@(Get-LocalGroupMember -Group $g.Name -EA Stop | Where-Object { [string]$_.SID -eq $plan.SID }).Count) { throw 'Dedicated runner belongs to a group other than Users' }
  }
  $task = Get-ScheduledTask -TaskName 'Thornswood Runner Drive' -EA Stop
  $start = Join-Path $env:ProgramData 'Thornswood-RunnerDrive\start.ps1'
  if (-not $task -or $task.State -eq 'Disabled' -or $task.Principal.UserId -notin @('SYSTEM','S-1-5-18') -or @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -or $task.Actions[0].Arguments -ne ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $start + '"') -or -not (Test-Path -LiteralPath $start -PathType Leaf)) { throw 'Runner drive startup task does not match the managed SYSTEM attach/start task' }
  Assert-RunnerMigrationPath $start
  # -Migrate is -OffBox only, and off the box the guards are in this machine's
  # own store (Set-RunnerFirewall's $grdStore), so that is where they are read.
  $rules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Group ('Thornswood PR runner ' + $acct) -EA Stop)
  if (-not $rules.Count -or @($rules | Where-Object { [string]$_.Enabled -ne 'True' -or [string]$_.Direction -ne 'Outbound' -or [string]$_.Action -ne 'Block' }).Count) { throw 'Selected runner firewall guards are missing or disabled' }
  $plan
}
function Begin-RunnerMigration($expected) {
  $fresh = Get-RunnerMigrationState $expected.Account $expected.Service $expected.Root
  if ($fresh.SID -ne $expected.SID -or $fresh.Source -ne $expected.Source -or $fresh.Profile -ne $expected.Profile -or $fresh.AlreadyThere) { throw 'Migration preflight identity/source changed; no cutover was attempted' }
  Stop-RunnerForMigration $fresh
  $null = Invoke-RunnerMigrationNative 'sc.exe' @('delete', $fresh.Service)
  # SCM deletion can remain pending while another controller holds a handle.
  $until = [datetime]::UtcNow.AddSeconds(30)
  while (Get-Service -Name $fresh.Service -EA SilentlyContinue) {
    if ([datetime]::UtcNow -ge $until) { throw 'Selected service deletion remains pending; password was not reset' }
    Start-Sleep -Milliseconds 250
  }
  New-Item -ItemType Directory -Path $fresh.Root -EA Stop | Out-Null
  Lock-RunnerRoot $fresh.Root ('*' + $fresh.SID)
  Clear-RunnerMigrationDeny $fresh ($fresh.Drive + '\')
  Clear-RunnerMigrationDeny $fresh $fresh.Root
  Assert-RunnerMigrationAccess $fresh
}
function Assert-RunnerMigrationFacts($facts, [string]$acct, [string]$svc, [string]$root) {
  if (-not $facts.Account -or -not $facts.Service) { throw 'Healthy migration requires the existing account and source service. Use Move-RunnersToDrive.ps1 -Recover for deleted identities; no registration token or changes were made.' }
  if ($acct -notmatch '^thornswood-pr([2-9]|[1-9][0-9])?$') { throw 'Migration requires the exact dedicated account' }
  $suffix = $acct.Substring('thornswood-pr'.Length)
  $source = 'C:\Thornswood-RunnerPR' + $suffix
  $sid = [string]$facts.Account.SID
  if ($facts.Account.Name -ne $acct -or $sid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or -not $facts.Account.Enabled) { throw 'The dedicated account is missing, disabled or has no local SID' }
  $startNames = @(('.\' + $acct), ([Environment]::MachineName + '\' + $acct))
  if ($facts.Service.Name -ne $svc -or $startNames -notcontains $facts.Service.StartName) { throw 'The selected service must use the exact dedicated local account' }
  $vols = @($facts.Volumes)
  if ($vols.Count -ne 1 -or $vols[0].FileSystem -ne 'ReFS' -or $vols[0].FileSystemLabel -ne 'Thornswood Runners' -or $vols[0].HealthStatus -ne 'Healthy' -or [string]$vols[0].DriveLetter -notmatch '^[D-Z]$') { throw 'Migration needs exactly one healthy labelled ReFS Dev Drive' }
  $drive = ([string]$vols[0].DriveLetter).ToUpper() + ':'
  if ($root -ne ($drive + '\Thornswood-RunnerPR' + $suffix)) { throw 'Migration destination must be the canonical selected runner folder on the labelled drive' }
  # fsutil emits localized text. Recognize the English safety statements only;
  # unknown/localized output stops for review, never guesses that trust is enough.
  if ($facts.VolumeQuery -notmatch '(?im)^\s*This is a trusted developer volume\.\s*$' -or $facts.VolumeQuery -notmatch '(?im)^Filters currently attached to this developer volume:\s*\r?\n[^\r\n]*\bWdFilter\b' -or $facts.VolumeQuery -match '(?i)not trusted|not protected|disallowed|disabled' -or $facts.GlobalQuery -notmatch '(?i)Developer volumes are protected by antivirus filter' -or $facts.GlobalQuery -match '(?i)not protected|disallowed|disabled') { throw 'fsutil must confirm trusted Dev Drive and allowed, attached antivirus scanning (unrecognized output fails closed)' }
  if (-not $facts.Defender.AMServiceEnabled -or -not $facts.Defender.AntivirusEnabled -or -not $facts.Defender.RealTimeProtectionEnabled -or $facts.Defender.AMRunningMode -ne 'Normal') { throw 'Defender must be active with real-time protection' }
  # Existing exclusions can defeat scanning even with WdFilter attached. Do
  # not change policy here: stop for explicit operator review instead.
  if (@($facts.ExclusionProcess | Where-Object { $_ }).Count -or @($facts.ExclusionExtension | Where-Object { $_ }).Count) { throw 'Defender process/extension exclusions need review before migration; no setting was changed' }
  foreach ($entry in @($facts.ExclusionPath | Where-Object { $_ })) {
    $excluded = [Environment]::ExpandEnvironmentVariables([string]$entry).Replace('/','\').TrimEnd('\')
    if ($excluded -like ($drive + '*') -or $source -like $excluded -or $source.StartsWith($excluded + '\', [StringComparison]::OrdinalIgnoreCase) -or $excluded.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or $root -like $excluded) { throw 'A Defender exclusion overlaps the source or runner drive; no setting was changed' }
  }
  $profiles = @($facts.Profiles)
  if ($profiles.Count -ne 1 -or $profiles[0].SID -ne $sid -or $profiles[0].LocalPath -ne ('C:\Users\' + $acct)) { throw 'Migration needs the existing live SID profile only; orphan or duplicate profiles require separate recovery' }
  if (@($facts.Workers).Count) { throw 'The selected runner still has a worker; drain jobs in the approved maintenance window first' }
  $exe = ([string]$facts.Service.PathName).Trim()
  if ($exe -ne ($source + '\bin\RunnerService.exe') -and $exe -ne ('"' + $source + '\bin\RunnerService.exe"') -and $exe -ne ($root + '\bin\RunnerService.exe') -and $exe -ne ('"' + $root + '\bin\RunnerService.exe"')) { throw 'Source service executable is not the exact canonical C: source or intended destination' }
  $already = ($exe.Trim('"') -eq ($root + '\bin\RunnerService.exe'))
  if (-not $already -and $facts.DestinationExists) { throw 'Destination already exists; leave it and the source intact for review' }
  [pscustomobject]@{ SID=$sid; Source=$(if ($already) { $root } else { $source }); Root=$root; Drive=$drive; Account=$acct; Service=$svc; AlreadyThere=$already; Profile=$profiles[0].LocalPath }
}
'@

$migrationPrelude = ''
if ($Migrate) {
  . ([scriptblock]::Create($migrateLib))
  try {
    if (-not $onRunnerDrive -or $Root -ne ($runnerDrive + '\Thornswood-RunnerPR' + $n)) { throw 'Migrate requires the canonical target on the labelled runner drive; dry runs use explicit -Root R:\Thornswood-RunnerPR[n] fixture metadata.' }
    if ($DryRunTo) {
      # Deterministic fixture metadata only. It says nothing about this PC.
      $migrationPlan = [pscustomobject]@{ SID='S-1-5-21-1-2-3-1001'; Account=$Account; Service=$service; Root=$Root; Source=('C:\Thornswood-RunnerPR' + $n); Profile=('C:\Users\' + $Account); Drive=$runnerDrive; AlreadyThere=$false }
      Say '  migration dry run uses fixture identity/drive metadata, not a live readiness claim' 'Yellow'
    } else {
      # Find-RunnerService is in the locks; the selected runner is on this machine.
      . ([scriptblock]::Create($lockLib))
      $migrationPlan = Get-RunnerMigrationState $Account (Find-RunnerService $serviceNames) $Root
      $pages = (Invoke-Gh api "repos/$Repo/actions/runners" --paginate --slurp | Out-String) | ConvertFrom-Json
      $registered = @($pages | ForEach-Object { $_.runners } | Where-Object { $_.name -eq $RunnerName })
      if ($registered.Count -ne 1 -or $registered[0].status -ne 'online' -or $registered[0].busy) { throw 'Selected GitHub runner must be uniquely online and idle. Prevent assignments and drain it in the approved maintenance window; a busy read is not an atomic drain.' }
      if ($migrationPlan.AlreadyThere) {
        Assert-RunnerMigrationService $migrationPlan
        Assert-RunnerMigrationAccess $migrationPlan
        Say '  selected runner is already at the intended drive with the same live identity, manual service and online listener; nothing changed' 'Green'
        Done
      }
    }
    $planJson = ($migrationPlan | ConvertTo-Json -Compress).Replace("'", "''")
    # Begin-RunnerMigration takes off the service the runner had; the one
    # config.cmd registers below has the name the repository has now.
    $migrationPrelude = $migrateLib + "`n`$migrationPlan = '" + $planJson + "' | ConvertFrom-Json`nBegin-RunnerMigration `$migrationPlan`n`$migrationPlan.Service = `$svc`n"
  } catch { Die $_.Exception.Message }
}

# ----------------------------------------------------------------- install --
# RENEW ONLY through the gate (THROUGH THE DEPLOY GATE): an install there is
# for a runner records\build-runners.json or records\pr-build-runners.json
# names, or one GitHub already has registered under this name, put back in
# its place. A runner nobody wrote down is a pull request to a record first.
if ($FromGate) {
  $named = @(@($buildRecord.runners) + @($prRecord.runners) | ForEach-Object { [int]$_ }) -contains $Number
  if (-not $named) {
    $known = @()
    try { $known = @(((Invoke-Gh api "repos/$Repo/actions/runners" --paginate --slurp | Out-String) | ConvertFrom-Json) | ForEach-Object { $_.runners } | ForEach-Object { [string]$_.name }) }
    catch { Write-Host ('STOP. GitHub did not list the runners of ' + $Repo + ': ' + $_.Exception.Message + ' Nothing was changed.') -ForegroundColor Red; exit 1 }
    if ($known -notcontains $RunnerName) { Write-Host ('STOP. ' + $RunnerName + ' is in no runner record and not registered on ' + $Repo + ', and the gate only puts back a runner that is. A new runner goes into records\build-runners.json by pull request first. Nothing was changed.') -ForegroundColor Red; exit 1 }
  }
}
Head 'The runner release'
# Pin (#1372): do not follow releases/latest. Bump these two together after
# checking https://github.com/actions/runner/releases and the win-x64 SHA in
# that release's notes (<!-- BEGIN SHA win-x64 --> ... <!-- END SHA win-x64 -->).
$version = '2.337.0'
$sha = '1150692AFA94E71F872017E254EA55B6EECE1EECE3FE7E3A6D4C93D0A1B85CFC'
if ($version -notmatch '^\d+\.\d+\.\d+$') { Die "Pinned actions/runner version is nonsense: $version" }
if ($sha -notmatch '^[0-9A-F]{64}$') { Die "Pinned actions/runner SHA-256 is nonsense: $sha" }
$zipName = "actions-runner-win-x64-$version.zip"
$zipUrl = "https://github.com/actions/runner/releases/download/v$version/$zipName"
Say "  actions/runner $version (pinned), SHA-256 $sha" 'Green'

Head "What the build check needs, on $where"
$need = Remote @"
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine')
foreach (`$c in 'pwsh','node','python','git') {
  `$g = Get-Command `$c -EA SilentlyContinue
  if (`$g) { 'HAVE ' + `$c + ' ' + `$g.Source } else { 'MISSING ' + `$c }
}
`$pf86 = `${env:ProgramFiles(x86)}
`$vw = Join-Path `$pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
`$msb = `$null
if (Test-Path `$vw) { `$msb = @(& `$vw -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' 2>`$null | Where-Object { `$_ -and (`$_ -notmatch '\\amd64\\|\\arm64\\') }) | Select-Object -First 1; if (`$LASTEXITCODE -ne 0) { throw ('vswhere.exe failed (exit ' + `$LASTEXITCODE + ')') } }
if (`$msb) { 'HAVE msbuild ' + `$msb } else { 'MISSING msbuild' }
`$ref = Join-Path `$pf86 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8.1'
if (Test-Path (Join-Path `$ref 'mscorlib.dll')) { 'HAVE net481refs ' + `$ref } else { 'MISSING net481refs' }
try { Add-Type -AssemblyName PresentationFramework; 'HAVE wpf' } catch { 'MISSING wpf' }
"@
$needCode = $LASTEXITCODE
if ($needCode -ne 0) { Die ("The prerequisite check failed (exit $needCode). No registration token or install was attempted.") }
$need | ForEach-Object { Say "  $_" }
$missing = @($need | Where-Object { "$_" -like 'MISSING *' } | ForEach-Object { "$_".Substring(8) })
if ($missing.Count) {
  $missingNames = $missing -join ', '
  $how = @()
  # Off the box the fix is on this machine, for all users: the runner's
  # service account cannot use a per-user or Store install. Python 3.13,
  # because a per-user 3.12.10 (One, 26 Oct 2026) makes the 3.12.10 installer
  # modify that copy instead of adding one for all users; the build itself
  # takes 3.12 from setup-python.
  if ($OffBox -and $missing -contains 'pwsh') { $how += 'winget install --id Microsoft.PowerShell -e --installer-type wix --scope machine --accept-source-agreements --accept-package-agreements   (PowerShell 7 for all users, in an elevated PowerShell)'; $missing = @($missing | Where-Object { $_ -ne 'pwsh' }) }
  if ($OffBox -and $missing -contains 'python') { $how += 'winget install --id Python.Python.3.13 -e --scope machine --override "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_test=0" --accept-source-agreements --accept-package-agreements   (Python for all users, in an elevated PowerShell)'; $missing = @($missing | Where-Object { $_ -ne 'python' }) }
  if ($OffBox -and ($missing -contains 'node' -or $missing -contains 'git')) { $how += 'winget install --id OpenJS.NodeJS.LTS -e --scope machine   and   winget install --id Git.Git -e --scope machine   (in an elevated PowerShell)'; $missing = @($missing | Where-Object { $_ -ne 'node' -and $_ -ne 'git' }) }
  if ($missing -contains 'pwsh' -or $missing -contains 'node' -or $missing -contains 'git') { $how += ".\scripts\vps\Remote.ps1 -File .\scripts\vps\Bootstrap-VPS.ps1 -Arguments '-IncludeGit'   (PowerShell 7, Node, Git, for all users; from this machine, it runs on the VPS)" }
  if ($missing -contains 'python') { $how += '.\scripts\deploy\Install-Bot.ps1   (Python for all users; the bot needs it anyway)' }
  if ($missing -contains 'msbuild' -or $missing -contains 'net481refs') { $how += ".\scripts\vps\Remote.ps1 -File .\scripts\vps\Bootstrap-VPS.ps1 -Arguments '-IncludeBuildTools -SkipFirewall'   (MSBuild and the .NET Framework 4.8.1 reference assemblies the launcher builds with, #498)" }
  if ($missing -contains 'wpf') { $how += 'the box needs Windows Server with the Desktop Experience and .NET Framework 4.8; that is not a script' }
  Die ("$where is missing " + $missingNames + ". Nothing was installed. Put them there with:" + [Environment]::NewLine + '    ' + ($how -join ([Environment]::NewLine + '    ')))
}

Head 'Registration token'
$token = (Invoke-Gh api -X POST "repos/$Repo/actions/runners/registration-token" --jq .token | Out-String).Trim()
if (-not $token) { Die "GitHub gave no registration token. gh has to be signed in as somebody who administers $Repo." }
Say '  got one, good for an hour, not shown' 'Green'

# Off the box, the network and the reads (WHAT A PULL REQUEST JOB MAY REACH).
# On the box, the network (NETWORK ONLY's rules, Patrick, 11 Oct 2026): until
# 27 Oct 2026 an install there put none on, and runner 4 took jobs with no
# outbound limit until a -NetworkOnly run after it (#3956).
Head 'What a job may reach'
try { $guard = Get-GuardScript $(if ($OffBox) { 'apply' } else { 'network' }) @(Get-GuardBlocks) } catch { Die ('nothing was installed: ' + $_.Exception.Message) }
Say '  GitHub''s address lists fetched; every other address is blocked for the account' 'Green'
if ($Migrate) { $guard = "`$guardResult = @(& {`n" + $guard + "`n})`n`$guardResult`nif ((`$guardResult -join ' ') -match 'COULD NOT') { throw 'Selected read guards did not apply; configuration was not attempted' }`n" }

Head "Installing it on $where"
# The token goes on ssh's standard input (Send-Secret.ps1, issue #451): on no
# command line and in no file on either machine. Until then it was written
# into this script, which is long enough to go up as a file, so it sat in
# C:\Windows\Temp on the VPS while the install ran.
$createAccountScript = "throw 'Migration lost its existing account; use separate recovery. No new account will be made.'"
if (-not $Migrate) {
  $createAccountScript = @"
  # A removed account must not acquire a suffixed duplicate profile.
  `$left = @(Remove-LeftProfiles @(`$acct, (`$acct + '.*')))
  `$left
  if (@(`$left | Where-Object { "`$_" -like 'LEFT *' }).Count) { throw ('Nothing was installed: a new ' + `$acct + ' would get a second profile beside the one above. $(if ($OffBox) { 'Arrange an explicitly approved local PC restart, on THIS machine, then run this again. Do not restart the VPS.' } else { 'Restart the VPS (scripts\vps\Set-TimeWait.ps1 -Restart) and run this again.' })') }
  New-LocalUser -Name `$acct -Password `$sec -PasswordNeverExpires -UserMayNotChangePassword -Description 'Thornswood build check runner' | Out-Null
  Add-LocalGroupMember -Group 'Users' -Member `$acct -EA SilentlyContinue
  'account ' + `$acct + ' made'
"@
}
if ($Migrate) { $watcherLib = '' }
$out = Send-WithSecret $token ($lockLib + $watcherLib + "`n" + @"
`$ErrorActionPreference = 'Stop'
`$regToken = `$ThornswoodSecret; `$ThornswoodSecret = `$null
if (-not `$regToken) { throw 'NOTHING ARRIVED on standard input, so there is no registration token. Nothing was installed.' }
`$root = '$Root'
`$acct = '$Account'
# The service's name, read further down (the runner drive's start setting and
# the read back at the end). #4599 took this line out with the old stop, and
# the read back then listed every service on the box (#3889, 30 Oct).
`$svc = '$service'

# A runner already here is taken off first, so a second run replaces it:
# never one in the middle of a job, and never by halves (Assert-RunnerIdle and
# Stop-RunnerHere, #3889). Before the account's password changes, so a refusal
# leaves the old service and the password it was registered with as they were.
# -Migrate stops and drains the selected runner its own way instead, keeping
# the account and its SID (#4048, Begin-RunnerMigration).
$migrationPrelude
$(if (-not $Migrate) { "Assert-RunnerIdle `$root`nStop-RunnerHere `$root $serviceList" })

# The account. In Users and nothing else. A password nobody ever sees: made
# here, set, handed to config.cmd for the service, and dropped. Letters and
# digits only: config.cmd is a batch file, and cmd.exe reads & | % ^ < > in
# its arguments as its own, and the .NET generator used before put them in
# (25 Sep). Upper, lower and digit each at least once, which the box's
# password rule wants.
`$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
function Pick([string]`$from, [int]`$n) {
  `$bytes = New-Object byte[] `$n
  `$rng.GetBytes(`$bytes)
  -join (`$bytes | ForEach-Object { `$from[`$_ % `$from.Length] })
}
`$up = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; `$lo = 'abcdefghijkmnopqrstuvwxyz'; `$dg = '23456789'
`$pw = (Pick `$up 1) + (Pick `$lo 1) + (Pick `$dg 1) + (Pick (`$up + `$lo + `$dg) 37)
`$sec = ConvertTo-SecureString `$pw -AsPlainText -Force
# The description is at most 48 characters; New-LocalUser refuses a longer
# one, which stopped the first install on 25 Sep.
if (Get-LocalUser -Name `$acct -EA SilentlyContinue) {
  $(if ($Migrate) { "if ([string](Get-LocalUser -Name `$acct -EA Stop).SID -ne `$migrationPlan.SID) { throw 'Existing account SID changed before password reset' }" })
  Set-LocalUser -Name `$acct -Password `$sec -PasswordNeverExpires `$true
  'account ' + `$acct + ' was there, new password set'
} else {
$createAccountScript
}

# Every live Thornswood folder is closed to it: read and write both. Off the
# box that is every C:\Thornswood* folder, and -AlsoDeny's besides. On the
# box Dumps is left to Lock-VpsFolders.ps1 (the header's CRASH DUMPS). The
# same Close-RunnerAccount -Lock runs, so the two can never disagree again.
Close-RunnerAccount `$acct `$root 'C:\' '$liveFilter' $alsoDenyList $leaveList
$(if ($onRunnerDrive) { "# ON THE RUNNER DRIVE: the other runners' folders there as well.`nClose-RunnerAccount `$acct `$root '" + $rootDrive + "\' '" + $liveFilter + "'" })
# The guard above, before the runner can take a job.
$guard

# Everything config.cmd reads as "already configured": actions/runner keeps a
# runner moved to the broker as .runner_migrated and .credentials_migrated, and
# a reinstall that left those got "Cannot configure the runner because it is
# already configured" (#3889, runner 3, 30 Oct).
`$oldConfig = @('.runner', '.runner_migrated', '.credentials', '.credentials_migrated', '.credentials_rsaparams') | ForEach-Object { Join-Path `$root `$_ }
foreach (`$f in `$oldConfig) { if (Test-Path -LiteralPath `$f) { Remove-Item -LiteralPath `$f -Force -EA Stop } }
`$left = @(`$oldConfig | Where-Object { Test-Path -LiteralPath `$_ })
if (`$left.Count) { throw ('the old configuration is still there: ' + (`$left -join ', ')) }
if (-not (Test-Path `$root)) { New-Item -ItemType Directory -Path `$root -Force | Out-Null }
# Locked before config.cmd writes GitHub's credentials into it.
Lock-RunnerRoot `$root `$acct
# Before the service first starts, so its first job already has it (#3117).
Set-RunnerTemp `$root '$service' `$$(if ($OffBox) { 'true' } else { 'false' })

# The runner itself, checked before it is unpacked.
if (-not (Test-Path (Join-Path `$root 'bin\Runner.Listener.exe')) -or -not (Test-Path (Join-Path `$root 'version-$version.txt'))) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  `$zip = Join-Path `$env:TEMP '$zipName'
  Invoke-WebRequest -UseBasicParsing -Uri '$zipUrl' -OutFile `$zip
  `$got = (Get-FileHash -LiteralPath `$zip -Algorithm SHA256).Hash
  if (`$got -ne '$sha') {
    Remove-Item -LiteralPath `$zip -Force -EA SilentlyContinue
    throw ('actions/runner $version does not match the SHA-256 GitHub published for it, so it was not installed. Got ' + `$got)
  }
  Remove-Item -Path (Join-Path `$root 'bin'), (Join-Path `$root 'externals') -Recurse -Force -EA SilentlyContinue
  Expand-Archive -LiteralPath `$zip -DestinationPath `$root -Force
  Remove-Item -LiteralPath `$zip -Force
  Get-ChildItem `$root -Filter 'version-*.txt' | Remove-Item -Force
  Set-Content -LiteralPath (Join-Path `$root 'version-$version.txt') -Value '$version'
  'downloaded actions/runner $version, checksum matched'
} else { 'actions/runner $version already unpacked' }

# Windows Defender scans every process a test starts, several hundred per
# check, which was most of its five minutes. The runner's own folder only;
# every live C:\Thornswood-* folder stays scanned. The repository is
# private, so what runs here is the team's own code.
# Off the box (-OffBox) it keeps scanning unless -DefenderSkip says otherwise.
if ($defenderOn) {
  try { Add-MpPreference -ExclusionPath `$root -EA Stop; 'Defender skips ' + `$root } catch { 'Defender exclusion not set: ' + `$_.Exception.Message }
} else { 'Defender still scans ' + `$root + ' (off the box; -DefenderSkip to change that)' }

# Its own folder is the one place it may write.
$(if (-not $Migrate) { "& icacls.exe `$root /grant (`$acct + ':(OI)(CI)M') /T /C /Q 2>&1 | Out-Null" })

# The token and the account's password reach config.cmd in its environment,
# not its arguments, so neither is in the box's process list (issue #451).
# The runner reads ACTIONS_RUNNER_INPUT_<argument> for any argument not given
# and clears it once read (actions/runner, CommandSettings.cs).
Push-Location `$root
`$env:ACTIONS_RUNNER_INPUT_TOKEN = `$regToken
`$env:ACTIONS_RUNNER_INPUT_WINDOWSLOGONPASSWORD = `$pw
try {
  `$cfg = & .\config.cmd --unattended --url 'https://github.com/$Repo' --name '$RunnerName' --labels '$registerLabels' --work '_work' --replace --runasservice --windowslogonaccount (".\" + `$acct) 2>&1
  `$code = `$LASTEXITCODE
} finally {
  Remove-Item Env:\ACTIONS_RUNNER_INPUT_TOKEN, Env:\ACTIONS_RUNNER_INPUT_WINDOWSLOGONPASSWORD -EA SilentlyContinue
}
Pop-Location
`$pw = `$null; `$sec = `$null; `$regToken = `$null
`$cfg | Where-Object { "`$_" -match 'Runner successfully|Settings Saved|Service .* started|error|Error|failed' } | ForEach-Object { '  config: ' + "`$_".Trim() }
if (`$code -ne 0) { throw ('config.cmd stopped with ' + `$code) }
$(if ($onRunnerDrive) { "# ON THE RUNNER DRIVE: started by the drive's startup task once the drive is`n# attached, never by Windows before it is.`n& sc.exe config `$svc start= demand 2>&1 | Out-Null`nif (`$LASTEXITCODE -ne 0) { throw 'sc.exe could not set manual service start' }`n'service starts by hand; the task Thornswood Runner Drive starts it at startup'" })

# Normal priority, from the service: the service control manager starts
# RunnerService.exe at Normal, I/O priority 2 and memory priority 5, and
# Runner.Listener, Runner.Worker and every job inherit it. The task an
# older install registered to set it every five minutes goes (the header's
# NO PRIORITY TASK, #1969).
$(if (-not $Migrate) { 'Remove-RunnerWatchers' })
Start-Sleep -Seconds 5
$(if ($Migrate) { 'Assert-RunnerMigrationService $migrationPlan' })
`$s = Get-Service -Name `$svc -EA SilentlyContinue
if (`$s) { 'service ' + `$s.Status } else { 'SERVICE NOT FOUND' }
foreach (`$p in (Get-Process Runner.Listener -EA SilentlyContinue)) { 'listener at ' + `$p.PriorityClass }
"@)
$installCode = $LASTEXITCODE
$out | ForEach-Object { Say "  $_" }
$token = $null
if ($installCode -ne 0) { Die ("The selected install stopped (exit $installCode). " + $(if ($Migrate) { 'Migration may be partial. Old source, SID and profile were retained; there is no automatic rollback. Repair service credentials and registration explicitly before using either location.' } else { 'Read the errors above.' })) }
if ($OffBox -and "$out" -match 'COULD NOT shut') { Die 'The runner is installed, but a folder outside C:\Thornswood* could not be closed to it (the lines above). .\scripts\deploy\Install-Runner.ps1 -OffBox -Lock tries again.' }
if ("$out" -notmatch 'service Running') { Die 'The runner service is not running. The lines above say where it stopped; .\scripts\deploy\Install-Runner.ps1 -Status shows what is there.' }

Head 'GitHub'
# GitHub shows the runner online once its listener has connected, a few
# seconds after the service starts; how long that takes is on GitHub's side,
# outside this script, so GitHub is asked every 3 seconds until it says so,
# for a minute at most. Until #2357 this was a fixed 10 second wait and one
# ask, and the wait ran in every -DryRunTo too, where the stand-in answers at
# once: nine of them in tests\test-runner-offbox.ps1, 90 of its 100 seconds
# in the nightly.
$askUntil = (Get-Date).AddSeconds(60)
while ($true) {
  $r = (Invoke-Gh api "repos/$Repo/actions/runners" --paginate --slurp | Out-String) | ConvertFrom-Json
  $mine = @($r | ForEach-Object { $_.runners } | Where-Object { $_.name -eq $RunnerName })
  if (($mine.Count -and "$($mine[0].status)" -eq 'online') -or (Get-Date) -ge $askUntil) { break }
  Start-Sleep -Seconds 3
}
if ($mine.Count -ne 1 -or "$($mine[0].status)" -ne 'online') { Die "The service runs but GitHub did not list exactly one online runner called $RunnerName within a minute. Migration may be partial; source data is retained and rollback needs explicit credential/registration repair. Run -Status to ask again." }
Say ('  ' + $mine[0].name + ' is ' + $mine[0].status) 'Green'

# Migration deliberately touches no sibling service or profile cleanup.
if ($Migrate) { Say '  Selected runner verified. Old source remains locked and untouched; no automatic rollback or source deletion was attempted.' 'Green'; Done }
# Every runner, this one included, so adding one leaves all of them locked.
Head 'Every runner on the box, locked'
$said = @(Remote $lockAll)
$code = $LASTEXITCODE
$said | ForEach-Object { Say "  $_" }
if ($code -ne 0) { Die "the runner is installed, but the lock did not finish for every runner (exit $code); the lines above say which. .\scripts\deploy\Install-Runner.ps1 -Lock tries again without touching any runner." }
Say ''
Say '  GitHub hands it a waiting build check, nightly or release build as soon as it is free.' 'Gray'
Done
