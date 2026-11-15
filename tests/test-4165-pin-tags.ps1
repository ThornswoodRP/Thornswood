<#
  test-4165-pin-tags.ps1

      pwsh -NoProfile -File .\tests\test-4165-pin-tags.ps1

  Issue #4165. Each action pin carries its release tag in a comment, and
  tests\test-action-pins.ps1 holds that shape without fetching anything. Only
  GitHub can say whether the tag names that commit: upload-artifact's pin said
  v7 while its commit was v7.0.1. scripts\dev\Check-ActionPins.ps1 asks it
  each night. This runs that script against a stand-in GitHub:

    1. it reads every pin from workflows written in its own folder, both
       shapes of `uses:`, one entry per action, SHA and tag, with every
       place it is written, and the repository of a sub-action
       (github/codeql-action/init is github/codeql-action);
    2. a lightweight tag on the pinned commit passes;
    3. an annotated tag is followed to its commit, and passes;
    4. a tag on another commit is named, with the commit it is and every
       file and line that carries the pin;
    5. a tag the repository does not have (404) is named;
    6. any other failure stops the run, so a pin that was not read is never
       a pass;
    7. nightly.yml runs it with -Run and the run's token, every night.

  Nothing reaches GitHub. Writes only under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Check-ActionPins.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$have = Test-Path -LiteralPath $script
Yes 'scripts\dev\Check-ActionPins.ps1 is there' $have
if ($have) {
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4165-' + [Guid]::NewGuid().ToString('N'))
    $wf = Join-Path $work 'workflows'
    $null = New-Item -ItemType Directory -Path $wf
    try {
        . $script -WorkflowDir $wf

        $co = '3d3c42e5aac5ba805825da76410c181273ba90b1'
        $up = 'cf430e030ddbb5b0abf93d22962f4752f3646cd9'
        $ql = '33d7b85da1a04171e211befe2c739303b9a4c066'
        $nw = '0123456789abcdef0123456789abcdef01234567'
        $tagObj = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        [IO.File]::WriteAllText((Join-Path $wf 'a.yml'), ((
            'jobs:', '  one:', '    steps:',
            "      - uses: actions/checkout@$co # v7.0.1",
            '      - name: keep',
            "        uses: actions/upload-artifact@$up # v7.0.1",
            "      - uses: github/codeql-action/init@$ql # v4.39.3",
            '      - uses: ./.github/actions/ours') -join "`n"))
        [IO.File]::WriteAllText((Join-Path $wf 'b.yml'), ((
            'jobs:', '  one:', '    steps:',
            "      - uses: actions/checkout@$co # v7.0.1") -join "`n"))
        [IO.File]::WriteAllText((Join-Path $wf 'notes.txt'), "      - uses: actions/checkout@$nw # v9.9.9")

        $pins = @(Get-ActionPins)
        $c = @($pins | Where-Object { $_.Action -eq 'actions/checkout' })
        Yes ('1. every pin is read once, with every place it is written (' + (@($pins | ForEach-Object { $_.Action + ' ' + $_.Tag + ' ' + ($_.Where -join '+') }) -join '; ') + ')') (
            $pins.Count -eq 3 -and $c.Count -eq 1 -and ($c[0].Where -join ',') -eq 'a.yml:4,b.yml:4' -and $c[0].Repo -eq 'actions/checkout')
        Yes '   both shapes of uses, and a sub-action is read from its repository' (
            @($pins | Where-Object { $_.Action -eq 'actions/upload-artifact' -and $_.Where[0] -eq 'a.yml:6' }).Count -eq 1 -and
            @($pins | Where-Object { $_.Action -eq 'github/codeql-action/init' -and $_.Repo -eq 'github/codeql-action' }).Count -eq 1)

        # The stand-in GitHub: refs and tag objects by path; a path it does not
        # hold answers 404 the way Invoke-RestMethod throws it, and $script:Boom
        # makes every call fail with a 500.
        $script:Gh = @{}
        $script:Asked = New-Object System.Collections.ArrayList
        $script:Boom = $false
        function Invoke-PinApi([string]$Path) {
            [void]$script:Asked.Add($Path)
            $code = $(if ($script:Boom) { 500 } elseif ($script:Gh.ContainsKey($Path)) { 0 } else { 404 })
            if ($code) {
                $msg = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]$code)
                throw [Microsoft.PowerShell.Commands.HttpResponseException]::new(('stand-in GitHub answered ' + $code), $msg)
            }
            return $script:Gh[$Path]
        }
        function Ref($type, $sha) { [pscustomobject]@{ object = [pscustomobject]@{ type = $type; sha = $sha } } }

        $script:Gh['repos/actions/checkout/git/ref/tags/v7.0.1'] = Ref 'commit' $co
        $script:Gh['repos/actions/upload-artifact/git/ref/tags/v7.0.1'] = Ref 'tag' $tagObj
        $script:Gh["repos/actions/upload-artifact/git/tags/$tagObj"] = Ref 'commit' $up
        $script:Gh['repos/github/codeql-action/git/ref/tags/v4.39.3'] = Ref 'commit' $ql
        $bad = @(Find-PinMismatch $pins)
        Yes ('2. a lightweight tag on the pinned commit passes, and 3. an annotated one is followed to it (' + ($bad -join '; ') + ')') ($bad.Count -eq 0)
        Yes '   the annotated tag was read through its tag object' ($script:Asked -contains "repos/actions/upload-artifact/git/tags/$tagObj")

        $script:Gh["repos/actions/upload-artifact/git/tags/$tagObj"] = Ref 'commit' $nw
        $bad = @(Find-PinMismatch $pins)
        Yes ('4. a tag on another commit is named, with that commit and where the pin is (' + ($bad -join '; ') + ')') (
            $bad.Count -eq 1 -and $bad[0] -eq "actions/upload-artifact@$up says v7.0.1, and v7.0.1 is $nw (a.yml:6)")

        $script:Gh["repos/actions/upload-artifact/git/tags/$tagObj"] = Ref 'commit' $up
        $script:Gh.Remove('repos/actions/checkout/git/ref/tags/v7.0.1')
        $bad = @(Find-PinMismatch $pins)
        Yes ('5. a tag the repository does not have is named (' + ($bad -join '; ') + ')') (
            $bad.Count -eq 1 -and $bad[0] -eq "actions/checkout@$co says v7.0.1, and actions/checkout has no tag v7.0.1 (a.yml:4, b.yml:4)")

        $script:Boom = $true
        $threw = $false
        try { $null = Find-PinMismatch $pins } catch { $threw = $_.Exception.Message -match '500' }
        Yes '6. any other failure stops the run, never a pass' $threw
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- 7. the nightly runs it ------------------------------------------------------------
$y = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo '.github') 'workflows') 'nightly.yml')) -replace "`r`n", "`n"
$step = [regex]::Match($y, '(?s)\n      - name: Each action pin is the commit its tag names\n(.*?)(?=\n      - name: |\n  [a-z]+:\n|\z)')
Yes '7. nightly.yml has the step "Each action pin is the commit its tag names"' $step.Success
Yes '   in the nightly job, which runs on main only' ($step.Success -and $y.IndexOf($step.Value) -lt $y.IndexOf("`n  harnesses:"))
Yes '   it runs every night whatever failed before it, with the run''s token, and nothing else' (
    $step.Groups[1].Value -match 'if: \$\{\{ !cancelled\(\) \}\}' -and $step.Groups[1].Value -match 'GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}' -and
    $step.Groups[1].Value -match '(?m)^\s+\.\\scripts\\dev\\Check-ActionPins\.ps1 -Run\s*$' -and $step.Groups[1].Value -notmatch 'secrets\.(?!GITHUB_TOKEN)')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
