<#
  test-2740-shared-reads.ps1

      pwsh -NoProfile -File .\tests\test-2740-shared-reads.ps1

  Issue #2740. The gamemode now writes online.json, online-names.json and
  allowed.json whole through the engine's mp.writeFileWhole: a new file
  beside the old one, renamed over it with POSIX semantics. That rename is
  refused while a reader has the file open WITHOUT share-delete, and
  Get-Content opens without it (FileShare ReadWrite). The deploys and
  Set-Door read these files on the box while the server runs, so every one of
  those reads opens the file sharing ReadWrite and Delete.

  And the band-aid that covered the in-place write comes out with it:
  Deploy-DevGamemode's Warn-DevRoom slept two seconds and read online.json a
  second time when the first read landed on a write. The gamemode's write is
  whole now, so a read gets one count or the other, and there is one read.

  WHAT IT HOLDS IT TO.
    1. Deploy-DevGamemode.ps1 (Get-DevRoom), Deploy-Server.ps1
       (Get-LiveOnline) and Set-Door.ps1 read online.json, online-names.json
       and allowed.json through a FileStream sharing ReadWrite and Delete,
       never Get-Content.
    2. Warn-DevRoom looks once: no Start-Sleep, no second Get-DevRoom.
    3. In PowerShell 7 (the box runs these reads with it since #5356): the
       read the deploys send, run while the file is
       replaced by a POSIX rename (Feed-Store.ps1's Move-FeedStoreInto, the
       same rename as the engine's), does not stop the rename and reads the
       old count whole; on Windows, Get-Content's open does stop it.

  -Repo runs it against another checkout's scripts (main before #2740 fails
  1, 2 and 3). Nothing outside its own temp folder is written.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}
function Text([string]$p) { return ([IO.File]::ReadAllText($p) -replace "`r`n", "`n") }
# The body of a function, from its line to the closing brace at the start of a
# line; for one that sends a here-string, to the brace after the here-string.
function Body([string]$text, [string]$name, [switch]$Sends) {
    $end = if ($Sends) { '\n"@\)\n\}' } else { '\n\}' }
    return [regex]::Match($text, "(?s)\nfunction $([regex]::Escape($name))\b.*?$end").Value
}
$shared = '\[IO\.FileShare\]::ReadWrite -bor \[IO\.FileShare\]::Delete'

# ---- 1 and 2: the reads ----------------------------------------------------------
$dev = Text (Join-Path $Repo 'scripts\deploy\Deploy-DevGamemode.ps1')
$room = Body $dev 'Get-DevRoom' -Sends
Yes 'Deploy-DevGamemode: Get-DevRoom is there' ($room.Length -gt 0)
Yes '...it reads online.json through a FileStream sharing ReadWrite and Delete' (
    $room -match $shared -and $room -match 'ReadShared `\$o' -and $room -notmatch 'Get-Content `\$o')
Yes '...and online-names.json the same way' ($room -match 'ReadShared `\$nf' -and $room -notmatch 'Get-Content `\$nf')
$warn = Body $dev 'Warn-DevRoom'
Yes 'Deploy-DevGamemode: Warn-DevRoom is there' ($warn.Length -gt 0)
# Its countdown further down waits and counts again on purpose, while people
# are told to leave; the look before the warning is what had the second try.
$before = [regex]::Match($warn, '(?s)^.*?if \(\$room\.Port -eq 7777\)').Value
Yes '...and looks once before warning anybody: no sleep and no second read of the room' (
    $before.Length -gt 0 -and $before -notmatch 'Start-Sleep' -and ([regex]::Matches($before, 'Get-DevRoom')).Count -eq 1)

$live = Text (Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1')
$liveRoom = Body $live 'Get-LiveOnline' -Sends
Yes 'Deploy-Server: Get-LiveOnline is there' ($liveRoom.Length -gt 0)
Yes '...it reads online.json through a FileStream sharing ReadWrite and Delete' (
    $liveRoom -match $shared -and $liveRoom -match "ReadShared \(Join-Path ``\`$dataPath 'online\.json'\)" -and
    $liveRoom -notmatch "Get-Content \(Join-Path ``\`$dataPath 'online\.json'\)")
Yes '...and online-names.json the same way' ($liveRoom -match 'ReadShared `\$nf' -and $liveRoom -notmatch 'Get-Content `\$nf')

$door = Text (Join-Path $Repo 'scripts\ops\Set-Door.ps1')
Yes 'Set-Door: both reads of allowed.json open it sharing ReadWrite and Delete' (
    ([regex]::Matches($door, "New-Object IO\.FileStream\(``\`$f, \[IO\.FileMode\]::Open, \[IO\.FileAccess\]::Read, \($shared\)\)")).Count -eq 2 -and
    $door -notmatch 'Get-Content `\$f')

# ---- 3: the read the deploys send, beside a POSIX rename --------------------------
# ReadShared as the box runs it: the here-string's escapes taken off.
$readShared = [regex]::Match($liveRoom, '(?s)function ReadShared\(.*?\n\}').Value -replace '`\$', '$'
$storePs1 = Join-Path $Repo 'scripts\release\Feed-Store.ps1'
Yes 'the read the deploys send and Feed-Store.ps1''s POSIX rename are both there' ($readShared.Length -gt 0 -and (Test-Path -LiteralPath $storePs1))
if (-not $readShared -or -not (Test-Path -LiteralPath $storePs1)) { Done }
# 3 is how an open file is shared with a rename, in the shell the box has.
. (Join-Path $PSScriptRoot 'Windows.ps1')

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2740-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $held = Join-Path $work 'held.ps1'
    [IO.File]::WriteAllText($held, ("param(`$store, `$dir)`n" + $readShared + "`n" + @'
$ErrorActionPreference = 'Stop'
. $store
function Say([string]$name, [bool]$ok, [string]$saw) { ($(if ($ok) { 'OK ' } else { 'NO ' }) + $name + ' | ' + $saw) }
function Swap($from, $to) { try { Move-FeedStoreInto $from $to; return '' } catch { return [string]$_.Exception.Message } }

# a. the deploys' read holding online.json while the gamemode replaces it
$to = Join-Path $dir 'a\online.json'; $part = Join-Path $dir 'a\.online.json.whole-1-0'
$null = New-Item -ItemType Directory -Force -Path (Split-Path $to)
[IO.File]::WriteAllText($to, '{"now":3,"at":1}'); [IO.File]::WriteAllText($part, '{"now":12,"at":2,"full":false}')
$h = New-Object IO.FileStream($to, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
$err = Swap $part $to
$r = New-Object IO.StreamReader($h); $was = $r.ReadToEnd(); $r.Dispose()
$now = ReadShared $to
Say 'shared' ($err -eq '' -and $was -eq '{"now":3,"at":1}' -and ($now | ConvertFrom-Json).now -eq 12) ("error '" + $err + "', the held read got " + $was + ", ReadShared now reads " + $now)

# b. ReadShared itself, start to end, between two renames
$to = Join-Path $dir 'b\online.json'
$null = New-Item -ItemType Directory -Force -Path (Split-Path $to)
$bad = 0; $errs = 0
for ($i = 0; $i -lt 200; $i++) {
  $part = Join-Path $dir ('b\.online.json.whole-1-' + $i)
  [IO.File]::WriteAllText($part, '{"now":' + $i + '}')
  $e = Swap $part $to
  if ($e) { $errs++ }
  try { if ($null -eq (ReadShared $to | ConvertFrom-Json).now) { $bad++ } } catch { $bad++ }
}
Say 'loop' ($errs -eq 0 -and $bad -eq 0) ("$errs renames refused, $bad reads without a count, of 200")

# c. Get-Content's open, ReadWrite without Delete, refuses the rename
$to = Join-Path $dir 'c\online.json'; $part = Join-Path $dir 'c\.online.json.whole-1-0'
$null = New-Item -ItemType Directory -Force -Path (Split-Path $to)
[IO.File]::WriteAllText($to, '{"now":3}'); [IO.File]::WriteAllText($part, '{"now":4}')
$h = New-Object IO.FileStream($to, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$err = Swap $part $to
$h.Dispose()
Say 'get-content' ($err -match 'being used by another process' -and [IO.File]::ReadAllText($to) -eq '{"now":3}') ("error '" + $err + "'")
'@))
    $shells = @(@{ Name = 'the box''s PowerShell 7'; Exe = (Get-BoxPowerShell) })
    foreach ($sh in $shells) {
        $dir = Join-Path $work ($sh.Name -replace '\W', '')
        $out = @(& $sh.Exe -NoProfile -ExecutionPolicy Bypass -File $held $storePs1 $dir 2>&1 | ForEach-Object { [string]$_ })
        # Share modes are Windows': off Windows an open file refuses no
        # rename, so Get-Content's open has nothing to stop there.
        $names = @('shared', 'loop')
        if ($OnWindows) { $names += 'get-content' }
        else { Write-Host ("SKIP  {0}: Get-Content's open stops the rename: share modes are Windows', and off Windows an open file refuses no rename" -f $sh.Name) }
        foreach ($name in $names) {
            $line = @($out | Where-Object { $_ -match "^(OK|NO) $name \|" }) | Select-Object -First 1
            $what = switch ($name) {
                'shared' { 'the deploys'' read holding online.json does not stop the POSIX rename, and reads the old count whole' }
                'loop' { 'ReadShared between 200 renames: none refused, every read a count' }
                'get-content' { 'Get-Content''s open (ReadWrite, no Delete) does stop it, the file left as it was' }
            }
            Yes ("{0}: {1} ({2})" -f $sh.Name, $what, $(if ($line) { $line } else { ($out -join ' / ') })) ([string]$line).StartsWith('OK ')
        }
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
