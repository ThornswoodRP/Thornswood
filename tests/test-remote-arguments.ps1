<#
  test-remote-arguments.ps1

  Remote.ps1 -File with -Arguments runs the file at the far end with those
  arguments, so a switch reaches the file's own param block as a switch.

  WHY THIS EXISTS. On 25 September Install-Runner.ps1 stopped because the
  VPS had no git and told Patrick to run Bootstrap-VPS.ps1 -IncludeGit.
  Bootstrap-VPS refuses to run anywhere but the VPS, and Remote.ps1 -File
  had no way to pass the switch, so there was no command that worked from
  his machine. -Arguments is that command.

  NEVER CONNECTS. ssh is a function here that decodes the command Remote.ps1
  would send and runs it in this PowerShell, standing in for the far end.
  The long script path (scp, then ssh -File) is test-remote-big-script.ps1's;
  the scripts here are short, so they go inline.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$remote = Join-Path $Here '..\scripts\vps\Remote.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

function global:ssh {
    $line = [string]$args[-1]
    $m = [regex]::Match($line, '^pwsh -NoProfile -EncodedCommand (\S+)$')
    if (-not $m.Success) { Write-Output "UNEXPECTED $line"; $global:LASTEXITCODE = 99; return }
    $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
    Write-Output (& ([scriptblock]::Create($text)) 2>&1)
    $global:LASTEXITCODE = 0
}

$dir = Join-Path ([IO.Path]::GetTempPath()) ('ts-remote-args-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    # The shape of Bootstrap-VPS.ps1: a comment block, then CmdletBinding and
    # a param block with a switch among other parameters.
    $file = Join-Path $dir 'shape.ps1'
    Set-Content -LiteralPath $file -Encoding UTF8 -Value @'
<#
  a header like the real one
#>
[CmdletBinding()]
param(
    [int]   $GamePort = 7777,
    [switch]$IncludeGit,
    [switch]$SkipFirewall
)
"git=$IncludeGit firewall-skipped=$SkipFirewall port=$GamePort"
'@

    $out = (& $remote -File $file -Arguments '-IncludeGit' | Out-String)
    Yes 'the switch arrives as a switch'                   ($out -match 'git=True firewall-skipped=False port=7777')

    $out = (& $remote -File $file | Out-String)
    Yes 'without -Arguments a file with a param block runs, which it did not before' ($out -match 'git=False firewall-skipped=False port=7777')

    $out = (& $remote -File $file -Arguments '-GamePort 7000 -SkipFirewall' | Out-String)
    Yes 'a value and a second switch arrive too'           ($out -match 'git=False firewall-skipped=True port=7000')

    $bad = Join-Path $dir 'bad.ps1'
    Set-Content -LiteralPath $bad -Encoding UTF8 -Value 'param([switch]$A) { oops'
    $threw = $false
    try { & $remote -File $bad -Arguments '-A' | Out-Null } catch { $threw = $true }
    Yes 'a file that does not parse is still stopped before sending' $threw

    $threw = $false
    try { & $remote 'Get-Date' -Arguments '-A' | Out-Null } catch { $threw = $true }
    Yes '-Arguments is refused without -File'              $threw

    $src = Get-Content -LiteralPath (Join-Path $Here '..\scripts\deploy\Install-Runner.ps1') -Raw
    Yes "Install-Runner's hint for git runs Bootstrap-VPS through Remote.ps1" ($src -match [regex]::Escape(".\scripts\vps\Remote.ps1 -File .\scripts\vps\Bootstrap-VPS.ps1 -Arguments '-IncludeGit'"))
}
finally {
    Remove-Item -Path function:global:ssh -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
