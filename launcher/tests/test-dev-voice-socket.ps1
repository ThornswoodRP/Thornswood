<# #6552. Execute the real Config/DevBuild/Mics on an isolated temporary INI.
   No Windows device is opened: an explicit fixture microphone bypasses lookup.
   The full application is compiled by the repository's required SDK helper. #>
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$canonical=[regex]::Match([IO.File]::ReadAllText((Join-Path $repo 'launcher/app/Config.cs')),'public string ServerAddress = "([^"]+)"').Groups[1].Value
. (Join-Path $repo 'tests/Launcher-Csc.ps1')
$pass=0;$fail=0
function Yes([string]$name,[bool]$ok){if($ok){$script:pass++;Write-Host "PASS  $name"}else{$script:fail++;Write-Host "FAIL  $name"}}
$work=Join-Path ([IO.Path]::GetTempPath()) ('thornswood-dev-signal-'+[Guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($work)
try {
 $asm=Add-LauncherAssembly
 $ct=$asm.GetType('Thornswood.Config',$true)
 $dt=$asm.GetType('Thornswood.DevBuild',$true)
 $mt=$asm.GetType('Thornswood.Mics',$true)
 $pt=$asm.GetType('Thornswood.Paths',$true)
 $cfg=[Activator]::CreateInstance($ct)
 $mainDirect='wss://main-signal.thornswood.net:44789/voice/'
 Yes 'canonical default Main uses its own trusted socket' ($cfg.VoiceSocket() -eq $mainDirect -and $cfg.VoiceBase() -eq 'https://thornswood.net/voice')
 $cfg.Channel='MAIN'
 Yes 'explicit Main channel keeps the canonical dedicated route' ($cfg.VoiceSocket() -eq $mainDirect)
 $cfg.Channel='preview'
 Yes 'an unknown channel keeps the legacy socket' ($cfg.VoiceSocket() -eq 'wss://thornswood.net/voice/')
 $cfg.Channel='';$cfg.ServerPort='7787'
 Yes 'Main with a mismatched game port keeps its derived socket' ($cfg.VoiceSocket() -ne $mainDirect)
 $cfg.ServerPort='7777';$cfg.VoicePort='7789'
 Yes 'Main with a mismatched voice port keeps its derived socket' ($cfg.VoiceSocket() -ne $mainDirect)
 $cfg.VoicePort='7778';$cfg.ServerAddress='private.example.invalid'
 Yes 'a custom Main game address never acquires direct signaling' ($cfg.VoiceSocket() -ne $mainDirect)
 $cfg.ServerAddress=$canonical;$cfg.VoiceUrl='https://custom.example.invalid/voice'
 Yes 'a custom Main service preserves its HTTPS issuer and socket' ($cfg.VoiceBase() -eq $cfg.VoiceUrl -and $cfg.VoiceSocket() -eq 'wss://custom.example.invalid/voice/')
 $cfg.VoiceUrl=''
 $cfg.MicrophoneName='Fixture microphone'
 $null=$dt.GetMethod('Set').Invoke($null,@($cfg,'dev'))
 $direct='wss://dev-signal.thornswood.net:44789/voice-dev/'
 Yes 'explicit canonical Dev uses its dedicated socket' ($cfg.VoiceSocket() -eq $direct)
 Yes 'Dev HTTPS token base stays canonical' ($cfg.VoiceBase() -eq 'https://thornswood.net/voice-dev')
 $cfg.ServerPort='7777'
 Yes 'a mismatched game port never acquires the dedicated socket' ($cfg.VoiceSocket() -ne $direct)
 $cfg.ServerPort='7787';$cfg.VoicePort='7778'
 Yes 'a mismatched voice port never acquires the dedicated socket' ($cfg.VoiceSocket() -ne $direct)
 $cfg.VoicePort='7789'
 $cfg.VoiceUrl='https://custom.example.invalid/voice-dev'
 Yes 'custom service keeps its existing socket' ($cfg.VoiceSocket() -eq 'wss://custom.example.invalid/voice-dev/')
 $cfg.VoiceUrl='';$cfg.ServerAddress='private.example.invalid'
 Yes 'custom game address never acquires the dedicated route' ($cfg.VoiceSocket() -ne $direct)
 $cfg.ServerAddress=$canonical;$cfg.Channel='';
 Yes 'Dev-looking ports without explicit Dev do not acquire direct signaling' ($cfg.VoiceSocket() -ne $direct)
 $null=$dt.GetMethod('Set').Invoke($null,@($cfg,'dev'))
 $pt.GetField('Game').SetValue($null,$work)
 $ini=[IO.Path]::Combine($work,'Data\SKSE\Plugins\Thornswood.ini')
 [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ini))
 [IO.File]::WriteAllText($ini,"[Voice]`nMicrophoneName = old`nVoicePort = 7789`nVoiceUrl = https://thornswood.net/voice-dev`n")
 $null=$mt.GetMethod('Apply').Invoke($null,@($cfg))
 $text=[IO.File]::ReadAllText($ini)
 Yes 'Play adds the direct socket to an older INI' ($text -match ('(?m)^VoiceSocketUrl = '+[regex]::Escape($direct)+'\r?$'))
 Yes 'the INI HTTPS base remains the original auth route' ($text -match '(?m)^VoiceUrl = https://thornswood.net/voice-dev\r?$')
 $null=$mt.GetMethod('Apply').Invoke($null,@($cfg))
 Yes 'repeated Play rewrites one socket key without duplicating it' (([regex]::Matches([IO.File]::ReadAllText($ini),'(?m)^VoiceSocketUrl\s*=')).Count -eq 1)
 $null=$dt.GetMethod('Set').Invoke($null,@($cfg,'main'))
 $null=$mt.GetMethod('Apply').Invoke($null,@($cfg))
 $text=[IO.File]::ReadAllText($ini)
 Yes 'switching Main rewrites the stale Dev socket' ($text -match ('(?m)^VoiceSocketUrl = '+[regex]::Escape($mainDirect)+'\r?$') -and -not $text.Contains('dev-signal.thornswood.net'))
 Yes 'Main socket and token base remain canonical' ($cfg.VoiceSocket() -eq $mainDirect -and $cfg.VoiceBase() -eq 'https://thornswood.net/voice')
 $null=$dt.GetMethod('Set').Invoke($null,@($cfg,'dev'))
 $null=$mt.GetMethod('Apply').Invoke($null,@($cfg));$text=[IO.File]::ReadAllText($ini)
 Yes 'switching back to Dev rewrites the stale Main socket' ($text -match ('(?m)^VoiceSocketUrl = '+[regex]::Escape($direct)+'\r?$') -and -not $text.Contains('main-signal.thornswood.net'))
 Yes 'both channel switches keep exactly one socket key' (([regex]::Matches($text,'(?m)^VoiceSocketUrl\s*=')).Count -eq 1)
} finally {
 if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force}
}
Write-Host "$pass passed, $fail failed"
if($fail){exit 1}
