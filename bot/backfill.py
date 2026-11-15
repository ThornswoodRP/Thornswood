"""
backfill.py

One-off: post the join card for everybody who came in while the bot had no
channel to post it in (#general had been renamed, so on_member_join logged
"no text channel called #general to greet in" and gave up).

    python backfill.py          list who would get a card, post nothing
    python backfill.py --go     post them, oldest join first

Reads the same bot.env.json as the bot (its service puts it in the environment).
Who already has a card is worked out from the channels themselves: every card
message is the bot's, says "came up the road." and mentions the person, so the
mentioned ids across #welcome-travelers and #general-chat are the people done.
Anybody else who joined after the newest existing card, and is not a bot, is
owed one. Their number is the one joins.json holds for them, read through
bot.py's own functions; it holds one when the bot numbered them and the
greeting then failed. Somebody it has no number for, which is everybody who
arrived while the bot had nowhere to greet, gets the old rule, their place in
the join order among the members still here, and the line for them says so,
and says when that number is one the record already gave somebody else. A
record that is there and cannot be read stops the run, and so does a channel
whose history cannot be read, since the cards in it could not be counted
(#4227). Anything that fails makes the script end 1.

It reads joins.json and never writes it, as it never wrote anything before:
it put numbers on cards and kept no record of them. The bot writes the record
on every join, and a second process writing the whole file while the bot runs
could put back a copy from before a number the bot has just given out.
The record is the one in the bot's data folder (bot_base.py), so run it in the
bot's folder on the VPS; anywhere else there is none and every number is the
old rule.
"""
import asyncio
import os
import sys
import traceback

import discord

import bot_base
import bot_joins
import card

TOKEN = os.environ.get('DISCORD_TOKEN', '').strip()
WELCOME = os.environ.get('JOIN_CHANNEL', 'welcome-travelers').strip()
GO = '--go' in sys.argv

if not TOKEN:
    raise SystemExit('No DISCORD_TOKEN in the environment. Set it from bot.env.json first.')

intents = discord.Intents(guilds=True, members=True)
# The bot's own client class, which verifies against the bot's roots alone
# and never the machine's stores (#3111, #3604).
client = bot_base.TrustedClient(intents=intents)


def say(*a):
    print('[backfill]', *a, flush=True)


# Every failure the run met, as one line each. Any at all and the script ends
# 1, so whatever runs it sees the run failed (#4227); it used to end 0 after
# anything, since on_ready catches what work() raises.
FAILED = []


def fail(line):
    FAILED.append(line)
    say(line)


def exit_code():
    return 1 if FAILED else 0


async def done_ids(guild, names):
    """User ids that already have a card, when the newest card was posted, and
       the channels whose history could not be read. Cards in one of those are
       not counted, so the ids are only the whole answer when it is empty."""
    ids = set()
    newest = None
    unread = []
    for n in names:
        ch = discord.utils.get(guild.text_channels, name=n)
        if ch is None:
            continue
        try:
            async for m in ch.history(limit=1000):
                if m.author.id != guild.me.id:
                    continue
                if 'came up the road' not in (m.content or ''):
                    continue
                for u in m.mentions:
                    ids.add(u.id)
                if newest is None or m.created_at > newest:
                    newest = m.created_at
        except Exception:
            unread.append(n)
            say('could not read #%s:\n%s' % (n, traceback.format_exc()))
    return ids, newest, unread


@client.event
async def on_ready():
    try:
        await work()
    except Exception:
        fail('failed:\n' + traceback.format_exc())
    finally:
        await client.close()


async def work():
    guild = client.guilds[0]
    say('server: %s, %d members' % (guild.name, guild.member_count))
    ch = discord.utils.get(guild.text_channels, name=WELCOME)
    if ch is None:
        fail('no text channel called #%s' % WELCOME)
        return

    members = [m async for m in guild.fetch_members(limit=None)]
    members = [m for m in members if m.joined_at is not None]
    members.sort(key=lambda m: m.joined_at)
    say('%d members with a join date' % len(members))

    have, newest, unread = await done_ids(guild, [WELCOME, 'general-chat', 'general'])
    if unread:
        # Who has a card is only known from every channel cards are in. With
        # one unread, the people whose cards are there look owed one, and
        # --go would post each of them a second, mention and all (#4227).
        fail('could not read %s, so nothing is posted: a card there would not '
             'be counted, and its person would be posted a second one. Give the '
             'bot Read Message History there and run it again.'
             % ', '.join('#' + n for n in unread))
        return
    say('%d people already have a card; newest card %s' % (len(have), newest.isoformat(timespec='minutes') if newest else 'none found'))

    try:
        given = bot_joins.joins_given(guild)
    except Exception:
        fail('could not read %s, so nothing is posted: every number would be '
             'a guess that can repeat one on it.\n%s'
             % (bot_joins.JOINS, traceback.format_exc()))
        return
    if os.path.exists(bot_joins.JOINS):
        say('%d numbers in %s' % (len(given), bot_joins.JOINS))
    else:
        say('no %s here, so every number below is by join order' % bot_joins.JOINS)

    owed = []
    for i, m in enumerate(members):
        if m.bot or m.id in have:
            continue
        if newest is not None and m.joined_at <= newest:
            continue
        number = given.get(m.id)
        why = ''
        if number is None:
            number = i + 1
            why = ' (not in joins.json, so by join order among the members still here'
            if number in given.values():
                why += ', which repeats a number joins.json gave somebody else'
            why += ')'
        owed.append((number, why, m))

    if not owed:
        say('nobody is owed a card')
        return
    for number, why, m in owed:
        say('owed: #%d %s (%s) joined %s%s' % (number, m.display_name or m.name, m, m.joined_at.isoformat(timespec='minutes'), why))

    if not GO:
        say('dry run, nothing posted. Run with --go to post them.')
        return

    for number, why, m in owed:
        name = m.display_name or m.name
        png = None
        try:
            avatar = m.display_avatar.replace(size=256, format='png')
            data = await avatar.read()
            png = await asyncio.get_running_loop().run_in_executor(None, card.render, name, data, number, None, m.name)
        except Exception:
            fail('card failed for %s:\n%s' % (m, traceback.format_exc()))
        line = '%s came up the road.' % m.mention
        try:
            if png is not None:
                await ch.send(line, file=discord.File(png, 'welcome.png'))
            else:
                await ch.send(line)
            say('posted #%d %s%s' % (number, m, why))
        except Exception:
            fail('posting failed for %s:\n%s' % (m, traceback.format_exc()))
        await asyncio.sleep(1.5)


# Under a main guard, as bot.py is, so test-join-scripts.py can import this
# and run work() against a stand-in server. `python backfill.py` runs it as
# before, and ends 1 when anything in the run failed.
if __name__ == '__main__':
    client.run(TOKEN, log_handler=None)
    raise SystemExit(exit_code())
