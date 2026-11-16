<#
  test-4973-docs-grant-order.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4973-docs-grant-order.ps1

  Issue #4973. Deploy-Docs.ps1's setup script granted NT TASK\Thornswood Docs
  by its SID, and took LOCAL SERVICE's old rules off, before it registered the
  task. Windows maps a task's SID only once the task is registered (#4968), so
  on a box with no such task every grant was refused, the deploy carried on,
  and the new task ran with nothing it needed until a second deploy.

  This holds the fix:
    - in the setup script as it goes up, built from the same here-string with
      the same variables set, the task is registered or updated before any
      grant to its SID, the grants come before LOCAL SERVICE's old rules come
      off, and all of it before SETUP DONE;
    - a grant still refused stops the setup script before LOCAL SERVICE's
      rules come off and before SETUP DONE, and says which grants were
      refused. Run on scratch folders with the real icacls for a scratch task
      that is not registered, so its SID has no mapping, and with
      Register-ScheduledTask standing in;
    - elevated, the real "no task yet" path: the account block, the code that
      registers the task and the grants, cut from the script that goes up,
      run against one scratch task and scratch folders with the real icacls.
      The task ends registered with its grants made. Not elevated, that part
      says SKIP with the reason.

  Writes only under its own temp folder and, when elevated, one scheduled
  task that is never started and is removed before this ends. The launcher
  is not built: Install-ThornswoodOwnerLaunch stands in, naming cmd.exe.
  Never connects to anything. A few seconds.
#>
$ErrorActionPreference = 'Stop'
$env:THORNSWOOD_HARNESS = '1'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the site task''s grants and their order happen only on Windows'; exit 0 }
. (Join-Path $Repo 'scripts\deploy\ServiceAccount.ps1')
# Deploy-Docs also puts BoxFirewall.ps1's function in the setup script (#3896).
. (Join-Path $Repo 'scripts\vps\BoxFirewall.ps1')
# The places no service may read, none here, so the fail-safe never reads
# this machine's own C:\Thornswood-* folders.
function Get-ThornswoodServiceNeverReach { param([string]$Own = '', [string]$Box = 'C:\') return @() }

$deploy = Join-Path $Repo 'scripts\deploy\Deploy-Docs.ps1'
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($deploy, [ref]$null, [ref]$errs)
Yes 'Deploy-Docs.ps1 parses' ($errs.Count -eq 0)
$remotes = @($ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Extent.Text -like '*Register-ScheduledTask*'
}, $true))
Yes 'there is one setup script that registers the task' ($remotes.Count -eq 1)
if ($remotes.Count -ne 1) { Done }
$script:remote = $remotes[0]

# The here-string evaluated as Deploy-Docs evaluates it (test-site-account.ps1
# does the same and checks no other variable goes into it).
function Build([string]$account, [string]$docsRoot, [string]$taskName = 'Thornswood Docs') {
    $RunAs = $account
    $rootWin = $docsRoot
    $boxWin = $rootWin.TrimEnd('\')
    $boxWin = if ($boxWin.LastIndexOf('\') -ge 0) { $boxWin.Substring(0, $boxWin.LastIndexOf('\')) } else { '' }
    $Task = $taskName
    $Port = 3001
    $siteAccountHelpers = ''
    return (& ([ScriptBlock]::Create($script:remote.Extent.Text)))
}
function CallsOf($scriptAst, [string]$name) {
    return @($scriptAst.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name
    }, $true) | Sort-Object { $_.Extent.StartOffset })
}
$open  = '# ==== thornswood site account ===='
$close = '# ==== end thornswood site grants ===='
# From the account block to the end of the grants: the account, the task
# registered or updated, then the grants.
function SegmentOf([string]$text) {
    $a = $text.IndexOf($open)
    $b = $text.IndexOf($close)
    if ($a -lt 0 -or $b -le $a) { return $null }
    return $text.Substring($a, $b + $close.Length - $a)
}

# ---- the order in the script that goes up ------------------------------------------
foreach ($account in @('', 'LOCAL SERVICE')) {
    $label = $account
    if (-not $label) { $label = 'no -RunAs' }
    $text = Build $account 'C:\Thornswood-Docs'
    $perrs = $null
    $sent = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$perrs)
    Yes "$label`: the setup script parses" ($perrs.Count -eq 0)
    $reg = @(CallsOf $sent 'Register-ScheduledTask')
    $upd = @(CallsOf $sent 'Set-ScheduledTask')
    $ica = @(CallsOf $sent 'icacls')
    $grants = @($ica | Where-Object { $_.Extent.Text -match '/grant' })
    $removes = @($ica | Where-Object { $_.Extent.Text -match '/remove' })
    $owns = @($sent.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$own' -and
        $n.Right.Extent.Text -match 'Get-ThornswoodTaskSidFromName'
    }, $true))
    $done = $text.IndexOf("'SETUP DONE'")
    Yes "$label`: one registration, one update, one grant and one removal of LOCAL SERVICE's rules" (
        $reg.Count -eq 1 -and $upd.Count -eq 1 -and $grants.Count -eq 1 -and $removes.Count -eq 1)
    if ($reg.Count -ne 1 -or $upd.Count -ne 1 -or $grants.Count -ne 1 -or $removes.Count -ne 1) { continue }
    $g = $grants[0].Extent.StartOffset
    Yes "$label`: the task is registered before any grant names its SID (#4973)" ($reg[0].Extent.StartOffset -lt $g)
    Yes "$label`: and a task already there is updated before them too" ($upd[0].Extent.StartOffset -lt $g)
    Yes "$label`: the task's SID is worked out before it is registered, for the launcher's action" (
        $owns.Count -eq 1 -and $owns[0].Extent.StartOffset -lt $reg[0].Extent.StartOffset)
    Yes "$label`: LOCAL SERVICE's old rules come off only after the grants" ($g -lt $removes[0].Extent.StartOffset)
    $deny = $text.IndexOf('SecurityIdentifier(`$own)'.Replace('`', ''))
    $purge = $text.IndexOf('PurgeAccessRules(')
    Yes "$label`: the feed deny and BUILTIN\Users coming off are after the registration as well" (
        $deny -gt $reg[0].Extent.StartOffset -and $purge -gt $reg[0].Extent.StartOffset)
    Yes "$label`: and all of it before SETUP DONE" ($done -gt $removes[0].Extent.StartOffset -and $done -gt $purge)
    # A refused grant returns between the grants and the removal.
    $rets = @($sent.FindAll({ param($n) $n -is [System.Management.Automation.Language.ReturnStatementAst] }, $true) |
        Where-Object { $_.Extent.StartOffset -gt $g -and $_.Extent.StartOffset -lt $removes[0].Extent.StartOffset })
    Yes "$label`: a refused grant returns before LOCAL SERVICE's rules come off" ($rets.Count -ge 1)
    Yes "$label`: the account, the task and the grants are one segment between markers" ($null -ne (SegmentOf $text))
}
$deployText = [IO.File]::ReadAllText($deploy)
$gate = $deployText.IndexOf("if (`$setup -notcontains 'SETUP DONE')")
Yes 'Deploy-Docs stops and swaps nothing when the setup script does not reach SETUP DONE' (
    $gate -gt 0 -and $gate -lt $deployText.IndexOf('$serviceSwapBlock)') -and
    $deployText.Substring($gate, 400) -match 'exit 1')

# ---- run it -----------------------------------------------------------------------------
if (-not (Get-Command New-ScheduledTaskPrincipal -ErrorAction SilentlyContinue)) {
    Write-Host 'SKIP  the ScheduledTasks cmdlets are not on this machine, so the setup script was not run'
    Done
}
$icaclsExe = Get-WindowsPath 'System32\icacls.exe'
$cmdExe = Get-WindowsPath 'System32\cmd.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-4973-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
function Put([string]$path, [string]$text) {
    $d = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($path, $text)
}
function RulesFor([string]$path, [string]$who) {
    return @((Get-Acl -LiteralPath $path).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
        Where-Object { $_.IdentityReference.Value -eq $who })
}
$fsr = [Security.AccessControl.FileSystemRights]
function Modifies($rules) {
    foreach ($r in $rules) { if ("$($r.AccessControlType)" -eq 'Allow' -and ($r.FileSystemRights -band $fsr::Modify) -eq $fsr::Modify) { return $true } }
    return $false
}
function Reads($rules) {
    foreach ($r in $rules) { if ("$($r.AccessControlType)" -eq 'Allow' -and ($r.FileSystemRights -band $fsr::ReadData) -ne 0) { return $true } }
    return $false
}
function Maps([string]$sid) {
    try { $null = (New-Object Security.Principal.SecurityIdentifier($sid)).Translate([Security.Principal.NTAccount]); return $true } catch { return $false }
}
# The launcher is not built here: it would go into Program Files.
$standIns = @'
$ErrorActionPreference = 'Continue'
$script:log = @()
function Install-ThornswoodOwnerLaunch { return $cmdExe }
function icacls { $script:log += ('icacls ' + ($args -join ' ')); & $icaclsExe @args }
'@
$nodeLine = '$node = (Get-Command node -EA SilentlyContinue).Source'
function Run([string]$code) {
    $script:log = @()
    $lines = @(. ([ScriptBlock]::Create($code)) 2>&1 | ForEach-Object { "$_" })
    return @{ said = ($lines -join "`n"); log = @($script:log) }
}
# A fresh scratch box: the site's folder, the server, the voice chat and the
# deploy records, with the read LOCAL SERVICE had on the server before #4077.
function NewBox([string]$at) {
    $docs = Join-Path $at 'Thornswood-Docs'
    Put (Join-Path $docs 'config.json') '{}'
    Put (Join-Path $docs 'feed\version.json') '{}'
    Put (Join-Path $docs 'feed-dev\version.json') '{}'
    Put (Join-Path $at 'Thornswood-Server\data\online.json') '{}'
    Put (Join-Path $at 'Thornswood-Voice\chat\x.jsonl') '{}'
    Put (Join-Path $at 'Thornswood-Deploys\current\thornswood-docs.json') '{}'
    $null = & $icaclsExe (Join-Path $at 'Thornswood-Server') /grant '*S-1-5-19:(OI)(CI)R' 2>&1
    return $docs
}

try {
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    # -- a grant still refused stops the deploy ----------------------------------
    # A scratch task name that is registered nowhere, so its SID has no mapping
    # and the real icacls refuses every grant, the way a box with no task did.
    $ghost = 'Thornswood grant-order ghost ' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $ghostSid = Get-ThornswoodTaskSidFromName $ghost
    $box = Join-Path $tmp 'refused'
    $docs = NewBox $box
    $seg = SegmentOf (Build '' $docs $ghost)
    if (-not $seg) {
        Yes 'refused: the setup script has the segment to run' $false
    } else {
        $code = $standIns + "`n" +
            'function Get-ScheduledTask { }' + "`n" +
            'function Register-ScheduledTask { $script:log += ''register'' }' + "`n" +
            'function Set-ScheduledTask { $script:log += ''update'' }' + "`n" +
            $seg.Replace($nodeLine, '$node = ''cmd.exe''') + "`n" + "'SETUP DONE'"
        $r = Run $code
        $first = -1
        for ($i = 0; $i -lt $r.log.Count; $i++) { if ($first -lt 0 -and $r.log[$i] -match '/grant') { $first = $i } }
        Yes 'refused: the scratch task''s SID has no mapping here, as on a box with no task' (-not (Maps $ghostSid))
        Yes 'refused: the task is registered before the first grant is tried' (
            $first -gt 0 -and [array]::IndexOf($r.log, 'register') -ge 0 -and [array]::IndexOf($r.log, 'register') -lt $first)
        Yes 'refused: every grant is still tried, and each is said' (
            @($r.log | Where-Object { $_ -match '/grant' }).Count -eq 5 -and @([regex]::Matches($r.said, 'COULD NOT GRANT')).Count -eq 5)
        Yes 'refused: the setup script stops and says what was refused' (
            $r.said -match 'GRANTS REFUSED' -and $r.said -match [regex]::Escape("(OI)(CI)M on $docs") -and
            $r.said -match 'No mapping between account names and security IDs')
        Yes 'refused: it never reaches SETUP DONE, so Deploy-Docs swaps nothing' ($r.said -notmatch 'SETUP DONE')
        Yes 'refused: LOCAL SERVICE''s old rules are left on' (
            @($r.log | Where-Object { $_ -match '/remove' }).Count -eq 0 -and
            (RulesFor (Join-Path $box 'Thornswood-Server') 'S-1-5-19').Count -ge 1 -and $r.said -notmatch 'LOCAL SERVICE no longer has a rule')
        if ($r.said -notmatch 'GRANTS REFUSED') { foreach ($l in @($r.said -split "`n" | Select-Object -Last 12)) { Write-Host ('      said: ' + $l) } }
    }

    # -- elevated: the real no-task path against a scratch task ------------------
    $elevated = $false
    try {
        $elevated = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { $elevated = $false }
    if (-not $elevated) {
        Write-Host 'SKIP  real task: not elevated, so no scratch task can be registered as LOCAL SERVICE to run the no-task path against'
    } else {
        # Not 'Thornswood Test...', which other harnesses clear away (#1135).
        $scratchTask = 'Thornswood grant-order harness ' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $scratchSid = Get-ThornswoodTaskSidFromName $scratchTask
        $box = Join-Path $tmp 'real'
        $docs = NewBox $box
        try {
            Yes 'real task: there is no such task before the deploy' ($null -eq (Get-ScheduledTask -TaskName $scratchTask -ErrorAction SilentlyContinue))
            Yes 'real task: and its SID has no mapping yet' (-not (Maps $scratchSid))
            $seg = SegmentOf (Build '' $docs $scratchTask)
            $code = $standIns + "`n" + $seg.Replace($nodeLine, '$node = $cmdExe') + "`n" + "'SETUP DONE'"
            try { $r = Run $code } catch { $r = @{ said = 'THREW: ' + $_.Exception.Message; log = @() } }
            $task = Get-ScheduledTask -TaskName $scratchTask -ErrorAction SilentlyContinue
            Yes 'real task: one deploy registers the task' ($r.said -match 'scheduled task created' -and $null -ne $task)
            Yes 'real task: on LOCAL SERVICE' ($task -and $task.Principal.UserId -match 'LOCAL SERVICE$')
            Yes 'real task: its SID maps once it is registered' (Maps $scratchSid)
            Yes 'real task: nothing was refused, and the setup script reached SETUP DONE' (
                $r.said -notmatch 'COULD NOT' -and $r.said -notmatch 'GRANTS REFUSED' -and $r.said -match 'SETUP DONE')
            Yes 'real task: it says the grants after it says the task was created' (
                $r.said.IndexOf('scheduled task created') -ge 0 -and
                $r.said.IndexOf('granted NT TASK\' + $scratchTask) -gt $r.said.IndexOf('scheduled task created'))
            Yes 'real task: the task may change its own folder' (Modifies (RulesFor $docs $scratchSid))
            Yes 'real task: and config.json in it' (Modifies (RulesFor (Join-Path $docs 'config.json') $scratchSid))
            Yes 'real task: it reads the server folder, its data, the chat and the deploy records' (
                (Reads (RulesFor (Join-Path $box 'Thornswood-Server') $scratchSid)) -and
                (Reads (RulesFor (Join-Path $box 'Thornswood-Server\data') $scratchSid)) -and
                (Reads (RulesFor (Join-Path $box 'Thornswood-Voice\chat') $scratchSid)) -and
                (Reads (RulesFor (Join-Path $box 'Thornswood-Deploys\current') $scratchSid)))
            Yes 'real task: LOCAL SERVICE''s old read on the server folder is off' ((RulesFor (Join-Path $box 'Thornswood-Server') 'S-1-5-19').Count -eq 0)
            if ($r.said -notmatch 'SETUP DONE' -or $r.said -match 'COULD NOT') {
                foreach ($l in @($r.said -split "`n" | Select-Object -Last 20)) { Write-Host ('      said: ' + $l) }
            }
        } finally {
            Unregister-ScheduledTask -TaskName $scratchTask -Confirm:$false -ErrorAction SilentlyContinue
        }
        Yes 'real task: the scratch task is gone again' ($null -eq (Get-ScheduledTask -TaskName $scratchTask -ErrorAction SilentlyContinue))
    }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
