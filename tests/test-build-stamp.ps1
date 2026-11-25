<#
  test-build-stamp.ps1

      pwsh -NoProfile -File .\tests\test-build-stamp.ps1

  Every gamemode deploy leaves a thornswood-build.json beside the gamemode.js
  it puts in place, saying which commit, which file, which launcher and which
  channel.

  WHY THIS EXISTS. The To Do List entry "The server half is not part of the
  release, and nothing ever compares the client build against the server
  build". Nothing on either server said which gamemode it was running:
  Ship.ps1 never carries it, and Check-LiveGamemode.ps1 can only say whether
  the live file is the one in this repo today. This is the first step, the
  stamp itself. Reading it in the gamemode and on the launcher come after.

  It drives the real functions in BuildStamp.ps1 against a scratch git repo
  with its own release feeds beside it, laid out the way Ship.ps1 expects
  them, so what is under test is the shipped code and not a copy of it. The
  deploy scripts themselves talk to the VPS and are never run here: their
  syntax trees are read instead, to prove each one makes the stamp, from the
  right channel, at the right point, and sends it where the gamemode goes.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoPath) { $RepoPath = $Here }

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

$helper = Join-Path $RepoPath 'scripts\release\BuildStamp.ps1'
Yes 'BuildStamp.ps1 is there' (Test-Path -LiteralPath $helper)

# ---- the deploy scripts, read and never run ----------------------------------
function Read-Ast([string]$name) {
    # In scripts\<area> since phase 8 of issue #440.
    $p = @(Get-ChildItem -LiteralPath (Join-Path $RepoPath 'scripts') -Filter $name -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)[0]
    if (-not $p) { $p = Join-Path $RepoPath $name }
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { return $null }
    return $ast
}
function Commands($ast, [string]$name) {
    if (-not $ast) { return @() }
    return @($ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name
    }, $true))
}
function DotSources($ast, [string]$file) {
    if (-not $ast) { return $false }
    $hits = $ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.CommandAst] -and
        $n.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot
    }, $true)
    foreach ($h in $hits) { if ($h.Extent.Text -like "*$file*") { return $true } }
    return $false
}
# The value given to -Name on a command, as written.
function Arg($cmd, [string]$name) {
    $els = $cmd.CommandElements
    for ($i = 0; $i -lt $els.Count - 1; $i++) {
        if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and
            $els[$i].ParameterName -eq $name) { return $els[$i + 1].Extent.Text }
    }
    return ''
}
# Where a piece of text first appears in the script, as an offset.
function At($ast, [string]$text) {
    if (-not $ast) { return -1 }
    return $ast.Extent.Text.IndexOf($text)
}

# Deploy-Gamemode.ps1, the live half that writes into the local server build.
$dg = Read-Ast 'Deploy-Gamemode.ps1'
Yes 'Deploy-Gamemode.ps1 parses' ($null -ne $dg)
$saves = Commands $dg 'Save-ThornswoodBuildStamp'
Yes 'Deploy-Gamemode.ps1 loads BuildStamp.ps1' (DotSources $dg 'BuildStamp.ps1')
Yes 'Deploy-Gamemode.ps1 makes a stamp, once' ($saves.Count -eq 1)
if ($saves.Count -eq 1) {
    $s = $saves[0]
    Yes 'Deploy-Gamemode.ps1 stamps the main channel' ((Arg $s 'Channel') -eq 'main')
    Yes 'Deploy-Gamemode.ps1 writes thornswood-build.json into the server build, beside gamemode.js' (
        (Arg $s 'Path') -match '\$Dist' -and (Arg $s 'Path') -match 'thornswood-build\.json')
    Yes 'Deploy-Gamemode.ps1 stamps the gamemode it copied' ((Arg $s 'Gamemode') -eq '$Gamemode')
    $copy = @(Commands $dg 'Copy-Item' | Where-Object { $_.Extent.Text -match '\$Gamemode' -and $_.Extent.Text -match 'gamemode\.js' })
    Yes 'Deploy-Gamemode.ps1 stamps straight after the copy, before anything below can stop it' (
        $copy.Count -eq 1 -and $s.Extent.StartOffset -gt $copy[0].Extent.StartOffset -and
        $s.Extent.StartOffset -lt (At $dg 'function Read-PluginHeader'))
}

# Deploy-DevGamemode.ps1, which sends straight to the dev server.
$dd = Read-Ast 'Deploy-DevGamemode.ps1'
Yes 'Deploy-DevGamemode.ps1 parses' ($null -ne $dd)
$saves = Commands $dd 'Save-ThornswoodBuildStamp'
Yes 'Deploy-DevGamemode.ps1 loads BuildStamp.ps1' (DotSources $dd 'BuildStamp.ps1')
Yes 'Deploy-DevGamemode.ps1 makes a stamp, once' ($saves.Count -eq 1)
if ($saves.Count -eq 1) {
    $s = $saves[0]
    Yes 'Deploy-DevGamemode.ps1 stamps the dev channel' ((Arg $s 'Channel') -eq 'dev')
    Yes 'Deploy-DevGamemode.ps1 stamps the gamemode it sends' ((Arg $s 'Gamemode') -eq '$Gamemode')
    Yes 'Deploy-DevGamemode.ps1 makes the stamp before the dev server is stopped' (
        $s.Extent.StartOffset -lt (At $dd "Write-Host 'Stopping the dev server...'"))
    # Since issue #446 both go into the stage in one list, and the stage is
    # swapped in whole, so the stamp and the gamemode it names go live, and
    # come back out on a rollback, together.
    $gm = $dd.Extent.Text.IndexOf("`$send['gamemode.js'] = `$Gamemode")
    $st = $dd.Extent.Text.IndexOf("`$send['thornswood-build.json'] = `$stampFile")
    $scps = @(Commands $dd 'scp' | Where-Object { $_.Extent.Text -match '\$send\[\$rel\]' -and $_.Extent.Text -match '\$stageFar/\$rel' })
    Yes 'Deploy-DevGamemode.ps1 sends the stamp beside gamemode.js on the dev server, into the stage' ($st -gt 0 -and $scps.Count -eq 1)
    Yes 'Deploy-DevGamemode.ps1 sends it after gamemode.js' ($gm -gt 0 -and $st -gt $gm)
    Yes 'Deploy-DevGamemode.ps1 writes the stamp to the file it sends' ((Arg $s 'Path') -eq '$stampFile')
}

# Deploy-Server.ps1, which carries the build Deploy-Gamemode.ps1 made up to live.
$ds = Read-Ast 'Deploy-Server.ps1'
Yes 'Deploy-Server.ps1 parses' ($null -ne $ds)
Yes 'Deploy-Server.ps1 loads BuildStamp.ps1' (DotSources $ds 'BuildStamp.ps1')
$tests = @(Commands $ds 'Test-ThornswoodBuildStamp')
$saves = @(Commands $ds 'Save-ThornswoodBuildStamp')
Yes 'Deploy-Server.ps1 checks the stamp describes the gamemode it is about to send' (
    $tests.Count -eq 1 -and (Arg $tests[0] 'Gamemode') -eq '$built')
Yes 'Deploy-Server.ps1 makes it again, on the main channel, when it does not' (
    $saves.Count -eq 1 -and (Arg $saves[0] 'Channel') -eq 'main')
# Deploy-Server stages every file beside the live folder, checks it there and
# only then stops the server and swaps the stage in (entry 209). So the stamp
# is settled before anything is staged, and it goes up as one of the staged
# files, which tests\test-deploy-server-swap.ps1 proves land beside
# gamemode.js on a good deploy and go back with it on a rollback.
$staging = At $ds 'Write-Host "Staging in'
Yes 'Deploy-Server.ps1 settles the stamp before anything is staged, so before the server is stopped' (
    $tests.Count -eq 1 -and $staging -ge 0 -and $tests[0].Extent.StartOffset -lt $staging -and
    $staging -lt (At $ds "Write-Host 'Stopping, swapping in and starting...'"))
$st = @($ds.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $n.Left.Extent.Text -eq "`$send['thornswood-build.json']" -and $n.Right.Extent.Text -eq '$stampPath'
}, $true))
Yes 'Deploy-Server.ps1 stages thornswood-build.json with gamemode.js, so it is swapped in beside it' (
    $st.Count -eq 1 -and $st[0].Extent.StartOffset -lt (At $ds '$hashes = [ordered]@{}'))

if (-not (Test-Path -LiteralPath $helper)) { Done }
. $helper
# The rule the stamp's launcher number follows, to say what it should be.
. (Join-Path $RepoPath 'scripts\release\LauncherVersion.ps1')

# ---- a scratch repo, and the feeds where Ship.ps1 keeps them (#907) --------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-build-stamp-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$repo = Join-Path $tmp 'Thornswood-Repo'
$mainFeed = Join-Path $tmp 'appdata\Thornswood\feed\main'
$devFeed = Join-Path $tmp 'appdata\Thornswood\feed\dev'
$noGit = Join-Path $tmp 'not-a-repo'
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $d = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($path, $text, $utf8)
}
# Not named Git: PowerShell looks up a function before a program, so a function
# called Git that calls git calls itself for ever.
function Run-Git { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; & git @args 2>&1 | Out-Null; $ErrorActionPreference = $old }
function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

# git is never allowed to wander up out of the scratch folder into a real repo.
$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = $tmp
# The working copies of the feeds are under LOCALAPPDATA (Feed-Store.ps1).
$oldAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path $tmp 'appdata'

try {
    $gm = Join-Path $repo 'game\gamemode.js'
    Put $gm "'use strict';`nconsole.log('gamemode');`n"
    Put (Join-Path $repo 'launcher\app\Updater.cs') "namespace T {`n    public static class Updater {`n        public const string Version = `"0.0.0`";`n    }`n}`n"
    Put (Join-Path $repo 'version.json') '{ "launcherVersion": "0.9.9" }'
    Put (Join-Path $mainFeed 'version.json') '{ "launcherVersion": "1.2.3" }'
    Put (Join-Path $devFeed 'version.json') '{ "launcherVersion": "1.2.3.4" }'
    New-Item -ItemType Directory -Force -Path $noGit | Out-Null
    Put (Join-Path $noGit 'gamemode.js') "console.log('elsewhere');`n"

    Run-Git -C $repo init -q
    Run-Git -C $repo add -A
    Run-Git -C $repo -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m 'scratch'
    $head = ''
    try { $head = ((& git -C $repo rev-parse --short HEAD) | Out-String).Trim() } catch { }
    Yes "the scratch repo has a commit to stamp ($head)" ([bool]$head)
    # Updater.cs holds 0.0.0 in git, and the launcher's number is the time of
    # the commit that last changed its sources, this one (LauncherVersion.ps1).
    $lv = ''
    try {
        $ct = [long](((& git -C $repo log -1 --format=%ct HEAD) | Out-String).Trim())
        $lv = Format-LauncherVersion ([DateTimeOffset]::FromUnixTimeSeconds($ct).UtcDateTime)
    } catch { }
    Yes "the launcher's number for the scratch commit is known ($lv)" ($lv -match '^\d{4}\.\d+\.\d+$')

    # ---- main ---------------------------------------------------------------
    $m = New-ThornswoodBuildStamp -Gamemode $gm -Channel main -RepoDir $repo
    Yes 'main: the channel is main' ($m.channel -eq 'main')
    Yes "main: the commit is the repo's own short commit" ($head -and $m.commit -eq $head)
    Yes 'main: the gamemode is the committed one' ($m.gamemodeMatchesCommit -eq $true)
    Yes 'main: the hash is the gamemode file' ($m.gamemodeSha256 -eq (Sha $gm))
    Yes 'main: the launcher version is main''s number for these sources, from git' ($lv -and $m.launcherVersion -eq $lv)
    Yes 'main: the feed version is this machine''s working copy of the main feed' ($m.feedVersion -eq '1.2.3')
    Yes 'main: the time is UTC in ISO form' ($m.stampedUtc -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
    $t = [DateTime]::ParseExact($m.stampedUtc, "yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
    Yes 'main: and it is now' ([Math]::Abs(([DateTime]::UtcNow - $t).TotalMinutes) -lt 5)
    Yes 'main: exactly the seven fields, in order' (
        (@($m.Keys) -join ',') -eq 'channel,commit,gamemodeMatchesCommit,gamemodeSha256,launcherVersion,feedVersion,stampedUtc')

    # ---- dev ----------------------------------------------------------------
    $d = New-ThornswoodBuildStamp -Gamemode $gm -Channel dev -RepoDir $repo
    Yes 'dev: the channel is dev' ($d.channel -eq 'dev')
    Yes 'dev: the launcher version is still main''s number, not the dev one' ($lv -and $d.launcherVersion -eq $lv)
    Yes 'dev: the feed version is the four part number only the dev feed has' ($d.feedVersion -eq '1.2.3.4')

    # ---- written to disk, and read the way the gamemode will read it -------
    $out = Join-Path $tmp 'dist\thornswood-build.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
    $saved = Save-ThornswoodBuildStamp -Gamemode $gm -Channel main -RepoDir $repo -Path $out
    Yes 'saved: the file is there' (Test-Path -LiteralPath $out)
    $bytes = [IO.File]::ReadAllBytes($out)
    Yes 'saved: no byte order mark, the first byte is {' ($bytes.Length -gt 0 -and $bytes[0] -eq 0x7B)
    $raw = [IO.File]::ReadAllText($out)
    Yes 'saved: the hash in the file is the gamemode' ($raw -match ('"gamemodeSha256":\s*"' + (Sha $gm) + '"'))
    Yes 'saved: what it hands back is what it wrote' ($saved.gamemodeSha256 -eq (Sha $gm) -and $saved.channel -eq 'main')
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $check = Join-Path $tmp 'read.js'
        Put $check ("const lv = process.argv[3];`n" + "const j = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));`n" +
                    "process.exitCode = j.channel === 'main' && j.launcherVersion === lv && j.gamemodeMatchesCommit === true ? 0 : 3;`n")
        & node $check $out $lv
        Yes 'saved: node reads it with JSON.parse, as the gamemode will' ($LASTEXITCODE -eq 0)
    } else {
        Write-Host 'SKIP  node is not on this machine, so the JSON.parse read was not tried'
    }
    Yes 'saved: the stamp describes the gamemode beside it' (Test-ThornswoodBuildStamp -Path $out -Gamemode $gm)

    # ---- the gamemode edited and not committed ------------------------------
    Put $gm "'use strict';`nconsole.log('gamemode, edited');`n"
    $e = New-ThornswoodBuildStamp -Gamemode $gm -Channel dev -RepoDir $repo
    Yes 'edited: the commit alone would lie, and the stamp says so' ($e.commit -eq $head -and $e.gamemodeMatchesCommit -eq $false)
    Yes 'edited: the hash follows the file, not the commit' ($e.gamemodeSha256 -eq (Sha $gm) -and $e.gamemodeSha256 -ne $m.gamemodeSha256)
    Yes 'edited: the old stamp no longer describes it' (-not (Test-ThornswoodBuildStamp -Path $out -Gamemode $gm))
    $null = Save-ThornswoodBuildStamp -Gamemode $gm -Channel main -RepoDir $repo -Path $out
    Yes 'edited: a fresh stamp does' (Test-ThornswoodBuildStamp -Path $out -Gamemode $gm)
    Yes 'the one line a deploy prints says so too' ((Format-ThornswoodBuildStamp $e) -match 'uncommitted')

    # ---- a gamemode git cannot speak for ------------------------------------
    $o = New-ThornswoodBuildStamp -Gamemode (Join-Path $noGit 'gamemode.js') -Channel main -RepoDir $repo
    Yes 'outside the repo: the commit is still read' ($o.commit -eq $head)
    Yes 'outside the repo: whether it is at that commit is unknown, not true' ($null -eq $o.gamemodeMatchesCommit)

    # ---- no git at all, under Stop as the deploy scripts run -----------------
    $n = $null; $threw = $false
    try { $n = New-ThornswoodBuildStamp -Gamemode (Join-Path $noGit 'gamemode.js') -Channel main -RepoDir $noGit } catch { $threw = $true }
    Yes 'no repo: a stamp is still made, and nothing throws' (-not $threw -and $null -ne $n)
    Yes 'no repo: the commit is empty rather than invented' ($n -and $n.commit -eq '' -and $null -eq $n.gamemodeMatchesCommit)
    Yes 'no repo: the hash is still there' ($n -and $n.gamemodeSha256 -eq (Sha (Join-Path $noGit 'gamemode.js')))

    # ---- run from a worktree, which is how these runs happen --------------
    #
    # A worktree's parent is .claude\worktrees, with no feed beside it. The
    # feeds are this machine's, so a worktree finds the same ones.
    $wt = Join-Path $tmp 'wt\deeper\Thornswood-Repo-wt'
    Run-Git -C $repo worktree add -q $wt
    $w = $null
    if (Test-Path -LiteralPath (Join-Path $wt 'game\gamemode.js')) {
        $w = New-ThornswoodBuildStamp -Gamemode (Join-Path $wt 'game\gamemode.js') -Channel main -RepoDir $wt
    }
    Yes 'worktree: the scratch worktree is there' ($null -ne $w)
    Yes 'worktree: main finds the same main feed' ($w -and $w.feedVersion -eq '1.2.3')
    Yes 'worktree: the commit and the launcher are the worktree''s own' (
        $w -and $w.commit -eq $head -and $w.launcherVersion -eq $lv -and $w.gamemodeMatchesCommit -eq $true)
    if ($w) {
        $w = New-ThornswoodBuildStamp -Gamemode (Join-Path $wt 'game\gamemode.js') -Channel dev -RepoDir $wt
    }
    Yes 'worktree: dev finds the dev feed the same way' ($w -and $w.feedVersion -eq '1.2.3.4')

    # ---- no feed received: empty, and not the stale file inside the repo ----
    #
    # Ship.ps1 falls back to the version.json in the source repo. That file
    # stopped being the feed when releases moved out, and on 24 September it
    # said 1.0.196 against a real 1.1.92, so the stamp does not read it.
    Remove-Item -LiteralPath (Join-Path $mainFeed 'version.json') -Force
    $f = New-ThornswoodBuildStamp -Gamemode $gm -Channel main -RepoDir $repo
    Yes 'no feed received: the feed version is empty, not the stale one inside the repo' ($f.feedVersion -eq '')
    Remove-Item -LiteralPath (Join-Path $devFeed 'version.json') -Force
    $f = New-ThornswoodBuildStamp -Gamemode $gm -Channel dev -RepoDir $repo
    Yes 'no dev feed: the feed version is empty and the rest is there' ($f.feedVersion -eq '' -and $f.gamemodeSha256 -eq (Sha $gm))

    # ---- what it refuses ------------------------------------------------------
    $threw = $false
    try { $null = New-ThornswoodBuildStamp -Gamemode $gm -Channel live -RepoDir $repo } catch { $threw = $true }
    Yes 'a channel that is neither main nor dev is refused' $threw
    $threw = $false
    try { $null = New-ThornswoodBuildStamp -Gamemode (Join-Path $tmp 'nothing.js') -Channel main -RepoDir $repo } catch { $threw = $true }
    Yes 'a gamemode that is not there is refused rather than stamped' $threw
    Yes 'a missing stamp does not describe anything' (-not (Test-ThornswoodBuildStamp -Path (Join-Path $tmp 'none.json') -Gamemode $gm))
    Put (Join-Path $tmp 'torn.json') '{ "gamemodeSha256": '
    Yes 'a stamp cut off half way does not either' (-not (Test-ThornswoodBuildStamp -Path (Join-Path $tmp 'torn.json') -Gamemode $gm))
}
finally {
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
    $env:LOCALAPPDATA = $oldAppData
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
