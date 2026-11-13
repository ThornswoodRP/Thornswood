<#
  test-note-rules.ps1

      pwsh -NoProfile -File .\tests\test-note-rules.ps1

  Release notes that say things only the team would understand are refused
  before anything is built (tools\ReleaseNotes\NoteRules.cs, which Ship.ps1
  and the other release scripts compile into PowerShell), and "The load order moved, so start a new character" only goes out
  when the plugins that are on, or their order, really changed
  (Get-ActiveOrderKey in Publish-Update.ps1).

  WHY. Patrick, 27 September, on the release notes of 26 and 27 September:
  they said players, named pull requests, env variables, code names and the
  shipping machine, one listed "Launcher 1.1.101" twice, and three releases in
  two days told testers the load order moved. The bad lines below are the real
  ones from the main and dev feeds.

  THE ONE COPY (#5354). The rules are C#, and the release scripts load them
  with Add-Type, which compiles the file with the C# compiler pwsh carries:
  the box that runs a Ship has no .NET SDK. So this loads the file the same
  way, which also proves it still compiles there (no implicit usings, no
  project settings), and checks that each script loads it and that the
  PowerShell copy, Note-Rules.ps1, stays gone. Every other case is in
  tools\ReleaseNotes.Tests, against tests\fixtures\note-rules-cases.json.

  Read only apart from its own temp folder.
#>
[CmdletBinding()]
param([string]$Scripts)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Scripts) { $Scripts = Join-Path (Split-Path -Parent $Here) 'scripts\release' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $Scripts)
$rulesFile = Join-Path $repoRoot 'tools/ReleaseNotes/NoteRules.cs'
$loaded = $true
try { Add-Type -Path $rulesFile } catch { $loaded = $false; Write-Host ("      " + $_.Exception.Message) }
Yes 'pwsh compiles tools/ReleaseNotes/NoteRules.cs with Add-Type, as the release scripts do' $loaded
if (-not $loaded) { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1 }
$again = $true
try { Add-Type -Path $rulesFile } catch { $again = $false }
Yes 'and loading it a second time in one session is fine (Ship-OnBox runs Ship in its own session)' $again
function Bad([string]$notes) { return @([Thornswood.ReleaseNotes.NoteRules]::Problems($notes)).Count -gt 0 }
function BadShape([string]$notes) { return @([Thornswood.ReleaseNotes.NoteRules]::ShapeProblems($notes)).Count -gt 0 }

# ---- the real lines that went out ----------------------------------------------
Yes 'a title alone is refused by shape' (BadShape "Only a title here")
Yes 'a note with no detail line is refused by shape' (BadShape "A title with three words`nno dash line")
Yes 'players is refused' (Bad "What arrived with launcher 1.1.95`n- This is what players actually got from demoting")
Yes 'a pull request number is refused' (Bad "Place and fire distance work again`n- Place no longer throws walked is not defined (fireWalked / PR #239)")
Yes 'an issue number run into a sentence is refused' (Bad "Downgrade bar and stop reasons`n- Bar covers whole run; every stop says why.#617 #618")
Yes 'a code name is refused' (Bad "Vortex bring up to date keeps load order`n- Server load order is kept after Fix PutInServerOrder")
Yes 'an environment variable is refused' (Bad "Menu music plays again in the launcher`n- Autoplay uses WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS instead")
Yes 'a code file is refused' (Bad "Menu music plays again in the launcher`n- The menu theme starts after Voice places WebView2Loader.dll")
Yes 'camelCase is refused' (Bad "Read the installed collection revision`n- Reads it via newestFileId on authoring machines")
Yes 'the same line twice is refused' (Bad "Vortex bring up to date keeps load order`n- Launcher 1.1.101`n- Launcher 1.1.101")
Yes 'an em dash is refused' (Bad ("The scroll opens when you click it`n- It waits for you " + [char]0x2014 + " no rush"))
Yes 'the words pull request are refused' (Bad "The scroll opens when you click it`n- From the pull request that fixed the scroll")

Yes 'an internal word is refused' (Bad "Launcher 1.1.95 brings demoting to main`n- Everything that shipped on demoting is now on main")
Yes 'a version in the title is refused' (Bad "Launcher 1.1.96 host feed and DIY theme card`n- Updates come from thornswood.net")
Yes 'a four-part dev number is refused anywhere' (Bad "The dev fixes reach everyone`n- Dev builds 1.1.92.1 to 1.1.95.4")
Yes 'a three-part launcher version in a detail line is allowed' (-not (Bad "The dev fixes reach everyone`n- Launcher 1.1.101 is the one to have"))
Yes 'the SkyUI map.swf error people see is allowed' (-not (Bad "The SkyUI error box is gone`n- The SkyUI error box about map.swf on the way in is gone."))
$p = @([Thornswood.ReleaseNotes.NoteRules]::Problems("Menu music plays again in the launcher`n- Autoplay uses WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS instead"))
Yes 'each problem says where it is and what it is' ($p.Count -ge 1 -and $p[0] -match '^line 2 ' -and $p[0] -match 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')

# ---- notes that are fine -------------------------------------------------------
$good = @(
    "The scroll's Continue gives you the full three minutes`n- Time spent reading the sealed scroll no longer counts against choosing a character.`n- After you press Continue you get the whole three minutes to pick one.",
    "The Downgrade button works on its own again`n- It finds Steam's window however your Steam draws it.`n- If Steam refuses a part, the launcher tells you why straight away.",
    "Your party, found`n- Green on the strip means the same room as you. Gold means somewhere else in Skyrim.`n- The SkyUI error box about the map is gone.",
    "The mod list has a new revision`n- ElysiumEstateSSE.esp ships with the collection now.`n- Chat fades after its last line, and Settings can change that.",
    "Bringing Thornswood up to date keeps your load order`n- Bring it up to date from Vortex stays fast when nothing changed.`n- Launcher 1.1.101"
)
$i = 0
foreach ($g in $good) {
    $i++
    $pr = @([Thornswood.ReleaseNotes.NoteRules]::Problems($g))
    Yes ("good notes $i pass" + $(if ($pr.Count) { ' (' + ($pr -join '; ') + ')' } else { '' })) ($pr.Count -eq 0)
}

# ---- Ship calls it before anything is built -------------------------------------
$ship = [IO.File]::ReadAllText((Join-Path $Scripts 'Ship.ps1'))
$call = $ship.IndexOf('[Thornswood.ReleaseNotes.NoteRules]::Problems($Notes)')
$shape = $ship.IndexOf('[Thornswood.ReleaseNotes.NoteRules]::ShapeProblems($Notes)')
Yes 'Ship.ps1 asks the rules about the notes, their shape and their words' ($call -ge 0 -and $shape -ge 0)
Yes 'and before it does any git or build work' ($call -ge 0 -and $shape -ge 0 -and $call -lt $ship.IndexOf("Head 'Git'") -and $shape -lt $ship.IndexOf("Head 'Git'"))

# ---- every script that checks a note reads the one copy (#5354) ---------------------
Yes 'the PowerShell copy of the rules, Note-Rules.ps1, is gone' (-not (Test-Path -LiteralPath (Join-Path $Scripts 'Note-Rules.ps1')))
foreach ($rel in 'scripts/release/Ship.ps1', 'scripts/release/Rollback-Feed.ps1', 'scripts/deploy/Deploy-DevGamemode.ps1',
                 'scripts/release/Collect-ReleaseNotes.ps1', 'scripts/release/EnginePin.ps1') {
    $text = [IO.File]::ReadAllText((Join-Path $repoRoot $rel))
    $loads = $text -match "Add-Type -Path \(Join-Path \$[A-Za-z]+ '(\.\./\.\./)?tools/ReleaseNotes/NoteRules\.cs'\)"
    $asks = $text -match '\[Thornswood\.ReleaseNotes\.(NoteRules|PrNote)\]::'
    Yes ("$rel loads tools/ReleaseNotes/NoteRules.cs and asks it") ($loads -and $asks)
    Yes ("  and reads no Note-Rules.ps1 and calls none of its functions") ($text -notmatch 'Note-Rules\.ps1' -and $text -notmatch '\b(Get-NoteShapeProblems|Get-NoteProblems|Get-PrReleaseNote|Get-PrReleaseNoteProblems|Join-PrReleaseNotes)\b')
}
$readers = @(Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Include '*.ps1', '*.psm1', '*.yml' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '[\\/](node_modules|engine|worktrees|temp|\.git)[\\/]' -and $_.Name -ne 'test-note-rules.ps1' } |
    Where-Object { [IO.File]::ReadAllText($_.FullName) -match "Note-Rules\.ps1'\)|Note-Rules\.ps1`"\)|scripts/release/Note-Rules\.ps1\s*$" } |
    ForEach-Object { $_.FullName.Substring($repoRoot.Length + 1) })
Yes ('no script or workflow loads Note-Rules.ps1' + $(if ($readers.Count) { ' (' + ($readers -join ', ') + ')' } else { '' })) ($readers.Count -eq 0)

# ---- the load order line only for a real order change ----------------------------
$pu = Join-Path $Scripts 'Publish-Update.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($pu, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ActiveOrderKey' }, $true)
Yes 'Publish-Update.ps1 has Get-ActiveOrderKey' ($null -ne $fn)
if ($fn) {
    . ([scriptblock]::Create($fn.Extent.Text))
    $work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-note-rules-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = New-Item -ItemType Directory -Force -Path $work
    try {
        function KeyOf([string]$text) {
            $f = Join-Path $work 'plugins.txt'
            [IO.File]::WriteAllText($f, $text)
            return Get-ActiveOrderKey $f
        }
        $base = KeyOf "# comment`r`n*Skyrim.esm`r`n*Update.esm`r`n*Thornswood.esp`r`nOff.esp`r`n"
        Yes 'line endings alone do not move the order' ((KeyOf "*Skyrim.esm`n*Update.esm`n*Thornswood.esp`nOff.esp`n") -eq $base)
        Yes 'a comment or a blank line does not move it' ((KeyOf "# other`r`n`r`n*Skyrim.esm`r`n*Update.esm`r`n*Thornswood.esp`r`nOff.esp") -eq $base)
        Yes 'case and spaces do not move it' ((KeyOf "*skyrim.esm  `r`n* Update.ESM`r`n*Thornswood.esp`r`nOff.esp") -eq $base)
        Yes 'a plugin that is off moving does not move it' ((KeyOf "Off.esp`r`n*Skyrim.esm`r`n*Update.esm`r`n*Thornswood.esp") -eq $base)
        Yes 'two plugins that are on swapping moves it' ((KeyOf "*Update.esm`r`n*Skyrim.esm`r`n*Thornswood.esp`r`nOff.esp") -ne $base)
        Yes 'a plugin turned on moves it' ((KeyOf "*Skyrim.esm`r`n*Update.esm`r`n*Thornswood.esp`r`n*Off.esp") -ne $base)
        Yes 'a plugin turned off moves it' ((KeyOf "*Skyrim.esm`r`n*Update.esm`r`nThornswood.esp`r`nOff.esp") -ne $base)
    } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
$text = [IO.File]::ReadAllText($pu)
Yes 'the warning line follows the order key, not the file hash' ($text -match 'if \(\$orderMoved\) \{ \$details \+= ''The load order moved' -and $text -notmatch 'if \(\$profileChanged\.Count\) \{ \$details \+= ''The load order moved')
# #2031: the key is taken from the list in the server's order, under a new
# name, so the first release after that change has nothing to compare with.
Yes 'and only when the last release recorded a shipped-order key to compare with' ($text -match '\$orderMoved\s*=\s*\$prev\.ContainsKey\('':order:shippedPlugins''\)')
# Since #1050 the filter takes out every key that starts with ':', the order key among them.
Yes 'the order key is never shipped or listed as removed' (
    ([regex]::Matches($text, "-notlike ':order:\*'")).Count -ge 2 -or
    ($text -match '\$changed\s*=\s*@\(\$changed \| Where-Object \{ -not \$_\.StartsWith\('':''\) \}\)' -and
     $text -match '\$removed\s*=\s*@\(\$removed \| Where-Object \{ -not \$_\.StartsWith\('':''\) -and'))
Yes 'a detail line is listed once' ($text -match '\$seenDetail')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
