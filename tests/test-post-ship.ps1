<#
  test-post-ship.ps1

      pwsh -NoProfile -File .\tests\test-post-ship.ps1

  What follows a published tip: Publish-PostShip.ps1, the one script Ship.ps1
  calls after the release is on the feed, and the two scripts it calls in turn,
  the website lane's scripts\deploy\Remirror-Site-Feed.ps1. VirusTotal is no
  longer part of publish (#802); Publish-VirusTotal.ps1 stays as a manual tool.

  WHY THIS EXISTS. Ship ended at "Everyone in the world has five minutes" while
  two things it had never done were left to somebody remembering: the site feed
  a launcher polls held whatever was last copied there by hand, and the
  site feed a launcher polls still held whatever was last copied there by hand.

  WHAT IT WATCHES FOR, beyond that the wiring is there.

    - Publish-PostShip.ps1 implements neither half. It is checked for making the
      two calls the lanes pinned, by their own paths, so a later session cannot
      quietly grow a third copy of a remirror in here.
    - There is no launcher step after the tip. The Launcher lane answered on
      27 September that the tip customers get is version.json and launchers poll
      the feed url in it, so the remirror is how a launcher update reaches
      anybody, and Ship's mid-release Install-Launcher.ps1 refreshes the install
      on the machine that shipped. This fails if a launcher step is ever added
      after the publish, and it checks the mid-release one is still there,
      before the publisher: the built launcher with the root and the build
      output. The second, the feed's launcher a kept-launcher -Package Ship
      put in the root (#2661), went with -Package (#4824).
    - Ship runs the helper once, inside a block a dry run never
      reaches, so a dry run cannot touch the VPS or the site.
    - The remirror call sits after the publisher and before the Discord post,
      in the order the website lane pinned: the remirror, then the Discord
      post and the server countdown, because those tell people to update and
      the feed has to be serving the release before that. (The site's News
      page is not sent: the site writes it from the feed, #5187.)
    - Nothing after the tip can fail the release. A script another lane has not
      landed is a line, a remirror that refuses is a line, and Ship still exits
      0: "Exit 1 = refused publish (do not fail the release)".
    - A failure leaves the release published and makes Ship exit non-zero, which
      is the standing order that the follow-ons go out with the tip.
    - The helper reads each half's exit code, runs the second half even when the
      first stopped, says which line puts a failed half right, and treats a half
      that is not on the machine as a failure rather than a quiet pass.

  Read only apart from files under its own temp folder. Nothing here reaches the
  network: the halves it drives are stand-ins that write a line and hand back the
  code they are told to.
#>
[CmdletBinding()]
param([string]$ScriptsPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptsPath) { $ScriptsPath = Join-Path (Split-Path -Parent $Here) 'scripts' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($script:T) { $what = $what.Replace($script:T, '<temp>') }
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$Utf8 = New-Object Text.UTF8Encoding($false)
$IfAst = [System.Management.Automation.Language.IfStatementAst]
$CmdAst = [System.Management.Automation.Language.CommandAst]

function Parse([string]$path) {
    $t = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
    return [pscustomobject]@{ Ast = $ast; Tokens = @($t); Errors = @($e) }
}

# Every if clause a node sits inside, from the inside out. The clause and not
# just the if: something called in the else of "if ($SkipPostShip)" is held back
# by that switch, and the same call in its then branch would be the opposite.
function Conditions($node) {
    $out = @()
    $prev = $node
    $p = $node.Parent
    while ($p) {
        if ($p -is $IfAst) {
            foreach ($c in $p.Clauses) {
                if ([object]::ReferenceEquals($c.Item2, $prev)) { $out += $c.Item1.Extent.Text }
            }
            if ($p.ElseClause -and [object]::ReferenceEquals($p.ElseClause, $prev)) {
                $out += ('else of: ' + (@($p.Clauses | ForEach-Object { $_.Item1.Extent.Text }) -join ' and '))
            }
        }
        $prev = $p
        $p = $p.Parent
    }
    return $out
}

# ---- the helper itself -----------------------------------------------------
$HelperPath = Join-Path $ScriptsPath 'release\Publish-PostShip.ps1'
Yes 'Publish-PostShip.ps1 is in scripts\release' (Test-Path -LiteralPath $HelperPath)
if (-not (Test-Path -LiteralPath $HelperPath)) { Done }
$helper = Parse $HelperPath
Yes '  it parses' ($helper.Errors.Count -eq 0)
$help = $helper.Ast.GetHelpContent()
Yes '  and says what it is for, where Get-Help reads it' ($null -ne $help -and [bool]([string]$help.Synopsis).Trim())
$declared = @()
if ($helper.Ast.ParamBlock) { $declared = @($helper.Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
$documented = @()
if ($help) {
    foreach ($k in $help.Parameters.Keys) {
        if (([string]$help.Parameters[$k]).Trim()) { $documented += $k.ToUpperInvariant() }
    }
}
$missing = @($declared | Where-Object { $documented -notcontains $_.ToUpperInvariant() })
Yes ("  and every one of its $($declared.Count) parameter(s) has a .PARAMETER" +
     $(if ($missing.Count) { ': ' + ($missing -join ', ') + ' do not' } else { '' })) ($declared.Count -gt 0 -and $missing.Count -eq 0)
foreach ($p in 'Channel', 'Only', 'NoPause') {
    Yes "  and it takes -$p" ($declared -contains $p)
}
foreach ($p in 'SkipRemirror', 'SkipVirusTotal') {
    Yes "  and no -$p, because no release leaves a half out" ($declared -notcontains $p)
}
Yes '  and no -FeedDir of any kind: the remirror works its own clone out' (
    @($declared | Where-Object { $_ -match 'FeedDir|ReleaseDir' }).Count -eq 0)

$helperSrc = [IO.File]::ReadAllText($HelperPath, $Utf8)
# The two lines the lanes pinned, as they pinned them. Both paths are relative to
# scripts\release, where this helper and Ship both live, so they are the same
# call either would make.
Yes '  it calls the website lane''s remirror by its pinned path, with -Dev:$Dev' (
    $helperSrc -match "Join-Path \`$Here '\.\.\\deploy\\Remirror-Site-Feed\.ps1'" -and
    $helperSrc -match '& \$remirror -Dev:\$Dev')
Yes '  and does not invoke Publish-VirusTotal as part of remirror' (
    $helperSrc -notmatch '(?m)& \$upload -Path')
Yes '  and does not talk to the VPS or VirusTotal itself' (
    $helperSrc -notmatch '(?m)^\s*&\s*ssh\b' -and $helperSrc -notmatch '(?m)^\s*&\s*scp\b' -and
    $helperSrc -notmatch 'virustotal\.com/api')

# ---- the remirror script, when it is on the branch -------------------------
$mirrorPath = Join-Path $ScriptsPath 'deploy\Remirror-Site-Feed.ps1'
if (Test-Path -LiteralPath $mirrorPath) {
    $m = Parse $mirrorPath
    Yes 'the website lane''s Remirror-Site-Feed.ps1 parses' ($m.Errors.Count -eq 0)
    $mp = @()
    if ($m.Ast.ParamBlock) { $mp = @($m.Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
    Yes '  and takes the -Dev and -FeedDir this helper gives it' (($mp -contains 'Dev') -and ($mp -contains 'FeedDir'))
} else {
    Write-Host 'SKIP  scripts\deploy\Remirror-Site-Feed.ps1 is not on this branch yet (website lane, pull request #730)'
}
$vtPath = Join-Path $ScriptsPath 'release\Publish-VirusTotal.ps1'
if (Test-Path -LiteralPath $vtPath) {
    $v = Parse $vtPath
    Yes 'the installer lane''s Publish-VirusTotal.ps1 parses' ($v.Errors.Count -eq 0)
    $vp = @()
    if ($v.Ast.ParamBlock) { $vp = @($v.Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
    Yes '  and takes the -Path this helper gives it' ($vp -contains 'Path')
} else {
    Write-Host 'SKIP  scripts\release\Publish-VirusTotal.ps1 is not on this branch yet (installer lane, pull request #734)'
}

# There is no launcher script after the tip, and this is the check that keeps it
# that way.
Yes 'there is no post-tip launcher script' (
    -not (Test-Path -LiteralPath (Join-Path $ScriptsPath 'release\Update-Launcher.ps1')))

# ---- Ship's wiring ---------------------------------------------------------
$ShipPath = Join-Path $ScriptsPath 'release\Ship.ps1'
Yes 'Ship.ps1 is there' (Test-Path -LiteralPath $ShipPath)
if (-not (Test-Path -LiteralPath $ShipPath)) { Done }
$ship = Parse $ShipPath
Yes '  Ship.ps1 parses' ($ship.Errors.Count -eq 0)
$shipSrc = [IO.File]::ReadAllText($ShipPath, $Utf8)
$shipDeclared = @($ship.Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
# No switch turns either half off, asked for by the website and launcher lanes so
# that every release exercises the block and dev exercises it often. A -Skip on
# Ship would be the thing somebody reaches for on the release where it matters.
foreach ($sw in 'SkipRemirror', 'SkipVirusTotal', 'SkipPostShip', 'SkipLauncherUpdate') {
    Yes "  Ship has no -$sw" ($shipDeclared -notcontains $sw)
}

# Two post-publish calls, both through Invoke-PostShip, which is what reads an
# exit code and remembers a failure. Named in a Say line is not running it, so
# the AST is read for the calls rather than the file for the name.
$allCalls = @($ship.Ast.FindAll({ param($n) $n -is $CmdAst -and $n.GetCommandName() -eq 'Invoke-PostShip' }, $true))
# Since 6 Oct a second one, on main only, moves the dev feed's DEV marks after
# the remirror (Refresh-DevNews.ps1, tests\test-dev-news-refresh.ps1). It is
# not a remirror and not a launcher step; anything else is a third call.
$marksCall = @($allCalls | Where-Object { $_.Extent.Text -match "'Refresh-DevNews\.ps1'" })
# Since 22 Oct a third, on main only, closes the Done issues the release
# carries, after the tag, with the commit the release record names
# (Close-ShippedIssues.ps1, tests\test-3279-close-shipped.ps1, #3279).
$closeCall = @($allCalls | Where-Object { $_.Extent.Text -match "'Close-ShippedIssues\.ps1'" -and $_.Extent.Text -notmatch 'Dev = \$true' })
# Since 1 Nov a fourth, on dev only, writes the Dev test tasks the dev
# release carries, with the same script and -Dev (#5199).
$devTaskCall = @($allCalls | Where-Object { $_.Extent.Text -match "'Close-ShippedIssues\.ps1'" -and $_.Extent.Text -match 'Dev = \$true' })
$calls = @($allCalls | Where-Object { $_.Extent.Text -notmatch "'(Refresh-DevNews|Close-ShippedIssues)\.ps1'" })
Yes ("  Ship has one Invoke-PostShip call for the remirror ({0})" -f $calls.Count) ($calls.Count -eq 1)
Yes ("  and one for the dev feed's DEV marks, main only, never on a dry run ({0})" -f $marksCall.Count) (
    $marksCall.Count -eq 1 -and @(Conditions $marksCall[0] | Where-Object { $_ -match '-not \$Dev\b' }).Count -gt 0 -and
    @(Conditions $marksCall[0] | Where-Object { $_ -match '-not \$DryRun\b' }).Count -gt 0)
Yes ("  and one closing the Done issues it carries, main only, never on a dry run, after the tag ({0})" -f $closeCall.Count) (
    $closeCall.Count -eq 1 -and @(Conditions $closeCall[0] | Where-Object { $_ -match '-not \$Dev\b' }).Count -gt 0 -and
    @(Conditions $closeCall[0] | Where-Object { $_ -match '-not \$DryRun\b' }).Count -gt 0 -and
    $closeCall[0].Extent.Text -match 'Commit = \$tagged\.Commit' -and
    $closeCall[0].Extent.StartOffset -gt $shipSrc.IndexOf('$tagged = Add-ReleaseTag'))
Yes ("  and one writing the Dev test tasks it carries, dev only, never on a dry run, after the tag, with the release's name ({0})" -f $devTaskCall.Count) (
    $devTaskCall.Count -eq 1 -and @(Conditions $devTaskCall[0] | Where-Object { $_ -match '-not \$DryRun\b' -and $_ -match '-and \$Dev\b' }).Count -gt 0 -and
    $devTaskCall[0].Extent.Text -match 'Commit = \$tagged\.Commit' -and $devTaskCall[0].Extent.Text -match 'Build = \$devName' -and
    $devTaskCall[0].Extent.StartOffset -gt $shipSrc.IndexOf('$tagged = Add-ReleaseTag'))
$atPublish = $shipSrc.IndexOf("& (Join-Path `$Here 'Publish-Update.ps1') @pubArgs")
$atNews = $shipSrc.IndexOf("'..\ops\Publish-Discord.ps1'")
$atAnnounce = $shipSrc.IndexOf("'..\vps\Request-Restart.ps1'")
$mirrorCall = @($calls | Where-Object { $_.Extent.Text -match "Only = 'Remirror'" })
$vtCall = @($calls | Where-Object { $_.Extent.Text -match "Only = 'VirusTotal'" })
Yes '  one for the remirror and none for VirusTotal' ($mirrorCall.Count -eq 1 -and $vtCall.Count -eq 0)
if ($mirrorCall.Count -eq 1) {
    $call = $mirrorCall[0]
    Yes '  the remirror runs Publish-PostShip.ps1' ($call.Extent.Text.Contains('Publish-PostShip.ps1'))
    $conds = @(Conditions $call)
    Yes ("    inside a block a dry run never reaches" + $(if ($conds.Count) { ' (' + ($conds -join ' / ') + ')' } else { '' })) (
        @($conds | Where-Object { $_ -match '-not \$DryRun\b' }).Count -gt 0)
    Yes '    and behind nothing else' ($conds.Count -eq 1)
}
Yes '  both are given the channel it shipped' ($shipSrc -match '\$postArgs = @\{[^\r\n]*Channel = \$chan')
Yes '  and the install and the staging folder' (
    $shipSrc -match '\$postArgs = @\{[^\r\n]*Root = \$Root' -and $shipSrc -match '\$postArgs = @\{[^\r\n]*DistRoot = \$DistRoot')
Yes '  and no clone, because the remirror works its own out from the channel' (
    $shipSrc -notmatch '\$postArgs = @\{[^\r\n]*ReleaseDir')

# The order on screen is the order it happens in, and it is the one the website
# lane pinned: the remirror, then the Discord post and the countdown, because those three send people to fetch a release the feed has
# to be serving.
if ($mirrorCall.Count -eq 1) {
    Yes 'the remirror follows the publisher' ($atPublish -gt 0 -and $mirrorCall[0].Extent.StartOffset -gt $atPublish)
    Yes '  and no VirusTotal Invoke-PostShip' ($vtCall.Count -eq 0)
    Yes '  and the remirror comes before the Discord post and the countdown' (
        $atNews -gt 0 -and $atAnnounce -gt $atNews -and $mirrorCall[0].Extent.StartOffset -lt $atNews)
}

# Ship installs no launcher (#4825): the launcher goes out through Velopack
# (merge-release.yml, promote-main.yml), so neither the one it once built nor
# the feed's (Install-FeedLauncher, #2661, gone with -Package in #4824) is put
# in place by a release. The Join-Path inside a call is a CommandAst of its
# own and names the same file, so the invocation is the one whose command is
# not Join-Path.
$installs = @($ship.Ast.FindAll({ param($n) $n -is $CmdAst -and $n.Extent.Text.Contains('Install-Launcher.ps1') -and
                                            $n.GetCommandName() -ne 'Join-Path' }, $true))
Yes ("Ship calls Install-Launcher.ps1 nowhere ({0})" -f $installs.Count) ($installs.Count -eq 0)
Yes '  and no Install-FeedLauncher is left (#4824)' ($shipSrc -notmatch 'Install-FeedLauncher')

# What happens when one of them does not happen. The tip is already published by
# then, so nothing may be unpublished, and the website lane's rule is that even a
# refused remirror is a line rather than a failed release.
Yes 'a follow-on that did not happen is remembered rather than exited on' ($shipSrc -match '\$script:PostShipFailed \+= ')
Yes '  and named again on the last screen, with the line that puts it right' (
    $shipSrc -match 'The release is out and stays out' -and $shipSrc -match '\$\(\$f\.PutRight\)')
$exitIfs = @($ship.Ast.FindAll({ param($n) $n -is $IfAst -and $n.Extent.Text -match '\$script:PostShipFailed\.Count' -and
                                           $n.Extent.Text -match 'exit 1' }, $true))
Yes '  and Ship does NOT exit non-zero over it' ($exitIfs.Count -eq 0)
Yes '  while nothing in that block unpublishes anything' ($shipSrc -notmatch 'PostShipFailed[\s\S]{0,400}Unbump')

# ---- the helper, driven against stand-in hooks ------------------------------
#
# A copy of Publish-PostShip.ps1 in a folder shaped like scripts\release, with a
# deploy folder beside it, so the remirror path lands on a stand-in that writes
# down what it was given and hands back the code it is told to. What is
# measured is the remirror call and what its codes mean, never the site.
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-post-ship-' + [Guid]::NewGuid().ToString('N'))
$script:T = $T
$ps = (Get-Process -Id $PID).Path
function Run([string]$dir, [string[]]$withArgs) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'Publish-PostShip.ps1') @withArgs 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = $out }
}

try {
    $release = Join-Path $T 'release'
    $deploy = Join-Path $T 'deploy'
    $root = Join-Path $T 'Play'
    $dist = Join-Path $T 'dist'
    $stage = Join-Path (Join-Path $dist 'Play') '_dist'
    New-Item -ItemType Directory -Force -Path $release, $deploy, $stage, (Join-Path $root 'Launcher') | Out-Null
    Copy-Item -LiteralPath $HelperPath -Destination $release -Force
    $setup = Join-Path $stage 'Thornswood-Setup.exe'
    [IO.File]::WriteAllText($setup, 'the installer people download')

    function Hook([string]$dir, [string]$name, [string]$params, [int]$code) {
        [IO.File]::WriteAllText((Join-Path $dir ($name + '.ps1')),
            "param($params)`r`n" +
            "Write-Host '$name ran'`r`n" +
            "foreach (`$k in @(`$PSBoundParameters.Keys | Sort-Object)) { Write-Host ('  ' + `$k + '=' + [string]`$PSBoundParameters[`$k]) }`r`n" +
            "exit $code`r`n", $Utf8)
    }
    $mirrorParams = '[string]$FeedDir, [switch]$Dev, [string[]]$AssetDir, [switch]$Check, [switch]$Verify, [switch]$Quiet'

    # ---- remirror not landed yet -------------------------------------------
    $none = Run $release @('-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("a machine with no remirror script is not a failed release (exit $($none.Code))") ($none.Code -eq 1)
    Yes '  and it names the remirror, its path and whose lane it is' (
        $none.Out -match 'Remirror-Site-Feed\.ps1 is not on this machine' -and $none.Out -match 'website lane' -and
        $none.Out -match '#730')
    Yes '  and says the release is out and stays out' (
        $none.Out -match 'The release is out and stays out' -and $none.Out -match 'The release is fine')
    Yes '  and does not claim a VirusTotal upload was missing' ($none.Out -notmatch 'Publish-VirusTotal\.ps1 is not on this machine')

    # ---- remirror landed, main ---------------------------------------------
    Hook $deploy 'Remirror-Site-Feed' $mirrorParams 0
    $ok = Run $release @('-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("remirror there, a main release is done (exit $($ok.Code))") ($ok.Code -eq 0)
    Yes '  the remirror ran with -Dev:$false and nothing else' (
        $ok.Out -match 'Remirror-Site-Feed ran' -and $ok.Out -match 'Dev=False' -and $ok.Out -notmatch 'FeedDir=')
    Yes '  and it says where the tip is going' ($ok.Out -match 'the main tip to https://thornswood\.net/feed/')
    Yes '  and it does not call Publish-VirusTotal' ($ok.Out -notmatch 'Publish-VirusTotal ran')
    Yes '  and it says everything that follows the tip is done' ($ok.Out -match 'Everything that follows the main tip is done')

    # ---- the same block on dev ---------------------------------------------
    $dev = Run $release @('-Channel', 'dev', '-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("the same block runs on dev (exit $($dev.Code))") ($dev.Code -eq 0)
    Yes '  the remirror is told -Dev' ($dev.Out -match 'Dev=True' -and $dev.Out -match 'https://thornswood\.net/feed-dev/')
    Yes '  and still no VirusTotal upload' ($dev.Out -notmatch 'Publish-VirusTotal ran')

    # ---- -Only Remirror (Ship's form) and -Only VirusTotal soft no-op ------
    $one = Run $release @('-Only', 'Remirror', '-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("-Only Remirror runs the feed (exit $($one.Code))") (
        $one.Code -eq 0 -and $one.Out -match 'Remirror-Site-Feed ran' -and $one.Out -notmatch 'Publish-VirusTotal ran')
    $two = Run $release @('-Only', 'VirusTotal', '-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("-Only VirusTotal is a soft no-op pointing at the manual tool (exit $($two.Code))") (
        $two.Code -eq 0 -and $two.Out -match 'no longer part of publish' -and $two.Out -match 'Publish-VirusTotal\.ps1' -and
        $two.Out -notmatch 'Remirror-Site-Feed ran' -and $two.Out -notmatch 'Publish-VirusTotal ran')

    # ---- a remirror that refuses -------------------------------------------
    Hook $deploy 'Remirror-Site-Feed' $mirrorParams 1
    $refused = Run $release @('-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("a remirror that refuses is said, not swallowed (exit $($refused.Code))") (
        $refused.Code -eq 1 -and $refused.Out -match 'refused to publish the feed')
    Yes '  and it says the site is one release behind rather than pointing at a 404' (
        $refused.Out -match 'one release behind')
    Yes '  and names -Check, so whoever reads it can see what the remirror wants' ($refused.Out -match '-Check')
    Yes '  and still does not call VirusTotal' ($refused.Out -notmatch 'Publish-VirusTotal ran')
    Yes '  and it says the release is out and stays out' ($refused.Out -match 'The release is out and stays out')
    Hook $deploy 'Remirror-Site-Feed' $mirrorParams 0

    # ---- no installer on disk does not matter for remirror -----------------
    Remove-Item -LiteralPath $setup -Force
    $noSetup = Run $release @('-Root', $root, '-DistRoot', $dist, '-NoPause')
    Yes ("no installer on this machine is fine for remirror-only (exit $($noSetup.Code))") ($noSetup.Code -eq 0)
    Yes '  and remirror still ran' ($noSetup.Out -match 'Remirror-Site-Feed ran')
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Done
