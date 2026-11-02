<#
  GateBroker.ps1

  The deploy gate's broker (#2841). The task "Thornswood Gate" runs it as
  SYSTEM from boot, out of C:\Thornswood-Gate, which only SYSTEM and
  Administrators may change (scripts\deploy\Install-Gate.ps1 puts it there
  and registers the task).

  It listens on the named pipe \\.\pipe\thornswood-gate, which only the
  thornswood-deploy account (its forced command, Gate.ps1) and SYSTEM may
  open, and which is closed to every other machine. Each connection hands it
  one line. It holds the line to GateRules.ps1, the copy installed beside
  it, and to main's own scripts/vps/gate/verbs.json once it has fetched main
  (Patrick's A, 30 Oct 2026: a merged verb needs no install on the box, since
  main's scripts already run as Administrator), and never to anything the
  caller sent along, then:

    1. brings its own checkout, C:\Thornswood-Gate\repo, to the tip of
       main on GitHub, read with a key that may only read the repository
       (a deploy key). What runs is always main as it is now: a verb cannot
       name a branch, a commit or a file;
    2. runs the verb's script from that checkout with PowerShell 7, with the
       verb's fixed words and the parameters the line gave, each held to its
       rule. A live verb (verbs.json "build") runs only when that tip is
       the exact commit the line named with -Build, which only ever holds
       it to main's tip, never runs another commit. The script reaches the
       box the way it does from One, as
       Administrator over ssh, here over loopback with the gate's own key
       (from="127.0.0.1", thornswood-gate), because the deploy scripts'
       box halves need administrator (the ops repo's DEPLOY-IDENTITIES.md,
       section 2a);
    3. sends every line the script prints back as it comes, the files of a
       verb that writes some (Get-Logs, Rebuild-ContentTables), and its exit
       code.

  One verb at a time: the pipe takes one connection, and a second caller
  waits for it or is told the gate is busy. A run that outlives its verb's
  timeoutMinutes is ended, with its whole process tree. A caller that goes
  away does not end the run: a deploy stopped half way through a swap is
  worse than one nobody watched end, and the log says how it ended.

  THE RECORD. C:\Thornswood-Gate\log\gate.log, one line per request: when,
  the line, main's commit, the exit code and how long it took. Each run's
  whole output is runs\<id>\output.txt; the newest 30 runs are kept.

  PowerShell 7 (pwsh), which its task starts since #5356 (Update-Gate.ps1).
#>
param([string]$Root = 'C:\Thornswood-Gate')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $Root 'GateRules.ps1')

$Cfg = [IO.File]::ReadAllText((Join-Path $Root 'gate.json')) | ConvertFrom-Json
$Repo = Join-Path $Root 'repo'
$Runs = Join-Path $Root 'runs'
$LogDir = Join-Path $Root 'log'
foreach ($d in $Runs, $LogDir) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
$Utf8 = New-Object Text.UTF8Encoding($false)

# git reads the repository with the deploy key only, the GitHub host keys
# pinned at install, and no config of any account's.
$env:GIT_SSH_COMMAND = ('"' + $Cfg.ssh + '" -F none -i "' + (Join-Path $Root 'keys\github_ed25519') + '" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="' + (Join-Path $Root 'keys\github_known_hosts') + '"').Replace('\', '/')
$env:GIT_TERMINAL_PROMPT = '0'
$env:THORNSWOOD_GATE = '1'
# The GitHub CLI Install-Gate pinned, first on the verbs' PATH, for the Ship
# verbs' signing (Ship-OnBox.ps1). It holds no sign in: a run that needs
# GitHub brings its own short token.
if ($Cfg.PSObject.Properties['gh'] -and $Cfg.gh) { $env:PATH = (Split-Path -Parent ([string]$Cfg.gh)) + ';' + $env:PATH }

function Log([string]$m) {
    [IO.File]::AppendAllText((Join-Path $LogDir 'gate.log'), ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $m + "`r`n"), $Utf8)
}

# The pipe, for thornswood-deploy and SYSTEM, and for no other machine.
# Windows itself refuses every other machine: the pipe is made with
# PIPE_REJECT_REMOTE_CLIENTS, which .NET's own constructor does not set, so
# it is made here and handed to .NET. Its access list allows SYSTEM and the
# deploy account and denies nothing. Until 30 Oct it denied NETWORK
# (S-1-5-2) to keep other machines out, but sshd logs a key in as a network
# logon, which puts NETWORK in thornswood-deploy's token too, and a deny
# beats an allow: the first ping through the gate was "Access to the path
# is denied". FILE_FLAG_FIRST_PIPE_INSTANCE: nothing else may hold the name
# first.
$GatePipeCode = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace ThornswoodGate {
    public static class Pipe {
        [StructLayout(LayoutKind.Sequential)]
        struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint instances, uint outSize, uint inSize, uint timeout, ref SecurityAttributes sa);
        const uint Duplex = 0x3, FirstInstance = 0x80000, Overlapped = 0x40000000, RejectRemote = 0x8;
        public static IntPtr Create(string name, byte[] descriptor) {
            GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
            try {
                SecurityAttributes sa = new SecurityAttributes();
                sa.Length = Marshal.SizeOf(typeof(SecurityAttributes));
                sa.Descriptor = pinned.AddrOfPinnedObject();
                IntPtr h = CreateNamedPipeW(@"\\.\pipe\" + name, Duplex | FirstInstance | Overlapped, RejectRemote, 1, 4096, 4096, 0, ref sa);
                if (h == new IntPtr(-1)) { throw new Win32Exception(Marshal.GetLastWin32Error()); }
                return h;
            } finally { pinned.Free(); }
        }
    }
}
'@
function New-GatePipe([string]$Name = 'thornswood-gate') {
    if (-not ('ThornswoodGate.Pipe' -as [type])) { Add-Type -TypeDefinition $GatePipeCode }
    $sec = New-Object IO.Pipes.PipeSecurity
    $sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)))
    $sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule((New-Object Security.Principal.SecurityIdentifier([string]$Cfg.deploySid)), [IO.Pipes.PipeAccessRights]::ReadWrite, [Security.AccessControl.AccessControlType]::Allow)))
    $handle = New-Object Microsoft.Win32.SafeHandles.SafePipeHandle([ThornswoodGate.Pipe]::Create($Name, $sec.GetSecurityDescriptorBinaryForm()), $true)
    return (New-Object IO.Pipes.NamedPipeServerStream([IO.Pipes.PipeDirection]::InOut, $true, $false, $handle))
}

# Sending to a caller that may have gone: once a write fails, the run goes
# on and only the record keeps what it said.
$script:Writer = $null
$script:Gone = $false
$script:Transcript = $null
function Send([string]$m) {
    if ($script:Transcript) { [IO.File]::AppendAllText($script:Transcript, ($m + "`r`n"), $Utf8) }
    if ($script:Gone) { return }
    try { $script:Writer.WriteLine($m) } catch { $script:Gone = $true }
}

# A short program's lines, its errors among them, and its exit code. The
# exit code decides, not a line on stderr, so 'Continue' holds here alone
# (under Windows PowerShell, which ran the broker until #5356, such a line
# under 'Stop' ended the script before the exit code was read, 29 Oct).
function Invoke-Short([string]$File, [string[]]$Words) {
    $ErrorActionPreference = 'Continue'
    $o = @(& $File @Words 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = $o; Code = $LASTEXITCODE }
}

# One program to its end, its output sent line by line as it comes and its
# errors after it. Returns its exit code; -1 when it outlived $Minutes and
# was ended with everything it started.
function Invoke-Child([string]$File, [string[]]$Words, [string]$Dir, [double]$Minutes) {
    $si = New-Object Diagnostics.ProcessStartInfo
    $si.FileName = $File
    $si.Arguments = Join-ThornswoodGateArgs $Words
    $si.WorkingDirectory = $Dir
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardInput = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    $si.StandardOutputEncoding = $Utf8
    $si.StandardErrorEncoding = $Utf8
    $p = [Diagnostics.Process]::Start($si)
    # Nothing on its input: a script that would ask a question reads the end.
    $p.StandardInput.Close()
    $errs = $p.StandardError.ReadToEndAsync()
    $until = (Get-Date).AddMinutes($Minutes)
    $next = $p.StandardOutput.ReadLineAsync()
    while ($true) {
        if ($next.Wait(1000)) {
            if ($null -eq $next.Result) { break }
            Send ('| ' + $next.Result)
            $next = $p.StandardOutput.ReadLineAsync()
            continue
        }
        if ((Get-Date) -gt $until) {
            Send ('| the gate ended it: it ran past its ' + $Minutes + ' minutes')
            Invoke-Short "$env:SystemRoot\System32\taskkill.exe" @('/T', '/F', '/PID', [string]$p.Id) | Out-Null
            $p.WaitForExit(30000) | Out-Null
            return -1
        }
    }
    $p.WaitForExit()
    if ($errs.Wait(30000)) { foreach ($e in @($errs.Result -split "\r?\n" | Where-Object { $_.Trim() })) { Send ('| ' + $e) } }
    return $p.ExitCode
}

# The checkout, at the tip of main on GitHub. Returns the commit, or '' with
# what went wrong sent.
function Update-Checkout {
    $git = [string]$Cfg.git
    # The first run clones, as SYSTEM, so the checkout is SYSTEM's own and
    # git's ownership check never stops a later run.
    if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) {
        if (Test-Path -LiteralPath $Repo) { Remove-Item -LiteralPath $Repo -Recurse -Force }
        $c = Invoke-Child $git @('clone', '--quiet', '--depth', '1', '--no-tags', '--branch', 'main', ([string]$Cfg.remote), $Repo) $Root 20
        if ($c -ne 0) { Send ('| git clone ended ' + $c + ', so main could not be read'); return '' }
    }
    foreach ($step in @(
        # The checkout's origin is gate.json's remote, which Update-Gate.ps1
        # keeps to the name GitHub gives the repository now: the deploy agent
        # and Ship read owner/name from this origin, and a clone made before
        # the move to ThornswoodRP kept the old one (#5184).
        @('-C', $Repo, 'remote', 'set-url', 'origin', ([string]$Cfg.remote)),
        @('-C', $Repo, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'),
        @('-C', $Repo, 'checkout', '--quiet', '--force', '--detach', 'refs/remotes/origin/main'),
        @('-C', $Repo, 'clean', '-ffdxq'),
        # A checkout moves its submodules only when told to, so a fetched
        # engine\skymp stayed at the pin before and every verb's freshness
        # check refused the checkout once main moved the pin (31 Oct, b21c4eb9
        # left behind by befb8364). This brings each fetched submodule to the
        # commit main pins; one never fetched here stays unfetched. Each
        # fetched one is first pointed at the address main's .gitmodules gives
        # it, so a moved fork is fetched under its new name (#5184).
        @('-C', $Repo, 'submodule', 'sync', '--quiet'),
        @('-C', $Repo, 'submodule', 'update', '--checkout', '--force', '--depth', '1'))) {
        $c = Invoke-Child $git $step $Root 10
        if ($c -ne 0) { Send ('| git ' + $step[2] + ' ended ' + $c + ', so main could not be read'); return '' }
    }
    $o = Invoke-Short $git @('-C', $Repo, 'rev-parse', 'HEAD')
    if ($o.Code -ne 0 -or ($o.Out -join '') -notmatch '^[0-9a-f]{40}$') { return '' }
    return ($o.Out -join '')
}

# A file the verb wrote, in pieces small enough for one line each.
function Send-File([string]$Path, [string]$Name) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $b64 = [Convert]::ToBase64String($bytes)
    for ($i = 0; $i -lt $b64.Length; $i += 3000) { Send ('@FILE ' + $Name + ' ' + $b64.Substring($i, [Math]::Min(3000, $b64.Length - $i))) }
    $sha = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    Send ('@FILEEND ' + $Name + ' ' + $sha)
}

function Invoke-Request($Pipe) {
    $script:Gone = $false
    $script:Transcript = $null
    $script:Writer = New-Object IO.StreamWriter($Pipe, $Utf8, 4096, $true)
    $script:Writer.NewLine = "`n"
    $script:Writer.AutoFlush = $true
    $reader = New-Object IO.StreamReader($Pipe, $Utf8, $false, 4096, $true)
    $first = $reader.ReadLine()
    $line = ''
    if ($first -match '^LINE ([A-Za-z0-9+/=]{0,1200})$') {
        try { $line = $Utf8.GetString([Convert]::FromBase64String($Matches[1])) } catch { $line = $null }
    } else { $line = $null }
    if ($null -eq $line) { Send '@REFUSED the request was not one LINE.'; Send '@END 64'; Log 'REFUSED a request that was not one LINE'; return }

    # The line's shape first, before git is asked anything; which verbs there
    # are is main's verbs.json, read once main is fetched below.
    $shown = $line.Replace("`r", ' ').Replace("`n", ' ')
    $words = @()
    try { $words = Split-ThornswoodGateLine $line } catch { Send ('@REFUSED ' + $_.Exception.Message); Send '@END 64'; Log ('REFUSED [' + $shown + '] ' + $_.Exception.Message); return }
    if (-not $words.Count) { $why = 'the line is empty: it names no verb. Nothing was run.'; Send ('@REFUSED ' + $why); Send '@END 64'; Log ('REFUSED [' + $shown + '] ' + $why); return }
    if ($words[0] -ceq 'ping') {
        if ($words.Count -gt 1) { $why = 'ping takes nothing after it. Nothing was run.'; Send ('@REFUSED ' + $why); Send '@END 64'; Log ('REFUSED [' + $shown + '] ' + $why); return }
        # It also reads main's tip with the deploy key, so a ping proves the
        # way to GitHub as well as the pipe.
        $tip = Invoke-Short ([string]$Cfg.git) @('ls-remote', ([string]$Cfg.remote), 'refs/heads/main')
        $main = if ($tip.Code -eq 0 -and ($tip.Out -join ' ') -match '([0-9a-f]{40})\s+refs/heads/main') { $Matches[1] } else { '' }
        if (-not $main) { Send ('| GATE BROKEN: GitHub did not answer with the deploy key: ' + (($tip.Out | Select-Object -Last 2) -join ' ')); Send '@END 66'; Log 'PING main unreadable'; return }
        Send ('| GATE READY, installed from ' + $Cfg.commit + ', main at ' + $main + ', runs the verbs of main''s scripts/vps/gate/verbs.json')
        # The copies it runs from, so Box-Run.ps1 can tell whether main's gate
        # has moved past them (GateRules.ps1, Get-ThornswoodGateFileLine).
        Send ('| GATE FILES ' + (Get-ThornswoodGateFileLine $Root))
        Send '@END 0'
        Log 'PING'
        return
    }

    $id = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
    $run = Join-Path $Runs $id
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    $script:Transcript = Join-Path $run 'output.txt'
    $started = Get-Date
    Log ('START ' + $id + ' [' + $shown + ']')
    Send ('| gate run ' + $id + ': ' + $shown)
    $commit = Update-Checkout
    if (-not $commit) { Send '@END 66'; Log ('END ' + $id + ' 66 main could not be read'); return }
    Send ('| main at ' + $commit)
    # The verbs as main has them now, from the checkout just fetched, never
    # from anything the caller sent.
    $verbsAt = Join-Path $Repo 'scripts\vps\gate\verbs.json'
    try { $req = Test-ThornswoodGateRequest -Line $line -Verbs (Read-ThornswoodGateVerbs $verbsAt) }
    catch { $req = [pscustomobject]@{ Ok = $false; Why = ('main''s verbs.json could not be read: ' + $_.Exception.Message + ' Nothing was run.') } }
    if (-not $req.Ok) { Send ('@REFUSED ' + $req.Why); Send '@END 64'; Log ('END ' + $id + ' 64 REFUSED [' + $shown + '] ' + $req.Why); return }
    # A live verb runs only on the build it was named for (GateRules.ps1,
    # Build): a merge that landed after Patrick gave his word is not that build.
    if ($req.Build -and $req.Build -cne $commit) { Send ('@REFUSED main is at ' + $commit + ' now, not ' + $req.Build + ', the build this run was named for. Nothing was run.'); Send '@END 64'; Log ('END ' + $id + ' 64 main moved past the named build ' + $req.Build); return }

    $script = Join-Path $Repo ($req.Script.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $script)) { Send ('@REFUSED main has no ' + $req.Script + ' now. Nothing was run.'); Send '@END 64'; Log ('END ' + $id + ' 64 no script'); return }
    $words = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script) + @($req.Args)
    $outDir = ''
    if ($req.Out) {
        $outDir = Join-Path $run 'out'
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
        $words += @($req.Out, $outDir)
    }
    $code = Invoke-Child ([string]$Cfg.pwsh) $words $Repo $req.Minutes
    if ($outDir) {
        $all = @(Get-ChildItem -LiteralPath $outDir -Recurse -File)
        $size = ($all | Measure-Object -Property Length -Sum).Sum
        if ($size -gt 64MB) { Send ('| the verb wrote ' + [Math]::Round($size / 1MB) + ' MB, over the 64 MB the gate sends back; they stay in ' + $outDir) }
        # A name is one word on the line, so a space in it becomes an underscore.
        else { foreach ($f in $all) { Send-File $f.FullName ($f.FullName.Substring($outDir.Length + 1).Replace('\', '/').Replace(' ', '_')) } }
    }
    Send ('@END ' + $code)
    Log ('END ' + $id + ' ' + $code + ' main ' + $commit + ' ' + [int]((Get-Date) - $started).TotalSeconds + 's' + $(if ($script:Gone) { ', the caller went away before the end' } else { '' }))

    # The newest 30 runs stay.
    @(Get-ChildItem -LiteralPath $Runs -Directory | Sort-Object Name -Descending | Select-Object -Skip 30) |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

Log ('BROKER started, installed from ' + $Cfg.commit)
# The copies of its own files it started on. When a request changes them on
# disk (Update-Gate, #5178), this broker answers that request, ends, and
# opens the pipe no more, so no caller reaches the old code after that
# answer; Update-Gate's one-time task starts the task again on the new files.
$StartedOn = Get-ThornswoodGateFileLine $Root
while ($true) {
    $pipe = New-GatePipe
    try {
        $pipe.WaitForConnection()
        Invoke-Request $pipe
    }
    catch { Log ('ERROR ' + $_.Exception.Message) }
    finally {
        try { if ($pipe.IsConnected) { $pipe.WaitForPipeDrain(); $pipe.Disconnect() } } catch { Log ('HUNG UP before the answer was read: ' + $_.Exception.Message) }
        $pipe.Dispose()
    }
    $onDisk = Get-ThornswoodGateFileLine $Root
    if ($onDisk -cne $StartedOn) { Log ('BROKER handing over: its files on disk are now ' + $onDisk); break }
}
exit 0
