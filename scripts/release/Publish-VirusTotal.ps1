<#
.SYNOPSIS
  Optional manual tool: sends a file to VirusTotal, or says plainly that it is
  not sending and carries on. Not called from publish.

.DESCRIPTION
  The Downloads page prints the installer's SHA-256 and no VirusTotal link
  (site\public\home.js, sum). From 24 September it printed a link to
  VirusTotal's report on that hash as well (entry 176 on the To Do List), and
  nothing ever sent the file, so the link always landed on VirusTotal's "item
  not found" page. That link is gone: the setup program is signed (#390), and
  publish sends nothing to VirusTotal (#802). This script stays for sending a
  build by hand, so there is a report to comment on and to point a vendor at
  when a scanner flags it (docs\VIRUSTOTAL-FALSE-POSITIVE.md).

  NOTHING HERE CAN STOP A RELEASE. Every way out of this script is exit 0 with
  one line saying what happened: no key, no file, a key VirusTotal refuses, a
  file too big for it, a network that is not there. A release that is already
  published and on the site is not undone by a report that is missing, and
  whatever runs this carries on either way. The line is the record.

  THE KEY IS READ FROM THE ENVIRONMENT AND FROM NOWHERE ELSE. VT_API_KEY, set
  on the machine that ships and nowhere in this repository. There is no
  parameter for it, so it cannot be typed on a command line that a shell then
  writes into its history, and there is no file for it to be committed in.
  It is never printed: the one place an error message is written scrubs the key
  out of the text first, because a VirusTotal key is 64 characters of hex and
  would otherwise ride out in a build log on the first 401.

  A machine without the key is the normal case, not a broken one. Djinn's and
  Ataxayk's machines have no key and every pull request build has none, so
  those say "skipped (VT_API_KEY not set)" and are done.

  WHAT IT DOES WHEN IT HAS A KEY, in this order, and why:

    1. Hashes the file itself. The hash of the bytes on disk is the only one
       worth having; -Sha256 from a caller that already hashed it is checked
       against this one and said out loud when the two differ.
    2. Asks VirusTotal whether it already holds that hash. A build can be
       large and running this twice on the same file is normal, so sending it
       twice is a long upload for nothing.
    3. Sends it, to the plain endpoint under 32 MB and to the one-time URL
       VirusTotal hands out for anything larger.

  Whatever happens, the line names the report address for the measured hash.
  That address works the moment the file is accepted, before any engine has
  finished, which is why nothing here waits for an analysis to complete: the
  analysis id the upload returns would only tell us the hash we already have.

  VIRUSTOTAL WILL NOT TAKE EVERYTHING. Its own limits, not ours: 32 MB on the
  plain endpoint, 650 MB through an upload URL, and nothing above that. The
  old one-file installer was over 650 MB, so that refusal is an expected
  outcome for a large file rather than a fault, and it is said as plainly as
  the rest. When it happens there is no report for that hash until the file is
  under the cap or somebody sends it by hand.

  WHAT HAS BEEN MEASURED, and what has not. The paths that end in a line and
  exit 0 without a key, without a file, and with nothing answering, are what
  tests\test-virustotal-upload.ps1 runs. The upload itself is written from
  VirusTotal's API v3 documentation and has not been run from here: this
  repository holds no key, and a cloud agent may not send a build anywhere.
  The first real upload is Patrick's, on the machine that ships.

.PARAMETER Path
  The file to send: the Setup program or the launcher, and it takes any file.

.PARAMETER Sha256
  The SHA-256 the caller has already measured, if it has. Optional. This
  script hashes the file itself either way and uses its own measurement; a
  value here that does not match is reported.

.PARAMETER Api
  The VirusTotal API v3 root. Only a test points this anywhere else, at an
  address where nothing answers, to prove that a dead network ends in a line
  and exit 0 rather than in a stopped release.

.PARAMETER TimeoutMinutes
  How long one call may take. The default covers a 650 MB upload on a home
  connection. This runs after the file is published, so a slow upload holds
  up nothing anybody is waiting for.

.PARAMETER OutcomePath
  Optional path for a small name=value outcome file the caller can read.
  status is sent, already-has or skipped. skipReason, when status is skipped,
  is one of no-key, over-650mb or upload-failed (stable tokens, so a script
  can read the outcome without parsing the printed line).

.EXAMPLE
  .\Publish-VirusTotal.ps1 -Path .\Thornswood-Setup.exe

.EXAMPLE
  .\Publish-VirusTotal.ps1 -Path .\Thornswood-Setup.exe -Sha256 $exeSha

  With a hash already measured; a value that does not match is reported.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,
    [string]$Sha256,
    [string]$Api = 'https://www.virustotal.com/api/v3',
    [int]$TimeoutMinutes = 30,
    # Where this run writes a small name=value outcome the caller can read.
    # Optional, for a caller that reads the outcome without parsing the
    # printed line.
    [string]$OutcomePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# VirusTotal's own caps, in its documentation for POST /files and
# GET /files/upload_url. Named here so the lines below can say the number.
$PlainCap = 32MB
$UrlCap = 650MB

$script:key = ''

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

# The one place any text that came back from outside is written, so there is
# one place to check that the key never rides out with it.
function Clean([string]$text) {
    if (-not $text) { return '' }
    if ($script:key) { $text = $text.Replace($script:key, '<the key>') }
    $text = ($text -replace '\s+', ' ').Trim()
    if ($text.Length -gt 200) { $text = $text.Substring(0, 200) + '...' }
    return $text
}

# Small structured outcome for a caller that needs more than the printed
# line. name=value, not JSON: Windows PowerShell's ConvertFrom-Json turns an
# ISO-8601 stamp into a DateTime, and ConvertTo-Json then drops the Z.
function Write-Outcome(
    [string]$Status,
    [string]$Sha = '',
    [string]$ReportUrl = '',
    [string]$SkipReason = ''
) {
    if (-not $OutcomePath) { return }
    $lines = @(
        ('status=' + $Status),
        ('sha256=' + $Sha),
        ('reportUrl=' + $ReportUrl),
        ('skipReason=' + $SkipReason)
    )
    $dir = Split-Path -Parent $OutcomePath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [IO.File]::WriteAllLines($OutcomePath, $lines, (New-Object Text.UTF8Encoding($false)))
}

# Every way out. One line, then exit 0, because nothing here may stop a
# release that is already published. Soft-skip reasons written for a caller
# are the stable tokens Website #740 reads: no-key, over-650mb, upload-failed.
function Stop-Here(
    [string]$line,
    [string]$Status = 'skipped',
    [string]$Sha = '',
    [string]$ReportUrl = '',
    [string]$SkipReason = 'upload-failed'
) {
    Write-Outcome -Status $Status -Sha $Sha -ReportUrl $ReportUrl -SkipReason $SkipReason
    Say ('  VirusTotal: ' + $line) 'Yellow'
    exit 0
}

function Get-Report([string]$sha) { return ('https://www.virustotal.com/gui/file/' + $sha) }

# Why a call did not happen, in the words of the thing that refused it.
# PowerShell wraps a throw from a .NET method in one of its own, so
# $_.Exception.Message reads "Exception calling GetResult with 0 arguments"
# and buries "Connection refused" inside it. The innermost one is the answer.
function Get-Why($err) { return (Clean $err.Exception.GetBaseException().Message) }

# ------------------------------------------------------------------- the key
$script:key = ([string]$env:VT_API_KEY).Trim()
if (-not $script:key) {
    # The normal case on every machine but the one that ships.
    Stop-Here 'skipped (VT_API_KEY not set)' -SkipReason 'no-key'
}

# ------------------------------------------------------------------ the file
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-Here ('skipped (no file at ' + $Path + ')') -SkipReason 'upload-failed'
}
$file = Get-Item -LiteralPath $Path
$mb = '{0:N1} MB' -f ($file.Length / 1MB)

$sha = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Sha256 -and $Sha256.Trim().ToLowerInvariant() -ne $sha) {
    # Said rather than obeyed. The bytes on disk are what people download.
    Say ('  VirusTotal: the hash passed in is not this file''s, using the file''s ' + $sha) 'Yellow'
}
$report = Get-Report $sha

# --------------------------------------------------------------------- calls
#
# HttpClient rather than Invoke-RestMethod, for two measured reasons. A 650 MB
# body has to be streamed off the disk rather than read into memory first. And
# Windows PowerShell 5.1's Invoke-RestMethod throws on any status that is not
# a success and has no -SkipHttpErrorCheck, so the 404 that means "VirusTotal
# has not seen this file", which is the answer this script most expects, would
# arrive as an error and read like a broken network.
if (-not ('System.Net.Http.HttpClient' -as [type])) {
    Add-Type -AssemblyName System.Net.Http
}
# .NET Framework 4 picks its own protocols and TLS 1.2 is not always among
# them, so a call from Windows PowerShell fails on the handshake. Added, never
# replaced, so nothing else this process does loses a protocol it was using.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function New-Client {
    $c = New-Object System.Net.Http.HttpClient
    $c.Timeout = [TimeSpan]::FromMinutes($TimeoutMinutes)
    $c.DefaultRequestHeaders.Add('x-apikey', $script:key)
    $c.DefaultRequestHeaders.Add('accept', 'application/json')
    return $c
}

# Status and body, never an exception, so each caller decides what a status
# means. A body that is not JSON comes back as $null rather than throwing.
function Read-Reply($reply) {
    $body = $reply.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $json = $null
    if ($body) { try { $json = $body | ConvertFrom-Json } catch { $json = $null } }
    return [pscustomobject]@{
        Code = [int]$reply.StatusCode
        Body = $body
        Json = $json
    }
}

# Strict mode is dynamically scoped, and Ship.ps1 runs under it, so reaching
# for a field VirusTotal did not send would throw here and not when this is
# run on its own. Every read of a parsed reply goes through this.
function Get-Field($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}

function Invoke-Get([string]$url) {
    $client = New-Client
    try {
        return Read-Reply $client.GetAsync($url).GetAwaiter().GetResult()
    }
    finally { $client.Dispose() }
}

function Send-File([string]$url, [string]$full) {
    $client = New-Client
    $stream = $null
    $form = $null
    try {
        $stream = [IO.File]::OpenRead($full)
        $part = New-Object System.Net.Http.StreamContent($stream)
        $part.Headers.ContentType =
            New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
        $form = New-Object System.Net.Http.MultipartFormDataContent
        # "file" is the field name VirusTotal reads. The name beside it is what
        # its web page shows for the submission.
        $form.Add($part, 'file', [IO.Path]::GetFileName($full))
        return Read-Reply $client.PostAsync($url, $form).GetAwaiter().GetResult()
    }
    finally {
        if ($form) { $form.Dispose() }
        if ($stream) { $stream.Dispose() }
        $client.Dispose()
    }
}

# What a status means, in one place, so the lookup and the upload say the same
# thing about the same refusal. Empty when the status is not a refusal.
function Get-Refusal($r) {
    switch ($r.Code) {
        401 { return 'VT_API_KEY was refused' }
        403 { return 'this key is not allowed to upload' }
        429 { return 'the key is out of quota for now' }
        default {
            if ($r.Code -ge 400) {
                $err = Get-Field $r.Json 'error'
                $msg = Clean ([string](Get-Field $err 'message'))
                if (-not $msg) { $msg = Clean $r.Body }
                return ('VirusTotal answered ' + $r.Code + ($(if ($msg) { ', ' + $msg } else { '' })))
            }
            return ''
        }
    }
}

# --------------------------------------------------------- already sent once
#
# Running this again on the same file is a normal thing to do, and the file
# is the same file. Asking costs one small call.
try {
    $have = Invoke-Get ($Api.TrimEnd('/') + '/files/' + $sha)
}
catch {
    Stop-Here ('not sent (' + (Get-Why $_) + '). ' + $report +
               ' says item not found until it is.') -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
}
if ($have.Code -eq 200) {
    Write-Outcome -Status 'already-has' -Sha $sha -ReportUrl $report
    Say ('  VirusTotal: already has this build: ' + $report) 'Green'
    exit 0
}
if ($have.Code -ne 404) {
    $why = Get-Refusal $have
    if ($why) {
        Stop-Here ('not sent (' + $why + '). ' + $report + ' says item not found until it is.') `
            -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
    }
}

# ------------------------------------------------------------------ the size
if ($file.Length -gt $UrlCap) {
    Stop-Here ('not sent (' + $mb + ', and VirusTotal takes files up to ' +
               ('{0:N0} MB' -f ($UrlCap / 1MB)) + '). ' + $report +
               ' says item not found until this build is sent by hand.') `
        -Sha $sha -ReportUrl $report -SkipReason 'over-650mb'
}

$url = $Api.TrimEnd('/') + '/files'
if ($file.Length -gt $PlainCap) {
    # Anything over 32 MB goes to a one-time address VirusTotal hands out for
    # that upload. The installer is always on this path. $uploadReply is the
    # HTTP reply from /files/upload_url (parsed body in .Json), not a file on
    # disk and not a credential: the body is the one-time URL, the key stays
    # in the request header only.
    try {
        $uploadReply = Invoke-Get ($Api.TrimEnd('/') + '/files/upload_url')
    }
    catch {
        Stop-Here ('not sent (' + (Get-Why $_) + '). ' + $report +
                   ' says item not found until it is.') -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
    }
    $why = Get-Refusal $uploadReply
    if ($why) {
        Stop-Here ('not sent (' + $why + '). ' + $report + ' says item not found until it is.') `
            -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
    }
    $url = [string](Get-Field $uploadReply.Json 'data')
    if (-not $url) {
        Stop-Here ('not sent (VirusTotal gave no upload address). ' + $report +
                   ' says item not found until it is.') -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
    }
}

# ------------------------------------------------------------------- send it
Say ('  VirusTotal: sending ' + $file.Name + ', ' + $mb + '. This takes a few minutes.') 'Gray'
try {
    $sent = Send-File $url $file.FullName
}
catch {
    Stop-Here ('not sent (' + (Get-Why $_) + '). ' + $report +
               ' says item not found until it is.') -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
}
$why = Get-Refusal $sent
if ($why) {
    Stop-Here ('not sent (' + $why + '). ' + $report + ' says item not found until it is.') `
        -Sha $sha -ReportUrl $report -SkipReason 'upload-failed'
}

# The reply carries the analysis id. It is not read: the report address is
# built from the hash of the file on this disk, it works as soon as the file
# is accepted, and the engines finish in their own time.
Write-Outcome -Status 'sent' -Sha $sha -ReportUrl $report
Say ('  VirusTotal: sent ' + $mb + '. The report appears at ' + $report + ' within a few minutes.') 'Green'

# One community comment on the new report saying what the file is. Only on a
# successful upload (not skip / already-has / refused). Fail-soft: the comment
# script exits 0 itself, and a throw here still ends in exit 0 so a missing
# comment never undoes a publish that already sent the file.
try {
    & (Join-Path $PSScriptRoot 'Add-VirusTotalComment.ps1') -Path $file.FullName -Sha256 $sha -Api $Api
}
catch {
    Say ('  VirusTotal: no comment (' + (Get-Why $_) + '). The report is ' + $report) 'Yellow'
}
exit 0
