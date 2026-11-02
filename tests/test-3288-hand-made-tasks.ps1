<#
  test-3288-hand-made-tasks.ps1

      pwsh -NoProfile -File .\tests\test-3288-hand-made-tasks.ps1

  Issue #3288. Two SYSTEM tasks on the box, Thornswood Maint Update and
  Thornswood Dev Crash Capture, were made by hand and run from folders
  nothing in the repository makes. scripts\vps\Remove-HandMadeTasks.ps1 takes
  them and their folders off the box. It is run here, under PowerShell 7 as
  on the box since #5356, with its layer stood in for
  (the tasks and who uses a folder, from a scratch file) against a scratch
  C:\ holding both folders as they were read on 27 Oct 2026. This fails on:
    1. the script not parsing, or not plain ASCII, or a layer function the
       stand-in does not replace;
    2. -WhatIf removing anything;
    3. a run leaving either task or either folder, or a second run doing
       anything but saying they are gone;
    4. a task that is not as it was read (a trigger, another action, running)
       going, or its folder going;
    5. a folder that holds a crash dump, holds a link, or that a process names
       going, or what the link points at being touched; its task still goes;
    6. anything outside the two folders being touched, or a refusal exiting 0.
  A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit ([int]($script:fail -gt 0)) }
function P([string[]]$parts) { return [IO.Path]::Combine([string[]]$parts) }

$remover = P @($Repo, 'scripts', 'vps', 'Remove-HandMadeTasks.ps1')
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($remover, [ref]$null, [ref]$errs)
Yes 'Remove-HandMadeTasks.ps1 parses' (-not $errs -or $errs.Count -eq 0)
Yes '  and is plain ASCII, which every PowerShell reads right' (@([IO.File]::ReadAllBytes($remover) | Where-Object { $_ -gt 127 }).Count -eq 0)

$layerNames = @('Get-HandTask', 'Remove-HandTask', 'Get-FolderUsers', 'Remove-HandFolder')
$layerText = @'
$state = '<state>'
function Read-State { return (Get-Content -LiteralPath $state -Raw | ConvertFrom-Json) }
function Save-State($s) { [IO.File]::WriteAllText($state, (ConvertTo-Json -InputObject $s -Depth 5)) }
function Get-HandTask([string]$Name) {
    $t = @((Read-State).tasks | Where-Object { $_.name -eq $Name })
    if (-not $t.Count) { return $null }
    # As Windows gives them: one action, and $null, not an empty list, for no trigger.
    $trig = $null
    if ([int]$t[0].triggers) { $trig = @(1..([int]$t[0].triggers) | ForEach-Object { [pscustomobject]@{ Kind = 'Daily' } }) }
    [pscustomobject]@{ Actions = @([pscustomobject]@{ Execute = $t[0].execute; Arguments = $t[0].arguments }); Triggers = $trig; State = $t[0].state }
}
function Remove-HandTask([string]$Name) {
    $s = Read-State
    $s.tasks = @($s.tasks | Where-Object { $_.name -ne $Name })
    Save-State $s
}
function Get-FolderUsers([string]$Path, [string]$Except) {
    @((Read-State).users | Where-Object { $Path.EndsWith($_.folder) } | ForEach-Object { $_.who })
}
function Remove-HandFolder([string]$Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
'@
$fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
$defined = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
$faked = @($fakeAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
Yes 'the script defines each layer function' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
Yes '  and the stand-in replaces every one' (@($layerNames | Where-Object { $faked -notcontains $_ }).Count -eq 0)
$changes = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | Where-Object { $_.GetCommandName() -match '^(Unregister-ScheduledTask|Remove-Item|Get-ScheduledTask|Stop-|Disable-ScheduledTask)' })
$outside = @($changes | Where-Object {
    $p = $_.Parent; while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }
    -not $p -or $layerNames -notcontains $p.Name })
Yes 'every task read, task removal and folder removal is inside a layer function' ($outside.Count -eq 0)
if ($script:fail) { Done }

$ps = Get-BoxPowerShell

$scratch = P @([IO.Path]::GetTempPath(), ('ts-3288-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
$box = P @($scratch, 'box')
$stateFile = P @($scratch, 'state.json')
$layer = P @($scratch, 'layer.ps1')
$maint = Join-Path $box 'Thornswood-Maint'
$diag = Join-Path $box 'Thornswood-Diagnostics'
$other = Join-Path $box 'Thornswood-Dumps'
$far = P @($scratch, 'elsewhere')
$null = New-Item -ItemType Directory -Path $scratch
[IO.File]::WriteAllText($layer, $layerText.Replace('<state>', $stateFile.Replace("'", "''")))

function Put([string]$f) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f)
    [IO.File]::WriteAllText($f, 'x')
}
# Both folders as they were read, a folder beside them that is not theirs,
# and both tasks as they were read; $change edits the state before the run.
function Fresh([scriptblock]$change) {
    foreach ($d in $box, $far) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
    foreach ($f in 'update.ps1', 'update.log', 'dev-instance.ps1') { Put (Join-Path $maint $f) }
    foreach ($f in 'Capture-DevCrash.ps1', 'dev-capture.log', 'procdump64.exe', 'server-settings.pre-npc-population.json', 'symbols\37d5\scam_native.pdb') { Put (P @($diag, ($f -split '\\'))) }
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $diag 'dev-dumps')
    Put (Join-Path $other 'crash.dmp')
    Put (P @($far, 'keep.txt'))
    $s = [pscustomobject]@{
        tasks = @(
            [pscustomobject]@{ name = 'Thornswood Maint Update'; execute = 'powershell.exe'; arguments = ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $maint 'update.ps1') + '"'); triggers = 0; state = 'Ready' },
            [pscustomobject]@{ name = 'Thornswood Dev Crash Capture'; execute = 'powershell.exe'; arguments = ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $diag 'Capture-DevCrash.ps1') + '"'); triggers = 0; state = 'Ready' },
            [pscustomobject]@{ name = 'Thornswood Watch'; execute = 'C:\Program Files\PowerShell\7\pwsh.exe'; arguments = '-File watch.ps1'; triggers = 1; state = 'Running' }
        )
        users = @()
    }
    if ($change) { & $change $s }
    [IO.File]::WriteAllText($stateFile, (ConvertTo-Json -InputObject $s -Depth 5))
}
function Run([string[]]$extra) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $ps -NoProfile -ExecutionPolicy Bypass -File $remover -Parent $box -Layer $layer @extra 2>&1 | ForEach-Object { "$_" }) -join "`n" }
    finally { $ErrorActionPreference = $eap }
    return @{ Out = $o; Code = $LASTEXITCODE }
}
function Tasks { return @((Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).tasks | ForEach-Object { $_.name }) }
function There([string]$p) { return (Test-Path -LiteralPath $p) }
function Others { return ((There (Join-Path $other 'crash.dmp')) -and (There (P @($far, 'keep.txt'))) -and ((Tasks) -contains 'Thornswood Watch')) }

try {
    Write-Host ''
    Write-Host '-WhatIf'
    Fresh
    $r = Run @('-WhatIf')
    Yes 'it exits 0' ($r.Code -eq 0)
    Yes '  says it would remove both tasks and both folders' (([regex]::Matches($r.Out, 'would remove the task')).Count -eq 2 -and ([regex]::Matches($r.Out, 'would remove the folder')).Count -eq 2)
    Yes '  lists what is in them' ($r.Out -match 'update\.ps1' -and $r.Out -match 'procdump64\.exe')
    Yes '  and removes nothing' ((There $maint) -and (There $diag) -and (Tasks).Count -eq 3)

    Write-Host ''
    Write-Host 'a run'
    $r = Run @()
    Yes 'it exits 0' ($r.Code -eq 0)
    Yes '  both tasks are gone' (-not ((Tasks) -contains 'Thornswood Maint Update') -and -not ((Tasks) -contains 'Thornswood Dev Crash Capture'))
    Yes '  both folders are gone' (-not (There $maint) -and -not (There $diag))
    Yes '  it says so for each' (([regex]::Matches($r.Out, 'task removed')).Count -eq 2 -and ([regex]::Matches($r.Out, 'folder removed')).Count -eq 2)
    Yes '  and nothing else was touched (the Dumps folder, a folder elsewhere, another task)' (Others)
    $r = Run @()
    Yes 'a second run exits 0 and says each is not there' ($r.Code -eq 0 -and ([regex]::Matches($r.Out, 'task: not there')).Count -eq 2 -and ([regex]::Matches($r.Out, 'folder: not there')).Count -eq 2)

    Write-Host ''
    Write-Host 'a task that is not as it was read'
    foreach ($case in @(
            @{ Name = 'one with a trigger now'; Change = { param($s) $s.tasks[0].triggers = 1 }; Re = '1 trigger' },
            @{ Name = 'one that runs something else now'; Change = { param($s) $s.tasks[0].arguments = '-File "C:\elsewhere\other.ps1"' }; Re = 'its action is now' },
            @{ Name = 'one that is running'; Change = { param($s) $s.tasks[0].state = 'Running' }; Re = 'it is running' })) {
        Fresh $case.Change
        $r = Run @()
        Yes ("{0}: refused, exit 1" -f $case.Name) ($r.Code -eq 1 -and $r.Out -match 'REFUSED: the task is not as it was read' -and $r.Out -match $case.Re)
        Yes '  it and its folder stay' (((Tasks) -contains 'Thornswood Maint Update') -and (There (Join-Path $maint 'update.ps1')))
        Yes '  and the other one still goes' (-not ((Tasks) -contains 'Thornswood Dev Crash Capture') -and -not (There $diag) -and (Others))
    }

    Write-Host ''
    Write-Host 'a folder that must stay'
    Fresh
    Put (P @($diag, 'dev-dumps', 'node.exe_261003_131130.dmp'))
    $r = Run @()
    Yes 'one holding a crash dump: refused, exit 1, the dump named' ($r.Code -eq 1 -and $r.Out -match 'crash dump' -and $r.Out -match 'node\.exe_261003_131130\.dmp')
    Yes '  the folder and the dump stay, its task goes' ((There (P @($diag, 'dev-dumps', 'node.exe_261003_131130.dmp'))) -and -not ((Tasks) -contains 'Thornswood Dev Crash Capture'))
    Yes '  and the other folder still goes' (-not (There $maint) -and (Others))

    Fresh { param($s) $s.users = @([pscustomobject]@{ folder = 'Thornswood-Maint'; who = 'process 4242 powershell.exe' }) }
    $r = Run @()
    Yes 'one a process names: refused, exit 1, the process named' ($r.Code -eq 1 -and $r.Out -match 'in use by process 4242')
    Yes '  the folder stays' (There (Join-Path $maint 'update.ps1'))

    Fresh
    $null = New-Item -ItemType Directory -Force -Path (P @($far, 'target'))
    Put (P @($far, 'target', 'precious.txt'))
    $made = $true
    try {
        if ($OnWindows) { $null = New-Item -ItemType Junction -Path (P @($maint, 'link')) -Target (P @($far, 'target')) }
        else { $null = New-Item -ItemType SymbolicLink -Path (P @($maint, 'link')) -Target (P @($far, 'target')) }
    } catch { $made = $false; Write-Host ('NOTE  no link could be made here: ' + $_.Exception.Message) }
    if ($made) {
        $r = Run @()
        Yes 'one holding a link: refused, exit 1' ($r.Code -eq 1 -and $r.Out -match 'holds a link')
        Yes '  the folder stays, and what the link points at is untouched' ((There (Join-Path $maint 'update.ps1')) -and (There (P @($far, 'target', 'precious.txt'))))
    }
} finally {
    if (Test-Path -LiteralPath (P @($maint, 'link'))) { (Get-Item -LiteralPath (P @($maint, 'link')) -Force).Delete() }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
