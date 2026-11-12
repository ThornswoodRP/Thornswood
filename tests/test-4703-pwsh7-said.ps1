<#
  test-4703-pwsh7-said.ps1

      pwsh -NoProfile -File .\tests\test-4703-pwsh7-said.ps1

  Issue #4703. The scripts run in PowerShell 7 only (docs/DECIDED.md,
  q-p06-ps7-only, 31 Oct 2026; #5356). About fifty of them work out a path
  default from $PSScriptRoot in their parameter block, and Windows PowerShell
  5.1 leaves $PSScriptRoot empty there (#2229, reproduced on 5.1.26100). So a
  person who starts one with powershell.exe got "Cannot bind argument to
  parameter 'Path' because it is an empty string", which names neither the
  script nor PowerShell 7. A few others use a switch only 7 has
  (ConvertFrom-Json -AsHashtable, Reset-Appearance.ps1 among them) and failed
  further in, after doing part of their work.

  A #Requires -Version 7 line is read before any parameter is bound, so 5.1
  refuses such a script at once, naming the script and the version it needs.
  This fails on any script under scripts\ that
    1. defaults a parameter of its own from $PSScriptRoot, $PSCommandPath or
       $MyInvocation, or
    2. runs ConvertFrom-Json -AsHashtable,
  and has no #Requires -Version 7 (or higher). Read through the PowerShell
  parser, so a comment or a string that names either is not a hit.

  The deploy gate's verb scripts (scripts\vps\gate\verbs.json) are left out:
  the gate broker starts them in pwsh on the box, and a change to one needs
  Patrick's card. They are named, so nobody reads this as a pass for them.

  The reader is run over planted scripts too, one of each kind, so a reader
  that finds nothing cannot pass by accident. Read only, apart from the
  planted folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# What in one script needs PowerShell 7, as "line N: what". Empty when it says
# so with #Requires, or needs nothing 7 only that this looks for.
function Get-SevenOnly([string]$path) {
    $hits = New-Object System.Collections.Generic.List[string]
    $tokens = $null
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errs)
    $req = $ast.ScriptRequirements
    if ($null -ne $req -and $null -ne $req.RequiredPSVersion -and $req.RequiredPSVersion.Major -ge 7) { return , $hits }

    if ($null -ne $ast.ParamBlock) {
        foreach ($p in $ast.ParamBlock.Parameters) {
            if ($null -eq $p.DefaultValue) { continue }
            $vars = $p.DefaultValue.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)
            foreach ($v in $vars) {
                $name = $v.VariablePath.UserPath
                if ($name -in @('PSScriptRoot', 'PSCommandPath', 'MyInvocation')) {
                    $hits.Add('line ' + $p.Extent.StartLineNumber + ': -' + $p.Name.VariablePath.UserPath + ' defaults from $' + $name + ', which Windows PowerShell 5.1 leaves empty there')
                    break
                }
            }
        }
    }

    $cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
    foreach ($c in $cmds) {
        if ($c.GetCommandName() -ne 'ConvertFrom-Json') { continue }
        foreach ($e in $c.CommandElements) {
            if ($e -is [System.Management.Automation.Language.CommandParameterAst] -and $e.ParameterName -like 'AsHash*') {
                $hits.Add('line ' + $c.Extent.StartLineNumber + ': ConvertFrom-Json -AsHashtable, which Windows PowerShell 5.1 does not have')
            }
        }
    }
    , $hits
}

# ---- 1. every script under scripts\ -----------------------------------------
$verbs = Get-Content -LiteralPath (Join-Path (Join-Path (Join-Path (Join-Path $Repo 'scripts') 'vps') 'gate') 'verbs.json') -Raw | ConvertFrom-Json
$gate = @{}
foreach ($v in $verbs.verbs.PSObject.Properties) {
    $gate[[IO.Path]::GetFullPath((Join-Path $Repo ($v.Value.script -replace '/', [IO.Path]::DirectorySeparatorChar)))] = $true
}
Yes ('the gate names its verb scripts (' + $gate.Count + ')') ($gate.Count -gt 20)

$scripts = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter '*.ps1')
Yes ('there are scripts to read (' + $scripts.Count + ')') ($scripts.Count -gt 300)

$bad = 0
$found = 0
$leftToGate = New-Object System.Collections.Generic.List[string]
foreach ($s in $scripts) {
    $hits = Get-SevenOnly $s.FullName
    $rel = $s.FullName.Substring($Repo.Length + 1)
    if ($gate.ContainsKey([IO.Path]::GetFullPath($s.FullName))) {
        if ($hits.Count) { $leftToGate.Add($rel) }
        continue
    }
    $req = [System.Management.Automation.Language.Parser]::ParseFile($s.FullName, [ref]$null, [ref]$null).ScriptRequirements
    if ($null -ne $req -and $null -ne $req.RequiredPSVersion -and $req.RequiredPSVersion.Major -ge 7) { $found++ }
    if ($hits.Count) {
        $bad++
        Write-Host ('FAIL  ' + $rel + ' needs PowerShell 7 and has no #Requires -Version 7:')
        foreach ($x in $hits) { Write-Host ('      ' + $x) }
    }
}
Yes ('every script under scripts\ that needs PowerShell 7 says so with #Requires -Version 7 (' + $bad + ' do not)') ($bad -eq 0)
Yes ('and the #Requires lines are there to be read (' + $found + ')') ($found -ge 50)
foreach ($g in $leftToGate) { Write-Host ('NOTE  ' + $g + ' is a gate verb, started by the broker in pwsh; not changed here') }

# ---- 2. the reader, over planted scripts -------------------------------------
$plant = Join-Path ([IO.Path]::GetTempPath()) ('ts-4703-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($plant)
try {
    $default = "[CmdletBinding()]`nparam([string]`$Root = (& (Join-Path `$PSScriptRoot 'Where.ps1') Install))`n`$Root"
    $cases = [ordered]@{
        'a path default from $PSScriptRoot (the #2229 pattern)' = @($default, 1)
        'the same from $PSCommandPath'                         = @("param([string]`$Root = (Split-Path -Parent `$PSCommandPath))`n`$Root", 1)
        'the same from $MyInvocation'                          = @("param([string]`$Root = (Split-Path `$MyInvocation.MyCommand.Path))`n`$Root", 1)
        'ConvertFrom-Json -AsHashtable'                        = @("param()`n`$j = '{}' | ConvertFrom-Json -AsHashtable", 1)
        'the switch shortened'                                 = @("param()`n`$j = '{}' | ConvertFrom-Json -AsHash", 1)
        'with #Requires -Version 7 after the help'             = @(("<#`n  help`n#>`n#Requires -Version 7`n" + $default), 0)
        'with #Requires -Version 7.4'                          = @(("#Requires -Version 7.4`n" + $default), 0)
        'with #Requires -Version 5.1, which is not 7'          = @(("#Requires -Version 5.1`n" + $default), 1)
        '$PSScriptRoot after the param block'                  = @("[CmdletBinding()]`nparam([string]`$Root = '')`nif (-not `$Root) { `$Root = Join-Path `$PSScriptRoot 'x' }", 0)
        '$PSScriptRoot in a function''s own param block'       = @("function F { param([string]`$R = `$PSScriptRoot) `$R }`nF", 0)
        'the pattern told in a comment'                        = @("# param([string]`$Root = `$PSScriptRoot) moved below (#2229)`nparam()", 0)
        'the switch inside a string sent elsewhere'            = @("param()`n`$cmd = '`$p = `$t | ConvertFrom-Json -AsHashtable'", 0)
    }
    foreach ($k in $cases.Keys) {
        $f = Join-Path $plant (([Guid]::NewGuid().ToString('N').Substring(0, 8)) + '.ps1')
        [IO.File]::WriteAllText($f, $cases[$k][0])
        $n = (Get-SevenOnly $f).Count
        if ($cases[$k][1] -eq 0) { Yes ('reader: ' + $k + ' is not a hit') ($n -eq 0) }
        else { Yes ('reader: ' + $k + ' is a hit') ($n -ge 1) }
    }
} finally {
    Remove-Item -LiteralPath $plant -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ('{0} passed, {1} failed' -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
