<#
  VoiceSite.ps1

  Says whether a voice service's site address is one it can let people in
  with, and whether a join gets through on a running service. Dot-sourced by
  Install-Voice.ps1, and by tests\test-4467-voice-site.js, which runs both
  against the real service.

  WHAT THE SITE IS FOR (#4467). The voice service hands out a join token on
  /token only after it has asked the site, on /api/play/owns, whether the
  Discord ticket it was sent owns the profile it wants (#1303, #1315). Every
  voice connection and every chat line in the game rides one of those
  tokens. With no site there is nobody to ask, so /token answers 503 to
  everybody and nobody gets in. Install-Voice.ps1 used to describe -Site as
  the address asked about character creation choices, and empty as turning
  that check off, which is what it was before 20 September; it took an
  empty one and still ended as a pass.
#>

<#
  Why this site address will not do, or '' when it will. Only https to a
  plain host name and port: the service asks it with a Discord ticket in the
  body, which goes over nothing else (#1304), and the address goes onto the
  cmd.exe line that starts the service, where an & or a quote would start a
  second command.
#>
function Get-VoiceSiteProblem([string]$Site) {
    $s = "$Site".Trim()
    if (-not $s) {
        return 'the site address is empty. The voice service asks that site whether a Discord ticket owns the profile on every voice and chat join, so with none it refuses every join (503).'
    }
    if ($s -notmatch '^https://[A-Za-z0-9.-]+(:\d{1,5})?/?$') {
        return "the site address '$s' is not https://<host> or https://<host>:<port>. The voice service sends the site a Discord ticket, which goes over https only, and the address goes onto the command line that starts it."
    }
    return ''
}

<#
  The check, as text to run on the box (Install-Voice sends it with Remote,
  the harness runs it here): one POST to the service's /token on loopback,
  for profile 1 with a ticket nobody holds, printing one line, JOIN <status>
  <body>, or JOIN 0 <why> when nothing answered.

  On loopback rather than through the site, so it asks the one thing a join
  needs of the service, that it can ask its site, and not whether Caddy
  carries it; the install's /health through the site says that. A plain
  http ask on loopback is one the service takes (#1304 refuses one from
  outside). Nothing is minted: the site never says yes to that ticket. The
  service's log says it refused a token for profile 1, as it says for any
  ticket the site does not take.

  HttpWebRequest, because it is the same on Windows PowerShell and 7: a
  status that is not 2xx comes back as a WebException carrying the answer,
  which is read, not dropped.
#>
function Get-VoiceJoinCheck([int]$Port) {
    return @"
`$joinSaid = ''
`$joinAnswer = `$null
try {
    `$q = [Net.HttpWebRequest]::Create('http://127.0.0.1:$Port/token')
    `$q.Method = 'POST'; `$q.ContentType = 'application/json'; `$q.Timeout = 15000
    `$b = [Text.Encoding]::UTF8.GetBytes('{"profileId":1,"ticket":"install-check-not-a-ticket"}')
    `$s = `$q.GetRequestStream(); `$s.Write(`$b, 0, `$b.Length); `$s.Close()
    `$joinAnswer = `$q.GetResponse()
} catch {
    `$e = `$_.Exception
    while (`$e -and -not (`$e -is [Net.WebException])) { `$e = `$e.InnerException }
    if (`$e -and `$e.Response) { `$joinAnswer = `$e.Response }
    else { `$joinSaid = 'JOIN 0 ' + (`$_.Exception.GetBaseException().Message -replace '[\r\n]+', ' ') }
}
if (`$joinAnswer) {
    `$t = (New-Object IO.StreamReader(`$joinAnswer.GetResponseStream())).ReadToEnd()
    `$joinSaid = 'JOIN ' + [int]`$joinAnswer.StatusCode + ' ' + (`$t -replace '[\r\n]+', ' ')
    `$joinAnswer.Close()
}
`$joinSaid
"@
}

<#
  What that line means: Ok and Said.

  403 with the body ticket is the site's own answer for a ticket it does not
  take, so the service asked its site and heard back, which is all a real
  join needs from here on. 503 is the service unable to ask (no site, or none
  answering), which refuses every join. Anything else, or no line, is said as
  it came, and is not a pass.
#>
function Read-VoiceJoin([string[]]$Lines) {
    $line = @($Lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -like 'JOIN *' }) | Select-Object -Last 1
    if (-not $line -or $line -notmatch '^JOIN (\d+) ?(.*)$') {
        return [pscustomobject]@{ Ok = $false; Said = 'the join check printed no answer, so whether a join gets through is not known' }
    }
    $code = [int]$Matches[1]
    $text = $Matches[2].Trim()
    if ($code -eq 403 -and $text -eq 'ticket') {
        return [pscustomobject]@{ Ok = $true; Said = 'the service asked its site about a ticket nobody holds and the site refused it, as it should (403 ticket)' }
    }
    if ($code -eq 503) {
        return [pscustomobject]@{ Ok = $false; Said = "/token answered 503 ($text): the service could not ask its site whether a ticket owns a profile, so it refuses every join. Its THORNSWOOD_SITE is empty or the site is not answering it" }
    }
    if ($code -eq 0) {
        return [pscustomobject]@{ Ok = $false; Said = "nothing answered /token on the box ($text)" }
    }
    $shown = $(if ($text.Length -gt 120) { $text.Substring(0, 120) + '...' } else { $text })
    return [pscustomobject]@{ Ok = $false; Said = "/token answered $code ($shown), not the 403 ticket a ticket nobody holds gets, so whether a join gets through is not known" }
}
