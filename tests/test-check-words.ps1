<#
  test-check-words.ps1

  The writing rules in CONTRIBUTING.md are checked, and the check itself works.

  WHY THIS EXISTS. Entry 237 on the To Do List, issue #460: "The repo's own
  writing rules are written down and nothing enforces them." MEASURED 24
  SEPTEMBER, before scripts\dev\Check-Words.ps1 existed: eleven hits in the
  files people read. MEASURED 29 SEPTEMBER, when the check still read only ten
  named files: a person's name in the installer setup README had held
  test-component-readmes.js red on main for a day (#1034, #1040, #1061) with
  this build green, because only the nightly run read component READMEs, and
  the word the rules ban sat in a README, the script index and the site's
  gallery page, which nothing read at all. So the check now reads every
  Markdown file and every public page, and this proves every rule in it.

  And one trap measured while writing the check. The first draft spelled the
  em dash as a regex escape; the tool that wrote the file turned the escape
  into the character itself, and Windows PowerShell 5.1, which reads a script
  with no byte order mark as ANSI, then found none of the six em dashes that
  were there, while PowerShell 7 found all of them. So this ran the check
  under both and asked for the same answer, until #5356: nothing runs it
  under 5.1 now. The check's own source is still held to plain ASCII below.

  What it proves:
    - the repository as it stands passes;
    - every rule (em-dash, banned-word, old-owner, open-alpha, placeholder,
      names-person) reports a break planted for it at its own file and line,
      and every hit names the file, the line and the rule;
    - nothing that is allowed is reported (multiplayer, playtest, getPlayer,
      an en dash, the certificate's name, a gavin/ branch, a repository link),
      nor anything in lore\, docs\archive\ or a code file;
    - an allowance covers exactly its line; one that matches nothing, names a
      rule that is not there or is missing a part is itself a hit;
    - in a checkout, only the files git tracks are read;
    - the check exits 1 on a hit and 0 when clean, and writes nothing;
    - its own source is plain ASCII, so no editor can change what it matches.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$CheckPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $CheckPath) { $CheckPath = Join-Path (Split-Path -Parent $Here) 'scripts\dev\Check-Words.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

Yes 'scripts\dev\Check-Words.ps1 exists' (Test-Path -LiteralPath $CheckPath)
if (-not (Test-Path -LiteralPath $CheckPath)) { Done }

$bytes = [System.IO.File]::ReadAllBytes($CheckPath)
$high = @($bytes | Where-Object { $_ -gt 127 }).Count
Yes ("the check's own source is plain ASCII, so its encoding cannot change what it matches ({0} byte(s) above 127)" -f $high) ($high -eq 0)

# Run the check in a fresh process, the way the build step and a person run
# it, and hand back its exit code, its hits as file:line:rule, and its output.
function Invoke-Check([string]$exe, [string]$root) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $CheckPath)
    if ($root) { $a += @('-Root', $root) }
    $out = @(& $exe @a 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $errs = @($out | Where-Object { $_ -like '::error*' })
    $hits = @($errs | ForEach-Object {
        $m = [regex]::Match($_, '^::error file=([^,]+),line=(\d+)::\[([a-z-]+)\] \S')
        if ($m.Success) { $m.Groups[1].Value + ':' + $m.Groups[2].Value + ':' + $m.Groups[3].Value }
    } | Sort-Object)
    return @{ Code = $code; Hits = $hits; Out = $out; Errors = $errs }
}

$self = (Get-Process -Id $PID).Path

# ---- the repository itself ------------------------------------------------
$r = Invoke-Check $self $null
foreach ($h in $r.Hits) { Write-Host ("      " + $h) }
Yes ('the repository keeps the writing rules: no hits, exit 0 (exit ' + $r.Code + ', ' + $r.Hits.Count + ' hit(s))') ($r.Code -eq 0 -and $r.Hits.Count -eq 0)
$readCount = 0
foreach ($l in $r.Out) { $m = [regex]::Match($l, 'hold in all (\d+) file'); if ($m.Success) { $readCount = [int]$m.Groups[1].Value } }
Yes ("it reads every Markdown file and public page, not ten named files ($readCount read)") ($readCount -ge 40)

# ---- the name on the signing certificate (#1052) ----------------------------
#
# It is written once, ExpectedSigner in launcher\app\Updater.cs, which the
# launcher checks every update against. Every page says "the name on the
# signing certificate" or names the profile, ThornswoodRelease, and the tests
# and scripts that need the name read it from there. Only the dated snapshots
# in docs\archive are left as they were.
$repoRoot = Split-Path -Parent $CheckPath | Split-Path -Parent | Split-Path -Parent
$updater = Join-Path $repoRoot 'launcher\app\Updater.cs'
$signer = [regex]::Match([System.IO.File]::ReadAllText($updater), 'const string ExpectedSigner = "([^"]+)"').Groups[1].Value
Yes 'ExpectedSigner is read from launcher\app\Updater.cs' ([bool]$signer)
if ($signer -and (Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
    # Text files only (-I): a file signed with ThornswoodRelease, such as
    # tests\fixtures\2163-manifest\release.cat, carries the name inside its
    # certificate, and that is the signature, not anybody writing the name.
    $named = @(& git -C $repoRoot grep -l -I -i -F -e $signer -- . ':!docs/archive' 2>$null | ForEach-Object { "$_" })
    foreach ($n in $named) { Write-Host ("      " + $n) }
    Yes ('the name on the signing certificate is in Updater.cs and in no other file git holds, docs\archive apart (' + $named.Count + ' file(s))') (
        $named.Count -eq 1 -and $named[0] -eq 'launcher/app/Updater.cs')
}

# ---- a seeded tree ----------------------------------------------------------
#
# Built from code points, never typed, for the same reason the check is.
$em = [string][char]0x2014
$en = [string][char]0x2013
$utf8 = New-Object System.Text.UTF8Encoding($false)
$utf8bom = New-Object System.Text.UTF8Encoding($true)

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('ts-check-words-' + [guid]::NewGuid().ToString('N'))
$git = Join-Path ([System.IO.Path]::GetTempPath()) ('ts-check-words-git-' + [guid]::NewGuid().ToString('N'))
function Put([string]$base, [string]$rel, [string[]]$lines, $enc) {
    $full = Join-Path $base $rel
    $dir = Split-Path -Parent $full
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if (-not $enc) { $enc = $utf8 }
    [System.IO.File]::WriteAllText($full, (($lines -join "`r`n") + "`r`n"), $enc)
}

try {
    Put $tmp 'README.md' @(
        '# Seeded',
        ('Co-op for five' + $em + 'people.'),
        'Every Player gets a horse.',
        "The players' horses are shared.",
        'A multiplayer engine, a playtest, getPlayer() and PlayerCharacter.',
        ('Pages 1' + $en + '5 and a well-known name, both fine.'),
        'Ask gavin about it.',
        'Ask Patrick in the Discord.',
        'Clone https://github.com/ThornswoodRP/Thornswood to start.'
    )
    Put $tmp 'SECURITY.md' @('Fine.', 'An entity &mdash; here.', 'A number &#8212; here.', 'A hex one &#x2014; here.',
        'Signed as Ada  Signer; the oldest branches use the gavin/ prefix.', 'Patrick holds the key, and this page may say so.',
        'Signed as the name on the signing certificate, profile ThornswoodRelease.', 'An Ada Signerton is someone else.')
    # The name on the signing certificate is read from Updater.cs (#1052), so
    # the tree carries a stand-in one and the pages name it.
    Put $tmp 'launcher/app/Updater.cs' @('        public const string ExpectedSigner = "Ada Signer";')
    Put $tmp 'CONTRIBUTING.md' @('Never "player".', 'And a player here is not the rule.')
    # With a byte order mark, which the check has to read through.
    Put $tmp 'launcher/app/MainWindow.axaml' @('<TextBlock x:Name="PlayerList" Text="the multiplayer client"/>', ('<TextBlock Text="one' + $em + 'two"/>')) $utf8bom
    Put $tmp 'bot/content.py' @('WELCOME = """', 'Nothing wrong here.', 'TODO say hello', '"""')
    Put $tmp 'site/data/site/a.md' @('Fine.', ('Not' + $em + 'fine.'))
    Put $tmp 'site/data/site/b.md' @('Fine, with a hyphen - and nothing else.', 'The todo list and the To Do board.')
    # board.json holds the hub's boards, which the site shows.
    Put $tmp 'site/data/board.json' @('{ "active": { "intro": "Fine.",', '  "sections": [ { "note": "a player save" } ] } }')
    Put $tmp 'site/data/help.md' @('Fine.', 'Lorem ipsum dolor sit amet.')
    Put $tmp 'site/public/home.html' @('<html>', '<body>', '<p>one &mdash; two</p>', '</body>', '</html>')
    Put $tmp 'site/public/index.html' @('<p>Players Report; only staff Accept.</p>')
    # #428: the world is open by application, so a closed playtest is a hit,
    # in either spelling, while a plain playtest and the role stay allowed.
    Put $tmp 'site/data/site/c.md' @('A server in alpha.', 'Still a Closed Playtest here.', 'An alpha playtester, and a playtest.', 'A closed-playtest one.')
    Put $tmp 'installer/README.md' @('# Setup', 'Decided by Djinn on 28 Sep.', 'Decided on 28 Sep.')
    Put $tmp 'docs/NEW.md' @('FIXME later.')
    # Not read: in-world writing, dated snapshots, and code.
    Put $tmp 'lore/tale.md' @(('The player' + $em + 'a hero.'))
    Put $tmp 'docs/archive/old.md' @(('Old' + $em + 'as it was.'))
    Put $tmp 'game/gamemode.js' @('const player = ctx.sp.Game.getPlayer(); // TODO')
    Put $tmp 'scripts/dev/Check-Words.allow.txt' @(
        '# seeded allowances',
        'CONTRIBUTING.md | banned-word | the rule names its word | Never "player".',
        'docs/GONE.md | em-dash | stale on purpose | nothing here',
        'README.md | no-such-rule | a rule that is not there | anything',
        'README.md | em-dash | only three'
    )

    $want = @(
        'README.md:2:em-dash', 'README.md:3:banned-word', 'README.md:4:banned-word', 'README.md:7:old-owner', 'README.md:8:names-person',
        'SECURITY.md:2:em-dash', 'SECURITY.md:3:em-dash', 'SECURITY.md:4:em-dash', 'SECURITY.md:5:signer-name',
        'CONTRIBUTING.md:2:banned-word',
        'launcher/app/MainWindow.axaml:2:em-dash',
        'bot/content.py:3:placeholder',
        'site/data/site/a.md:2:em-dash',
        'site/data/board.json:2:banned-word',
        'site/data/help.md:2:placeholder',
        'site/public/home.html:3:em-dash',
        'site/public/index.html:1:banned-word',
        'site/data/site/c.md:2:open-alpha', 'site/data/site/c.md:4:open-alpha',
        'installer/README.md:2:names-person',
        'docs/NEW.md:1:placeholder',
        'scripts/dev/Check-Words.allow.txt:3:allow', 'scripts/dev/Check-Words.allow.txt:4:allow', 'scripts/dev/Check-Words.allow.txt:5:allow'
    ) | Sort-Object

    $before = @{}
    foreach ($f in (Get-ChildItem -Path $tmp -Recurse -File)) { $before[$f.FullName] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash }

    $s = Invoke-Check $self $tmp
    $missing = @($want | Where-Object { $s.Hits -notcontains $_ })
    $extra = @($s.Hits | Where-Object { $want -notcontains $_ })
    foreach ($m in $missing) { Write-Host ("      not reported: " + $m) }
    foreach ($x in $extra) { Write-Host ("      reported but allowed: " + $x) }
    Yes ('every seeded break is reported at its own file, line and rule (' + $want.Count + ' wanted, ' + $s.Hits.Count + ' reported)') ($missing.Count -eq 0)
    Yes 'nothing allowed is reported: multiplayer, playtest, getPlayer, an en dash, a gavin/ branch, a longer name, a repository link, lore, the archive, code' ($extra.Count -eq 0)
    Yes ('every hit names the file, the line and the rule (' + $s.Errors.Count + ' error line(s), ' + $s.Hits.Count + ' in that shape)') ($s.Errors.Count -eq $s.Hits.Count)
    foreach ($rule in 'em-dash', 'banned-word', 'old-owner', 'open-alpha', 'placeholder', 'names-person', 'signer-name') {
        $caught = @($s.Hits | Where-Object { $_ -like ('*:' + $rule) }).Count
        $planted = @($want | Where-Object { $_ -like ('*:' + $rule) }).Count
        Yes ("rule $rule catches every break planted for it ($caught of $planted)") ($planted -gt 0 -and $caught -eq $planted)
    }
    Yes ('a hit exits 1 (exit ' + $s.Code + ')') ($s.Code -eq 1)
    Yes 'a file with a byte order mark is read through it' ($s.Hits -contains 'launcher/app/MainWindow.axaml:2:em-dash')
    Yes 'any Markdown file is read, not only named ones (docs/NEW.md)' ($s.Hits -contains 'docs/NEW.md:1:placeholder')
    Yes 'a public page other than home is read (site index.html)' ($s.Hits -contains 'site/public/index.html:1:banned-word')
    Yes 'lore, the archive and code files are not read' (@($s.Hits | Where-Object { $_ -like 'lore/*' -or $_ -like 'docs/archive/*' -or $_ -like 'game/*' }).Count -eq 0)
    Yes 'a name is a hit in a component README and README.md, and not on other pages (SECURITY.md:6)' (($s.Hits -contains 'installer/README.md:2:names-person') -and ($s.Hits -contains 'README.md:8:names-person') -and ($s.Hits -notcontains 'SECURITY.md:6:names-person'))
    Yes 'closed playtest is a hit in any case, space or hyphen, an alpha playtester is not (#428)' (($s.Hits -contains 'site/data/site/c.md:2:open-alpha') -and ($s.Hits -contains 'site/data/site/c.md:4:open-alpha') -and ($s.Hits -notcontains 'site/data/site/c.md:3:open-alpha'))
    Yes 'an allowance covers its own line and not another in the same file' (($s.Hits -notcontains 'CONTRIBUTING.md:1:banned-word') -and ($s.Hits -contains 'CONTRIBUTING.md:2:banned-word'))
    Yes 'a stale allowance, an unknown rule and a missing part are each a hit on the allow file' (@($s.Hits | Where-Object { $_ -like 'scripts/dev/Check-Words.allow.txt:*' }).Count -eq 3)

    $after = @{}
    foreach ($f in (Get-ChildItem -Path $tmp -Recurse -File)) { $after[$f.FullName] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash }
    $same = ($before.Count -eq $after.Count)
    foreach ($k in $before.Keys) { if ($after[$k] -ne $before[$k]) { $same = $false } }
    Yes 'the check wrote nothing: the same files, byte for byte' $same

    # Clean the seeded breaks away and the same tree passes, the one good
    # allowance still covering its line.
    Put $tmp 'README.md' @('# Seeded', 'A multiplayer engine, a playtest, getPlayer() and PlayerCharacter.', 'Clone https://github.com/ThornswoodRP/Thornswood to start.')
    Put $tmp 'SECURITY.md' @('Fine.', 'Signed as the name on the signing certificate; the oldest branches use the gavin/ prefix.', 'Patrick holds the key, and this page may say so.')
    Put $tmp 'CONTRIBUTING.md' @('Never "player".', 'And people here are customers.')
    Put $tmp 'launcher/app/MainWindow.axaml' @('<TextBlock x:Name="PlayerList" Text="the multiplayer client"/>') $utf8bom
    Put $tmp 'bot/content.py' @('WELCOME = """', 'Nothing wrong here.', '"""')
    Put $tmp 'site/data/site/a.md' @('Fine.')
    Put $tmp 'site/data/board.json' @('{ "active": { "intro": "Fine.",', '  "sections": [ { "note": "an ordinary Skyrim save" } ] } }')
    Put $tmp 'site/data/help.md' @('Fine.')
    Put $tmp 'site/public/home.html' @('<p>one, two</p>')
    Put $tmp 'site/public/index.html' @('<p>Anyone can Report; only staff Accept.</p>')
    Put $tmp 'site/data/site/c.md' @('A server in alpha, open by application.')
    Put $tmp 'installer/README.md' @('# Setup', 'Decided on 28 Sep.')
    Put $tmp 'docs/NEW.md' @('Written.')
    Put $tmp 'scripts/dev/Check-Words.allow.txt' @('# seeded allowances', 'CONTRIBUTING.md | banned-word | the rule names its word | Never "player".')
    $c2 = Invoke-Check $self $tmp
    foreach ($h in $c2.Hits) { Write-Host ("      " + $h) }
    Yes ('clean files exit 0 with no hits, the allowance still covering its line (exit ' + $c2.Code + ', ' + $c2.Hits.Count + ' hit(s))') ($c2.Code -eq 0 -and $c2.Hits.Count -eq 0)

    # The allowed line reworded: the allowance matches nothing and says so.
    Put $tmp 'CONTRIBUTING.md' @('Never the word.', 'And people here are customers.')
    $st = Invoke-Check $self $tmp
    Yes ('an allowance left behind by a reworded line is a hit (' + ($st.Hits -join ', ') + ')') ($st.Code -eq 1 -and ($st.Hits -join ' ') -eq 'scripts/dev/Check-Words.allow.txt:2:allow')
    Put $tmp 'CONTRIBUTING.md' @('Never "player".', 'And people here are customers.')

    # A listed file that is gone is said out loud, not silently dropped.
    Remove-Item -LiteralPath (Join-Path $tmp 'SECURITY.md') -Force
    $g = Invoke-Check $self $tmp
    $warned = @($g.Out | Where-Object { $_ -like '::warning::SECURITY.md is not there*' }).Count -gt 0
    Yes ('a listed file that is missing is a warning and not a failure (exit ' + $g.Code + ')') ($warned -and $g.Code -eq 0)

    # In a checkout, what git tracks is what is read: a note left untracked
    # on a machine is not text anybody else reads.
    $gitExe = Get-Command git -ErrorAction SilentlyContinue
    if ($gitExe) {
        Copy-Item -LiteralPath $tmp -Destination $git -Recurse
        Put $git 'notes.md' @(('mine' + $em + 'only'))
        & git -C $git init -q 2>&1 | Out-Null
        & git -C $git -c core.autocrlf=false add -- . ':!notes.md' 2>&1 | Out-Null
        $u = Invoke-Check $self $git
        Yes ('an untracked file in a checkout is not read (exit ' + $u.Code + ')') ($u.Code -eq 0 -and $u.Hits.Count -eq 0)
        & git -C $git -c core.autocrlf=false add -- notes.md 2>&1 | Out-Null
        $t = Invoke-Check $self $git
        Yes ('the same file once git tracks it is (' + ($t.Hits -join ', ') + ')') ($t.Code -eq 1 -and ($t.Hits -join ' ') -eq 'notes.md:1:em-dash')
    } else {
        Write-Host 'SKIP  no git on this machine to build a checkout with'
    }
}
finally {
    foreach ($d in $tmp, $git) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue } }
}

Done
