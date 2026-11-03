# The Discord bot's code as one list (#5357): what Install-Bot.ps1 sends and
# parse checks on the box, and what App-Part.ps1 puts in the bot's part of a
# Release for the deploy agent. Dot-source it, then
#
#   Get-ThornswoodBotCode $Repo   ->  bot.py, _pyguard.py, trust.py, card.py,
#                                     bot_base.py, bot_core.py, ...
#
# bot.py is the start, and the bot itself is in the modules it imports,
# bot\bot_*.py, one area each. Which modules there are is read from bot.py's
# own import lines, the one place that list is kept, so a module added to
# the bot goes to the box with nothing else to change, and a file bot.py does
# not import does not. Only a name of the shape bot_<letters>.py comes out of
# those lines, so none of the bot's records (joins.json and the rest) ever
# can. tests\bot-files.js and bot\harness_bot.py read the list the same way.
function Get-ThornswoodBotParts([string]$Repo) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($line in [IO.File]::ReadAllLines((Join-Path (Join-Path $Repo 'bot') 'bot.py'))) {
    if ($line -cmatch '^import (bot_[a-z0-9_]+)\s*(#.*)?$' -and -not $parts.Contains($Matches[1] + '.py')) { $parts.Add($Matches[1] + '.py') }
  }
  if ($parts.Count -eq 0) { throw "bot\bot.py in $Repo imports none of the bot's modules, so its code cannot be listed" }
  return $parts.ToArray()
}

function Get-ThornswoodBotCode([string]$Repo) {
  return @('bot.py', '_pyguard.py', 'trust.py', 'card.py') + @(Get-ThornswoodBotParts $Repo)
}
