<#
  Restore-Backup.ps1

  Opens one of the nightly backups: checks it has not been tampered with,
  decrypts it, and unpacks it into a folder you name. Runs on this machine and
  touches nothing on the VPS, so it is safe to run whenever you want to know
  whether the backups are real.

      .\scripts\vps\Restore-Backup.ps1 -Backup ...\thornswood-20260918-030000.zip.enc
      .\scripts\vps\Restore-Backup.ps1 -Backup ...\thornswood-...enc -To C:\test-restore -Work C:\Thornswood-Repo\temp\restore
      .\scripts\vps\Restore-Backup.ps1 -Backup ...\thornswood-...enc -CheckOnly

  The passphrase is the one in the key file that Install-Backup.ps1 made. Pass
  -KeyFile to point at your copy of it. It is never printed and never written
  anywhere by this script.

  -CheckOnly verifies the signature, then reads the runtime change forms
  under game/world in the zip, each named with its form id in lowercase hex
  and no plugin (0.json, 1f.json, ...: the engine's FormDesc::ToString, a
  slot, not a profile id; digits alone missed every id with a letter, #5168).
  It fails when none of them has a profile id above 0 that is not deleted, the
  same question Restore-Server.ps1 asks of a world (#1047). A world of only
  deleted slots, or only change forms that are not characters, is not a backup
  of anyone. That is worth running on a schedule: it is the difference between
  having backups and believing you do.

  Putting what comes out back onto the server is RESTORING.md in the ops repo. This
  script deliberately does not do that part. Writing over a live world folder
  is not something a script should be able to do by accident.

  -Work is where the decrypted zip is written while this runs. Left out, that
  is %TEMP%. The zip holds the bot token and the site keys, so it is deleted
  before this exits, whether the backup was unpacked or the run was refused.
  -To is the folder the backup is unpacked into, and is not -Work.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$To,
  [string]$KeyFile,
  # Where the decrypted zip is written. Left out, %TEMP%. Deleted before exit.
  [string]$Work,
  [switch]$CheckOnly,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
$script:temp = $null
function Clear-RestoreZip {
  if ($script:temp -and (Test-Path -LiteralPath $script:temp)) {
    Remove-Item -LiteralPath $script:temp -Force -EA Stop
  }
}
function Die($m) {
  Clear-RestoreZip
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

if (-not $Work) { $Work = $env:TEMP }
if (-not $Work) { Die 'No folder for the decrypted backup: -Work was not passed and %TEMP% is not set.' }
try { [void][IO.Directory]::CreateDirectory($Work) }
catch { Die ("-Work is not a folder: " + $Work + " (" + $_.Exception.Message + ")") }

try {
if (-not (Test-Path -LiteralPath $Backup)) { Die "There is no file at $Backup" }
$src = (Resolve-Path -LiteralPath $Backup).Path
Head 'The backup'
Say ("  {0}" -f (Split-Path -Leaf $src))
Say ("  {0} MB, written {1}" -f [math]::Round((Get-Item $src).Length / 1MB, 2), (Get-Item $src).LastWriteTime) 'DarkGray'

$zipPath = $null

if ($src.ToLower().EndsWith('.enc')) {
  if (-not $KeyFile) {
    # Where Install-Backup.ps1 copies it down to first, then the older places.
    $guesses = @()
    $guesses += Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Documents\thornswood-backup-key.txt'
    $guesses += (Join-Path $PSScriptRoot '..\..\local\backup-key.txt'), 'C:\Thornswood-Backup\key.txt'
    foreach ($guess in $guesses) {
      if (Test-Path -LiteralPath $guess) { $KeyFile = $guess; break }
    }
  }
  if (-not $KeyFile -or -not (Test-Path -LiteralPath $KeyFile)) {
    Die 'No passphrase file. Pass -KeyFile pointing at your copy of the one Install-Backup.ps1 made.'
  }
  # "$()": an empty file reads as $null (even through [string](...)), and a method on $null throws. Without it the
  # line below, which names the empty file, was never reached.
  $pass = ("$(Get-Content -LiteralPath $KeyFile -Raw)").Trim()
  if (-not $pass) { Die "The passphrase file at $KeyFile is empty." }

  $inputFile = $null; $outputFile = $null; $kdf = $null; $hmac = $null
  $aes = $null; $decryptor = $null; $cryptoStream = $null
  $operationFailure = $null
  try {
    # Keep one read-only handle for verification and decryption. The bytes
    # cannot be replaced or written between those passes on Windows.
    $inputFile = [IO.File]::Open($src, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($inputFile.Length -lt 85) { Die 'That file is too short to be one of these backups.' }
    $header = New-Object byte[] 37
    $read = 0
    while ($read -lt $header.Length) {
      $n = $inputFile.Read($header, $read, $header.Length - $read)
      if ($n -eq 0) { Die 'That backup has an incomplete header.' }
      $read += $n
    }
    $magic = [Text.Encoding]::ASCII.GetString($header, 0, 5)
    if ($magic -ne 'TSBK1') { Die "That is not a Thornswood backup: it starts with '$magic', not TSBK1." }
    $salt = [byte[]]$header[5..20]; $iv = [byte[]]$header[21..36]
    $cipherLen = $inputFile.Length - 69
    if ($cipherLen % 16 -ne 0) { Die 'That backup has a truncated or invalid ciphertext length. Nothing was decrypted.' }
    Head 'Checking it has not been changed'
    $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new($pass, $salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
    $kEnc = $kdf.GetBytes(32); $kMac = $kdf.GetBytes(32)
    $hmac = [Security.Cryptography.HMACSHA256]::new($kMac)
    $inputFile.Position = 5
    $left = $inputFile.Length - 37
    $chunk = New-Object byte[] 1MB
    while ($left -gt 0) {
      $n = $inputFile.Read($chunk, 0, [int][Math]::Min([long]$chunk.Length, [long]$left))
      if ($n -eq 0) { Die 'That backup ended before its signature. Nothing was decrypted.' }
      [void]$hmac.TransformBlock($chunk, 0, $n, $chunk, 0); $left -= $n
    }
    [void]$hmac.TransformFinalBlock([byte[]]@(), 0, 0)
    $want = $hmac.Hash
    $mac = New-Object byte[] 32; $read = 0
    while ($read -lt $mac.Length) {
      $n = $inputFile.Read($mac, $read, $mac.Length - $read)
      if ($n -eq 0) { Die 'That backup has an incomplete signature. Nothing was decrypted.' }
      $read += $n
    }
    $diff = 0
    for ($i = 0; $i -lt 32; $i++) { $diff = $diff -bor ($want[$i] -bxor $mac[$i]) }
    if ($diff -ne 0) {
      Die 'The signature does not match. Either the passphrase is wrong or the file has been changed or damaged. Nothing was decrypted.'
    }
    Say '  signature matches' 'Green'
    # Only authenticated ciphertext reaches the plaintext file. The old
    # TSBK1 format and KDF remain unchanged; memory use stays bounded.
    $aes = [Security.Cryptography.Aes]::Create()
    $aes.KeySize = 256; $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'; $aes.Key = $kEnc; $aes.IV = $iv
    $temp = Join-Path $Work ('thornswood-restore-' + [Guid]::NewGuid().ToString('N') + '.zip')
    $outputFile = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $script:temp = $temp
    $decryptor = $aes.CreateDecryptor()
    $cryptoStream = [Security.Cryptography.CryptoStream]::new($outputFile, $decryptor, [Security.Cryptography.CryptoStreamMode]::Write, $true)
    $inputFile.Position = 37; $left = $cipherLen
    while ($left -gt 0) {
      $n = $inputFile.Read($chunk, 0, [int][Math]::Min([long]$chunk.Length, [long]$left))
      if ($n -eq 0) { throw 'The authenticated ciphertext ended prematurely.' }
      $cryptoStream.Write($chunk, 0, $n); $left -= $n
    }
    $cryptoStream.FlushFinalBlock(); $outputFile.Flush($true)
    $zipPath = $temp
    Say ("  decrypted to a zip of {0} MB" -f [math]::Round($outputFile.Length / 1MB, 2)) 'DarkGray'
  } catch { $operationFailure = $_; throw } finally {
    $cleanupFailure = $null
    foreach ($resource in @($cryptoStream, $decryptor, $outputFile, $inputFile, $aes, $hmac, $kdf)) {
      if ($null -ne $resource) {
        try { $resource.Dispose() } catch { if (-not $cleanupFailure) { $cleanupFailure = $_ } }
      }
    }
    if ($cleanupFailure -and -not $operationFailure) { throw $cleanupFailure }
  }
} else {
  $zipPath = $src
  Say '  not encrypted, so there is nothing to check' 'Yellow'
}

# ------------------------------------------------------ the entry policy ----
# Issue #2199. What a backup zip may hold, decided here and not left to how a
# given .NET happens to extract. Every entry is checked before one byte is
# written, and the first that breaks a rule refuses the whole backup with a
# named reason:
#
#   kind       a plain file or a folder. A symlink, a device, a fifo or a
#              Windows reparse point (by the entry's external attributes) is
#              refused: the backup never makes one
#   name       relative, made of ordinary path parts: no drive or colon (which
#              is also a Windows alternate stream), no leading slash, no '.'
#              or '..' part, no empty part (a doubled slash), no control or
#              <>"|?* characters, no part ending in a dot or a space, no
#              reserved device name (CON, NUL, COM1 ...)
#   inside     the resolved path stays beneath the folder it unpacks into
#   unique     no two entries land on one path once slashes and case are
#              folded, and no file sits where a folder has to be
#   size       at most 200000 entries, names at most 1024 characters, parts
#              at most 255
#
# Returns one record per entry: Entry, Name (as in the zip), Rel, Dir.
function Test-ThornswoodBackupEntries($Entries, [string]$Root) {
  # This machine's separator ends the root: off Windows GetFullPath joins with
  # /, and a root ending in \ refused every entry as outside it (#2989).
  $sep = [IO.Path]::DirectorySeparatorChar
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd($sep) + $sep
  $list = @($Entries)
  if ($list.Count -gt 200000) { throw ("oversized: " + $list.Count + " entries, more than 200000") }
  $reserved = '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$'
  $files = @{}; $dirs = @{}; $out = New-Object 'System.Collections.Generic.List[object]'
  foreach ($en in $list) {
    $name = [string]$en.FullName
    $show = ($name -replace '[\x00-\x1f]', '?')
    if ([string]::IsNullOrEmpty($name)) { throw 'bad name: an entry with no name' }
    if ($name.Length -gt 1024) { throw ("oversized: an entry name of " + $name.Length + " characters") }
    $attr = ([long]$en.ExternalAttributes) -band 0xFFFFFFFFL
    $unix = ($attr -shr 16) -band 0xF000
    if ($unix -ne 0 -and $unix -ne 0x8000 -and $unix -ne 0x4000) { throw ("unsupported entry type: '" + $show + "' is not a plain file or folder (mode 0x" + ('{0:X}' -f $unix) + ")") }
    if (($attr -band 0x400) -ne 0) { throw ("unsupported entry type: '" + $show + "' is a reparse point") }
    if (($attr -band 0x40) -ne 0) { throw ("unsupported entry type: '" + $show + "' is a device") }
    $isDir = $name -match '[\\/]$'
    if ($isDir -and [long]$en.Length -ne 0) { throw ("unsupported entry type: '" + $show + "' is a folder with bytes in it") }
    if ([IO.Path]::IsPathRooted($name) -or $name -match '^[\\/]' -or $name.Contains(':')) { throw ("outside the folder: '" + $show + "' is a rooted or drive name") }
    $body = $name.TrimEnd([char[]]@([char]'\', [char]'/'))
    foreach ($part in ($body -split '[\\/]')) {
      if ($part -eq '') { throw ("bad name: '" + $show + "' has an empty part") }
      if ($part -eq '.' -or $part -eq '..') { throw ("outside the folder: '" + $show + "' has a '" + $part + "' part") }
      if ($part.Length -gt 255) { throw ("oversized: a part of '" + $show + "' is " + $part.Length + " characters") }
      if ($part -match '[\x00-\x1f<>"|?*]') { throw ("bad name: '" + $show + "' has a character Windows does not allow") }
      if ($part -match '[ .]$') { throw ("bad name: '" + $show + "' has a part ending in a dot or a space") }
      if ($part -match $reserved) { throw ("bad name: '" + $show + "' uses the reserved name " + $part) }
    }
    $rel = $body -replace '/', '\'
    $full = [IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw ("outside the folder: '" + $show + "' resolves outside it") }
    $key = $rel.ToLowerInvariant()
    if ($isDir) {
      if ($files.ContainsKey($key)) { throw ("collision: '" + $show + "' is a folder where '" + $files[$key] + "' is a file") }
      $dirs[$key] = $name
    } else {
      if ($files.ContainsKey($key)) { throw ("collision: '" + $show + "' and '" + $files[$key] + "' land on the same file") }
      if ($dirs.ContainsKey($key)) { throw ("collision: '" + $show + "' is a file where '" + $dirs[$key] + "' is a folder") }
      $files[$key] = $name
    }
    $out.Add([pscustomobject]@{ Entry = $en; Name = $name; Rel = $rel; Dir = $isDir })
  }
  # A file may not sit where another entry needs a folder.
  foreach ($k in (@($files.Keys) + @($dirs.Keys))) {
    $p = $k
    while (($i = $p.LastIndexOf('\')) -gt 0) {
      $p = $p.Substring(0, $i)
      if ($files.ContainsKey($p)) { throw ("collision: '" + $files[$p] + "' is a file where a folder is needed") }
    }
  }
  return ,$out
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zf = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = @($zf.Entries)
try { [void](Test-ThornswoodBackupEntries $entries (Join-Path $Work ('.policy-' + [Guid]::NewGuid().ToString('N')))) }
catch { $zf.Dispose(); Die ("The backup breaks the entry policy (#2199): " + $_.Exception.Message + ". Nothing was written.") }
# Either slash: which one ZipFile writes has depended on the .NET version.
$worldCount = @($entries | Where-Object { $_.FullName -match '^game[/\\]world[/\\]' }).Count
$privCount  = @($entries | Where-Object { $_.FullName -match '^game[/\\]private[/\\]' }).Count

Head 'What is in it'
Say ("  {0} entries" -f $entries.Count)
Say ("  {0,-28} {1}" -f 'game/world (characters)', $(if ($worldCount) { "$worldCount files" } else { 'NOTHING. This backup has no characters in it.' })) $(if ($worldCount) { 'Green' } else { 'Red' })
Say ("  {0,-28} {1} files" -f 'game/private', $privCount)
foreach ($top in ($entries | ForEach-Object { ($_.FullName -split '[/\\]')[0] } | Sort-Object -Unique)) {
  $n = @($entries | Where-Object { $_.FullName -like "$top/*" -or $_.FullName -like "$top\*" -or $_.FullName -eq $top }).Count
  Say ("  {0,-28} {1} entries" -f $top, $n) 'DarkGray'
}
$notes = $entries | Where-Object { $_.FullName -eq 'NOTES.txt' } | Select-Object -First 1
if ($notes) {
  Head 'NOTES.txt from the box it was taken on'
  $sr = New-Object System.IO.StreamReader($notes.Open())
  $sr.ReadToEnd() -split "`r?`n" | ForEach-Object { Say "  $_" 'DarkGray' }
  $sr.Close()
}

# A character is a runtime change form, named with its form id in lowercase
# hex and no plugin (0.json, 1f.json, ...; the rule Release-List.ps1 and
# Restore-Server.ps1 read a world by, #5168), whose profile id is above 0 and
# which is not deleted. Counting every file under game/world
# called a world of only deleted slots, or only forms that are not characters,
# a good backup (#1047). Read here, before the zip is closed, and only for
# -CheckOnly: unpacking still does not decide that, Restore-Server.ps1 does.
$living = 0
if ($CheckOnly) {
  foreach ($en in $entries) {
    if ($en.FullName -cnotmatch '^game[/\\]world[/\\]changeForms[/\\][0-9a-f]{1,8}\.json$') { continue }
    $sr = $null
    $o = $null
    try {
      $sr = New-Object System.IO.StreamReader($en.Open())
      $o = (($sr.ReadToEnd()) -replace '^\uFEFF', '') | ConvertFrom-Json
    } catch { $o = $null }
    finally { if ($null -ne $sr) { $sr.Dispose() } }
    $id = 0L
    if ($null -ne $o -and $null -ne $o.profileId) { try { $id = [long]$o.profileId } catch { $id = 0L } }
    if ($id -gt 0 -and -not ($null -ne $o -and $o.isDeleted -eq $true)) { $living++ }
  }
}
$zf.Dispose()

if ($CheckOnly) {
  # A backup that opens and holds no characters is the failure this exists
  # to catch (the 15 September pair), so -CheckOnly calls it one, and
  # Fetch-Backups.ps1 and its task see a non-zero result. Files under
  # game/world are not enough: none of them may be a living character.
  if (-not $worldCount) {
    Die 'The backup opens, but there is nothing under game/world in it, so it holds no characters.'
  }
  if ($living -lt 1) {
    Die 'The backup opens, but none of the runtime change forms under game/world has a profile id above 0 that is not deleted, so it holds no characters.'
  }
  Say ("  {0} runtime change form(s) name a character" -f $living) 'Green'
  Head 'Checked only'
  Say '  The backup opens and its signature is good. Nothing was written.' 'Green'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

if (-not $To) { $To = Join-Path (Split-Path -Parent $src) ((Split-Path -Leaf $src) -replace '\.zip(\.enc)?$', '') }
$To = [IO.Path]::GetFullPath($To)
$toExisted = Test-Path -LiteralPath $To
if ($toExisted) {
  if (-not (Test-Path -LiteralPath $To -PathType Container)) { Die "$To is a file, not a folder. Name an empty folder with -To." }
  if (@(Get-ChildItem -LiteralPath $To -Force -EA SilentlyContinue).Count -gt 0) {
    Die "$To already has things in it. Name an empty folder with -To; this will not write over one."
  }
}

# Issue #2203: nothing at -To is touched until the whole backup has been
# unpacked and checked somewhere else. It is unpacked into a staging folder
# beside -To with a name only this run uses, every entry is checked to land
# inside it, and every file is checked against the zip (same count, same
# sizes, same SHA-256 as the bytes read back out of it). Then it moves: in one
# rename when -To was not there, or entry by entry into the empty -To that
# was. A refusal or a failure removes the staging folder this run made, and
# any parent folders it made, and nothing else.
$toParent = Split-Path -Parent $To
$madeParents = New-Object 'System.Collections.Generic.List[string]'
$stage = $null
$published = $false
function Clear-RestoreStage {
  if ($script:stageOwned -and $stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -EA SilentlyContinue }
  if (-not $published) {
    for ($k = $madeParents.Count - 1; $k -ge 0; $k--) {
      $d = $madeParents[$k]
      if ((Test-Path -LiteralPath $d) -and @(Get-ChildItem -LiteralPath $d -Force -EA SilentlyContinue).Count -eq 0) { Remove-Item -LiteralPath $d -Force -EA SilentlyContinue }
    }
  }
}
$script:stageOwned = $false
try {
  # Every entry is checked against the entry policy (#2199) before anything is
  # made. Then each one is written by this script, to the path the policy
  # resolved, never by ExtractToDirectory: the runtime's own extraction is not
  # the policy, and has differed between .NET versions.
  $zf = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $probe = Join-Path $toParent ('.restore-probe-' + [Guid]::NewGuid().ToString('N'))
    $plan = Test-ThornswoodBackupEntries @($zf.Entries) $probe
    $want = @{}
    foreach ($p in $plan) { if (-not $p.Dir) { $want[$p.Rel] = @{ Length = [long]$p.Entry.Length } } }

    $cur = $toParent
    $missing = @()
    while ($cur -and -not (Test-Path -LiteralPath $cur)) { $missing = @($cur) + $missing; $cur = Split-Path -Parent $cur }
    foreach ($d in $missing) { [void][IO.Directory]::CreateDirectory($d); $madeParents.Add($d) }
    $stage = Join-Path $toParent ('.' + (Split-Path -Leaf $To) + '.restore-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    $script:stageOwned = $true
    $stageFull = [IO.Path]::GetFullPath($stage).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $buf = New-Object byte[] 81920
    foreach ($p in $plan) {
      $dest = [IO.Path]::GetFullPath((Join-Path $stageFull $p.Rel))
      if (-not $dest.StartsWith($stageFull, [StringComparison]::OrdinalIgnoreCase)) { throw ("outside the folder: '" + $p.Name + "' resolves outside it") }
      if ($p.Dir) { [void][IO.Directory]::CreateDirectory($dest); continue }
      [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dest))
      $limit = [long]$p.Entry.Length
      $in = $p.Entry.Open()
      try {
        # CreateNew: a second write to one path is refused, never an overwrite.
        $outF = New-Object IO.FileStream($dest, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
          $total = 0L
          while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
            $total += $n
            if ($total -gt $limit) { throw ("unpacked " + $p.Rel + " past the " + $limit + " bytes the zip says") }
            $outF.Write($buf, 0, $n)
          }
        } finally { $outF.Dispose() }
      } finally { $in.Dispose() }
    }
  } finally { $zf.Dispose() }

  # The staged tree is what will be published, so it is the one checked.
  # Named with \ on any machine, as the plan names them (#2989).
  $sep = [IO.Path]::DirectorySeparatorChar
  $stageRoot = [IO.Path]::GetFullPath($stage).TrimEnd($sep) + $sep
  $got = @(Get-ChildItem -LiteralPath $stage -Recurse -Force -File)
  if ($got.Count -ne $want.Count) { throw ("unpacked " + $got.Count + " file(s), the zip holds " + $want.Count) }
  Add-Type -AssemblyName System.IO.Compression
  $zf = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($f in $got) {
      $rel = $f.FullName.Substring($stageRoot.Length).Replace($sep, '\')
      if (-not $want.ContainsKey($rel)) { throw ("unpacked a file the zip does not name: " + $rel) }
      if ([long]$f.Length -ne $want[$rel].Length) { throw ("unpacked " + $rel + " at " + $f.Length + " bytes, the zip says " + $want[$rel].Length) }
      $en = $zf.GetEntry(($rel -replace '\\', '/'))
      if ($null -eq $en) { $en = $zf.GetEntry($rel) }
      if ($null -eq $en) { throw ("unpacked a file the zip does not name: " + $rel) }
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $s = $en.Open(); try { $h1 = [BitConverter]::ToString($sha.ComputeHash($s)) } finally { $s.Dispose() }
        $s = [IO.File]::OpenRead($f.FullName); try { $h2 = [BitConverter]::ToString($sha.ComputeHash($s)) } finally { $s.Dispose() }
      } finally { $sha.Dispose() }
      if ($h1 -ne $h2) { throw ("unpacked " + $rel + " does not match the bytes in the zip") }
    }
  } finally { $zf.Dispose() }
  if (Test-Path -LiteralPath $To) {
    if (-not $toExisted -or @(Get-ChildItem -LiteralPath $To -Force -EA SilentlyContinue).Count -gt 0) {
      throw ("$To appeared or filled up while this ran; nothing was moved into it")
    }
    # Into the empty folder that was there, entry by entry; a move that fails
    # puts back the ones already moved, so -To is empty again.
    $moved = New-Object 'System.Collections.Generic.List[string]'
    try {
      foreach ($c in @(Get-ChildItem -LiteralPath $stage -Force)) {
        Move-Item -LiteralPath $c.FullName -Destination (Join-Path $To $c.Name) -ErrorAction Stop
        $moved.Add($c.Name)
      }
    } catch {
      foreach ($nm in $moved) { Move-Item -LiteralPath (Join-Path $To $nm) -Destination (Join-Path $stage $nm) -Force -EA SilentlyContinue }
      throw
    }
    $published = $true
  } else {
    [IO.Directory]::Move($stage, $To)
    $published = $true
    $script:stageOwned = $false
  }
} catch {
  $why = $_.Exception.Message
  Clear-RestoreStage
  Die ("The backup was not unpacked: " + $why + ". " + $(if ($toExisted) { "$To is as it was." } else { "Nothing was made at $To." }))
}
Clear-RestoreStage

Head 'Unpacked'
Say "  $To" 'Green'
Write-Host ''
Say '  Putting this back into a server folder is Restore-Server.ps1, which' 'DarkGray'
Say '  also checks the load order resolves; RESTORING.md in the ops repo has the rest.' 'DarkGray'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0

} finally {
  Clear-RestoreZip
}
