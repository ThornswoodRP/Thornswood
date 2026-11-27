<#
  Remove-HandMadeTasks.ps1

  Takes the two SYSTEM tasks somebody made by hand on the box, and the folders
  they run from, off the box (issue #3288). Runs ON the VPS, as Administrator,
  through Remote.ps1.

      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Remove-HandMadeTasks.ps1 -Arguments '-WhatIf'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Remove-HandMadeTasks.ps1

  WHAT THEY ARE, read on the box on 27 Oct 2026. Both run as SYSTEM, Highest,
  and neither has a trigger: each was started by hand, and nothing in the
  repository made either one.
    Thornswood Maint Update
      powershell.exe -File C:\Thornswood-Maint\update.ps1. It asked Windows
      Update for everything not installed, installed all of it, wrote a five
      minute restart into the live server's restart.json and restarted the
      box. Run once, at 3:36 PM box time on 16 Sep 2026, and never since. The
      same folder holds dev-instance.ps1, an older copy of
      vps-dev-instance.ps1 that nothing runs, and update.log.
    Thornswood Dev Crash Capture
      powershell.exe -File C:\Thornswood-Diagnostics\Capture-DevCrash.ps1. It
      hung ProcDump on the dev server's node for one access violation dump.
      Run by hand on 30 Sep and 2 Oct for the Whiterun crash; the dev server
      exited on 3 Oct with no dump taken. The folder holds ProcDump, the pdbs
      of three old engine builds and a copy of the dev server-settings.json
      from 1 Oct.

  WHY NOTHING NEEDS THEM.
    Windows Update is vps-harden.ps1's: the update policy it sets downloads,
    installs at 4 AM box time and restarts on a 15 minute timer, and Windows
    has installed by it since (25 Oct the last). A second way in, which
    installs whatever it finds whenever it is started, as SYSTEM, from a
    script no pull request can change, is not wanted. When updates run is
    #3213's, in vps-harden.ps1.
    Crash dumps are Windows Error Reporting's: LocalDumps writes node.exe's
    dumps into C:\Thornswood-Dumps for both servers, as Lock-VpsFolders.ps1
    keeps it, with nothing hung on a process (#1267). An engine build's pdb
    comes from the fork's build artifact.

  WHAT IT DOES, for each task and its folder in turn:
    refuses the task when it is not as it was read: its action is not the one
    above, it has a trigger, or it is running. Somebody has started using it
    then, and it is said and left as it is, with its folder.
    refuses the folder when it is a link or holds one anywhere inside it
    (removing through a link reaches what it points at), when a running
    process or another task names it, or when it holds a crash dump (*.dmp),
    which somebody reads first. The task still goes; the folder stays.
    removes the task, then the folder, and reads both back.
  A folder left here still has the Users rule from C:\ until
  Lock-VpsFolders.ps1 takes it off, and that run says it was left (#4344).
  A task or folder that is not there any more is said and skipped, so a
  second run changes nothing. -WhatIf says what it would remove and removes
  nothing. Exits 1 when anything was refused or did not go.

  REFUSES, besides: anywhere that is not the box (BoxGuard.ps1), and an
  account that is not an elevated Administrator.

  scripts\tests\test-3288-hand-made-tasks.ps1 runs it against stand-ins.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows (the scheduled
  tasks, the processes, the removal of a folder). Only
  scripts\tests\test-3288-hand-made-tasks.ps1 passes it, with -Parent.
#>
param(
    [switch]$WhatIf,
    # Where the folders are. Only the tests pass anything else.
    [string]$Parent = 'C:\',
    [string]$Layer = ''
)
$ErrorActionPreference = 'Stop'
function Say([string]$m) { Write-Output $m }

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

# The task's actions, triggers and state as Windows gives them; $null when
# there is no such task. A task with no trigger gives $null for Triggers, not
# an empty list, so they are counted below without the $null (the first
# -WhatIf on the box read @($null) as one trigger).
function Get-HandTask([string]$Name) {
    $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if (-not $t) { return $null }
    [pscustomobject]@{ Actions = $t.Actions; Triggers = $t.Triggers; State = [string]$t.State }
}
function Remove-HandTask([string]$Name) { Unregister-ScheduledTask -TaskName $Name -Confirm:$false }

# Whatever running process or other task names the folder, one line each.
function Get-FolderUsers([string]$Path, [string]$Except) {
    $p = [regex]::Escape($Path.TrimEnd('\'))
    foreach ($x in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if ("$($x.CommandLine) $($x.ExecutablePath)" -match $p) { 'process ' + $x.ProcessId + ' ' + $x.Name }
    }
    foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        if ($t.TaskName -eq $Except) { continue }
        $said = @($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join ' '
        if ($said -match $p) { 'task ' + $t.TaskPath + $t.TaskName }
    }
}
function Remove-HandFolder([string]$Path) { Remove-Item -LiteralPath $Path -Recurse -Force }

if ($Layer) { . $Layer }

# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----
# Only ever on the box; the harness's stand-ins run anywhere.
if (-not $Layer) {
    $notBox = Get-ThornswoodBoxRefusal
    if ($notBox) { Say ('REFUSED: ' + $notBox + '. Nothing was removed.'); exit 1 }
    $me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Say 'REFUSED: this is not an elevated Administrator. Nothing was removed.'; exit 1 }
}

# The two, exactly as they were read on the box (#3288).
$hand = @(
    @{ Task = 'Thornswood Maint Update'; Folder = 'Thornswood-Maint'; Runs = 'update.ps1' },
    @{ Task = 'Thornswood Dev Crash Capture'; Folder = 'Thornswood-Diagnostics'; Runs = 'Capture-DevCrash.ps1' }
)

$bad = 0
foreach ($h in $hand) {
    $folder = Join-Path $Parent $h.Folder
    $runs = Join-Path $folder $h.Runs
    Say ''
    Say ($h.Task + ', ' + $folder)

    # ---- the task
    $t = Get-HandTask $h.Task
    $taskGoes = $false
    if (-not $t) {
        Say '  task: not there'
    } else {
        $want = '-NoProfile -ExecutionPolicy Bypass -File "' + $runs + '"'
        $acts = @($t.Actions | Where-Object { $null -ne $_ })
        $trig = @($t.Triggers | Where-Object { $null -ne $_ })
        $why = @()
        $said = @($acts | ForEach-Object { ([string]$_.Execute + ' ' + [string]$_.Arguments).Trim() }) -join '; '
        if ($acts.Count -ne 1 -or [string]$acts[0].Execute -ne 'powershell.exe' -or [string]$acts[0].Arguments -ne $want) { $why += ('its action is now ' + $said + ', not powershell.exe ' + $want) }
        if ($trig.Count) { $why += ('it has ' + $trig.Count + ' trigger(s) now; it had none') }
        if ($t.State -eq 'Running') { $why += 'it is running' }
        if ($why.Count) {
            Say ('  REFUSED: the task is not as it was read on 27 Oct: ' + ($why -join '; ') + '. Somebody is using it: it and its folder are left as they are.')
            $bad++
            continue
        }
        $taskGoes = $true
    }

    # ---- the folder
    $folderGoes = $false
    if (-not (Test-Path -LiteralPath $folder)) {
        Say '  folder: not there'
    } else {
        $why = @()
        $item = Get-Item -LiteralPath $folder -Force
        $inside = @(Get-ChildItem -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue)
        $links = @($inside | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $why += 'it is a link' }
        elseif ($links.Count) { $why += ('it holds a link: ' + (($links | ForEach-Object { $_.FullName }) -join ', ')) }
        $dumps = @($inside | Where-Object { -not $_.PSIsContainer -and $_.Extension -eq '.dmp' })
        if ($dumps.Count) { $why += ('it holds ' + $dumps.Count + ' crash dump(s) nobody has read: ' + (($dumps | ForEach-Object { $_.FullName }) -join ', ')) }
        $users = @(Get-FolderUsers $folder $h.Task)
        if ($users.Count) { $why += ('in use by ' + ($users -join ', ')) }
        if ($why.Count) {
            Say ('  REFUSED: the folder stays, ' + ($why -join '; ') + '.')
            $bad++
        } else {
            $files = @($inside | Where-Object { -not $_.PSIsContainer })
            $mb = ($files | Measure-Object Length -Sum).Sum / 1MB
            Say ('  folder: {0} file(s), {1:n0} MB' -f $files.Count, $mb)
            foreach ($f in $files) { Say ('    ' + $f.FullName.Substring($folder.Length).TrimStart('\', '/')) }
            $folderGoes = $true
        }
    }

    if ($WhatIf) {
        if ($taskGoes) { Say '  would remove the task' }
        if ($folderGoes) { Say '  would remove the folder' }
        continue
    }
    if ($taskGoes) {
        try { Remove-HandTask $h.Task } catch { Say ('  FAILED to remove the task: ' + $_.Exception.Message) }
        if (Get-HandTask $h.Task) { Say '  FAILED: the task is still there; its folder is left as it is'; $bad++; continue }
        Say '  task removed'
    }
    if ($folderGoes) {
        try { Remove-HandFolder $folder } catch { Say ('  FAILED to remove the folder: ' + $_.Exception.Message) }
        if (Test-Path -LiteralPath $folder) { Say '  FAILED: the folder is still there'; $bad++ } else { Say '  folder removed' }
    }
}

Say ''
if ($WhatIf) { Say 'WhatIf: nothing was removed.' }
if ($bad) { Say ($bad.ToString() + ' thing(s) refused or left; see above.'); exit 1 }
Say 'done'
