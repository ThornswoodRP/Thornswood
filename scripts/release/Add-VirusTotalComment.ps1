<#
.SYNOPSIS
  Optional manual tool: leaves one community comment on a build's VirusTotal report, or says plainly that it is not commenting and carries on.

.DESCRIPTION
  The engines that flagged the setup program are machine learning scores and
  hash intelligence rather than signatures for anything known: 5 of 71 on
  27 September, on a build from before signing (issue #390), one of them
  McAfeeD's ti!<hash>, which is a lookup in a feed that reads VirusTotal
  itself. There is no byte to change for verdicts like those. What a vendor
  reads when somebody picks the file out of their queue is the report, so a
  comment on the report that names the program, the company, the site it is
  published from and the state of the signing is signal added beside the
  certificate, while a new signed publisher has little reputation yet.
  docs\VIRUSTOTAL-FALSE-POSITIVE.md is the whole picture and the checklist for
  the vendors that want a form filled in.

  UPLOADING IS A DIFFERENT SCRIPT. Publish-VirusTotal.ps1 sends the file, which
  is what makes the report exist at all; this writes on the report once it
  does. Run this after it. A hash VirusTotal has never seen has no report to
  comment on, and that case ends in a line telling you to send the file first.

  NOTHING HERE CAN STOP A RELEASE. Every way out is exit 0 with one line saying
  which: no key, no file, no report yet, a key VirusTotal refuses, a comment
  already there, a network that is not there. The release is published before
  this runs and a missing comment does not undo it.

  THE KEY IS READ FROM THE ENVIRONMENT AND FROM NOWHERE ELSE. VT_API_KEY, set
  on the machine that ships and nowhere in this repository. There is no
  parameter for it, so it cannot be typed on a command line that a shell then
  writes into its history, and there is no file for it to be committed in. It
  is never printed: the one place text from outside is written scrubs the key
  out of it first.

  WHAT HAS BEEN MEASURED. The paths that end in a line and exit 0 without a
  key, without a file, and with nothing answering are what
  tests\test-virustotal-comment.ps1 runs, the last of them against a dead
  address on the loopback. The posting itself is written from VirusTotal's API
  v3 documentation and has not been run from here: this repository holds no
  key. The first real comment is Patrick's, on the machine that ships.

.PARAMETER Path
  The file the comment is about. Its bytes are hashed here, because the hash
  of what people download is the only one worth commenting under.

.PARAMETER Sha256
  The SHA-256 the caller has already measured, if it has. Optional. This script
  hashes the file itself either way and uses its own measurement; a value here
  that does not match is reported rather than obeyed.

.PARAMETER Text
  Different comment text. The default is the description
  docs\VIRUSTOTAL-FALSE-POSITIVE.md's checklist sends every vendor: the
  program, the site, what Velopack's setup does and that it is Authenticode
  signed.

.PARAMETER Api
  The VirusTotal API v3 root. Only a test points this anywhere else, at an
  address where nothing answers, to prove that a dead network ends in a line
  and exit 0 rather than in a stopped release.

.PARAMETER TimeoutMinutes
  How long the call may take. A comment is a few hundred bytes, so this is
  generous rather than tuned.

.EXAMPLE
  .\Add-VirusTotalComment.ps1 -Path .\Thornswood-Setup.exe

.EXAMPLE
  .\Add-VirusTotalComment.ps1 -Path .\Thornswood-Setup.exe -Sha256 $exeSha

  What Publish-VirusTotal.ps1 runs after a successful upload, with the hash it
  has already measured.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,
    [string]$Sha256,
    [string]$Text,
    [string]$Api = 'https://www.virustotal.com/api/v3',
    [int]$TimeoutMinutes = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

# Every way out. One line, then exit 0.
function Stop-Here([string]$line) {
    Say ('  VirusTotal: ' + $line) 'Yellow'
    exit 0
}

# PowerShell wraps a throw from a .NET method in one of its own, so
# $_.Exception.Message reads "Exception calling GetResult with 0 arguments"
# and buries "Connection refused" inside it. The innermost one is the answer.
function Get-Why($err) { return (Clean $err.Exception.GetBaseException().Message) }

# What the vendors read: the description every vendor form gets in
# docs\VIRUSTOTAL-FALSE-POSITIVE.md's checklist, word for word, so a reviewer
# reading the report and one reading a form see one program and not two
# (tests\test-virustotal-comment.ps1 holds the two to each other). Since #4824
# the download is Velopack's setup program, which carries its package inside
# it and starts the launcher; the program before it downloaded a payload and
# started a Setup.bat, and both are gone.
function Get-DefaultText() {
    return @(
        'Thornswood Setup, the installer for Thornswood, a private modded',
        'Skyrim multiplayer server at https://thornswood.net.',
        'It is a Velopack setup program: it installs the Thornswood launcher',
        'and its game files from the package inside it, then starts the',
        'launcher. It is Authenticode signed through Azure Artifact Signing,',
        'and published on the Thornswood GitHub Releases.',
        'It is a new signed publisher with little reputation yet.',
        'Please take another look.'
    ) -join ' '
}

# ------------------------------------------------------------------- the key
$script:key = ([string]$env:VT_API_KEY).Trim()
if (-not $script:key) {
    # The normal case on every machine but the one that ships.
    Stop-Here 'no comment (VT_API_KEY not set)'
}

# ------------------------------------------------------------------ the file
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-Here ('no comment (no file at ' + $Path + ')')
}
$file = Get-Item -LiteralPath $Path
$sha = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Sha256 -and $Sha256.Trim().ToLowerInvariant() -ne $sha) {
    # Said rather than obeyed. The bytes on disk are what people download.
    Say ('  VirusTotal: the hash passed in is not this file''s, using the file''s ' + $sha) 'Yellow'
}
$report = 'https://www.virustotal.com/gui/file/' + $sha
if (-not $Text) { $Text = Get-DefaultText }

# --------------------------------------------------------------------- calls
# HttpClient rather than Invoke-RestMethod, because Windows PowerShell 5.1's
# Invoke-RestMethod throws on any status that is not a success and has no
# -SkipHttpErrorCheck, so the 404 that means "VirusTotal has not seen this
# file yet", which is an ordinary answer here, would arrive as an error and
# read like a broken network.
if (-not ('System.Net.Http.HttpClient' -as [type])) {
    Add-Type -AssemblyName System.Net.Http
}
# .NET Framework 4 picks its own protocols and TLS 1.2 is not always among
# them. Added, never replaced, so nothing else this process does loses a
# protocol it was using.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Send-Comment([string]$url, [string]$body) {
    $client = New-Object System.Net.Http.HttpClient
    $content = $null
    try {
        $client.Timeout = [TimeSpan]::FromMinutes($TimeoutMinutes)
        $client.DefaultRequestHeaders.Add('x-apikey', $script:key)
        $client.DefaultRequestHeaders.Add('accept', 'application/json')
        $content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')
        $reply = $client.PostAsync($url, $content).GetAwaiter().GetResult()
        $text = $reply.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{ Code = [int]$reply.StatusCode; Body = $text }
    }
    finally {
        if ($content) { $content.Dispose() }
        $client.Dispose()
    }
}

# ----------------------------------------------------------------- the post
$payload = @{ data = @{ type = 'comment'; attributes = @{ text = $Text } } } |
           ConvertTo-Json -Depth 5 -Compress
$url = $Api.TrimEnd('/') + '/files/' + $sha + '/comments'

$sent = $null
try { $sent = Send-Comment $url $payload }
catch { Stop-Here ('no comment (' + (Get-Why $_) + '). The report is ' + $report) }

switch ($sent.Code) {
    401 { Stop-Here ('no comment (VT_API_KEY was refused). The report is ' + $report) }
    403 { Stop-Here ('no comment (this key is not allowed to comment). The report is ' + $report) }
    404 { Stop-Here ('no comment (VirusTotal has no report for this hash yet, so send the file first with Publish-VirusTotal.ps1). The report will be ' + $report) }
    409 { Stop-Here ('that comment is already on the report: ' + $report) }
    429 { Stop-Here ('no comment (the key is out of quota for now). The report is ' + $report) }
}
if ($sent.Code -ge 400) {
    Stop-Here ('no comment (VirusTotal answered ' + $sent.Code + ', ' + (Clean $sent.Body) +
               '). The report is ' + $report)
}

Say ('  VirusTotal: commented on ' + $report) 'Green'
exit 0
