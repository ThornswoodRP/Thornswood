#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wipe-Channels.py

One-off (#3336): deletes the messages of every channel in the Discord except the ones
that say how the place works. Patrick, 22 Oct 2026: "clean up and delete all
the messages in every channel in the discord besides rules, instructions,
documentation, known issues, and test tasks. Everything else can be deleted
we have already recorded all suggestions and all the test findings", and,
the same morning, both news channels and #staff-updates, so today starts
clean under the rules written since.

    python Wipe-Channels.py --env-file C:\\Thornswood-Bot\\bot.env.json
        says, channel by channel, what is kept and what would go, with how
        many messages and threads; deletes nothing
    python Wipe-Channels.py --env-file C:\\Thornswood-Bot\\bot.env.json --go
        deletes it

KEPT, whole, threads and all:
  - a channel whose name has rules, known-issues, test-tasks, instructions
    or documentation in it (#rules, #game-rules, #gm-rules, #known-issues,
    #test-tasks, #dev-test-tasks, #test-tasks-archive, and any channel of
    those words a new layout makes);
  - the channels that are the instructions and documentation: #welcome,
    #start-here, #faq, #lore, the ticket panel's channel
    (#tickets-and-applications, #applications) and #choose-your-hold;
  - the records, unless --wipe-records: the staff log of closed tickets
    (#tickets, #ticket-log in the #3317 layout) and #gm-discipline, which
    Patrick chose to keep on 22 Oct. A ticket is a private thread off the
    panel's channel, so open applications and the closed tickets the privacy
    page keeps for 365 days stay with it;
  - --keep NAME, as many as wanted, for anything else.

EVERYTHING ELSE goes: every message in every text, announcement and voice
channel, and every thread, open or archived, public or private, including
every post in a forum. Both #news channels and #staff-updates included. In a
channel that goes, these of the bot's stay: its panels (buttons or a menu),
which it only edits and its views answer; the doc it pinned; and a channel's
Changelog thread with the line that opens it, the record of what its doc
said (#3336: the first run took #news's).

Messages younger than two weeks go a hundred at a time; Discord deletes an
older one only by itself, so a channel with years of chat takes a while.
discord.py waits out each rate limit on its own.

It logs in over HTTP only, never the gateway, so the running bot keeps its
one session and nothing it does is disturbed. It reads DISCORD_TOKEN, from
--env-file the way bot.py --env-file does, and prints no secret. It posts
nothing anywhere. Run it on the box, in the bot's folder, with the bot's
python, the same as backfill.py.

  --only NAME   only that channel (as many as wanted): for a first, small run
  --go          deletes; without it nothing is deleted

Exit 0 when everything planned went (or, without --go, could be read), 1
when a channel or a message could not be read or deleted, each one named.
"""
import argparse
import asyncio
import json
import os
import re
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# A channel is kept when its name has one of these in it.
KEEP_WORDS = ('rules', 'known-issues', 'test-tasks', 'instructions',
              'documentation')
# And when its name is one of these.
KEEP_NAMES = frozenset(('welcome', 'start-here', 'faq', 'lore', 'factions',
                        'tickets-and-applications', 'applications',
                        'choose-your-hold'))
# Kept unless --wipe-records: what staff keep about people.
RECORD_NAMES = frozenset(('tickets', 'ticket-log', 'gm-discipline'))


def plain(name):
    """A channel's name as compared: lower case, without the emoji or
       separator a layout may put in front of it ("📜┃rules" is rules)."""
    n = (name or '').strip().lower()
    for sep in ('┃', '|', '・', '︱'):
        if sep in n:
            n = n.rsplit(sep, 1)[1]
    return re.sub(r'^[^a-z0-9]+', '', n).strip()


def why_kept(name, keep=(), wipe_records=False):
    """Why a channel of this name is kept, or '' when it is wiped."""
    n = plain(name)
    if n in {plain(k) for k in keep}:
        return 'named with --keep'
    for w in KEEP_WORDS:
        if w in n:
            return 'its name says ' + w
    if n in KEEP_NAMES:
        return 'it is the ' + ('ticket panel' if 'applications' in n else
                               'hold panel' if n == 'choose-your-hold' else
                               'instructions')
    if n in RECORD_NAMES and not wipe_records:
        return 'it is a record staff keep (--wipe-records takes it)'
    return ''


# The thread every doc channel keeps its changelog in (Apply-Discord.py,
# #3317). Never deleted, in any channel: the first wipe took #news's (#3336).
CHANGELOG = 'Changelog'


def is_panel(message, bot_id):
    """A message of the bot's that stays in a channel that is wiped: a panel
       it edits (buttons or a menu), the doc it pinned, or the line that
       opens its Changelog thread."""
    author = getattr(getattr(message, 'author', None), 'id', None)
    if bot_id is None or author != bot_id:
        return False
    if getattr(message, 'components', None) or getattr(message, 'pinned', False):
        return True
    return (getattr(message, 'type', None) == getattr(getattr(discord, 'MessageType', None), 'thread_created', object())
            and (getattr(message, 'content', '') or '') == CHANGELOG)


def keeps_thread(thread):
    """A thread that stays in a channel that is wiped: a Changelog."""
    return getattr(thread, 'name', None) == CHANGELOG


def _load_env_file(argv):
    if '--env-file' not in argv:
        return
    at = argv.index('--env-file')
    with open(argv[at + 1], encoding='utf-8-sig') as f:
        for k, v in json.load(f).items():
            os.environ[str(k)] = str(v)


def say(*a):
    print('[wipe]', *a, flush=True)


async def _threads(guild, channels):
    """Every thread of the server, open and archived, by its parent's id."""
    out = {}
    try:
        for t in await guild.active_threads():
            out.setdefault(t.parent_id, {})[t.id] = t
    except Exception as e:
        say('could not list the open threads: %s: %s' % (type(e).__name__, e))
        raise
    for ch in channels:
        kinds = []
        if getattr(ch, 'type', None) == discord.ChannelType.forum:
            kinds = [{}]
        elif isinstance(ch, discord.TextChannel):
            kinds = [{'private': False}, {'private': True}]
        for kw in kinds:
            async for t in ch.archived_threads(limit=None, **kw):
                out.setdefault(ch.id, {})[t.id] = t
    return out


async def _count(ch, bot_id):
    n = panels = 0
    async for m in ch.history(limit=None):
        if is_panel(m, bot_id):
            panels += 1
        else:
            n += 1
    return n, panels


async def work(args):
    guilds = [g async for g in client.fetch_guilds(limit=None)]
    if len(guilds) != 1:
        say('the bot is in %d servers; this is for the one Thornswood server'
            % len(guilds))
        return 1
    guild = await client.fetch_guild(guilds[0].id)
    bot_id = client.user.id
    channels = await guild.fetch_channels()
    cats = {c.id: c.name for c in channels
            if isinstance(c, discord.CategoryChannel)}
    rooms = [c for c in channels if not isinstance(c, discord.CategoryChannel)]
    rooms.sort(key=lambda c: (getattr(c, 'category_id', 0) or 0, c.position))
    only = {plain(o) for o in args.only}
    if only:
        rooms = [c for c in rooms if plain(c.name) in only]
        missing = only - {plain(c.name) for c in rooms}
        if missing:
            say('no channel called %s, so nothing was done'
                % ', '.join('#' + m for m in sorted(missing)))
            return 1
    say('server: %s, %d channels%s' % (guild.name, len(rooms),
                                       '' if args.go else ' (nothing is deleted without --go)'))
    threads = await _threads(guild, rooms)
    failed = 0
    gone_msgs = gone_threads = 0
    for ch in rooms:
        where = '#%s (%s)' % (ch.name, cats.get(getattr(ch, 'category_id', None), 'no category'))
        why = why_kept(ch.name, args.keep, args.wipe_records)
        mine = [t for t in (threads.get(ch.id) or {}).values() if not keeps_thread(t)]
        if why:
            say('KEEP  %s: %s' % (where, why))
            continue
        readable = hasattr(ch, 'history') and getattr(ch, 'type', None) != discord.ChannelType.forum
        try:
            if not args.go:
                n, panels = (await _count(ch, bot_id)) if readable else (0, 0)
                say('WIPE  %s: would delete %d message(s) and %d thread(s)%s'
                    % (where, n, len(mine),
                       ', keeps %d panel(s) of the bot\'s' % panels if panels else ''))
                continue
            for t in mine:
                await t.delete()
                gone_threads += 1
            n = 0
            if readable:
                done = await ch.purge(limit=None, check=lambda m: not is_panel(m, bot_id),
                                      bulk=True, reason='Clean start, 22 Oct 2026 (Patrick)')
                n = len(done)
                gone_msgs += n
            say('WIPED %s: %d message(s), %d thread(s)' % (where, n, len(mine)))
        except Exception as e:
            failed += 1
            say('FAILED %s: %s: %s' % (where, type(e).__name__, e))
    if args.go:
        say('deleted %d message(s) and %d thread(s); %d channel(s) failed'
            % (gone_msgs, gone_threads, failed))
    return 1 if failed else 0


def main(argv):
    p = argparse.ArgumentParser(description='Deletes the messages of every '
                                'channel but rules, instructions, documentation, known issues and test tasks.')
    p.add_argument('--env-file')
    p.add_argument('--go', action='store_true')
    p.add_argument('--keep', action='append', default=[])
    p.add_argument('--only', action='append', default=[])
    p.add_argument('--wipe-records', action='store_true')
    args = p.parse_args(argv)
    _load_env_file(['--env-file', args.env_file] if args.env_file else [])
    token = os.environ.get('DISCORD_TOKEN', '').strip()
    if not token:
        raise SystemExit('No DISCORD_TOKEN. Pass --env-file with the bot\'s bot.env.json.')
    return asyncio.run(_run(token, args))


async def _run(token, args):
    global client
    try:
        await client.login(token)
        return await work(args)
    except Exception:
        say('failed:\n' + traceback.format_exc())
        return 1
    finally:
        await client.close()


if __name__ == '__main__':
    # The bot's own roots, the way bot.py trusts them (#3111), made at login
    # in a folder of its own, never the bot's data folder (trust.own_context).
    import trust
    import discord
    client = trust.client_class()(intents=discord.Intents.none())
    sys.exit(main(sys.argv[1:]))
else:
    import discord  # noqa: E402  (the test reads the rules without a client)
    client = None
