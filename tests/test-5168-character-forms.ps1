<#
  test-5168-character-forms.ps1

      pwsh -NoProfile -File .\tests\test-5168-character-forms.ps1

  Issue #5168. The engine names a change form's file after its form desc
  (FormDesc::ToString('_') in the fork): a form made in the world is its
  local id in lowercase hex with no plugin (%x), so 0xff00001f is 1f.json.
  Reset-Character.ps1, Wipe-Saves.ps1, New-Character.ps1 and
  Reset-Appearance.ps1 took a change form as a character when its name was
  digits alone, so a character whose id has a letter was left out, and the
  world's own runtime forms named with digits (an NPC the server made,
  profileId -1) were taken in. Restore-Backup.ps1 -CheckOnly counted
  characters by the same digits rule. Now all of them use one rule,
  Get-ThornswoodCharacterForms in scripts\ops\Release-List.ps1: a runtime
  form's hex name, a profileId above 0, and not deleted.

    F  the rule itself: characters named 0, a and 1f are found, in id
       order; a runtime form of the world's, a deleted slot, a plugin's form
       and a name that is not the engine's (upper case) are not; a form that
       will not parse is named with what the caller does with it; a folder
       that is not there is nobody
    A  Reset-Appearance.ps1, run for real: -ProfileId finds the character
       in 1f.json, and -All clears every character and leaves the world's
       own runtime form as it was
    G  no script picks change forms by digits alone any more, and
       Restore-Backup.ps1 -CheckOnly reads hex names

  The resets and the wipe themselves are run in
  tests\test-2668-reset-wipe-release.ps1 (R13 to R15, W6c), and New-Character
  in launcher\tests\test-2673-new-character-release.ps1 (N18, N19).

  Nothing leaves this machine. The scratch folder goes at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$ListPs = Join-Path $Repo 'scripts\ops\Release-List.ps1'
$AppearancePs = Join-Path $Repo 'scripts\ops\Reset-Appearance.ps1'
$BackupPs = Join-Path $Repo 'scripts\vps\Restore-Backup.ps1'

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
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body)
}
function Leaf($paths) { return ((@($paths) | ForEach-Object { Split-Path -Leaf $_ }) -join ',') }

. $ListPs
. ([scriptblock]::Create($ThornswoodReleaseList))

$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-5168-' + [Guid]::NewGuid().ToString('N'))
try {
    # ---- F: the rule --------------------------------------------------------------
    $w = Join-Path $T 'world\changeForms'
    Put (Join-Path $w '0.json') '{"formDesc":"0","profileId":5001,"appearanceDump":{"name":"A"}}'
    Put (Join-Path $w 'a.json') '{"formDesc":"a","profileId":5002,"appearanceDump":{"name":"B"}}'
    Put (Join-Path $w '1f.json') '{"formDesc":"1f","profileId":5004,"appearanceDump":{"name":"C"}}'
    # The world's own: an NPC the server made, a deleted character's slot,
    # a plugin's form, and a name the engine never writes.
    Put (Join-Path $w '10.json') '{"formDesc":"10","profileId":-1,"appearanceDump":{"name":"Guard"}}'
    Put (Join-Path $w 'c.json') '{"formDesc":"c","profileId":-1,"isDeleted":true}'
    Put (Join-Path $w '13164_JKs Whiterun.esp.json') '{"formDesc":"13164:JKs Whiterun.esp","profileId":-1}'
    Put (Join-Path $w 'B.json') '{"formDesc":"b","profileId":5009}'
    $got = Get-ThornswoodCharacterForms $w
    $names = Leaf $got.files
    Yes ('F1 the characters named 0, a and 1f are found, in id order (' + $names + ')') ($names -eq '0.json,a.json,1f.json')
    Yes 'F2 the world''s runtime form, a deleted slot, a plugin''s form and an upper case name are not' (
        $names -notmatch '10\.json|c\.json|13164|B\.json')
    Yes 'F3 with nothing unread, nothing is said' (@($got.notes).Count -eq 0)

    Put (Join-Path $w '3.json') '{"formDesc":"3'
    $got = Get-ThornswoodCharacterForms $w 'a reset leaves it where it is'
    Yes ('F4 a form that will not parse is named with what the caller does with it (' + (@($got.notes) -join ' / ') + ')') (
        @($got.notes).Count -eq 1 -and "$($got.notes[0])" -like 'RELEASENOTE|*3.json will not parse, so whether it is a character is not known; a reset leaves it where it is' -and
        (Leaf $got.files) -eq '0.json,a.json,1f.json')
    Remove-Item -LiteralPath (Join-Path $w '3.json') -Force

    $none = Get-ThornswoodCharacterForms (Join-Path $T 'not-there')
    Yes 'F5 a folder that is not there is nobody, said quietly' (@($none.files).Count -eq 0 -and @($none.notes).Count -eq 0)

    # ---- A: Reset-Appearance, for real ------------------------------------------------
    function Run([string[]]$arg) {
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $out = @(& pwsh -NoProfile -NonInteractive -File $AppearancePs @arg 2>&1 | ForEach-Object { "$_" })
            return @{ out = $out; code = $LASTEXITCODE }
        }
        finally { $ErrorActionPreference = $eap }
    }
    function Face([string]$name) {
        $o = [IO.File]::ReadAllText((Join-Path $w $name)) | ConvertFrom-Json
        return $o.appearanceDump
    }
    $x = Run @('-World', $w, '-ProfileId', '5004')
    Yes ('A1 -ProfileId finds the character in 1f.json and clears its appearance (' + (($x.out | Where-Object { $_ }) -join ' / ') + ')') (
        $x.code -eq 0 -and $null -eq (Face '1f.json') -and $null -ne (Face '0.json') -and $null -ne (Face 'a.json'))
    $x = Run @('-World', $w, '-All')
    Yes ('A2 -All clears every character and leaves the world''s own runtime form as it was (' + (($x.out | Where-Object { $_ }) -join ' / ') + ')') (
        $x.code -eq 0 -and $null -eq (Face '0.json') -and $null -eq (Face 'a.json') -and (Face '10.json').name -eq 'Guard' -and
        -not (Test-Path -Path (Join-Path $w '10.json.bak-*')))

    # ---- G: nothing picks by digits alone ---------------------------------------------
    $digits = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Include '*.ps1', '*.js' |
                Where-Object { [IO.File]::ReadAllText($_.FullName) -match 'BaseName -c?i?(not)?match ''\^(\\d|\[0-9\])\+`?\$''' } |
                ForEach-Object { $_.FullName.Substring($Repo.Length + 1) })
    Yes ('G1 no script takes a change form by a name of digits alone (' + ($digits -join ', ') + ')') ($digits.Count -eq 0)
    $b = [IO.File]::ReadAllText($BackupPs)
    Yes 'G2 Restore-Backup.ps1 -CheckOnly reads change forms by their hex names, case kept' (
        $b.Contains("-cnotmatch '^game[/\\]world[/\\]changeForms[/\\][0-9a-f]{1,8}\.json$'") -and
        $b -notmatch 'changeForms\[/\\\\\]\[0-9\]\+')
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}
Done
