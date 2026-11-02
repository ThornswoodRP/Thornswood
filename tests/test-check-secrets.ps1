# test-check-secrets.ps1
#
# Drives scripts\dev\Check-Secrets.ps1 over scratch trees, zips and programs
# with obviously fake values planted in them, and over this repository as it is.
#
# WHY. Entry 236. A secret shipped inside a built artefact twice: the SkyMP
# sign in in the installer, and voice-token.txt in nine main packs from 18 to 20
# September. The scan is the gate that was missing, and a gate that prints what
# it caught has published it in the build log, so every case here also checks
# that the output names the file, the line and the rule and not the value.
#
# The fake values are put together at run time, so this file carries nothing
# any rule matches. It is itself one of the tracked files the real tree scan
# reads at the end.
#
# Read only outside its own temp folder.

# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$here = Split-Path -Parent $here

$pass = 0
$fail = 0
function yes([string]$what, $cond) {
    if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ('{0} passed, {1} failed' -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

$scan = Join-Path $here 'scripts\dev\Check-Secrets.ps1'
yes 'scripts\dev\Check-Secrets.ps1 is there' (Test-Path -LiteralPath $scan)
if (-not (Test-Path -LiteralPath $scan)) { Done }

# Obviously fake, one for each rule by shape.
$fake = [ordered]@{
    'discord-webhook'   = 'https://discord.com/api/webhooks/' + ('1' * 18) + '/' + ('Fake' * 17)
    'discord-bot-token' = 'M' + ('T' * 23) + '.' + ('G' * 6) + '.' + ('Fake' * 8)
    'github-token'      = 'ghp' + '_' + ('Fake' * 9)
    'private-key'       = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'
    # The shape the service makes since #1322; the v1 one is $fakeV1 below.
    'voice-join-token'  = 'v2' + '.42.' + '1790000000000' + '.' + ('Fake' * 5) + 'FK' + '.' + ('Fake' * 10) + 'FAK'
    'aws-access-key'    = 'AKIA' + ('FAKE' * 4)
    'slack-token'       = 'xoxb' + '-' + ('0' * 12) + '-fake'
    'google-api-key'    = 'AIza' + ('Fake' * 8) + 'FAK'
}

# The hour long join token from before #1322, which nine packs carried.
$fakeV1 = 'v1' + '.42.' + '1790000000000' + '.' + ('Fake' * 10) + 'FAK'

# True when the output carries any planted value, or the tail of one.
function Test-Leaks([string]$out) {
    foreach ($v in @($fake.Values) + $fakeV1) {
        if ($out.Contains($v)) { return $true }
        if ($out.Contains($v.Substring($v.Length - 12))) { return $true }
    }
    if ($out.Contains('OPENSSH')) { return $true }
    return $false
}

# In this process, with everything it prints captured. Its exit code is the
# one CI and the Ship scripts act on.
function Invoke-Scan([hashtable]$a) {
    $global:LASTEXITCODE = 0
    # Line by line rather than Out-String, which wraps at the console width
    # in Windows PowerShell and splits a long path from its rule.
    $out = (@(& $scan @a *>&1 | ForEach-Object { [string]$_ }) -join "`n")
    return @{ Code = $LASTEXITCODE; Out = $out }
}

function Write-Utf8([string]$path, [string]$text) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

function New-Zip([string]$path, [hashtable]$entries) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        foreach ($k in $entries.Keys) {
            $e = $z.CreateEntry($k)
            $s = $e.Open()
            try { $b = [byte[]]$entries[$k]; $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
        }
    } finally { $z.Dispose() }
}

function New-Sfx([string]$path, [hashtable]$entries) {
    # A program with a zip concatenated after it, the shape of the Setup
    # (copy /b stub+zip). The zip's offsets count from the zip, not from the
    # first byte, which is what Check-Secrets used to miss.
    $part = $path + '.zippart'
    New-Zip $part $entries
    $stub = New-Object byte[] 48
    $stub[0] = 0x4D
    $stub[1] = 0x5A
    $zipBytes = [IO.File]::ReadAllBytes($part)
    $all = New-Object byte[] ($stub.Length + $zipBytes.Length)
    [System.Buffer]::BlockCopy($stub, 0, $all, 0, $stub.Length)
    [System.Buffer]::BlockCopy($zipBytes, 0, $all, $stub.Length, $zipBytes.Length)
    [IO.File]::WriteAllBytes($path, $all)
    Remove-Item -LiteralPath $part -Force
}

function Get-Bytes([string]$text) { return ,([Text.Encoding]::UTF8.GetBytes($text)) }

function Invoke-Git([string]$dir, [string[]]$argv) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & git -C $dir @argv 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
}

$savedActions = $env:GITHUB_ACTIONS
$env:GITHUB_ACTIONS = ''
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-secrets-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$noAllow = Join-Path $work 'no-allow.txt'
Write-Utf8 $noAllow '# nothing allowed'

try {
    # ---------------------------------------------------------------- the tree
    $tree = Join-Path $work 'tree'
    New-Item -ItemType Directory -Force -Path $tree | Out-Null
    Invoke-Git $tree @('-c', 'init.defaultBranch=main', 'init', '-q')
    Write-Utf8 (Join-Path $tree 'README.md') "A clean file.`nNothing here.`n"
    Write-Utf8 (Join-Path $tree 'scripts\thing.js') "const port = 3000;`n"
    Invoke-Git $tree @('add', '-A')

    $r = Invoke-Scan @{ Root = $tree; Allow = $noAllow }
    yes 'a clean tree passes (exit 0)' ($r.Code -eq 0)
    yes 'and says so' ($r.Out -match 'No secrets found')

    # One planted value per rule, each on line 3 of its own file.
    foreach ($k in $fake.Keys) {
        Write-Utf8 (Join-Path $tree ('notes\' + $k + '.txt')) ("line one`nline two`nsee " + $fake[$k] + " here`n")
    }
    Write-Utf8 (Join-Path $tree 'notes\voice-join-token-v1.txt') ("line one`nline two`nsee " + $fakeV1 + " here`n")
    # Something untracked is never opened: the tree is what git tracks.
    Write-Utf8 (Join-Path $tree 'loose\unadded.txt') ($fake['discord-webhook'] + "`n")
    Invoke-Git $tree @('add', 'notes')

    $r = Invoke-Scan @{ Root = $tree; Allow = $noAllow }
    yes 'a planted value fails the tree (exit 1)' ($r.Code -eq 1)
    foreach ($k in $fake.Keys) {
        yes ("rule $k names the file and line 3") ($r.Out.Contains('notes/' + $k + '.txt:3  ' + $k))
    }
    yes 'and the older v1 join token shape is still voice-join-token' ($r.Out.Contains('notes/voice-join-token-v1.txt:3  voice-join-token'))
    yes 'no planted value, or the tail of one, is in the output' (-not (Test-Leaks $r.Out))
    yes 'a file git does not track is not read' (-not $r.Out.Contains('unadded'))

    # The same run as GitHub sees it: an annotation with file and line.
    $env:GITHUB_ACTIONS = 'true'
    $r = Invoke-Scan @{ Root = $tree; Allow = $noAllow }
    $env:GITHUB_ACTIONS = ''
    yes 'on GitHub a hit is an annotation naming file and line' ($r.Out.Contains('::error file=notes/discord-webhook.txt,line=3::discord-webhook'))
    yes 'and still without the value' (-not (Test-Leaks $r.Out))

    # The allow list passes a known non-secret by path and rule, and only that.
    $allow = Join-Path $work 'allow.txt'
    Write-Utf8 $allow "# test`nnotes/discord-webhook.txt  discord-webhook`nnotes/github-token.txt  discord-webhook`n"
    $r = Invoke-Scan @{ Root = $tree; Allow = $allow }
    yes 'an allowed path and rule is passed' (-not $r.Out.Contains('notes/discord-webhook.txt:3'))
    yes 'an allow line for the wrong rule passes nothing' ($r.Out.Contains('notes/github-token.txt:3  github-token'))
    yes 'and the allowed one is counted' ($r.Out -match '1 known non-secret')

    # By name: files that hold a credential whatever is in them.
    Invoke-Git $tree @('rm', '-r', '-q', '--cached', 'notes')
    Remove-Item -LiteralPath (Join-Path $tree 'notes') -Recurse -Force
    foreach ($n in 'config.json', 'bot\news-webhook.txt', 'voice\token-key.txt', 'server-secret.txt', 'deploy\id_ed25519', 'bot.env.json') {
        Write-Utf8 (Join-Path $tree $n) "{}`n"
    }
    Invoke-Git $tree @('add', '-A', '--', 'config.json', 'scripts', 'bot', 'voice', 'server-secret.txt', 'deploy', 'bot.env.json')
    $r = Invoke-Scan @{ Root = $tree; Allow = $noAllow }
    yes 'a tracked credential file fails by its name alone' ($r.Code -eq 1)
    foreach ($n in 'config.json', 'bot/news-webhook.txt', 'voice/token-key.txt', 'server-secret.txt', 'deploy/id_ed25519', 'bot.env.json') {
        yes ("$n is named") ($r.Out.Contains($n + ':0  credential-file-name'))
    }
    yes 'a clean tracked file beside them is not' (-not $r.Out.Contains('thing.js'))

    # ---------------------------------------------------------------- packs
    # The 19 September incident, as a pack: voice-token.txt with a token in it.
    $bad = Join-Path $work 'pack-bad.zip'
    New-Zip $bad @{
        'game/Data/Platform/voice-token.txt' = (Get-Bytes ($fake['voice-join-token']))
        'game/Data/Platform/Plugins/thornswood-front.js' = (Get-Bytes "var a = 1;`n")
        'profile/plugins.txt' = (Get-Bytes "*Skyrim.esm`n")
    }
    $r = Invoke-Scan @{ Zip = @($bad); Allow = $noAllow }
    yes 'a pack carrying voice-token.txt fails (exit 1)' ($r.Code -eq 1)
    yes 'by its name' ($r.Out.Contains('pack-bad.zip!game/Data/Platform/voice-token.txt:0  credential-file-name'))
    yes 'by Ship-Rules' ($r.Out.Contains('game/Data/Platform/voice-token.txt:0  never-ship-machine'))
    yes 'and by the shape of what is in it' ($r.Out.Contains('game/Data/Platform/voice-token.txt:1  voice-join-token'))
    yes 'the token itself is not in the output' (-not (Test-Leaks $r.Out))
    yes 'our own overlay beside it is not named' (-not $r.Out.Contains('thornswood-front.js'))

    # The installer incident: the SkyMP client's saved sign in.
    $signin = Join-Path $work 'pack-signin.zip'
    New-Zip $signin @{ 'game/Data/Platform/PluginsNoLoad/auth-data-no-load.js' = (Get-Bytes "x`n") }
    $r = Invoke-Scan @{ Zip = @($signin); Allow = $noAllow }
    yes 'a pack carrying the SkyMP sign in fails' ($r.Code -eq 1 -and $r.Out.Contains('auth-data-no-load.js:0  credential-file-name') -and $r.Out.Contains('auth-data-no-load.js:0  never-ship-machine'))

    # A file only Ship-Rules knows about: no secret word, no secret shape.
    $machine = Join-Path $work 'pack-machine.zip'
    New-Zip $machine @{
        'game/Data/SKSE/Plugins/SSEDisplayTweaks.ini' = (Get-Bytes "[Render]`n")
        'game/_to_delete/old.js' = (Get-Bytes "x`n")
        'game/Data/Platform/thornswood-front.log' = (Get-Bytes "x`n")
    }
    $r = Invoke-Scan @{ Zip = @($machine); Allow = $noAllow }
    yes 'one machine''s settings in a pack fail by Ship-Rules' ($r.Out.Contains('SSEDisplayTweaks.ini:0  never-ship-machine'))
    yes 'so does a runtime folder' ($r.Out.Contains('game/_to_delete/old.js:0  never-ship-runtime'))
    yes 'and a log' ($r.Out.Contains('thornswood-front.log:0  never-ship'))

    $good = Join-Path $work 'pack-good.zip'
    New-Zip $good @{
        'game/Data/Platform/Plugins/thornswood-front.js' = (Get-Bytes "var a = 1;`n")
        'game/Data/Platform/UI/index.html' = (Get-Bytes "<html></html>`n")
        'delete.txt' = (Get-Bytes "Data/Interface/map.swf`n")
        'profile/plugins.txt' = (Get-Bytes "*Skyrim.esm`n")
    }
    $r = Invoke-Scan @{ Zip = @($good); Allow = $noAllow }
    yes 'a clean pack passes (exit 0)' ($r.Code -eq 0)

    # UTF-16 with a byte order mark, as PowerShell 5.1 writes a text file.
    $wide = Join-Path $work 'pack-wide.zip'
    $u16 = [byte[]](@(0xFF, 0xFE) + [Text.Encoding]::Unicode.GetBytes("a`n" + $fake['github-token'] + "`n"))
    New-Zip $wide @{ 'game/Data/Platform/notes.txt' = $u16 }
    $r = Invoke-Scan @{ Zip = @($wide); Allow = $noAllow }
    yes 'a UTF-16 text file is read as text' ($r.Out.Contains('notes.txt:2  github-token'))

    # A download may carry a config.json on purpose (the setup's carries the
    # channel's server and site), so a zip is not failed for that name; it is
    # failed for what is in it.
    $conf = Join-Path $work 'with-config.zip'
    New-Zip $conf @{
        'config.json' = (Get-Bytes ('{"UpdateToken": ""}' + "`n"))
        'game/Data/Platform/Plugins/thornswood-front.js' = (Get-Bytes "var a = 1;`n")
    }
    $r = Invoke-Scan @{ Zip = @($conf); Allow = $noAllow }
    yes 'a zip''s own config.json is not failed by name' ($r.Code -eq 0)
    $conf2 = Join-Path $work 'with-config-2.zip'
    New-Zip $conf2 @{
        'config.json' = (Get-Bytes ('{"UpdateToken": "' + $fake['github-token'] + '"}' + "`n"))
        'game/Data/SKSE/Plugins/Thornswood.ini' = (Get-Bytes "[Keys]`n")
    }
    $r = Invoke-Scan @{ Zip = @($conf2); Allow = $noAllow }
    yes 'a plain update token in a zip''s config.json fails' ($r.Out.Contains('with-config-2.zip!config.json:1  github-token'))
    yes 'and game/ is the game, asked of Ship-Rules' ($r.Out.Contains('game/Data/SKSE/Plugins/Thornswood.ini:0  never-ship-machine'))
    yes 'without the value' (-not (Test-Leaks $r.Out))
    # payload/ was the old installer's game (#4824); nothing reads it as one now.
    $old = Join-Path $work 'old-payload.zip'
    New-Zip $old @{ 'payload/Data/SKSE/Plugins/Thornswood.ini' = (Get-Bytes "[Keys]`n") }
    $r = Invoke-Scan @{ Zip = @($old); Allow = $noAllow }
    yes 'payload/ is not asked of Ship-Rules any more: the old installer went' ($r.Code -eq 0 -and -not $r.Out.Contains('never-ship-machine'))
    # A program at the top of a zip is read byte by byte.
    $top = Join-Path $work 'program-on-top.zip'
    New-Zip $top @{ 'Thornswood.exe' = [byte[]](@(0x4D, 0x5A, 0x00, 0x00, 0x00) + [Text.Encoding]::Unicode.GetBytes($fake['github-token'])) }
    $r = Invoke-Scan @{ Zip = @($top); Allow = $noAllow }
    yes 'a program at the top of a zip is read byte by byte' ($r.Code -eq 1 -and $r.Out -match 'Thornswood\.exe at byte \d+  github-token')
    yes 'without its value' (-not (Test-Leaks $r.Out))

    # Something that will not open is not a pass.
    $notzip = Join-Path $work 'pack-broken.zip'
    Write-Utf8 $notzip 'not a zip'
    $r = Invoke-Scan @{ Zip = @($notzip); Allow = $noAllow }
    yes 'a zip that does not open is exit 2, not a pass' ($r.Code -eq 2)

    # The Setup program: a small program with a zip appended. .NET reports no
    # entries for that file. Reading it must see the planted token, and a clean
    # one must pass with its real entry count, not "0 entries".
    $sfx = Join-Path $work 'Thornswood-Setup.exe'
    New-Sfx $sfx @{
        'game/Data/Platform/voice-token.txt' = (Get-Bytes ($fake['voice-join-token']))
        'game/Data/Platform/Plugins/thornswood-front.js' = (Get-Bytes "var a = 1;`n")
    }
    $r = Invoke-Scan @{ Zip = @($sfx); Allow = $noAllow }
    yes 'a Setup program with an appended zip is read, not passed as empty' ($r.Code -eq 1 -and $r.Out -match 'Thornswood-Setup\.exe: 2 entries' -and $r.Out.Contains('voice-token.txt:1  voice-join-token'))
    yes 'and that token is not in the output' (-not (Test-Leaks $r.Out))
    $sfxClean = Join-Path $work 'Thornswood-Setup-clean.exe'
    New-Sfx $sfxClean @{
        'game/Data/Platform/Plugins/thornswood-front.js' = (Get-Bytes "var a = 1;`n")
    }
    $r = Invoke-Scan @{ Zip = @($sfxClean); Allow = $noAllow }
    yes 'a clean Setup program with an appended zip passes, and not as 0 entries' ($r.Code -eq 0 -and $r.Out -match 'Thornswood-Setup-clean\.exe: 1 entries' -and $r.Out -notmatch '0 entries')


    # ---------------------------------------------------------------- programs
    # A built program keeps its strings as UTF-16, at any alignment.
    $prog = Join-Path $work 'Thornswood.exe'
    $blob = New-Object 'System.Collections.Generic.List[byte]'
    $blob.AddRange([byte[]](0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04))
    $blob.AddRange([Text.Encoding]::Unicode.GetBytes($fake['discord-webhook']))
    $blob.AddRange([byte[]](0x00, 0x00, 0xFF, 0x00))
    $blob.AddRange([Text.Encoding]::ASCII.GetBytes($fake['aws-access-key']))
    $blob.AddRange([byte[]](0x00, 0x01))
    [IO.File]::WriteAllBytes($prog, $blob.ToArray())
    $r = Invoke-Scan @{ Binary = @($prog); Allow = $noAllow }
    # The address starts at byte 9 and "discord" is 8 characters in, 2 bytes each.
    yes 'a program with a UTF-16 webhook at an odd byte fails, at the right byte' ($r.Code -eq 1 -and $r.Out.Contains('at byte 25  discord-webhook'))
    yes 'and an ASCII key in it is found too' ($r.Out -match 'at byte \d+  aws-access-key')
    yes 'without either value' (-not (Test-Leaks $r.Out))
    $clean = Join-Path $work 'clean.exe'
    [IO.File]::WriteAllBytes($clean, [byte[]](0x4D, 0x5A, 0x00, 0x00, 0x41, 0x00, 0x42, 0x00))
    $r = Invoke-Scan @{ Binary = @($clean); Allow = $noAllow }
    yes 'a clean program passes' ($r.Code -eq 0)

    # -------------------------------------------- the old installer's inputs
    # -Dir read the old installer's staged folder and -ClientRecord held its
    # client to the record of the launcher it packed (#3099); both went with
    # that installer (#4824).
    $tok = $null; $err = $null
    $sAst = [System.Management.Automation.Language.Parser]::ParseFile($scan, [ref]$tok, [ref]$err)
    $sParams = @($sAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    yes 'Check-Secrets.ps1 has no -Dir and no -ClientRecord' ($sParams -contains 'Zip' -and $sParams -notcontains 'Dir' -and $sParams -notcontains 'ClientRecord')

    # ---------------------------------------------------------------- the repo
    $repo = $here
    $r = Invoke-Scan @{}
    yes 'this repository as it stands passes (exit 0)' ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out }

    # Wired in before anything leaves: the upload in Publish-Update, and both
    # steps in the build check. Package-Thornswood scanned the installer's
    # stage until the old installer pipeline went (#4824).
    $pub = [IO.File]::ReadAllText((Join-Path $here 'scripts\release\Publish-Update.ps1'))
    $a = $pub.IndexOf("Check-Secrets.ps1')")
    $b = $pub.IndexOf('# ==== thornswood site upload ====')
    yes 'Publish-Update runs the scan over what it built' ($a -ge 0 -and $pub.Contains('-Zip $scanZips'))
    yes 'and before the upload' ($a -ge 0 -and $b -gt $a)

    # And the hook itself, run: the block out of the script, with Die
    # recording instead of exiting. The rest of that script publishes and
    # uploads, so it cannot be run here.
    function Invoke-Hook([string]$src, [string]$from, [string]$to) {
        $i = $src.IndexOf($from); $j = $src.IndexOf($to)
        if ($i -lt 0 -or $j -le $i) { return 'no hook' }
        $script:died = ''
        $global:LASTEXITCODE = 0
        [void](& { Invoke-Expression $src.Substring($i, $j - $i) } *>&1 | ForEach-Object { [string]$_ })
        return $script:died
    }
    function Die($m) { $script:died = [string]$m }
    function Head($m) { }
    # The hook runs as if from its own folder, scripts\release, where its
    # Join-Path $Here reaches Check-Secrets.ps1 in scripts\dev.
    $Here = Join-Path $here (Join-Path 'scripts' 'release')
    $pubFrom = '# ---- nothing that must never ship, read off what was built'
    # The upload, which is the site one since #897 and the only one since #907.
    $pubTo = "if (-not `$NoUpload) {"
    $Launcher = $false; $exePath = ''; $clientRel = $null
    $chunks = @([pscustomobject]@{ Path = $bad })
    $d = Invoke-Hook $pub $pubFrom $pubTo
    yes 'Publish-Update stops before the upload on a pack carrying a token' ($d -ne 'no hook' -and $d -match 'Nothing was uploaded')
    $chunks = @([pscustomobject]@{ Path = $good })
    $d = Invoke-Hook $pub $pubFrom $pubTo
    yes 'and lets a clean pack through' ($d -eq '')
    # No launcher is published here since #4825 (it goes out through Velopack,
    # whose workflow scans what it publishes, below), so a launcher left
    # beside the release is not read: nothing sends it.
    $Launcher = $true; $exePath = $prog
    $d = Invoke-Hook $pub $pubFrom $pubTo
    yes 'and reads no launcher, which a publish no longer sends (#4825)' ($d -eq '')
    $Launcher = $false; $exePath = ''
    $clientRel = [pscustomobject]@{ path = $signin }
    $d = Invoke-Hook $pub $pubFrom $pubTo
    yes 'and reads the client runtime zip too' ($d -match 'Nothing was uploaded')
    $clientRel = $null

    $yml = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\build.yml'))
    $t = $yml.IndexOf('name: Scan the tree for secrets')
    yes 'the build check scans the tree' ($t -ge 0)
    # Since #4823 the step that publishes the native launcher scans every
    # program it published, after publishing them.
    $pub = $yml.IndexOf('name: Publish the native launcher')
    $built = $(if ($pub -ge 0) { $yml.IndexOf('scripts\release\Build-Launcher.ps1', $pub) } else { -1 })
    $scan = $(if ($built -ge 0) { $yml.IndexOf('scripts\dev\Check-Secrets.ps1 -Binary $programs', $built) } else { -1 })
    $next = $(if ($pub -ge 0) { $yml.IndexOf('- name:', $pub + 10) } else { -1 })
    yes 'and the launcher programs it published, after publishing them' ($pub -ge 0 -and $built -gt $pub -and $scan -gt $built -and ($next -lt 0 -or $scan -lt $next))

    # ---------------------------------------------------------------- this machine
    # The two dev packs this machine still has that carried a real token. The
    # scan must fail both and still print nothing but names.
    foreach ($p in 'C:\Thornswood-DevBuild\_dist\pack-20260919-2102-dev.zip', 'C:\Thornswood-DevBuild\_dist\pack-20260920-1302-dev.zip') {
        if (-not (Test-Path -LiteralPath $p)) { Write-Host ('SKIP  ' + (Split-Path $p -Leaf) + ' is not on this machine'); continue }
        $r = Invoke-Scan @{ Zip = @($p) }
        yes ((Split-Path $p -Leaf) + ' fails on its voice-token.txt') ($r.Code -eq 1 -and $r.Out.Contains('voice-token.txt:1  voice-join-token'))
        yes '  and the output has no token shape in it' (-not ($r.Out -match 'v1\.\d+\.\d{12,14}\.'))
    }
} finally {
    $env:GITHUB_ACTIONS = $savedActions
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
