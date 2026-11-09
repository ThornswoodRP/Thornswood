<#
  test-release-asset-api.ps1

      pwsh -NoProfile -File .\tests\test-release-asset-api.ps1

  A site asset that a GitHub Release holds is read through the REST API's
  asset route, not GitHub's web download route.

  From 05:11 UTC on 9 Nov github.com answered 504 from its iad edge for every
  repository, measured from One, the VPS, the Oracle VM and a GitHub-hosted
  runner, while api.github.com served the same files. thornswood.net answers
  /feed[-dev]/assets/<sha256> with a redirect to github.com/<owner>/<repo>/
  releases/download/<tag>/<name> when a Release holds the file, and
  Get-FeedAssetFile followed it, so two merge releases stopped while staging
  dev's last release (Build-GameFiles.ps1, New-FeedRoot.ps1).

  What this proves, against a stand-in site on loopback and stand-ins for
  Invoke-RestMethod and Invoke-WebRequest (a function of the same name wins
  over the cmdlet), so nothing leaves the machine:
    1. a site that sends the bytes itself is read as before;
    2. a site that redirects to a Release's file never has the github.com
       address fetched: the Release is looked up by its tag (slashes and all),
       its assets are read page by page, and the file comes from
       /releases/assets/<id> as application/octet-stream;
    3. the Release is looked up once for many files;
    4. bytes that are not their sha256 are still refused, and a redirect to
       anywhere but a GitHub Release's file is refused, naming it.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

. (Join-Path $Repo 'scripts\release\Read-JsonFile.ps1')
. (Join-Path $Repo 'scripts\release\Release-Baseline.ps1')

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('release-asset-api-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
function Sha([byte[]]$b) { -join ([Security.Cryptography.SHA256]::HashData($b) | ForEach-Object { $_.ToString('x2') }) }

# Three files: one the site sends itself, two a Release holds, and one whose
# bytes the Release has wrong.
$own = [Text.Encoding]::UTF8.GetBytes('the site sends this one itself')
$a1 = [Text.Encoding]::UTF8.GetBytes('a file the Release holds')
$a2 = [Text.Encoding]::UTF8.GetBytes('another file the Release holds')
$bad = [Text.Encoding]::UTF8.GetBytes('the name says other bytes')
$ownSha = Sha $own; $a1Sha = Sha $a1; $a2Sha = Sha $a2
$badSha = Sha ([Text.Encoding]::UTF8.GetBytes('what the name promises'))
$tag = 'release/dev/20261102-120542-dev'
$byId = @{ 11 = $a1; 12 = $a2; 13 = $bad }
$asset = @{ $a1Sha = 11; $a2Sha = 12; $badSha = 13 }

# ---- the stand-in site --------------------------------------------------------
$listener = [Net.HttpListener]::new()
# A port the system says nothing holds (#1703).
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
$site = "http://127.0.0.1:$port"
$job = Start-ThreadJob -ArgumentList $listener, $ownSha, $own, $tag -ScriptBlock {
    param($l, $ownSha, $own, $tag)
    while ($l.IsListening) {
        try { $ctx = $l.GetContext() } catch { break }
        $name = $ctx.Request.Url.AbsolutePath.Split('/')[-1]
        if ($name -eq $ownSha) {
            $ctx.Response.StatusCode = 200
            $ctx.Response.OutputStream.Write($own, 0, $own.Length)
        } elseif ($name -eq 'elsewhere') {
            $ctx.Response.StatusCode = 302
            $ctx.Response.RedirectLocation = 'https://example.com/elsewhere'
        } else {
            $ctx.Response.StatusCode = 302
            $ctx.Response.RedirectLocation = 'https://github.com/ThornswoodRP/Thornswood/releases/download/' + $tag + '/' + $name
        }
        $ctx.Response.Close()
    }
}

# ---- stand-ins for GitHub's REST API -----------------------------------------
$script:asked = [Collections.Generic.List[string]]::new()
function Invoke-RestMethod {
    param([string]$Uri, $Headers)
    $script:asked.Add($Uri)
    if ($Uri -eq 'https://api.github.com/repos/ThornswoodRP/Thornswood/releases/tags/' + $tag) { return [pscustomobject]@{ id = 431863389 } }
    if ($Uri -like 'https://api.github.com/repos/ThornswoodRP/Thornswood/releases/431863389/assets?per_page=100&page=*') {
        $page = [int]($Uri -replace '.*page=', '')
        # Returned whole, as PowerShell 7's Invoke-RestMethod returns a JSON array.
        if ($page -eq 1) {
            $list = [Collections.Generic.List[object]]::new()
            foreach ($i in 1..99) { $list.Add([pscustomobject]@{ name = ('filler' + $i); id = 1000 + $i; state = 'uploaded' }) }
            $list.Add([pscustomobject]@{ name = $a1Sha; id = 11; state = 'uploaded' })
            return , $list.ToArray()
        }
        if ($page -eq 2) {
            return , @([pscustomobject]@{ name = $a2Sha; id = 12; state = 'uploaded' }, [pscustomobject]@{ name = $badSha; id = 13; state = 'uploaded' })
        }
        return , @()
    }
    throw "the stand-in API was asked for $Uri"
}
function Invoke-WebRequest {
    param([string]$Uri, $Headers, [string]$OutFile, [switch]$UseBasicParsing)
    $script:asked.Add($Uri)
    if ($Uri -like '*github.com/*/releases/download/*') { throw 'the web download route was fetched' }
    $m = [regex]::Match($Uri, '^https://api\.github\.com/repos/ThornswoodRP/Thornswood/releases/assets/(\d+)$')
    if (-not $m.Success -or [string]$Headers['Accept'] -ne 'application/octet-stream') { throw "the stand-in API was asked for $Uri" }
    [IO.File]::WriteAllBytes($OutFile, $byId[[int]$m.Groups[1].Value])
}

try {
    $f = Get-FeedAssetFile "$site/feed-dev/assets/$ownSha" $ownSha (Join-Path $tmp 'own') '' $site
    Yes '1. the bytes the site sends itself are read as before' ((Sha ([IO.File]::ReadAllBytes($f))) -eq $ownSha)
    Yes '   and GitHub is not asked' ($script:asked.Count -eq 0)

    $f1 = Get-FeedAssetFile "$site/feed-dev/assets/$a1Sha" $a1Sha (Join-Path $tmp 'a1') '' $site
    $f2 = Get-FeedAssetFile "$site/feed-dev/assets/$a2Sha" $a2Sha (Join-Path $tmp 'a2') '' $site
    Yes '2. a file a Release holds comes through the API, its sha256 checked' ((Sha ([IO.File]::ReadAllBytes($f1))) -eq $a1Sha)
    Yes '   from the second page of the Release''s assets too' ((Sha ([IO.File]::ReadAllBytes($f2))) -eq $a2Sha)
    Yes '   and the github.com download route is never fetched' (-not ($script:asked | Where-Object { $_ -like '*github.com/*/releases/download/*' }))
    Yes '   the Release is asked for by its tag, slashes and all' ($script:asked -contains ('https://api.github.com/repos/ThornswoodRP/Thornswood/releases/tags/' + $tag))
    $tags = @($script:asked | Where-Object { $_ -like '*/releases/tags/*' }).Count
    Yes ('3. the Release is looked up once for both files (' + $tags + ')') ($tags -eq 1)

    $said = ''
    try { [void](Get-FeedAssetFile "$site/feed-dev/assets/$badSha" $badSha (Join-Path $tmp 'bad') '' $site) } catch { $said = $_.Exception.Message }
    Yes '4. bytes that are not their sha256 are still refused' ($said -match 'is not the bytes its name says' -and -not (Test-Path -LiteralPath (Join-Path $tmp 'bad')))
    $said = ''
    try { Save-SiteAsset "$site/feed-dev/assets/elsewhere" (Join-Path $tmp 'elsewhere.part') } catch { $said = $_.Exception.Message }
    Yes '   a redirect to anything but a Release''s file is refused, naming it' ($said -match 'example\.com/elsewhere' -and $said -match 'not a GitHub Release')
}
finally {
    $listener.Stop()
    Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
