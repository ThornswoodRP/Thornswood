"""
redraw.py

One-off: the join cards that went up before card.py learned to draw dressed-up
names came out as a row of boxes. This finds every card of the bot's in the
welcome channels whose person has a name the old card could not draw, draws
it again with the current card.py, and swaps the picture on the existing
message. No new messages, no new pings.

    python redraw.py          list the cards it would redraw, change nothing
    python redraw.py --go     redraw them
    python redraw.py --all    every card, not only the ones that had boxes

Reads the same bot.env.json as the bot (its service puts it in the environment).
The number on the card is the one joins.json holds for that person, read
through bot.py's own functions, so a redrawn card says what the bot gave
them. Somebody the record has no number for, because their card went up
before the bot kept one, gets the old rule, their place in the join order
among the members still here, and the line for them says so. A record that is
there and cannot be read stops the run: redrawing with guesses is how two
cards came to say "The 28th to walk in".

It reads joins.json and never writes it. Redrawing swaps a picture on a card
that is already up; it gives nobody a number, so it has nothing to record.
The record is the one beside this file, so run it in the bot's folder on the
VPS; anywhere else there is none and every number is the old rule.
"""
import asyncio
import os
import re
import sys
import traceback

import discord

import bot_base
import bot_joins
import card

TOKEN = os.environ.get('DISCORD_TOKEN', '').strip()
WELCOME = os.environ.get('JOIN_CHANNEL', 'welcome-travelers').strip()
GO = '--go' in sys.argv
ALL = '--all' in sys.argv
CHANNELS = [WELCOME, 'general-chat', 'general']

if not TOKEN:
    raise SystemExit('No DISCORD_TOKEN in the environment. Set it from bot.env.json first.')

intents = discord.Intents(guilds=True, members=True)
# The bot's own client class, which verifies against the bot's roots alone
# and never the machine's stores (#3111, #3604).
client = bot_base.TrustedClient(intents=intents)


def say(*a):
    print('[redraw]', *a, flush=True)


def dressed(name):
    """True when the old card would have drawn boxes: anything outside the
       letters, digits and punctuation Georgia carries."""
    return bool(re.search(r'[^\u0000-\u024F\u2000-\u206F]', name or ''))


def number(who, given, order):
    """The number joins.json holds for this member, and '' to go with it. For
       somebody it has no number for, their place in the join order, and why,
       including when that number is one the record gave somebody else."""
    n = given.get(who.id)
    if n is not None:
        return n, ''
    n = order.get(who.id)
    why = ' (not in joins.json, so by join order among the members still here'
    if n in given.values():
        why += ', which repeats a number joins.json gave somebody else'
    return n, why + ')'


@client.event
async def on_ready():
    try:
        await work()
    except Exception:
        say('failed:\n' + traceback.format_exc())
    finally:
        await client.close()


async def work():
    guild = client.guilds[0]
    say('server: %s, %d members' % (guild.name, guild.member_count))

    members = [m async for m in guild.fetch_members(limit=None)]
    members = [m for m in members if m.joined_at is not None]
    members.sort(key=lambda m: m.joined_at)
    order = {}
    for i, m in enumerate(members):
        order[m.id] = i + 1
    byid = {}
    for m in members:
        byid[m.id] = m

    try:
        given = bot_joins.joins_given(guild)
    except Exception:
        say('could not read %s, so nothing is redrawn: every number would be '
            'a guess that can disagree with it.\n%s'
            % (bot_joins.JOINS, traceback.format_exc()))
        return
    if os.path.exists(bot_joins.JOINS):
        say('%d numbers in %s' % (len(given), bot_joins.JOINS))
    else:
        say('no %s here, so every number below is by join order' % bot_joins.JOINS)

    todo = []
    for n in CHANNELS:
        ch = discord.utils.get(guild.text_channels, name=n)
        if ch is None:
            continue
        try:
            async for msg in ch.history(limit=1000):
                if msg.author.id != guild.me.id:
                    continue
                if 'came up the road' not in (msg.content or ''):
                    continue
                if not msg.mentions:
                    continue
                who = byid.get(msg.mentions[0].id)
                if who is None:
                    say('skipping a card for someone no longer here: %s' % msg.mentions[0])
                    continue
                name = who.display_name or who.name
                if ALL or dressed(name):
                    todo.append((ch, msg, who))
        except Exception:
            say('could not read #%s:\n%s' % (n, traceback.format_exc()))

    if not todo:
        say('nothing to redraw')
        return
    for ch, msg, who in todo:
        name = who.display_name or who.name
        n, why = number(who, given, order)
        say('#%s %s -> card will read %r, number %d%s' % (
            ch.name, msg.jump_url, card.shown_name(name, who.name), n or 0, why))

    if not GO:
        say('dry run, nothing changed. Run with --go to redraw them.')
        return

    for ch, msg, who in todo:
        name = who.display_name or who.name
        n, why = number(who, given, order)
        try:
            avatar = who.display_avatar.replace(size=256, format='png')
            data = await avatar.read()
            png = await asyncio.get_running_loop().run_in_executor(
                None, card.render, name, data, n or None, None, who.name)
            await msg.edit(attachments=[discord.File(png, 'welcome.png')])
            say('redrew the card for %s, number %d%s' % (who, n or 0, why))
        except Exception:
            say('failed for %s:\n%s' % (who, traceback.format_exc()))
        await asyncio.sleep(1.5)


# Under a main guard, as bot.py is, so test-join-scripts.py can import this
# and run work() against a stand-in server. `python redraw.py` runs it as
# before.
if __name__ == '__main__':
    client.run(TOKEN, log_handler=None)
