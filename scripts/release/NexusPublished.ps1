<#
  NexusPublished.ps1

  The newest published revision of a Nexus collection, as Nexus says it now
  (#4068).

      $n = & .\scripts\release\NexusPublished.ps1 -Slug 7essxf

  Returns the revision number, a whole number of 1 or more. Throws a sentence
  when Nexus does not answer, refuses, or names no published revision, so a
  caller never takes "unknown" for a number.

  The newest published revision is public on Nexus: the same GraphQL read
  Check-Outside.ps1 makes, with no API key. So this sends none, and runs on any
  machine that Ships, a developer's PC with no Nexus key included. It goes to
  Nexus.ps1's address, which is the harness's stand-in on this machine's
  loopback when THORNSWOOD_NEXUS_STANDIN is set and Nexus itself otherwise,
  with the Application-Name and Application-Version Nexus asks every caller
  for.

  A harness that runs a whole Ship or Publish-Update.ps1 in a copy of the
  repository puts its own NexusPublished.ps1 there in place of this one
  (tests\fixtures\collection-revision.ps1), so no harness asks Nexus.

  Runs in PowerShell 7.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Slug,
    [string]$Game = 'skyrimspecialedition'
)
$ErrorActionPreference = 'Stop'
if ($Slug -notmatch '^[A-Za-z0-9]+$') { throw "'$Slug' is not a collection slug." }
if ($Game -notmatch '^[a-z0-9]+$') { throw "'$Game' is not a Nexus game domain." }
. (Join-Path $PSScriptRoot 'Nexus.ps1')

$what = 'Asking Nexus for the newest published revision of collection ' + $Slug
$q = '{ collection(slug: "' + $Slug + '", domainName: "' + $Game + '") { latestPublishedRevision { revisionNumber } } }'
$body = [ordered]@{ query = $q } | ConvertTo-Json -Compress
$req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, ((Get-NexusBase) + '/v2/graphql'))
[void]$req.Headers.TryAddWithoutValidation('Application-Name', $script:NexusAppName)
[void]$req.Headers.TryAddWithoutValidation('Application-Version', (Get-NexusAppVersion))
[void]$req.Headers.TryAddWithoutValidation('Accept', 'application/json')
$req.Content = New-Object System.Net.Http.StringContent($body, (New-Object Text.UTF8Encoding($false)), 'application/json')
try { $r = Send-NexusRequest (Get-NexusClient) $req $what } finally { $req.Dispose() }
if ($r.Code -lt 200 -or $r.Code -ge 300) { throw ($what + ' was refused: ' + (Format-NexusProblem $r)) }
$j = $null
try { $j = $r.Body | ConvertFrom-Json } catch { throw ($what + ' got an answer that is not JSON.') }
$errs = @(@(Get-NexusField $j 'errors') | Where-Object { $_ })
if ($errs.Count) { throw ($what + ' was refused: ' + ((@($errs | ForEach-Object { Get-NexusField $_ 'message' })) -join '; ')) }
$raw = Get-NexusField (Get-NexusField (Get-NexusField (Get-NexusField $j 'data') 'collection') 'latestPublishedRevision') 'revisionNumber'
$n = 0
if ($null -eq $raw -or $raw -is [bool] -or $raw -is [string] -or -not [int]::TryParse([string]$raw, [ref]$n) -or $n -lt 1) {
    throw ($what + ': Nexus named no published revision.')
}
return $n
