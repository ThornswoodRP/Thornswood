<#
  test-911-no-admin-prompt.ps1

      pwsh -NoProfile -File .\tests\test-911-no-admin-prompt.ps1

  Nothing Thornswood runs asks for administrator or gives Windows Firewall a
  reason to ask. Issue #911.

  Patrick, 28 September: "we need to get it so it doesn't do that
  administrator prompt for the firewall rule", then "I also want to allow for
  the emotes/voice chat/text chat without the admin prompt".

  Windows Firewall asks about a program that listens on the network. It does
  not ask about outbound connections (the chat and voice sockets, the site)
  or about listeners on 127.0.0.1. So this holds the launcher to:

    1. Every HttpListener the launcher opens is on 127.0.0.1, and nothing
       binds to every address: the voice's UDP socket (VoiceIce.cs) is bound
       to the one address the machine reaches the internet from.
    2. The launcher asks for asInvoker, and no launcher, installer or game
       file asks for elevation or writes a firewall rule.

  Until #4823 this was test-browser-args.ps1, which also held the voice
  browser (WebView2) to one --disable-features switch with Chromium's mDNS
  responder off, the listener on UDP 5353 that made the prompt. Voice has
  no browser since #4823, and BrowserArgs.cs went with it.

  The in-game side (the voice page making no WebRTC connection once the
  launcher has the audio) is tests\test-voice-relay-no-peers.js.

  HOW. Reads the files as text. Read only; runs on any machine.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# ------------------------------------------------ 1. listeners are loopback
$cs = @(Get-ChildItem -LiteralPath $app -Filter *.cs -File)
$prefixes = @()
foreach ($file in $cs) {
    foreach ($m in [regex]::Matches((Get-Content -LiteralPath $file.FullName -Raw), 'Prefixes\.Add\(\s*"([^"]*)"')) {
        $prefixes += [pscustomobject]@{ File = $file.Name; Prefix = $m.Groups[1].Value }
    }
}
Yes 'the launcher has HttpListeners to check (voice push to talk, Discord sign in)' ($prefixes.Count -ge 2)
$wide = @($prefixes | Where-Object { $_.Prefix -notmatch '^http://127\.0\.0\.1:' })
Yes ('every HttpListener is on 127.0.0.1' + $(if ($wide) { ' (' + (($wide | ForEach-Object { $_.File + ' ' + $_.Prefix }) -join ', ') + ')' } else { '' })) ($wide.Count -eq 0)
$raw = @($cs | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'new\s+TcpListener|new\s+UdpClient\s*\(\s*\d|IPAddress\.Any|IPAddress\.IPv6Any' })
Yes ('no TcpListener, UdpClient on a port, or bind to every address' + $(if ($raw) { ' (' + (($raw | ForEach-Object Name) -join ', ') + ')' } else { '' })) ($raw.Count -eq 0)
$ice = Get-Content -LiteralPath (Join-Path $app 'VoiceIce.cs') -Raw
Yes 'the voice binds its UDP socket to the address the machine reaches the internet from' `
    ($ice -match 'bound = DefaultLocal\(\);\s*sock\.Bind\(new IPEndPoint\(bound, 0\)\);' -and ([regex]::Matches($ice, '\.Bind\(')).Count -eq 1)

# ------------------------------------------------ 2. nothing elevates
$manifest = Get-Content -LiteralPath (Join-Path $app 'Thornswood.manifest') -Raw
Yes 'the launcher asks for asInvoker' ($manifest -match 'requestedExecutionLevel\s+level="asInvoker"')
$files = @()
# Not the products' own harnesses (launcher\tests and the like, #5341),
# which name the words they look for.
foreach ($dir in 'launcher', 'installer', 'game\plugins', 'game\ui') {
    $files += @(Get-ChildItem -LiteralPath (Join-Path $root $dir) -Recurse -File -Include *.cs, *.ps1, *.js, *.xaml, *.axaml, *.html, *.manifest |
        Where-Object { @($_.FullName.Substring($root.Length).Split([char[]]@('\', '/')) | Where-Object { $_ -eq 'tests' }).Count -eq 0 })
}
$asks = @($files | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw) -match '"runas"|-Verb\s+RunAs|advfirewall|NetFirewallRule|HNetCfg\.FwPolicy|requireAdministrator|highestAvailable'
})
Yes ('no launcher, installer or game file elevates or writes a firewall rule' + $(if ($asks) { ' (' + (($asks | ForEach-Object Name) -join ', ') + ')' } else { '' })) ($asks.Count -eq 0)
Yes 'there is no Firewall.cs' (-not (Test-Path -LiteralPath (Join-Path $app 'Firewall.cs')))

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
