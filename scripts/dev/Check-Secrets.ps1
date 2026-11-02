<#
  Check-Secrets.ps1

  Read only. Looks for anything that must never leave a machine: in the files
  this repository tracks, in a pack or another zip, or in a built program. For every hit it prints the file, the line and
  the name of the rule, and NEVER the thing it matched. A scan that prints what
  it found has just published it, in a build log anybody on the repository can
  read.

      .\scripts\dev\Check-Secrets.ps1                            every file git tracks here, and in
                                             each submodule that is checked out
      .\scripts\dev\Check-Secrets.ps1 -Zip <pack, zip, or Setup program>
                                             the entries of a zip. A Setup program is a
                                             program with a zip appended; that zip is read too.
      .\scripts\dev\Check-Secrets.ps1 -Binary <Thornswood.exe>   a built program, byte by byte

  Exit 0 when nothing was found, 1 when something was, 2 when something could
  not be read. A 2 is not a pass.

  WHY IT EXISTS. Entry 236. Two secrets have shipped inside built artefacts, and
  neither was in the source, so nothing that only read the source could have
  seen them:
    - the installer carried Data\Platform\PluginsNoLoad\auth-data-no-load.js,
      the SkyMP client's saved sign in from the machine that built it (the
      header of Ship-Rules.ps1 tells it);
    - nine main packs from 18 to 20 September, and at least two dev packs
      beside them, carried Data\Platform\voice-token.txt, the voice join token
      of the machine that built them, because Ship-Rules did not list it yet.
  Ship-Rules lists both now. This is the check that does not wait for somebody
  to think of the file first: both names say what they are, and the token has
  a shape. In a pack it also asks Ship-Rules itself, so a file that the rules
  keep out and that got in anyway stops the release. Until #4824 it read the
  old installer's zip and staged folder (payload\) the same way; that
  installer went, and with it -Dir and -ClientRecord, the record of an older
  launcher's client that only its packing passed.

  The tree scan reads what git tracks and nothing else, so the credential files
  that sit gitignored on the shipping machine (the two webhook files,
  server-secret.txt, config.json) are never opened.

  AND WHAT ITS SUBMODULES TRACK (#1326). engine\skymp, the fork every server
  and client build is made from, is a submodule: git ls-files here lists it as
  one gitlink, which is not a file, so not one of its files was ever read.
  Each submodule that is checked out is now read the same way, by its own
  git ls-files, its paths reported and allowed under engine/skymp/. One that
  is not checked out is said by name, and -Submodules Require counts it as
  not read, so a run that fetched it first cannot pass without having read
  it. The fork's own submodules (vcpkg) are Microsoft's and other people's
  code, not the fork's, and are named and left.

  A known non-secret that a rule matches goes in Check-Secrets.allow.txt beside
  this script, by path and rule, with a line saying why it is safe. Never a real
  secret: a real one is taken out and replaced, not allowed.
#>
[CmdletBinding()]
param(
    # The repository to scan. Empty is the one this script is in.
    [string]$Root = '',
    # Packs and other zips. Entries under game/ (a pack) are also checked
    # against Ship-Rules.
    [string[]]$Zip = @(),
    # A built program, read byte by byte as text and as UTF-16.
    [string[]]$Binary = @(),
    # The allow list. Empty is Check-Secrets.allow.txt beside this script.
    [string]$Allow = '',
    # A submodule the tree scan finds not checked out (#1326): Say names it
    # and carries on; Require also counts it as not read, so the scan exits 2.
    [ValidateSet('Say', 'Require')][string]$Submodules = 'Say'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
# The six client runtime files are held to this checkout's
# records\client-build.json, as Ship-Rules loads it.
. (Join-Path $Here '..\release\Ship-Rules.ps1')

# ---------------------------------------------------------------- the rules
#
# By shape, over the text of a file. Each is one kind of credential this
# project holds or has held, or one that turns up in any repository by
# accident. The lookarounds keep a rule from firing on a longer run of the
# same characters, which is what random data and base64 look like.
$ContentRules = @(
    # The news and dev webhooks (bot). Anyone holding one can post
    # as the bot.
    @{ Name = 'discord-webhook';   Rx = '(?i)discord(?:app)?\.com/api/webhooks/[0-9]{15,22}/[A-Za-z0-9_-]{30,}' },
    # The bot's own token (bot.env.json on the VPS).
    @{ Name = 'discord-bot-token'; Rx = '(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_-])' },
    # The update token is a fine-grained personal access token; any other
    # GitHub token has one of these prefixes.
    @{ Name = 'github-token';      Rx = '(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})' },
    # The key that signs in to the VPS, or any other private key.
    @{ Name = 'private-key';       Rx = '-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----' },
    # A voice join token, the shape signToken in voice\voice-server.js
    # makes: v2.<profile id>.<minted, ms>.<22 character nonce>.<43 character
    # signature> since #1322, and before it v1.<profile id>.<expiry in
    # ms>.<43 character signature>, which is what nine published packs
    # carried in voice-token.txt.
    @{ Name = 'voice-join-token';  Rx = '(?<![A-Za-z0-9_.-])(?:v1\.[0-9]{1,12}\.[0-9]{12,14}\.[A-Za-z0-9_-]{43}|v2\.[0-9]{1,12}\.[0-9]{12,14}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])' },
    @{ Name = 'aws-access-key';    Rx = '(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])' },
    @{ Name = 'slack-token';       Rx = '(?<![A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}' },
    @{ Name = 'google-api-key';    Rx = '(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])' }
)

# The matching runs in this small compiled class and not in PowerShell, for a
# measured reason. PowerShell 7.6 on Patrick's machine is slow at handing a
# large string to a .NET method: one regex over the 6 MB recipes.json took
# 1.4 s that way and the whole tree took 41 s, where the -match operator over
# the same text took 0.03 s and Windows PowerShell 5.1 took 0.013 s for the
# same call. Here the bytes go in, and only a rule name and a position come
# back out. The value never reaches PowerShell at all, which is the other half
# of never printing it. C# 5, so the Framework csc that Windows PowerShell uses
# for Add-Type compiles it too.
if (-not ('ThornswoodSecretScan1' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

public static class ThornswoodSecretScan1
{
    static string[] names = new string[0];
    static Regex[] rules = new Regex[0];

    public static void SetRules(string[] ruleNames, string[] patterns)
    {
        names = ruleNames;
        rules = new Regex[patterns.Length];
        for (int i = 0; i < patterns.Length; i++)
            rules[i] = new Regex(patterns[i], RegexOptions.CultureInvariant | RegexOptions.Compiled);
    }

    // Null when the bytes are not text: a NUL in the first 8 KB with no UTF-16
    // byte order mark to explain it. Latin-1 otherwise, which maps every byte
    // to one character, so nothing fails to decode and every rule sees the
    // bytes as they are.
    static string Decode(byte[] b)
    {
        if (b.Length >= 2 && b[0] == 0xFF && b[1] == 0xFE) return Encoding.Unicode.GetString(b, 2, b.Length - 2);
        if (b.Length >= 2 && b[0] == 0xFE && b[1] == 0xFF) return Encoding.BigEndianUnicode.GetString(b, 2, b.Length - 2);
        int n = Math.Min(b.Length, 8192);
        if (n > 0 && Array.IndexOf(b, (byte)0, 0, n) >= 0) return null;
        return Encoding.GetEncoding(28591).GetString(b);
    }

    // "rule<TAB>line" for every hit, or null when the bytes are not text.
    public static string[] ScanText(byte[] b)
    {
        string text = Decode(b);
        if (text == null) return null;
        List<string> hits = new List<string>();
        for (int r = 0; r < rules.Length; r++)
        {
            int line = 1, at = 0;
            foreach (Match m in rules[r].Matches(text))
            {
                for (; at < m.Index; at++) if (text[at] == '\n') line++;
                hits.Add(names[r] + "\t" + line);
            }
        }
        return hits.ToArray();
    }

    // "rule<TAB>byte offset" for every hit in a program: the bytes as Latin-1,
    // then as UTF-16 at both alignments, because .NET keeps its string literals
    // as UTF-16 and an embedded file as it was.
    public static string[] ScanBinary(byte[] b)
    {
        List<string> hits = new List<string>();
        HashSet<string> seen = new HashSet<string>();
        Scan(Encoding.GetEncoding(28591).GetString(b), 1, 0, hits, seen);
        Scan(Encoding.Unicode.GetString(b, 0, b.Length - (b.Length % 2)), 2, 0, hits, seen);
        if (b.Length > 2)
        {
            int odd = b.Length - 1;
            Scan(Encoding.Unicode.GetString(b, 1, odd - (odd % 2)), 2, 1, hits, seen);
        }
        return hits.ToArray();
    }

    static void Scan(string text, int scale, int shift, List<string> hits, HashSet<string> seen)
    {
        for (int r = 0; r < rules.Length; r++)
        {
            foreach (Match m in rules[r].Matches(text))
            {
                string hit = names[r] + "\t" + (m.Index * (long)scale + shift);
                if (seen.Add(hit)) hits.Add(hit);
            }
        }
    }
}
'@
}
[ThornswoodSecretScan1]::SetRules([string[]]@($ContentRules | ForEach-Object { $_.Name }),
                                  [string[]]@($ContentRules | ForEach-Object { $_.Rx }))

# By name. Every one of these is gitignored or kept out by Ship-Rules, so
# finding one tracked or packed means a rule somewhere was missed.
$SecretNames = @(
    'backup-key.txt', 'thornswood-backup-key.txt', 'bot.env.json', '.env',
    'signing.json', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'
)
$SecretExts = @('.pfx', '.p12', '.pem', '.ppk')
# A word in the name that says what the file holds, standing on its own:
# server-secret.txt, news-webhook.txt, token-key.txt, and the two that shipped,
# voice-token.txt and auth-data-no-load.js. "Secrets.cs" and "UpdateToken" do
# not match, because the word has to stand alone.
$SecretWord = New-Object System.Text.RegularExpressions.Regex (
    '(^|[^a-z0-9])(token|secret|password|passwd|webhook|credentials?|auth-data)([^a-z0-9]|$)',
    [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, CultureInvariant')

# Never worth reading as text. Anything not on this list is read, and passed
# over as binary only when it has a NUL in its first 8 KB.
$BinaryExts = @(
    '.dds', '.nif', '.bsa', '.ba2', '.esp', '.esm', '.esl', '.hkx', '.wav', '.xwm',
    '.fuz', '.mp3', '.mp4', '.ogg', '.webm', '.bik', '.png', '.jpg', '.jpeg', '.gif',
    '.bmp', '.tga', '.ico', '.ttf', '.otf', '.woff', '.woff2', '.dll', '.exe', '.pex',
    '.swf', '.lip', '.tri', '.pdb', '.zip', '.7z', '.rar', '.gfx', '.egm', '.egt',
    '.btr', '.bto', '.lod', '.seq', '.pak', '.bin'
)
$TextCap = 100MB

# ---------------------------------------------------------------- allow list
$allowRules = @()
if (-not $Allow) { $Allow = Join-Path $Here 'Check-Secrets.allow.txt' }
if (Test-Path -LiteralPath $Allow) {
    foreach ($line in [IO.File]::ReadAllLines($Allow)) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $p = $t -split '\s+'
        if ($p.Count -lt 2) { continue }
        $allowRules += ,@($p[0], $p[1])
    }
}

$script:found = 0
$script:allowed = 0
$script:unread = 0
$script:read = 0

function Test-Allowed([string]$key, [string]$rule) {
    foreach ($a in $allowRules) {
        if ($rule -eq $a[1] -and $key -like $a[0]) { return $true }
    }
    return $false
}

# The one place a hit is written, so there is one place to check that it never
# carries the value: the file, the line or byte, the rule. Nothing else.
function Write-Hit([string]$where, [string]$key, [string]$line, [string]$rule, [bool]$isByte) {
    if (Test-Allowed $key $rule) { $script:allowed++; return }
    $script:found++
    if ($env:GITHUB_ACTIONS -eq 'true') {
        if ($isByte) { Write-Host ('::error file={0}::{1} at byte {2}' -f $where, $rule, $line) }
        else { Write-Host ('::error file={0},line={1}::{2}' -f $where, $line, $rule) }
    } else {
        if ($isByte) { Write-Host ('  {0} at byte {1}  {2}' -f $where, $line, $rule) -ForegroundColor Red }
        else { Write-Host ('  {0}:{1}  {2}' -f $where, $line, $rule) -ForegroundColor Red }
    }
}

function Write-Unread([string]$where, [string]$why) {
    $script:unread++
    Write-Host ('  could not read {0}: {1}' -f $where, $why) -ForegroundColor Yellow
}

# ---------------------------------------------------------------- checks
function Test-Name([string]$where, [string]$key, [string]$leaf, [bool]$tree) {
    $ext = [IO.Path]::GetExtension($leaf).ToLowerInvariant()
    $hit = $false
    foreach ($n in $SecretNames) { if ($leaf -ieq $n) { $hit = $true } }
    if ($leaf -like '*.env') { $hit = $true }
    if ($SecretExts -contains $ext) { $hit = $true }
    if ($SecretWord.IsMatch($leaf)) { $hit = $true }
    # The launcher's config.json holds the server address and the update
    # token. A download may carry one on purpose (the setup's config.json, the
    # channel's server and site), so this is the tree only.
    if ($tree -and $leaf -ieq 'config.json') { $hit = $true }
    if ($hit) { Write-Hit $where $key '0' 'credential-file-name' $false }
}

# Whether a zip entry at one of the six client runtime paths is the recorded
# build, by its own bytes.
function Test-ClientBytes([string]$rel, $source) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $s = $source.Open()
        try { $have = ([BitConverter]::ToString($sha.ComputeHash($s))).Replace('-', '').ToLowerInvariant() }
        finally { $s.Dispose() }
    }
    finally { $sha.Dispose() }
    return ($have -eq $ShipClientHashes[$rel])
}

# A path inside a pack (game/...), asked of Ship-Rules the same way
# Publish-Update asks it before it packs a file. Anything it says never ships and that is here anyway is
# the failure this whole script is for.
#
# The six client runtime files are asked by the bytes in hand, not through
# Test-ShipMachine (entry 128). Ship-Rules calls one of them ours only when its
# sha256 is the recorded build, and given just a path it hashes the file under
# the caller's $GameDir. Here that is the wrong file: the game folder a pack
# was built from, not the zip being read. Measured 24 September on scratch
# copies of the real bundle: run on its own, with no $GameDir, this failed a
# pack and the old installer's stage that carried the recorded build as never-ship;
# called with & from a script that had one, the way Publish-Update calls it, it
# passed a pack whose bundle had one byte changed.
function Test-ShipPath([string]$where, [string]$key, [string]$inner, $source) {
    $m = [regex]::Match($inner, '^game[/\\](.+)$', 'IgnoreCase')
    if (-not $m.Success) { return }
    $rel = $m.Groups[1].Value -replace '/', '\'
    if (Test-ShipRuntime $rel) { Write-Hit $where $key '0' 'never-ship-runtime' $false; return }
    if ($ShipClientFiles.Contains($rel)) {
        if (-not (Test-ClientBytes $rel $source)) { Write-Hit $where $key '0' 'client-not-recorded-build' $false }
        return
    }
    # Bethesda's game, its Creation Kit or a copy of one of its programs, and
    # backups (#1152): named apart from the machine's own files, because they
    # are never ours to give. The same question the record guard and the
    # rollback filter ask (Test-ShipBethesda, #1229).
    if (Test-ShipBethesda $rel) { Write-Hit $where $key '0' 'never-ship-bethesda' $false; return }
    if (Test-ShipBackup $rel) { Write-Hit $where $key '0' 'never-ship-backup' $false; return }
    # One machine's own by kind (#1239): its runtime state and tokens in
    # Data\Platform, logs, Vortex's records, window layouts, settings saved from
    # a mod's menu, saves. The question the record guard, the rollback filter
    # and Scrub-Feed ask. Other servers' files and other people's frameworks
    # are the rest of Test-ShipMachine.
    if ((Test-ShipOneMachine $rel) -or (Test-ShipMachine $rel)) { Write-Hit $where $key '0' 'never-ship-machine' $false; return }
    # Another author's loose file (#1178). What waits for the collection is
    # not asked here: Ship-Rules holds it as ours until the revision that adds
    # its mod.
    if (Test-ShipNotOurs $rel) { Write-Hit $where $key '0' 'never-ship-not-ours' $false; return }
}

function Test-TextBytes([string]$where, [string]$key, [byte[]]$b) {
    $hits = [ThornswoodSecretScan1]::ScanText($b)
    if ($null -eq $hits) { return }
    $script:read++
    foreach ($h in $hits) {
        $p = $h -split "`t"
        Write-Hit $where $key $p[1] $p[0] $false
    }
}

function Test-Bytes([string]$where, [string]$key, [byte[]]$b) {
    foreach ($h in [ThornswoodSecretScan1]::ScanBinary($b)) {
        $p = $h -split "`t"
        Write-Hit $where $key $p[1] $p[0] $true
    }
}

function Read-Entry($entry) {
    $ms = New-Object IO.MemoryStream
    $s = $entry.Open()
    try { $s.CopyTo($ms) } finally { $s.Dispose() }
    return ,$ms.ToArray()
}

# ---------------------------------------------------------------- modes
# git in $dir, its output as lines, and whether it answered 0.
function Invoke-GitLines([string]$dir, [string[]]$argv) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $lines = @(& git -C $dir -c core.quotepath=off @argv 2>$null); $rc = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Ok = ($rc -eq 0); Lines = @($lines | Where-Object { $_ }) }
}

# The submodules a repository tracks: the paths git lists with mode 160000,
# and the commit each is pinned to.
function Get-Gitlinks([string]$dir) {
    $out = @()
    foreach ($l in (Invoke-GitLines $dir @('ls-files', '-s')).Lines) {
        $m = [regex]::Match($l, '^160000 ([0-9a-f]{40}) \d+\t(.+)$')
        if ($m.Success) { $out += [pscustomobject]@{ Path = $m.Groups[2].Value; Pin = $m.Groups[1].Value } }
    }
    return $out
}

# Every file in $files, under $dir, reported as $prefix plus its path.
function Test-TreeFiles([string]$dir, [string]$prefix, [string[]]$files, [string[]]$skip) {
    foreach ($f in $files) {
        if (-not $f -or $skip -contains $f) { continue }
        $rel = $prefix + $f
        Test-Name $rel $rel (Split-Path $f -Leaf) $true
        $full = Join-Path $dir $f
        # Tracked but deleted in this working copy: nothing to read.
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $ext = [IO.Path]::GetExtension($f).ToLowerInvariant()
        if ($BinaryExts -contains $ext) { continue }
        $len = (Get-Item -LiteralPath $full -Force).Length
        if ($len -gt $TextCap) { Write-Unread $rel 'larger than the text cap'; continue }
        Test-TextBytes $rel $rel ([IO.File]::ReadAllBytes($full))
    }
}

# One submodule of the tree (#1326): read the way the tree is, when it is
# checked out, and named when it is not.
function Invoke-Submodule([string]$root, $link) {
    $full = Join-Path $root $link.Path
    $short = $link.Pin.Substring(0, 12)
    # Checked out means a repository of its own at that path: git there is at
    # the top of its tree. An empty folder there answers git with this
    # repository, from a folder below its top, and is not.
    $isOwn = $false
    if (Test-Path -LiteralPath $full -PathType Container) {
        $pre = Invoke-GitLines $full @('rev-parse', '--show-prefix')
        $isOwn = $pre.Ok -and $pre.Lines.Count -eq 0
    }
    if (-not $isOwn) {
        $why = 'it is not checked out here, so none of its files were read. git submodule update --init --depth 1 ' + $link.Path + ' fetches it at ' + $short
        if ($Submodules -eq 'Require') { Write-Unread $link.Path $why; return }
        if ($env:GITHUB_ACTIONS -eq 'true') { Write-Host ('::notice file=.gitmodules::{0}: {1}' -f $link.Path, $why) }
        else { Write-Host ('  {0}: {1}' -f $link.Path, $why) -ForegroundColor Yellow }
        return
    }
    $list = Invoke-GitLines $full @('ls-files')
    if (-not $list.Ok -or -not $list.Lines.Count) { Write-Unread $link.Path 'git ls-files gave no list of its tracked files'; return }
    $head = (Invoke-GitLines $full @('rev-parse', 'HEAD')).Lines
    $at = if ($head.Count) { [string]$head[0] } else { '' }
    if ($at -and $at -ne $link.Pin) {
        Write-Host ('  {0} is checked out at {1}, not at {2}, the commit this repository pins; what is checked out is what was read' -f $link.Path, $at.Substring(0, 12), $short) -ForegroundColor Yellow
    }
    $nested = @(Get-Gitlinks $full)
    $before = $script:read
    Test-TreeFiles $full ($link.Path + '/') $list.Lines @($nested | ForEach-Object { $_.Path })
    Write-Host ('  {0}: {1} tracked files at {2}, {3} read as text' -f $link.Path, $list.Lines.Count, $(if ($at) { $at.Substring(0, 12) } else { $short }), ($script:read - $before))
    if ($nested.Count) {
        Write-Host ('  {0}: its own submodules are other people''s code and were not read: {1}' -f $link.Path, (($nested | ForEach-Object { $_.Path }) -join ', ')) -ForegroundColor DarkGray
    }
}

function Invoke-Tree([string]$root) {
    if (-not $root) { $root = Split-Path -Parent (Split-Path -Parent $Here) }
    $list = Invoke-GitLines $root @('ls-files')
    $files = $list.Lines
    if (-not $list.Ok -or -not $files.Count) { Write-Unread $root 'git ls-files gave no list of tracked files'; return }
    $links = @(Get-Gitlinks $root)
    Test-TreeFiles $root '' $files @($links | ForEach-Object { $_.Path })
    Write-Host ('  {0} tracked files, {1} read as text' -f $files.Count, $script:read)
    foreach ($l in $links) { Invoke-Submodule $root $l }
}

# .NET ZipFile.OpenRead does not read a zip concatenated onto a program.
# A Setup program can be that shape (the old installer's was): the program
# first, then the zip, and the zip own
# offsets count from the zip, not from the first byte of the file. Asked for
# the central directory, Windows PowerShell throws because the entry count
# does not match, and PowerShell 7 does not throw at all: Entries is empty,
# every rule is skipped, and the scan says the file is clean. Python zipfile
# finds the end-of-central-directory record at the end of the file and
# corrects for the bytes in front. This does the same correction and reads
# that zip. A real empty zip has no local-file header, so it still reports no
# entries. A file that claims to be empty and still holds one is not a pass.

if (-not ('ThornswoodZipWindow' -as [type])) {
    # A view of the bytes from the zip start to the end, so ZipArchive can read
    # a zip whose offsets count from there. C# 5, for the Framework compiler too.
    Add-Type -Language CSharp -TypeDefinition @'

using System;
using System.IO;

public class ThornswoodZipWindow : Stream {
    Stream inner;
    long start;
    long length;

    public ThornswoodZipWindow(Stream inner, long start) {
        this.inner = inner;
        this.start = start;
        this.length = inner.Length - start;
        if (this.length < 0) throw new ArgumentOutOfRangeException("start");
        inner.Seek(start, SeekOrigin.Begin);
    }

    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }
    public override long Position {
        get { return inner.Position - start; }
        set {
            if (value < 0) throw new IOException("negative position");
            inner.Position = start + value;
        }
    }

    public override void Flush() { }

    public override int Read(byte[] buffer, int offset, int count) {
        long remain = length - Position;
        if (remain <= 0) return 0;
        if (count > remain) count = (int)remain;
        return inner.Read(buffer, offset, count);
    }

    public override long Seek(long offset, SeekOrigin origin) {
        long pos;
        if (origin == SeekOrigin.Begin) pos = offset;
        else if (origin == SeekOrigin.Current) pos = Position + offset;
        else pos = length + offset;
        Position = pos;
        return pos;
    }

    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }

    protected override void Dispose(bool disposing) {
        if (disposing && inner != null) {
            inner.Dispose();
            inner = null;
        }
        base.Dispose(disposing);
    }
}
'@
}

# Where a concatenated zip starts, or 0 when the zip is the whole file, or -1
# when there is no end-of-central-directory record we can trust. The record
# sits at the end, with its comment reaching the last byte. Its offset of the
# central directory counts from the zip, so the program in front is the
# distance between that and where the record actually is.
function Find-AppendedZipStart([string]$full) {
    $fs = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $len = $fs.Length
        if ($len -lt 22) { return -1 }
        $want = [Math]::Min($len, [int64](65535 + 22))
        $buf = New-Object byte[] ([int]$want)
        [void]$fs.Seek($len - $want, [IO.SeekOrigin]::Begin)
        $n = $fs.Read($buf, 0, $buf.Length)
        for ($i = $n - 22; $i -ge 0; $i--) {
            if ($buf[$i] -ne 80 -or $buf[$i + 1] -ne 75 -or $buf[$i + 2] -ne 5 -or $buf[$i + 3] -ne 6) { continue }
            $comment = [int][BitConverter]::ToUInt16($buf, $i + 20)
            if (($i + 22 + $comment) -ne $n) { continue }
            $eocdPos = ($len - $n) + $i
            $cdSize = [int64]0
            $cdOff = [int64]0
            $extra = [int64]0
            $zip64 = Get-Zip64CentralDirectory $fs $eocdPos
            if ($zip64) {
                $cdSize = $zip64.Size
                $cdOff = $zip64.Offset
                $extra = $zip64.Extra
            } else {
                $cdSize = [int64][BitConverter]::ToUInt32($buf, $i + 12)
                $cdOff = [int64][BitConverter]::ToUInt32($buf, $i + 16)
                $entries = [int][BitConverter]::ToUInt16($buf, $i + 10)
                if ($cdOff -eq 4294967295 -or $cdSize -eq 4294967295 -or $entries -eq 65535) { continue }
            }
            $prefix = $eocdPos - $cdSize - $cdOff - $extra
            if ($prefix -lt 0 -or ($prefix + $cdOff) -ge $len) { continue }
            if ($prefix -eq 0) { return 0 }
            if (Test-CentralDirectoryAt $fs ($prefix + $cdOff)) { return $prefix }
        }
        return -1
    } finally { $fs.Dispose() }
}

# Zip64 puts the real sizes in a record just before the locator, which sits
# 20 bytes before the end-of-central-directory record. Null when this archive
# is not zip64. The extra is those two blocks, which sit between the central
# directory and the record at the end, so they count in the prefix too.
function Get-Zip64CentralDirectory([IO.FileStream]$fs, [int64]$eocdPos) {
    if ($eocdPos -lt 20) { return $null }
    $loc = New-Object byte[] 20
    [void]$fs.Seek(($eocdPos - 20), [IO.SeekOrigin]::Begin)
    if ($fs.Read($loc, 0, 20) -ne 20) { return $null }
    if ($loc[0] -ne 80 -or $loc[1] -ne 75 -or $loc[2] -ne 6 -or $loc[3] -ne 7) { return $null }
    $back = [Math]::Min([int64]1024, ($eocdPos - 20))
    $win = New-Object byte[] ([int]$back)
    $winStart = $eocdPos - 20 - $back
    [void]$fs.Seek($winStart, [IO.SeekOrigin]::Begin)
    if ($fs.Read($win, 0, $win.Length) -ne $win.Length) { return $null }
    for ($j = $win.Length - 56; $j -ge 0; $j--) {
        if ($win[$j] -ne 80 -or $win[$j + 1] -ne 75 -or $win[$j + 2] -ne 6 -or $win[$j + 3] -ne 6) { continue }
        $sizeField = [BitConverter]::ToUInt64($win, $j + 4)
        if ($sizeField -gt 1000000) { continue }
        $recordLen = [int64]12 + [int64]$sizeField
        $recordPos = $winStart + $j
        if (($recordPos + $recordLen) -ne ($eocdPos - 20)) { continue }
        if (($j + 56) -gt $win.Length) { continue }
        $cdSize = [BitConverter]::ToUInt64($win, $j + 40)
        $cdOff = [BitConverter]::ToUInt64($win, $j + 48)
        $limit = [uint64]9223372036854775807
        if ($cdSize -gt $limit -or $cdOff -gt $limit) { continue }
        return @{ Size = [int64]$cdSize; Offset = [int64]$cdOff; Extra = ($recordLen + 20) }
    }
    return $null
}

function Test-CentralDirectoryAt([IO.FileStream]$fs, [int64]$pos) {
    if ($pos -lt 0 -or ($pos + 4) -gt $fs.Length) { return $false }
    [void]$fs.Seek($pos, [IO.SeekOrigin]::Begin)
    $sig = New-Object byte[] 4
    if ($fs.Read($sig, 0, 4) -ne 4) { return $false }
    return ($sig[0] -eq 80 -and $sig[1] -eq 75 -and $sig[2] -eq 1 -and $sig[3] -eq 2)
}

# A local-file header is an entry. An empty zip does not have one. Used only
# when the archive reported no entries, so a miss here is the false pass.
function Test-LocalFileHeader([string]$full) {
    $fs = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $buf = New-Object byte[] 65536
        $hold = New-Object byte[] 3
        $held = 0
        while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
            $scan = New-Object byte[] ($held + $n)
            if ($held -gt 0) { [Array]::Copy($hold, $scan, $held) }
            [Array]::Copy($buf, 0, $scan, $held, $n)
            for ($i = 0; $i -le $scan.Length - 4; $i++) {
                if ($scan[$i] -eq 80 -and $scan[$i + 1] -eq 75 -and $scan[$i + 2] -eq 3 -and $scan[$i + 3] -eq 4) { return $true }
            }
            $held = [Math]::Min(3, $scan.Length)
            [Array]::Copy($scan, ($scan.Length - $held), $hold, 0, $held)
        }
        return $false
    } finally { $fs.Dispose() }
}

function Open-ScanZip([string]$full, [int64]$start) {
    $fs = $null
    $window = $null
    try {
        $fs = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $base = $fs
        if ($start -gt 0) {
            $window = [ThornswoodZipWindow]::new($fs, $start)
            $base = $window
        }
        $opened = [IO.Compression.ZipArchive]::new($base, [IO.Compression.ZipArchiveMode]::Read, $true)
        return @{ Zip = $opened; Stream = $base }
    } catch {
        if ($window) { $window.Dispose() }
        elseif ($fs) { $fs.Dispose() }
        throw
    }
}

function Invoke-Zip([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Write-Unread $path 'no such file'; return }
    $leaf = Split-Path $path -Leaf
    $full = (Resolve-Path -LiteralPath $path).ProviderPath
    $opened = $null
    try {
        $bad = $true
        try {
            $opened = Open-ScanZip $full 0
            try { $bad = ($opened.Zip.Entries.Count -eq 0) }
            catch { $bad = $true }
        } catch {
            $opened = $null
            $bad = $true
        }
        if ($bad) {
            $start = Find-AppendedZipStart $full
            if ($start -gt 0) {
                if ($opened) {
                    $opened.Zip.Dispose()
                    $opened.Stream.Dispose()
                    $opened = $null
                }
                try { $opened = Open-ScanZip $full $start }
                catch { Write-Unread $leaf 'the zip appended to this program could not be opened'; return }
                try { $appended = $opened.Zip.Entries.Count }
                catch { Write-Unread $leaf 'the zip appended to this program could not be read'; return }
                if ($appended -eq 0) { Write-Unread $leaf 'the zip appended to this program could not be read'; return }
            } elseif (-not $opened) {
                Write-Unread $leaf 'it does not open as a zip'
                return
            } elseif (Test-LocalFileHeader $full) {
                Write-Unread $leaf 'it reports no zip entries but still holds a zip'
                return
            }
        }
        $z = $opened.Zip
        $n = 0
        foreach ($e in $z.Entries) {
            $inner = $e.FullName -replace '\\', '/'
            if ($inner.EndsWith('/')) { continue }
            $n++
            $where = $leaf + '!' + $inner
            $name = Split-Path $inner -Leaf
            Test-Name $where $inner $name $false
            Test-ShipPath $where $inner $inner $e
            $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
            # A program at the top of a zip is one built here (the old
            # installer carried the launcher there), so it is read byte by
            # byte. Every other program is somebody's mod.
            if ($ext -eq '.exe' -and $inner.IndexOf('/') -lt 0) {
                if ($e.Length -gt $TextCap) { Write-Unread $where 'larger than the text cap'; continue }
                Test-Bytes $where $inner (Read-Entry $e)
                continue
            }
            if ($BinaryExts -contains $ext) { continue }
            if ($e.Length -gt $TextCap) { Write-Unread $where 'larger than the text cap'; continue }
            Test-TextBytes $where $inner (Read-Entry $e)
        }
        Write-Host ('  {0}: {1} entries' -f $leaf, $n)
    } finally {
        if ($opened) {
            $opened.Zip.Dispose()
            $opened.Stream.Dispose()
        }
    }
}

function Invoke-Binary([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Write-Unread $path 'no such file'; return }
    $leaf = Split-Path $path -Leaf
    Test-Bytes $path $leaf ([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $path).ProviderPath))
    Write-Host ('  {0}: read byte by byte' -f $leaf)
}

try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $any = $false
    foreach ($z in $Zip) { if ($z) { $any = $true; Invoke-Zip $z } }
    foreach ($b in $Binary) { if ($b) { $any = $true; Invoke-Binary $b } }
    if (-not $any) { Invoke-Tree $Root }
} catch {
    # The message only, which says what failed and not what a file held.
    Write-Unread 'the scan' $_.Exception.Message
}

if ($script:allowed) { Write-Host ('  {0} known non-secret(s) passed by Check-Secrets.allow.txt' -f $script:allowed) -ForegroundColor DarkGray }
if ($script:found) {
    Write-Host ('{0} thing(s) that must never ship. Each line above names the file and the rule, never the value.' -f $script:found) -ForegroundColor Red
    exit 1
}
if ($script:unread) {
    Write-Host ('Nothing found, but {0} thing(s) could not be read, so this is not a pass.' -f $script:unread) -ForegroundColor Yellow
    exit 2
}
Write-Host 'No secrets found.' -ForegroundColor Green
exit 0
