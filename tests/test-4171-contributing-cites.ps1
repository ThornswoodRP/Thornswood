<#
  test-4171-contributing-cites.ps1

      pwsh -NoProfile -File .\tests\test-4171-contributing-cites.ps1

  Issue #4171. The team's rules moved out of CONTRIBUTING.md into the
  Developer Guide, and CONTRIBUTING.md came back on 26 Oct as a short public
  page on sending a change. Lines that cited it for a rule kept citing it,
  because a cite names a page and nothing held the page to holding the rule:
  the nightly's stray branches and writing checks, the signing refusal a
  person reads when Ship will not run, the writing check's own harness and the
  out/dist reason in test-script-paths.

  This holds:

    1. each of those cites the guide page and section that holds its rule now,
       in the guide's own form, page.md, "Section" (Developer-Guide.md, "The
       pages"), and none cites CONTRIBUTING for it;
    2. each section it names is a heading on that page;
    3. the links that send a stranger to the public CONTRIBUTING.md page stay
       (README.md, SUPPORT.md, the pull request template), and the writing
       check has no rule against naming it.

  Read only.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" }
  else       { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { [IO.File]::ReadAllText((Join-Path $Root $rel)).Replace("`r`n", "`n") }
function Lines([string]$rel) { (Text $rel) -split "`n" }

$words   = 'docs/guide/rules.md, "Words"'
$open    = 'docs/guide/how-work-moves.md, "Dev first, notes, and open branches"'
$sign    = 'docs/guide/how-work-moves.md, "Signing, the build check, and the six shared files"'
$settled = 'docs/guide/settled-design.md, "Settled design, not up for a quiet rewrite"'

# The line that gives each rule, found by what it says rather than by its
# number, and the cite it must carry.
$want = @(
  @{ File = '.github/workflows/nightly.yml'; At = 'merged or closed'; Cite = $open; What = 'the nightly''s stray branches check' },
  @{ File = '.github/workflows/nightly.yml'; At = 'over the files people read'; Cite = $words; What = 'the nightly''s writing check' },
  @{ File = 'scripts/release/Assert-PublishSigned.ps1'; At = 'refuse an update'; Cite = $sign; What = 'why the publish sign gate is there' },
  @{ File = 'scripts/release/Assert-PublishSigned.ps1'; At = 'There is no records\signing\signing.json'; Cite = $sign; What = 'the refusal with no signing.json' },
  @{ File = 'scripts/release/Assert-PublishSigned.ps1'; At = 'has "enabled": false'; Cite = $sign; What = 'the refusal with signing turned off' },
  @{ File = 'scripts/release/Ship.ps1'; At = 'only a machine that can sign it may Ship'; Cite = $sign; What = 'Ship''s sign gate' },
  @{ File = 'tests/test-check-words.ps1'; At = 'are checked, and the check itself works'; Cite = $words; What = 'the writing check''s harness' },
  @{ File = 'tests/test-script-paths.ps1'; At = '''out/dist'''; Cite = $settled; What = 'why out/dist is not in git' }
)

# ---- 1. each line cites its section, not CONTRIBUTING --------------------------
foreach ($w in $want) {
  $lines = @(Lines $w.File)
  $i = -1
  for ($n = 0; $n -lt $lines.Count; $n++) { if ($lines[$n].Contains($w.At)) { $i = $n; break } }
  if ($i -lt 0) { Yes ('1. ' + $w.What + ': its line is in ' + $w.File) $false; continue }
  # The line and the two after it: a comment or a refusal may run on.
  $near = ($lines[$i..([Math]::Min($i + 2, $lines.Count - 1))] -join ' ') -replace '\s*\n?\s*#\s*', ' '
  $near = $near -replace '''\s*\+\s*''', ''
  Yes ('1. ' + $w.What + ' (' + $w.File + ':' + ($i + 1) + ') cites ' + $w.Cite) ($near.Contains($w.Cite))
  Yes ('   and not CONTRIBUTING') ($near -notmatch 'CONTRIBUTING')
}
# Nothing else in these files sends a reader to CONTRIBUTING for a rule. The
# writing check's harness names CONTRIBUTING.md only as a file it writes in a
# scratch folder, below its header.
foreach ($f in @('.github/workflows/nightly.yml', 'scripts/release/Assert-PublishSigned.ps1', 'scripts/release/Ship.ps1', 'tests/test-script-paths.ps1')) {
  Yes ('   ' + $f + ' names CONTRIBUTING nowhere') (-not ((Text $f) -match 'CONTRIBUTING'))
}
$head = (Text 'tests/test-check-words.ps1')
$head = $head.Substring(0, $head.IndexOf('#>'))
Yes '   tests/test-check-words.ps1''s header names CONTRIBUTING nowhere' ($head -notmatch 'CONTRIBUTING')

# ---- 2. each section is there ----------------------------------------------------
foreach ($c in @($words, $open, $sign, $settled)) {
  $m = [regex]::Match($c, '^(.+?), "(.+)"$')
  $page = $m.Groups[1].Value; $sec = $m.Groups[2].Value
  $heads = @([regex]::Matches((Text $page), '(?m)^#{1,6}[ \t]+(.+?)[ \t]*$') | ForEach-Object { $_.Groups[1].Value })
  Yes ('2. ' + $page + ' has the section "' + $sec + '"') ($heads -contains $sec)
}

# ---- 3. the public page's own links stay -------------------------------------------
Yes '3. README.md still links CONTRIBUTING.md' ((Text 'README.md') -match '\]\(CONTRIBUTING\.md\)')
Yes '   SUPPORT.md still links CONTRIBUTING.md' ((Text 'SUPPORT.md') -match '\]\(CONTRIBUTING\.md\)')
Yes '   the pull request template still names CONTRIBUTING.md' ((Text '.github/pull_request_template.md') -match 'CONTRIBUTING\.md')
Yes '   CONTRIBUTING.md is there, the short page on sending a change' ((Text 'CONTRIBUTING.md') -match '^# Sending a change')
Yes '   the writing check has no rule against naming it' ((Text 'scripts/dev/Check-Words.ps1') -notmatch 'CONTRIBUTING')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
