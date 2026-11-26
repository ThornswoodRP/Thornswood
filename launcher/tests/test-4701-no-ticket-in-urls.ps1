<#
  test-4701-no-ticket-in-urls.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4701-no-ticket-in-urls.ps1

  #4701. The launcher's sign-in is good for thirty days, and it rode in two
  kinds of address:
    - Connect Discord's answer, http://127.0.0.1:<port>/thornswood?ticket=...,
      which the browser keeps in its history, and copies to every device a
      signed-in browser syncs with;
    - every gallery call, /up/<name>?ticket=..., /api/gallery/report?ticket=...
      and the rest, which a proxy, the site's request log and a crash report
      keep.
  Now the launcher asks the site for a one-time code (hand=code), reads only
  the code and the nonce from the answer, and trades the code for the sign-in
  over a POST to /api/launcher/exchange. Every gallery call carries the
  sign-in in "Authorization: Ticket <sign-in>".

  The first half reads launcher\app and runs anywhere. The second compiles the
  real launcher (tests\Launcher-Csc.ps1) and needs the .NET SDK: it builds the
  requests and reads them, and sends nothing. The sign-in is a made-up one in
  a temp folder. No browser, launcher, game or site is started.

  On main before #4701 both halves fail: Gallery.cs builds ?ticket= addresses,
  Connect reads q["ticket"], and Discord.Signed, CodeFrom and ExchangeRequest
  are not there.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pass = 0; $fail = 0
function Yes([string]$name, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS  $name" } else { $script:fail++; Write-Host "FAIL  $name" } }
function CodeOf([string]$text) {
    $t = [regex]::Replace($text, '(?s)/\*.*?\*/', '')
    $keep = foreach ($line in ($t -split "`n")) { if ($line.TrimStart() -notmatch '^//') { $line } }
    return ($keep -join "`n")
}
function Member([string]$text, [string]$head) {
    $at = $text.IndexOf($head)
    if ($at -lt 0) { return '' }
    $open = $text.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ } elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return ''
}

# ---- the source -----------------------------------------------------------------
$discord = CodeOf ([IO.File]::ReadAllText((Join-Path $repo 'launcher/app/Discord.cs')))
$gallery = CodeOf ([IO.File]::ReadAllText((Join-Path $repo 'launcher/app/Gallery.cs')))

Yes 'Gallery.cs builds no address with a ticket in it' ($gallery -notmatch '(?i)[?&]ticket=')
$uses = @([regex]::Matches($gallery, 'Discord\.Ticket\b[^;\r\n]*'))
Yes ('Gallery.cs reads the sign-in only to ask whether there is one (' + $uses.Count + ' reads)') (
    $uses.Count -gt 0 -and @($uses | Where-Object { $_.Value -notmatch '^Discord\.Ticket\s*==\s*null' }).Count -eq 0)
Yes 'and every gallery call that needs it is signed: report, submit, copies, the staff doors and /up' (
    $gallery.Contains('Discord.Send("POST", url, body, true, out reply)') -and
    $gallery.Contains('Discord.PostBytes(url, data, ContentTypeFor(ext), 60000, true, out reply)') -and
    $gallery.Contains('Discord.PostBytes(url, jpg, "image/jpeg", 60000, true, out reply)') -and
    $gallery.Contains('Discord.Send(method, Discord.Site + door, body, true, out reply)') -and
    $gallery.Contains('GetBytes(UpUrl(name, width), 8000, true)'))

$connect = Member $discord 'public static void Connect(Action<bool, string> onDone)'
$codeFrom = Member $discord 'public static string CodeFrom('
$exchange = Member $discord 'static bool Exchange(string code, string nonce'
Yes 'Connect asks the site for a one-time code' ($connect -match '"&hand=code"')
Yes 'Connect reads no sign-in out of the address' ($connect.Length -gt 0 -and $connect -notmatch 'q\["ticket"\]|QueryString\["ticket"\]')
Yes '  and CodeFrom reads only the nonce and the code' ($codeFrom.Length -gt 0 -and
    @([regex]::Matches($codeFrom, 'q\["(\w+)"\]') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) -join ',' -eq 'code,nonce')
Yes '  and the code is traded for it over Exchange' ($connect -match 'Exchange\(code, nonce, out gotTicket')
# Nothing that reaches a log, a page or a message box is built from the code or
# the sign-in: not in Connect, CodeFrom or Exchange.
$said = foreach ($body in @($connect, $codeFrom, $exchange)) {
    foreach ($line in ($body -split "`n")) {
        if ($line -match '(Note|Log|Say|Line|Page|Swallow\.\w+|Failure\.\w+|onDone|why\s*=|error\s*=)' -and
            $line -match '\+\s*(code|got|gotTicket|t|Ticket|ticket)\b') { $line.Trim() }
    }
}
Yes ('no line puts the code or the sign-in into a log, a page or a message (' + (@($said) -join ' | ') + ')') (@($said).Count -eq 0)

# ---- the requests, from the real launcher ----------------------------------------
. (Join-Path $repo 'tests/Launcher-Csc.ps1')
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4701-' + [Guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $asm = Add-LauncherAssembly
    $dt = $asm.GetType('Thornswood.Discord', $true)
    $gt = $asm.GetType('Thornswood.Gallery', $true)
    $all = [Reflection.BindingFlags]'Public, NonPublic, Static'

    # A made-up sign-in in the shape the site makes, good for a day.
    $end = [DateTimeOffset]::UtcNow.AddDays(1).ToUnixTimeMilliseconds()
    $bodyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"d":"100000000000000001","x":' + $end + '}')).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $T = 'tk1.' + $bodyB64 + '.fixture-signature-not-real'
    $dt.GetField('Folder').SetValue($null, $work)
    [IO.File]::WriteAllText((Join-Path $work 'discord.txt'), $T)
    $dt.GetField('ticket', $all).SetValue($null, $null)
    Yes 'the made-up sign-in is read back as this copy''s' ([string]$dt.GetProperty('Ticket').GetValue($null) -ceq $T)

    $site = [string]$dt.GetField('Site').GetValue($null)
    $up = [string]$gt.GetMethod('UpUrl', $all).Invoke($null, @('shot one.png', 0))
    $upW = [string]$gt.GetMethod('UpUrl', $all).Invoke($null, @('shot one.png', 800))
    $sub = [string]$gt.GetMethod('SubmitUrl', $all).Invoke($null, @('shot one.png', 'Lydia', 'a note', 'A tavern at dusk'))
    $cp = [string]$gt.GetMethod('CopyUrl', $all).Invoke($null, @('shot.png', 800))
    $addresses = @($up, $upW, $sub, $cp)
    Yes ('the gallery addresses carry no sign-in (' + ($addresses -join ' ') + ')') (
        @($addresses | Where-Object { $_.Contains($T) -or $_ -match '(?i)ticket' }).Count -eq 0 -and
        $up -ceq ($site + '/up/shot%20one.png') -and $upW -ceq ($site + '/up/shot%20one.png?w=800') -and
        $sub.StartsWith($site + '/api/gallery/submit?name=') -and $cp -ceq ($site + '/api/gallery/copy?name=shot.png&w=800'))

    $req = $dt.GetMethod('Signed').Invoke($null, @([Net.Http.HttpMethod]::Get, $up))
    $auth = @($req.Headers.GetValues('Authorization'))
    Yes 'a signed request carries the sign-in in Authorization: Ticket' ($auth.Count -eq 1 -and $auth[0] -ceq ('Ticket ' + $T))
    Yes '  and not in its address' (-not $req.RequestUri.AbsoluteUri.Contains($T))
    $req.Dispose()

    $Q = { param($pairs) $c = New-Object System.Collections.Specialized.NameValueCollection; foreach ($k in $pairs.Keys) { $c.Add($k, $pairs[$k]) }; , $c }
    $N = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6'
    $C = 'one-time-code_' + ('x' * 30)
    $codeFrom = $dt.GetMethod('CodeFrom')
    function Answer($q, [bool]$local, [string]$nonce) {
        $a = [object[]]@($q, $local, $nonce, $false, '')
        $got = $codeFrom.Invoke($null, $a)
        return [pscustomobject]@{ Code = $got; Ours = [bool]$a[3]; Why = [string]$a[4] }
    }
    $old = Answer (& $Q ([ordered]@{ ticket = $T; name = 'Lydia'; avatar = 'abc'; nonce = $N })) $true $N
    Yes 'an answer in the old shape, the sign-in in the address, is not taken' ($null -eq $old.Code -and $old.Ours)
    Yes '  and what it says carries no sign-in' (-not $old.Why.Contains($T) -and $old.Why.Length -gt 0)
    $new = Answer (& $Q ([ordered]@{ code = $C; nonce = $N })) $true $N
    Yes 'an answer with a code and this attempt''s nonce gives the code' ($new.Code -ceq $C -and $new.Ours)
    $other = Answer (& $Q ([ordered]@{ code = $C; nonce = 'someone-elses' })) $true $N
    Yes 'another nonce is ignored, and the listener keeps waiting' ($null -eq $other.Code -and -not $other.Ours)
    $far = Answer (& $Q ([ordered]@{ code = $C; nonce = $N })) $false $N
    Yes 'so is an answer that did not come from this machine' ($null -eq $far.Code -and -not $far.Ours)
    $short = Answer (& $Q ([ordered]@{ code = 'abc'; nonce = $N })) $true $N
    Yes 'and a code that is not one ends the attempt with why' ($null -eq $short.Code -and $short.Ours -and $short.Why.Length -gt 0)

    $ex = $dt.GetMethod('ExchangeRequest').Invoke($null, @($C, $N))
    $exBody = $ex.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    Yes 'the code is traded over a POST to /api/launcher/exchange' ($ex.Method.Method -eq 'POST' -and $ex.RequestUri.AbsoluteUri -ceq ($site + '/api/launcher/exchange'))
    Yes '  with the code and the nonce in the body and nothing in the address' (
        -not $ex.RequestUri.AbsoluteUri.Contains($C) -and $exBody -ceq ('{"code":"' + $C + '","nonce":"' + $N + '"}'))
    $ex.Dispose()
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
