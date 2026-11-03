"""
What people send in on the site's public report page.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import traceback

import discord

from bot_core import (REPORTS_AT_ONCE, REPORTS_EVERY, REPORTS_FILE, as_typed,
    client, log)
from bot_staff_channel import _trouble_channel


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
        await ch.send(text[:1900], suppress_embeds=True,
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

    def read_all():
        try:
            with open(REPORTS_FILE, encoding='utf-8') as f:
                rows = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    # A problem from the game (#3155) is said by watch_problems once it is
    # on the board, with its issue number, so it is not said here as well.
    def public(row):
        return (isinstance(row, dict) and bool(row.get('id'))
                and row.get('kind') not in ('ticket', 'problem'))

    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(None, read_all)
    while rows is None:
        await asyncio.sleep(5)
        rows = await loop.run_in_executor(None, read_all)
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
            fresh = [r for r in (rows or []) if public(r) and r['id'] not in said]
            for r in fresh:
                said.add(r['id'])
            if len(fresh) > REPORTS_AT_ONCE:
                await report_say(
                    '**%d reports came in, from the site and the game,** since the '
                    'last look, which is more than people send and more than '
                    'this channel should carry one at a time. They are in the '
                    'inbox on the site.' % len(fresh))
            else:
                # The file is newest first; the channel reads oldest first.
                for r in reversed(fresh):
                    await report_say(report_text(r))
        except Exception:
            log('reports: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)
