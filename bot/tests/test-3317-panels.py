"""
test-3317-panels.py

The bot's button panels sit in even rows that fit a phone (#3317).

Patrick, 22 Oct 2026, with a phone screenshot of #choose-your-hold: "These
button layouts also need fixed". The hold panel put five holds in a row, and a
phone wrapped that row as four and then Markarth on its own, and the next as
three and then Winterhold on its own. This proves:

  L1 the hold panel is three rows of three holds and Raven Rock on its own
     (Patrick, 22 Oct, q-3317-raven-rock, A), in HOLDS order, with the two ping
     buttons in a row of their own under them: five rows, Discord's most
  L2 no row of any persistent panel has more than three buttons
  L3 a posted panel laid out the old way (five, four, two) is not taken for
     current, so the bot's start rewrites it; one laid out as wanted is current
  L4 the office panel is one row per office, Add beside Remove

bot.py is imported for real. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: F401,E402
except ImportError:
    print('SKIP  discord.py is not installed here, so the bot cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
bot.log = lambda *a: None


def rows_of(view):
    """{row: [custom_id, ...]} of a View, in the order its items were added."""
    out = {}
    for item in view.children:
        out.setdefault(item.row, []).append(item.custom_id)
    return [out[r] for r in sorted(out)]


def posted(rows, content):
    """A message as Discord hands a posted panel back: action rows of buttons."""
    return types.SimpleNamespace(content=content, components=[
        types.SimpleNamespace(children=[types.SimpleNamespace(custom_id=i) for i in row])
        for row in rows])


async def main():
    hold = rows_of(bot.HoldPanel())
    office = rows_of(bot.OfficePanel())
    holds = ['thornswood:hold:' + h.lower() for h in bot.HOLDS]
    pings = ['thornswood:ping:' + k for k, _, _ in bot.PINGS]

    yes('L1 ten holds in three rows of three and Raven Rock, in order, then the pings',
        len(bot.HOLDS) == 10 and bot.HOLDS[-1] == 'Raven Rock'
        and hold == [holds[0:3], holds[3:6], holds[6:9], holds[9:], pings])
    yes('L1 what the bot checks a posted panel against is that same layout',
        bot._hold_rows_wanted() == hold)
    yes('L2 no row of the hold or office panel has more than three buttons',
        all(len(r) <= 3 for r in hold + office))

    old = posted([holds[0:5], holds[5:10], pings], bot.HOLD_PANEL)
    yes('L3 a panel posted five to a row is not current, so it is rewritten',
        not bot.hold_panel_is_current(old))
    yes('L3 a panel posted as wanted is current, so nothing is asked of Discord',
        bot.hold_panel_is_current(posted(hold, bot.HOLD_PANEL)))

    yes('L4 the office panel is one row per office, Add beside Remove',
        len(office) == len(bot.OFFICES) and all(
            r == ['thornswood:office:add:' + o, 'thornswood:office:remove:' + o]
            for r, (o, _) in zip(office, bot.OFFICES)))


asyncio.run(main())

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
