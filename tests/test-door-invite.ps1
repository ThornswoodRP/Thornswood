<#
  test-door-invite.ps1

      pwsh -NoProfile -File .\tests\test-door-invite.ps1

  "Not accepted yet" offers the Discord invite (#999).

  /api/play/join answers a Discord account that has no role that lets it in
  with why 'role', the message telling them to apply in the Discord, and the
  invite. Door.Explain offered to open the invite only for why 'guild', so for
  'role' it put up the message in an OK box and stopped, and somebody told to
  apply in the Discord had to find the Discord themselves.

  This builds the whole launcher, the real Door.cs and the real Standing in
  Discord.cs among it, with a driver of its own, the way the project builds
  (the .NET 10 SDK, tests\Launcher-Csc.ps1, on any machine that has it,
  #4823), and asks Door.InviteQuestion about every answer the site gives.
  Then it reads Explain and holds it to asking that question in a Yes and No
  box (Ask.YesNo) and opening the invite on Yes. site\server.js is read for
  the other half: 'role' is sent with the invite.

  Read only apart from the build under out\harness, which git ignores.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$DoorPath = Join-Path $Here (Join-Path (Join-Path "launcher" "app") "Door.cs")

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

$doorSrc = [IO.File]::ReadAllText($DoorPath)

# ---- Explain asks the question and opens the invite on Yes -------------------
$at = $doorSrc.IndexOf('public static void Explain(')
Yes 'Door.cs has Explain' ($at -ge 0)
if ($at -lt 0) { Done }
$explain = $doorSrc.Substring($at, $doorSrc.IndexOf('public static string InviteQuestion(') - $at)
Yes 'Explain asks InviteQuestion whether it can offer the Discord' ($explain -match 'string ask = InviteQuestion\(st\);\s*if \(ask != null\)')
Yes 'the question goes on the end of the site''s message' ($explain.Contains('body += "\n\n" + ask;'))
Yes 'as a Yes and No box' ($explain -match '(?s)if \(ask != null\).{0,200}if \(Ask\.YesNo\(body, ')
Yes 'and Yes opens the invite the site sent' ($explain -match '(?s)if \(Ask\.YesNo\(body, [^\n]*\)\)\s*\{.{0,300}ProcessStartInfo\(st\.Invite\).{0,200}Process\.Start\(psi\)')
Yes 'Explain no longer offers the invite for guild alone' (-not $explain.Contains('st.Why == "guild" && st.Invite'))

# ---- the site sends the invite with 'role' -----------------------------------
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$server = Get-SiteSource (Join-Path $Here 'site')
Yes 'site\server.js sends why role with the invite on /api/play/join' (
    $server -match "(?s)why:'role', message:\s*notAcceptedYet\(\),\s*invite: cfg\.discord\.invite")

# ---- the launcher as the project builds it ----------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# The driver prints InviteQuestion's answer for a why and an invite, "null"
# when there is none. "-" for the invite is no invite at all, "empty" an empty one.
$driver = @'
using System;

namespace Thornswood
{
    public static class DoorInviteTest
    {
        public static int Main(string[] args)
        {
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                Standing st = new Standing();
                st.Ok = false;
                st.Why = args[i];
                st.Invite = args[i + 1] == "-" ? null : (args[i + 1] == "empty" ? "" : args[i + 1]);
                string q = Door.InviteQuestion(st);
                Console.WriteLine(args[i] + "|" + args[i + 1] + "=" + (q == null ? "null" : q));
            }
            Console.WriteLine("nullstanding=" + (Door.InviteQuestion(null) == null ? "null" : "asked"));
            return 0;
        }
    }
}
'@

$exe = $null
try { $exe = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.DoorInviteTest' }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'Door.cs builds in the launcher, the way the project builds it' ($null -ne $exe)
if (-not $exe) { Done }

$inv = 'https://discord.gg/example'
$lines = Invoke-LauncherExe $exe 'role' $inv 'guild' $inv 'banned' $inv 'role' '-' 'role' 'empty' 'guild' '-' `
                'link' $inv 'could not ask Discord' $inv 'offline' $inv 'role' 'file:///C:/Windows/notepad.exe' `
                'role' 'C:\Windows\notepad.exe' 'role' 'HTTPS://discord.gg/example'
$got = @{}
foreach ($l in @($lines)) { $s = [string]$l; $cut = $s.IndexOf('='); if ($cut -gt 0) { $got[$s.Substring(0, $cut)] = $s.Substring($cut + 1) } }

Yes 'not accepted yet, with an invite: the box offers to open the Discord' ($got["role|$inv"] -eq 'Open the Discord to apply?')
Yes 'not in the Discord, with an invite: it still offers to join it' ($got["guild|$inv"] -eq 'Open the Discord and join it?')
Yes 'banned never gets the invite' ($got["banned|$inv"] -eq 'null')
Yes 'not accepted yet with no invite sent: no offer, the OK box as before' ($got['role|-'] -eq 'null')
Yes 'not accepted yet with an empty invite: no offer' ($got['role|empty'] -eq 'null')
Yes 'not in the Discord with no invite: no offer' ($got['guild|-'] -eq 'null')
Yes 'not linked yet: no invite, Connect Discord is its answer' ($got["link|$inv"] -eq 'null')
Yes 'Discord could not be asked: no invite' ($got["could not ask Discord|$inv"] -eq 'null')
Yes 'the site did not answer: no invite' ($got["offline|$inv"] -eq 'null')
Yes 'an invite that is not a web address is never opened' (
    $got['role|file:///C:/Windows/notepad.exe'] -eq 'null' -and $got['role|C:\Windows\notepad.exe'] -eq 'null')
Yes 'a web address in capitals is still one' ($got['role|HTTPS://discord.gg/example'] -eq 'Open the Discord to apply?')
Yes 'no answer at all asks nothing' ($got['nullstanding'] -eq 'null')

$said = @($got.Values | Where-Object { $_ -ne 'null' }) -join ' '
Yes 'no em dash and never the word the project does not use' (-not ($said -match [char]0x2014) -and -not ($said -match 'player'))

Done
