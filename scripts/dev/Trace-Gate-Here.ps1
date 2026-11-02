<#
.SYNOPSIS
  Runs one step of a gate trace on this machine, as its administrator: the
  same scripts\dev\Trace-Gate-Box.ps1 the box ran, with no ssh (#5183).

.DESCRIPTION
  .github\workflows\gate-map.yml traces the whole gate every night on
  GitHub's hosted Windows runner, whose job runs as an administrator, so the
  ETW session the box's trace task started as SYSTEM can be started right
  there (Patrick's q-3114 option C: the trace is taken on the machine the
  gate runs on, which since #5119 is GitHub's runner). Each step is
  Trace-Gate-Box.ps1 with $TraceMode set above it, run by Windows
  PowerShell 5.1 as on the box, exactly as Trace-Gate.ps1's Invoke-Box sends
  it over ssh.

      .\scripts\dev\Trace-Gate-Here.ps1 -Mode selftest
      .\scripts\dev\Trace-Gate-Here.ps1 -Mode start
      .\scripts\dev\Trace-Gate-Here.ps1 -Mode stop
      .\scripts\dev\Trace-Gate-Here.ps1 -Mode read -Starts <starts.jsonl> -Workspace <checkout> -OutFile <traces.jsonl.gz>
      .\scripts\dev\Trace-Gate-Here.ps1 -Mode clean

  The trace is in C:\Thornswood-Trace, which Trace-Gate-Box.ps1 keeps to
  administrators; read deletes it once read, and only the paths inside the
  checkout come out of it. read writes the traces Trace-Gate-Box.ps1 prints
  between BEGIN and END into -OutFile, and prints the rest.

  Exits with the step's own exit code; read exits 1 too when no traces came
  back. Windows only, as an administrator.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('selftest', 'start', 'stop', 'read', 'clean')][string]$Mode,
    [string]$Starts = '',
    [string]$Workspace = '',
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Box = Join-Path $Here 'Trace-Gate-Box.ps1'

if (-not $IsWindows) { Write-Host 'STOP. A gate trace is an ETW session, so it runs on Windows only.'; exit 2 }
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'STOP. Only an administrator can start an ETW session; run this elevated.'; exit 2 }
if ($Mode -eq 'read' -and (-not $Starts -or -not $Workspace -or -not $OutFile)) { Write-Host 'STOP. -Mode read needs -Starts, -Workspace and -OutFile.'; exit 2 }

# Trace-Gate-Box.ps1 with what it is told set above it, the way
# Trace-Gate.ps1's Invoke-Box writes it: each value in base64, so no quote in
# a path can change the script.
$vars = [ordered]@{}
if ($Mode -eq 'read') {
    $vars.TraceStarts = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Starts).Path)
    $vars.TraceWorkspace = (Resolve-Path -LiteralPath $Workspace).Path
}
$pre = "`$ProgressPreference = 'SilentlyContinue'`r`n`$TraceMode = '" + $Mode + "'`r`n"
foreach ($k in $vars.Keys) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$vars[$k]))
    $pre += '$' + $k + " = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + $b64 + "'))`r`n"
}
$dir = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-trace-step-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $dir
$script = Join-Path $dir ('Trace-Gate-Box-' + $Mode + '.ps1')
try {
    [IO.File]::WriteAllText($script, $pre + [IO.File]::ReadAllText($Box), (New-Object Text.UTF8Encoding($true)))
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $lines = @(& pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}

$at = [Array]::IndexOf($lines, 'BEGIN'); $to = [Array]::IndexOf($lines, 'END')
foreach ($l in $(if ($at -ge 0) { $lines[0..([Math]::Max(0, $at - 1))] } else { $lines })) { if ($l -ne 'BEGIN') { Write-Host $l } }
if ($Mode -eq 'read') {
    if ($code -ne 0) { Write-Host ('STOP. The read did not finish (exit ' + $code + ').'); exit $code }
    if ($at -lt 0 -or $to -lt $at) { Write-Host 'STOP. The read printed no traces between BEGIN and END.'; exit 1 }
    $gz = [Convert]::FromBase64String((($lines[($at + 1)..($to - 1)]) -join ''))
    [IO.File]::WriteAllBytes($OutFile, $gz)
    Write-Host ('{0} bytes of traces, gzipped, in {1}' -f $gz.Length, $OutFile)
}
exit $code
