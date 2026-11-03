# The bot's code, for the harnesses that read it (#5357). Dot-source it:
#
#   . (Join-Path $PSScriptRoot 'BotFiles.ps1')
#   $bot = Get-BotSource $repo
#
# bot\bot.py is the start, and the bot itself is in the modules it imports,
# bot\bot_*.py, one area each. Get-BotSource is all of it as one text, bot.py
# first and then each module in the order bot.py imports them, so a harness
# that looks for a line of the bot finds it whichever module it is in.
# Get-BotFiles is the same files as paths. The list is the one Install-Bot.ps1
# sends, scripts\deploy\Bot-Code.ps1's, read from bot.py's own import lines.
. (Join-Path $PSScriptRoot '..\scripts\deploy\Bot-Code.ps1')

function Get-BotFiles([string]$Repo) {
  $bot = Join-Path $Repo 'bot'
  return @((Join-Path $bot 'bot.py')) + @(Get-ThornswoodBotParts $Repo | ForEach-Object { Join-Path $bot $_ })
}

function Get-BotSource([string]$Repo) {
  return (@(Get-BotFiles $Repo | ForEach-Object { [IO.File]::ReadAllText($_) }) -join "`n")
}
