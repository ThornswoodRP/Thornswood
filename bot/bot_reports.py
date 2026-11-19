"""
What people send in on the site's public report page.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import hashlib
import json
import os
import traceback

import discord

from bot_core import (DATA_DIR, REPORTS_AT_ONCE, REPORTS_EVERY, REPORTS_FILE,
    _state_read, _state_write, as_typed, client, log)
from bot_staff_channel import _trouble_channel

REPORT_POSTS = os.path.join(DATA_DIR, 'report-posts.json')


def copy_key(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def source_key(kind, path):
    return copy_key(kind + '\n' + os.path.normcase(os.path.abspath(path)))


def copy_state(path):
    state = _state_read(path)
    if state is None or not all(
            isinstance(posts, dict) and all(
                isinstance(post, dict) and all(
                    type(post.get(field)) is int and post[field] > 0
                    for field in ('channel', 'message'))
                for post in posts.values())
            for posts in state.values()):
        log('staff copies: cannot read the message index; no linked copies handled')
        return None
    return state


def remember_copy(path, state, source, key, msg):
    if msg is not None:
        state.setdefault(source, {})[key] = {'channel': msg.channel.id, 'message': msg.id}
        _state_write(path, state)


async def forget_copies(path, state, source, present, client):
    """Act only on saved IDs for this source, never on channel history."""
    posts = state.get(source, {})
    changed = False
    for key in posts.keys() - present:
        post = posts[key]
        ch = client.get_channel(post['channel'])
        if ch is None:
            continue
        try:
            await ch.get_partial_message(post['message']).delete()
        except discord.NotFound:
            pass
        except Exception as e:
            log('staff copies: message removal failed (%s)' % type(e).__name__)
            continue
        del posts[key]
        changed = True
    if changed:
        if not posts:
            del state[source]
        _state_write(path, state)


def report_text(row):
    """
    One report from the public page, as the staff channel reads it.

    Every word of it was typed by a stranger with no account, so it is escaped
    before it goes anywhere near Discord: an @everyone in a title is text, not
    a ping, and a masked link is shown as what it is. as_typed is the same
    escaping the ticket threads use.
    """
    clean = as_typed

    by = clean(row.get('by'), 40)
    detail = clean(row.get('detail'), 400)
    kind = row.get('kind')

    # From inside the game (#414): /helpme and /report. The profile ids in
    # the detail are the client's claim, and the detail says so. A report
    # about somebody never pings: the send switches every mention off.
    if str(row.get('from') or '').startswith('in game'):
        where = ' on the dev server' if 'dev' in str(row.get('from')) else ''
        if kind == 'help':
            head = '**%s asked for help in game%s**' % (by or 'Somebody', where)
        else:
            head = ('**%s reported %s in game%s**'
                    % (by or 'Somebody', clean(row.get('about'), 60) or 'somebody',
                       where))
        return '%s\n%s%s' % (head, clean(row.get('title'), 300) or '(nothing said)',
                             ('\n' + detail) if detail else '')

    # A report about a person from the site, which the site only takes from
    # somebody signed in with Discord, so it always has a name and an account.
    if kind == 'report':
        acct = str(row.get('discordId') or '')
        return ('**%s reported %s on the site**%s.\n%s%s'
                % (by or 'Somebody', clean(row.get('about'), 60) or 'somebody',
                   (' (Discord <@%s>)' % acct) if acct.isdigit() else '',
                   clean(row.get('title'), 200) or '(no title)',
                   ('\n' + detail) if detail else ''))

    kind = 'An idea' if kind == 'idea' else 'A problem'
    return ('**%s sent in on the public report page**, %s.\n%s%s'
            % (kind,
               ('from ' + by) if by else 'with no name left',
               clean(row.get('title'), 200) or '(no title)',
               ('\n' + detail) if detail else ''))


async def report_say(text):
    """Same channel as trouble_say, with every mention switched off."""
    ch = _trouble_channel()
    if ch is None:
        return
    try:
        return await ch.send(text[:1900], suppress_embeds=True,
                             allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        log('reports: could not post in #%s:\n' % getattr(ch, 'name', '?')
            + traceback.format_exc())


async def watch_reports():
    """
    Say in the staff channel when somebody sends something in on the public
    report page.

    The page tells them "Somebody will read it", and until this the only place
    it could be read was the inbox on the hub, which nobody opens unless they
    already know something is there, and the To Do List has the hub going
    altogether. The site writes inbox.json on this same box, so this reads it
    the way watch_trouble reads trouble.json.

    Tickets are in that file as well and are left alone: they came from
    Discord, and their thread is already where staff read them.

    The ids already there when this starts are treated as said, for the same
    reason as watch_trouble. A file that is on disk but will not parse, which
    is what a read in the middle of the site writing it looks like, is waited
    out rather than read as empty, because empty would make every row in it
    new on the next look.
    """
    await client.wait_until_ready()

    def read_all(missing=None):
        try:
            with open(REPORTS_FILE, encoding='utf-8') as f:
                rows = json.load(f)
        except FileNotFoundError:
            return missing
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    # A problem from the game (#3155) is said by watch_problems once it is
    # on the board, with its issue number, so it is not said here as well.
    def public(row):
        return (isinstance(row, dict) and bool(row.get('id'))
                and row.get('kind') not in ('ticket', 'problem'))

    loop = asyncio.get_running_loop()
    source = source_key('reports', REPORTS_FILE)
    rows = await loop.run_in_executor(None, read_all, [])
    while rows is None:
        await asyncio.sleep(5)
        rows = await loop.run_in_executor(None, read_all, [])
    said = set(row['id'] for row in rows if public(row))
    ch = _trouble_channel()
    log('reports: watching %s every %ds, speaking in %s, %d already there and '
        'treated as said'
        % (REPORTS_FILE, REPORTS_EVERY,
           ('#' + ch.name) if ch is not None else 'NOWHERE, see above',
           len(said)))

    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, read_all)
            state = copy_state(REPORT_POSTS) if rows is not None else None
            if state is not None and all(isinstance(r, dict) and r.get('id') for r in rows):
                await forget_copies(REPORT_POSTS, state, source,
                                    {copy_key(str(r['id'])) for r in rows}, client)
            fresh = [r for r in (rows or []) if public(r) and r['id'] not in said]
            for r in fresh:
                said.add(r['id'])
            if len(fresh) > REPORTS_AT_ONCE:
                await report_say(
                    '**%d reports came in, from the site and the game,** since the '
                    'last look, which is more than people send and more than '
                    'this channel should carry one at a time. They are in the '
                    'inbox on the site.' % len(fresh))
            elif state is not None:
                # The file is newest first; the channel reads oldest first.
                for r in reversed(fresh):
                    key = copy_key(str(r['id']))
                    if key not in state.get(source, {}):
                        msg = await report_say(report_text(r))
                        remember_copy(REPORT_POSTS, state, source, key, msg)
        except Exception:
            log('reports: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)
