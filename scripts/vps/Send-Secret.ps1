<#
  Send-Secret.ps1

  How a secret goes to the VPS: on ssh's standard input, never on a command
  line. Dot-source it beside Vps.ps1:

      . (Join-Path $Here '..\vps\Send-Secret.ps1')
      Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $value -Script @"
      `$pw = `$ThornswoodSecret; `$ThornswoodSecret = `$null
      ...
      "@

  The script that runs on the VPS finds the value in $ThornswoodSecret. The
  script itself names no secret, so it can go the usual way.

  WHY THIS EXISTS (issue #451). Every script here that sent a secret (the
  server password, the site password, the bot token and the site's bot key,
  the Discord client secret, a webhook, the build runner's registration token)
  base64'd it into the remote script, and the remote script went to ssh as
  powershell -NoProfile -EncodedCommand <that>. So the value sat in the command
  line of ssh on this machine and of cmd.exe and powershell.exe on the VPS for
  the length of the call, where the process list, a process creation audit
  event or anything reading Win32_Process could see it. Base64 is transport
  encoding and hides nothing. Over 6,000 characters the script went as a file
  in C:\Windows\Temp instead, and then the value sat in a file on both
  machines. Comments beside two of them said the value was never on a command
  line on either machine, which was not true.

  HOW. The value is base64'd (so no quoting, code page or byte order mark can
  change it) and written to ssh's standard input. ssh carries its standard
  input to the remote command's, cmd.exe hands it on to powershell, and the
  first line of the remote script reads one line of it. Only the script goes
  on the command line, and when it is too long for that, it goes by scp and
  its run deletes the copy before it runs (Send-Script.ps1, #3059), while the
  value still goes on standard input: never on a command line and never in a
  file. Standard input reaches the box whole only up to about 8 KB, measured
  21 Oct 2026, so its line is held to 8,000 bytes with its line end. The
  value goes as base64, four characters for every three bytes, so the longest
  value that goes is 5,997 bytes of UTF-8 ($ThornswoodSecretLimit, worked out
  from Send-Script.ps1's line limit), and a longer one is refused before
  anything is sent (#4253). Watch-Services.ps1 -Webhook has sent
  the alerts webhook this way since 28 September.

  Measured on this machine on 29 September, in Windows PowerShell 5.1 and in
  PowerShell 7: a value piped into powershell -EncodedCommand this way arrives
  whole, and no process command line holds it while the script runs
  (scripts\tests\test-secret-channel.ps1 repeats that on every run).

  Never print the value, including in an error message.
#>

# How a script goes to the VPS at all: Send-Script.ps1 (issue #1070).
. (Join-Path $PSScriptRoot 'Send-Script.ps1')

# The longest value that goes, in bytes of UTF-8 (#4253). Its line on standard
# input is base64, four characters for every three bytes, then CR LF, and
# Send-Script.ps1 holds that line to $ThornswoodStdinLimit: 8,000 there is
# 5,997 here.
$ThornswoodSecretLimit = [int]([Math]::Floor(($ThornswoodStdinLimit - 2) / 4) * 3)

# The first thing the far side runs: one line of standard input, anything that
# is not base64 dropped (a byte order mark or a stray CR), decoded as UTF-8.
# Caught and never shown: an error here would print the line.
function Get-ThornswoodSecretPrelude {
    return @'
$ProgressPreference = 'SilentlyContinue'
$ThornswoodSecret = ''
try { $ThornswoodSecret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((('' + [Console]::In.ReadLine()) -replace '[^A-Za-z0-9+/=]', ''))) } catch { }
'@
}

# What goes on standard input for a value: base64 of its UTF-8 bytes, one line.
function ConvertTo-ThornswoodSecretWire([AllowEmptyString()][string]$Secret) {
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$Secret))
}

# Runs $Script on the VPS with $Secret on standard input, and hands back what
# the far side printed (2>&1, the same as every Remote here).
#   -Target   user@host
#   -SshArgs  the script's own ssh options (@ssh), used for ssh and scp alike
#   -Bypass   -ExecutionPolicy Bypass, for a script that dot-sources a file
#   -Limit    the longest command line sent; over it the script goes by file
function Invoke-ThornswoodSecretRemote {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @(),
        [Parameter(Mandatory = $true)][string]$Script,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Secret,
        [switch]$Bypass,
        [int]$Limit = 6000
    )
    # Host key checking on (issue #450), whatever the caller passed. ssh takes
    # the first value it is given for an option, so a caller's own weaker
    # StrictHostKeyChecking would win over one added here: that is refused,
    # before the secret goes anywhere, rather than quietly overridden.
    $weak = @($SshArgs | Where-Object { $_ -match '(?i)StrictHostKeyChecking\s*=\s*(?!yes\b)' })
    if ($weak.Count) { throw ('ssh options with host key checking turned down (' + ($weak -join ', ') + '). A secret goes only to the box whose key is pinned. Nothing was sent.') }
    # Measured on the value, so the refusal says the size the caller can act
    # on, never the base64 line's. The value itself is never in the message.
    $size = [Text.Encoding]::UTF8.GetByteCount($Secret)
    if ($size -gt $ThornswoodSecretLimit) { $Secret = $null; throw ('the value is ' + $size + ' bytes, over the ' + $ThornswoodSecretLimit + ' that fit on one line of standard input to the box (Send-Secret.ps1, #4253). Nothing was sent.') }
    $full = (Get-ThornswoodSecretPrelude) + "`r`n" + $Script
    $wire = ConvertTo-ThornswoodSecretWire $Secret
    $Secret = $null
    # Send-Script.ps1 does the sending (issue #1070): on the command line when
    # it fits, otherwise by scp to a copy its run deletes first, and the far
    # side's exit code kept. The value goes on standard input either way,
    # never on a command line and never in a file.
    try { Invoke-ThornswoodRemote -Target $Target -SshArgs $SshArgs -Script $full -Bypass:$Bypass -Limit $Limit -Stdin $wire }
    finally { $wire = $null }
}

# A secret asked for from the person at the keyboard, hidden as it is typed or
# pasted, so it is in no command line, no history file and no console buffer
# (issue #1069). Hands back the plain value, '' when nothing was given.
#
# With no keyboard, the value is one line of standard input (#3216). A cloud
# Desk runs these scripts with no console, and there Read-Host -AsSecureString
# on a redirected standard input ended the whole script on the spot, with exit
# code 0 and nothing printed, so a run looked finished when nothing had been
# sent (measured in PowerShell 7.6, 22 Oct 2026). A value piped in is still on
# no command line and in no file: the caller pipes it from what it holds, as
#   $value | pwsh -NoProfile -File scripts/deploy/Set-Turnstile.ps1 -PublicSiteKey 0x...
# A trailing CR from a Windows pipe is dropped; nothing else is changed.
function Read-ThornswoodSecret([string]$Prompt) {
    if ([Console]::IsInputRedirected) {
        Write-Host ($Prompt + ': read from standard input')
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { return '' }
        return $line.TrimEnd("`r")
    }
    return (ConvertFrom-ThornswoodSecureString (Read-Host $Prompt -AsSecureString))
}

# A SecureString as plain text, for the moment it is sent. A script that
# already asked hands the value on to another as a SecureString, which
# nobody can type on a command line.
function ConvertFrom-ThornswoodSecureString([System.Security.SecureString]$Value) {
    if (-not $Value -or $Value.Length -eq 0) { return '' }
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
