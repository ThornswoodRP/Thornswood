<#
  test-1203-engine-jobs.ps1

  How many projects Build-Engine.ps1 and Build-Server.ps1 compile at once,
  and what they say when a compile runs the machine out of memory (issue
  #1203).

  WHY THIS EXISTS. Both scripts gave MSBuild a bare /m, one project per core,
  and the fork compiles each with /MP, one compiler per core. On 29 September
  a build on a busy machine (7.5 GB free, 22 cores) failed in every
  skyrim_platform source with C3859 and C1076, and Build-Engine said the
  first error was the real one. The same build finished with /m:2
  /p:CL_MPCount=2; the #1200 build finished with /m:4 /p:CL_MPCount=2 and
  about 16 GB free.

  This holds the count to those two builds, holds both scripts to it (no
  bare /m left), and runs each script's real build step, lifted out of it,
  against a stand-in for cmake and MSBuild that fails the way the 29 September
  build did: it has to stop saying the machine ran out of memory and give the
  line with fewer at once, and an ordinary compile error still points at the
  first error. Runs anywhere pwsh does; nothing is built.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent (Split-Path -Parent $Here)
$jobsFile = Join-Path $root 'scripts/release/EngineJobs.ps1'
$engineFile = Join-Path $root 'scripts/release/Build-Engine.ps1'
$serverFile = Join-Path $root 'scripts/release/Build-Server.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$texts = @{}
$asts = @{}
foreach ($f in $jobsFile, $engineFile, $serverFile) {
    $t = [IO.File]::ReadAllText($f)
    $tokens = $null; $errs = $null
    $asts[$f] = [System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$tokens, [ref]$errs)
    $texts[$f] = $t
    Yes ((Split-Path -Leaf $f) + ' parses') ($errs.Count -eq 0)
    if ($f -ne $jobsFile) {
        # No bare /m anywhere in the code: a token that is /m alone is the
        # line that ran the machine out of memory.
        $bare = @($tokens | Where-Object { $_.Kind -ne 'Comment' -and $_.Text -match '^[''"]?/m[''"]?$' })
        Yes ('  ' + (Split-Path -Leaf $f) + ' has no bare /m left') ($bare.Count -eq 0)
        Yes ('  it dot-sources EngineJobs.ps1') ($t -match "\.\s+\(Join-Path\s+\`$(PSScriptRoot|Here)\s+'EngineJobs\.ps1'\)")
        $p = $asts[$f].ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Jobs' }
        Yes ('  it takes -Jobs, an int checked for range, 0 by default') ($null -ne $p -and $p.StaticType -eq [int] -and
            ($p.Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateRange' }) -and $p.DefaultValue.Value -eq 0)
    }
}

. $jobsFile

# The count, against the two builds measured on 29 September.
Yes 'with 7.5 GB free on 22 cores it compiles 1 project at once (2 finished, 22 ran out)' ((Get-EngineJobs (7.5GB) 22) -eq 1)
Yes 'with 16 GB free on 22 cores it compiles 4 at once, as the #1200 build did' ((Get-EngineJobs (16GB) 22) -eq 4)
Yes 'with 64 GB free on 22 cores it stops at 11, two compilers each, 22 in all' ((Get-EngineJobs (64GB) 22) -eq 11)
Yes 'with almost nothing free it still compiles one' ((Get-EngineJobs (0.5GB) 22) -eq 1)
Yes 'on a two core machine it compiles one, however much is free' ((Get-EngineJobs (64GB) 2) -eq 1)
$a = @(Get-EngineMSBuildArgs 3)
Yes 'MSBuild is given /m:3 and /p:CL_MPCount=2 for 3, and nothing else' ($a.Count -eq 2 -and $a[0] -eq '/m:3' -and $a[1] -eq '/p:CL_MPCount=2')

# The out of memory errors, by the lines the 29 September build printed.
Yes 'C3859 is out of memory' ((Get-EngineOutOfMemoryCode 'D:\skymp\x.cpp(1,1): error C3859: Failed to create virtual memory for PCH [K:\b\skyrim_platform.vcxproj]') -eq 'C3859')
Yes 'C1076 is out of memory' ((Get-EngineOutOfMemoryCode 'x.cpp(1,1): fatal error C1076: compiler limit: internal heap limit reached') -eq 'C1076')
Yes 'C1060 is out of memory' ((Get-EngineOutOfMemoryCode 'fatal error C1060: compiler is out of heap space') -eq 'C1060')
Yes 'LNK1102 is out of memory' ((Get-EngineOutOfMemoryCode 'LINK : fatal error LNK1102: out of memory') -eq 'LNK1102')
Yes 'an ordinary compile error is not' ((Get-EngineOutOfMemoryCode "x.cpp(3,1): error C2065: 'y': undeclared identifier") -eq '')
Yes 'a number with those digits inside it is not' ((Get-EngineOutOfMemoryCode 'wrote 1C30760 bytes') -eq '')

# The line to run again: as it was run, without -Jobs and -NoPause.
$bound = [ordered]@{ NoPause = [System.Management.Automation.SwitchParameter]$true; Jobs = 4; NoRecord = [System.Management.Automation.SwitchParameter]$true; Fork = "K:\it's-skymp" }
$again = Get-EngineAgainLine '.\scripts\release\Build-Server.ps1' $bound
Yes ('the line to run again keeps -Fork and -NoRecord and drops -Jobs and -NoPause (' + $again + ')') ($again -eq ".\scripts\release\Build-Server.ps1 -Fork 'K:\it''s-skymp' -NoRecord")
$adv = Get-EngineOutOfMemoryAdvice 'C3859' 4 (7.5GB) '.\scripts\release\Build-Engine.ps1'
Yes 'four at once that ran out says to build with two' ($adv -match 'ran out of memory' -and $adv -match 'C3859' -and $adv.Contains('.\scripts\release\Build-Engine.ps1 -Jobs 2'))
$adv1 = Get-EngineOutOfMemoryAdvice 'C1076' 1 (3GB) '.\scripts\release\Build-Engine.ps1'
Yes 'one at a time that ran out says to close what else is running, with no -Jobs' ($adv1 -match 'one project at a time' -and $adv1 -match 'Close what else' -and $adv1 -notmatch '-Jobs')

# The real steps, lifted out of each script, against a stand-in for cmake
# and MSBuild: a script that writes what it was given and the error it is
# told to, and exits with 2.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-1203-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $argsFile = Join-Path $tmp 'args.txt'
    $stub = Join-Path $tmp 'tool.ps1'
    [IO.File]::WriteAllText($stub, @'
# A native tool gets an array argument as one argument per element; a
# script gets the array, so it is opened out here the same way.
[IO.File]::WriteAllLines($env:TS1203_ARGS, [string[]]@($args | ForEach-Object { $_ }))
Write-Output 'Build started.'
Write-Error $env:TS1203_SAYS
exit 2
'@)

    # Build-Engine's Run, as it is in the script, with EngineJobs.ps1.
    $run = $asts[$engineFile].Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Run' }, $true)
    . ([scriptblock]::Create($run.Extent.Text))
    $env:TS1203_ARGS = $argsFile
    $env:TS1203_SAYS = 'x.cpp(1,1): error C3859: Failed to create virtual memory for PCH'
    $script:RunOutOfMemory = 'left over'
    $code = Run $stub a b 6>$null
    Yes 'Run returns the tool''s exit code alone' (@($code).Count -eq 1 -and $code -eq 2)
    Yes '  and notes C3859 as the first out of memory error' ($script:RunOutOfMemory -eq 'C3859')
    $env:TS1203_SAYS = "x.cpp(3,1): error C2065: 'y': undeclared identifier"
    $code = Run $stub a b 6>$null
    Yes '  and notes none for an ordinary error, whatever an earlier run noted' ($code -eq 2 -and $script:RunOutOfMemory -eq '')

    function Lift([string]$text, [string]$from, [string]$to) {
        $i = $text.IndexOf($from); $j = $text.IndexOf($to, [Math]::Max(0, $i))
        if ($i -lt 0 -or $j -lt 0) { return $null }
        return $text.Substring($i, $j - $i)
    }
    function Step([string]$body, [string]$says) {
        $env:TS1203_SAYS = $says
        if (Test-Path -LiteralPath $argsFile) { Remove-Item -LiteralPath $argsFile }
        $stop = ''
        try { & ([scriptblock]::Create($body)) 6>$null } catch { $stop = $_.Exception.Message }
        $given = @(); if (Test-Path -LiteralPath $argsFile) { $given = @([IO.File]::ReadAllLines($argsFile)) }
        return @{ Stop = $stop; Given = $given }
    }
    $stubs = @'
function Get-EngineFreeBytes { return 7.5GB }
function Die($m) { throw ('STOP. ' + $m) }
function Say($m, $c) { }
function Ok($m) { }
$Jobs = 0
$build = 'build'
'@
    $cores = [Environment]::ProcessorCount
    $want = Get-EngineJobs (7.5GB) $cores

    $engineStep = Lift $texts[$engineFile] '$free = Get-EngineFreeBytes' "Ok 'built'"
    Yes 'Build-Engine''s build step was found' ($null -ne $engineStep)
    if ($engineStep) {
        $body = $stubs + "`n`$cmake = '" + $stub + "'`n" + $engineStep
        $r = Step $body 'D:\skymp\x.cpp(1,1): error C3859: Failed to create virtual memory for PCH'
        Yes ('Build-Engine gives MSBuild /m:' + $want + ' and /p:CL_MPCount=2 for 7.5 GB free on ' + $cores + ' cores') (
            $r.Given -contains ('/m:' + $want) -and $r.Given -contains '/p:CL_MPCount=2' -and $r.Given -notcontains '/m' -and $r.Given -contains '--')
        Yes '  and when the compiler runs out of memory it stops saying so' ($r.Stop -match 'ran out of memory, not the code' -and $r.Stop -match 'C3859')
        Yes '  with what to do: fewer at once, or close what else is running' ($r.Stop.Contains('.\scripts\release\Build-Engine.ps1 -Jobs') -or $r.Stop -match 'Close what else')
        Yes '  and never points at the first error' ($r.Stop -notmatch 'first one is usually')
        $r = Step $body "x.cpp(3,1): error C2065: 'y': undeclared identifier"
        Yes '  an ordinary compile error still points at the first error' ($r.Stop -match 'first one is usually the only real one' -and $r.Stop -notmatch 'out of memory')
        $r = Step ($body.Replace('$Jobs = 0', '$Jobs = 3')) 'x.cpp(1,1): fatal error C1076: compiler limit: internal heap limit reached'
        Yes '  -Jobs 3 gives /m:3, and running out says to try -Jobs 1' ($r.Given -contains '/m:3' -and $r.Stop -match 'C1076' -and $r.Stop.Contains('-Jobs 1'))
    }

    $serverStep = Lift $texts[$serverFile] '$free = Get-EngineFreeBytes' "Ok 'compiled'"
    Yes 'Build-Server''s build step was found' ($null -ne $serverStep)
    if ($serverStep) {
        $body = $stubs + "`n`$msbuild = '" + $stub + "'`n`$projects = @('skymp5-server.vcxproj')`n`$Configuration = 'Release'`n" + $serverStep
        $r = Step $body 'LINK : fatal error LNK1102: out of memory'
        Yes ('Build-Server gives MSBuild /m:' + $want + ' and /p:CL_MPCount=2 for 7.5 GB free on ' + $cores + ' cores') (
            $r.Given -contains ('/m:' + $want) -and $r.Given -contains '/p:CL_MPCount=2' -and $r.Given -notcontains '/m')
        Yes '  and when the linker runs out of memory it stops saying so, with the line to run' ($r.Stop -match 'ran out of memory, not the code' -and $r.Stop -match 'LNK1102' -and $r.Stop.Contains('.\scripts\release\Build-Server.ps1'))
        $r = Step $body "x.cpp(3,1): error C2065: 'y': undeclared identifier"
        Yes '  an ordinary compile error still points at the first error' ($r.Stop -match 'first one is usually the only real one' -and $r.Stop -notmatch 'out of memory')
    }
}
finally {
    Remove-Item Env:\TS1203_ARGS, Env:\TS1203_SAYS -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
