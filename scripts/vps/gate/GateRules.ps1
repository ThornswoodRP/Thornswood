<#
  GateRules.ps1

  What the deploy gate (#2841) will run, as functions with no side effects,
  so the box's broker, the client and tests\test-2841-deploy-gate.ps1 all
  hold a line to the same rules. Windows PowerShell 5.1 and PowerShell 7.

  A LINE is what the restricted deploy key asks for, the way it would be
  typed after the script's name:

      Deploy-DevGamemode -Restart -Why "a gamemode update"
      Get-Logs -Dev -Lines 2000
      ping

  It is words split on spaces, and a value with spaces in double quotes.
  Nothing in it is ever run by a shell or read as PowerShell: the broker
  matches the verb to verbs.json, every parameter to that verb's rule, and
  starts the verb's script with the words it built itself. So a line that
  holds a character a shell or PowerShell would read (a dollar sign, a
  backslash, a backtick, a quote inside a value, a semicolon outside a text
  value) is refused whole, before anything runs.
#>

# The line, in words. Throws a sentence when it is not one the gate reads.
function Split-ThornswoodGateLine([string]$Line) {
    if ($null -eq $Line) { $Line = '' }
    if ($Line.Length -gt 600) { throw 'the line is over 600 characters. Nothing was run.' }
    if ($Line -match '[^\x20-\x7E]') { throw 'the line holds a character outside plain printable ASCII. Nothing was run.' }
    if ($Line -match '[\\`$<>|]') { throw 'the line holds a backslash, backtick, dollar sign, angle bracket or pipe, which no verb takes. Nothing was run.' }
    $words = New-Object System.Collections.Generic.List[string]
    $i = 0
    while ($i -lt $Line.Length) {
        $c = $Line[$i]
        if ($c -eq ' ') { $i++; continue }
        if ($c -eq '"') {
            $end = $Line.IndexOf('"', $i + 1)
            if ($end -lt 0) { throw 'a value opens a double quote and never closes it. Nothing was run.' }
            $after = $end + 1
            if ($after -lt $Line.Length -and $Line[$after] -ne ' ') { throw 'a closing double quote is followed by more than a space. Nothing was run.' }
            $words.Add($Line.Substring($i + 1, $end - $i - 1))
            $i = $after
            continue
        }
        $end = $Line.IndexOf(' ', $i)
        if ($end -lt 0) { $end = $Line.Length }
        $w = $Line.Substring($i, $end - $i)
        if ($w.Contains('"')) { throw 'a double quote stands inside a word. Nothing was run.' }
        $words.Add($w)
        $i = $end
    }
    return ,([string[]]$words.ToArray())
}

# The verbs, read from verbs.json beside this file unless a path is given.
function Read-ThornswoodGateVerbs([string]$Path = '') {
    if (-not $Path) { $Path = Join-Path $PSScriptRoot 'verbs.json' }
    return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}

# One request against the verbs. Returns:
#   Ok       $true when it may run
#   Why      the sentence that refused it
#   Verb     the verb's name, or 'ping'
#   Script   the verb's script, as a repository path
#   Args     the words the script is started with: the verb's fixed ones,
#            then each given parameter and its value, in the order given
#   Out      the parameter the broker fills with the run's out folder, or ''
#   Minutes  how long the run may take before the broker ends it
#   Build    for a verb verbs.json marks "build" (the live ones), the full
#            commit of main the line names with -Build. The broker runs it
#            only when main is at exactly that commit once it has fetched
#            it, so a live run is held to the build Patrick gave his word
#            for, and -Build never reaches the script. '' for any other verb.
#   Lane     'read' for ping and for a verb verbs.json marks onlyReads, which
#            changes nothing on the box: the broker's read lane runs it
#            beside whatever else runs (#6231). 'change' for every other
#            verb, which the broker runs one at a time.
function Test-ThornswoodGateRequest {
    param([string]$Line, $Verbs)
    $r = [pscustomobject]@{ Ok = $false; Why = ''; Verb = ''; Script = ''; Args = @(); Out = ''; Minutes = 0; Build = ''; Lane = 'change' }
    try { $words = Split-ThornswoodGateLine $Line }
    catch { $r.Why = $_.Exception.Message; return $r }
    if ($words.Count -eq 0) { $r.Why = 'the line is empty: it names no verb. Nothing was run.'; return $r }
    $name = $words[0]
    if ($name -eq 'ping') {
        if ($words.Count -gt 1) { $r.Why = 'ping takes nothing after it. Nothing was run.'; return $r }
        $r.Ok = $true; $r.Verb = 'ping'; $r.Lane = 'read'; return $r
    }
    $known = @($Verbs.verbs.PSObject.Properties | ForEach-Object { $_.Name })
    # Exact and case sensitive, so one verb has one spelling in every log.
    if ($known -cnotcontains $name) {
        $r.Why = ('the gate has no verb ' + $name + '. It runs ' + (($known + 'ping') -join ', ') + '. Nothing was run.')
        return $r
    }
    $v = $Verbs.verbs.$name
    $rules = @{}
    foreach ($p in @($v.params.PSObject.Properties)) { $rules[[string]$p.Name] = [string]$p.Value }
    $held = ($v.PSObject.Properties['build'] -and $v.build -eq $true)
    $given = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    $i = 1
    while ($i -lt $words.Count) {
        $w = $words[$i]
        # A name may end in digits, as Ship's -Detail2 and -Detail3 do (#5144).
        if ($w -notmatch '^-([A-Za-z][A-Za-z0-9]{0,39})$') { $r.Why = ($w + ' is not a parameter name: ' + $name + ' takes only -Name or -Name value. Nothing was run.'); return $r }
        $p = $Matches[1]
        # The build a live verb is held to: the gate's own, never the script's.
        if ($held -and $p -ceq 'Build') {
            if ($r.Build) { $r.Why = '-Build is given twice. Nothing was run.'; return $r }
            if ($i + 1 -ge $words.Count -or $words[$i + 1] -cnotmatch '^[0-9a-f]{40}$') { $r.Why = ('-Build takes the full 40 character commit of main that ' + $name + ' is to run. Nothing was run.'); return $r }
            $r.Build = $words[$i + 1]
            $i += 2
            continue
        }
        # Case sensitive here too, so -putback is not a second way to say -PutBack.
        $ruleName = @($rules.Keys | Where-Object { $_ -ceq $p })
        if (-not $ruleName.Count) {
            $r.Why = ($name + ' through the gate takes ' + ((@(@($rules.Keys) + @($(if ($held) { 'Build' })) | Where-Object { $_ } | Sort-Object) | ForEach-Object { '-' + $_ }) -join ', ') + ', and not -' + $p + '. Nothing was run.')
            return $r
        }
        if ($seen.ContainsKey($p)) { $r.Why = ('-' + $p + ' is given twice. Nothing was run.'); return $r }
        $seen[$p] = $true
        $rule = $rules[$p]
        if ($rule -eq 'switch') { $given.Add('-' + $p); $i++; continue }
        if ($i + 1 -ge $words.Count) { $r.Why = ('-' + $p + ' needs a value. Nothing was run.'); return $r }
        $val = $words[$i + 1]
        $pattern = $rule
        if ($rule -eq 'text') { $pattern = [string]$Verbs.text }
        # A value never starts with a hyphen, so it can never be read as a parameter.
        if ($val.StartsWith('-') -or $val -cnotmatch $pattern) {
            $r.Why = ('the value given for -' + $p + ' is not one ' + $name + ' takes through the gate (' + $pattern + '). Nothing was run.')
            return $r
        }
        $given.Add('-' + $p); $given.Add($val)
        $i += 2
    }
    if ($held -and -not $r.Build) {
        $r.Why = ($name + ' changes what people play on, so it runs only for the exact build Patrick gave his word for: add -Build and main''s full commit. Nothing was run.')
        return $r
    }
    $r.Ok = $true
    $r.Verb = $name
    $r.Script = [string]$v.script
    $r.Args = @(@($v.fixed | Where-Object { $_ }) + $given.ToArray())
    $r.Out = [string]$v.out
    $r.Minutes = [int]$v.timeoutMinutes
    # Only true itself marks a verb as one that reads, never a string or 1.
    if ($v.PSObject.Properties['onlyReads'] -and $v.onlyReads -is [bool] -and $v.onlyReads) { $r.Lane = 'read' }
    return $r
}

# The words as one Windows command line. No word from a line may hold a
# double quote or a backslash (Split-ThornswoodGateLine and the patterns
# already refuse them); the broker's own paths hold backslashes but never end
# in one. So double quotes around a word with a space are the whole of the
# quoting a process's command line needs.
function Join-ThornswoodGateArgs([string[]]$Words) {
    $out = @()
    foreach ($w in $Words) {
        if ($w.Contains('"')) { throw ('a word for the command line holds a double quote: ' + $w) }
        if ($w.Contains('\') -and ($w -notmatch '^[A-Za-z]:\\' -or $w.EndsWith('\'))) { throw ('a word for the command line holds a backslash and is not a folder path of the broker''s own: ' + $w) }
        if ($w -eq '' -or $w.Contains(' ')) { $out += ('"' + $w + '"') } else { $out += $w }
    }
    return ($out -join ' ')
}

# The gate's own three files in one line, "Gate.ps1=<sha256> GateBroker.ps1=
# <sha256> GateRules.ps1=<sha256>", each hashed with its carriage returns
# taken out, so a checkout that writes CRLF and one that writes LF give the
# same line. The broker's ping prints it for the copies it runs from, and
# Box-Run.ps1 -OnTheBox compares it with main's before every verb, so a
# merged change to the gate reaches the box with the next run (Update-Gate)
# and never waits for a person on One. A file that is not there is "none".
$ThornswoodGateFiles = @('Gate.ps1', 'GateBroker.ps1', 'GateRules.ps1')
function Get-ThornswoodGateFileLine([string]$Dir) {
    $parts = @()
    foreach ($n in $ThornswoodGateFiles) {
        $p = Join-Path $Dir $n
        $sha = 'none'
        if (Test-Path -LiteralPath $p) {
            $text = [IO.File]::ReadAllText($p).Replace("`r", '')
            $h = (New-Object Security.Cryptography.SHA256Managed).ComputeHash((New-Object Text.UTF8Encoding($false)).GetBytes($text))
            $sha = [BitConverter]::ToString($h).Replace('-', '').ToLowerInvariant()
        }
        $parts += ($n + '=' + $sha)
    }
    return ($parts -join ' ')
}
