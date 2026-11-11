"""
Planned restarts of the game servers, said in Discord before they happen.

Part of the bot: bot.py loads it (#5784).
"""
import asyncio
import json
import os
import time

import discord

from bot_base import DATA_DIR
from bot_core import _int_env, _state_read, _state_write, client, log
from bot_news import DEV_NEWS_ID, NEWS_DIR
from bot_notices import _github_time


# On 11 Nov 2026 the live server went down twice and Discord heard nothing:
# the deploy agent swapped in build-1.3.20's server build at 11:12 AM, and
# nothing that restarts a game server said so in #updates, the channel whose
# topic is "Restarts and outages" and whose Updates Pings role promises a
# ping for them (bot_holds.py).
#
# Now whatever stops a game server for a planned restart first leaves a notice
# in the folder the release news uses (NEWS_DIR), restart-<environment>.json:
# its id, its state, when the server goes down (downUtc) and why. The deploy
# agent writes it before a server build swap (tools\DeployAgent\
# RestartNotice.cs), then waits out its lead (five minutes for main) before
# the stop. Each pass here reads them and, for each id:
#   - "coming": posted once, ahead, with the time it goes down in each
#     reader's own clock, pinging Updates Pings for the live server;
#   - "back", "down" or "off": posted once after its "coming" was, saying the
#     server is back, did not come back, or the restart was called off.
# A live server's notice goes to #updates, a dev one to the dev updates
# channel. A "coming" whose time is over RESTART_STALE gone is written down
# unposted, and so is an end whose "coming" was never posted: news of a
# restart nobody was warned of helps nobody after the fact. With no
# restarts-said.json yet, what is there is written down unposted, so a first
# start never announces an old restart.
RESTART_SAID = os.path.join(DATA_DIR, 'restarts-said.json')
# Often: dev's lead is a minute, and the post has to land inside it.
RESTART_EVERY = max(5, _int_env('RESTART_EVERY', 15))
RESTART_STALE = 15 * 60
RESTART_KEEP = 200
RESTART_STATES = ('coming', 'back', 'down', 'off')
# #updates is found by its place in the plan (bot\Build-Discord.py: the
# Information category's "updates"), because no file names its id yet;
# UPDATES_CHANNEL_ID names it outright. The id found is said in the log once.
UPDATES_CHANNEL_ID = _int_env('UPDATES_CHANNEL_ID', 0)
UPDATES_CATEGORY = 'information'
UPDATES_NAME = 'updates'
UPDATES_PING_ROLE = 'Updates Pings'


def restart_docs(folder=None):
    """Every restart-*.json in the folder as a dict, [] when there is no
       folder, and None when it is there and cannot be read. A file that is
       not a notice is left out."""
    folder = NEWS_DIR if folder is None else folder
    try:
        names = sorted(n for n in os.listdir(folder)
                       if n.startswith('restart-') and n.endswith('.json'))
    except FileNotFoundError:
        return []
    except OSError:
        return None
    out = []
    for n in names:
        try:
            with open(os.path.join(folder, n), encoding='utf-8-sig') as f:
                doc = json.load(f)
        except (OSError, ValueError):
            continue
        if (isinstance(doc, dict) and str(doc.get('id') or '').strip()
                and doc.get('state') in RESTART_STATES
                and _github_time(doc.get('downUtc')) is not None):
            out.append(doc)
    return out


def restart_channel_of(env):
    """The live server's restarts go to #updates, every other one's to the
       dev updates channel."""
    return 'main' if str(env or '').lower() == 'main' else 'dev'


def restart_plan(docs, state, now):
    """(doc, what) for each notice with something to do: 'coming' or 'end'
       to post, 'skip' to write down unposted."""
    said = state.get('said') or {}
    out = []
    for doc in sorted(docs, key=lambda d: str(d.get('downUtc') or '')):
        rid = str(doc['id']).strip()
        had = said.get(rid)
        st = doc['state']
        if had is None:
            down = _github_time(doc.get('downUtc'))
            if st == 'coming' and now - down <= RESTART_STALE:
                out.append((doc, 'coming'))
            else:
                out.append((doc, 'skip'))
        elif st != 'coming' and not had.get('end') and had.get('coming'):
            out.append((doc, 'end'))
    return out


def restart_text(doc, what, ping=''):
    """What is posted: the time is Discord's own <t:...>, so each reader
       sees it in their own clock."""
    live = restart_channel_of(doc.get('environment')) == 'main'
    server = 'The server' if live else 'The dev server'
    why = str(doc.get('why') or '').strip() or 'an update'
    down = int(_github_time(doc.get('downUtc')))
    if what == 'coming' and str(doc.get('logOut') or '').lower() == 'yes':
        # The whole machine restarts (the deploy agent's WindowsRestart.cs):
        # everybody on it is put out for a few minutes.
        text = ('%s goes down for %s at <t:%d:t> (<t:%d:R>), for a few '
                'minutes while the machine it runs on restarts. If you are on '
                'it, log out somewhere safe before then.' % (server, why, down, down))
        return (ping + ' ' + text) if ping else text
    if what == 'coming':
        text = ('%s restarts for %s at <t:%d:t> (<t:%d:R>). If you are on it, '
                'the world freezes for a moment and carries on: you do not '
                'need to log out, but do not be mid fight. Joining around '
                'then may take a second try.' % (server, why, down, down))
        return (ping + ' ' + text) if ping else text
    st = doc['state']
    if st == 'back':
        return '%s is back up after the restart.' % server
    if st == 'off':
        return 'The restart at <t:%d:t> is called off. %s stays up.' % (down, server)
    return ('%s did not come back after the restart. Staff have been '
            'alerted.' % server)


async def restarts_once(state, docs, send, save, now=None):
    """
    One pass. send(channel, doc, what) posts and gives the message or None.
    state is restarts-said.json's dict, changed in place; save(state) after
    each notice written down. Returns the (id, what) done this pass. A post
    that fails is left for the next pass.
    """
    now = time.time() if now is None else now
    said = state.setdefault('said', {})
    done = []
    for doc, what in restart_plan(docs, state, now):
        rid = str(doc['id']).strip()
        channel = restart_channel_of(doc.get('environment'))
        if what == 'skip':
            said[rid] = {'at': int(now), 'coming': None, 'end': doc['state'], 'how': 'unposted'}
        else:
            msg = await send(channel, doc, what)
            if msg is None:
                continue
            rec = said.setdefault(rid, {'at': int(now)})
            if what == 'coming':
                rec['coming'] = getattr(msg, 'id', True)
            else:
                rec['end'] = doc['state']
                rec['endMessage'] = getattr(msg, 'id', None)
        for old in sorted(said, key=lambda r: said[r].get('at') or 0)[:-RESTART_KEEP]:
            said.pop(old, None)
        save(state)
        done.append((rid, what))
    return done


def updates_channel():
    """#updates: by UPDATES_CHANNEL_ID, or else the Information category's
       channel named updates. None when there is no such one."""
    if UPDATES_CHANNEL_ID:
        return client.get_channel(UPDATES_CHANNEL_ID)
    for g in client.guilds:
        for ch in g.text_channels:
            cat = getattr(ch, 'category', None)
            if (ch.name == UPDATES_NAME and cat is not None
                    and cat.name.lower() == UPDATES_CATEGORY):
                return ch
    return None


def _ping_role(ch):
    guild = getattr(ch, 'guild', None)
    for r in getattr(guild, 'roles', None) or []:
        if r.name.lower() == UPDATES_PING_ROLE.lower():
            return r
    return None


async def _restart_send(channel, doc, what, said_once):
    if channel == 'main':
        ch = updates_channel()
        where = '#updates'
    else:
        ch = client.get_channel(DEV_NEWS_ID) if DEV_NEWS_ID else None
        where = 'the dev updates channel'
    if ch is None:
        if channel not in said_once:
            log('restarts: %s is not a channel this bot can see, so restart '
                'notices for it wait unposted' % where)
            said_once.add(channel)
        return None
    if ('found ' + channel) not in said_once:
        log('restarts: %s is channel %d' % (where, ch.id))
        said_once.add('found ' + channel)
    role = _ping_role(ch) if (channel == 'main' and what == 'coming') else None
    text = restart_text(doc, what, ping=role.mention if role else '')
    try:
        msg = await ch.send(text, allowed_mentions=discord.AllowedMentions(
            everyone=False, users=False, roles=[role] if role else False))
    except Exception as ex:
        if channel not in said_once:
            log('restarts: could not post in %s: %s' % (where, type(ex).__name__))
            said_once.add(channel)
        return None
    said_once.discard(channel)
    return msg


async def watch_restarts():
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    state = _state_read(RESTART_SAID)
    if state is None:
        log('restarts: %s will not read, so no restart is posted until it is '
            'fixed by hand (posting from empty could say an old restart again)'
            % RESTART_SAID)
        return
    said_once = set()
    first = not os.path.exists(RESTART_SAID)
    while not client.is_closed():
        try:
            docs = await loop.run_in_executor(None, restart_docs)
            if docs is None:
                if 'folder' not in said_once:
                    log('restarts: %s will not read, so no restart is posted' % NEWS_DIR)
                    said_once.add('folder')
            elif first:
                for doc in docs:
                    state.setdefault('said', {})[str(doc['id']).strip()] = {
                        'at': int(time.time()), 'coming': None, 'end': doc['state'], 'how': 'before'}
                _state_write(RESTART_SAID, state)
                first = False
                log('restarts: started a record in %s; restarts from now are posted'
                    % RESTART_SAID)
            else:
                said_once.discard('folder')
                done = await restarts_once(
                    state, docs, lambda c, d, w: _restart_send(c, d, w, said_once),
                    lambda s: _state_write(RESTART_SAID, s))
                for rid, what in done:
                    log('restarts: %s %s' % (rid, what))
        except Exception as e:
            log('restarts: a pass failed: %s' % type(e).__name__)
        await asyncio.sleep(RESTART_EVERY)
