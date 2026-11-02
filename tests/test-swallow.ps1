<#
  test-swallow.ps1

  The silent catches in the launcher, entry 239 on the To Do List, and the
  rule that stops their number growing.

  WHY THIS EXISTS. Measured 24 Sep: 386 of the 618 catch clauses in
  launcher\app\*.cs had nothing between their braces. A failure in any of them
  leaves no line in launcher.log, so a tester says the Save button did nothing
  and there is nothing to read. The entry counted 367, then 373, then 386
  while it waited, so the count is held by Check-Swallow.ps1 against
  swallow-baseline.txt rather than by anybody remembering.

  What this drives, all of it the real code:

    1. Check-Swallow.ps1 against the real launcher\app and the checked in
       baseline, which has to pass.
    2. Check-Swallow.ps1 against a copy in a temp folder, with one empty catch
       planted in each shape the rule counts. Each one has to go red and name
       the file, and taking it out again has to go green.
    3. The shapes the rule does not count: a body holding only a comment, and
       a body that logs. And a count that falls, which since #756 is red the
       same as a rise until the baseline line is lowered to what the file
       holds, because a fall that passed with a yellow hint was left for
       whoever came next.
    3c. The site, voice and the bot (#2736): every shape the rule counts in
       JavaScript and in Python goes red, the shapes it does not stay green,
       what is never read (node_modules, a .min.js, a harness beside the
       code, a venv) stays green with an empty catch in it, and one more
       empty catch in a copy of the real site\server.js or bot\bot.py goes
       red against the real baseline's own line for it.
    4. Swallow.Note, compiled from the real Swallow.cs with a stand-in for
       Paths, with the .NET SDK the launcher builds with (Add-LauncherType,
       tests\Launcher-Csc.ps1, #2821, #4823), and called, on any machine. It has to write the line, and it has to not throw
       with no log set, with the log's folder missing, or with the log held
       open by something else (that one on Windows only, where a file held
       with no sharing refuses a write), because a helper that throws from inside a
       catch is worse than the empty catch it replaced.
    5. The places the entry named (Config.Save, Swap.Restore and its
       DropLink, Hold.Release, Keep.Unpark), lifted out of the real files by
       brace match: no silent catch left, every catch logs under its own
       name, and none of them throws, because the change was to what they
       log and not to what they do.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoPath) { $RepoPath = $Here }
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#2821, #4823)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$Checker  = Join-Path $RepoPath 'scripts\dev\Check-Swallow.ps1'
$Baseline = Join-Path $RepoPath 'scripts\dev\swallow-baseline.txt'
$AppDir   = Join-Path $RepoPath 'launcher\app'
$SwallowCs = Join-Path $AppDir 'Swallow.cs'

Yes 'Check-Swallow.ps1 is there' (Test-Path -LiteralPath $Checker)
Yes 'swallow-baseline.txt is there' (Test-Path -LiteralPath $Baseline)
Yes 'launcher\app\Swallow.cs is there' (Test-Path -LiteralPath $SwallowCs)
if (-not ((Test-Path -LiteralPath $Checker) -and (Test-Path -LiteralPath $Baseline) -and (Test-Path -LiteralPath $SwallowCs))) {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}

# Runs the checker in this process and hands back its exit code and what it
# printed. Write-Host goes to the information stream, hence 6>&1.
# -Scripts, -Js, -Py and -Root pass on to it when given; without them it reads
# the real scripts\ and installer\ (#2711) and the real site\, voice\ and bot\
# (#2736), which is what section 1 wants and the copies below do not.
function Run-Check([string]$app, [string]$base, [switch]$List, [string[]]$Scripts, [string[]]$Js, [string[]]$Py, [string]$Root) {
    $global:LASTEXITCODE = 0
    $a = @{ AppDir = $app; Baseline = $base }
    if ($List) { $a.List = $true }
    if ($null -ne $Scripts) { $a.ScriptDirs = $Scripts }
    if ($null -ne $Js) { $a.JsDirs = $Js }
    if ($null -ne $Py) { $a.PyDirs = $Py }
    if ($Root) { $a.Root = $Root }
    $out = & $Checker @a 6>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}

# ---- 1. the tree as it is ----------------------------------------------------

$r = Run-Check $AppDir $Baseline
Yes 'the launcher has no more silent catches than the baseline allows' ($r.Code -eq 0)
if ($r.Code -ne 0) { Write-Host $r.Out }

$baseText = Get-Content -LiteralPath $Baseline -Raw
Yes 'the baseline carries its counting rule at the top' (
    $baseText.StartsWith('#') -and ($baseText -match 'THE RULE') -and ($baseText -match 'only a comment does NOT count'))

# ---- 2 and 3. planted catches, in a copy -------------------------------------

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-swallow-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $copy = Join-Path $tmp 'app'
    New-Item -ItemType Directory -Force -Path $copy | Out-Null
    Copy-Item -Path (Join-Path $AppDir '*.cs') -Destination $copy

    # The copy gets a baseline of its own, made by -List from the copy as it
    # stands, so what follows tests the checker and not whether somebody has
    # lowered a line in the real baseline yet.
    $base = Join-Path $tmp 'swallow-baseline.txt'
    $r = Run-Check $copy $Baseline -List -Scripts @() -Js @() -Py @()
    [IO.File]::WriteAllText($base, "# made by test-swallow.ps1 from its own copy`r`n" + $r.Out)

    $target = Join-Path $copy 'Config.cs'
    $original = [IO.File]::ReadAllText($target)
    $was = 0
    foreach ($l in (Get-Content -LiteralPath $base)) { if ($l -match '^Config\.cs\s+(\d+)$') { $was = [int]$Matches[1] } }

    $r = Run-Check $copy $base -Scripts @() -Js @() -Py @()
    Yes 'an untouched copy passes against a baseline -List made of it' ($r.Code -eq 0)
    Yes 'and says the baseline matches' ($r.Out -match 'the baseline matches')

    # Every shape the rule counts. Planted after the namespace closes, since
    # the checker reads text and never compiles.
    $counted = [ordered]@{
        'a bare empty catch on one line'            = "class Planted { void M() { try { M(); } catch { } } }"
        'an empty catch with its braces on their own lines' = "class Planted`r`n{`r`n    void M()`r`n    {`r`n        try { M(); }`r`n        catch`r`n        {`r`n        }`r`n    }`r`n}"
        'an empty catch that names the exception'   = "class Planted { void M() { try { M(); } catch (System.IO.IOException) { } } }"
        'an empty catch with a variable and a blank line in it' = "class Planted { void M() { try { M(); } catch (Exception ex)`r`n{`r`n`r`n} } }"
        'an empty catch with a comment beside it, not in it' = "class Planted { void M() { try { M(); } catch { }   // deliberate`r`n } }"
    }
    foreach ($k in $counted.Keys) {
        [IO.File]::WriteAllText($target, $original + "`r`n" + $counted[$k] + "`r`n")
        $r = Run-Check $copy $base -Scripts @() -Js @() -Py @()
        Yes ("the checker goes red on {0}" -f $k) ($r.Code -eq 1)
        Yes ("and names Config.cs at {0} against {1}" -f ($was + 1), $was) ($r.Out -match ("Config\.cs has {0} silent catches and the baseline allows {1}" -f ($was + 1), $was))
    }

    [IO.File]::WriteAllText($target, $original)
    $r = Run-Check $copy $base -Scripts @() -Js @() -Py @()
    Yes 'taking the planted catch out goes green again' ($r.Code -eq 0)

    $notCounted = [ordered]@{
        'a catch whose body is only a comment'      = "class Planted { void M() { try { M(); } catch`r`n{`r`n    // nothing to be done, and this says why`r`n} } }"
        'a catch whose body is only a block comment' = "class Planted { void M() { try { M(); } catch { /* not worth stopping for */ } } }"
        'a catch that logs with Swallow.Note'        = "class Planted { void M() { try { M(); } catch (Exception ex) { Swallow.Note(`"Planted.M`", ex); } } }"
    }
    foreach ($k in $notCounted.Keys) {
        [IO.File]::WriteAllText($target, $original + "`r`n" + $notCounted[$k] + "`r`n")
        $r = Run-Check $copy $base -Scripts @() -Js @() -Py @()
        Yes ("the checker stays green on {0}" -f $k) ($r.Code -eq 0)
    }
    [IO.File]::WriteAllText($target, $original)

    # A file the baseline has never heard of is allowed none.
    $fresh = Join-Path $copy 'Planted.cs'
    [IO.File]::WriteAllText($fresh, "namespace Thornswood { class Planted { void M() { try { M(); } catch { } } } }`r`n")
    $r = Run-Check $copy $base -Scripts @() -Js @() -Py @()
    Yes 'a new file with one empty catch goes red' ($r.Code -eq 1)
    Yes 'and is named as allowed none' ($r.Out -match 'Planted\.cs has 1 silent catches and the baseline allows 0')
    Remove-Item -LiteralPath $fresh -Force

    # A count that falls is red, and lowering that line is what puts it green.
    # Issue #756: it used to pass with a yellow line, so the lowering the rule
    # asks for in words could be left for somebody else, and Checks.cs and
    # Verify.cs each sat a catch above their real count from #706 and #709
    # until the two were found by eye and lowered in #753.
    # Shell.cs has had no empty catch of its own since the last #461 slice
    # (27 Sep, the baseline is at zero), so one is planted in the copy first
    # and the copy's baseline made again to allow it. Taking it out is then
    # the fall, whatever the real count is.
    $shell = Join-Path $copy 'Shell.cs'
    $shellText = [IO.File]::ReadAllText($shell)
    $planted = $shellText + "`r`nclass PlantedFall { void M() { try { M(); } catch { } } }`r`n"
    [IO.File]::WriteAllText($shell, $planted)
    $fallBase = Join-Path $tmp 'fall-baseline.txt'
    $r = Run-Check $copy $base -List -Scripts @() -Js @() -Py @()
    [IO.File]::WriteAllText($fallBase, "# made by test-swallow.ps1 from its own copy, one catch planted in Shell.cs`r`n" + $r.Out)
    $r = Run-Check $copy $fallBase -Scripts @() -Js @() -Py @()
    Yes 'the planted catch in Shell.cs is allowed by a baseline made with it' ($r.Code -eq 0)
    $rx = [regex]'catch \{ \}'
    [IO.File]::WriteAllText($shell, $rx.Replace($planted, 'catch (Exception ex) { Swallow.Note("Shell", ex); }', 1))
    $r = Run-Check $copy $fallBase -Scripts @() -Js @() -Py @()
    Yes 'a file that fell goes red' ($r.Code -eq 1)
    Yes 'and says to lower its line' ($r.Out -match 'DOWN\s+Shell\.cs' -and $r.Out -match 'Lower its line')

    $lowered = Join-Path $tmp 'lowered-baseline.txt'
    $lines = foreach ($l in (Get-Content -LiteralPath $fallBase)) {
        if ($l -match '^(Shell\.cs\s+)(\d+)$') { $Matches[1] + ([int]$Matches[2] - 1) } else { $l }
    }
    [IO.File]::WriteAllText($lowered, (($lines -join "`r`n") + "`r`n"))
    $r = Run-Check $copy $lowered -Scripts @() -Js @() -Py @()
    Yes 'lowering that line in the baseline is what puts it green again' ($r.Code -eq 0)
    Yes 'and it then says the baseline matches' ($r.Out -match 'the baseline matches')
    [IO.File]::WriteAllText($shell, $shellText)

    # A file the baseline still lists and the launcher no longer has is the
    # same fall with nothing left to count, so it is red as well.
    $goneBase = Join-Path $tmp 'gone-baseline.txt'
    [IO.File]::WriteAllText($goneBase, [IO.File]::ReadAllText($base) + "Gone.cs 3`r`n")
    $r = Run-Check $copy $goneBase -Scripts @() -Js @() -Py @()
    Yes 'a baseline line for a file that is not there any more goes red' ($r.Code -eq 1)
    Yes 'and says to take its line out' ($r.Out -match 'GONE\s+Gone\.cs' -and $r.Out -match 'Take its line out')

    # -List prints the baseline's own format, so it can be pasted back in.
    # Three files whose counts are known: two on one line, one across lines,
    # and none at all, which -List leaves out.
    $small = Join-Path $tmp 'small'
    New-Item -ItemType Directory -Force -Path $small | Out-Null
    [IO.File]::WriteAllText((Join-Path $small 'A.cs'), "class A { void M() { try { M(); } catch { } try { M(); } catch (Exception) { } } }`r`n")
    [IO.File]::WriteAllText((Join-Path $small 'B.cs'), "class B { void M() { try { M(); } catch (Exception ex) { Swallow.Note(`"B.M`", ex); } } }`r`n")
    [IO.File]::WriteAllText((Join-Path $small 'C.cs'), "class C`r`n{`r`n    void M()`r`n    {`r`n        try { M(); }`r`n        catch`r`n        {`r`n        }`r`n    }`r`n}`r`n")
    $r = Run-Check $small $base -List -Scripts @() -Js @() -Py @()
    $listed = @($r.Out -split "`r?`n" | Where-Object { $_.Trim() })
    Yes '-List prints "A.cs 2" and "C.cs 1" and leaves out the file with none' (($listed -join '|') -eq 'A.cs 2|C.cs 1')
    $smallBase = Join-Path $tmp 'small-baseline.txt'
    [IO.File]::WriteAllText($smallBase, "# the rule`r`nA.cs 2`r`nC.cs 0`r`n")
    $r = Run-Check $small $smallBase -Scripts @() -Js @() -Py @()
    Yes 'the line number of a catch whose braces sit on their own lines is the catch' ($r.Code -eq 1 -and $r.Out -match 'C\.cs has 1 silent catches and the baseline allows 0\. They are on lines 6\.')

    # A baseline line that is neither a comment nor a name and a number is
    # refused, not read as zero or skipped.
    [IO.File]::WriteAllText($smallBase, "# the rule`r`nA.cs 2`r`nC.cs one`r`n")
    $r = Run-Check $small $smallBase -Scripts @() -Js @() -Py @()
    Yes 'a baseline line that is not a name and a number is refused' ($r.Code -eq 1 -and $r.Out -match 'line 3 of the baseline')

    # ---- 3b. the scripts (#2711) -------------------------------------------------
    #
    # Nothing counted a .ps1 until #2711: two empty catches in
    # New-ClientBuildRecord.ps1 wrote the client record over checks that had
    # not run. A tree of its own, an empty launcher folder, and one script.
    $psRoot = Join-Path $tmp 'repo'
    $psDir = Join-Path $psRoot 'scripts\release'
    $emptyApp = Join-Path $psRoot 'launcher\app'
    New-Item -ItemType Directory -Force -Path $psDir, $emptyApp, (Join-Path $psRoot 'installer') | Out-Null
    $psScripts = @((Join-Path $psRoot 'scripts'), (Join-Path $psRoot 'installer'))
    $psFile = Join-Path $psDir 'Planted.ps1'
    $psBase = Join-Path $tmp 'ps-baseline.txt'
    [IO.File]::WriteAllText($psBase, "# the rule`r`n")
    [IO.File]::WriteAllText($psFile, "param()`r`nWrite-Host 'nothing caught here'`r`n")
    $r = Run-Check $emptyApp $psBase -Scripts $psScripts -Js @() -Py @() -Root $psRoot
    Yes 'a script with no empty catch passes' ($r.Code -eq 0)

    $psCounted = [ordered]@{
        'the recorded-base read #2711 found, an empty catch on one line' = 'try { $recordedBase = [string]((Get-Content -LiteralPath $p -Raw | ConvertFrom-Json).upstreamBase) } catch { }'
        'the checks block #2711 found, an empty catch closing a try of several lines' = "try {`r`n  `$dirty = git status`r`n} catch { }"
        'an empty catch that names one type'                  = 'try { x } catch [System.IO.IOException] { }'
        'an empty catch that names two types'                 = 'try { x } catch [System.IO.IOException], [System.UnauthorizedAccessException] { }'
        'an empty catch with its braces on lines of their own' = "try { x }`r`ncatch`r`n{`r`n`r`n}"
        'an empty catch inside a here-string another machine runs' = "`$remote = @'`r`ntry { x } catch { }`r`n'@"
    }
    foreach ($k in $psCounted.Keys) {
        [IO.File]::WriteAllText($psFile, "param()`r`n" + $psCounted[$k] + "`r`n")
        $r = Run-Check $emptyApp $psBase -Scripts $psScripts -Js @() -Py @() -Root $psRoot
        Yes ("the checker goes red on {0}" -f $k) ($r.Code -eq 1)
        Yes '  and names the script by its path from the root, allowed none' ($r.Out -match 'scripts\\release\\Planted\.ps1 has 1 silent catches and the baseline allows 0')
    }
    $psNotCounted = [ordered]@{
        'a script catch whose body is only a # comment'   = "try { x } catch {`r`n  # nothing to be done, and this says why`r`n}"
        'a script catch whose body is only a block comment' = 'try { x } catch { <# not worth stopping for #> }'
        'a script catch that stops with what it could not do' = 'try { x } catch { throw "could not x: $($_.Exception.Message)" }'
    }
    foreach ($k in $psNotCounted.Keys) {
        [IO.File]::WriteAllText($psFile, "param()`r`n" + $psNotCounted[$k] + "`r`n")
        $r = Run-Check $emptyApp $psBase -Scripts $psScripts -Js @() -Py @() -Root $psRoot
        Yes ("the checker stays green on {0}" -f $k) ($r.Code -eq 0)
    }
    # The installer is read as well, and -List writes a script's line in the
    # baseline's own format.
    [IO.File]::WriteAllText($psFile, "param()`r`n")
    [IO.File]::WriteAllText((Join-Path $psRoot 'installer\Setup.ps1'), "try { a } catch { }`r`ntry { b } catch { }`r`n")
    $r = Run-Check $emptyApp $psBase -Scripts $psScripts -Js @() -Py @() -Root $psRoot -List
    Yes '-List prints "installer\Setup.ps1 2" and leaves out the script with none' (((@($r.Out -split "`r?`n" | Where-Object { $_.Trim() })) -join '|') -eq 'installer\Setup.ps1 2')
    [IO.File]::WriteAllText($psBase, "# the rule`r`ninstaller\Setup.ps1 2`r`n")
    $r = Run-Check $emptyApp $psBase -Scripts $psScripts -Js @() -Py @() -Root $psRoot
    Yes 'a baseline line keyed by that path lets the script pass' ($r.Code -eq 0)

    # The real record scripts hold none now, so the real baseline allows them
    # none and one coming back turns the build red.
    $listed = (Run-Check $AppDir $Baseline -List).Out
    foreach ($n in 'scripts\release\New-ClientBuildRecord.ps1', 'scripts\release\New-ServerBuildRecord.ps1', 'scripts\release\Check-Records.ps1') {
        Yes ("{0} has no silent catch and no line in the baseline" -f $n) ($listed -notmatch [regex]::Escape($n) -and $baseText -notmatch ('(?m)^' + [regex]::Escape($n) + '\s+\d+\s*$'))
    }

    # ---- 3c. the site, voice and the bot (#2736) ---------------------------------
    #
    # Nothing counted a .js or a .py until #2736: the /api/play/logs handler in
    # site\server.js stored a session's logs, answered ok, and lost the trouble
    # colour and the bot's crash note inside try { ... } catch (e) { } with
    # nothing said. A tree of its own: an empty launcher folder, no scripts,
    # and one file in each of site\, voice\ and bot\.
    $jsRoot = Join-Path $tmp 'repo-js'
    $jsApp = Join-Path $jsRoot 'launcher\app'
    $jsSite = Join-Path $jsRoot 'site'
    $jsVoice = Join-Path $jsRoot 'voice'
    $jsBot = Join-Path $jsRoot 'bot'
    New-Item -ItemType Directory -Force -Path $jsApp, $jsSite, $jsVoice, $jsBot | Out-Null
    $jsDirs = @($jsSite, $jsVoice)
    $pyDirs = @($jsBot)
    $jsFile = Join-Path $jsSite 'server.js'
    $pyFile = Join-Path $jsBot 'bot.py'
    $jsBase = Join-Path $tmp 'js-baseline.txt'
    [IO.File]::WriteAllText($jsBase, "# the rule`r`n")
    [IO.File]::WriteAllText($jsFile, "'use strict';`r`n")
    [IO.File]::WriteAllText($pyFile, "import os`r`n")
    function Run-JsCheck([switch]$List) {
        return (Run-Check $jsApp $jsBase -List:$List -Scripts @() -Js $jsDirs -Py $pyDirs -Root $jsRoot)
    }
    $r = Run-JsCheck
    Yes 'a site file and a bot file with no empty catch pass' ($r.Code -eq 0)

    $jsCounted = [ordered]@{
        'the /api/play/logs block #2736 found, a try of several lines closed by an empty catch' = "try {`r`n  const found = readTrouble(logs);`r`n  applyTrouble(row, found);`r`n} catch (e) { }"
        'a JavaScript catch with a name and an empty body on one line' = 'try { fs.unlinkSync(p); } catch (e) { }'
        'a JavaScript catch with no name and no space'                 = 'try { x(); } catch {}'
        'a JavaScript catch with its braces on lines of their own'     = "try { x(); }`r`ncatch (e)`r`n{`r`n`r`n}"
        'a promise .catch handed an empty arrow'                       = 'run.catch(() => { });'
        'a promise .catch handed an empty arrow with a parameter'      = 'p.catch((e) => {});'
        'a promise .catch handed an empty arrow with a bare parameter' = 'p.catch(e => {});'
        'a promise .catch handed an empty function'                    = "p.then(go).catch(function () {`r`n});"
    }
    foreach ($k in $jsCounted.Keys) {
        [IO.File]::WriteAllText($jsFile, "'use strict';`r`n" + $jsCounted[$k] + "`r`n")
        $r = Run-JsCheck
        Yes ("the checker goes red on {0}" -f $k) ($r.Code -eq 1)
        Yes '  and names site\server.js by its path from the root, allowed none' ($r.Out -match 'site\\server\.js has 1 silent catches and the baseline allows 0')
    }
    $jsNotCounted = [ordered]@{
        'a JavaScript catch whose body is only a // comment'   = "try { x(); } catch (e) {`r`n  // nothing to be done, and this says why`r`n}"
        'a JavaScript catch whose body is only a block comment' = 'try { x(); } catch (e) { /* the caller hears it through run */ }'
        'a JavaScript catch that says what failed in the log'   = "try { x(); } catch (e) { console.error('[thornswood-docs] x failed ' + JSON.stringify({ code: e.code })); }"
        'a promise .catch that hands the failure on'             = 'done.catch((e) => failed(req, res, e));'
        'a promise .catch whose arrow body is a comment'         = 'run.catch(() => { /* the caller has run and hears it there */ });'
        'an empty .then, which is not a catch'                    = 'p.then(() => {});'
    }
    foreach ($k in $jsNotCounted.Keys) {
        [IO.File]::WriteAllText($jsFile, "'use strict';`r`n" + $jsNotCounted[$k] + "`r`n")
        $r = Run-JsCheck
        Yes ("the checker stays green on {0}" -f $k) ($r.Code -eq 0)
    }
    [IO.File]::WriteAllText($jsFile, "'use strict';`r`n")

    $pyCounted = [ordered]@{
        'a Python except whose body is pass on the line below' = "def f():`r`n    try:`r`n        g()`r`n    except Exception:`r`n        pass`r`n"
        'a Python except: pass on one line'                    = "try:`r`n    g()`r`nexcept: pass`r`n"
        'a Python except naming two types, a blank line, then pass' = "class C:`r`n    def f(self):`r`n        try:`r`n            g()`r`n        except (OSError, ValueError) as e:`r`n`r`n            pass`r`n        return 1`r`n"
        'a Python except: pass as the last line of the file'   = "try:`r`n    g()`r`nexcept OSError:`r`n    pass"
    }
    foreach ($k in $pyCounted.Keys) {
        [IO.File]::WriteAllText($pyFile, "import os`r`n" + $pyCounted[$k])
        $r = Run-JsCheck
        Yes ("the checker goes red on {0}" -f $k) ($r.Code -eq 1)
        Yes '  and names bot\bot.py by its path from the root, allowed none' ($r.Out -match 'bot\\bot\.py has 1 silent catches and the baseline allows 0')
    }
    [IO.File]::WriteAllText($pyFile, "import os`r`ntry:`r`n    g()`r`nexcept OSError:`r`n    pass`r`n")
    $r = Run-JsCheck
    Yes 'the line named for a Python except is the except line' ($r.Out -match 'bot\\bot\.py has 1 silent catches and the baseline allows 0\. They are on lines 4\.')
    $pyNotCounted = [ordered]@{
        'a Python except whose body is a comment and pass'       = "try:`r`n    g()`r`nexcept OSError:`r`n    # the file may be gone already, and that is the point`r`n    pass`r`n"
        'a Python except with a comment on its own line'         = "try:`r`n    g()`r`nexcept OSError:  # gone already is fine`r`n    pass`r`n"
        'a Python except whose pass has a comment beside it'     = "try:`r`n    g()`r`nexcept OSError:`r`n    pass  # gone already is fine`r`n"
        'a Python except that logs'                              = "try:`r`n    g()`r`nexcept OSError as e:`r`n    say('could not g: %s' % e.errno)`r`n"
        'a Python except whose body is pass and then more'       = "try:`r`n    g()`r`nexcept OSError:`r`n    pass`r`n    tried = False`r`n"
        'a Python except that hands the failure on'              = "try:`r`n    g()`r`nexcept OSError:`r`n    raise`r`n"
    }
    foreach ($k in $pyNotCounted.Keys) {
        [IO.File]::WriteAllText($pyFile, "import os`r`n" + $pyNotCounted[$k])
        $r = Run-JsCheck
        Yes ("the checker stays green on {0}" -f $k) ($r.Code -eq 0)
    }
    [IO.File]::WriteAllText($pyFile, "import os`r`n")

    # What is never read: somebody else's packages, a vendored minified
    # library, a harness kept beside the code, the bot's installed packages.
    $skipped = [ordered]@{
        'site\node_modules\pkg\index.js'          = 'try { x(); } catch (e) { }'
        'site\public\marked-12.0.2.min.js'        = 'try{x()}catch(e){}'
        'voice\test-planted.js'                   = 'try { x(); } catch (e) { }'
        'bot\test-planted.py'                     = "try:`r`n    g()`r`nexcept Exception:`r`n    pass`r`n"
        'bot\.venv\Lib\site-packages\planted.py'  = "try:`r`n    g()`r`nexcept Exception:`r`n    pass`r`n"
        'bot\__pycache__\planted.py'              = "try:`r`n    g()`r`nexcept Exception:`r`n    pass`r`n"
    }
    foreach ($k in $skipped.Keys) {
        $p = Join-Path $jsRoot $k
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
        [IO.File]::WriteAllText($p, $skipped[$k] + "`r`n")
        $r = Run-JsCheck
        Yes ("an empty catch in {0} is not read" -f $k) ($r.Code -eq 0)
        Remove-Item -LiteralPath $p -Force
    }
    # .mjs and .cjs are JavaScript as much as .js, and voice\ is read too.
    $mjs = Join-Path $jsVoice 'planted.mjs'
    [IO.File]::WriteAllText($mjs, "try { x(); } catch (e) { }`r`n")
    $r = Run-JsCheck
    Yes 'an empty catch in a .mjs under voice\ goes red' ($r.Code -eq 1 -and $r.Out -match 'voice\\planted\.mjs has 1 silent catches')
    Remove-Item -LiteralPath $mjs -Force

    # -List writes the site's and the bot's lines in the baseline's own format.
    [IO.File]::WriteAllText($jsFile, "try { a(); } catch (e) { }`r`nb.catch(() => {});`r`n")
    [IO.File]::WriteAllText($pyFile, "try:`r`n    g()`r`nexcept Exception:`r`n    pass`r`n")
    $r = Run-JsCheck -List
    Yes '-List prints "bot\bot.py 1" and "site\server.js 2"' (((@($r.Out -split "`r?`n" | Where-Object { $_.Trim() })) -join '|') -eq 'bot\bot.py 1|site\server.js 2')
    [IO.File]::WriteAllText($jsBase, "# the rule`r`nbot\bot.py 1`r`nsite\server.js 2`r`n")
    $r = Run-JsCheck
    Yes 'baseline lines keyed by those paths let them pass' ($r.Code -eq 0)

    # The real baseline's own lines hold the real files: a copy of the real
    # site\server.js and bot\bot.py passes against the real numbers, and one
    # more empty catch in either goes red.
    $realRoot = Join-Path $tmp 'repo-real'
    $realApp = Join-Path $realRoot 'launcher\app'
    New-Item -ItemType Directory -Force -Path $realApp, (Join-Path $realRoot 'site'), (Join-Path $realRoot 'bot') | Out-Null
    $realJs = Join-Path $realRoot 'site\server.js'
    $realPy = Join-Path $realRoot 'bot\bot.py'
    Copy-Item -LiteralPath (Join-Path $RepoPath 'site\server.js') -Destination $realJs
    Copy-Item -LiteralPath (Join-Path $RepoPath 'bot\bot.py') -Destination $realPy
    $realLines = @(Get-Content -LiteralPath $Baseline | Where-Object { $_ -match '^(site\\server\.js|bot\\bot\.py)\s+\d+\s*$' })
    $realBase = Join-Path $tmp 'real-baseline.txt'
    [IO.File]::WriteAllText($realBase, "# the real baseline's lines for the two files`r`n" + ($realLines -join "`r`n") + "`r`n")
    $mayJs = 0; $mayPy = 0
    foreach ($l in $realLines) {
        if ($l -match '^site\\server\.js\s+(\d+)') { $mayJs = [int]$Matches[1] }
        if ($l -match '^bot\\bot\.py\s+(\d+)') { $mayPy = [int]$Matches[1] }
    }
    function Run-RealCheck { return (Run-Check $realApp $realBase -Scripts @() -Js @((Join-Path $realRoot 'site')) -Py @((Join-Path $realRoot 'bot')) -Root $realRoot) }
    $r = Run-RealCheck
    Yes 'copies of the real site\server.js and bot\bot.py pass against the real baseline''s lines for them' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out }
    $jsText = [IO.File]::ReadAllText($realJs)
    [IO.File]::WriteAllText($realJs, $jsText + "`r`nfunction planted() { try { planted(); } catch (e) { } }`r`n")
    $r = Run-RealCheck
    Yes ("one more empty catch in site\server.js goes red at {0} against {1}" -f ($mayJs + 1), $mayJs) ($r.Code -eq 1 -and $r.Out -match ("site\\server\.js has {0} silent catches and the baseline allows {1}" -f ($mayJs + 1), $mayJs))
    [IO.File]::WriteAllText($realJs, $jsText)
    $pyText = [IO.File]::ReadAllText($realPy)
    [IO.File]::WriteAllText($realPy, $pyText + "`r`n`r`ndef planted():`r`n    try:`r`n        planted()`r`n    except Exception:`r`n        pass`r`n")
    $r = Run-RealCheck
    Yes ("one more except: pass in bot\bot.py goes red at {0} against {1}" -f ($mayPy + 1), $mayPy) ($r.Code -eq 1 -and $r.Out -match ("bot\\bot\.py has {0} silent catches and the baseline allows {1}" -f ($mayPy + 1), $mayPy))
    [IO.File]::WriteAllText($realPy, $pyText)

    # ---- 4. Swallow.Note, compiled and called ----------------------------------
    #
    # The real Swallow.cs under a namespace of its own, with a stand-in Paths
    # that has only the one field it reads, and a public door into it, since
    # Swallow itself is internal like every class in the launcher. The door is
    # taken from the assembly this build returns, so another copy loaded in
    # the same session cannot answer for it.
    $ns = 'SwallowTest'
    $src = [IO.File]::ReadAllText($SwallowCs)
    Yes 'Swallow.cs sits in the Thornswood namespace' ($src -match 'namespace Thornswood\b')
    $src = $src -replace 'namespace Thornswood\b', ("namespace " + $ns)
    $stand = @"
namespace $ns
{
    static class Paths { public static string LogFile; }
    public static class Door
    {
        public static void SetLog(string p) { Paths.LogFile = p; }
        public static void Fail(string where, string message)
        {
            try { throw new System.IO.IOException(message); }
            catch (System.Exception ex) { Swallow.Note(where, ex); }
        }
        public static void Nothing(string where) { Swallow.Note(where, null); }
    }
}
"@
    $compiled = $false
    $swAsm = $null
    try { $swAsm = Add-LauncherType -Source $src, $stand; $compiled = $true }
    catch { Write-Host ("      " + $_.Exception.Message) }
    Yes 'Swallow.cs compiles on its own with only Paths.LogFile beside it, with the .NET SDK the launcher builds with' $compiled

    if ($compiled) {
        $door = $swAsm.GetType($ns + '.Door', $true)
        $log = Join-Path $tmp 'launcher.log'
        [IO.File]::WriteAllText($log, "2026-09-24 20:00:00  a line that was already there`r`n")
        $door::SetLog($log)
        $door::Fail('Config.Save, writing C:\somewhere\config.json', 'There is not enough space on the disk.')
        $door::Nothing('Keep.Unpark')
        $text = [IO.File]::ReadAllText($log)
        Yes 'Note adds to the log and keeps what was there' ($text -match 'a line that was already there')
        Yes 'Note writes a stamped line naming the place and the exception' (
            $text -match '(?m)^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d  Swallowed in Config\.Save, writing C:\\somewhere\\config\.json: System\.IO\.IOException: There is not enough space on the disk\.')
        Yes 'Note carries the stack, so the line says where it was thrown' ($text -match '\bat SwallowTest\.Door\.Fail')
        Yes 'Note with no exception still writes, and says so' ($text -match 'Swallowed in Keep\.Unpark: no exception given')

        $threw = $null
        try { $door::SetLog($null); $door::Fail('no log set', 'x') } catch { $threw = $_ }
        Yes 'Note does not throw before the log path is set' ($null -eq $threw)

        $threw = $null
        $missing = Join-Path $tmp 'no-such-folder\launcher.log'
        try { $door::SetLog($missing); $door::Fail('folder missing', 'x') } catch { $threw = $_ }
        Yes 'Note does not throw when the log folder is missing' ($null -eq $threw)
        Yes 'and does not make the folder' (-not (Test-Path -LiteralPath (Split-Path -Parent $missing)))

        if ($OnWindows) {
            $threw = $null
            $held = New-Object IO.FileStream($log, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            try { $door::SetLog($log); $door::Fail('log held open', 'x') } catch { $threw = $_ }
            finally { $held.Dispose() }
            Yes 'Note does not throw when something else has the log open' ($null -eq $threw)
        } else {
            Write-Host 'SKIP  4, the log held open: a file held with no sharing refuses a write only on Windows'
        }
    }

    # What Note is allowed to touch. Log is private to Shell and sets the
    # status text, which throws from a pool thread; no control either.
    $body = [regex]::Replace($src, '(?m)^\s*///.*$|//.*$', '')
    Yes 'Swallow.cs never calls Shell.Log' ($body -notmatch '\bLog\s*\(')
    Yes 'Swallow.cs touches no control, window or dispatcher' ($body -notmatch 'txtStatus|Dispatcher|MessageBox|System\.Windows')
    Yes 'Swallow.cs writes straight to Paths.LogFile' ($body -match 'Paths\.LogFile' -and $body -match 'File\.AppendAllText')

    Yes 'Swallow.cs has no silent catch of its own' (-not ([regex]'\bcatch\s*(\([^)]*\))?\s*\{\s*\}').IsMatch($src))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. the places the entry named -------------------------------------------
#
# By signature and by brace match, so a rename fails loudly here rather than
# quietly checking nothing. None of these bodies has a brace inside a string.
function Get-Body([string]$text, [string]$signature) {
    $at = $text.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $open = $text.IndexOf('{', $at + $signature.Length)
    if ($open -lt 0) { return $null }
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($open, $i - $open + 1) } }
    }
    return $null
}

$named = @(
    @{ File = 'Config.cs'; Sig = 'public void Save(string path)';     Name = 'Config.Save' },
    @{ File = 'Swap.cs';   Sig = 'static void DropLink(string p)';    Name = 'Swap.DropLink' },
    @{ File = 'Swap.cs';   Sig = 'public static bool Restore()';      Name = 'Swap.Restore' },
    @{ File = 'Hold.cs';   Sig = 'public static void Release()';      Name = 'Hold.Release' },
    @{ File = 'Keep.cs';   Sig = 'public static int Unpark()';        Name = 'Keep.Unpark' }
)
$silentRx = [regex]'\bcatch\s*(\([^)]*\))?\s*\{\s*\}'
foreach ($n in $named) {
    $text = [IO.File]::ReadAllText((Join-Path $AppDir $n.File))
    $b = Get-Body $text $n.Sig
    Yes ("{0} is found by its signature in {1}" -f $n.Name, $n.File) ($null -ne $b)
    if ($null -eq $b) { continue }
    $catches = ([regex]'\bcatch\s*[\({]').Matches($b).Count
    $notes = ([regex]('Swallow\.Note\("' + [regex]::Escape($n.Name))).Matches($b).Count
    Yes ("{0} has no silent catch left" -f $n.Name) (-not $silentRx.IsMatch($b))
    Yes ("every catch in {0} logs under its own name ({1} of {2})" -f $n.Name, $notes, $catches) ($catches -gt 0 -and $notes -eq $catches)
    $code = [regex]::Replace($b, '//.*', '')
    Yes ("{0} still throws nothing" -f $n.Name) ($code -notmatch '\bthrow\b')
}

# What they return and to whom did not change. Save stays void, so its eleven
# callers are the same calls; Unpark still keeps the line it could not put
# back, for next time.
$cfg = [IO.File]::ReadAllText((Join-Path $AppDir 'Config.cs'))
Yes 'Config.Save is still void' ($cfg -match 'public void Save\(string path\)')
$keep = Get-Body ([IO.File]::ReadAllText((Join-Path $AppDir 'Keep.cs'))) 'public static int Unpark()'
Yes 'Keep.Unpark still keeps a plugin it could not put back on the list' ($keep -match 'catch \(Exception ex\) \{ left\.Add\(line\); Swallow\.Note')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
