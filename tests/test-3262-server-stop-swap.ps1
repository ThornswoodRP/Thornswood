<#
  test-3262-server-stop-swap.ps1

      pwsh -NoProfile -File .\tests\test-3262-server-stop-swap.ps1

  Issue #3262. On 22 Oct 2026 at 4:30 AM a dev Publish-Server stopped the dev
  server (three processes, each waited for until it had exited) and was
  refused the rename of C:\Thornswood-Server-Dev with a sharing violation,
  0x80070020, while nothing it asked named a holder. The same had happened
  on 21 Oct at 4:24 PM (#3131). A sharing violation on a folder is a handle
  on the folder itself, a process's current directory the usual one, and the
  three processes the installer ended were the only ones that had it.

  This runs the installer's own stop and swap, ten times, against what the
  dev server's task runs, so a stop that leaves anything holding the folder
  is caught where it can be looked at:

    1. The installer's task command line ($cmd) is read out of
       Install-ThornswoodServer.ps1, and so are its ServerProcesses and
       StopServer, and StopAndMove.ps1 is loaded; all of them as they ship.
    2. On Windows, in PowerShell 7 (the box's, which the installer runs in
       since #5356), ten times: a scratch server folder with the real
       Server-Log.js as server-log.js and a stand-in server in dist_back
       that holds a file, watches its folder and writes lines, started by
       cmd.exe with that command line and the folder as its working
       directory, exactly as the task starts it. Once the stand-in has
       written, StopServer finds the same three processes the box's dev
       server has (cmd.exe, server-log.js, the server), ends them and waits
       for each, and the folder is renamed at once through
       Move-ThornswoodPath. Each rename must go through. One that is refused
       prints what Get-ThornswoodPathHolders said, which names the holder.

  Read only apart from files under its own temp folder, and the cmd.exe and
  node processes it starts there and ends.
#>
[CmdletBinding()]
param([int]$Runs = 10)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function P([string[]]$parts) { $p = $Repo; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }

# ---- 1. what ships -------------------------------------------------------------
$instPath = P 'scripts', 'deploy', 'Install-ThornswoodServer.ps1'
$libPath = P 'scripts', 'deploy', 'StopAndMove.ps1'
$writerPath = P 'scripts', 'vps', 'Server-Log.js'
$inst = [IO.File]::ReadAllText($instPath)
$cmdMatch = [regex]::Match($inst, '\$cmd = \(''(/c [^\r\n]*?)'' -f \$node\.Source, \$writer, \$log\)')
Yes 'the installer''s task command line is found: cmd.exe /c start /b /wait /high node server-log.js, with the node, the writer and the log filled in' (
    $cmdMatch.Success -and $cmdMatch.Groups[1].Value -match 'start "" /b /wait /high "\{0\}" "\{1\}" --log "\{2\}"')
$e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($inst, [ref]$null, [ref]$e)
$fns = @{}
foreach ($f in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$f.Name] = $f.Extent.Text }
Yes '  and so are its ServerProcesses and StopServer' ($fns.ContainsKey('ServerProcesses') -and $fns.ContainsKey('StopServer'))
Yes '  and StopAndMove.ps1 and Server-Log.js are there' ((Test-Path -LiteralPath $libPath) -and (Test-Path -LiteralPath $writerPath))
if ($script:fail) { Done }

# ---- 2. run ---------------------------------------------------------------------
$node = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not $OnWindows -or -not $node) {
    Write-Host ('SKIP  the runs: they start the stand-in server through cmd.exe, which only Windows has, and need node, and this is ' + $(if ($OnWindows) { 'Windows with no node' } else { 'not Windows' }))
    Done
}
$boxPs = Get-BoxPowerShell

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-3262-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $work
try {
    [IO.File]::WriteAllText((Join-Path $work 'functions.ps1'), ($fns['ServerProcesses'] + "`r`n" + $fns['StopServer'] + "`r`n"))
    [IO.File]::WriteAllText((Join-Path $work 'cmd.txt'), $cmdMatch.Groups[1].Value)
    # The stand-in: a file held open and its folder watched, as the server
    # holds its world and data, and lines on stdout for server-log.js.
    [IO.File]::WriteAllText((Join-Path $work 'server.js'),
        "const fs=require('fs');const fd=fs.openSync('data/hold.txt','a');fs.watch('.',()=>{});setInterval(()=>fs.writeSync(fd,'x\n'),50);console.log('stand-in ready');setInterval(()=>console.log('tick'),200);")
    $child = @'
param([string]$Lib, [string]$Work, [string]$Node, [string]$Writer, [int]$Runs)
$ErrorActionPreference = 'Stop'
. $Lib
. (Join-Path $Work 'functions.ps1')
function Say([string]$m, [string]$c) { [Console]::Out.WriteLine('SAID ' + $m) }
$NoTask = $true
$TaskName = 'no task: this is a harness'
$fmt = [IO.File]::ReadAllText((Join-Path $Work 'cmd.txt'))
for ($n = 0; $n -lt $Runs; $n++) {
  $root = Join-Path $Work ('srv-' + $n)
  $null = New-Item -ItemType Directory -Path (Join-Path $root 'dist_back'), (Join-Path $root 'data')
  Copy-Item -LiteralPath (Join-Path $Work 'server.js') -Destination (Join-Path $root 'dist_back\skymp5-server.js')
  Copy-Item -LiteralPath $Writer -Destination (Join-Path $root 'server-log.js')
  $log = Join-Path $root 'server.log'
  $c = Start-Process -FilePath (Join-Path ([Environment]::SystemDirectory) 'cmd.exe') -ArgumentList ($fmt -f $Node, (Join-Path $root 'server-log.js'), $log) -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $until = (Get-Date).AddSeconds(15)
  $ready = $false
  while (-not $ready -and (Get-Date) -lt $until) {
    # server-log.js has it open for writing, so it is read sharing that.
    try {
      $fs = New-Object IO.FileStream($log, 'Open', 'Read', 'ReadWrite, Delete')
      try { $ready = (New-Object IO.StreamReader($fs)).ReadToEnd().Contains('stand-in ready') } finally { $fs.Close() }
    } catch { }
    if (-not $ready) { [Threading.Thread]::Sleep(100) }
  }
  $found = @(ServerProcesses $root | ForEach-Object { $_.Name })
  [Console]::Out.WriteLine('RUN ' + $n + ' READY ' + $ready + ' FOUND ' + ($found -join ','))
  if (-not $ready) {
    [Console]::Out.WriteLine('RUN ' + $n + ' cmd.exe ' + $(if ($c.HasExited) { 'exited ' + $c.ExitCode } else { 'running' }) + '; ' + $log + ' ' + $(if (Test-Path -LiteralPath $log) { 'is there' } else { 'is not there' }))
  }
  StopServer $root
  if (Move-ThornswoodPath $root ($root + '-moved')) { [Console]::Out.WriteLine('RUN ' + $n + ' MOVED') }
  else { [Console]::Out.WriteLine('RUN ' + $n + ' REFUSED ' + $ThornswoodMoveWhy) }
  if (-not $c.HasExited) { Stop-Process -Id $c.Id -Force -EA SilentlyContinue }
}
'@
    $childPath = Join-Path $work 'child.ps1'
    [IO.File]::WriteAllText($childPath, $child)
    Write-Host ('runs in ' + $boxPs + ', under ' + $work)
    # Said as it goes, so a run that hangs shows how far it got.
    $out = New-Object System.Collections.Generic.List[string]
    & $boxPs -NoProfile -ExecutionPolicy Bypass -File $childPath -Lib $libPath -Work $work -Node $node.Source -Writer $writerPath -Runs $Runs 2>&1 | ForEach-Object { $l = "$_"; Write-Host ('    ' + $l); $out.Add($l) }
    $out = @($out)
    $ready = @($out | Where-Object { $_ -match '^RUN \d+ READY True FOUND ' })
    $three = @($ready | Where-Object { $_ -match 'FOUND (cmd\.exe|node\.exe),(cmd\.exe|node\.exe),(cmd\.exe|node\.exe)$' -and $_ -match 'cmd\.exe' -and ([regex]::Matches($_, 'node\.exe')).Count -eq 2 })
    Yes ('the stand-in came up under cmd.exe and server-log.js every time: ' + $ready.Count + ' of ' + $Runs) ($ready.Count -eq $Runs)
    Yes ('  and StopServer found its three processes, cmd.exe and two node, as on the box: ' + $three.Count + ' of ' + $Runs) ($three.Count -eq $Runs)
    $moved = @($out | Where-Object { $_ -match '^RUN \d+ MOVED$' })
    $refused = @($out | Where-Object { $_ -match '^RUN \d+ REFUSED ' })
    Yes ('stopped, waited for and the folder renamed at once: ' + $moved.Count + ' of ' + $Runs + $(if ($refused.Count) { '; refused: ' + ($refused -join ' | ') })) ($moved.Count -eq $Runs)
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    # Anything the runs left: node or cmd.exe with this folder on its line.
    foreach ($p in @(Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($work, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.ProcessId -ne $PID })) {
        Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue
    }
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}
Done
