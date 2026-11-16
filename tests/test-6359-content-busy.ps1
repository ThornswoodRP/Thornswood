<#
  test-6359-content-busy.ps1

      pwsh -NoProfile -File .\tests\test-6359-content-busy.ps1

  Issue #6359: GitHub's file store, which every artifact download is
  redirected to, answers 503 "Egress is over the account limit" while the
  storage account GitHub's customers share is busy, and
  scripts\release\Get-ContentBuild.ps1 -Newest took that answer as final and
  stopped a build. Against a stand-in for GitHub's API on this machine
  (-ApiUrl), with no waits (-BusyWaits 0,0):
    1. two busy answers, then the build: it asks three times, says each
       wait, and goes on with what came down;
    2. a connection that drops part way is asked again the same way;
    3. busy every time: it stops after the last wait, saying the store
       stayed busy and that this is GitHub's, not a limit of ours;
    4. any other answer (a 404 for an expired build) stops at the first ask;
    5. the token goes to GitHub's API as before.

  Writes only under its own folder in TEMP, which it removes. Exit 1 when
  any check fails.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$script = Join-Path $root 'scripts\release\Get-ContentBuild.ps1'
$pass = 0; $fail = 0
function Check([string]$What, [bool]$Ok) {
    if ($Ok) { $script:pass++; Write-Host "PASS  $What" } else { $script:fail++; Write-Host "FAIL  $What" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-6359-busy-' + [Guid]::NewGuid().ToString('n').Substring(0, 10))
New-Item -ItemType Directory -Path $tmp | Out-Null

# The stand-in: answers each ask with the next word of its plan (a status, or
# "drop" to close the connection with no answer) and logs each ask.
$serve = Join-Path $tmp 'serve.ps1'
Set-Content -LiteralPath $serve -Encoding utf8 -Value @'
param([int]$Port, [string]$Plan, [string]$Log, [string]$Zip)
# A raw socket, so "drop" can close the connection part way through the
# build's bytes, as a connection that drops does (one closed before any
# answer, .NET asks again by itself).
$t = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$t.Start()
Add-Content -LiteralPath $Log -Value 'READY'
$reasons = @{ '200' = 'OK'; '404' = 'Not Found'; '503' = 'Egress is over the account limit.' }
foreach ($s in $Plan.Split(',')) {
    $c = $t.AcceptTcpClient()
    $st = $c.GetStream()
    $buf = New-Object byte[] 65536
    $got = ''
    while ($got -notmatch "`r`n`r`n") {
        $n = $st.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $got += [Text.Encoding]::ASCII.GetString($buf, 0, $n)
    }
    $path = ($got -split "`r`n")[0].Split(' ')[1]
    $auth = [regex]::Match($got, '(?im)^Authorization:[ ]*([^\r\n]*)').Groups[1].Value
    Add-Content -LiteralPath $Log -Value ('ASK ' + $path + ' ' + $auth)
    if ($s -eq 'drop') {
        $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: application/zip`r`nContent-Length: 100000`r`nConnection: close`r`n`r`n")
        $st.Write($head, 0, $head.Length); $st.Write($buf, 0, 1000); $st.Flush(); $c.Close(); continue
    }
    $b = if ($s -eq '200') { [IO.File]::ReadAllBytes($Zip) } else { [Text.Encoding]::UTF8.GetBytes('no') }
    $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $s $($reasons[$s])`r`nContent-Type: application/zip`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n`r`n")
    $st.Write($head, 0, $head.Length)
    $st.Write($b, 0, $b.Length)
    $st.Flush()
    $c.Close()
}
$t.Stop()
'@

# What the stand-in hands over when it answers 200: an artifact zip with a
# file in it but no content.zip, so a download that came down whole stops at
# the next step, "has no content.zip", and writes nothing over this checkout.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inner = Join-Path $tmp 'inner'; New-Item -ItemType Directory -Path $inner | Out-Null
Set-Content -LiteralPath (Join-Path $inner 'other.txt') -Value 'x'
$zip = Join-Path $tmp 'artifact.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($inner, $zip)

# One kept build on main, as GitHub lists it.
$arts = Join-Path $tmp 'artifacts.json'
Set-Content -LiteralPath $arts -Encoding utf8 -Value (@{ artifacts = @(@{ id = 4242; expired = $false; created_at = '2026-11-16T07:21:06Z'; workflow_run = @{ id = 77; head_branch = 'main' } }) } | ConvertTo-Json -Depth 5)

function Get-FreePort {
    $t = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $t.Start(); $p = $t.LocalEndpoint.Port; $t.Stop(); return $p
}
function Run-Busy([string]$Plan) {
    $port = Get-FreePort
    $log = Join-Path $tmp ('log-' + [Guid]::NewGuid().ToString('n') + '.txt')
    $p = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile', '-File', $serve, '-Port', $port, '-Plan', $Plan, '-Log', $log, '-Zip', $zip) -PassThru
    try {
        $until = (Get-Date).AddSeconds(30)
        while (-not ((Test-Path -LiteralPath $log) -and ((Get-Content -LiteralPath $log -Raw) -match 'READY')) -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100 }
        $env:GH_TOKEN = 'stand-in-token'
        $o = @(& pwsh -NoProfile -File $script -Repo $root -Newest -ArtifactsFile $arts -ApiUrl "http://127.0.0.1:$port" -BusyWaits '0,0' -Output '' 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally {
        Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    $asks = @(Get-Content -LiteralPath $log | Where-Object { $_ -like 'ASK *' })
    return [pscustomobject]@{ Code = $code; Text = ($o -join "`n"); Asks = $asks }
}

try {
    $r = Run-Busy '503,503,200'
    Check '1 two busy answers, then the build: three asks' ($r.Asks.Count -eq 3)
    Check '1 it says each wait and why' (([regex]::Matches($r.Text, 'answered 503 \(Egress is over the account limit\.\) for artifact 4242; asking again in 0 s')).Count -eq 2)
    Check '1 it goes on with what came down' ($r.Code -eq 1 -and $r.Text -match 'artifact 4242 has no content\.zip' -and $r.Text -notmatch 'did not give')

    $r = Run-Busy 'drop,200'
    Check '2 a connection that drops part way is asked again' ($r.Asks.Count -eq 2 -and $r.Text -match 'dropped the connection' -and $r.Text -match 'artifact 4242 has no content\.zip')

    $r = Run-Busy '503,503,503,503'
    Check '3 busy every time: it stops after the last wait, three asks in all' ($r.Code -eq 1 -and $r.Asks.Count -eq 3)
    Check '3 and says the store stayed busy, and that it is GitHub''s' ($r.Text -match 'did not give artifact 4242: its file store answered 503 \(Egress is over the account limit\.\) on all 3 asks' -and $r.Text -match 'so this is GitHub''s, not a limit of ours')

    $r = Run-Busy '404,200'
    Check '4 a 404 stops at the first ask' ($r.Code -eq 1 -and $r.Asks.Count -eq 1 -and $r.Text -match 'did not give artifact 4242: it answered 404' -and $r.Text -notmatch 'asking again')

    Check '5 the token goes to the API''s artifact address' ($r.Asks.Count -ge 1 -and $r.Asks[0] -ceq 'ASK /repos/ThornswoodRP/Thornswood/actions/artifacts/4242/zip Bearer stand-in-token')
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
exit 0
