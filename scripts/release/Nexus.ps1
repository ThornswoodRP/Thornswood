<#
  Nexus.ps1

  The one place the release scripts talk to Nexus Mods from, with Patrick's
  personal API key (#2914).

      . (Join-Path $PSScriptRoot 'Nexus.ps1')

  WHY IT EXISTS. Until 20 October Patrick uploaded every new file of
  Thornswood Content (mod 192001) and the Thornswood Client Runtime (mod
  192762) by hand on the website, and made each collection revision by hand in
  Vortex. Send-NexusFile.ps1, Set-NexusDescription.ps1 and
  New-NexusRevision.ps1 do those from a script, and every request they make to
  Nexus goes through the functions below, so the key is read in one place and
  sent in one place.

  THE KEY. Patrick's personal API key, from https://www.nexusmods.com/settings/api-keys.
  It is read from exactly one of these, by these exact names:

      THORNSWOOD_NEXUS_API_KEY                   the environment variable, in the
                                                 one step of nexus-run.yml that
                                                 runs a script, from the secret
                                                 NEXUS_API_KEY of the "desk"
                                                 environment (#2841)
      %LOCALAPPDATA%\Thornswood\Nexus\api-key.txt
                                                 the file, on One, written by
                                                 Set-NexusKey.ps1 at a prompt

  The variable is used when it is set; otherwise the file. Neither is in the
  repository. A cloud session holds neither since #2841: it runs these
  scripts through scripts\release\Nexus-Run.ps1, which starts nexus-run.yml. The key is sent only in the apikey header, and only to
  https://api.nexusmods.com: never on a command line, never printed, never
  written to a log, and never to the upload addresses Nexus hands back, which
  are signed already and get no key. Requests to api.nexusmods.com do not
  follow a redirect, so the header cannot be carried anywhere else.

  THE STAND-IN. tests\test-2914-nexus-scripts.ps1 points these scripts at a
  stand-in Nexus on this machine's loopback address through
  THORNSWOOD_NEXUS_STANDIN (http://127.0.0.1:<port>). Then the real key is
  never read: the stand-in is sent THORNSWOOD_NEXUS_STANDIN_KEY, a made-up
  value the harness sets, and an address that is not loopback is refused.

  EVERY REQUEST to Nexus carries Application-Name Thornswood and
  Application-Version, main's launcher number (LauncherVersion.ps1), as
  the acceptable use policy asks
  (https://help.nexusmods.com/article/114-api-acceptable-use-policy).

  THE RATE LIMIT is 20,000 requests a day and then 500 an hour. A run of any
  of these scripts makes a few dozen. A 429 stops the run with a sentence; it
  is not tried again.

  What is here:
      Read-NexusKey                       the key, or a stop saying where it goes
      Invoke-NexusApi GET|POST|PATCH path [body]
                                          one request to the v3 API
      Invoke-NexusGraph query [variables] one request to the v2 GraphQL API
      Get-NexusArchiveFacts path          size and md5 of a local archive
      Send-NexusUpload facts              the whole upload: create, send,
                                          finalise, wait until it is available
      Wait-NexusUpload id seconds         only the wait, for -UploadId
      Receive-NexusPresigned url folder   one download from a signed address
                                          Nexus handed back, into a folder
#>

$script:NexusAppName = 'Thornswood'
$script:NexusHere = $PSScriptRoot
# Above this an upload has to be multipart (POST /uploads/multipart): the
# spec's createUpload, "Files larger than 100 MiB must use a multi part
# upload", and Vortex's MULTIPART_THRESHOLD, 100 * 1024 * 1024.
$script:NexusSinglePartMax = 100 * 1024 * 1024

if (-not ('System.Net.Http.HttpClient' -as [type])) { Add-Type -AssemblyName System.Net.Http }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# A property of something ConvertFrom-Json made, or $null when it is not there,
# so a missing field reads the same under Set-StrictMode and without it.
function Get-NexusField($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

# Main's launcher number for this checkout (LauncherVersion.ps1, #5179): git
# holds 0.0.0 in Updater.cs, so the number is worked out from the history,
# which a shallow checkout does not have and says so. Worked out once in a
# run, the first time a request needs it: the checkout does not move under a
# run, so every request sends the same number. Asked of git for each request,
# as it was from #5179 until 1 Nov, every request started two git processes,
# and tests\test-2914-nexus-scripts.ps1 went from about 390 processes to
# about 1300 and past its 300 seconds on a Windows runner.
$script:NexusAppVersion = ''
function Get-NexusAppVersion {
  if ($script:NexusAppVersion) { return $script:NexusAppVersion }
  . (Join-Path $script:NexusHere 'LauncherVersion.ps1')
  try { $script:NexusAppVersion = Get-LauncherVersion -RepoDir (Join-Path $script:NexusHere '..\..') }
  catch { throw ($_.Exception.Message + ' It is sent to Nexus as Application-Version.') }
  return $script:NexusAppVersion
}

# The address every request goes to: Nexus itself, or the harness's stand-in.
function Get-NexusBase {
  $s = [string]$env:THORNSWOOD_NEXUS_STANDIN
  if (-not $s) { return 'https://api.nexusmods.com' }
  $u = $null
  if (-not [Uri]::TryCreate($s, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'http' -or -not ($u.Host -eq '127.0.0.1' -or $u.Host -eq 'localhost' -or $u.Host -eq '[::1]')) {
    throw 'THORNSWOOD_NEXUS_STANDIN is set to something other than an http address on this machine''s loopback, so nothing was sent. It is only for the harness.'
  }
  return $s.TrimEnd('/')
}

# The 7-Zip that unpacks and packs the collection's archives, for
# Install-NexusRevision.ps1 and New-NexusRevision.ps1 alike. Off Windows,
# 7-Zip's own build that Get-SevenZip.ps1 puts in place comes first: Ubuntu's
# cannot unpack RAR (#2969). Each script had its own copy of this until
# 21 Oct, and New-NexusRevision's asked for 7z before 7zz, so a cloud session
# with Ubuntu's 7z installed stopped on the first RAR plugin it had to patch
# ("Unsupported Method", LSFX-SSE-Audiosettings.esp).
function Find-SevenZip {
  if ($env:ProgramFiles) { $p = Join-Path $env:ProgramFiles '7-Zip\7z.exe'; if (Test-Path -LiteralPath $p) { return $p } }
  if (-not $IsWindows) {
    $own = & (Join-Path $script:NexusHere 'Get-SevenZip.ps1') -Check 6>$null
    if ($LASTEXITCODE -eq 0 -and $own) { return [string]$own }
  }
  foreach ($n in '7zz', '7z', '7za') { $g = Get-Command $n -ErrorAction SilentlyContinue; if ($g) { return $g.Source } }
  return ''
}

function Test-NexusStandIn { return [bool]$env:THORNSWOOD_NEXUS_STANDIN }

function Get-NexusKeyFile {
  if (-not $env:LOCALAPPDATA) { return '' }
  return (Join-Path $env:LOCALAPPDATA 'Thornswood\Nexus\api-key.txt')
}

# Where the key was read from, in words, for a script to say. Never the key.
$script:NexusKeyFrom = ''
$script:NexusKey = ''

function Read-NexusKey {
  if ($script:NexusKey) { return $script:NexusKey }
  if (Test-NexusStandIn) {
    $k = [string]$env:THORNSWOOD_NEXUS_STANDIN_KEY
    if (-not $k) { throw 'THORNSWOOD_NEXUS_STANDIN is set but THORNSWOOD_NEXUS_STANDIN_KEY is not, so there is no key for the stand-in. The real key is never read for a stand-in.' }
    $script:NexusKeyFrom = 'the stand-in key (THORNSWOOD_NEXUS_STANDIN_KEY)'
    $script:NexusKey = $k
    return $k
  }
  $k = ''
  if ($env:THORNSWOOD_NEXUS_API_KEY) {
    $k = ([string]$env:THORNSWOOD_NEXUS_API_KEY).Trim()
    $script:NexusKeyFrom = 'the environment variable THORNSWOOD_NEXUS_API_KEY'
  }
  else {
    $f = Get-NexusKeyFile
    if ($f -and (Test-Path -LiteralPath $f)) {
      $k = ([IO.File]::ReadAllText($f)).Trim()
      $script:NexusKeyFrom = $f
    }
  }
  if (-not $k) {
    $where = Get-NexusKeyFile
    if (-not $where) { $where = '%LOCALAPPDATA%\Thornswood\Nexus\api-key.txt (on One)' }
    throw ('There is no Nexus API key on this machine, so nothing was sent to Nexus. A cloud session holds none: run the script through pwsh scripts/release/Nexus-Run.ps1 -Line ''<script> <parameters>''. On One the key is ' + $where + ', which .\scripts\release\Set-NexusKey.ps1 writes at a prompt.')
  }
  if ($k -match '\s') { throw ('The Nexus API key read from ' + $script:NexusKeyFrom + ' has a space or a line break inside it, so it is not one key. Nothing was sent to Nexus.') }
  $script:NexusKey = $k
  return $k
}

$script:NexusApiClient = $null
$script:NexusUploadClient = $null
function Get-NexusClient([switch]$Upload) {
  if ($Upload) {
    if (-not $script:NexusUploadClient) {
      $h = New-Object System.Net.Http.HttpClientHandler
      $h.AllowAutoRedirect = $false
      $c = New-Object System.Net.Http.HttpClient($h)
      # A part or a whole archive of up to 100 MiB on a slow line.
      $c.Timeout = [TimeSpan]::FromMinutes(60)
      $script:NexusUploadClient = $c
    }
    return $script:NexusUploadClient
  }
  if (-not $script:NexusApiClient) {
    $h = New-Object System.Net.Http.HttpClientHandler
    # Never follow a redirect with the apikey header on it.
    $h.AllowAutoRedirect = $false
    $c = New-Object System.Net.Http.HttpClient($h)
    $c.Timeout = [TimeSpan]::FromSeconds(120)
    $script:NexusApiClient = $c
  }
  return $script:NexusApiClient
}

# Sends one HttpRequestMessage and gives back Code, Body, ETag and Headers.
# A request that gets no answer at all throws a sentence naming where it went
# (the path, never a header).
function Send-NexusRequest($client, $request, [string]$what) {
  $resp = $null
  try { $resp = $client.SendAsync($request).GetAwaiter().GetResult() }
  catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    throw ($what + ' got no answer: ' + $e.Message)
  }
  $body = ''
  if ($resp.Content) { $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
  $etag = ''
  $vals = $null
  if ($resp.Headers.TryGetValues('ETag', [ref]$vals)) { $etag = ([string]@($vals)[0]) }
  $r = [pscustomobject]@{ Code = [int]$resp.StatusCode; Body = $body; ETag = $etag; Reason = [string]$resp.ReasonPhrase }
  $resp.Dispose()
  return $r
}

# What Nexus said was wrong, from its RFC 9457 problem body when it sent one.
function Format-NexusProblem($r) {
  $say = 'HTTP ' + $r.Code
  if ($r.Reason) { $say += ' ' + $r.Reason }
  $j = $null
  if ($r.Body) { try { $j = $r.Body | ConvertFrom-Json } catch { $j = $null } }
  if ($j) {
    $d = Get-NexusField $j 'detail'
    $t = Get-NexusField $j 'title'
    if ($d) { $say += ': ' + $d } elseif ($t) { $say += ': ' + $t }
    $errs = @(@(Get-NexusField $j 'errors') | Where-Object { $_ })
    if ($errs.Count) { $say += ' (' + ((@($errs | ForEach-Object { '' + (Get-NexusField $_ 'pointer') + ' ' + (Get-NexusField $_ 'detail') + (Get-NexusField $_ 'message') })) -join '; ') + ')' }
  }
  elseif ($r.Body) {
    $b = $r.Body.Trim()
    if ($b.Length -gt 300) { $b = $b.Substring(0, 300) + '...' }
    $say += ': ' + $b
  }
  if ($r.Code -eq 429) { $say += '. That is the rate limit, 20,000 requests a day and then 500 an hour; run it again once the hour turns' }
  if ($r.Code -eq 401) { $say += '. Nexus did not accept the key from ' + $script:NexusKeyFrom }
  return $say
}

function Add-NexusHeaders($request) {
  $key = Read-NexusKey
  [void]$request.Headers.TryAddWithoutValidation('apikey', $key)
  [void]$request.Headers.TryAddWithoutValidation('Application-Name', $script:NexusAppName)
  [void]$request.Headers.TryAddWithoutValidation('Application-Version', (Get-NexusAppVersion))
  [void]$request.Headers.TryAddWithoutValidation('Accept', 'application/json')
}

# One request to the v3 API. Path starts at /v3. Returns the parsed answer for
# a 2xx with a body, $true for a 2xx with none, and throws a sentence for
# anything else.
function Invoke-NexusApi([string]$Method, [string]$Path, [string]$Body = '', [string]$What = '') {
  if (-not $What) { $What = $Method + ' ' + $Path }
  $url = (Get-NexusBase) + $Path
  $req = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), $url)
  Add-NexusHeaders $req
  if ($Body) { $req.Content = New-Object System.Net.Http.StringContent($Body, (New-Object Text.UTF8Encoding($false)), 'application/json') }
  elseif ($Method -ne 'GET') {
    # A POST with nothing to say (finalise) goes as Nexus's own upload action
    # sends it: Content-Type application/json and no body.
    $req.Content = New-Object System.Net.Http.ByteArrayContent(, [byte[]]@())
    $req.Content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/json')
  }
  $r = Send-NexusRequest (Get-NexusClient) $req $What
  $req.Dispose()
  if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ($What + ' was refused: ' + (Format-NexusProblem $r)) }
  if (-not $r.Body.Trim()) { return $true }
  try { return ($r.Body | ConvertFrom-Json) }
  catch { throw ($What + ' answered ' + $r.Code + ' with something that is not JSON.') }
}

# One request to the v2 GraphQL API, which v3 does not replace yet for the
# collection's numbers, a mod's description and publishing a revision.
# Returns data; GraphQL errors throw.
function Invoke-NexusGraph([string]$Query, $Variables = $null, [string]$What = 'The GraphQL request') {
  $payload = [ordered]@{ query = $Query }
  if ($null -ne $Variables) { $payload.variables = $Variables }
  $body = $payload | ConvertTo-Json -Compress -Depth 10
  $url = (Get-NexusBase) + '/v2/graphql'
  $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $url)
  Add-NexusHeaders $req
  $req.Content = New-Object System.Net.Http.StringContent($body, (New-Object Text.UTF8Encoding($false)), 'application/json')
  $r = Send-NexusRequest (Get-NexusClient) $req $What
  $req.Dispose()
  if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ($What + ' was refused: ' + (Format-NexusProblem $r)) }
  $j = $null
  try { $j = $r.Body | ConvertFrom-Json } catch { throw ($What + ' answered with something that is not JSON.') }
  $errs = @(@(Get-NexusField $j 'errors') | Where-Object { $_ })
  if ($errs.Count) { throw ($What + ' was refused: ' + ((@($errs | ForEach-Object { Get-NexusField $_ 'message' })) -join '; ')) }
  return (Get-NexusField $j 'data')
}

# ------------------------------------------------------------ the archive ---

function Get-NexusArchiveFacts([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw ('There is no file at ' + $Path + '.') }
  $item = Get-Item -LiteralPath $Path
  $name = $item.Name
  # The name goes into Content-Disposition, which is part of the upload
  # address's signature, so it has to be plain ASCII with no quote.
  if ($name -notmatch '^[A-Za-z0-9 _().,+\-]+\.[A-Za-z0-9]+$') { throw ('The archive''s name, ' + $name + ', has a character the upload header cannot carry; use letters, digits, spaces and _ ( ) . , + - only.') }
  $md5 = [Security.Cryptography.MD5]::Create()
  $fs = [IO.File]::OpenRead($item.FullName)
  try { $hash = $md5.ComputeHash($fs) } finally { $fs.Dispose(); $md5.Dispose() }
  return [pscustomobject]@{
    Path      = $item.FullName
    Name      = $name
    Size      = [long]$item.Length
    Md5Hex    = (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    Md5Base64 = [Convert]::ToBase64String($hash)
  }
}

# CRC-64/NVME of a whole file, base64 of its eight bytes most significant
# first: the x-amz-checksum-crc64nvme value the multipart upload is bound to
# (createMultipartUpload, "Content integrity"). md5 is not available there,
# because a multipart ETag is a hash of the part digests, not of the file.
function Get-NexusCrc64Nvme([string]$Path) {
  if (-not ('ThornswoodCrc64Nvme' -as [type])) {
    Add-Type -TypeDefinition @'
public static class ThornswoodCrc64Nvme {
  static readonly ulong[] Table = MakeTable();
  static ulong[] MakeTable() {
    ulong[] t = new ulong[256];
    for (int i = 0; i < 256; i++) {
      ulong c = (ulong)i;
      for (int k = 0; k < 8; k++) { c = ((c & 1UL) != 0) ? ((c >> 1) ^ 0x9A6C9329AC4BC9B5UL) : (c >> 1); }
      t[i] = c;
    }
    return t;
  }
  public static ulong Update(ulong crc, byte[] buf, int count) {
    for (int i = 0; i < count; i++) { crc = Table[(int)((crc ^ buf[i]) & 0xFFUL)] ^ (crc >> 8); }
    return crc;
  }
  public static string Finish(ulong crc) {
    crc ^= 0xFFFFFFFFFFFFFFFFUL;
    byte[] b = new byte[8];
    for (int i = 0; i < 8; i++) { b[i] = (byte)(crc >> (56 - 8 * i)); }
    return System.Convert.ToBase64String(b);
  }
  public static string OfBytes(byte[] data) { return Finish(Update(0xFFFFFFFFFFFFFFFFUL, data, data.Length)); }
  public static string OfFile(string path) {
    ulong crc = 0xFFFFFFFFFFFFFFFFUL;
    using (System.IO.FileStream fs = System.IO.File.OpenRead(path)) {
      byte[] buf = new byte[1 << 20];
      int n;
      while ((n = fs.Read(buf, 0, buf.Length)) > 0) { crc = Update(crc, buf, n); }
    }
    return Finish(crc);
  }
}
'@
  }
  return [ThornswoodCrc64Nvme]::OfFile($Path)
}

# ------------------------------------------------------------- uploading ---

# The upload addresses Nexus hands back are presigned for its storage. They get
# no key and none of the Nexus headers, only what their signature covers.
function Send-NexusPresigned([string]$Method, [string]$Url, $Content, [string]$What) {
  $u = $null
  if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$u) -or -not ($u.Scheme -eq 'https' -or ((Test-NexusStandIn) -and $u.Scheme -eq 'http' -and $u.Host -eq '127.0.0.1'))) {
    throw ($What + ': Nexus handed back an upload address that is not https, so nothing was sent to it.')
  }
  $req = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), $Url)
  $req.Content = $Content
  $r = Send-NexusRequest (Get-NexusClient -Upload) $req $What
  $req.Dispose()
  return $r
}

# One download from a signed address Nexus handed back (a mod file's
# download-link, a collection revision's download_link): its CDN, which gets
# no key and none of the Nexus headers, like the upload addresses above. The
# file goes into $Folder under the name the CDN's Content-Disposition gives,
# written as <name>.part and renamed once every byte is in, so a stop part way
# never leaves a whole-looking file. Returns Path, Name, Size and Md5Hex (the
# md5 worked out while it was written). A redirect, an answer other than 200,
# or fewer bytes than Content-Length stop it with a sentence; nothing is tried
# again, and the .part is deleted.
$script:NexusDownloadClient = $null
function Receive-NexusPresigned([string]$Url, [string]$Folder, [string]$What, [string]$FallbackName = 'download') {
  $u = $null
  if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$u) -or -not ($u.Scheme -eq 'https' -or ((Test-NexusStandIn) -and $u.Scheme -eq 'http' -and $u.Host -eq '127.0.0.1'))) {
    throw ($What + ': Nexus handed back a download address that is not https, so nothing was asked of it.')
  }
  if (-not $script:NexusDownloadClient) {
    $h = New-Object System.Net.Http.HttpClientHandler
    $h.AllowAutoRedirect = $false
    $c = New-Object System.Net.Http.HttpClient($h)
    # The biggest mod in the collection is about a gigabyte; two hours is a
    # slow line, not a hope that a stuck one comes back.
    $c.Timeout = [TimeSpan]::FromHours(2)
    $script:NexusDownloadClient = $c
  }
  $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Url)
  $resp = $null
  try { $resp = $script:NexusDownloadClient.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult() }
  catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    throw ($What + ' got no answer from ' + $u.Host + ': ' + $e.Message)
  }
  try {
    $code = [int]$resp.StatusCode
    if ($code -ne 200) { throw ($What + ': ' + $u.Host + ' answered HTTP ' + $code + ' ' + $resp.ReasonPhrase + ', so nothing was downloaded.') }
    $name = ''
    $cd = $resp.Content.Headers.ContentDisposition
    if ($cd) { $name = [string]$cd.FileNameStar; if (-not $name) { $name = ([string]$cd.FileName).Trim('"') } }
    $name = [IO.Path]::GetFileName($name)
    if (-not $name -or $name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { $name = $FallbackName }
    $want = $resp.Content.Headers.ContentLength
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $path = Join-Path $Folder $name
    $part = $path + '.part'
    $md5 = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::MD5)
    $got = [long]0
    $ok = $false
    try {
      $in = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $out = [IO.File]::Open($part, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $buf = New-Object byte[] (1 -shl 20)
        try {
          while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) { $out.Write($buf, 0, $n); $md5.AppendData($buf, 0, $n); $got += $n }
        }
        catch [System.IO.IOException] {
          $e = $_.Exception
          while ($e.InnerException) { $e = $e.InnerException }
          throw ($What + ': the connection to ' + $u.Host + ' broke after ' + $got + ' of ' + $(if ($null -ne $want) { [string]$want } else { 'the' }) + ' bytes (' + $e.Message.TrimEnd('.') + '), so the download is not whole and was deleted.')
        }
      }
      finally { $out.Dispose(); $in.Dispose() }
      if ($null -ne $want -and $got -ne [long]$want) { throw ($What + ': ' + $u.Host + ' sent ' + $got + ' of the ' + $want + ' bytes it said, so the download is not whole.') }
      $ok = $true
    }
    finally { if (-not $ok -and (Test-Path -LiteralPath $part)) { [IO.File]::Delete($part) } }
    if (Test-Path -LiteralPath $path) { [IO.File]::Delete($path) }
    [IO.File]::Move($part, $path)
    return [pscustomobject]@{ Path = $path; Name = $name; Size = $got; Md5Hex = (($md5.GetHashAndReset() | ForEach-Object { $_.ToString('x2') }) -join '') }
  }
  finally { $resp.Dispose(); $req.Dispose() }
}

# The archive Nexus holds as file $FileId of $Game, downloaded through its
# download-link with the key, into $Folder\<file id>. Returns what
# Receive-NexusPresigned returns. Nexus-Run.ps1 fetches -FileId and -Add's
# archives this way, and Publish-CollectionRecord.ps1 those of a merged
# record's change (#5189).
function Get-NexusFileArchive([string]$Game, [string]$FileId, [string]$Folder) {
  $dl = Get-NexusField (Invoke-NexusApi 'GET' ('/v3/games/' + $Game + '/mod-file-versions/' + $FileId + '/download-link') '' ('Asking for the download of file ' + $FileId)) 'data'
  $url = [string](Get-NexusField (@(Get-NexusField $dl 'links') | Select-Object -First 1) 'url')
  if (-not $url) { throw ('Nexus gave no download address for file ' + $FileId + '.') }
  return (Receive-NexusPresigned $url (Join-Path $Folder $FileId) ('Downloading file ' + $FileId) ($FileId + '.archive'))
}

# The archive of revision $Revision of collection $Slug (its collection.json
# and the folders Vortex packs beside it), downloaded with the key through
# the revision's downloadLink into $Folder. Returns Path, Name, Size and
# Md5Hex as Receive-NexusPresigned does, with the revision's Id and Status.
# A link that is not the API's own path stops it before anything is asked.
function Receive-NexusRevisionArchive([string]$Slug, [string]$Game, [int]$Revision, [string]$Folder) {
  $rq = '{ collectionRevision(slug: "' + $Slug + '", revision: ' + $Revision + ', domainName: "' + $Game + '") { id status downloadLink } }'
  $rev = Get-NexusField (Invoke-NexusGraph $rq $null ('Reading revision ' + $Revision)) 'collectionRevision'
  $link = [string](Get-NexusField $rev 'downloadLink')
  if ($link -notmatch '^/v2/collections/\d+/revisions/\d+/download_link$') { throw ('Nexus gave revision ' + $Revision + ' the download link "' + $link + '", not an API path, so it was not downloaded.') }
  $links = @(Get-NexusField (Invoke-NexusApi 'GET' $link '' ('Asking for revision ' + $Revision + '''s download')) 'download_links')
  $uri = [string](Get-NexusField ($links | Select-Object -First 1) 'URI')
  if (-not $uri) { throw ('Nexus gave no download address for revision ' + $Revision + '.') }
  $got = Receive-NexusPresigned $uri $Folder ('Downloading revision ' + $Revision) ('collection_' + $Slug + '_' + $Revision + '_.7z')
  $got | Add-Member -NotePropertyName Id -NotePropertyValue ([string](Get-NexusField $rev 'id'))
  $got | Add-Member -NotePropertyName Status -NotePropertyValue ([string](Get-NexusField $rev 'status'))
  return $got
}

# The wait for Nexus to process a finalised upload. get upload says the state
# goes created then available, and Nexus has no way to be told when, so it is
# asked every two seconds. It stops at the first state the spec does not name,
# or after $Seconds, saying which, so nothing is ever attached to an upload
# that is not available.
function Wait-NexusUpload([string]$UploadId, [int]$Seconds = 600) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  $asked = 0
  while ($true) {
    $a = Invoke-NexusApi 'GET' ('/v3/uploads/' + $UploadId) '' ('Asking Nexus how upload ' + $UploadId + ' is getting on')
    $asked++
    $state = [string](Get-NexusField (Get-NexusField $a 'data') 'state')
    if ($state -eq 'available') { return $asked }
    if ($state -ne 'created') { throw ('Nexus says upload ' + $UploadId + ' is "' + $state + '", which is neither created nor available, so nothing was made from it.') }
    if ([DateTime]::UtcNow -ge $until) { throw ('Upload ' + $UploadId + ' was still being processed after ' + $Seconds + ' seconds (' + $asked + ' asks). Nothing was made from it yet; run the same command again with -UploadId ' + $UploadId + ' to carry on from the wait.') }
    Start-Sleep -Seconds 2
  }
}

# The whole upload flow for one local archive: create the session, send the
# bytes, finalise, wait until it is available. Returns the upload id. $Said is
# called with a line for each step so the script can print it.
function Send-NexusUpload($Facts, [scriptblock]$Said, [int]$WaitSeconds = 600) {
  $limit = $script:NexusSinglePartMax
  # The harness lowers the line so it can drive a multipart upload with a small file.
  if ((Test-NexusStandIn) -and $env:THORNSWOOD_NEXUS_STANDIN_SINGLE_MAX) { $limit = [long]$env:THORNSWOOD_NEXUS_STANDIN_SINGLE_MAX }
  $disposition = 'attachment; filename="' + $Facts.Name + '"'
  if ($Facts.Size -le $limit) {
    $body = [ordered]@{ size_bytes = $Facts.Size; filename = $Facts.Name; md5 = $Facts.Md5Hex } | ConvertTo-Json -Compress
    $made = Invoke-NexusApi 'POST' '/v3/uploads' $body 'Starting the upload (POST /v3/uploads)'
    $d = Get-NexusField $made 'data'
    $id = [string](Get-NexusField $d 'id'); $url = [string](Get-NexusField $d 'presigned_url')
    if (-not $id -or -not $url) { throw 'Nexus started an upload but did not say its id and address, so nothing was sent.' }
    & $Said ('upload ' + $id + ' started, one part, md5 ' + $Facts.Md5Hex)
    $fs = [IO.File]::OpenRead($Facts.Path)
    try {
      $content = New-Object System.Net.Http.StreamContent($fs, 1048576)
      $content.Headers.ContentLength = $Facts.Size
      $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
      [void]$content.Headers.TryAddWithoutValidation('Content-Disposition', $disposition)
      [void]$content.Headers.TryAddWithoutValidation('Content-MD5', $Facts.Md5Base64)
      $r = Send-NexusPresigned 'PUT' $url $content ('Sending the archive for upload ' + $id)
    }
    finally { $fs.Dispose() }
    if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ('Nexus''s storage refused the archive for upload ' + $id + ': ' + (Format-NexusProblem $r)) }
    & $Said ('sent ' + $Facts.Size + ' bytes')
  }
  else {
    & $Said 'over 100 MiB, so it goes up in parts; working out its CRC-64/NVME'
    $crc = Get-NexusCrc64Nvme $Facts.Path
    $body = [ordered]@{ size_bytes = $Facts.Size; filename = $Facts.Name; crc64nvme = $crc } | ConvertTo-Json -Compress
    $made = Invoke-NexusApi 'POST' '/v3/uploads/multipart' $body 'Starting the upload (POST /v3/uploads/multipart)'
    $d = Get-NexusField $made 'data'
    $id = [string](Get-NexusField $d 'id')
    $partSize = [long](Get-NexusField $d 'part_size_bytes')
    $parts = @(Get-NexusField $d 'part_presigned_urls')
    $complete = [string](Get-NexusField $d 'complete_presigned_url')
    if (-not $id -or $partSize -le 0 -or -not $parts.Count -or -not $complete) { throw 'Nexus started a multipart upload but did not say its id, part size and addresses, so nothing was sent.' }
    $need = [long][Math]::Ceiling($Facts.Size / [double]$partSize)
    if ($need -ne $parts.Count) { throw ('Nexus gave ' + $parts.Count + ' part addresses for upload ' + $id + ', but ' + $Facts.Size + ' bytes in parts of ' + $partSize + ' is ' + $need + ' parts, so nothing was sent.') }
    # The CRC binds the complete address through its own signed query
    # (x-amz-checksum-crc64nvme, X-Amz-SignedHeaders=host), so storage checks
    # the whole file against it. Measured on 20 Oct: the spec says to send the
    # value as a header as well, but Nexus's storage (Cloudflare R2) answers
    # that with 403 SignatureDoesNotMatch, because the header is not signed.
    $bound = ''
    $q = ''
    if ($complete.Contains('?')) { $q = $complete.Substring($complete.IndexOf('?') + 1) }
    foreach ($kv in $q.Split('&')) {
      $eq = $kv.IndexOf('=')
      if ($eq -gt 0 -and $kv.Substring(0, $eq) -eq 'x-amz-checksum-crc64nvme') { $bound = [Uri]::UnescapeDataString($kv.Substring($eq + 1)) }
    }
    if ($bound -cne $crc) { throw ('Nexus''s complete address for upload ' + $id + ' is not bound to the archive''s CRC-64/NVME ' + $crc + ', so storage would not check the whole file. Nothing was sent.') }
    & $Said ('upload ' + $id + ' started, ' + $parts.Count + ' parts of up to ' + $partSize + ' bytes, crc64nvme ' + $crc)
    $etags = New-Object System.Collections.Generic.List[string]
    $fs = [IO.File]::OpenRead($Facts.Path)
    try {
      for ($i = 0; $i -lt $parts.Count; $i++) {
        $len = [long][Math]::Min($partSize, $Facts.Size - ($i * $partSize))
        $buf = New-Object byte[] $len
        [void]$fs.Seek($i * $partSize, [IO.SeekOrigin]::Begin)
        $got = 0
        while ($got -lt $len) { $n = $fs.Read($buf, [int]$got, [int]($len - $got)); if ($n -le 0) { throw ('The archive ended before part ' + ($i + 1) + ' was read; it changed while it was being sent.') }; $got += $n }
        $content = New-Object System.Net.Http.ByteArrayContent(, $buf)
        $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
        $r = Send-NexusPresigned 'PUT' ([string]$parts[$i]) $content ('Sending part ' + ($i + 1) + ' of upload ' + $id)
        if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ('Nexus''s storage refused part ' + ($i + 1) + ' of ' + $parts.Count + ' for upload ' + $id + ': ' + (Format-NexusProblem $r)) }
        if (-not $r.ETag) { throw ('Nexus''s storage took part ' + ($i + 1) + ' of upload ' + $id + ' but sent no ETag for it, so the parts cannot be put together.') }
        $etags.Add($r.ETag.Replace('"', ''))
        & $Said ('part ' + ($i + 1) + ' of ' + $parts.Count + ', ' + $len + ' bytes')
      }
    }
    finally { $fs.Dispose() }
    # The S3 complete document, the same shape the upload action writes.
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append("<CompleteMultipartUpload>`n")
    for ($i = 0; $i -lt $etags.Count; $i++) { [void]$sb.Append('  <Part>' + "`n" + '    <PartNumber>' + ($i + 1) + '</PartNumber>' + "`n" + '    <ETag>' + $etags[$i] + '</ETag>' + "`n" + '  </Part>' + "`n") }
    [void]$sb.Append('</CompleteMultipartUpload>')
    $content = New-Object System.Net.Http.ByteArrayContent(, ((New-Object Text.UTF8Encoding($false)).GetBytes($sb.ToString())))
    $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/xml')
    $r = Send-NexusPresigned 'POST' $complete $content ('Putting the parts of upload ' + $id + ' together')
    if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ('Nexus''s storage would not put the parts of upload ' + $id + ' together: ' + (Format-NexusProblem $r)) }
    & $Said ('the ' + $parts.Count + ' parts are one file')
  }
  [void](Invoke-NexusApi 'POST' ('/v3/uploads/' + $id + '/finalise') '' ('Finalising upload ' + $id))
  & $Said 'finalised; waiting for Nexus to process it'
  $asked = Wait-NexusUpload $id $WaitSeconds
  & $Said ('available, after ' + $asked + ' asks')
  return $id
}
