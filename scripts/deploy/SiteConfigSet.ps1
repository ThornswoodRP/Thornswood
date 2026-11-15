<#
  SiteConfigSet.ps1

  The one block that changes a single top-level setting in the site's
  config.json on the VPS and leaves every other setting as it was. Dot-sourced
  by Deploy-Docs.ps1 (-Password, the member password) and
  Rotate-ServerPassword.ps1 (serverPassword), which each put the text it
  returns into the script they send to the box. It only defines a function.

      . (Join-Path $Here 'SiteConfigSet.ps1')
      $set = Get-ThornswoodSiteConfigSet -ConfigPath 'C:\Thornswood-Docs\config.json' -Key 'password' -What 'password'

  The far side expects the new value in `$pw (from ssh's standard input,
  Send-Secret.ps1, or from the box's own file, DocsPasswordFile.ps1). It
  prints one line: what it set and how many other settings it kept, or why it
  wrote nothing. On a refusal it returns, so nothing after it in the same
  script runs either (Rotate-ServerPassword's site restart).

  WHY ONE BLOCK (issue #2317). config.json also holds the Discord client id
  and secret, the bot token, botKey, the admins and the cookie secret. Both
  scripts once wrote {"<key>": ...} over the whole file: Deploy-Docs -Password
  always did until it was fixed, and Rotate-ServerPassword did whenever the
  file was there but did not parse, because its read sat in a try with an empty catch
  and an empty table was written back. With no Discord client id the site's
  discordReady() is false and the member password opens the door again. The
  fix in Deploy-Docs was not carried to Rotate-ServerPassword, so the two
  copies drifted; now there is one.

  What it does:

    - Reads the file as UTF-8. Get-Content in Windows PowerShell 5.1, which
      the box runs, reads a file with no byte order mark as the local code
      page, and node writes none, so a role name like Skjold with an accent
      came back changed.
    - A file that is there and is not a JSON object (it will not parse, it is
      empty, it is an array) is left exactly as it is, with a line saying so,
      and nothing is written. That is server.js's own rule: unreadable is not
      empty, and the difference is somebody's client secret. The parse error
      itself is not printed, because Windows PowerShell quotes the text it
      could not parse, and that text can be a secret.
    - A file that cannot be read at all (locked, no permission) stops the
      script with that error, before anything is written.
    - Keeps the order of the settings (an ordered table), sets the one key,
      and writes UTF-8 with no byte order mark, because node's JSON.parse
      refuses one and the site then runs on its defaults while looking
      configured.
    - No file at all, a first install: writes one holding just this key;
      server.js fills in the rest when it starts.

  scripts\tests\test-docs-password.ps1 runs it through Deploy-Docs -Password, and
  scripts\tests\test-2317-rotate-config.ps1 through Rotate-ServerPassword, both in
  Windows PowerShell 5.1 against scratch files.
#>

function Get-ThornswoodSiteConfigSet {
  param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9]*$')][string]$Key,
    # How the refusal names what stayed as it was: 'password', 'server password'.
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z ]+$')][string]$What
  )
  $f = $ConfigPath.Replace("'", "''")
  return @"
`$f = '$f'
`$cfg = [ordered]@{}
if (Test-Path -LiteralPath `$f) {
  `$raw = [IO.File]::ReadAllText(`$f, [Text.Encoding]::UTF8)
  `$old = `$null
  try { `$old = ConvertFrom-Json -InputObject `$raw } catch { `$old = `$null }
  `$raw = `$null
  if (-not (`$old -is [Management.Automation.PSCustomObject])) {
    'CONFIG.JSON IS THERE AND WILL NOT READ AS JSON. Nothing written, the $What is unchanged.'
    return
  }
  foreach (`$p in `$old.PSObject.Properties) { `$cfg[`$p.Name] = `$p.Value }
}
`$cfg['$Key'] = `$pw
[IO.File]::WriteAllText(`$f, (ConvertTo-Json -InputObject `$cfg -Depth 6), (New-Object Text.UTF8Encoding(`$false)))
'set $Key, ' + (`$cfg.Count - 1) + ' other setting(s) kept'
"@
}
