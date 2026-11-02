<#
  test-install-ship-channel.ps1

      pwsh -NoProfile -File .\tests\test-install-ship-channel.ps1

  Install-Thornswood.ps1 never Ships live (#1171).

  Its publish block calls Ship.ps1 with only the parameters Ship actually has.
  Before this fix it passed Root and NoPause and never Channel, so Ship used
  its default Channel=main (the live release). docs/guide/release-to-dev.md sends every
  ordinary change to the dev build first.

  This harness reads Install-Thornswood.ps1 and holds that:
    - the publish block sets shipArgs Channel to dev when Ship has Channel
    - it never sets Channel to main
    - the recovery note names Ship.ps1 -Channel dev
  It does not run Install or Ship.
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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

$install = Join-Path $Repo 'scripts\dev\Install-Thornswood.ps1'
Yes 'Install-Thornswood.ps1 is there' (Test-Path -LiteralPath $install)

$tok = $null; $errs = $null
[void][Management.Automation.Language.Parser]::ParseFile($install, [ref]$tok, [ref]$errs)
Yes 'Install-Thornswood.ps1 parses' ($errs.Count -eq 0)

$text = [IO.File]::ReadAllText($install)

$pubPat = '(?s)\$ship\s*=\s*Join-Path \$Here ''\.\.\\release\\Ship\.ps1''.+?elseif \(-not \$NoShip'
$pub = [regex]::Match($text, $pubPat)
Yes 'the publish block that calls Ship is still there' $pub.Success
$block = if ($pub.Success) { $pub.Value } else { '' }

# Exact line Install-Thornswood must carry (spaces as written).
$channelLine = 'if ($shipCmd.Parameters.ContainsKey(''Channel'')) { $shipArgs[''Channel''] = ''dev'' }'
Yes 'shipArgs sets Channel to dev when Ship has Channel' ($block.Contains($channelLine))
Yes 'shipArgs never sets Channel to main' (-not $block.Contains('$shipArgs[''Channel''] = ''main''') -and -not $block.Contains('$shipArgs["Channel"] = "main"'))
Yes 'the Ship call still splatters shipArgs' ($block.Contains('& $ship $Notes @shipArgs'))
Yes 'the recovery note names Ship.ps1 -Channel dev' ($text.Contains('Ship.ps1 -Channel dev'))
Yes 'nothing in Install-Thornswood passes -Channel main' (
    (-not $text.Contains('-Channel main')) -and (-not $text.Contains("Channel'] = 'main'")) -and (-not $text.Contains('Channel"] = "main"'))
)

# Red when the Channel line is taken out.
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-install-ship-ch-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
try {
    $bad = $text.Replace($channelLine, '')
    $badPath = Join-Path $scratch 'Install-Thornswood.ps1'
    [IO.File]::WriteAllText($badPath, $bad)
    $badBlock = [regex]::Match($bad, $pubPat).Value
    Yes 'a copy with the Channel line taken out would fail this harness' (-not $badBlock.Contains($channelLine))
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Done