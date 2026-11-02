<#
  test-script-paths.ps1

      pwsh -NoProfile -File .\tests\test-script-paths.ps1

  Every path a script builds from its own folder or the repository points at
  something that is in the repository, apart from the files that are made at
  run time or kept out of git on purpose, which are listed below with why.

  WHY. The repository is being reorganised in phases (issue #440 on the
  board), and the scripts that build a release find what they ship by joining
  a path onto their own folder. Build-Launcher, Package-Thornswood (gone with
  the old installer, #4824) and Go.ps1 only warned in yellow when one of
  those files was not there, and carried on, so
  a move that missed one path would ship a launcher without its art or a
  pack without its overlays, and nobody would notice until a tester did. This
  turns that into a failed check before anything is built.

  HOW. Every script under scripts\ and every harness in tests\ is read as
  text for Join-Path $Here, $PSScriptRoot, $RepoDir or $Repo with a single
  quoted path, which is how every script here names its neighbours. A path
  with a variable or a wildcard in it is not followed. tools\ went on
  29 September (issue #440, phase 10), so nothing is read from there. Read
  only.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# Not in git on purpose, by path from the repository root, and why.
$notInGit = @{
    '.claude/settings.json'         = 'written by Allow-Claude.ps1 on the machine it runs on'
    '.git'                          = 'the repository itself'
    'version.json'                  = 'the releases clone''s feed; the scripts that name it are pointed at that clone'
    'local'                         = 'what one machine keeps and git ignores; Audit-Mods.ps1 writes mod-audit.json there'
    'out'                           = 'the build output, which git ignores; Build-Launcher and Update-ShipRoot build under it'
    'out/dist'                      = 'the release output, under out, which git ignores (CONTRIBUTING, the fork and its build)'
    'records/signing/signing.json'  = 'a machine''s signing settings, ignored by git'
    'records/signing/client'        = 'Microsoft''s signing client, fetched from NuGet by Setup-ShipMachine.ps1 and ignored by git (#458)'
    'local/backup-key.txt'          = 'the backup passphrase, a secret kept out of git'
    'local/thornswood-front.zip'    = 'the front build, made outside the repository and kept in local'
    'bot/announced.json'  = 'what Publish-Discord.ps1 has posted, written on the machine that ships'
    'bot/dev-webhook.txt' = 'a webhook, a secret kept out of git'
    'bot/news-webhook.txt'= 'a webhook, a secret kept out of git'
    'scripts/vps/runner-logs.log'      = 'what vps-runner-logs.ps1 writes beside its copy on the box, C:\Thornswood-Watch\runner-logs.log (#3184), never in this repository'
    'scripts/dev/task.json'            = 'what Trace-Gate.ps1 -Install writes beside the trace task''s copy in C:\Thornswood-Trace\task on the box (#3114), never in this repository'
    'scripts/dev/seen.txt'             = 'the runs the trace task has traced, beside its copy on the box in C:\Thornswood-Trace\task (#3114), never in this repository'
    'scripts/vps/watch-outside.json'   = 'what Watch-Outside.ps1 -Export writes beside its copy in the public repository it runs from (#2755), never in this one'
    'Thornswood-Ops'                   = 'the private ops repo, checked out beside this one (#3693): Check-RehearsalDue.ps1 reads RESTORING.md there, and the path climbs above this root, so it is named here without the ..'
}

$tracked = @{}
foreach ($t in (& git -C $repo ls-files)) {
    $tracked[$t] = $true
    $p = $t
    while ($p.Contains('/')) { $p = $p.Substring(0, $p.LastIndexOf('/')); $tracked[$p] = $true }
}
Yes ('git lists the tracked files ({0})' -f $tracked.Count) ($tracked.Count -gt 100)

$rx = [regex]"Join-Path\s+\`$(Here|PSScriptRoot|RepoDir|Repo)\s+'([^'`$``*]+)'"
$found = 0
$missing = @()
$allowedSeen = @{}
# The harnesses too, since they moved to tests\ (issue #440, phase 5). In a
# harness $Here is pointed at the repository folder at its top, so a path on
# it is from the root; $PSScriptRoot there only ever appears inside the
# stub scripts a harness writes to a scratch folder, so it is not a path in
# this repository and is passed over.
$testsDir = Join-Path $repo 'tests'
# And the scripts themselves, in scripts\<area> since phase 8: each one's
# paths resolve from its own folder.
$scan = @()
$scriptsDir = Join-Path $repo 'scripts'
$repoFull = (Get-Item -LiteralPath $repo).FullName.TrimEnd('\', '/')
# scripts\oneoff is parked history: its scripts name the layout they ran in.
if (Test-Path -LiteralPath $scriptsDir) { $scan += @(Get-ChildItem -LiteralPath $scriptsDir -Filter *.ps1 -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]oneoff[\\/]' }) }
if (Test-Path -LiteralPath $testsDir) { $scan += @(Get-ChildItem -LiteralPath $testsDir -Filter *.ps1 -File) }
# And the harnesses beside their product, in <product>\tests\ (plan line 42),
# where $Here is pointed at the repository folder the same way.
. (Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Harness-Files.ps1')
foreach ($p in @(Get-ProductTestFolders $repo)) { $scan += @(Get-ChildItem -LiteralPath $p.Path -Filter *.ps1 -File) }
foreach ($f in $scan) {
    $inTests = ((Split-Path -Leaf (Split-Path -Parent $f.FullName)) -eq 'tests')
    $text = [IO.File]::ReadAllText($f.FullName)
    # Comments build no path. A comment that quotes another script's line
    # (test-deploy-gamemode-warning.ps1 quotes Deploy-DevGamemode's
    # '..\vps\Request-Restart.ps1') would otherwise be resolved from the wrong
    # folder, so every comment is blanked before the paths are read.
    $tokens = $null; $perr = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$perr)
    $sb = New-Object System.Text.StringBuilder($text)
    foreach ($tk in $tokens) {
        if ($tk.Kind -eq 'Comment') {
            $s = $tk.Extent.StartOffset; $n = $tk.Extent.EndOffset - $s
            [void]$sb.Remove($s, $n).Insert($s, (New-Object string ' ', $n))
        }
    }
    $text = $sb.ToString()
    foreach ($m in $rx.Matches($text)) {
        if ($inTests -and $m.Groups[1].Value -eq 'PSScriptRoot') { continue }
        $rel = $m.Groups[2].Value.Replace('\', '/').Trim('/')
        # The script's folder from the repository root. Every file read here
        # was listed under $repo, so that is its folder with $repo taken off
        # the front ([IO.Path]::GetRelativePath is .NET Core's, and Windows
        # PowerShell 5.1 has no such method, #2739).
        $baseRel = if ($inTests) { '' } else { (Split-Path -Parent $f.FullName).Substring($repoFull.Length).Trim('\', '/').Replace('\', '/') }
        $full = if ($m.Groups[1].Value -in 'RepoDir', 'Repo') { $rel } else { $baseRel + '/' + $rel }
        # scripts/release/../../bot/x is bot/x: a script reaches the rest of
        # the repository that way from its own folder.
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($seg in $full.Split('/')) {
            if ($seg -eq '..') { if ($parts.Count) { $parts.RemoveAt($parts.Count - 1) } }
            elseif ($seg -and $seg -ne '.') { $parts.Add($seg) }
        }
        $full = $parts -join '/'
        # Nothing left is the repository root itself (test-gamemode-consts'
        # '..'), which is always there.
        if (-not $full) { $found++; continue }
        if ($tracked.ContainsKey($full)) { $found++; continue }
        if ($notInGit.ContainsKey($full)) { $allowedSeen[$full] = $true; continue }
        $missing += ('{0} (named in {1})' -f $full, $f.Name)
    }
}
$missing = @($missing | Sort-Object -Unique)
foreach ($m in $missing) { Write-Host "      not in the repository: $m" }
Yes ("every path the scripts build is in the repository ($found found)") ($missing.Count -eq 0)
Yes ('the scripts still build a few hundred such paths, so the pattern still matches how they are written') ($found -ge 200)
$stale = @($notInGit.Keys | Where-Object { -not $allowedSeen.ContainsKey($_) } | Sort-Object)
foreach ($s in $stale) { Write-Host "      nothing names this any more, take it off the list: $s" }
Yes 'every entry on the not-in-git list is still named by a script' ($stale.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
