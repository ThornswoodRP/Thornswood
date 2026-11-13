<#
  test-dev-gamemode-discord.ps1

      pwsh -NoProfile -File .\tests\test-dev-gamemode-discord.ps1

  A dev gamemode deploy must carry a note and post it to the dev updates
  channel through Publish-Discord.ps1. Issue #594.

  Read only apart from dot-sourcing Publish-Discord.ps1's functions.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

Add-Type -Path (Join-Path $Repo 'tools/ReleaseNotes/NoteRules.cs')   # the release note rules (#5354)
function Shape([string]$n) { @([Thornswood.ReleaseNotes.NoteRules]::ShapeProblems($n)) }

$goodNote = @'
The door answers on the first knock
- The door no longer needs a second try before it opens.
'@.Trim()

Yes 'a good gamemode note passes shape and word rules' (
    @([Thornswood.ReleaseNotes.NoteRules]::AllProblems($goodNote)).Count -eq 0)
Yes 'a title alone is refused' ((Shape "Only a title here").Count -gt 0)
Yes 'a note with no detail line is refused' ((Shape "A title with three words`nno dash line").Count -gt 0)
Yes 'an empty note is refused' ((Shape '').Count -gt 0)

$deploy = Join-Path $Repo 'scripts\deploy\Deploy-DevGamemode.ps1'
$src = [IO.File]::ReadAllText($deploy)
$ast = [System.Management.Automation.Language.Parser]::ParseFile($deploy, [ref]$null, [ref]$null)
$params = @{}
foreach ($p in $ast.ParamBlock.Parameters) { $params[$p.Name.VariablePath.UserPath] = $p }

Yes 'Deploy-DevGamemode.ps1 takes -Note' ($params.ContainsKey('Note'))
Yes 'Deploy-DevGamemode.ps1 loads the release note rules' ($src -match "tools/ReleaseNotes/NoteRules\.cs" -and $src -match '\[Thornswood\.ReleaseNotes\.NoteRules\]::AllProblems\(\$Note\)')
Yes 'Deploy-DevGamemode.ps1 refuses an empty note before the box is touched' (
    $src -match 'if \(-not \$Note\.Trim\(\)\)' -and
    $src.IndexOf('if (-not $Note.Trim())') -lt $src.IndexOf('New-ThornswoodArtifact'))
# Deployed is a swap that answered, or a reload the server loaded (#3196).
Yes 'Deploy-DevGamemode.ps1 calls Publish-Discord after a successful swap or reload' (
    $src -match 'Publish-Discord\.ps1' -and
    $src -match '-GamemodeDeploy' -and
    $src.Contains("`$deployed = (`$outcome -eq 'reloaded') -or (`$outcome -eq 'swap' -and `$swapped)") -and
    $src.IndexOf('if ($deployed -and -not $PutBack)') -gt $src.IndexOf('Show-SwapResult'))
$postAt = $src.IndexOf('& $discord -Dev -Note $Note -GamemodeDeploy')
$guardAt = $src.IndexOf('if ($deployed -and -not $PutBack)')
Yes 'Deploy-DevGamemode.ps1 posts only inside the deployed and not PutBack guard' (
    $guardAt -ge 0 -and $postAt -gt $guardAt)

$pubPath = Join-Path $Repo 'scripts\ops\Publish-Discord.ps1'
$pub = [IO.File]::ReadAllText($pubPath)
Yes 'Publish-Discord.ps1 takes -Note and -GamemodeDeploy' (
    $pub -match '\[string\]\$Note' -and $pub -match '\[switch\]\$GamemodeDeploy')
Yes 'Publish-Discord.ps1 still reads the webhook through Discord-Hook.ps1 only' (
    $pub -match "Discord-Hook\.ps1" -and $pub -notmatch '\[string\]\$Webhook')

# Build the post without sending anything. The helpers sit between Prop and
# $Here in Publish-Discord.ps1; dot-sourcing the whole script would run it.
$fnStart = $pub.IndexOf('function Prop(')
$fnEnd = $pub.IndexOf('$Here = $PSScriptRoot')
$fnBlock = $pub.Substring($fnStart, $fnEnd - $fnStart)
. ([scriptblock]::Create($fnBlock))

$parts = Split-ThornswoodNote $goodNote
$text = Format-ThornswoodDiscordText $parts.Details $parts.Body @(Get-ThornswoodDiscordNoise)
Yes 'the note becomes bullet text for the embed' ($text -match '^- The door no longer needs')

$foot = 'dev server'
$title = $parts.Title
$split = Split-ThornswoodDiscordDescription $text
$embeds = @(@{
    author      = @{ name = 'Thornswood dev' }
    title       = $title
    description = $split.First
    footer      = @{ text = $foot }
})
$payload = (@{ username = 'Thornswood dev'; embeds = $embeds } | ConvertTo-Json -Depth 8)
Yes 'the built payload names Thornswood dev and footer dev server' (
    $payload -match 'Thornswood dev' -and $payload -match 'dev server' -and $payload -match 'first knock')
Yes 'a gamemode post does not prefix Dev build in the title' ($payload -notmatch 'Dev build:')

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit $(if ($script:fail) { 1 } else { 0 })
