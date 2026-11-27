"""
What people send in on the site's public report page.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import hashlib
import json
import os
import re
import traceback

import discord

from bot_core import (DATA_DIR, REPORTS_AT_ONCE, REPORTS_EVERY, REPORTS_FILE,
    _state_write, as_typed, client, log)
from bot_staff_channel import _trouble_channel

REPORT_POSTS = os.path.join(DATA_DIR, 'report-posts.json')


def copy_key(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def source_key(kind, path):
    return copy_key(kind + '\n' + os.path.normcase(os.path.abspath(path)))


def copy_post_valid(post):
    """One confirmed receipt or durable uncertain attempt, never both."""
    if not isinstance(post, dict) or type(post.get('channel')) is not int or post['channel'] <= 0:
        return False
    if set(post) == {'channel', 'message'}:
        return type(post['message']) is int and post['message'] > 0
    return (set(post) == {'channel', 'attempt', 'cursor'}
            and isinstance(post['attempt'], str) and len(post['attempt']) == 32
            and all(c in '0123456789abcdef' for c in post['attempt'])
            and type(post['cursor']) is int and post['cursor'] >= 0)


def copy_state(path):
    try:
        with open(path, encoding='utf-8') as f:
            state = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        log('staff copies: cannot read %s (%s)' % (path, type(e).__name__))
        return None
    if not isinstance(state, dict) or not all(
            isinstance(posts, dict) and all(copy_post_valid(post) for post in posts.values())
            for posts in state.values()):
        log('staff copies: invalid message index in %s' % path)
        return None
    return state


def remember_copy(state, source, key, msg):
    state.setdefault(source, {})[key] = {'channel': msg.channel.id, 'message': msg.id}


async def forget_copies(state, source, present, client):
    """Delete only saved IDs, after the last retained member of a summary expires."""
    posts = state.get(source, {})
    changed = False
    groups = {}
    for key, post in posts.items():
        if 'message' in post:
            groups.setdefault((post['channel'], post['message']), []).append(key)
    for (channel, message), keys in groups.items():
        expired = [key for key in keys if key not in present]
        if not expired:
            continue
        if not any(key in present for key in keys):
            ch = client.get_channel(channel)
            if ch is None:
                continue
            try:
                await ch.get_partial_message(message).delete()
            except discord.NotFound:
                log('staff copies: linked message already removed')
            except Exception as e:
                log('staff copies: message removal failed (%s)' % type(e).__name__)
                continue
        for key in expired:
            del posts[key]
        changed = True
    # Unresolved pending attempts stay indexed even after source expiry: they
    # may name a private message that still needs to be found and removed.
    if changed and not posts:
        del state[source]
    return changed


_COPY_NOTICES = set()
COPY_HISTORY_PAGE = 100


def copy_notice(key, text):
    """An actionable diagnostic once per condition, never a delivery receipt."""
    if key in _COPY_NOTICES:
        return False
    _COPY_NOTICES.add(key)
    log(text)
    return True


def copy_marker(attempt):
    return '\n-# Copy reference: ' + attempt


async def reconcile_copies(state, source, client):
    """Find pending attempts by exact bot-owned marker in the captured channel.

    Missing or incomplete history never proves a send was refused. A bounded
    page advances the cursor, but an unresolved attempt is never resent.
    """
    posts = state.get(source, {})
    attempts = {}
    for key, post in posts.items():
        if 'attempt' in post:
            attempts.setdefault(post['attempt'], []).append(key)
    changed = False
    for attempt, keys in attempts.items():
        post = posts[keys[0]]
        ch = client.get_channel(post['channel'])
        found, cursor = None, post['cursor']
        try:
            if ch is None:
                raise RuntimeError('captured channel is unavailable')
            async for msg in ch.history(limit=COPY_HISTORY_PAGE,
                                        after=discord.Object(id=cursor), oldest_first=True):
                cursor = max(cursor, msg.id)
                if (getattr(getattr(msg, 'author', None), 'id', None) == client.user.id
                        and getattr(getattr(msg, 'channel', None), 'id', None) == post['channel']
                        and str(getattr(msg, 'content', '')).endswith(copy_marker(attempt))):
                    found = msg
                    break
        except Exception as e:
            copy_notice((source, attempt, 'history'),
                        'staff copies: pending %s cannot read captured channel %s (%s); '
                        'delivery remains uncertain and will not be resent.'
                        % (attempt, post['channel'], type(e).__name__))
            continue
        if found is not None:
            for key in keys:
                remember_copy(state, source, key, found)
            changed = True
        else:
            for key in keys:
                if posts[key]['cursor'] != cursor:
                    posts[key]['cursor'] = cursor
                    changed = True
            copy_notice((source, attempt, 'pending'),
                        'staff copies: no confirmed message for pending %s in channel %s; '
                        'delivery remains uncertain and will not be resent. Check its copy reference.'
                        % (attempt, post['channel']))
    return changed


async def send_copy(path, state, source, keys, text, client):
    """Persist intent before sending; acknowledge only a confirmed saved receipt."""
    ch = _trouble_channel()
    if ch is None:
        copy_notice((source, 'channel'),
                    'staff copies: no staff channel is available; nothing was sent. '
                    'Repair the staff channel configuration before the next pass.')
        return False
    member = getattr(getattr(ch, 'guild', None), 'me', None)
    if member is not None:
        permissions = ch.permissions_for(member)
        can_send = (permissions.send_messages_in_threads if isinstance(ch, discord.Thread)
                    else permissions.send_messages)
        if not (permissions.view_channel and permissions.read_message_history and can_send):
            copy_notice((source, 'channel-permissions'),
                        'staff copies: staff channel permissions prevent delivery or reconciliation; '
                        'nothing was sent. Restore channel access before the next pass.')
            return False
    cursor = 0
    try:
        async for msg in ch.history(limit=1):
            cursor = msg.id
    except Exception as e:
        copy_notice((source, 'before-history'),
                    'staff copies: cannot read staff channel history (%s); nothing was sent. '
                    'Restore Read Message History before the next pass.' % type(e).__name__)
        return False
    attempt = os.urandom(16).hex()
    for key in keys:
        state.setdefault(source, {})[key] = dict(channel=ch.id, attempt=attempt, cursor=cursor)
    _state_write(path, state)  # A refusal here must prevent the outbound send.
    marker = copy_marker(attempt)
    try:
        msg = await report_say(text[:1900 - len(marker)] + marker, channel=ch, strict=True)
    except Exception as e:
        # discord.py retries the POST internally after some resets and 5xx
        # responses. Even a final 4xx says nothing about an earlier attempt.
        copy_notice((source, attempt, 'send'),
                    'staff copies: delivery %s is uncertain (%s); pending is saved '
                    'for reconciliation and will not be resent.' % (attempt, type(e).__name__))
        return False
    if (type(getattr(msg, 'id', None)) is not int or msg.id <= 0
            or getattr(getattr(msg, 'channel', None), 'id', None) != ch.id):
        copy_notice((source, attempt, 'response'),
                    'staff copies: delivery %s returned no usable receipt; it remains pending.' % attempt)
        return False
    for key in keys:
        remember_copy(state, source, key, msg)
    _state_write(path, state)  # On failure, disk still has the pending marker.
    return True


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
                   # ASCII digits alone (#7417): str.isdigit takes digits of
                   # other scripts too, and a mention of those is no Discord account.
                   (' (Discord <@%s>)' % acct) if re.fullmatch(r'[0-9]+', acct) else '',
                   clean(row.get('title'), 200) or '(no title)',
                   ('\n' + detail) if detail else ''))

    kind = 'An idea' if kind == 'idea' else 'A problem'
    return ('**%s sent in on the public report page**, %s.\n%s%s'
            % (kind,
               ('from ' + by) if by else 'with no name left',
               clean(row.get('title'), 200) or '(no title)',
               ('\n' + detail) if detail else ''))


async def report_say(text, *, channel=None, strict=False):
    """Same channel as trouble_say, with every mention switched off."""
    ch = channel if channel is not None else _trouble_channel()
    if ch is None:
        return
    try:
        return await ch.send(text[:1900], suppress_embeds=True,
                             allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        if strict:
            raise  # The receipt protocol logs the error class without private response details.
        log('reports: could not post in #%s:\n' % getattr(ch, 'name', '?')
            + traceback.format_exc())


async def watch_reports():
    """Deliver retained unacknowledged reports, including arrivals while offline.

    Confirmed receipt IDs survive restarts. Uncertain sends remain pending
    until the captured channel proves their exact bot-owned copy reference.
    Tickets and issue-filed problems use their own established delivery path.
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
    log('reports: watching %s every %ds using persisted delivery receipts'
        % (REPORTS_FILE, REPORTS_EVERY))

    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, read_all)
            state = copy_state(REPORT_POSTS) if rows is not None else None
            if state is None:
                count = sum(1 for row in rows or [] if public(row))
                if count and copy_notice((source, 'corrupt', count),
                                         'reports: receipt index unreadable; private copies are paused.'):
                    await report_say('**%d report%s remain in the site inbox.** Staff copies are '
                                     'paused because their saved receipts cannot be read.'
                                     % (count, '' if count == 1 else 's'))
                await asyncio.sleep(REPORTS_EVERY)
                continue
            if await reconcile_copies(state, source, client):
                _state_write(REPORT_POSTS, state)
            if all(isinstance(r, dict) and r.get('id') for r in rows):
                present = {copy_key(str(r['id'])) for r in rows}
                if await forget_copies(state, source, present, client):
                    _state_write(REPORT_POSTS, state)
            posts = state.get(source, {})
            if not any('attempt' in post for post in posts.values()):
                fresh_by_key = {copy_key(str(r['id'])): r for r in rows
                                if public(r) and copy_key(str(r['id'])) not in posts}
                fresh = list(fresh_by_key.values())
                if len(fresh) > REPORTS_AT_ONCE:
                    await send_copy(REPORT_POSTS, state, source,
                                    [copy_key(str(r['id'])) for r in fresh],
                                    '**%d report%s came in, from the site and the game,** since the '
                                    'last look. Open the site inbox for details.'
                                    % (len(fresh), '' if len(fresh) == 1 else 's'), client)
                else:
                    # The file is newest first; staff read oldest first.
                    for row in reversed(fresh):
                        if not await send_copy(REPORT_POSTS, state, source,
                                               [copy_key(str(row['id']))], report_text(row), client):
                            break
        except Exception:
            log('reports: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)
