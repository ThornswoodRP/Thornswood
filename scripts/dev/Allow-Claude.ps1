<#
  Allow-Claude.ps1

  Adds the folders and the script paths a Claude working in this repo needs, to
  the Claude Code settings file, and reports exactly what it changed.

  WHY THIS EXISTS

  A Claude here can read the repo and run the read only scripts, and everything
  else it is asked to do it shows you instead. That is the arrangement in
  the ops repo's CLAUDE.md and it is not what this changes. What this changes is the two ways
  that arrangement breaks down into "I could not, ask Patrick" over things
  nobody meant to withhold:

    The fork is not in the repo. Our engine changes live in
    C:\Thornswood-Dev\skymp and the game we ship lives in C:\Thornswood. Both
    are outside the working directory, so reading a single line of either is
    refused. On 20 September that meant an engine defect could be found by
    reading the server log and then not checked against the source that caused
    it, and the fix for it could not be compiled.

    A compiler is not a script. The permission rules name whole script paths,
    which is why scripts\release\Build-Server.ps1 exists: one path to allow, rather than
    a bare msbuild line that no rule can sensibly describe.

  WHAT IT DOES NOT ADD

  Nothing that leaves this machine on its own: no Ship, no push, no
  Publish-Server, no Deploy to the live server, no Rotate-ServerPassword. Those
  stay yours to run, which is the point of that section of the ops repo's CLAUDE.md. The one
  exception already in your settings before this ran is Deploy-DevGamemode,
  which you put there yourself.

  Everything it adds is either read only or builds something on this machine.
  Two scripts do more than look unless they are given one switch, so their
  rules name that switch and nothing else: Sync-Client.ps1 only with -Check
  (without it, it copies the client into the game folder and can fetch the
  engine build from GitHub) and Setup-SshKey.ps1 only with -Test (without it,
  it makes keys, edits the ssh config, and -NewBox logs in to the box to add
  one). Issue #3985: their rules used to allow any arguments.

  WHERE IT WRITES

  Your own settings, %USERPROFILE%\.claude\settings.json, which is where the
  rules you already have live. -Project writes .claude\settings.json inside the
  repo instead, which would travel to Djinn's machine on a pull. That is a
  decision about somebody else's machine, so it is a switch and not the
  default.

  It removes only a rule it wrote itself that allows more than it now allows:
  the any-arguments rule for Sync-Client.ps1 or Setup-SshKey.ps1 that it wrote
  before #3985, which would otherwise keep allowing everything the narrow
  rules leave out. It says each one it removes. It never reorders anything it
  did not add, and it keeps every other key in the file exactly as it was. It
  writes UTF-8 with no byte order mark, because a mark in a JSON file is how
  the dev server was taken down on 18 September and the same tools read this
  one.

  Usage:
    .\scripts\dev\Allow-Claude.ps1              add what is missing
    .\scripts\dev\Allow-Claude.ps1 -Check       say what is missing and change nothing
    .\scripts\dev\Allow-Claude.ps1 -Project     write the repo's settings instead
#>
[CmdletBinding()]
param(
    # Say what would change and write nothing.
    [switch]$Check,
    # Write .claude\settings.json in the repo rather than your own settings.
    # That file travels on a pull, so it grants the same on Djinn's machine.
    [switch]$Project,
    # Also allow the scripts that reach the VPS and GitHub. OFF BY DEFAULT.
    # Asked for by Patrick on 21 September, in his own words: run it yourself so
    # you can, I want it all done when I wake up. It is a switch rather than the
    # default because the ops repo's CLAUDE.md says these are his to run, and a rule that grants
    # them should be something somebody typed on purpose.
    [switch]$Live,
    # Somewhere else entirely.
    [string]$SettingsPath = '',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Add($m)  { Write-Host ('  +     ' + $m) -ForegroundColor Green }
function Have($m) { Write-Host ('  have  ' + $m) -ForegroundColor DarkGray }
function Drop($m) { Write-Host ('  -     ' + $m) -ForegroundColor Magenta }
function Skip($m) { Write-Host ('  skip  ' + $m) -ForegroundColor Yellow }
function Die($m)  { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# ---------------------------------------------------------------- what ------
#
# THE FOLDERS. Each one is the source of something this repo ships and none of
# them is inside the repo, so without these a Claude cannot read them at all.
#
#   the fork      our engine changes, on thornswood/engine-changes. Reading it
#                 is how an engine defect gets checked against the code that
#                 causes it instead of guessed at.
#   the game      what the launcher builds and what the table scripts read. The
#                 plant, ore and spell tables are read out of these records
#                 rather than typed from memory, and that only works if the
#                 records can be read.
#   the profile   launcher.log and plugins.txt. The ops repo's CLAUDE.md says to read
#                 launcher.log before claiming a cause, which needs this.
#
$WantDirs = @(
    @{ Path = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Engine); Why = 'the fork: our engine changes' },
    @{ Path = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game');    Why = 'the built game: the records the tables are read out of' },
    @{ Path = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile'); Why = 'launcher.log and plugins.txt' }
)

#
# THE SCRIPTS. The form matches the rules already in your file exactly:
# pwsh, no profile, -File, a repo relative path. A Claude will call them that
# way and no other, because a rule that does not match how it is called is a
# rule that does nothing.
#
# A script with Forms is allowed only with exactly those arguments, one rule
# for each, with no :* on the end: Claude Code matches a rule without it
# against the whole command, so nothing else may follow the switch. A script
# without Forms is allowed with any arguments, because every way of running
# it is read only or builds here.
#
# Two groups, and the difference matters:
#
#   READ ONLY. They look and they report. Check-LiveGamemode asks the VPS for a
#   hash and compares it. Check-Manifest, Check-Load and Check-Site ask and
#   report. None of them writes anything anywhere, here or there.
#
#   BUILDS ON THIS MACHINE. The three table scripts read the game's records and
#   write a json in the repo and a generated block in the gamemode. Build-Server
#   compiles the fork and writes the build record. All of it is local, all of it
#   is in git, and every one of them refuses to write anything when a check has
#   failed.
#
$WantAllow = @(
    @{ Script = 'Build-Server.ps1';       Why = 'compiles the fork so an engine change can be checked rather than remembered' },
    @{ Script = 'Build-HarvestTable.ps1'; Why = 'reads every plant out of the game records' },
    @{ Script = 'Build-OreTable.ps1';     Why = 'reads every ore vein out of the game records' },
    @{ Script = 'Build-SpellTable.ps1';   Why = 'reads every spell out of the masters' },
    @{ Script = 'Sync-Client.ps1';        Why = 'the client runtime: -Check only, which only looks'; Forms = @('-Check', '-Check -NoPause') },
    @{ Script = 'Setup-SshKey.ps1';       Why = 'ssh to the box: -Test only, which only looks';      Forms = @('-Test', '-Test -NoPause') },
    @{ Script = 'Check-Backdrop.ps1';     Why = 'read only' },
    @{ Script = 'Check-Build.ps1';        Why = 'read only' },
    @{ Script = 'Check-Chargen.ps1';      Why = 'read only' },
    @{ Script = 'Check-LiveGamemode.ps1'; Why = 'read only: is the server running what this repo has' },
    @{ Script = 'Check-Plugins.ps1';      Why = 'read only' },
    @{ Script = 'Check-VoiceInstall.ps1'; Why = 'read only' }
)

#
# -Live ONLY. These reach the VPS or GitHub and cannot be taken back once run.
#
# WHAT IS DELIBERATELY NOT HERE, and should stay not here: Wipe-Saves.ps1,
# Rotate-ServerPassword.ps1 and Clean-Everything.ps1. Those three destroy
# something that cannot be rebuilt from this repository, and no amount of being
# asked to work unattended makes it right for a script to hand itself the power
# to wipe the world. If one of them is ever needed it is a person at a keyboard.
#
$WantLive = @(
    @{ Script = 'Publish-Server.ps1';  Why = 'puts the built server on the LIVE box and restarts it' },
    @{ Script = 'Deploy-Server.ps1';   Why = 'sends the gamemode and the payload to the LIVE box' },
    @{ Script = 'Deploy-Docs.ps1';     Why = 'publishes the site' },
    @{ Script = 'Install-Bot.ps1';     Why = 'installs the Discord bot on the VPS' },
    @{ Script = 'Install-Voice.ps1';   Why = 'installs the voice service on the VPS' },
    @{ Script = 'Restart-Server.ps1';  Why = 'restarts the live server' },
    @{ Script = 'Request-Restart.ps1'; Why = 'asks the live server to restart itself' },
    @{ Script = 'Ship.ps1';            Why = 'builds and publishes a release' },
    @{ Script = 'Publish-Update.ps1';  Why = 'packs and publishes a game files update' },
    @{ Script = 'Backup-Server.ps1';   Why = 'pulls a backup down from the VPS' }
)

Head 'The settings file'

if (-not $SettingsPath) {
    if ($Project) {
        $SettingsPath = Join-Path $Repo '.claude\settings.json'
    } else {
        $home_ = $env:USERPROFILE
        if (-not $home_) { $home_ = $HOME }
        $SettingsPath = Join-Path $home_ '.claude\settings.json'
    }
}
Say ("  " + $SettingsPath)
if ($Project) {
    Say '  -Project: this file travels on a pull, so it grants the same on Djinn''s machine.' 'Yellow'
}

$dir = Split-Path -Parent $SettingsPath
if (-not (Test-Path -LiteralPath $dir)) {
    if ($Check) { Say "  $dir does not exist yet; it would be created." }
    else { [void](New-Item -ItemType Directory -Path $dir -Force) }
}

$doc = $null
$raw = ''
if (Test-Path -LiteralPath $SettingsPath) {
    $raw = [IO.File]::ReadAllText($SettingsPath)
    # A byte order mark is not JSON to every reader of this file, and stripping
    # it on the way in is also how it stops being written on the way out.
    $raw = $raw -replace '^\uFEFF', ''
    try { $doc = $raw | ConvertFrom-Json }
    catch { Die "that file is not valid JSON, so nothing was touched: $($_.Exception.Message)" }
    Say ("  {0:N0} bytes, parses" -f $raw.Length)
} else {
    Say '  not there yet, so it will be created with just these settings in it.'
    $doc = [pscustomobject]@{}
}

# Names(obj) rather than obj.PSObject.Properties.Name.Contains(...). On an
# object with no properties at all, which is what a settings file that does not
# exist yet gives, .Name is null and .Contains on it throws "You cannot call a
# method on a null-valued expression", which is a sentence that says nothing
# about settings. @() around it makes the empty case an empty array.
function Names($o) { return @($o.PSObject.Properties | ForEach-Object { $_.Name }) }

if ((Names $doc) -notcontains 'permissions') {
    $doc | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{}) -Force
}
$perm = $doc.permissions
foreach ($k in 'allow', 'additionalDirectories') {
    if ((Names $perm) -notcontains $k) {
        $perm | Add-Member -NotePropertyName $k -NotePropertyValue @() -Force
    }
}
$allow = @($perm.allow)
$dirs  = @($perm.additionalDirectories)

$added = 0
$removed = 0

Head 'Folders outside the repo'

foreach ($d in $WantDirs) {
    $p = [string]$d.Path
    if (-not (Test-Path -LiteralPath $p)) {
        Skip ($p + '  is not on this machine, so it is not added. ' + $d.Why)
        continue
    }
    # Compared case insensitively and with a trailing slash ignored, because
    # one entry written two ways is two entries and neither of them is wrong.
    $norm = $p.TrimEnd('\', '/')
    $has = @($dirs | Where-Object { ([string]$_).TrimEnd('\', '/') -ieq $norm })
    if ($has.Count) { Have ($p + '  ' + $d.Why); continue }
    Add ($p + '  ' + $d.Why)
    $dirs += $p
    $added++
}

Head 'Scripts'

$allowList = $WantAllow
if ($Live) {
    $allowList = $WantAllow + $WantLive
    Say '  -Live: the scripts that reach the VPS and GitHub are included.' 'Yellow'
} else {
    Say '  the scripts that reach the VPS and GitHub are NOT included. -Live adds them.'
}

foreach ($a in $allowList) {
    $s = [string]$a.Script
    # Found by name in scripts\<area>, where the scripts are since phase 8 of
    # issue #440, and allowed by the path it has there.
    $full = @(Get-ChildItem -LiteralPath (Split-Path -Parent $Here) -Filter $s -File -Recurse -ErrorAction SilentlyContinue |
              Where-Object { $_.FullName -notmatch '[\\/]oneoff[\\/]' } | Select-Object -First 1 -ExpandProperty FullName)[0]
    if (-not $full) {
        Skip ($s + '  is not in scripts\, so it is not added')
        continue
    }
    $rel = 'scripts/' + (Split-Path -Leaf (Split-Path -Parent $full)) + '/' + $s
    $call = 'pwsh -NoProfile -File ./' + $rel
    $wide = 'Bash(' + $call + ':*)'
    $forms = @($a.Forms | Where-Object { $_ })
    if (-not $forms.Count) {
        $has = @($allow | Where-Object { [string]$_ -ieq $wide })
        if ($has.Count) { Have ($s + '  ' + $a.Why); continue }
        Add ($s + '  ' + $a.Why)
        $allow += $wide
        $added++
        continue
    }
    # Only these forms: the any-arguments rule this script wrote before #3985
    # comes out, or it would still allow what the forms leave out.
    if (@($allow | Where-Object { [string]$_ -ieq $wide }).Count) {
        Drop ($wide + '  allowed any arguments')
        $allow = @($allow | Where-Object { [string]$_ -ine $wide })
        $removed++
    }
    foreach ($f in $forms) {
        $rule = 'Bash(' + $call + ' ' + $f + ')'
        $has = @($allow | Where-Object { [string]$_ -ieq $rule })
        if ($has.Count) { Have ($s + ' ' + $f + '  ' + $a.Why); continue }
        Add ($s + ' ' + $f + '  ' + $a.Why)
        $allow += $rule
        $added++
    }
}

Head 'What happens now'

if ($added -eq 0 -and $removed -eq 0) {
    Say '  Nothing to change. Everything above is already allowed, and nothing wider.' 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

if ($Check) {
    Say ("  -Check, so nothing was written. {0} entr(ies) would be added and {1} removed." -f $added, $removed) 'Yellow'
    Say '  Run it again without -Check to make the change.'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

$perm.allow = $allow
$perm.additionalDirectories = $dirs

if ($raw) {
    $backup = $SettingsPath + '.before-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    [IO.File]::WriteAllText($backup, $raw, (New-Object Text.UTF8Encoding($false)))
    Say ('  kept the old file as ' + (Split-Path -Leaf $backup))
}

# NOT Set-Content -Encoding UTF8. Under Windows PowerShell 5.1 that writes a
# byte order mark and under PowerShell 7 it does not, so the same line produces
# a different file depending on which one ran it. A mark in a settings file is
# how the dev server was taken down on 18 September.
$json = $doc | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText($SettingsPath, $json, (New-Object Text.UTF8Encoding($false)))
Say ("  wrote {0} new entr(ies) and removed {1}" -f $added, $removed) 'Green'

# Proved rather than assumed: read it back, parse it, and check the first byte.
try {
    $back = [IO.File]::ReadAllText($SettingsPath) | ConvertFrom-Json
    $b0 = [IO.File]::ReadAllBytes($SettingsPath)[0]
    if ($b0 -eq 0xEF) {
        Die 'a byte order mark was written. Put the .before- copy back.'
    }
    Say ("  reads back fine: {0} allow rule(s), {1} folder(s)" -f
         @($back.permissions.allow).Count, @($back.permissions.additionalDirectories).Count) 'Green'
} catch {
    Die ("the file no longer parses: " + $_.Exception.Message + ". Put the .before- copy back.")
}

Head 'One more thing'
Say '  Claude Code reads these at start, so restart it, or run /permissions to see them.'
if ($Live) {
    Say '  -Live was used, so Ship, Publish-Server and the live Deploy scripts are now allowed.' 'Yellow'
    Say '  Wipe-Saves, Rotate-ServerPassword and Clean-Everything are deliberately not, and should stay that way.'
    Say '  Take any of it back by deleting the line from the allow list, or with /permissions.'
} else {
    Say '  Nothing here changes anything off this machine. Check-LiveGamemode and Setup-SshKey -Test'
    Say '  ask the box and change nothing; Ship, push, Publish-Server and the live Deploy scripts'
    Say '  are all still yours to run.'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
