<#
  test-go-retired-overlays.ps1

      pwsh -NoProfile -File .\scripts\tests\test-go-retired-overlays.ps1

  Go.ps1 takes out of Data\Platform\UI every overlay of ours the repo no
  longer has, lists it as removed so its kept copy goes and the release
  deletes it from every install, and leaves everything else in that folder
  alone.

  WHY. The #3130 loading screen test put thornswood-loadscreen.js on dev on
  22 Oct. Its branch was pulled the same day, and the dev Ship from main that
  was to take it off said "0 removed": Go.ps1's overlays loop copies each of
  game\ui's scripts into the game folder Ship packs from and never took one
  out, and Ship-Rules counts any thornswood-* file there as ours, so the dead
  file would have stayed on every install for good. Measured on Nyx the same
  evening: D:\Thornswood-DevBuild\Game\Data\Platform\UI\thornswood-loadscreen.js
  was still there.

  HOW. Remove-RetiredOverlays is lifted out of Go.ps1 with PowerShell's own
  parser and run against a game folder made under a temp folder, with a
  stand-in game\ui. Go.ps1 is read, not run.
#>
[CmdletBinding()]
param([string]$Repo)
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$go = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'release') 'Go.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($go, [ref]$tokens, [ref]$errors)
Yes 'Go.ps1 parses' ($errors.Count -eq 0)
$funcs = @{}
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $funcs[$f.Name] = $f.Extent.Text }
Yes 'Go.ps1 has Remove-RetiredOverlays' ($funcs.ContainsKey('Remove-RetiredOverlays'))
if (-not $funcs.ContainsKey('Remove-RetiredOverlays')) { Done }
. ([ScriptBlock]::Create($funcs['Remove-RetiredOverlays']))

# ---- read from the script ---------------------------------------------------------
$goText = [IO.File]::ReadAllText($go)
$loop = $goText.IndexOf("foreach (`$f in Get-ChildItem -LiteralPath `$uiSrc -Filter *.js)")
$call = $goText.IndexOf('Remove-RetiredOverlays $ui $uiSrc')
Yes 'the overlays section calls it, after the overlays are copied in' ($loop -ge 0 -and $call -gt $loop)
$after = if ($call -ge 0) { $goText.Substring($call, [Math]::Min(400, $goText.Length - $call)) } else { '' }
Yes 'and lists what it took out as removed, so the kept copy goes too' ($after -match '\$script:removed\.Add\(\$r\)')
Yes 'and says so on the run' ($after -match 'removing an overlay the repo no longer has')
$keptCall = $goText.IndexOf('Update-KeptCopies $Game')
Yes 'the kept copies are refreshed after it' ($keptCall -gt $call)

# ---- run against a game folder ------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-retired-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    function Put-Text([string]$path, [string]$text) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
        [IO.File]::WriteAllText($path, $text)
    }
    $src = Join-Path $work 'game-ui'
    $ui = Join-Path (Join-Path (Join-Path (Join-Path $work 'Game') 'Data') 'Platform') 'UI'
    # The repo's overlays today.
    Put-Text (Join-Path $src 'thornswood-chat.js') 'chat'
    Put-Text (Join-Path $src 'thornswood-select.js') 'select'
    Put-Text (Join-Path $src 'index.html') 'page'
    # The game folder after the overlays loop: the same two, the retired
    # one, the launcher's character list, and what is not an overlay.
    Put-Text (Join-Path $ui 'thornswood-chat.js') 'chat'
    Put-Text (Join-Path $ui 'thornswood-select.js') 'select'
    Put-Text (Join-Path $ui 'thornswood-loadscreen.js') 'retired'
    Put-Text (Join-Path $ui 'thornswood-characters.js') 'one machine''s characters'
    Put-Text (Join-Path $ui 'index.html') 'page'
    Put-Text (Join-Path $ui 'build.js') 'front'
    Put-Text (Join-Path $ui 'thornswood-menu.jpg') 'painting'
    Put-Text (Join-Path $ui 'thornswood-theme.mp3') 'music'
    Put-Text (Join-Path $ui 'thornswood-ui-assets.txt') 'names'
    Put-Text (Join-Path $ui 'another-server.js') 'not ours'
    Put-Text (Join-Path (Join-Path $ui 'assets') 'thornswood-nested.js') 'nested'

    $gone = @(Remove-RetiredOverlays $ui $src)
    Yes 'the overlay the repo no longer has is taken out' (-not (Test-Path -LiteralPath (Join-Path $ui 'thornswood-loadscreen.js')))
    Yes 'and it is the one path returned' ($gone.Count -eq 1 -and (Split-Path -Leaf $gone[0]) -eq 'thornswood-loadscreen.js')
    Yes 'the repo''s overlays stay' ((Test-Path -LiteralPath (Join-Path $ui 'thornswood-chat.js')) -and (Test-Path -LiteralPath (Join-Path $ui 'thornswood-select.js')))
    Yes 'the launcher''s character list stays' (Test-Path -LiteralPath (Join-Path $ui 'thornswood-characters.js'))
    Yes 'the page and the front''s build stay' ((Test-Path -LiteralPath (Join-Path $ui 'index.html')) -and (Test-Path -LiteralPath (Join-Path $ui 'build.js')))
    Yes 'the painting, the music and the asset list stay' ((Test-Path -LiteralPath (Join-Path $ui 'thornswood-menu.jpg')) -and
        (Test-Path -LiteralPath (Join-Path $ui 'thornswood-theme.mp3')) -and (Test-Path -LiteralPath (Join-Path $ui 'thornswood-ui-assets.txt')))
    Yes 'a script that is not ours is left to the rules that deal with it' (Test-Path -LiteralPath (Join-Path $ui 'another-server.js'))
    Yes 'nothing in a folder under UI is touched' (Test-Path -LiteralPath (Join-Path (Join-Path $ui 'assets') 'thornswood-nested.js'))

    $again = @(Remove-RetiredOverlays $ui $src)
    Yes 'a second run takes nothing more' ($again.Count -eq 0)

    $none = @(Remove-RetiredOverlays (Join-Path $work 'no-such-folder') $src)
    Yes 'a game folder with no UI folder yet is no failure' ($none.Count -eq 0)
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
Done
