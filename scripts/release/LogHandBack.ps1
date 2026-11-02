<#
  LogHandBack.ps1

  A file handed back from a workflow run in its job's log rather than as an
  artifact. Dot-sourced by .github\workflows\engine.yml, which prints the
  records it makes this way, and scripts\release\Get-EngineRecords.ps1, which
  reads them back (#3399). tests\test-3399-engine-records.ps1. Every reader of
  a job's log asks Get-GhLogFlags what gh needs told first (#5202).

  WHY. This repository's artifact storage is private, metered over the month,
  and was used up on 25 Oct (#3410): engine.yml's upload was refused, and
  stayed refused after every stored artifact that could go went, because
  what is used up is time stored, which a delete does not give back. A run's
  log takes no room in that storage, GitHub keeps it 90 days, and
  gh api repos/<repo>/actions/jobs/<job>/logs hands it to any machine with gh,
  a cloud thread's too. board-read.yml hands board.json back the same way
  (#3192, Read-Board.ps1).

  THE SHAPE. One begin line, "<mark> begin <bytes> <sha256>", the file's
  length and sha256; then the file gzipped and in base64, 4000 characters a
  line, each line "<mark> <base64>"; then "<mark> end". A log line may start
  with GitHub's timestamp. The mark is made by the step from two halves
  ('ENGINE' + '-RECORDS'), so the step's own text, which the log shows
  before it runs, never holds it.

  It runs in PowerShell 7 (#5356).
#>

# What gh needs told to hand a job's log over: a runner's log carries
# terminal escape sequences (its colours), and gh 2.92 and newer refuse an
# answer that holds any (CVE-2026-45803) unless told
# --allow-escape-sequences. engine-pin.yml stopped on that on 31 Oct 2026 and
# made no pin (#5202). The log only ever goes into a variable and is read
# line by line for its marks; nothing of it is written to a terminal as it
# is. An older gh has no such flag and refuses no log, so the flag is given
# only when gh's own help names it. $Gh is the gh to ask (a test's stand-in).
# Its answer is one string or nothing, so a caller takes it as
# $flags = @(Get-GhLogFlags) before it splats @flags: PowerShell splats a
# lone string into a native command letter by letter, so gh was handed 24
# arguments for the flag and refused the log ("accepts 1 arg(s), received
# 25"): engine-pin.yml run 41267774073 on 1 Nov 2026, the first pin to
# reach its push job since the flag came in.
function Get-GhLogFlags([string]$Gh = 'gh') {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $help = (& $Gh api --help 2>&1 | Out-String) } catch { $help = '' } finally { $ErrorActionPreference = $old }
    if ($help -match '--allow-escape-sequences') { return '--allow-escape-sequences' }
    return
}

# The lines that hand $Bytes back under $Mark, for the step to print.
function Get-LogHandBackLines([string]$Mark, [byte[]]$Bytes) {
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
    $packed = New-Object IO.MemoryStream
    $zip = New-Object IO.Compression.GZipStream($packed, [IO.Compression.CompressionLevel]::Optimal)
    $zip.Write($Bytes, 0, $Bytes.Length)
    $zip.Dispose()
    $b64 = [Convert]::ToBase64String($packed.ToArray())
    $out = New-Object Collections.Generic.List[string]
    $out.Add(("{0} begin {1} {2}" -f $Mark, $Bytes.Length, $sha))
    for ($i = 0; $i -lt $b64.Length; $i += 4000) { $out.Add(("{0} {1}" -f $Mark, $b64.Substring($i, [Math]::Min(4000, $b64.Length - $i)))) }
    $out.Add(("{0} end" -f $Mark))
    return $out.ToArray()
}

# The file handed back under $Mark in the lines of a job's log. Throws,
# saying what is wrong, when a marker is missing or twice, a line between
# them is not base64, or the bytes are not the length and sha256 the begin
# line gives.
function Read-LogHandBack([string[]]$Lines, [string]$Mark) {
    $re = '^(?:\d{4}-\d\d-\d\dT[\d:.]+Z )?' + [regex]::Escape($Mark) + ' (.*)$'
    $begin = $null; $ended = $false; $parts = New-Object System.Text.StringBuilder
    foreach ($l in @($Lines | ForEach-Object { ([string]$_) -split "`r?`n" })) {
        $m = [regex]::Match($l.TrimEnd(), $re)
        if (-not $m.Success) { continue }
        $rest = $m.Groups[1].Value
        if ($rest -match '^begin (\d+) ([0-9a-f]{64})$') {
            if ($begin) { throw "the log has two $Mark begin lines" }
            $begin = [pscustomobject]@{ Length = [long]$Matches[1]; Sha = $Matches[2] }
            continue
        }
        if (-not $begin) { continue }
        if ($rest -eq 'end') { $ended = $true; break }
        if ($rest -notmatch '^[A-Za-z0-9+/=]+$') { throw "a $Mark line between begin and end is not base64" }
        [void]$parts.Append($rest)
    }
    if (-not $begin) { throw "the log has no $Mark begin line" }
    if (-not $ended) { throw "the log has no $Mark end line after its begin line" }
    $in = New-Object IO.MemoryStream (, [Convert]::FromBase64String($parts.ToString()))
    $zip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $out = New-Object IO.MemoryStream
    $zip.CopyTo($out)
    $zip.Dispose()
    $bytes = $out.ToArray()
    if ($bytes.Length -ne $begin.Length) { throw ("it is {0} bytes, and the begin line says {1}" -f $bytes.Length, $begin.Length) }
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    if ($sha -ne $begin.Sha) { throw "its sha256 is $sha, and the begin line says $($begin.Sha)" }
    return , $bytes
}
