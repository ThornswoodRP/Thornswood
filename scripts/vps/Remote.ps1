<#
  Remote.ps1

  Runs a bit of PowerShell on the VPS, properly.

      .\scripts\vps\Remote.ps1 "Get-Content 'C:\Thornswood-Voice\voice.log' -Tail 20"
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\some-check.ps1
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Bootstrap-VPS.ps1 -Arguments '-IncludeGit'
      .\scripts\vps\Remote.ps1 "Restart-Service W32Time" -Show

  WHY THIS EXISTS. Every other way of doing it goes wrong, and it goes wrong
  quietly enough to waste an hour.

  Typing it inline loses the quotes. The local shell strips one layer, ssh
  hands a single string to the remote shell, and that strips another, so

      ssh ... "pwsh -NoProfile -Command Remove-NetFirewallRule -DisplayName 'Thornswood Voice'"

  arrives as two bare words and fails with "a positional parameter cannot be
  found that accepts argument 'Voice'". Entry 1 on the To Do List has this in
  writing from 17 September and it has been done wrong four times since.

  Pasting a pre-encoded string does not work either, past a certain length. A
  base64 blob for anything real runs to thousands of characters on one line, and
  terminals drop pieces of it in the middle. "The value must be Base64 encoded"
  is what that looks like.

  So the encoding happens here, on this machine, a moment before it is sent.
  The command typed stays short and readable, nothing is pasted, and the remote
  end gets exactly the script that was written.

  $ProgressPreference is set at the far end as well, or PowerShell wraps the
  answer in a block of CLIXML progress records, which is the other thing that
  has eaten an afternoon.

  READ ONLY IS NOT ASSUMED. This will run whatever it is given. The ops repo's CLAUDE.md is
  clear that the person runs what touches the VPS, so this is a tool for the
  person, not a way around that.
#>
[CmdletBinding(DefaultParameterSetName = 'Script')]
param(
    [Parameter(ParameterSetName = 'Script', Mandatory = $true, Position = 0)]
    [string]$Script,

    [Parameter(ParameterSetName = 'File', Mandatory = $true)]
    [string]$File,

    # What the file is run with at the far end, written as it would be typed
    # after the script's name there: '-IncludeGit', or "-Tail 50". It is text
    # and goes as text, because a switch passed any other way arrives as a
    # word. Added 25 September: Install-Runner told Patrick to run
    # Bootstrap-VPS.ps1 -IncludeGit, which refuses to run anywhere but the
    # VPS, and -File had no way to pass the switch.
    [Parameter(ParameterSetName = 'File')]
    [string]$Arguments = '',

    [string]$VpsHost = '',
    [string]$VpsUser = '',

    # Show the script before sending it. Worth doing for anything that writes.
    [switch]$Show,

    # A value the script needs and nobody may see: a webhook, a password. It
    # goes on ssh's standard input, never on a command line, and the script
    # finds it in $ThornswoodSecret (Send-Secret.ps1, issue #451). Only from
    # another script that already asked for it, as a SecureString, which
    # nobody can type on a command line (issue #1069): a value typed there
    # would be in this shell's history.
    [System.Security.SecureString]$Secret
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# Send-Secret.ps1 loads Send-Script.ps1, which loads Vps.ps1.
. (Join-Path $Here 'Send-Secret.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }

if ($PSCmdlet.ParameterSetName -eq 'File') {
    if (-not (Test-Path -LiteralPath $File)) { throw "There is no script at $File" }
    $body = Get-Content -LiteralPath $File -Raw
    # A syntax error is worth catching here rather than at the far end, where
    # the message arrives wrapped in CLIXML and half explained.
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($body, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count) {
        foreach ($e in ($errs | Select-Object -First 5)) {
            Write-Host ("  line " + $e.Extent.StartLineNumber + ": " + $e.Message) -ForegroundColor Red
        }
        throw "$File does not parse. Nothing was sent."
    }
    # The file becomes a script block run with its arguments, so its own
    # param block takes them as it would on the VPS's command line. Always,
    # not only with arguments: the line that quiets progress goes in front of
    # what is sent, and a param block that is not first does not parse, so a
    # file with one never ran through here before 25 September. Send-Script.ps1
    # makes the block (Get-ThornswoodFileScript), the same way the scripts
    # that send a box script of their own do (#3035), and says why it is
    # dot-sourced rather than called with &, as it was here until then.
    $body = Get-ThornswoodFileScript -Path $File -Arguments $Arguments
} else {
    $body = $Script
}

$full = "`$ProgressPreference = 'SilentlyContinue'`r`n" + $body

if ($Show) {
    Write-Host '--- sending ---' -ForegroundColor Cyan
    $body -split "`r?`n" | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor DarkGray }
    Write-Host ''
}

# The sending is Send-Script.ps1's (issue #1070), the one helper every script
# here uses: the command line when the script fits, otherwise scp to a copy
# its run deletes before it runs (#3027, #3059), and the far side's exit
# code handed back. Why a long script cannot go on the command line is in its
# header; tests\test-remote-big-script.ps1 sends a 10 KB script through it.
#
# With a secret, Send-Secret.ps1 sends it: the value on standard input, the
# script the same way as without one.
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
if ($PSBoundParameters.ContainsKey('Secret')) {
    $value = ConvertFrom-ThornswoodSecureString $Secret
    $Secret = $null
    Invoke-ThornswoodSecretRemote -Target "$VpsUser@$VpsHost" -SshArgs $sshArgs -Script $full -Secret $value
    $value = $null
    exit $LASTEXITCODE
}

# Everything runs in PowerShell 7 on the box, as its own tasks do (#5356),
# except Bootstrap-VPS.ps1: it is what puts PowerShell 7 on a new box, so it
# runs in the Windows PowerShell Windows Server comes with, the only one there
# until it has run.
$newBox = ($PSCmdlet.ParameterSetName -eq 'File') -and ((Split-Path -Leaf $File) -eq 'Bootstrap-VPS.ps1')
Invoke-ThornswoodRemote -Target "$VpsUser@$VpsHost" -SshArgs $sshArgs -Script $full -NewBox:$newBox
exit $LASTEXITCODE
