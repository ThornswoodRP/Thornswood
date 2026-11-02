<#
  test-log-upload.ps1

      pwsh -NoProfile -File .\tests\test-log-upload.ps1

  The launcher's half of the session logs: which files it picks, what it takes
  out of them, and whether the site can read what it sends. The site's half is
  test-session-logs.js.

  WHY, found on 24 September working entry 105 (the game went down with the
  creation panel open and an alt tab, and left no crash log anybody could
  find):

  1. NOT ONE SET HAD EVER ARRIVED. Discord.Escape did the backslash and the
     quote and nothing else, so every line break in every log went into the
     body raw. JSON does not allow that, the site's JSON.parse threw, the body
     became an empty object with no ticket in it, and the site answered 401.
     Profile\launcher.log on Patrick's machine: 27 uploads since 22 September,
     27 answered 401, none sent. The start and the end of each session carry
     no line break and were recorded all along, which is why it looked like a
     ticket problem rather than what it was.

  2. THE TWO FILES THAT SETTLE A NATIVE CRASH WERE NOT SENT: the SKSE crash
     log and skyrim-platform.log, both in Profile\MyGames\SKSE. The crash log
     only from the session being sent, because that folder keeps every crash
     there has ever been.

  This lifts the real methods out of launcher\app\Discord.cs by text and compiles
  them with the compiler the build runs (Add-LauncherType,
  tests\Launcher-Csc.ps1, #2821; off Windows it says SKIP, that compiler is
  only there), so what is under test is the shipped code rather than a copy of
  it, and a rename fails loudly. The JSON is read by node's JSON.parse, which is
  what the site reads it with.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$src = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\Discord.cs'))
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

$script:pass = 0; $script:fail = 0
function Yes($what, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# One method, from its signature to its closing brace, made public so this can
# call it. $null when Discord.cs has no such method.
function Lift([string]$sig) {
  $at = $src.IndexOf($sig)
  if ($at -lt 0) { return $null }
  $open = $src.IndexOf('{', $at)
  if ($open -lt 0) { return $null }
  $d = 0
  for ($i = $open; $i -lt $src.Length; $i++) {
    $c = $src[$i]
    if ($c -eq '{') { $d++ }
    elseif ($c -eq '}') {
      $d--
      if ($d -eq 0) { return 'public ' + $src.Substring($at, $i - $at + 1) }
    }
  }
  return $null
}

$want = [ordered]@{
  Escape        = 'static string Escape('
  PendingSince  = 'static DateTime PendingSince('
  CrashLogSince = 'static string CrashLogSince('
  Scrub         = 'static string Scrub('
  ScrubFor      = 'static string ScrubFor('
  ReadLogTail   = 'static string ReadLogTail('
  CrashLogText  = 'static string CrashLogText('
  CrashLogHead  = 'static string CrashLogHead('
}
$have = @{}
$parts = @()
foreach ($k in $want.Keys) {
  $m = Lift $want[$k]
  Yes "Discord.cs has $k" ($null -ne $m)
  if ($null -ne $m) { $have[$k] = $true; $parts += $m }
}

$name = 'LiftedDiscord' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
# ReadLogTail's cap, Swallow.Note, which CrashLogText reports to, and
# CrashDump.Beside, the snapshot beside a crash log (test-crash-snapshot.ps1
# holds the real one): the launcher's own, stood in for here.
$code = "using System;`nusing System.Globalization;`nusing System.IO;`nusing System.Text;`n" +
        "using System.Text.RegularExpressions;`n" +
        "static class Swallow { public static void Note(string where, Exception e) { } }`n" +
        "static class CrashDump { public static string Beside(string l) { string d = Path.ChangeExtension(l, `".dmp`"); return File.Exists(d) ? d : null; } }`n" +
        "public static class $name`n{`nconst int LogTailBytes = 192 * 1024;`n" +
        ($parts -join "`n") + "`n}`n"
$T = $null
if (-not $OnWindows) {
  Write-Host 'SKIP  the lifted methods, compiled and run: their compiler is the Roslyn csc that comes with Visual Studio''s Build Tools, which only Windows has'
} else {
  try {
    $T = (Add-LauncherType -Source $code).GetType($name)
  } catch {
    Write-Host ("the lifted methods did not compile: " + $_.Exception.Message)
  }
  Yes 'the lifted methods compile, with the compiler the build runs' ($null -ne $T)
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-logupload-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root

try {
  # ---- the body is JSON the site can read -----------------------------------
  if ($T -and $have.Escape) {
    Yes 'a plain value is left as it is' ($T::Escape('abc-123_XYZ') -ceq 'abc-123_XYZ')
    Yes 'a backslash and a quote are escaped as before' ($T::Escape('a"b\c') -ceq 'a\"b\\c')
    Yes 'nothing at all is an empty string' ($T::Escape($null) -ceq '')

    # A log as the launcher reads one: Windows line ends, a path, quotes, a
    # tab, and the odd control character a crash log can carry.
    $log = "2026-09-23 10:19:44  Starting the game on launcher 1.1.91, pack 20260923-0746, borderless.`r`n" +
           "Working Directory: C:\Thornswood\Game`n" +
           "Unhandled exception `"EXCEPTION_ACCESS_VIOLATION`" at 0x7FF7C52AF7EF`tcmp [rdi], eax`n" +
           "a bell " + [char]7 + ", a nul " + [char]0 + ", an escape " + [char]27 + " and a form feed " + [char]12 + "`n"
    $escaped = $T::Escape($log)
    $raw = $false
    foreach ($ch in $escaped.ToCharArray()) { if ([int]$ch -lt 32) { $raw = $true; break } }
    Yes 'no control character is left raw in the escaped text' (-not $raw)

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Write-Host 'SKIP  node is not on this machine, so the body was not read the way the site reads it'
    } else {
      $body = '{"ticket":"tk1.x.y","session":"abcdefabcdef","logs":{"launcher.log":"' + $escaped + '"}}'
      $bodyFile = Join-Path $root 'body.json'
      $textFile = Join-Path $root 'text.log'
      $checker = Join-Path $root 'read.js'
      $utf8 = New-Object Text.UTF8Encoding($false)
      [IO.File]::WriteAllText($bodyFile, $body, $utf8)
      [IO.File]::WriteAllText($textFile, $log, $utf8)
      [IO.File]::WriteAllText($checker, @'
const fs = require('fs');
let o;
try { o = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
catch (e) { console.log('THROWS ' + e.message); process.exit(0); }
const want = fs.readFileSync(process.argv[3], 'utf8');
console.log((o && o.ticket === 'tk1.x.y' ? 'TICKET ' : 'NOTICKET ') +
            (o && o.logs && o.logs['launcher.log'] === want ? 'SAME' : 'DIFFERENT'));
'@, $utf8)
      $said = (& $node.Source $checker $bodyFile $textFile | Out-String).Trim()
      Yes "the site's JSON.parse reads the body ($said)" (-not $said.StartsWith('THROWS'))
      Yes 'the ticket comes through, so the site has no reason to answer 401' ($said.StartsWith('TICKET '))
      Yes 'and the log arrives as exactly the text that was read' ($said.EndsWith('SAME'))
    }
  }

  # ---- when the session began -----------------------------------------------
  $start = New-Object DateTime 2026, 9, 20, 18, 30, 0, ([DateTimeKind]::Utc)
  $pending = Join-Path $root 'logs-pending.txt'
  [IO.File]::WriteAllText($pending, '0123456789abcdef0123456789abcdef')
  [IO.File]::SetLastWriteTimeUtc($pending, $start)
  if ($T -and $have.PendingSince) {
    Yes 'the start is read off the pending marker' ($T::PendingSince($pending, '0123456789abcdef0123456789abcdef') -eq $start)
    Yes 'a marker left by another session dates nothing' ($T::PendingSince($pending, 'ffffffffffffffffffffffffffffffff') -eq [DateTime]::MinValue)
    Yes 'no marker dates nothing' ($T::PendingSince((Join-Path $root 'nothing.txt'), '0123456789abcdef0123456789abcdef') -eq [DateTime]::MinValue)
    Yes 'no session id dates nothing' ($T::PendingSince($pending, '') -eq [DateTime]::MinValue)
  }

  # ---- which crash log ------------------------------------------------------
  $skse = Join-Path $root 'SKSE'
  $null = New-Item -ItemType Directory -Force -Path $skse
  function Put([string]$file, [DateTime]$when) {
    $p = Join-Path $skse $file
    [IO.File]::WriteAllText($p, 'CRASH TIME: ' + $file)
    [IO.File]::SetLastWriteTimeUtc($p, $when)
  }
  Put 'crash-2026-09-19-19-46-38.log' $start.AddDays(-1)
  if ($T -and $have.CrashLogSince) {
    Yes 'an older crash is never sent against a later session' ($T::CrashLogSince($skse, $start) -ceq '')

    Put 'crash-2026-09-20-18-36-10.log' $start.AddMinutes(6)
    Put 'crash-2026-09-20-18-40-00.log' $start.AddMinutes(10)
    # CrashLogger's own log and the platform log sit in the same folder and
    # are written later than any crash. Neither is a crash log.
    Put 'CrashLogger.log' $start.AddMinutes(20)
    Put 'skyrim-platform.log' $start.AddMinutes(20)

    $got = $T::CrashLogSince($skse, $start)
    Yes "the newest crash in the session is the one sent ($([IO.Path]::GetFileName($got)))" `
      ([IO.Path]::GetFileName($got) -ceq 'crash-2026-09-20-18-40-00.log')
    Yes 'a crash after the last one in the folder finds nothing' ($T::CrashLogSince($skse, $start.AddMinutes(30)) -ceq '')
    Yes 'with no start known, no crash log is sent' ($T::CrashLogSince($skse, [DateTime]::MinValue) -ceq '')
    Yes 'a folder that is not there finds nothing' ($T::CrashLogSince((Join-Path $root 'no-such'), $start) -ceq '')
  }

  # ---- an empty crash log is still sent (#2319) --------------------------------
  # Three dev crashes from 29 Sep to 6 Oct hung inside the crash handler and
  # left Crash Logger's log empty; ReadLogTail gave "" and the set went up
  # with no crash.log, so the site never marked them.
  if ($T -and $have.CrashLogText -and $have.CrashLogHead -and $have.ReadLogTail) {
    $emptyLog = Join-Path $skse 'crash-2026-10-04-17-03-03.log'
    [IO.File]::WriteAllText($emptyLog, '')
    $dumpFile = Join-Path $skse 'crash-2026-10-04-17-03-03.dmp'
    [IO.File]::WriteAllBytes($dumpFile, (New-Object byte[] 4096))
    $sent = $T::CrashLogText($emptyLog)
    Yes 'an empty crash log is still something to send' ($sent.Trim().Length -gt 0)
    Yes '  naming the log, saying it is empty, 0 bytes' ($sent -match 'crash-2026-10-04-17-03-03\.log, and it is empty: 0 bytes')
    Yes '  and the snapshot beside it, by name and size' ($sent -match 'crash-2026-10-04-17-03-03\.dmp, 4,096 bytes')
    $fullLog = Join-Path $skse 'crash-2026-10-06-18-03-32.log'
    $crashText = "Skyrim SSE v1.6.1170`r`nUnhandled exception `"EXCEPTION_ACCESS_VIOLATION`" at 0x7FF7C52AF7EF`r`n"
    [IO.File]::WriteAllText($fullLog, $crashText)
    $sent2 = $T::CrashLogText($fullLog)
    Yes 'a full crash log goes with the same first line, its size, and then the log itself' (
      $sent2 -match '^Sent by the launcher: this session crashed\.' -and $sent2 -match ('crash-2026-10-06-18-03-32\.log, ' + $crashText.Length + ' bytes') -and
      $sent2.EndsWith($crashText) -and $sent2 -match 'There is no crash snapshot beside it')
    Yes 'no crash log is nothing to send' ($T::CrashLogText('') -ceq '')

    # And the site, reading what the launcher sends for the empty one, marks
    # the session: server.js's own crashOf and readTrouble, lifted by text.
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Write-Host 'SKIP  node is not on this machine, so the site''s reading was not run'
    } else {
      $utf8 = New-Object Text.UTF8Encoding($false)
      $bodyFile = Join-Path $root 'crash-body.json'
      [IO.File]::WriteAllText($bodyFile, ('{"logs":{"crash.log":"' + $T::Escape($T::Scrub($sent)) + '"}}'), $utf8)
      $reader = Join-Path $root 'read-crash.js'
      [IO.File]::WriteAllText($reader, @'
const fs = require('fs');
// The site is server.js over its modules in site\lib since #5357.
const src = require(process.argv[2]).source();
function grab(name) {
  const at = src.indexOf('function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
}
function list(name) {
  const at = src.indexOf('const ' + name);
  const open = src.indexOf('[', at);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') d++;
    else if (src[i] === ']') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
}
function line(name) { return src.match(new RegExp('^const ' + name + ' = [^\\n]*;$', 'm'))[0]; }
const TROUBLE_BAD = eval(list('TROUBLE_BAD'));
const TROUBLE_WARN = eval(list('TROUBLE_WARN'));
eval([line('SESSION_START_MARK'), line('CRASH_EMPTY_MARK'), grab('thisSessionOf'), grab('serverRefusal'),
      grab('lineAround'), grab('scanFor'), grab('crashOf'), grab('readTrouble')].join('\n'));
const o = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const f = readTrouble(o.logs);
console.log(f ? (f.level + '|' + f.why + '|' + f.line) : 'NONE');
'@, $utf8)
      $said = (& $node.Source $reader (Join-Path $Here 'tests\site-files.js') $bodyFile | Out-String).Trim()
      Yes "the site marks the session red when its crash log was empty ($said)" ($said.StartsWith('bad|the game crashed, and its crash log is empty|'))
    }
  }

  # ---- what never leaves ----------------------------------------------------
  if ($T -and $have.Scrub) {
    # Made up, in the two shapes: voice-server.js signToken and the site's
    # ticket. Neither is a real one.
    $page = 'window.THORNSWOOD={"host":"192.0.2.1","port":7778,"profileId":134631970,' +
            '"token":"v1.134631970.1790000000000.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"};'
    $out = $T::Scrub($page)
    Yes 'a join token is taken out' (($out.IndexOf('AbCdEfGhIjKl') -lt 0) -and ($out.IndexOf('v1.[join token removed]') -ge 0))
    Yes 'and the rest of the line is kept' ($out.StartsWith('window.THORNSWOOD={"host":"192.0.2.1"'))
    # The shape since #1322: v2.<profile>.<minted>.<nonce>.<signature>.
    $v2 = 'connecting with v2.134631970.1790000000000.QrStUvWxYz0123456789_-.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde now'
    $out = $T::Scrub($v2)
    Yes 'a v2 join token is taken out, nonce and signature both' (($out.IndexOf('QrStUvWx') -lt 0) -and ($out.IndexOf('AbCdEfGhIjKl') -lt 0) -and
        ($out -ceq 'connecting with v2.[join token removed] now'))

    $tk = 'ticket tk1.eyJkIjoiMTIzNDUiLCJuIjoiYSJ9.0123456789abcdef0123456789abcdef in a line'
    $out = $T::Scrub($tk)
    Yes 'a Discord ticket is taken out' (($out.IndexOf('eyJkIjoi') -lt 0) -and ($out -ceq 'ticket tk1.[ticket removed] in a line'))

    foreach ($line in @(
        '2026-09-23 10:19:44  Starting the game on launcher 1.1.91, pack 20260923-0746, borderless.',
        '[10:19:48:897] platform_se v2.9.0',
        'Skyrim SSE v1.6.1170',
        'CrashLoggerSSE v1-24-0-0 Jun 28 2026 00:14:22')) {
      Yes "an ordinary line is left alone: $line" ($T::Scrub($line) -ceq $line)
    }
    Yes 'nothing at all is an empty string' ($T::Scrub($null) -ceq '')
  }

  # ---- who the PC belongs to never leaves (#3627) ----------------------------
  # launcher.log named the Windows user folder (OwnGame's Vortex profile line,
  # a .NET error's path), and the voice log its file:// address. A made-up
  # account first, in every shape a log writes a path, then this machine's own.
  if ($T -and $have.ScrubFor) {
    # Made up, and kept off C:\Users so the gate's own check for real profile
    # accounts (test-3838-no-personal-details.js) has nothing to find here;
    # the folder is passed in, so where it is changes nothing. tester and x
    # are the names that check lets tests use under Users.
    $prof = 'D:\Home\Tess Ro'
    $S = { param($text) $T::ScrubFor($text, $prof, 'Tess Ro', 'DESKTOP-K9QX') }
    $out = & $S 'OwnGame: Windows'' live plugins.txt differs from the Thornswood Vortex profile at D:\Home\Tess Ro\AppData\Roaming\Vortex\skyrimse\profiles\ZRT7NjhN_'
    Yes "the user folder is replaced, the rest of the path kept: $out" ($out -ceq 'OwnGame: Windows'' live plugins.txt differs from the Thornswood Vortex profile at %USERPROFILE%\AppData\Roaming\Vortex\skyrimse\profiles\ZRT7NjhN_')
    Yes 'whatever case Windows wrote it in' ((& $S 'd:\home\TESS RO\Documents') -ceq '%USERPROFILE%\Documents')
    Yes 'doubled, the way a JSON line writes it' ((& $S '"D:\\Home\\Tess Ro\\AppData\\x"') -ceq '"%USERPROFILE%\\AppData\\x"')
    Yes 'as a file:// address, with %20 for the space' ((& $S 'page file:///D:/Home/Tess%20Ro/Thornswood/voice.html') -ceq 'page file:///%USERPROFILE%/Thornswood/voice.html')
    Yes 'at the end of a sentence' ((& $S 'the folder is D:\Home\Tess Ro.') -ceq 'the folder is %USERPROFILE%.')
    $line = 'not D:\Home\Tess Rossi\x'
    Yes 'a longer folder name that starts the same is not cut short' ((& $S $line) -ceq $line)
    $out = & $S 'other C:\Users\tester\AppData\x and C:\Users\x y\z'
    Yes "another account's folder under Users is taken out, spaces and all: $out" ($out -ceq 'other C:\Users\[user]\AppData\x and C:\Users\[user]\z')
    $line = 'public C:\Users\Public\Documents and default C:\Users\Default\x'
    Yes 'Public and Default, which belong to nobody, are left' ((& $S $line) -ceq $line)
    Yes 'the account name as a folder elsewhere is taken out' ((& $S 'D:\Games\Tess Ro\Thornswood') -ceq 'D:\Games\[user]\Thornswood')
    Yes 'and the name as an ordinary word is left' ((& $S 'Tess Ro said hello') -ceq 'Tess Ro said hello')
    Yes 'the PC''s name is taken out as a word, and not out of a longer one' ((& $S 'on desktop-k9qx, not DESKTOP-K9QXY') -ceq 'on [pc], not DESKTOP-K9QXY')
    $out = & $S 'D:\Home\Tess Ro\x with tk1.eyJkIjoiMTIzNDUiLCJuIjoiYSJ9.0123456789abcdef0123456789abcdef'
    Yes "tokens still go in the same line: $out" ($out -ceq '%USERPROFILE%\x with tk1.[ticket removed]')
  }
  if ($T -and $have.Scrub) {
    $me = [Environment]::GetFolderPath('UserProfile')
    $user = [Environment]::UserName
    $pc = [Environment]::MachineName
    $out = $T::Scrub("Swap.Restore, moving $me\Documents\My Games\x.bak on $pc, then file:///" + ($me -replace '\\', '/' -replace ' ', '%20') + "/x.html, D:\Games\$user\y")
    $left = $out -replace '%USERPROFILE%|\[user\]|\[pc\]', ''
    Yes "this PC's own user folder, account and name are taken out by Scrub itself: $out" (
      ($left.IndexOf($me, [StringComparison]::OrdinalIgnoreCase) -lt 0) -and
      ($left -notmatch ('(?i)(?<![\w-])' + [regex]::Escape($pc) + '(?![\w-])')) -and
      ($left -notmatch ('(?i)[\\/]' + [regex]::Escape($user) + '([\\/]|$)')))
  }

  # ---- the upload uses them -------------------------------------------------
  # By text, because SessionLogs itself needs the whole launcher around it.
  $at = $src.IndexOf('public static void SessionLogs()')
  $end = if ($at -ge 0) { $src.IndexOf('int code = PostJson(', $at) } else { -1 }
  $body = if ($at -ge 0 -and $end -gt $at) { $src.Substring($at, $end - $at) } else { '' }
  Yes 'every log goes through Scrub before it is sent, the crash log with the launcher''s line on it (#2319)' (
    $body.Contains('Scrub(want[i][0] == "crash.log" ? CrashLogText(want[i][1]) : ReadLogTail(want[i][1]))'))
  $cs = $src.Replace("`r`n", "`n")
  Yes 'every line of the scan goes through Scrub too, issues and Play page rows (#3627)' (
    $cs.Contains('Append(Escape(Scrub(i.Text)))') -and $cs.Contains('Append(Escape(Scrub(c.Name)))') -and $cs.Contains('Append(Escape(Scrub(c.Detail)))'))
  $diag = [IO.File]::ReadAllText((Join-Path $Here 'launcher\app\Diag.cs'))
  Yes 'the report zip''s summary names neither the Windows account nor the PC (#3627)' (
    ($diag.IndexOf('Environment.UserName') -lt 0) -and ($diag.IndexOf('Environment.MachineName') -lt 0))
  Yes 'the crash log is picked from the SKSE folder by the session start' `
    ($body.Contains('CrashLogSince(Files.SkseLogDir, PendingSince(PendingFile, session))'))
  Yes 'skyrim-platform.log is read from the SKSE folder' `
    ($body.Contains('Path.Combine(Files.SkseLogDir, "skyrim-platform.log")'))
  Yes 'a log that would take the body past what the site reads is left out' ($body.Contains('> LogBodyMax) continue;'))
}
finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit $(if ($script:fail) { 1 } else { 0 })
