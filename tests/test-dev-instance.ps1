<#
  test-dev-instance.ps1

      powershell -NoProfile -File .\tests\test-dev-instance.ps1

  vps-dev-instance.ps1 makes the dev game server and dev voice from the live
  ones without taking anything private of live's, and starts dev voice the way
  live runs (issues #1082 and #1083).

  WHY THIS EXISTS. It copied the live server with everything but data and
  world, so a fresh dev server started with live's private folder: the live
  door.json (the live site's address and the key the site trusts), live's
  allowed list and live's character cards. And it wrote a dev voice run file
  with only a port and a site, so dev voice fell back to letting unproven
  joins in, on every address, until somebody ran Install-Voice.ps1 over it.

  It runs the real script with -FilesOnly against a scratch live server and a
  scratch live voice folder, each holding everything a real one does, and
  reads back what dev got:
    - no private file of live's anywhere in dev: no door.json, no allowed.json,
      live's characters.json not copied, and dev's own characters.json empty
    - the program, plugins, manifest and the data scripts are there; the world,
      the logs and live's data files are not
    - server-settings.json has the dev port, name and plugin paths
    - dev voice has the program, every file it requires (read out of
      voice\voice-server.js, so headlines.js today, #1870) and the roller,
      and none of live's chat logs, token-key.txt, turn-key.txt, secret.txt
      or choices.json
    - the run file sets auth on and 127.0.0.1, and starts voice with them
    - both dev folders take nothing from above and no Users rule reaches them
    - run again, it copies nothing more of live's private and keeps dev's own
    - the script opens no firewall rule for dev voice and takes an old one down
  Touches nothing but its scratch folder, and registers no task.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$script = Join-Path $repo 'scripts\vps\vps-dev-instance.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')

# Every file the voice service requires, read out of the repository's
# voice\voice-server.js and whatever that requires in turn: the relative
# require('./name') calls, as file names in the voice folder. Since #1406 that
# is headlines.js, and a dev voice folder without it stops at the first line
# (#1870). Read here rather than written out, so a require added later is
# wanted in dev the day it is added.
$voiceDir = Join-Path $repo 'voice'
$required = @()
$outside = @()
$toRead = New-Object Collections.Generic.Queue[string]
$toRead.Enqueue('voice-server.js')
while ($toRead.Count) {
    $f = $toRead.Dequeue()
    $src = [IO.File]::ReadAllText((Join-Path $voiceDir $f))
    foreach ($m in [regex]::Matches($src, "require\(\s*['""](\.{1,2}/[^'""]+)['""]\s*\)")) {
        $rel = $m.Groups[1].Value
        if ($rel -notmatch '^\./[^/]+$') { $outside += "$f requires $rel"; continue }
        $name = $rel.Substring(2)
        if (-not [IO.Path]::HasExtension($name)) { $name += '.js' }
        if ($required -contains $name) { continue }
        $required += $name
        if (Test-Path -LiteralPath (Join-Path $voiceDir $name)) { $toRead.Enqueue($name) } else { $outside += "$f requires $rel, which voice\ does not have" }
    }
}

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Put([string]$p, [string]$t) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p)
    [IO.File]::WriteAllText($p, $t)
}
function Get([string]$p) { if (Test-Path -LiteralPath $p) { return [IO.File]::ReadAllText($p) } return $null }
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Broad([string]$p) {
    $acl = Get-Acl -LiteralPath $p
    return @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
             Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11') -contains $_.IdentityReference.Value }).Count
}

# ---- the parts -FilesOnly does not run ----------------------------------------------
$body = Get-Content -LiteralPath $script -Raw
$copy = [regex]::Match($body, '(?m)^\s*& robocopy \$liveVoice \$devVoice ([^\r\n/]+)/')
$named = @($copy.Groups[1].Value.Trim() -split '\s+' | Where-Object { $_ })
Yes ('voice-server.js requires ' + ($required -join ', ') + ', each a file beside it in voice\') ($required.Count -ge 1 -and $outside.Count -eq 0)
foreach ($o in $outside) { Write-Host "      $o" }
Yes ('the script copies each of them to dev voice by name, with the program and the log writer (' + ($named -join ' ') + ')') (
    $copy.Success -and $named -contains 'voice-server.js' -and $named -contains 'server-log.js' -and
    @($required | Where-Object { $named -notcontains $_ }).Count -eq 0)
Yes 'the script opens no firewall rule for dev voice' ($body -notmatch "Name = 'Thornswood Dev Voice'")
Yes 'and takes an old one down' ($body -match "Remove-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood Dev Voice'")
Yes 'it never copies live''s private folder' ($body -match '& robocopy \$live \$dev [^\r\n]*/XD [^\r\n]*\bprivate\b')

# ---- run -FilesOnly, in the box's PowerShell 7 -----------------------------------
if (-not $OnWindows) {
    Write-Host 'SKIP  the -FilesOnly runs: the script copies with robocopy and sets Windows ACLs, which only Windows has'
    Done
}
$ps = Get-BoxPowerShell
$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-instance-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $box
# The Users rule every folder under C:\ carries, given to the scratch folder
# so the dev folders made in it inherit it the way they do on the box.
$acl = Get-Acl -LiteralPath $box
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')), 'ReadAndExecute', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
Set-Acl -LiteralPath $box -AclObject $acl

try {
    $live = Join-Path $box 'Thornswood-Server'; $dev = Join-Path $box 'Thornswood-Server-Dev'
    $lv = Join-Path $box 'Thornswood-Voice'; $dv = Join-Path $box 'Thornswood-Voice-Dev'
    $liveFwd = ($live -replace '\\', '/')
    Put (Join-Path $live 'dist_back\skymp5-server.js') '// the server'
    Put (Join-Path $live 'gamemode.js') '// the gamemode'
    Put (Join-Path $live 'plugins\A.esp') 'plugin'
    Put (Join-Path $live 'roll-log.ps1') '# roller'
    Put (Join-Path $live 'server-settings.json') ((@{ port = 7777; name = 'Thornswood'; loadOrder = @($liveFwd + '/plugins/A.esp') }) | ConvertTo-Json)
    Put (Join-Path $live 'server.log') 'live log'
    Put (Join-Path $live 'server.log.1') 'live log rolled'
    Put (Join-Path $live 'world\w.txt') 'live characters'
    Put (Join-Path $live 'world-before-x\w.txt') 'old world'
    Put (Join-Path $live 'private\door.json') '{ "site": "https://thornswood.net", "key": "LIVE-DOOR-KEY" }'
    Put (Join-Path $live 'private\allowed.json') '["live list"]'
    Put (Join-Path $live 'private\characters.json') '["live character card"]'
    Put (Join-Path $live 'data\door.json') '{ "key": "LIVE-DOOR-KEY-OLD-PLACE" }'
    Put (Join-Path $live 'data\allowed.json') '["live list, old place"]'
    Put (Join-Path $live 'data\manifest.json') '{ "mods": [] }'
    Put (Join-Path $live 'data\book.txt') 'live character book'
    Put (Join-Path $live 'data\scripts\s.js') '// script'
    Put (Join-Path $live 'data\api\a.json') '{}'
    Put (Join-Path $lv 'voice-server.js') '// voice'
    foreach ($r in $required) { Put (Join-Path $lv $r) "// $r" }
    Put (Join-Path $lv 'roll-log.ps1') '# the roller voice ran behind before #2166'
    Put (Join-Path $lv 'server-log.js') '// the log writer voice runs under (#2166)'
    Put (Join-Path $lv 'public\index.html') '<html></html>'
    Put (Join-Path $lv 'chat\20260928.jsonl') '{"text":"what live people said"}'
    Put (Join-Path $lv 'token-key.txt') 'LIVE-TOKEN-KEY'
    Put (Join-Path $lv 'turn-key.txt') 'LIVE-TURN-KEY'
    Put (Join-Path $lv 'secret.txt') 'LIVE-OLD-SECRET'
    Put (Join-Path $lv 'choices.json') '{}'
    Put (Join-Path $lv 'voice.log') 'live voice log'

    function Run {
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script, '-FilesOnly',
               '-Live', $live, '-Dev', $dev, '-LiveVoice', $lv, '-DevVoice', $dv)
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $ps @a 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
        $script:code = $LASTEXITCODE
        return $o
    }
    $out = Run
    Yes ('the script runs to the end with -FilesOnly (exit ' + $script:code + ')') ($script:code -eq 0 -and ($out -join "`n") -match 'done, files only')
    if ($script:code -ne 0) { $out | ForEach-Object { Write-Host "      $_" } }

    # ---- the game server ----------------------------------------------------
    $all = @(Get-ChildItem -LiteralPath $dev -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($dev.Length + 1) })
    $text = (@($all | ForEach-Object { Get (Join-Path $dev $_) }) -join "`n")
    Yes 'no door.json anywhere in dev' (@($all | Where-Object { $_ -match 'door\.json$' }).Count -eq 0)
    Yes 'no allowed.json anywhere in dev' (@($all | Where-Object { $_ -match 'allowed\.json$' }).Count -eq 0)
    Yes 'nothing of live''s door key, list or cards in any dev file' ($text -notmatch 'LIVE-DOOR-KEY|live list|live character card')
    Yes 'dev''s private holds its own empty characters.json and nothing else' (
        (@(Get-ChildItem -LiteralPath (Join-Path $dev 'private') -Force | ForEach-Object Name) -join ',') -eq 'characters.json' -and
        (Get (Join-Path $dev 'private\characters.json')).Trim() -eq '[]')
    Yes 'the program, gamemode, plugins and roller came across' (
        (Test-Path -LiteralPath (Join-Path $dev 'dist_back\skymp5-server.js')) -and (Test-Path -LiteralPath (Join-Path $dev 'gamemode.js')) -and
        (Test-Path -LiteralPath (Join-Path $dev 'plugins\A.esp')) -and (Test-Path -LiteralPath (Join-Path $dev 'roll-log.ps1')))
    Yes 'and the manifest and the data scripts and api' (
        (Test-Path -LiteralPath (Join-Path $dev 'data\manifest.json')) -and (Test-Path -LiteralPath (Join-Path $dev 'data\scripts\s.js')) -and (Test-Path -LiteralPath (Join-Path $dev 'data\api\a.json')))
    Yes 'not the world, the old world, the logs or live''s character book' (
        -not (Test-Path -LiteralPath (Join-Path $dev 'world')) -and -not (Test-Path -LiteralPath (Join-Path $dev 'world-before-x')) -and
        -not (Test-Path -LiteralPath (Join-Path $dev 'server.log')) -and -not (Test-Path -LiteralPath (Join-Path $dev 'server.log.1')) -and
        -not (Test-Path -LiteralPath (Join-Path $dev 'data\book.txt')))
    $s = Get-Content -LiteralPath (Join-Path $dev 'server-settings.json') -Raw | ConvertFrom-Json
    Yes 'server-settings.json: the dev port, the dev name, the plugins under the dev folder' (
        $s.port -eq 7787 -and $s.name -eq 'Thornswood Dev' -and @($s.loadOrder)[0] -eq (($dev -replace '\\', '/') + '/plugins/A.esp'))
    Yes 'the run says dev has no door yet, and what writes one' (($out -join "`n") -match 'Publish-Server\.ps1 -Channel dev writes its own')

    # ---- voice ----------------------------------------------------------------
    $v = @(Get-ChildItem -LiteralPath $dv -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($dv.Length + 1) } | Sort-Object)
    # Not the page live may still keep in public: the service serves none (#1822).
    $want = @(@('voice-server.js', 'server-log.js', 'run-dev-voice.cmd') + $required | Sort-Object)
    Yes ('dev voice has the program, what it requires, the log writer and its run file, and nothing else (' + ($v -join ', ') + ')') (
        ($v -join ',') -eq ($want -join ','))
    Yes 'none of live''s chat logs, keys or old secret' (
        -not (Test-Path -LiteralPath (Join-Path $dv 'chat')) -and -not (Test-Path -LiteralPath (Join-Path $dv 'token-key.txt')) -and
        -not (Test-Path -LiteralPath (Join-Path $dv 'turn-key.txt')) -and -not (Test-Path -LiteralPath (Join-Path $dv 'secret.txt')))
    $run = @([IO.File]::ReadAllLines((Join-Path $dv 'run-dev-voice.cmd')))
    $at = { param($rx) for ($i = 0; $i -lt $run.Count; $i++) { if ($run[$i] -match $rx) { return $i } }; return -1 }
    $node = & $at 'voice-server\.js'
    Yes 'the run file sets auth on' ((& $at '^set THORNSWOOD_VOICE_AUTH=on$') -ge 0)
    Yes 'and binds to 127.0.0.1 only' ((& $at '^set THORNSWOOD_VOICE_BIND=127\.0\.0\.1$') -ge 0)
    Yes 'and the dev port' ((& $at '^set THORNSWOOD_VOICE_PORT=7789$') -ge 0)
    Yes 'all before node starts' ($node -gt (& $at 'VOICE_AUTH') -and $node -gt (& $at 'VOICE_BIND'))
    Yes 'and nothing sets them back to log or every address' (@($run | Where-Object { $_ -match 'VOICE_AUTH=(log|off)|VOICE_BIND=0\.0\.0\.0' }).Count -eq 0)

    # ---- who may read them --------------------------------------------------------
    foreach ($p in @($dev, (Join-Path $dev 'private'), (Join-Path $dev 'private\characters.json'), (Join-Path $dev 'server-settings.json'), $dv, (Join-Path $dv 'run-dev-voice.cmd'))) {
        Yes ("no Users rule reaches $($p.Substring($box.Length + 1))") ((Broad $p) -eq 0)
    }
    Yes 'the dev folders take nothing from above' ((Get-Acl -LiteralPath $dev).AreAccessRulesProtected -and (Get-Acl -LiteralPath $dv).AreAccessRulesProtected)
    $sys = @((Get-Acl -LiteralPath (Join-Path $dev 'private')).Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-18' -and "$($_.FileSystemRights)" -match 'FullControl' })
    Yes 'SYSTEM, which the dev tasks run as, has Full Control of private' ($sys.Count -ge 1)

    # ---- again -----------------------------------------------------------------------
    Put (Join-Path $dev 'private\characters.json') '["a dev character"]'
    Put (Join-Path $dev 'private\door.json') '{ "site": "https://thornswood.net/dev" }'
    $out = Run
    Yes 'run again, it works' ($script:code -eq 0)
    Yes 'and keeps dev''s own characters and door' ((Get (Join-Path $dev 'private\characters.json')) -match 'a dev character' -and (Get (Join-Path $dev 'private\door.json')) -match '/dev')
    Yes 'and still takes no allowed.json of live''s' (-not (Test-Path -LiteralPath (Join-Path $dev 'private\allowed.json')) -and -not (Test-Path -LiteralPath (Join-Path $dev 'data\allowed.json')))
} finally {
    Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Done
