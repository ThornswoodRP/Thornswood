<#
  Sealed.ps1

  The seal a workflow puts on what it sends back to the session that started
  it, for scripts\vps\Box-Run.ps1 (the deploy gate) and
  scripts\release\Nexus-Run.ps1 (the Nexus scripts), both #2841. Each
  dot-sources this. PowerShell 7 only (AesGcm).

      . (Join-Path $PSScriptRoot 'Sealed.ps1')

  WHY. Once the repository is public, anyone can read a run's log and
  download its artifacts. A deploy's output, the servers' logs and what the
  Nexus scripts print are not for them. So the session makes a key for that
  run alone and sends only its public half; the runner seals the output to it
  and sends the sealed file back; only the private half, which never leaves
  the session's scratch folder, opens it.

  HOW IT COMES BACK. nexus-run.yml uploads it as the run's artifact.
  box-run.yml, in the private ops repository, writes it into the job's own
  log as TWSEAL-LOG lines (Write-ThornswoodSealedLog), and the session reads
  them back from the log (Read-ThornswoodSealedLog): GitHub counts a private
  repository's artifacts against the account's storage, and on 30 and 31 Oct
  2026 that storage was full, so every gate run came back with only its exit
  code. The seal is what keeps the output private, wherever it travels; a
  log takes no storage of the account's.

  THE FORMAT. "TWSEAL1", the wrapped key's length (2 bytes, big end first),
  the AES key wrapped with RSA-OAEP-SHA256, the 12 byte nonce, the 16 byte
  tag, then the zip encrypted with AES-256-GCM. A recipient key under 3072
  bits is refused.
#>

# Get-GhLogFlags, for reading a job's log (#5202).
. (Join-Path $PSScriptRoot '..\release\LogHandBack.ps1')

# A key for one run: Public goes with the run, Private stays in the session.
function New-ThornswoodSealKey {
    $rsa = [Security.Cryptography.RSA]::Create(3072)
    return [pscustomobject]@{
        Public  = [Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo())
        Private = [Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey())
    }
}

function Protect-ThornswoodSealed([byte[]]$Plain, [string]$RecipientB64) {
    $rsa = [Security.Cryptography.RSA]::Create()
    $read = 0
    $rsa.ImportSubjectPublicKeyInfo([Convert]::FromBase64String($RecipientB64), [ref]$read)
    if ($rsa.KeySize -lt 3072) { throw ('the recipient key is ' + $rsa.KeySize + ' bits, under 3072') }
    $key = New-Object byte[] 32; $nonce = New-Object byte[] 12; $tag = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Fill($key); [Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
    $cipher = New-Object byte[] $Plain.Length
    $gcm = [Security.Cryptography.AesGcm]::new($key, 16)
    $gcm.Encrypt($nonce, $Plain, $cipher, $tag)
    $wrapped = $rsa.Encrypt($key, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
    $ms = New-Object IO.MemoryStream
    $head = [Text.Encoding]::ASCII.GetBytes('TWSEAL1')
    $ms.Write($head, 0, $head.Length)
    $ms.WriteByte([byte]($wrapped.Length -shr 8)); $ms.WriteByte([byte]($wrapped.Length -band 255))
    foreach ($b in $wrapped, $nonce, $tag, $cipher) { $ms.Write($b, 0, $b.Length) }
    return $ms.ToArray()
}

function Unprotect-ThornswoodSealed([byte[]]$Sealed, [string]$PrivateB64) {
    $head = [Text.Encoding]::ASCII.GetString($Sealed, 0, 7)
    if ($head -ne 'TWSEAL1') { throw 'the sealed file is not one a Thornswood run made' }
    $n = ([int]$Sealed[7] -shl 8) + [int]$Sealed[8]
    $at = 9
    $wrapped = $Sealed[$at..($at + $n - 1)]; $at += $n
    $nonce = $Sealed[$at..($at + 11)]; $at += 12
    $tag = $Sealed[$at..($at + 15)]; $at += 16
    $cipher = if ($at -lt $Sealed.Length) { [byte[]]$Sealed[$at..($Sealed.Length - 1)] } else { [byte[]]@() }
    $rsa = [Security.Cryptography.RSA]::Create()
    $read = 0
    $rsa.ImportPkcs8PrivateKey([Convert]::FromBase64String($PrivateB64), [ref]$read)
    $key = $rsa.Decrypt([byte[]]$wrapped, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
    $plain = New-Object byte[] $cipher.Length
    $gcm = [Security.Cryptography.AesGcm]::new($key, 16)
    $gcm.Decrypt([byte[]]$nonce, $cipher, [byte[]]$tag, $plain)
    return $plain
}

# The runner's half: zips everything in $Folder (output.txt and files\),
# seals it to $RecipientB64 and writes it to $To. Returns how many files went.
function Save-ThornswoodSealed([string]$Folder, [string]$RecipientB64, [string]$To) {
    $zip = $Folder.TrimEnd('\', '/') + '.zip'
    Compress-Archive -Path (Join-Path $Folder '*') -DestinationPath $zip -Force
    try {
        $sealed = Protect-ThornswoodSealed ([IO.File]::ReadAllBytes($zip)) $RecipientB64
        New-Item -ItemType Directory -Path (Split-Path -Parent $To) -Force | Out-Null
        [IO.File]::WriteAllBytes($To, $sealed)
    }
    finally { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
    return @(Get-ChildItem -LiteralPath (Join-Path $Folder 'files') -Recurse -File -ErrorAction SilentlyContinue).Count
}

# The runner's half when the run's log carries it: the sealed file at $From
# in base64 lines of 2000 characters, "TWSEAL-LOG <n> <part>", then
# "TWSEAL-LOG END <parts> <sha256 of the sealed bytes>". Nothing else of the
# output is ever written to the log.
function Write-ThornswoodSealedLog([string]$From) {
    if (-not (Test-Path -LiteralPath $From)) { Write-Host 'TWSEAL-LOG NONE'; return }
    $bytes = [IO.File]::ReadAllBytes($From)
    $b64 = [Convert]::ToBase64String($bytes)
    $n = 0
    for ($at = 0; $at -lt $b64.Length; $at += 2000) {
        $n++
        Write-Host ('TWSEAL-LOG ' + $n + ' ' + $b64.Substring($at, [Math]::Min(2000, $b64.Length - $at)))
    }
    $sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($bytes))).Replace('-', '').ToLowerInvariant()
    Write-Host ('TWSEAL-LOG END ' + $n + ' ' + $sha)
}

# The session's half of that: the sealed bytes from the TWSEAL-LOG lines of
# the logs of run $Run's jobs, held to the END line's count and sha256.
# Returns @{ Bytes; Why }: Bytes is $null with Why saying what was missing.
function Read-ThornswoodSealedLog([string]$Repo, [long]$Run) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $jobs = @(& gh api "repos/$Repo/actions/runs/$Run/jobs" --jq '.jobs[].id' 2>&1 | ForEach-Object { "$_" })
        if ($LASTEXITCODE -ne 0) { return @{ Bytes = $null; Why = ('the run''s jobs could not be read: ' + ($jobs -join ' ')) } }
        # The log keeps the runner's colours, which a newer gh hands over
        # only when told (Get-GhLogFlags, #5202).
        $flags = @(Get-GhLogFlags)
        foreach ($job in $jobs) {
            if ($job -notmatch '^[0-9]+$') { continue }
            $log = @(& gh api "repos/$Repo/actions/jobs/$job/logs" @flags 2>&1 | ForEach-Object { "$_" })
            if ($LASTEXITCODE -ne 0) { return @{ Bytes = $null; Why = ('the log of job ' + $job + ' could not be read: ' + ((($log | Select-Object -Last 1) -join '') -replace "`e", '')) } }
            $parts = @{}; $end = $null
            foreach ($line in $log) {
                # Each line of a job's log starts with its time.
                $m = [regex]::Match($line, '^(?:\S+ )?TWSEAL-LOG (\d+|END|NONE)(?: (\S+))?(?: ([0-9a-f]{64}))?$')
                if (-not $m.Success) { continue }
                if ($m.Groups[1].Value -eq 'NONE') { return @{ Bytes = $null; Why = 'the run wrote no sealed output' } }
                if ($m.Groups[1].Value -eq 'END') { $end = $m; continue }
                $parts[[int]$m.Groups[1].Value] = $m.Groups[2].Value
            }
            if (-not $end) { continue }
            $count = [int]$end.Groups[2].Value
            $missing = @(1..[Math]::Max(1, $count) | Where-Object { -not $parts.ContainsKey($_) })
            if ($count -lt 1 -or $missing.Count) { return @{ Bytes = $null; Why = ('the log names ' + $count + ' sealed part(s) and lacks ' + $missing.Count) } }
            $bytes = [Convert]::FromBase64String((@(1..$count | ForEach-Object { $parts[$_] }) -join ''))
            $sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($bytes))).Replace('-', '').ToLowerInvariant()
            if ($sha -ne $end.Groups[3].Value) { return @{ Bytes = $null; Why = 'the sealed lines in the log do not hash to the sha256 the log names' } }
            return @{ Bytes = $bytes; Why = '' }
        }
        return @{ Bytes = $null; Why = 'no job of the run has TWSEAL-LOG lines' }
    }
    finally { $ErrorActionPreference = $old }
}

# The session's half: downloads artifact $Artifact of run $Run (or, with
# -FromLog, reads it from the run's log), opens its
# $File with the key at $KeyPath into $Into (output.txt and files\). Returns
# @{ Ok; Why }; Why says what gh said when there was nothing to open.
function Open-ThornswoodSealedRun {
    param([string]$Repo, [long]$Run, [string]$Artifact, [string]$File, [string]$KeyPath, [string]$Into, [switch]$FromLog)
    $dl = $Into.TrimEnd('\', '/') + '.download'
    Remove-Item -LiteralPath $dl -Recurse -Force -ErrorAction SilentlyContinue
    if ($FromLog) {
        $l = Read-ThornswoodSealedLog $Repo $Run
        if (-not $l.Bytes) { return @{ Ok = $false; Why = $l.Why } }
        $sealedBytes = $l.Bytes
    } else {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $got = @(& gh run download $Run -R $Repo -n $Artifact -D $dl 2>&1 | ForEach-Object { "$_" })
        $ErrorActionPreference = $old
        $sealedFile = Join-Path $dl $File
        if (-not (Test-Path -LiteralPath $sealedFile)) {
            Remove-Item -LiteralPath $dl -Recurse -Force -ErrorAction SilentlyContinue
            return @{ Ok = $false; Why = (($got | Select-Object -Last 1) -join '') }
        }
        $sealedBytes = [IO.File]::ReadAllBytes($sealedFile)
    }
    $plain = Unprotect-ThornswoodSealed $sealedBytes ([IO.File]::ReadAllText($KeyPath).Trim())
    Remove-Item -LiteralPath $Into -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $Into -Force | Out-Null
    $zip = Join-Path $Into 'out.zip'
    [IO.File]::WriteAllBytes($zip, $plain)
    Expand-Archive -LiteralPath $zip -DestinationPath $Into -Force
    Remove-Item -LiteralPath $zip, $dl -Recurse -Force -ErrorAction SilentlyContinue
    return @{ Ok = $true; Why = '' }
}

# The session's exit code once a run has ended (#3399). $Answer is what
# Read-ThornswoodRunAnswer returned; $Read says whether the run's sealed
# output was opened here. The verb's own code when the output was read; when
# it was not, never 0, since what the verb did then cannot be known here (on
# 30 Oct Box-Run ping and Nexus-Run Set-NexusKey ended 0 with their answers
# never read, runs 41116819564 and 41116954793). -1 when the run ended with
# no answer at all, which the caller stops on with the run's link.
function Get-ThornswoodRunExit($Answer, [bool]$Read) {
    $n = $null
    if ([string]$Answer.Text -match '^ENDED (-?[0-9]+)') { $n = [int]$Matches[1] }
    switch ([string]$Answer.State) {
        'answer'  { $code = $(if ($null -ne $n) { $n } else { 0 }) }
        'stopped' { $code = $(if ($null -ne $n) { [Math]::Max(1, $n) } else { 1 }) }
        default   { return -1 }
    }
    if (-not $Read -and $code -eq 0) { return 1 }
    return $code
}
