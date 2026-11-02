<#
  test-2519-setup-discord-onbox.ps1

  Setup-Discord.ps1 -OnBox builds the Discord on the VPS with the token the
  running bot already holds, and asks for nothing.

  WHY THIS EXISTS. Issues #2519 and #2341. Setup-Discord.ps1 asked for the bot
  token at a hidden prompt (Read-Host -AsSecureString), even for -Check, so
  the Gamemasters layout and the #welcome-travelers Attach Files overwrite,
  both merged, waited on a person who holds the token to sit at a prompt; the
  Releases desk on One runs with nobody at one, and stopped there on 22 Oct
  2026. The token is already on the box, in C:\Thornswood-Bot\bot.env.json,
  where the bot reads it. -OnBox runs the build there with it.

  What it checks, with Vps.ps1 and Send-Script.ps1 replaced by stand-ins that
  write down the script instead of sending it, in a throwaway git repository:
    1. -OnBox -Check asks for no token, sends one script and passes;
    2. the script carries Build-Discord.py, content.py, trust.py (the roots
       it logs in with, #3604), staff-channel.txt, factions.json, the two site pages content.py reads (join.md, rules.md)
       and lore/factions.md, which it reads for #factions (#3317), byte for byte
       as the commit holds them, each under its path in the repository, sets
       DISCORD_CHECK and the site's open switch, and sets no -Posts or -Prune
       it was not given;
    3. it reads the token from bot.env.json on the box, never carries one,
       and clears it and removes its folder in a finally;
    4. the script itself, run with a stand-in Python and the box's paths
       pointed at a temp folder, under PowerShell 7, because the box runs it
       since #5356: the files are there when the build runs,
       laid out as in the repository, and the real Python imports content.py
       from that folder (a run on 22 Oct 2026 sent only the bot's files and
       content.py stopped on the box with FileNotFoundError for join.md),
       and, where a python with discord.py is, imports Build-Discord.py
       there too (the first -OnBox run after #3317 stopped on the box with
       FileNotFoundError for factions.json, which it reads as it loads);
       the token is in its environment, and the folder is gone afterwards,
       after a build that fails too; a bot.env.json with no token stops it
       before the build;
    5. an uncommitted change to one of the three files stops the run before
       anything is sent.

  It never reaches the VPS or Discord. Files under its own temp folder only.
  It needs Python (python3 or python), which every runner has for the bot's
  harnesses.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')

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

$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
$git = (Get-Command git -ErrorAction SilentlyContinue)
Yes 'pwsh and git are on this machine' ($null -ne $pwsh -and $null -ne $git)
if (-not $pwsh -or -not $git) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-setup-onbox-' + [Guid]::NewGuid().ToString('N'))
try {
    $tree = Join-Path $work 'repo'
    $dep = Join-Path $tree 'scripts\deploy'; $vps = Join-Path $tree 'scripts\vps'; $bot = Join-Path $tree 'bot'
    $pages = Join-Path $tree 'site\data\site'; $lore = Join-Path $tree 'lore'
    New-Item -ItemType Directory -Force -Path $dep, $vps, $bot, $pages, $lore | Out-Null
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\deploy\Setup-Discord.ps1') -Destination $dep
    foreach ($f in 'Build-Discord.py', 'content.py', 'trust.py', 'staff-channel.txt', 'factions.json') { Copy-Item -LiteralPath (Join-Path $Repo ('bot\' + $f)) -Destination $bot }
    foreach ($f in 'join.md', 'rules.md') { Copy-Item -LiteralPath (Join-Path $Repo ('site\data\site\' + $f)) -Destination $pages }
    Copy-Item -LiteralPath (Join-Path $Repo 'lore\factions.md') -Destination $lore
    $sent = Join-Path $work 'sent.ps1'
    [IO.File]::WriteAllText((Join-Path $vps 'Vps.ps1'), "function Get-ThornswoodVpsUser { 'Administrator' }`nfunction Get-ThornswoodVpsAddress { '192.0.2.1' }`n")
    [IO.File]::WriteAllText((Join-Path $vps 'Send-Script.ps1'), @"
function Invoke-ThornswoodRemote {
    param([string]`$Target, [string[]]`$SshArgs, [string]`$Script)
    [IO.File]::WriteAllText('$($sent.Replace("'", "''"))', `$Script)
    `$global:LASTEXITCODE = 0
    return @('far side said: done', ('target ' + `$Target), ('ssh ' + (`$SshArgs -join ' ')))
}
"@)
    $null = & git -C $tree init -q 2>&1
    $null = & git -C $tree -c user.email=t@t -c user.name=t add -A 2>&1
    $null = & git -C $tree -c user.email=t@t -c user.name=t commit -q -m t 2>&1
    Yes 'the throwaway repository has a commit' ($LASTEXITCODE -eq 0)

    # The caller defines Invoke-RestMethod, so the site's open switch is read
    # from this and never from thornswood.net.
    $runner = Join-Path $work 'run.ps1'
    [IO.File]::WriteAllText($runner, @"
param([string]`$Pass, [string]`$Only, [string]`$Give)
function Invoke-RestMethod { [pscustomobject]@{ open = `$false } }
`$s = @{}; foreach (`$p in (`$Pass -split ',')) { if (`$p) { `$s[`$p] = `$true } }
if (`$Only) { `$s['Only'] = @(`$Only -split ';') }
if (`$Give) { `$s['Give'] = @(`$Give -split '\|') }
& '$((Join-Path $dep 'Setup-Discord.ps1').Replace("'", "''"))' -OnBox @s
exit `$LASTEXITCODE
"@)
    function Run-Setup([string[]]$pass, [string[]]$only = @(), [string[]]$give = @()) {
        Remove-Item -LiteralPath $sent -Force -ErrorAction SilentlyContinue
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $out = & $pwsh.Source -NoProfile -NonInteractive -File $runner -Pass ($pass -join ',') -Only ($only -join ';') -Give ($give -join '|') 2>&1 | Out-String; $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
        $text = ''
        if (Test-Path -LiteralPath $sent) { $text = [IO.File]::ReadAllText($sent) }
        return [pscustomobject]@{ Code = $code; Out = $out; Sent = $text }
    }

    # ---- 1. it runs, and asks for nothing ------------------------------------
    $r = Run-Setup @('Check')
    Yes ("-OnBox -Check passes with nobody at a prompt (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -notmatch 'Bot token')
    Yes '  sends one script, to the box, with host keys checked and no prompt' ($r.Sent.Length -gt 0 -and $r.Out -match 'target Administrator@192\.0\.2\.1' -and $r.Out -match 'BatchMode=yes' -and $r.Out -match 'StrictHostKeyChecking=yes')
    Yes '  says the commit it built from, and prints what the far side said' ($r.Out -match 'from commit [0-9a-f]{12}' -and $r.Out -match 'far side said: done')

    # ---- 2. what goes up -----------------------------------------------------
    $s = $r.Sent
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($s, [ref]$null, [ref]$errs)
    Yes 'the script it sends parses' (@($errs).Count -eq 0)
    foreach ($f in 'bot/Build-Discord.py', 'bot/content.py', 'bot/trust.py', 'bot/staff-channel.txt', 'bot/factions.json', 'site/data/site/join.md', 'site/data/site/rules.md', 'lore/factions.md') {
        $m = [regex]::Match($s, "(?m)^\s*'" + [regex]::Escape($f) + "' = '([A-Za-z0-9+/=]+)'")
        $same = $m.Success -and ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $tree $f))) -eq $m.Groups[1].Value)
        Yes "  it carries $f byte for byte, under that path" $same
    }
    Yes '  it sets DISCORD_CHECK and the open switch (alpha, 0)' ($s -match "(?m)^\s*\`$env:DISCORD_CHECK = '1'" -and $s -match "(?m)^\s*\`$env:THORNSWOOD_OPEN = '0'")
    Yes '  and no -Posts or -Prune it was not given' ($s -notmatch 'DISCORD_POSTS' -and $s -notmatch 'DISCORD_PRUNE')
    $r2 = Run-Setup @('Posts', 'Prune')
    Yes '  -Posts and -Prune go through when given, and -Check then does not' ($r2.Code -eq 0 -and $r2.Sent -match "DISCORD_POSTS = '1'" -and $r2.Sent -match "DISCORD_PRUNE = '1'" -and $r2.Sent -notmatch 'DISCORD_CHECK')
    Yes '  and no DISCORD_ONLY when -Only is not given' ($s -notmatch 'DISCORD_ONLY')
    Yes '  and no DISCORD_AUDIT when -Audit is not given' ($s -notmatch 'DISCORD_AUDIT')
    $ra = Run-Setup @('Audit')
    Yes '  -Audit goes through as DISCORD_AUDIT, read only, with nothing else asked (#3317)' ($ra.Code -eq 0 -and $ra.Sent -match "(?m)^\s*\`$env:DISCORD_AUDIT = '1'" -and $ra.Sent -notmatch 'DISCORD_POSTS|DISCORD_PRUNE|DISCORD_ONLY')
    $r3 = Run-Setup @('Check') @('Gamemasters', 'welcome-travelers')
    Yes '  -Only goes through as DISCORD_ONLY, the names comma separated (#2519)' ($r3.Code -eq 0 -and $r3.Sent -match "(?m)^\s*\`$env:DISCORD_ONLY = 'Gamemasters,welcome-travelers'")
    $r4 = Run-Setup @('Check') @("Gamemasters'; Remove-Item x")
    Yes '  and a name that is not a plain name is refused before anything is sent' ($r4.Code -ne 0 -and $r4.Sent.Length -eq 0 -and $r4.Out -match '-Only takes')
    Yes '  and no DISCORD_GIVE when -Give is not given' ($s -notmatch 'DISCORD_GIVE')
    $r5 = Run-Setup @('Check') @() @('Co-Owner=WiccanDjinn', 'Lead Dev=Patrick Thornwood')
    Yes '  -Give goes through as DISCORD_GIVE, each rank=member, semicolon separated (#3317)' ($r5.Code -eq 0 -and $r5.Sent -match "(?m)^\s*\`$env:DISCORD_GIVE = 'Co-Owner=WiccanDjinn;Lead Dev=Patrick Thornwood'")
    $r6 = Run-Setup @('Check') @() @("Co-Owner=x'; Remove-Item y")
    Yes '  and a give that is not rank=member in plain words is refused before anything is sent' ($r6.Code -ne 0 -and $r6.Sent.Length -eq 0 -and $r6.Out -match '-Give takes')

    # ---- 3. the token --------------------------------------------------------
    Yes 'it reads the token from bot.env.json on the box' ($s -match [regex]::Escape("'C:\Thornswood-Bot'") -and $s -match [regex]::Escape("'bot.env.json'") -and $s -match 'DISCORD_TOKEN = \[string\]\$cfg\.DISCORD_TOKEN')
    Yes '  with the bot''s own libraries' ($s -match [regex]::Escape("`$env:PYTHONPATH = Join-Path `$botRoot 'py-libs'"))
    $fin = [regex]::Match($s, '(?s)\} finally \{(.*?)\n\}').Groups[1].Value
    Yes '  and clears it and removes its folder in a finally' ($fin -match '\$env:DISCORD_TOKEN = \$null' -and $fin -match 'Remove-Item -LiteralPath \$dir -Recurse -Force')

    # ---- 4. the script itself, with a stand-in Python ------------------------
    $box = Join-Path $work 'box'; $win = Join-Path $work 'win'
    New-Item -ItemType Directory -Force -Path $box, $win | Out-Null
    # The stand-in for the box's python lists the folder it was given and has
    # the real Python import content.py from it, which reads the site pages
    # through its own folder exactly as the build does on the box.
    $py = Get-Command python3, python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    Yes 'Python is on this machine' ($null -ne $py)
    if (-not $py) { Done }
    # Build-Discord.py imports discord.py before anything else, so only a
    # python that has it loads the rest of the module, where it reads its
    # files. The VPS runner and a developer's machine have one; anywhere
    # else that one check is skipped, and says so (as test-bot-heartbeat.ps1).
    $bpy = $null
    $oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        foreach ($c in @(@('py', '-3.12'), @('python3.12'), @('python'), @('python3'))) {
            $exe = Get-Command $c[0] -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $exe) { continue }
            $pre = @(); if ($c.Count -gt 1) { $pre = @($c[1]) }
            $null = & $exe.Source @pre -c 'import sys; assert sys.version_info >= (3, 10); import discord' 2>&1
            if ($LASTEXITCODE -eq 0) { $bpy = @($exe.Source) + $pre; break }
        }
    } finally { $ErrorActionPreference = $oldEap }
    $standIn = @'
function python {
    param($f)
    'RAN ' + (Split-Path -Leaf $f)
    'TOKEN ' + $env:DISCORD_TOKEN
    'CHECK ' + $env:DISCORD_CHECK
    $top = Split-Path -Parent (Split-Path -Parent $f)
    'FILES ' + ((Get-ChildItem -LiteralPath $top -Recurse -File | ForEach-Object { $_.FullName.Substring($top.Length + 1).Replace('\', '/') } | Sort-Object) -join ',')
    $env:PYTHONPATH = ''
    $code = "import sys; sys.path.insert(0, sys.argv[1]); import content; print('CONTENT IMPORTS')"
    & 'REAL_PYTHON' -c $code (Split-Path -Parent $f) 2>&1 | ForEach-Object { "$_" }
    $build = "import sys, importlib.util; sys.path.insert(0, sys.argv[1]); s = importlib.util.spec_from_file_location('build_discord', sys.argv[2]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); print('BUILD IMPORTS')"
    $bpy = @(BUILD_PYTHON)
    if ($bpy.Count) { & $bpy[0] @($bpy | Select-Object -Skip 1) -c $build (Split-Path -Parent $f) $f 2>&1 | ForEach-Object { "$_" } }
    $global:LASTEXITCODE = EXIT_CODE
}

'@
    $standIn = $standIn.Replace('REAL_PYTHON', $py.Source.Replace("'", "''"))
    $standIn = $standIn.Replace('BUILD_PYTHON', ((@($bpy) | Where-Object { $_ } | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '))
    $far = $s.Replace("'C:\Thornswood-Bot'", "'" + $box.Replace("'", "''") + "'").Replace("'C:\Windows\Temp'", "'" + $win.Replace("'", "''") + "'")
    $farPath = Join-Path $work 'far.ps1'
    [IO.File]::WriteAllText($farPath, $standIn.Replace('EXIT_CODE', '0') + $far)
    # The box runs PowerShell 7 since #5356, so the script runs under it here.
    $farPs = Get-BoxPowerShell
    Write-Host ('      the box''s script runs under ' + $farPs)
    function Run-Far {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = & $farPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $farPath 2>&1 | Out-String; $c = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
        return [pscustomobject]@{ Code = $c; Out = $o }
    }
    [IO.File]::WriteAllText((Join-Path $box 'bot.env.json'), '{"DISCORD_TOKEN":"stand-in-token","PING_URL":"x"}')
    $f = Run-Far
    Yes ("run on the box, the build runs and passes (exit {0})" -f $f.Code) ($f.Code -eq 0 -and $f.Out -match 'RAN Build-Discord\.py')
    Yes '  with the eight files laid out as in the repository' ($f.Out -match 'FILES bot/Build-Discord\.py,bot/content\.py,bot/factions\.json,bot/staff-channel\.txt,bot/trust\.py,lore/factions\.md,site/data/site/join\.md,site/data/site/rules\.md')
    Yes '  and content.py imports there, reading the site pages through its own folder' ($f.Out -match 'CONTENT IMPORTS' -and $f.Out -notmatch 'FileNotFoundError')
    if ($bpy) {
        Yes '  and Build-Discord.py loads there, reading factions.json from its own folder' ($f.Out -match 'BUILD IMPORTS' -and $f.Out -notmatch 'FileNotFoundError')
    } else {
        Write-Host 'SKIP  Build-Discord.py loading on the box: no python 3.10 or newer with discord.py on this machine'
    }
    Yes '  with the bot''s token in its environment, and -Check' ($f.Out -match 'TOKEN stand-in-token' -and $f.Out -match 'CHECK 1')
    Yes '  and its folder is gone afterwards' (@(Get-ChildItem -LiteralPath $win -Directory -Filter 'thornswood-discord-*').Count -eq 0)

    [IO.File]::WriteAllText($farPath, $standIn.Replace('EXIT_CODE', '1') + $far)
    $f = Run-Far
    Yes ("a build that fails on the box gives its exit back (exit {0})" -f $f.Code) ($f.Code -eq 1 -and $f.Out -match 'RAN Build-Discord\.py')
    Yes '  and its folder is gone afterwards too' (@(Get-ChildItem -LiteralPath $win -Directory -Filter 'thornswood-discord-*').Count -eq 0 -and $f.Out -notmatch 'LEFT BEHIND')
    [IO.File]::WriteAllText($farPath, $standIn.Replace('EXIT_CODE', '0') + $far)

    [IO.File]::WriteAllText((Join-Path $box 'bot.env.json'), '{"PING_URL":"x"}')
    $f = Run-Far
    Yes ("a bot.env.json with no token stops it before the build (exit {0})" -f $f.Code) ($f.Code -eq 3 -and $f.Out -match 'NO TOKEN' -and $f.Out -notmatch 'RAN ')
    Yes '  and leaves no folder either' (@(Get-ChildItem -LiteralPath $win -Directory -Filter 'thornswood-discord-*').Count -eq 0)

    # ---- 5. an uncommitted change stops it -----------------------------------
    Add-Content -LiteralPath (Join-Path $bot 'content.py') -Value '# changed'
    $r = Run-Setup @('Check')
    Yes ("an uncommitted change to content.py stops the run (exit {0})" -f $r.Code) ($r.Code -ne 0 -and $r.Out -match 'Commit these first' -and $r.Out -match 'content\.py')
    Yes '  before anything is sent' ($r.Sent.Length -eq 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
