<#
  Check-Words.ps1

  The writing rules in docs/guide/rules.md, checked on every file people read instead of hoped for; each hit names the file, the line and the rule.

  WHAT IT READS. Every file whose whole point is text for people:
    - every Markdown file in the repository, apart from lore\ (in-world
      writing, not operational text), docs\archive\ (dated snapshots, kept as
      they were) and the engine submodule;
    - the launcher's window (launcher/app/MainWindow.axaml, compiled since
      #4823; its Help page went with #3146),
      the bot's channel posts (bot/content.py) and the site's public pages
      (site/public/*.html). The voice service serves no page since #1822,
      so it has none to read. The installer carries no read me since #4824:
      Velopack's Setup.exe opens the launcher, whose install window says
      what to do, and the join guide on the site is the long form.
  Not the code files (the gamemode, the overlays, the rest of the launcher): a
  word check there fires on identifiers, engine calls like player.moveto and
  Skyrim's own record names, and those are not text for people.
  docs/guide/rules.md, "Words", says which rules no machine checks.

  THE RULES, each by the name a hit carries:
    em-dash          no em dashes anywhere written for people (Words)
    banned-word      never the word player (Words)
    old-owner        the owner is Patrick, never the old name (Words)
    open-alpha       never a closed playtest: an alpha, open by application (#428)
    placeholder      no placeholders: TODO, TBD, FIXME, lorem ipsum (Words)
    signer-name      the name on the code signing certificate is written in
                     one place, ExpectedSigner in launcher\app\Updater.cs,
                     which the launcher checks every update against. A page
                     says "the name on the signing certificate", or names the
                     profile, ThornswoodRelease (issue #1052)
    names-person     README.md and the six component READMEs name nobody:
                     operational documents are losing names, and problems go
                     to the Discord or the report page, never to one person
                     (tests\test-component-readmes.js, tests\test-repo-docs.js)

  WHEN A LINE HAS TO SAY IT. The guide's rules page has to name the word it bans,
  and a document that quotes something that went out quotes it as it was.
  Those lines go in scripts\dev\Check-Words.allow.txt with the reason, one per
  line. An allowance that matches nothing any more is itself a hit, so the
  list cannot quietly grow stale.

  MEASURED 24 September, when this was first written: eleven hits over the
  first ten files it read. MEASURED 29 September (issue #460), when it grew to
  every Markdown file and the public pages: six more, in the installer setup
  README (a name, the one that had held test-component-readmes.js red since
  #1017), the required data README, the script index, the site's gallery page
  and Developer-Guide.md, plus two lines that quote on purpose.

  The em dash is built from its code point, [char]0x2014, plus its HTML
  entities, and never pasted in, so this file's own encoding cannot decide
  whether the check works. Measured while writing it first: the first draft
  spelled it as a regex escape, the tool that wrote the file turned that
  escape into the character itself, and Windows PowerShell 5.1, reading this
  file as ANSI, then found none of the six em dashes that were there. So the
  pattern has no escape to lose, and test-check-words.ps1 fails on any byte
  in this file that is not plain ASCII. Each file is read as UTF-8 on
  purpose: Windows PowerShell 5.1 reads a file with no byte order mark as
  ANSI, and would never see an em dash in one. En dashes and hyphens are
  allowed. The word has a boundary on each side, so multiplayer, playtest and
  getPlayer pass.

  Which files: git's own list when -Root is a checkout, so nothing untracked
  on a machine is read; every file under -Root otherwise (the harness's temp
  folder).

  Read only. Each hit prints as ::error file=,line= so GitHub marks the line
  on the pull request, and any hit exits 1. There is no fix mode, which is
  why a Claude may run it.
#>
[CmdletBinding()]
param([string]$Root)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }
$Root = (Resolve-Path -LiteralPath $Root).Path

# Files that must be there. A missing one is said out loud, not dropped.
# site/data/board.json because the hub's boards in it are shown on the site.
# The Known Issues page and the roadmap came out of it in #3140: they are
# written from the issue board, and the bot checks their words (bot.py
# post_problems).
$Named = @(
    'README.md', 'SECURITY.md', 'Developer-Guide.md', 'launcher/app/MainWindow.axaml',
    'bot/content.py', 'site/public/home.html', 'site/data/board.json'
)
# README.md and the component READMEs that tests\test-component-readmes.js reads.
$NameFiles = @(
    'README.md', 'launcher/README.md', 'site/README.md', 'voice/README.md',
    'game/plugins/README.md', 'game/ui/README.md', 'installer/README.md'
)
$Rules = @(
    @{ Id = 'em-dash'; Case = 'IgnoreCase'; For = 'people'
       Re = ([string][char]0x2014) + '|&mdash;|&#0*8212;|&#x0*2014;'
       Say = 'an em dash. Use a comma, a colon or a full stop.' },
    @{ Id = 'banned-word'; Case = 'IgnoreCase'; For = 'people'
       Re = '\bplayers?\b'
       Say = 'the word player. Say customers, clients, people, testers or partners.' },
    # `gavin/` is a branch prefix from before 17 Sep, a name in git. Any other
    # "Gavin" is the old owner name. Until #1052 the name on the signing
    # certificate was let through here; no page names it now (signer-name).
    @{ Id = 'old-owner'; Case = 'IgnoreCase'; For = 'people'
       Re = '\bgavin\b(?!/)'
       Say = 'the old owner name. He is Patrick.' },
    # Issue #428. Patrick, 28 Sep: "we are in alpha so the world is open by
    # application". Anybody can download it, so nothing people read may call
    # it a closed playtest any more.
    @{ Id = 'open-alpha'; Case = 'IgnoreCase'; For = 'people'
       Re = '\bclosed[\s-]+playtest'
       Say = 'closed playtest. It is an alpha, open by application.' },
    # Upper case only, so a file called todo.md and the To Do board pass.
    @{ Id = 'placeholder'; Case = 'None'; For = 'people'
       Re = '\b(TODO|TBD|FIXME)\b|\b[Ll]orem ipsum\b'
       Say = 'a placeholder. Say what is there, or leave the line out.' },
    @{ Id = 'names-person'; Case = 'None'; For = 'names'
       Re = '\b(Patrick|Djinn|Gavin|WiccanDjinn|Ataxayk)\b|(?<![/\w])EvilPatrick06(?![/\w])'
       Say = 'a person by name. Say what was decided and when, or where to ask (the Discord, the report page).' }
)
# The name on the signing certificate, read from the one place it is written,
# so this file does not carry it either (issue #1052). A root without the
# launcher's source (the harness's temp folder, before it puts one there) has
# no name to look for.
$SignerUnread = $false
$UpdaterRel = 'launcher/app/Updater.cs'
$UpdaterPath = Join-Path $Root $UpdaterRel
if (Test-Path -LiteralPath $UpdaterPath) {
    $sm = [regex]::Match([System.IO.File]::ReadAllText($UpdaterPath, [System.Text.Encoding]::UTF8), 'const string ExpectedSigner = "([^"]+)"')
    if ($sm.Success -and $sm.Groups[1].Value.Trim()) {
        $Rules += @{ Id = 'signer-name'; Case = 'IgnoreCase'; For = 'people'
            Re = '(?<![\w])' + [regex]::Escape($sm.Groups[1].Value.Trim()).Replace('\ ', '\s+') + '(?![\w])'
            Say = 'the name on the signing certificate. Say "the name on the signing certificate", or the profile, ThornswoodRelease; the name itself is ExpectedSigner in launcher\app\Updater.cs.' }
    } else { $SignerUnread = $true }
}
$RuleIds = @($Rules | ForEach-Object { $_.Id })

function Test-ForPeople([string]$rel) {
    if ($rel -match '^(lore|engine|docs/archive)/' -or $rel -match '(^|/)node_modules/') { return $false }
    if ($Named -contains $rel) { return $true }
    if ($rel -match '\.md$') { return $true }
    if ($rel -match '^site/public/[^/]+\.html$') { return $true }
    return $false
}

# git's list in a checkout, so an untracked note on a machine is not read.
$all = $null
if ((Test-Path -LiteralPath (Join-Path $Root '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    $listed = @(& git -C $Root -c core.quotepath=off ls-files 2>$null)
    if ($LASTEXITCODE -eq 0) { $all = $listed }
}
if ($null -eq $all) {
    $cut = $Root.TrimEnd('\', '/').Length + 1
    $all = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName.Substring($cut).Replace('\', '/') })
}
$files = @($all | Where-Object { Test-ForPeople $_ } | Sort-Object -Unique)

$hits = 0
if ($SignerUnread) {
    $hits++
    Write-Host ("::error file={0}::[signer-name] ExpectedSigner could not be read, so no page can be checked for it" -f $UpdaterRel)
}
foreach ($n in $Named) {
    if ($files -notcontains $n -or -not (Test-Path -LiteralPath (Join-Path $Root $n))) {
        Write-Host ("::warning::{0} is not there, so it was not checked" -f $n)
    }
}

# The allowances: file | rule | why | the text on the line.
$allow = @()
$AllowRel = 'scripts/dev/Check-Words.allow.txt'
$AllowPath = Join-Path $Root $AllowRel
if (Test-Path -LiteralPath $AllowPath) {
    $al = [System.IO.File]::ReadAllLines($AllowPath, [System.Text.Encoding]::UTF8)
    for ($i = 0; $i -lt $al.Count; $i++) {
        $t = $al[$i].Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $parts = @($t -split '\s+\|\s+', 4)
        if ($parts.Count -lt 4 -or -not $parts[2].Trim() -or -not $parts[3].Trim()) {
            $hits++
            Write-Host ("::error file={0},line={1}::[allow] an allowance has four parts, file | rule | why | the text on the line" -f $AllowRel, ($i + 1))
            continue
        }
        if ($RuleIds -notcontains $parts[1].Trim()) {
            $hits++
            Write-Host ("::error file={0},line={1}::[allow] no rule is called {2}; the rules are {3}" -f $AllowRel, ($i + 1), $parts[1].Trim(), ($RuleIds -join ', '))
            continue
        }
        $allow += @{ File = $parts[0].Trim(); Rule = $parts[1].Trim(); Text = $parts[3].Trim(); Line = $i + 1; Used = $false }
    }
}

$read = 0; $allowed = 0
foreach ($rel in $files) {
    $full = Join-Path $Root $rel
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $read++
    $lines = [System.IO.File]::ReadAllLines($full, [System.Text.Encoding]::UTF8)
    $isNames = $NameFiles -contains $rel
    for ($i = 0; $i -lt $lines.Count; $i++) {
        foreach ($r in $Rules) {
            if ($r.For -eq 'names' -and -not $isNames) { continue }
            if (-not [regex]::IsMatch($lines[$i], $r.Re, $r.Case)) { continue }
            $ok = $false
            foreach ($a in $allow) {
                if ($a.File -eq $rel -and $a.Rule -eq $r.Id -and $lines[$i].Contains($a.Text)) { $a.Used = $true; $ok = $true }
            }
            if ($ok) { $allowed++; continue }
            $hits++
            Write-Host ("::error file={0},line={1}::[{2}] {3}" -f $rel, ($i + 1), $r.Id, $r.Say)
        }
    }
}
foreach ($a in $allow) {
    if (-not $a.Used) {
        $hits++
        Write-Host ("::error file={0},line={1}::[allow] this allowance matched nothing in {2}, so it is out of date; take it out" -f $AllowRel, $a.Line, $a.File)
    }
}

if ($hits) {
    Write-Host ("{0} hit(s) in the {1} file(s) read. The rules are the Words section of docs/guide/rules.md; a line that has to quote one goes in {2} with its reason." -f $hits, $read, $AllowRel)
    exit 1
}
Write-Host ("the writing rules hold in all {0} file(s) read ({1} line(s) allowed by {2})" -f $read, $allowed, $AllowRel)
exit 0
