# Real backups in PowerShell 7, as the box runs them since #5356, with
# disposable data and keys only.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nightly = Join-Path $repo 'scripts\vps\vps-nightly-backup.ps1'
$restore = Join-Path $repo 'scripts\vps\Restore-Backup.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the nightly backup stages under Windows'' TEMP and builds its paths with the \ separator, so it and its restore run only on Windows'; exit 0 }
$boxPs = Get-BoxPowerShell
$root = Join-Path ([IO.Path]::GetTempPath()) ('tw-backup-stream-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$utf8 = New-Object Text.UTF8Encoding($false)
$script:failed = 0
$script:passed = 0
function Yes($name, $ok) {
    if ($ok) { $script:passed++; Write-Host "PASS $name" }
    else { $script:failed++; Write-Host "FAIL $name" }
}
function Put($name, $value) {
    $p = Join-Path $root $name
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $value, $utf8)
    return $p
}
function Run($file, $params) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $script:said = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @params 2>&1 | ForEach-Object { "$_" }); return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
function Slice([byte[]]$bytes, [int]$offset, [int]$length) {
    $part = New-Object byte[] $length
    [Array]::Copy($bytes, $offset, $part, 0, $length)
    return ,$part
}
try {
    $game = Join-Path $root 'game'
    $site = Join-Path $root 'site'
    $null = Put 'game\world\changeForms\0.json' '{"profileId":1234567}'
    $null = Put 'site\data\gallery.json' '[{"name":"large.webm"}]'
    $key = Put 'key.txt' 'disposable-streaming-regression-key'
    $emptyKey = Put 'empty-key.txt' ' '
    $large = Join-Path $site 'uploads\large.webm'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $large))
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $buffer = New-Object byte[] 1MB
    $stream = [IO.File]::Create($large)
    try { foreach ($i in 1..12) { $rng.GetBytes($buffer); $stream.Write($buffer, 0, $buffer.Length) } }
    finally { $stream.Dispose(); $rng.Dispose() }
    $expected = (Get-FileHash -LiteralPath $large -Algorithm SHA256).Hash
    $common = @('-GameRoot', $game, '-DevGameRoot', (Join-Path $root 'no-dev'), '-SiteRoot', $site,
        '-BotRoot', (Join-Path $root 'no-bot'), '-CaddyRoot', (Join-Path $root 'no-web'),
        '-VoiceRoot', (Join-Path $root 'no-voice'), '-DeletionRoot', (Join-Path $root 'no-del'), '-MaxUploadsMB', '1', '-MaxFileMB', '1')
    $out = Join-Path $root 'encrypted'
    $code = Run $nightly ($common + @('-Out', $out, '-KeyFile', $key))
    Yes 'backup succeeds with uploads above both old size limits' ($code -eq 0)
    $enc = @(Get-ChildItem -LiteralPath $out -Filter '*.zip.enc')
    Yes 'one complete encrypted archive and no clear zip' ($enc.Count -eq 1 -and @(Get-ChildItem -LiteralPath $out -Filter '*.zip').Count -eq 0)
    if ($enc.Count -ne 1) { throw 'No archive for the interoperability tests.' }
    $scratch = Join-Path $root 'scratch'
    $to = Join-Path $root 'restored'
    $code = Run $restore @('-Backup', $enc[0].FullName, '-KeyFile', $key, '-To', $to, '-Work', $scratch, '-NoPause')
    if ($code -ne 0) { $script:said | Select-Object -Last 12 | Write-Host }
    $recovered = Join-Path $to 'site\uploads\large.webm'
    Yes 'large upload restores byte for byte' ($code -eq 0 -and (Test-Path $recovered) -and (Get-FileHash -LiteralPath $recovered).Hash -eq $expected)
    Yes 'successful restore leaves no decrypted scratch files' (@(Get-ChildItem -LiteralPath $scratch -Force -ErrorAction SilentlyContinue).Count -eq 0)

    # Independent old-format reader: HMAC(salt || IV || ciphertext), then CBC.
    $bytes = [IO.File]::ReadAllBytes($enc[0].FullName)
    $salt = $bytes[5..20]; $iv = $bytes[21..36]
    $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new('disposable-streaming-regression-key', [byte[]]$salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
    $encKey = $kdf.GetBytes(32); $macKey = $kdf.GetBytes(32)
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    $want = $hmac.ComputeHash((Slice $bytes 5 ($bytes.Length - 37)))
    Yes 'new encoder retains the old authenticated envelope' ([Convert]::ToBase64String($want) -eq [Convert]::ToBase64String((Slice $bytes ($bytes.Length - 32) 32)))
    $aes = [Security.Cryptography.Aes]::Create(); $aes.Key = $encKey; $aes.IV = [byte[]]$iv
    $cipher = Slice $bytes 37 ($bytes.Length - 69)
    $transform = $aes.CreateDecryptor()
    try { $plain = $transform.TransformFinalBlock($cipher, 0, $cipher.Length) } finally { $transform.Dispose() }
    Yes 'old decoder opens new archive as a zip' ($plain[0] -eq 80 -and $plain[1] -eq 75)

    # Independent legacy encoder, deliberately using the original whole-buffer method.
    $transform = $aes.CreateEncryptor()
    try { $legacyCipher = $transform.TransformFinalBlock($plain, 0, $plain.Length) } finally { $transform.Dispose() }
    $signed = New-Object byte[] (32 + $legacyCipher.Length)
    [Array]::Copy($salt, 0, $signed, 0, 16); [Array]::Copy($iv, 0, $signed, 16, 16)
    [Array]::Copy($legacyCipher, 0, $signed, 32, $legacyCipher.Length)
    $legacy = Join-Path $root 'legacy.zip.enc'
    $legacyBytes = New-Object byte[] (5 + $signed.Length + 32)
    [Array]::Copy([Text.Encoding]::ASCII.GetBytes('TSBK1'), 0, $legacyBytes, 0, 5)
    [Array]::Copy($signed, 0, $legacyBytes, 5, $signed.Length)
    [Array]::Copy($hmac.ComputeHash($signed), 0, $legacyBytes, 5 + $signed.Length, 32)
    [IO.File]::WriteAllBytes($legacy, $legacyBytes)
    $aes.Dispose(); $kdf.Dispose(); $hmac.Dispose()
    $legacyTo = Join-Path $root 'legacy-restored'
    $code = Run $restore @('-Backup', $legacy, '-KeyFile', $key, '-To', $legacyTo, '-Work', $scratch, '-NoPause')
    Yes 'new decoder restores an independently encoded legacy archive' ($code -eq 0 -and (Test-Path (Join-Path $legacyTo 'site\uploads\large.webm')) -and (Get-FileHash -LiteralPath (Join-Path $legacyTo 'site\uploads\large.webm')).Hash -eq $expected)

    foreach ($offset in @(0, 5, 21, 37, ($bytes.Length - 1))) {
        $changed = [byte[]]$bytes.Clone(); $changed[$offset] = $changed[$offset] -bxor 1
        $bad = Join-Path $root ('changed-' + $offset + '.enc'); [IO.File]::WriteAllBytes($bad, $changed)
        $code = Run $restore @('-Backup', $bad, '-KeyFile', $key, '-CheckOnly', '-Work', $scratch, '-NoPause')
        Yes "tamper at $offset is refused without plaintext" ($code -ne 0 -and @(Get-ChildItem -LiteralPath $scratch -Force -ErrorAction SilentlyContinue).Count -eq 0)
    }
    foreach ($length in @(4, 69, 84, ($bytes.Length - 1))) {
        $bad = Join-Path $root ('short-' + $length + '.enc'); [IO.File]::WriteAllBytes($bad, (Slice $bytes 0 $length))
        $code = Run $restore @('-Backup', $bad, '-KeyFile', $key, '-CheckOnly', '-Work', $scratch, '-NoPause')
        Yes "truncated archive $length is refused without plaintext" ($code -ne 0 -and @(Get-ChildItem -LiteralPath $scratch -Force -ErrorAction SilentlyContinue).Count -eq 0)
    }
    foreach ($keyCase in @('missing', 'empty')) {
        $badKey = if ($keyCase -eq 'missing') { Join-Path $root 'no-key.txt' } else { $emptyKey }
        $failedOut = Join-Path $root ('no-key-' + $keyCase)
        $code = Run $nightly ($common + @('-Out', $failedOut, '-KeyFile', $badKey))
        Yes "$keyCase key fails with no plaintext or encrypted archive" ($code -ne 0 -and @(Get-ChildItem -LiteralPath $failedOut -Filter '*.zip*' -ErrorAction SilentlyContinue).Count -eq 0)
    }

    # Inject real stream failures into disposable copies of the production
    # scripts. CryptoStream retries a failed final write during Dispose, which
    # must not prevent closing the other handles and removing plaintext.
    $faultType = @'
Add-Type -TypeDefinition @"
using System;
using System.IO;
public sealed class BackupFaultStream : Stream {
    readonly FileStream inner; readonly string mode; long written;
    public BackupFaultStream(FileStream stream, string failure) { inner = stream; mode = failure; }
    public override bool CanRead { get { return inner.CanRead; } }
    public override bool CanSeek { get { return inner.CanSeek; } }
    public override bool CanWrite { get { return inner.CanWrite; } }
    public override long Length { get { return inner.Length; } }
    public override long Position { get { return inner.Position; } set { inner.Position = value; } }
    public override int Read(byte[] b, int o, int n) { return inner.Read(b, o, n); }
    public override long Seek(long o, SeekOrigin s) { return inner.Seek(o, s); }
    public override void SetLength(long n) { inner.SetLength(n); }
    public override void Write(byte[] b, int o, int n) {
        if (mode == "write" && written + n > 37) throw new IOException("fixture write failure");
        inner.Write(b, o, n); written += n;
    }
    public override void Flush() {
        if (mode == "flush") throw new IOException("fixture flush failure");
        inner.Flush();
    }
    public void Flush(bool durable) {
        if (mode == "flush") throw new IOException("fixture flush failure");
        inner.Flush(durable);
    }
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
}
"@
'@
    $isolatedTemp = Join-Path $root 'fault-temp'
    [void][IO.Directory]::CreateDirectory($isolatedTemp)
    $originalTemp = $env:TEMP
    try {
        $env:TEMP = $isolatedTemp
        foreach ($mode in @('write', 'flush')) {
            foreach ($kind in @('backup', 'restore')) {
                $original = if ($kind -eq 'backup') { $nightly } else { $restore }
                $source = [IO.File]::ReadAllText($original)
                $source = $source.Replace("`$ErrorActionPreference = 'Stop'", "`$ErrorActionPreference = 'Stop'`r`n" + $faultType)
                $open = if ($kind -eq 'backup') {
                    '[IO.File]::Open($partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)'
                } else {
                    '[IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)'
                }
                if (-not $source.Contains($open)) { throw 'Fault injection no longer matches the production output stream.' }
                $source = $source.Replace($open, ('[BackupFaultStream]::new(' + $open + ", '$mode')"))
                $fixture = Put ("fault-$kind-$mode.ps1") $source
                if ($kind -eq 'backup') {
                    $failedOut = Join-Path $root ("fault-$kind-$mode-out")
                    $code = Run $fixture ($common + @('-Out', $failedOut, '-KeyFile', $key))
                    # The server folders' turn and its note stay in the backup's folder on
                    # purpose (#3247, ServerFolderTurn.ps1); they are not archives.
                    $leftovers = @(Get-ChildItem -LiteralPath $failedOut -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'backup.log' -and $_.Name -notlike 'server-folders.turn*' }).Count
                    $stages = @(Get-ChildItem -LiteralPath $isolatedTemp -Filter 'thornswood-backup-*' -ErrorAction SilentlyContinue).Count
                    Yes "backup $mode failure closes handles and removes all temporary archives" ($code -ne 0 -and ($script:said -join ' ') -match "fixture $mode failure" -and $leftovers -eq 0 -and $stages -eq 0)
                } else {
                    $code = Run $fixture @('-Backup', $enc[0].FullName, '-KeyFile', $key, '-CheckOnly', '-Work', $scratch, '-NoPause')
                    Yes "restore $mode failure leaves no decrypted archive" ($code -ne 0 -and ($script:said -join ' ') -match "fixture $mode failure" -and @(Get-ChildItem -LiteralPath $scratch -Force).Count -eq 0)
                }
            }
        }
        # Fix the time only in this fixture to reproduce same-second publication
        # collisions without timing races or touching an existing real backup.
        $collisionSource = [IO.File]::ReadAllText($nightly).Replace("`$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'", "`$stamp = '20261004-120000'")
        $collisionScript = Put 'collision.ps1' $collisionSource
        foreach ($plainCase in @($false, $true)) {
            $collisionOut = Join-Path $root ("collision-$plainCase")
            $suffix = if ($plainCase) { '.zip' } else { '.zip.enc' }
            $sentinel = Put ("collision-$plainCase\thornswood-20261004-120000$suffix") 'previous backup must survive'
            $before = (Get-FileHash -LiteralPath $sentinel).Hash
            $params = $common + @('-Out', $collisionOut, '-KeyFile', $key)
            if ($plainCase) { $params += '-Plain' }
            $code = Run $collisionScript $params
            Yes "publication collision (Plain=$plainCase) preserves the earlier archive" ($code -ne 0 -and (Test-Path -LiteralPath $sentinel) -and (Get-FileHash -LiteralPath $sentinel).Hash -eq $before -and @(Get-ChildItem -LiteralPath $collisionOut -Filter '*.partial').Count -eq 0 -and @(Get-ChildItem -LiteralPath $isolatedTemp -Filter 'thornswood-backup-*').Count -eq 0)
        }
    } finally { $env:TEMP = $originalTemp }
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    $ownedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\tw-backup-stream-'
    if (-not $resolved.StartsWith($ownedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside the owned fixture directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "$script:passed passed, $script:failed failed"
if ($script:failed) { exit 1 }
