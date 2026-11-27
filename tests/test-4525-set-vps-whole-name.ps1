<#
  test-4525-set-vps-whole-name.ps1

      pwsh -NoProfile -File .\tests\test-4525-set-vps-whole-name.ps1

  Issue #4525. Set-Vps.ps1 picked files with a plain substring match on the
  old name and rewrote them with a plain Replace, so a longer name that held
  the old one (one more label in front, more letters after) was counted and
  rewritten too. Its header also named files that no longer carry the name.

  Against a scratch copy of the repository's shape, with the old name in
  Config.cs:
    1. the preview counts only the places the name stands whole, and lists
       no file where it is only part of a longer name;
    2. the rename changes those places, in a URL, in quotes, at the end of a
       sentence, and leaves every longer name as it was;
    3. the header names the files tests\test-vps-defaults.ps1 allows.

  Read-Host is stood in for, so the yes is given here. Under a second.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$setVps = [IO.Path]::Combine($Repo, 'scripts', 'vps', 'Set-Vps.ps1')
$scratch = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ts-4525-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$old = 'play.example.net'
$new = 'game.example.org'
function At([string]$rel) { $p = $scratch; foreach ($part in ($rel -split '/')) { $p = Join-Path $p $part }; $p }
function Put([string]$rel, [string]$text) {
    $p = At $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text)
}
function Text([string]$rel) { [IO.File]::ReadAllText((At $rel)) }

try {
    Put 'scripts/vps/Set-Vps.ps1' ([IO.File]::ReadAllText($setVps))
    Put 'launcher/app/Config.cs' "class Config {`n  public string ServerAddress = `"$old`";`n}`n"
    Put 'scripts/vps/vps.json' "{ `"address`": `"$old`", `"user`": `"someone`" }`n"
    Put 'docs/where.md' ("Join at $old. The page is https://${old}:7777/feed and ``$old`` is the name.`n")
    # Longer names that hold the old one, each of them a different name.
    $longer = @("dev.$old", "${old}work", "x$old", "$old.au", "${old}-2")
    Put 'docs/others.md' (($longer | ForEach-Object { "- $_" }) -join "`n")
    Put 'scripts/longer.js' ("const hosts = ['" + ($longer -join "', '") + "'];`n")

    function global:Read-Host { param([string]$Prompt) 'y' }

    # 1. the preview
    $said = (& (At 'scripts/vps/Set-Vps.ps1') -Address $new -Preview -NoPause *>&1 | Out-String)
    Yes 'the preview lists Config.cs, vps.json and where.md' ($said -match 'launcher[\\/]app[\\/]Config\.cs' -and $said -match 'vps\.json' -and $said -match 'where\.md')
    Yes ('and not the files where the name is only part of a longer one') ($said -notmatch 'others\.md' -and $said -notmatch 'longer\.js')
    Yes 'it counts 3 files and 5 places: Config.cs 1, vps.json 1, where.md 3' ($said -match '3 file\(s\), 5 place\(s\)')
    foreach ($f in @('docs/others.md', 'scripts/longer.js', 'launcher/app/Config.cs')) {
        Yes "the preview changed nothing: $f" ((Text $f).Contains($old))
    }

    # 2. the rename
    $before = @{ 'docs/others.md' = (Text 'docs/others.md'); 'scripts/longer.js' = (Text 'scripts/longer.js') }
    $said = (& (At 'scripts/vps/Set-Vps.ps1') -Address $new -NoPause *>&1 | Out-String)
    Yes 'Config.cs now says the new name' ((Text 'launcher/app/Config.cs').Contains("ServerAddress = `"$new`""))
    Yes 'vps.json too' ((Text 'scripts/vps/vps.json').Contains("`"$new`""))
    $w = Text 'docs/where.md'
    Yes ('where.md is rewritten in the sentence, the URL and the code span: ' + $w.Trim()) (
        $w -eq ("Join at $new. The page is https://${new}:7777/feed and ``$new`` is the name.`n"))
    foreach ($f in $before.Keys) {
        Yes "every longer name is left as it was: $f" ((Text $f) -eq $before[$f])
    }

    Remove-Item Function:\global:Read-Host
} finally {
    if (Test-Path Function:\global:Read-Host) { Remove-Item Function:\global:Read-Host }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. the header
$text = [IO.File]::ReadAllText($setVps)
$head = $text.Substring(0, $text.IndexOf('#>'))
$tv = [IO.File]::ReadAllText([IO.Path]::Combine($Repo, 'tests', 'test-vps-defaults.ps1'))
$baked = (([regex]::Match($tv, '(?s)\$baked = @\((.*?)\n\)').Groups[1].Value -split "`n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
$allowed = @([regex]::Matches($baked, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
Yes ('test-vps-defaults.ps1 allows the name in ' + ($allowed -join ', ')) ($allowed.Count -ge 3)
foreach ($a in $allowed) {
    Yes "Set-Vps.ps1's header names $a" ($head.Contains($a.Replace('/', '\')) -or $head.Contains($a))
}
Yes 'and says it changes the name only where it stands whole' ($head -match 'only where it stands whole')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
