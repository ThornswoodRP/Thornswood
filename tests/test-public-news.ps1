<#
  test-public-news.ps1

  What a stranger reads on the site's News page.

  Entry 187 on the To Do List, "The public news feed is a developer
  changelog": "Patch notes people read are short and about what they will
  notice: lockpicking works, locks are back. The front page currently shows
  strangers a 403 and a load order index".

  MEASURED 24 SEPTEMBER. The newest entry in this repo's version.json was one
  Publish-Server wrote on 20 September. Its body was "The server at" the VPS
  address "was reinstalled and is answering", and two of its three details
  were "The gamemode was rebuilt: starting kits, creation and arrival points
  live in it" and "Load order: 60 plugins server side". They reached the site.

  The site writes its News page itself since #5187 (site/server.js, "news
  from the Release"); tests\test-5187-site-news.js drives its cleaning over
  feeds in those shapes. This reads Publish-Server.ps1 and checks those lines
  are no longer written at all, and that Publish-Discord strips every kind of
  line the site's page strips, because its comment says they are the same
  list.

  -Repo runs it against another copy of the scripts.

  Read only.
#>
[CmdletBinding()]
param([string]$Repo)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- Publish-Server no longer writes them ------------------------------------
# It needs the VPS to run, so its source is read instead: every place it adds
# to the details, and every place it sets the body.
$psPath = Join-Path $Repo 'scripts\release\Publish-Server.ps1'
$tk = $null; $er = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($psPath, [ref]$tk, [ref]$er)
Yes 'Publish-Server.ps1 parses' (@($er).Count -eq 0)
$assigns = @($ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true))
$toDetails = @($assigns | Where-Object { $_.Left.Extent.Text -eq '$details' -and [string]$_.Operator -eq 'PlusEquals' })
Yes ("Publish-Server adds to the details in {0} places, so there is something to read" -f $toDetails.Count) ($toDetails.Count -ge 2)
Yes 'none of them is a load order count' (-not ($toDetails | Where-Object { $_.Right.Extent.Text -match '(?i)load order' }))
Yes 'none of them says the gamemode was rebuilt' (-not ($toDetails | Where-Object { $_.Right.Extent.Text -match '(?i)gamemode was rebuilt' }))
Yes 'the line people do want is still written' (@($toDetails | Where-Object { $_.Right.Extent.Text -match 'Nothing to download for this one' }).Count -eq 1)
$toBody = @($assigns | Where-Object { $_.Left.Extent.Text -eq '$body' })
Yes 'Publish-Server sets a body' ($toBody.Count -ge 1)
Yes 'no body it sets carries the VPS address or says it was reinstalled' (-not ($toBody | Where-Object { $_.Right.Extent.Text -match '(?i)VpsHost|reinstalled and is answering' }))

# ---- Publish-Discord strips what the site's News page strips -----------------
$t = $null; $e = $null
$a = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\ops\Publish-Discord.ps1'), [ref]$t, [ref]$e)
# Publish-Discord keeps its list in Get-ThornswoodDiscordNoise.
$fn = $a.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Get-ThornswoodDiscordNoise' }, $true)
$discordNoise = @(if ($fn) { $fn.Body.FindAll({ param($x) $x -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | ForEach-Object { $_.Value } })
# The site's list, NEWS_NOISE in server.js, one /pattern/i each.
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$server = Get-SiteSource (Join-Path $Repo 'site')
$m = [regex]::Match($server, '(?s)const NEWS_NOISE = \[(.*?)\];')
$newsNoise = @(if ($m.Success) { [regex]::Matches($m.Groups[1].Value, '/((?:\\/|[^/])+)/i') | ForEach-Object { $_.Groups[1].Value -replace '(?<!\\)\\/', '/' } })
Yes ("the site's News page strips {0} kinds of line, the load order and the gamemode among them" -f $newsNoise.Count) (($newsNoise -contains '^\s*Load order\s*:') -and ($newsNoise -contains '^\s*The gamemode was rebuilt\b'))
$missing = @($newsNoise | Where-Object { $discordNoise -notcontains $_ })
foreach ($x in $missing) { Write-Host ('      Publish-Discord does not strip: ' + $x) }
Yes 'Publish-Discord strips every one of them too, as its comment says' ($missing.Count -eq 0)

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit $(if ($script:fail) { 1 } else { 0 })
