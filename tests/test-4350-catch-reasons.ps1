<#
  test-4350-catch-reasons.ps1

  Issue #4350. The silent-catch check counted only a catch with an empty
  body, so the launcher's line in the baseline reached 0 while 182 of its
  catches ran code, wrote no line and carried on with a default:
  catch { return null; } around the manifest check before Play, and
  Http.GetOrNull's catch, which named five kinds in a when filter and
  returned null, so the headcount failed with nothing said.

  What this drives, all of it the real Check-Swallow.ps1:

    1. A launcher catch that neither uses its exception nor throws nor says
       why in a comment goes red, in each shape it was found in. The shapes
       that do one of those stay green. A brace or the word catch inside a
       string or a comment is not read as code.
    2. The real launcher passes against the real baseline, and the
       baseline holds the launcher's lines, so the count is frozen and can
       only fall: one more such catch in a copy of a real file goes red.
    3. The three paths say why: Http.GetOrNull hands its callers the reason
       and has no overload that drops it, Verify.Manifest and Online.AskPort
       write it, and none of the nine catches on those paths is counted.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
if (-not $RepoPath) { $RepoPath = Split-Path -Parent $PSScriptRoot }
$Checker  = Join-Path $RepoPath 'scripts/dev/Check-Swallow.ps1'
$Baseline = Join-Path $RepoPath 'scripts/dev/swallow-baseline.txt'
$AppDir   = Join-Path $RepoPath 'launcher/app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The launcher only: no scripts, site, voice or bot, which keep their rule.
function Run-Check([string]$app, [string]$base, [switch]$List, [switch]$All) {
    $global:LASTEXITCODE = 0
    $a = @{ AppDir = $app; Baseline = $base }
    # The whole tree reads the scripts, site, voice and bot as well, since
    # the real baseline holds their lines too.
    if (-not $All) { $a.ScriptDirs = @(); $a.JsDirs = @(); $a.PyDirs = @() }
    if ($List) { $a.List = $true }
    $out = & $Checker @a 6>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4350-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    # ---- 1. the rule, on planted files ------------------------------------
    $app = Join-Path $tmp 'app'
    New-Item -ItemType Directory -Force -Path $app | Out-Null
    $none = Join-Path $tmp 'none.txt'
    [IO.File]::WriteAllText($none, "# allows none`r`n")
    $file = Join-Path $app 'Planted.cs'
    function Plant([string]$body) {
        [IO.File]::WriteAllText($file, "using System;`r`nnamespace Thornswood`r`n{`r`n    static class Planted`r`n    {`r`n        static object M(string url)`r`n        {`r`n            object got = null;`r`n            " + $body + "`r`n            return got;`r`n        }`r`n    }`r`n}`r`n")
        return (Run-Check $app $none)
    }

    $counted = [ordered]@{
        'the manifest check''s shape, a bare catch that sets a default and returns' = 'try { got = M(url); } catch { got = url; return null; }'
        'a bare catch that only returns a default'            = 'try { got = M(url); } catch { return null; }'
        'a catch that names a type and only continues'        = 'foreach (var x in new int[1]) { try { got = M(url); } catch (System.IO.IOException) { continue; } }'
        'a catch that names its variable and never reads it'  = 'try { got = M(url); } catch (Exception ex) { got = 0; }'
        'Http.GetOrNull''s shape, a filter that reads it and a body that drops it' = 'try { got = M(url); } catch (Exception ex) when (ex is System.IO.IOException || ex is TimeoutException) { return null; }'
        'a catch with its comment beside it, not in it'      = "try { got = M(url); } catch { got = 1; }   // open elsewhere"
        'a catch whose only ex is inside a plain string'      = 'try { got = M(url); } catch (Exception ex) { got = "ex"; }'
        'a catch whose only ex is inside a comment beside it' = "try { got = M(url); } catch (Exception ex) { got = 2; } // ex"
        'an empty catch, still'                               = 'try { got = M(url); } catch { }'
        'a catch whose braces sit on lines of their own'      = "try { got = M(url); }`r`n            catch`r`n            {`r`n                got = 3;`r`n            }"
    }
    foreach ($k in $counted.Keys) {
        $r = Plant $counted[$k]
        Yes ("red on {0}" -f $k) ($r.Code -eq 1 -and $r.Out -match 'Planted\.cs has 1 silent catches and the baseline allows 0')
    }

    $notCounted = [ordered]@{
        'a catch that logs it with Swallow.Note'            = 'try { got = M(url); } catch (Exception ex) { Swallow.Note("Planted.M", ex); return null; }'
        'a catch that reads it into a reason'               = 'try { got = M(url); } catch (Exception ex) { got = ex.GetType().Name + ": " + ex.Message; }'
        'a catch that reads it in an interpolated string'   = 'try { got = M(url); } catch (Exception ex) { got = $"could not read {url}: {ex.Message}"; }'
        'a catch that hands it on with throw'               = 'try { got = M(url); } catch { throw; }'
        'a catch that wraps it in a new one'                = 'try { got = M(url); } catch (System.IO.IOException e) { throw new InvalidOperationException("no", e); }'
        'a catch whose body says why in a comment'          = "try { got = M(url); }`r`n            catch`r`n            {`r`n                // The file may be gone already, which is the point.`r`n                got = 4;`r`n            }"
        'a catch whose body says why in a block comment'    = 'try { got = M(url); } catch { /* gone already is fine */ got = 5; }'
        'no catch at all, only the word in a string'        = 'got = "try { x(); } catch { return null; }";'
        'no catch at all, only the word in a comment'       = '// catch { return null; } was here'
        'a verbatim string with a brace before a real catch that logs' = 'got = @"{ ""catch"" "; try { got = M(url); } catch (Exception ex) { Swallow.Note("P", ex); }'
        'a char brace before a real catch that logs'        = "got = '{'; try { got = M(url); } catch (Exception ex) { Swallow.Note(`"P`", ex); }"
    }
    foreach ($k in $notCounted.Keys) {
        $r = Plant $notCounted[$k]
        Yes ("green on {0}" -f $k) ($r.Code -eq 0)
        if ($r.Code -ne 0) { Write-Host $r.Out }
    }

    # The line named is the catch's own, after a string holding a new line.
    $r = Plant "got = @`"one`r`ntwo`";`r`n            try { got = M(url); } catch { return null; }"
    Yes 'the line named is the catch, past a verbatim string of two lines' ($r.Out -match 'They are on lines 11\.')

    # ---- 2. the real launcher, frozen ---------------------------------------
    $r = Run-Check $AppDir $Baseline -All
    Yes 'the real tree matches the real baseline' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out }

    $listed = @{}
    foreach ($l in ((Run-Check $AppDir $Baseline -List).Out -split "`r?`n")) { if ($l -match '^(\S+\.cs)\s+(\d+)\s*$') { $listed[$Matches[1]] = [int]$Matches[2] } }
    $held = @{}
    foreach ($l in (Get-Content -LiteralPath $Baseline)) { if ($l -match '^([^\\\s]+\.cs)\s+(\d+)\s*$') { $held[$Matches[1]] = [int]$Matches[2] } }
    $sum = 0; foreach ($v in $held.Values) { $sum += $v }
    Yes ("the baseline holds the launcher's lines ({0} in {1} files)" -f $sum, $held.Count) ($held.Count -gt 0 -and $sum -gt 0)
    $same = ($listed.Count -eq $held.Count)
    foreach ($k in $listed.Keys) { if (-not $held.ContainsKey($k) -or $held[$k] -ne $listed[$k]) { $same = $false } }
    Yes 'each launcher line is what the file holds today' $same

    # One more in a copy of a real file goes red against the real number.
    $copy = Join-Path $tmp 'real'
    New-Item -ItemType Directory -Force -Path $copy | Out-Null
    Copy-Item -Path (Join-Path $AppDir '*.cs') -Destination $copy
    $verify = Join-Path $copy 'Verify.cs'
    $was = $held['Verify.cs']
    [IO.File]::AppendAllText($verify, "`r`nclass PlantedRise { object M() { try { return M(); } catch { return null; } } }`r`n")
    # Against the launcher's own lines: the copy is the launcher alone.
    $launcherBase = Join-Path $tmp 'launcher-baseline.txt'
    [IO.File]::WriteAllText($launcherBase, "# the real baseline's launcher lines`r`n" + ((@($held.Keys | Sort-Object) | ForEach-Object { $_ + ' ' + $held[$_] }) -join "`r`n") + "`r`n")
    $r = Run-Check $copy $launcherBase
    Yes ('one more catch that returns null in Verify.cs goes red at ' + ($was + 1) + ' against ' + $was) (
        $r.Code -eq 1 -and $r.Out -match ('Verify\.cs has ' + ($was + 1) + ' silent catches and the baseline allows ' + $was))

    # ---- 3. the three paths say why -----------------------------------------
    # None of the catches on them is counted: Http.cs, ShellUpdate.cs and,
    # since #5608, Updater.cs have none.
    $r = Run-Check $AppDir $none
    Yes 'Http.cs has no catch that drops its reason' ($r.Out -notmatch 'NEW\s+Http\.cs')
    Yes 'ShellUpdate.cs has none' ($r.Out -notmatch 'NEW\s+ShellUpdate\.cs')
    Yes 'Online.cs has none' ($r.Out -notmatch 'NEW\s+Online\.cs')
    # Parts, the one Updater.cs kept, went with the update feed (#5608).
    Yes 'Updater.cs has none' ($r.Out -notmatch 'NEW\s+Updater\.cs')

    $http = [IO.File]::ReadAllText((Join-Path $AppDir 'Http.cs'))
    Yes 'Http.GetOrNull hands back why' ($http -match 'public static byte\[\] GetOrNull\(string url, int waitMs, int readMs, out string why\)')
    Yes 'and has no overload that drops it' (([regex]::Matches($http, '\bGetOrNull\(')).Count -eq 1)
    Yes 'its refused answer says the status' ($http -match 'why = "the server answered " \+ \(int\)res\.StatusCode')

    $ver = [IO.File]::ReadAllText((Join-Path $AppDir 'Verify.cs'))
    $at = $ver.IndexOf('static ServerMod[] Manifest(Config cfg)')
    $end = $ver.IndexOf('/// <summary>', $at)
    $man = if ($at -ge 0 -and $end -gt $at) { $ver.Substring($at, $end - $at) } else { '' }
    Yes 'Verify.Manifest is found' ($man.Length -gt 0)
    Yes 'it says why when the server''s list does not come' ($man -match 'GetOrNull\(url, 4000, 4000, out why\)' -and $man -match 'Swallow\.Say\("Verify\.Manifest", "the server''s mod list could not be read from " \+ url \+ ": " \+ why\)')
    Yes 'when it names no mods' ($man -match 'names no mods')
    Yes 'and when it does not parse' ($man -match 'Swallow\.Note\("Verify\.Manifest, reading')

    $onl = [IO.File]::ReadAllText((Join-Path $AppDir 'Online.cs'))
    Yes 'Online.AskPort takes the reason and says it' ($onl -match 'GetOrNull\(url, 2500, Http\.DefaultReadMs, out why\)' -and $onl -match 'SayWhenItChanges\(resourcePort, url, why\)' -and $onl -match 'Swallow\.Say\("Online\.AskPort"')
    # AskPort runs every ten seconds. Its catch hands the reason to
    # SayWhenItChanges, which writes once per change; a Swallow.Note there
    # would write a line on every ask while the same exception repeats.
    $at = $onl.IndexOf('static Count AskPort(')
    $end = if ($at -ge 0) { $onl.IndexOf('SayWhenItChanges(resourcePort', $at) } else { -1 }
    $ask = if ($at -ge 0 -and $end -gt $at) { $onl.Substring($at, $end - $at) } else { '' }
    $catch = [regex]::Match($ask, 'catch\s*\(Exception ex\)\s*\{[^}]*\}')
    Yes 'AskPort''s catch keeps the reason for SayWhenItChanges and writes no line of its own' (
        $catch.Success -and $catch.Value -match 'why = ex\.GetType\(\)\.Name' -and $catch.Value -notmatch 'Swallow\.')

    $sw = [IO.File]::ReadAllText((Join-Path $AppDir 'Swallow.cs'))
    Yes 'Swallow.Say writes to the log and never throws' ($sw -match 'public static void Say\(string where, string why\)' -and $sw -match 'File\.AppendAllText')
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
