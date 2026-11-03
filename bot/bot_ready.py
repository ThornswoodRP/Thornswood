"""
The slash commands' registration, and on_ready.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import traceback

from bot_base import DATA_DIR
from bot_core import (UPPER_STAFF_IDS, WELCOME, _int_env, by_name, client, log,
    tree, warn_upper_staff_config)
from bot_joins import watch_join_numbers
from bot_holds import ensure_hold_panel
from bot_staff_channel import watch_trouble
from bot_reports import watch_reports
from bot_tickets import watch_closed_tickets
from bot_ticket_panels import ensure_panel, watch_lines
from bot_offices import ensure_office_panel, ensure_office_roles
from bot_factions import ensure_faction_panel
from bot_github import KNOWN_REPO, github_token_kind
from bot_roadmap import watch_known_issues
from bot_notices import watch_staff_notices
from bot_news import watch_release_news
from bot_watchdog import watch_services
from bot_problems import ensure_problem_panel, watch_problems
from bot_moderation import watch_moderation


# on_ready fires again on every reconnect, and a second loop would double every
# message this ever sends.
_watching = False


# What was last registered with Discord, so a restart does not do it all
# again. Next to the code, because that folder is the bot's own and a deploy
# that replaces it is a deploy that may have changed the commands anyway.
STAMP = os.path.join(DATA_DIR, 'commands-synced.json')

# Set FORCE_COMMAND_SYNC=1 in bot.env.json to make the next start register them
# whatever the stamp says. For the case where Discord has them and this file
# does not, which is a deploy that landed on a fresh folder.
FORCE_SYNC = _int_env('FORCE_COMMAND_SYNC', 0)


def _children_of(command):
    """
    A group's subcommands, and nothing at all for a plain command.

    Read by attribute rather than by type, because the ready harness stands a
    counting object in for the tree and never imports a real Group.
    """
    got = getattr(command, 'commands', None)
    return list(got) if got else []


def _command_names():
    """
    Every name Discord has to be told about, sorted: the groups, and their
    children under them.

    THE SCHEME. A child is written under its parent with a space between
    them, the way a person types it in the picker: `live-smoke` is in the
    list, and so are `live-smoke report` and the rest. Nested groups go on the
    same way, `parent child grandchild`. The stamp still holds a sorted list
    of plain strings, so a stamp written before this reads back fine; it is
    missing every child, which is exactly why the next start syncs.

    WHY IT IS NOT THE TOP LEVEL ALONE. It was, and adding a subcommand to a
    group that was already registered left this list identical. `/live-smoke
    report` was merged and deployed, the start said "slash commands already
    registered", no sync went to Discord, and the picker kept offering the
    three subcommands it had. It took FORCE_COMMAND_SYNC to put it there. A
    child is a command as far as the picker is concerned, so it is a name
    here.
    """
    out = []

    def walk(commands, prefix):
        for c in commands:
            name = (prefix + ' ' + c.name) if prefix else c.name
            out.append(name)
            walk(_children_of(c), name)

    walk(tree.get_commands(), '')
    return sorted(out)


def _stamp_read():
    try:
        with open(STAMP) as f:
            d = json.load(f)
        return list(d.get('commands') or []), [int(x) for x in (d.get('guilds') or [])]
    except Exception:
        return [], []


def _stamp_write(names, guilds):
    try:
        with open(STAMP, 'w') as f:
            json.dump({'commands': names, 'guilds': sorted(guilds)}, f)
    except Exception:
        log('could not write ' + STAMP + ', so the commands will be registered '
            'again on the next start:\n' + traceback.format_exc())


async def register_commands():
    """
    Put the slash commands on every server, once, and not again until they
    change.

    A global sync can take an hour to reach everybody, and it reaches people
    unevenly while it does, which looks exactly like one person's Discord
    being broken. Copying the commands onto the server itself and syncing that
    is immediate and the same for everyone in it.

    Registering both, which is what this did first, puts the command in the
    picker twice: Discord lists the server copy and the global copy as two
    separate entries and there is no way to tell them apart. So the guild copy
    is the one kept, and the global list is emptied straight after. Clearing
    globals is done last because copy_global_to reads that same list, and
    clearing it first would copy nothing.

    WHY IT IS BEHIND A STAMP. This was three writes to Discord per reconnect,
    doing nothing new every time, and a sync is one of the calls Discord rate
    limits hardest. A reconnect is not a new set of commands; a deploy is. So
    the names that were registered are written down beside the code, and this
    runs when that list differs, when a server appears that is not in it, or
    when FORCE_COMMAND_SYNC says to. A rate limited sync used to write a
    traceback on an evening that was already going badly.
    """
    want = _command_names()
    had, done = _stamp_read()
    fresh = [g for g in client.guilds if g.id not in done]

    if want == had and not fresh and not FORCE_SYNC:
        log('slash commands already registered: %s' % (', '.join(want) or 'none'))
        return

    synced = list(done)
    for g in client.guilds:
        try:
            tree.copy_global_to(guild=g)
            await tree.sync(guild=g)
            if g.id not in synced:
                synced.append(g.id)
            log('registered in "%s": %s'
                % (g.name, ', '.join('/' + n for n in want) or 'nothing'))
        except Exception:
            # Named rather than said as "the commands", because which ones
            # they are is the first thing anybody asks when none appear.
            log('could not register %s in "%s", the buttons still work:\n'
                % (', '.join('/' + n for n in want), g.name)
                + traceback.format_exc())
    try:
        tree.clear_commands(guild=None)
        await tree.sync()
    except Exception:
        log('could not clear the global commands, so a command may appear '
            'twice in the picker:\n' + traceback.format_exc())

    _stamp_write(want, synced)


@client.event
async def on_ready():
    global _watching
    if not _watching:
        _watching = True
        asyncio.create_task(watch_trouble())
        asyncio.create_task(watch_services())
        asyncio.create_task(watch_reports())
        asyncio.create_task(watch_problems())
        asyncio.create_task(watch_moderation())
        asyncio.create_task(watch_known_issues())
        asyncio.create_task(watch_staff_notices())
        asyncio.create_task(watch_release_news())
        asyncio.create_task(watch_join_numbers())
        asyncio.create_task(watch_closed_tickets())
        asyncio.create_task(watch_lines())

    log('up as %s' % client.user)
    log('github: the issues of %s, with a %s token' % (KNOWN_REPO, github_token_kind()))

    await register_commands()

    for g in client.guilds:
        await ensure_panel(g)
        await ensure_hold_panel(g)
        await ensure_office_roles(g)
        await ensure_office_panel(g)
        await ensure_faction_panel(g)
        await ensure_problem_panel(g)
    log('watching %d server(s)' % len(client.guilds))
    # Guilds are known here. Empty was already said in setup_hook. IDs
    # that match no role can only be seen once the guild's roles are in.
    # Log only: do not post this to a channel.
    if UPPER_STAFF_IDS:
        warn_upper_staff_config(client.guilds)

    # Three separate things have to be true for a join card to appear, and
    # when one of them is not, the only symptom is silence. So check all three
    # at startup and say which one is wrong, by name.

    # One: Discord has to be sending joins at all.
    if not client.intents.members:
        log('member joins: OFF. No join cards will ever fire. Turn on Server '
            'Members Intent at discord.com/developers, Bot page, then restart.')
        return
    log('member joins: on')

    for g in client.guilds:
        # Two: the channel has to exist, and be a text channel.
        ch = by_name(g, [WELCOME])
        if ch is None:
            names = ', '.join('#' + c.name for c in g.text_channels) or 'none'
            log('there is no text channel called #%s in "%s", so join cards '
                'have nowhere to go. Text channels there: %s. Either make one '
                'with that name, or set JOIN_CHANNEL in bot.env.json on the '
                'VPS to one of those and run Install-Bot.ps1 again.'
                % (WELCOME, g.name, names))
            continue

        # Three: the bot has to be allowed to post, and to attach the card.
        p = ch.permissions_for(g.me)
        missing = [n for n, ok in (('View Channel', p.view_channel),
                                   ('Send Messages', p.send_messages),
                                   ('Attach Files', p.attach_files)) if not ok]
        if missing:
            log('cannot post in #%s in "%s": the bot is missing %s there. Fix '
                'it in that channel\'s permissions, or give the bot role those '
                'permissions server wide.' % (ch.name, g.name, ', '.join(missing)))
        else:
            log('join cards will go to #%s in "%s"' % (ch.name, g.name))
