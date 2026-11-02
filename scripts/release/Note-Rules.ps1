<#
  Note-Rules.ps1

  What release notes may say. Ship.ps1 dot-sources this and refuses notes that
  break it, before anything is built. tests\test-note-rules.ps1 drives the same
  function, so the rule and its test cannot disagree.

  TWO COPIES, ONE ANSWER (plan rev 64). The same rules are in C# in
  tools\ReleaseNotes (thornswood-notes), which the "Release note" check runs
  on every pull request. This copy stays while Ship.ps1, Rollback-Feed.ps1,
  Deploy-DevGamemode.ps1, Collect-ReleaseNotes.ps1 and EnginePin.ps1 read it,
  some of them on the box, which has no .NET SDK, and goes when they move to
  C# or retire. tests\fixtures\note-rules-cases.json holds the answer for
  every case, and tests\test-note-rules-cases.ps1 and tools\ReleaseNotes.Tests
  hold each copy to it, so a rule changed here is changed there too.

  WHY IT EXISTS. Release notes are read by customers in three places: the
  launcher's News tab, the site's News page and Discord. docs/guide/rules.md says
  plain words, never "player", no em dashes, and never pull request numbers or
  branch names in them. Ship checked only that there was a title and a detail
  line (25 September), so on 26 and 27 September these went out anyway:

    "This is what players actually got from demoting 1.1.92.1 through 1.1.95.4"
    "Place no longer throws walked is not defined (fireWalked / PR #239)"
    "Server load order is kept after Fix PutInServerOrder"
    "Autoplay uses WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS instead of
     EnvironmentOptions that faulted CreateAsync on One"
    "Bar covers whole run; every stop says why.#617 #618"

  and "Launcher 1.1.101" twice in one list.

  WHAT IT REFUSES, in the title, the body and every detail line:
    - the word player or players
    - an em dash
    - an issue or pull request number (#123), "PR", "pull request"
    - a code file name (.cs .ps1 .js .dll .json .exe .xaml .py and the like);
      a mod's .esp name is allowed, people see those in Vortex, and so is a
      .swf, which SkyUI's own error box names
    - our own shop words: demoting, worktree, cherry-pick, squash, CI
    - an environment variable (WORDS_LIKE_THIS)
    - a code identifier: camelCase, or three or more joined capitalised words
      (PutInServerOrder, EnvironmentOptions); a short list of ordinary names
      (SkyUI, SkyMP, GitHub, YouTube, WebView) is allowed
    - a version number in the title, and a four-part number (1.1.92.1)
      anywhere, which the News page check reads as a server address
    - the same line twice
  Each problem comes back as one line saying what and where, so the person
  shipping can rewrite it rather than guess.
#>

$NoteAllowedNames = @('SkyUI', 'SkyMP', 'SkyrimPlatform', 'GitHub', 'YouTube', 'TikTok', 'VirusTotal',
                      'WebView', 'NirnLab', 'SunHelm', 'RaceMenu', 'MaxOnline', 'PayPal', 'JContainers')

function Get-NoteShapeProblems([string]$Notes) {
    $problems = New-Object System.Collections.Generic.List[string]
    $lines = @($Notes -split "`r?`n")
    $noteTitle = (@($lines | Where-Object { $_.Trim() }) + @(''))[0].Trim()
    $noteBullets = @($lines | Where-Object { $_ -match '^\s*-\s*\S' -and ($_ -replace '^\s*-\s*', '').Trim().Length -ge 12 })
    $placeholder = $noteTitle -match '^[\W_]*$' -or $noteTitle -match '^(test|testing|wip|update|updates|fix|fixes|changes|stuff|dev|build|misc)\W*$'
    if ($placeholder -or @($noteTitle -split '\s+' | Where-Object { $_ }).Count -lt 3) {
        $problems.Add("the title '$noteTitle' is too short to say what changed.")
    }
    if ($noteBullets.Count -lt 1) {
        $problems.Add('there is no detail line: at least one line starting with "- ".')
    }
    return $problems.ToArray()
}

function Get-NoteProblems([string]$Notes) {
    $problems = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    $lines = @($Notes -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $n = 0
    foreach ($raw in $lines) {
        $n++
        $line = ($raw -replace '^\s*-\s*', '').Trim()
        $where = if ($n -eq 1) { 'the title' } else { "line $n" }
        $short = if ($line.Length -gt 60) { $line.Substring(0, 57) + '...' } else { $line }

        $key = $line.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { $problems.Add("$where repeats an earlier line: '$short'"); continue }
        $seen[$key] = $true

        # Version numbers. Publish-Update adds the "Launcher 1.1.x" line itself;
        # a title that names one says nothing to the person reading it, and a
        # four-part dev number (1.1.92.1) reads as a server address, which the
        # News page check (tests\test-public-news.ps1) refuses. Both went out
        # on 26 and 27 Sep.
        if ($n -eq 1 -and $line -match '\b\d+\.\d+\.\d+\b') { $problems.Add("the title names a version; say what changed instead: '$short'") }
        if ($line -match '\b\d{1,3}(\.\d{1,3}){3}\b') { $problems.Add("$where has a four-part number, which reads as a server address: '$short'") }
        if ($line -match '(?i)\bplayers?\b') { $problems.Add("$where says player; the people in the world are customers, testers or people: '$short'") }
        if ($line.Contains([string][char]0x2014)) { $problems.Add("$where has an em dash; use a comma or a full stop: '$short'") }
        if ($line -match '#\d+' -or $line -match '\bPR\b' -or $line -match '(?i)\bpull request') { $problems.Add("$where names an issue or pull request; say what changed for the person instead: '$short'") }
        if ($line -match '(?i)\b[\w-]+\.(cs|ps1|psm1|js|ts|dll|json|exe|xaml|py|bat|cmd|pdb|txt|log)\b') { $problems.Add("$where names a code file: '$short'") }
        if ($line -match '(?i)\b(demot(e|ed|ing)|worktrees?|cherry-?pick(ed)?|squash(ed)?)\b' -or $line -cmatch '\bCI\b') { $problems.Add("$where uses a word from how we work, not from the game (" + $Matches[0] + "): '$short'") }
        if ($line -match '\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b') { $problems.Add("$where names a setting or variable (" + $Matches[0] + "): '$short'") }
        foreach ($m in [regex]::Matches($line, '\b[A-Za-z][A-Za-z0-9]*\b')) {
            $w = $m.Value
            if ($NoteAllowedNames -contains $w) { continue }
            $camel = $w -cmatch '^[a-z]+[A-Z][A-Za-z0-9]*$'
            $humps = ([regex]::Matches($w, '[A-Z][a-z]+')).Count
            $pascal = $w -cmatch '^[A-Z][a-z]+([A-Z][a-z0-9]+){2,}$' -and $humps -ge 3
            if ($camel -or $pascal) { $problems.Add("$where names something in the code ($w): '$short'"); break }
        }
    }
    return $problems.ToArray()
}

<#
  THE RELEASE NOTE IN A PULL REQUEST (#5179).

  A release's note was written by whoever shipped it, from merged pull request
  titles, after the fact. Since #5179 each pull request carries its own note,
  written by the person who made the change, and the build check reads it
  while the pull request is open (thornswood-notes pr, run by
  .github\workflows\pr-body.yml). Collect-ReleaseNotes.ps1 joins the notes of
  every pull request merged since the last release into the release's note, so
  nobody writes one at release time and nothing in it is new to the rules.

  In the pull request body, outside any <!-- comment -->:

      Release note: The forge shows the price before you pay
      - The forge window lists each metal a piece takes and how much.

  A headline of three words or more, then at least one "- " detail line
  directly under it: the same shape a release's note has, so a release that
  carries one change is that change's note as written. A change nobody would
  notice in the game, the launcher, the site or Discord (scripts, tests, docs
  for the team, the board) says:

      Release note: none
#>

# The note a pull request body carries. Returns Found (a Release note line is
# there), None (it says none), Headline, Details (the "- " lines under it) and
# Text (headline and details as one note), and Count, the number of Release
# note lines, so a body with two can be refused rather than half read.
function Get-PrReleaseNote([string]$Body) {
    $text = [regex]::Replace([string]$Body, '(?s)<!--.*?-->', '')
    $lines = @($text -split "`r?`n")
    $at = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*(\*\*)?Release note:(\*\*)?\s*(.*?)\s*$') { $at += $i }
    }
    $r = [ordered]@{ Found = $false; None = $false; Headline = ''; Details = @(); Text = ''; Count = $at.Count }
    if ($at.Count -eq 0) { return [pscustomobject]$r }
    $i = $at[0]
    $null = $lines[$i] -match '^\s*(\*\*)?Release note:(\*\*)?\s*(.*?)\s*$'
    $r.Found = $true
    $r.Headline = $Matches[3].Trim()
    if ($r.Headline -match '^(?i)none\.?$') { $r.None = $true; return [pscustomobject]$r }
    $details = New-Object System.Collections.Generic.List[string]
    for ($j = $i + 1; $j -lt $lines.Count; $j++) {
        if ($lines[$j] -match '^\s*-\s+\S') { $details.Add($lines[$j].Trim()) } else { break }
    }
    $r.Details = $details.ToArray()
    $r.Text = (@($r.Headline) + $r.Details) -join "`n"
    return [pscustomobject]$r
}

# What is wrong with a pull request body's release note, one line each; none
# when it is right. Author is the pull request's author: Dependabot writes its
# own bodies and only moves the versions of what we build with, so its pull
# requests say none by rule rather than by a line.
function Get-PrReleaseNoteProblems([string]$Body, [string]$Author = '') {
    if ($Author -eq 'dependabot[bot]') { return @() }
    $n = Get-PrReleaseNote $Body
    $problems = New-Object System.Collections.Generic.List[string]
    if (-not $n.Found) {
        $problems.Add('there is no "Release note:" line. Add one under "For the Thornswood team": "Release note: none" when nobody would notice the change, otherwise a headline people read and a "- " line under it.')
        return $problems.ToArray()
    }
    if ($n.Count -gt 1) { $problems.Add("there are $($n.Count) Release note lines; keep one, so the release says one thing for this change.") }
    if ($n.None) { return $problems.ToArray() }
    if (-not $n.Headline) { $problems.Add('the Release note line is empty: write a headline, or "none".') }
    foreach ($p in @(Get-NoteShapeProblems $n.Text)) { $problems.Add($p) }
    foreach ($p in @(Get-NoteProblems $n.Text)) { $problems.Add($p) }
    return $problems.ToArray()
}

# Joins the notes of the pull requests a release carries, in merge order, into
# the release's note: the first one's headline is the title, its details
# follow, and each later one gives its headline as a "- " line and then its own
# details. A line already there is not written twice. Items are objects with
# Number and Body; those whose note is none are left out. Returns '' when none
# of them has a note.
function Join-PrReleaseNotes($Items) {
    $out = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    function Add-Line([string]$line) {
        $key = (($line -replace '^\s*-\s*', '').Trim()).ToLowerInvariant()
        if ($seen.ContainsKey($key)) { return }
        $seen[$key] = $true
        $out.Add($line)
    }
    foreach ($it in @($Items)) {
        $n = Get-PrReleaseNote ([string]$it.Body)
        if (-not $n.Found -or $n.None -or -not $n.Headline) { continue }
        if ($out.Count -eq 0) { Add-Line $n.Headline } else { Add-Line ('- ' + $n.Headline) }
        foreach ($d in $n.Details) { Add-Line $d }
    }
    return ($out -join "`n")
}
