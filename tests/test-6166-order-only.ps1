<#
  test-6166-order-only.ps1

  The box deploy agent puts a Release's gamemode and tables on dev, then has
  the gate move dev's load order to what that Release's commit records. The
  gate runs main as it is, and until #6166 the step ran the whole dev deploy
  there: it put main's gamemode and the committed tables over the Release's
  (build-1.3.69, 15 Nov 2026) and refused once main named a newer server
  build than dev had just started (build-1.3.68). The step is now
  Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -At <the Release's
  commit>: the order and the plugins, nothing of the gamemode, and only when
  main's records of the order are that commit's.

  HOW. The -At block is taken out of Deploy-DevGamemode.ps1 between its
  markers and run by a child pwsh in a scratch clone made the way the gate
  makes its own (one commit deep, from a scratch origin), so the commit it
  is asked about has to be fetched by its id. The rest is read from the
  files.

  It proves:
    - the files the order is made from are the same list in the script and
      in the agent's LoadOrderPaths, and are what the box's content build
      reads its order from, which -FromRecord writes (#6209)
    - -At at the checkout's own commit, and at an older commit whose order
      files are the same as main's, goes on
    - -At at a commit main has moved the order past says NOT THIS COMMIT'S
      ORDER, ends with 3, and names the file that moved
    - -At at a commit origin does not have stops, and not with 3
    - -OrderOnly and -At are refused without what they go with, and the gate
      takes them only in that shape
    - with -OrderOnly the script builds no artifact or stamp, sends no
      gamemode.js, stamp or tables, never reloads, writes no deploy record,
      and stops nothing when the order is already in
    - with -OrderOnly it sends no plugin of ours and makes no Last plugin:
      those are the Release's, which the agent puts in (#6175)
    - the agent sends that line with the Deployment's commit and reads the
      answer
#>
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:fails = 0; $script:passes = 0
function Yes([string]$what, [bool]$ok) {
  if ($ok) { Write-Host "PASS  $what"; $script:passes++ } else { Write-Host "FAIL  $what" -ForegroundColor Red; $script:fails++ }
}

$devPath = Join-Path $Repo 'scripts/deploy/Deploy-DevGamemode.ps1'
# A Windows checkout ends lines with CRLF; the checks below read LF.
$dev = [IO.File]::ReadAllText($devPath).Replace("`r`n", "`n")
$agentCs = [IO.File]::ReadAllText((Join-Path $Repo 'tools/DeployAgent/Agent.cs')).Replace("`r`n", "`n")

# ---- the same files in the script and the agent ---------------------------
$block = [regex]::Match($dev, '(?s)# ==== thornswood dev order at ====(.*?)# ==== end thornswood dev order at ====').Groups[1].Value
Yes 'Deploy-DevGamemode.ps1 has the -At block between its markers' ($block -ne '')
$inScript = @([regex]::Match($block, '(?s)\$ThornswoodOrderInputs = @\((.*?)\)').Groups[1].Value -split "`n" | ForEach-Object { if ($_ -match "'([^']+)'") { $Matches[1] } })
$inAgent = @([regex]::Match($agentCs, '(?s)LoadOrderPaths =\s*\[(.*?)\];').Groups[1].Value -split "`n" | ForEach-Object { if ($_ -match '"([^"]+)"') { $Matches[1] } })
Yes ("the script's order files are the agent's LoadOrderPaths ({0})" -f ($inAgent -join ', ')) ($inAgent.Count -eq 4 -and (($inScript | Sort-Object) -join '|') -eq (($inAgent | Sort-Object) -join '|'))
# #6209: they are what the box's content build reads its order from, so the
# order the step writes is the one a Release's tables were built against.
$contentPaths = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/ContentPaths.ps1')).Replace("`r`n", "`n")
$orderFn = [regex]::Match($contentPaths, '(?s)function Get-ThornswoodContentOrder \{(.*?)\n\}\n').Groups[1].Value
Yes '  and each is a file Get-ThornswoodContentOrder reads, the content build''s order (#6209)' ($orderFn -ne '' -and @($inScript | Where-Object { -not $orderFn.Contains("'" + $_ + "'") }).Count -eq 0)
Yes '  and -FromRecord writes that order, not last-plugin.json''s (#6209)' (
  $dev.Contains("`$contentOrder = Get-ThornswoodContentOrder -Repo `$repoRoot") -and
  $dev.Contains("@(`$contentOrder.Names)") -and -not $dev.Contains("`$built.loadOrder) | ForEach-Object { [string]`$_ } | Where-Object { `$_ -and `$_ -ine `$ThornswoodLastPlugin }"))

# ---- the -At block, run in a clone made as the gate makes its own ---------
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('test-6166-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $scratch | Out-Null
function G { param([string]$dir) $a = @($args); $o = @(& git -C $dir -c user.name=t -c user.email=t@t -c init.defaultBranch=main -c protocol.file.allow=always @a 2>&1); if ($LASTEXITCODE -ne 0) { throw "git $($a -join ' '): $($o -join ' | ')" }; ($o -join "`n").Trim() }
function Put([string]$dir, [string]$rel, [string]$text) { $p = Join-Path $dir $rel; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null; [IO.File]::WriteAllText($p, $text) }
try {
  $work = Join-Path $scratch 'work'
  $origin = Join-Path $scratch 'origin.git'
  & git init -q --bare -b main $origin
  & git init -q -b main $work
  foreach ($rel in $inAgent) { Put $work $rel "first $rel" }
  Put $work 'game/gamemode.js' '// one'
  G $work add -A | Out-Null; G $work commit -q -m one | Out-Null
  $one = G $work rev-parse HEAD
  Put $work 'game/gamemode.js' '// two'
  G $work commit -q -am two | Out-Null
  $two = G $work rev-parse HEAD
  Put $work 'records/collection-plugins.json' 'moved'
  Put $work 'game/gamemode.js' '// three'
  G $work commit -q -am three | Out-Null
  $three = G $work rev-parse HEAD
  G $work remote add origin $origin | Out-Null
  G $work push -q origin main | Out-Null

  # The gate's clone: one commit deep. Two clones, at two and at three.
  function Gate([string]$name, [string]$at) {
    $c = Join-Path $scratch $name
    & git -c protocol.file.allow=always clone -q --no-local --depth 1 "file://$origin" $c 2>&1 | Out-Null
    if ($at) { G $c fetch -q --depth 1 origin $at | Out-Null; G $c checkout -q --detach $at | Out-Null }
    # The block reads the repository from the script's own folder.
    $runner = Join-Path $c 'scripts/deploy/run-at.ps1'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $runner) | Out-Null
    [IO.File]::WriteAllText($runner, "param([string]`$At)`n`$ErrorActionPreference = 'Stop'`n" + $block)
    $runner
  }
  function RunAt([string]$runner, [string]$at) {
    $env:GIT_ALLOW_PROTOCOL = 'file'
    $out = @(& pwsh -NoProfile -NonInteractive -File $runner -At $at 2>&1 | ForEach-Object { "$_" })
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
  }
  $atTwo = Gate 'gate-two' $two
  $atThree = Gate 'gate-three' ''
  $threeDir = Join-Path $scratch 'gate-three'
  & git -C $threeDir cat-file -e "$two^{commit}" 2>$null
  $hasTwo = ($LASTEXITCODE -eq 0)
  Yes 'the stand-in gate clone is one commit deep and does not hold the commit before its own' ((G $threeDir rev-parse --is-shallow-repository) -eq 'true' -and -not $hasTwo)

  $r = RunAt $atThree $three
  Yes "-At at the checkout's own commit goes on, fetching nothing" ($r.Code -eq 0 -and $r.Out -notmatch "NOT THIS COMMIT'S ORDER" -and $r.Out -notmatch 'past')
  $r = RunAt $atTwo $one
  Yes "-At at an older commit whose order files are main's goes on, and says they are the same" ($r.Code -eq 0 -and $r.Out -match 'every file the order is made from is the same at both')
  $r = RunAt $atThree $two
  Yes "-At at a commit main moved the order past says NOT THIS COMMIT'S ORDER and ends with 3" ($r.Code -eq 3 -and $r.Out -match "NOT THIS COMMIT'S ORDER")
  Yes '  and names the file that moved, and only that one' ($r.Out -match 'its records/collection-plugins\.json differ' -and $r.Out -notmatch 'last-plugin')
  $r = RunAt $atThree ('ab' * 20)
  Yes '-At at a commit origin does not have stops, and not as a moved order' ($r.Code -ne 0 -and $r.Code -ne 3 -and $r.Out -match 'could not be fetched')
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue
}

# ---- what -OrderOnly and -At go with ---------------------------------------
Yes '-OrderOnly goes only with -LoadOrder -FromRecord' ($dev.Contains("if (`$OrderOnly -and -not (`$LoadOrder -and `$FromRecord)) { throw"))
Yes '-OrderOnly takes neither -PutBack nor -Restart' ($dev.Contains("if (`$OrderOnly -and (`$PutBack -or `$Restart)) { throw"))
Yes '-At goes only with -OrderOnly, and only as a whole commit id' ($dev.Contains("if (`$At -and -not `$OrderOnly) { throw") -and $dev.Contains("if (`$At -and `$At -notmatch '^[0-9a-f]{40}$') { throw"))
$atChecks = $dev.IndexOf('if ($At -and -not $OrderOnly)')
Yes '  checked, and the order compared, before anything leaves this machine' ($atChecks -gt 0 -and $dev.IndexOf('# ==== thornswood dev order at ====') -gt $atChecks -and $dev.IndexOf('# ==== end thornswood dev order at ====') -lt $dev.IndexOf("Send-ThornswoodArtifact -Artifact"))

. (Join-Path $Repo 'scripts/vps/gate/GateRules.ps1')
$verbs = Read-ThornswoodGateVerbs (Join-Path $Repo 'scripts/vps/gate/verbs.json')
function Ask([string]$line) { Set-StrictMode -Off; Test-ThornswoodGateRequest -Line $line -Verbs $verbs }
$c = '0123456789abcdef0123456789abcdef01234567'
Yes 'the gate takes -OrderOnly -At <commit> on Deploy-DevGamemode' ((Ask "Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -ShipFollows -At $c").Ok)
Yes '  and refuses an -At that is short, a branch, or not hex' (-not (Ask 'Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -At 0123456').Ok -and -not (Ask 'Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -At main').Ok -and -not (Ask ('Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -At ' + ('g' * 40))).Ok)

# ---- what -OrderOnly leaves alone ------------------------------------------
Yes '-OrderOnly builds no artifact, so nothing is held to main''s server build' ($dev.Contains('if (-not $PutBack -and -not $OrderOnly) {' + "`n" + '$alsoSends'))
Yes '  makes no build stamp' ($dev -match '(?s)if \(-not \$OrderOnly\) \{\s*\$buildStamp = Save-ThornswoodBuildStamp')
Yes '  sends no gamemode.js or stamp' ($dev -match "(?s)if \(-not \`$OrderOnly\) \{\s*\`$send\['gamemode.js'\] = \`$Gamemode.*?\`$send\['thornswood-build.json'\] = \`$stampFile\s*\}")
Yes '  sends no tables, so the swap leaves the Release''s folder alone' ($dev -match '(?s)if \(-not \$OrderOnly\) \{\s*\$tableFiles = @\(Get-ThornswoodTableFiles' -and ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Swap.ps1'))).Replace("`r`n", "`n").Contains('A deploy' + "`n" + '# that sends no table leaves the folder at the root alone.'))
Yes '  never reloads: a moved order is a restart, the swap' ($dev.Contains('if (-not $PutBack -and -not $Restart -and -not $OrderOnly) {'))
Yes '  writes no deploy record over the Release''s' ($dev -match '(?s)elseif \(-not \$OrderOnly\) \{\s*Save-SwapPreviousRecord')
Yes '  and stops nothing when the settings are already right and no plugin goes up or is made' (
  $dev.Contains("`$settingsSaid = @(& {") -and $dev.Contains('"@ | ForEach-Object { Write-Host "  $_"; "$_".Trim() }') -and
  $dev.Contains("`$_ -like 'thornswoodVoicePort is already *the load order is already right'") -and
  $dev.Contains("'thornswoodVoicePort is already `$VoicePort, both equipment checks are already off, and the load order is already right'") -and
  $dev.Contains('if ($settingsSame -and -not $sendPlugins.Count -and -not $makeLast) {') -and
  $dev.IndexOf("ORDER ALREADY IN") -lt $dev.IndexOf("Loading the new gamemode in the running dev server"))

Yes '  and sends no plugin of ours and makes no Last: they are the Release''s, which the agent puts in (#6175)' (
  $dev -match '(?s)foreach \(\$n in \$pluginNames\) \{\s*(#[^\n]*\n\s*)*if \(\$OrderOnly -and \(Test-ThornswoodRepoPlugin \$n\)\) \{\s*if \(-not \$thereSize\.ContainsKey\(\$n\)\) \{ throw [^\n]*\}\s*continue\s*\}\s*if \(\$lastWant -and \$n -ieq \$lastName\) \{' -and
  ([IO.File]::ReadAllText((Join-Path $Repo 'scripts/release/RepoPlugins.ps1'))).Contains("`$ThornswoodRepoPlugins = @('Thornswood-Content.esp', 'Thornswood-Last.esp')"))
Yes '  so the order files are the order''s alone, not our plugin or its recipe' (-not ($inScript -contains 'game/content/Thornswood-Content.esp') -and -not ($inScript -contains 'game/data/last-plugin.recipe'))

# ---- the agent --------------------------------------------------------------
$lo = [regex]::Match($agentCs, 'LoadOrderLine = "([^"]+)"').Groups[1].Value
Yes "the agent's line is the order only: $lo" ($lo -eq 'Deploy-DevGamemode -LoadOrder -FromRecord -OrderOnly -ShipFollows')
Yes '  sent with the Deployment''s commit' ($agentCs.Contains('LoadOrderLine + " -At " + commit') -and $agentCs.Contains('var line = LoadOrderLineAt(commit);') -and $agentCs.Contains('Gate!.Run(line, '))
Yes "  and it reads NOT THIS COMMIT'S ORDER as the words the script prints" ($agentCs.Contains('NotThisOrder = "NOT THIS COMMIT''S ORDER"') -and $dev.Contains("NOT THIS COMMIT'S ORDER: main has moved the order past"))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:passes, $script:fails)
if ($script:fails) { exit 1 }
