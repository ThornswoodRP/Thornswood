"""
The staff channel: what the watchdog says, and the sessions that went
wrong.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import traceback

import discord

from bot_core import (TROUBLE_EVERY, TROUBLE_FILE, TROUBLE_ID, TROUBLE_POSTS,
    WATCH_ID, _state_read, _state_write, client, log)


# Where the watchdog's messages are said: #staff-updates, by WATCH_ID from
# staff-channel.txt (#2501). There used to be a site watcher here
# as well, asking https://thornswood.net every five minutes since the Caddy
# outage of 21 September. The watchdog on the VPS asks the same address (its
# caddy check), so one outage was two messages from two watchers; since #447
# the watchdog decides and this only delivers (watch_services, below).


async def watch_send(text):
    """
    Say it once, in the staff channel, found by id: (True, the message) when
    it was said, (False, None) when it was not.

    Nothing is guessed and nothing falls back to another channel. If that id is
    not a channel this bot can see, it says so in the bot log and stays quiet in
    Discord, because the only channel it could fall back to by name is the
    public one.
    """
    if not WATCH_ID:
        log('watch: no channel id, so nothing was said. staff-channel.txt is '
            'missing or unreadable; Install-Bot.ps1 sends it with the code.')
        return False, None
    ch = client.get_channel(WATCH_ID)
    if ch is None:
        log('watch: channel %d is not one this bot can see, so nothing was '
            'said.' % WATCH_ID)
        return False, None
    try:
        # The text is the watchdog's own sentence, which can carry a name
        # or a line from somewhere else. Mentions stay off, so @everyone
        # in it is text and not a ping. Discord honors allowed_mentions
        # even when the text still says @everyone.
        msg = await ch.send(text, allowed_mentions=discord.AllowedMentions.none())
        return True, msg
    except Exception:
        log('watch: could not post in #%s:\n' % getattr(ch, 'name', WATCH_ID)
            + traceback.format_exc())
        return False, None


async def watch_say(text):
    """watch_send, True when it was said."""
    ok, _msg = await watch_send(text)
    return ok


def _clock(ms):
    """
    A unix-ms stamp as 'HH:MM on D Month', in this box's own time.

    The site stamps a session's start, end and a log's arrival with the same
    clock the server log uses, so a time named here reads the same as the
    lines on the sessions page.     fromtimestamp is local time, which is what the
    box runs on. %-d is not on Windows, where this runs, so the day is built by
    hand and carries no leading zero. Anything that is not a number, and 0
    itself (the site's stamp for a start or end it never saw), gives '', so a
    row without these fields drops the phrase rather than naming 1970.
    """
    try:
        n = int(ms)
    except (TypeError, ValueError):
        return ''
    if not n:
        return ''
    try:
        t = datetime.datetime.fromtimestamp(n / 1000)
    except (OSError, OverflowError, ValueError):
        return ''
    return '%02d:%02d on %d %s' % (t.hour, t.minute, t.day, t.strftime('%B'))


# A log that arrives within this long of the session ending is the launcher's
# own end-of-session upload, not a backlog, so its arrival is not called out.
TROUBLE_LATE_MS = 5 * 60 * 1000

# How every post _trouble_line makes begins, which is how the one-time look
# through the channel (trouble_backfill) tells one from anything else the bot
# says there.
TROUBLE_HEAD = '**A session went wrong.**'


def _trouble_line(row):
    """
    The staff-channel line for one session that went wrong.

    NAMES THE SESSION'S OWN TIME, not the moment the alert fires. Issue #532:
    a 401 held Patrick's 23 September logs until 14:09 the next day, when a
    newer launcher uploaded the backlog, and the alert read ~14:10 as if the
    crash had just happened. The session had started 20:07 the evening before.
    So the start is named, and when the logs arrived well after the session
    ended (a late upload, not the launcher's own end-of-session send) that is
    said too, so a backlog no longer looks like a fresh failure.

    A pure function of the row, so the harness can check the wording without a
    Discord, a clock or the file. A row with no start or end (older rows, or a
    session whose ends were never seen) simply drops those phrases.
    """
    who = row.get('name') or row.get('who') or 'somebody'
    where = row.get('channel') or ''
    where = {'dev': 'the dev build', 'main': 'the main build'}.get(
        where, 'a build it did not name')
    line = (row.get('line') or '').strip()

    started = _clock(row.get('start'))
    when = (' It started %s.' % started) if started else ''

    late = ''
    try:
        end = int(row.get('end') or 0)
        arrived = int(row.get('at') or 0)
    except (TypeError, ValueError):
        end = arrived = 0
    if end and arrived and arrived - end > TROUBLE_LATE_MS:
        got = _clock(arrived)
        if got:
            late = (' The logs did not arrive until %s, well after it ended, '
                    'so this is a late upload rather than a new failure.' % got)

    return (
        TROUBLE_HEAD + ' %s, on %s%s.%s%s\n%s\n%s\n'
        'The logs are on the sessions page under that session, '
        'and it is the red one.'
        % (who,
           where,
           (', launcher %s' % row['version']) if row.get('version') else '',
           when,
           late,
           row.get('why') or 'something went wrong',
           ('```\n%s\n```' % line[:400]) if line else ''))


def _trouble_rows():
    """
    The rows in trouble.json, or None when the file is not there or cannot be
    read. None is never taken for an empty file: a post is deleted because its
    row has gone, so a file that could not be read must delete nothing.
    """
    try:
        with open(TROUBLE_FILE, encoding='utf-8') as f:
            rows = json.load(f)
    except Exception:
        return None
    return rows if isinstance(rows, list) else None


def _trouble_sessions(rows):
    return set(r['session'] for r in rows
               if isinstance(r, dict) and r.get('session'))


def trouble_remember(sid, msg, path=None):
    """Writes down which message said session sid went wrong."""
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None:
        log('trouble: %s cannot be read, so the post for session %s is not '
            'written down and will not be deleted when its logs go'
            % (path, sid))
        return False
    posts = state.setdefault('posts', {})
    posts[str(sid)] = {'channel': msg.channel.id, 'message': msg.id}
    try:
        _state_write(path, state)
    except Exception as e:
        log('trouble: could not write %s, so the post for session %s will not '
            'be deleted when its logs go: %s: %s'
            % (path, sid, type(e).__name__, e))
        return False
    return True


async def trouble_forget(rows, path=None):
    """
    A FAILED SESSION'S POST GOES WHEN ITS ROW GOES (#3942). The post carries
    the person's name and a line out of their logs. The site keeps the row in
    trouble.json exactly as long as the session and its logs: it ages out at
    365 days, stays while staff keep the session, and goes with a deletion
    request (freshTrouble and the deletion sweep in site/server.js). The
    oldest also goes past the file's last 200 rows. Nothing deleted the post,
    so it stayed in the channel after all of that.

    So every post this bot makes is written down against its session in
    TROUBLE_POSTS, and here each one whose session is no longer in rows is
    deleted. Returns (deleted, failed). A post already gone from Discord (staff
    deleted it) is taken off the list; any other failure is a line with
    Discord's reason, and the post stays on the list for the next pass. Said
    in bot.log by session id and count, never what a post said.
    """
    if rows is None:
        return 0, 0
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None:
        log('trouble: %s cannot be read, so no post was deleted this pass'
            % path)
        return 0, 1
    posts = state.get('posts') or {}
    present = _trouble_sessions(rows)
    deleted = failed = 0
    changed = False
    for sid in [k for k in posts if k not in present]:
        rec = posts.get(sid) if isinstance(posts.get(sid), dict) else {}
        try:
            cid, mid = int(rec.get('channel')), int(rec.get('message'))
        except (TypeError, ValueError):
            log('trouble: the post for session %s has no message written down, '
                'so it is taken off the list' % sid)
            del posts[sid]
            changed = True
            continue
        ch = client.get_channel(cid)
        if ch is None:
            failed += 1
            log('trouble: channel %d of the post for session %s is not one this '
                'bot can see, so it is not deleted this pass' % (cid, sid))
            continue
        try:
            await ch.get_partial_message(mid).delete()
            deleted += 1
        except discord.NotFound:  # staff deleted it already: it is gone, as wanted
            pass
        except Exception as e:
            failed += 1
            log('trouble: could not delete the post for session %s: %s: %s'
                % (sid, type(e).__name__, e))
            continue
        del posts[sid]
        changed = True
    if changed:
        state['posts'] = posts
        try:
            _state_write(path, state)
        except Exception as e:
            log('trouble: could not write %s after deleting posts: %s: %s'
                % (path, type(e).__name__, e))
    if deleted:
        log('trouble: deleted %d failed-session post(s) whose session has left '
            'trouble.json' % deleted)
    return deleted, failed


def _trouble_post_matches(content, row):
    """
    True when a post the bot made before #3942 is about this row. The wording
    has changed since the first posts (#532), so the row's own text is looked
    for rather than the whole line: the name, and the log line in its code
    block or, with no line, the reason.
    """
    if content == _trouble_line(row)[:1900]:
        return True
    who = row.get('name') or row.get('who') or ''
    line = (row.get('line') or '').strip()
    mark = ('```\n%s\n```' % line[:400]) if line else (row.get('why') or '')
    return bool(who) and bool(mark) and who in content and mark in content


async def trouble_backfill(rows, path=None):
    """
    The posts made before #3942 were never written down. Once, the first time
    the bot comes up with this, it looks through the trouble channel for its
    own posts that begin with TROUBLE_HEAD, writes down each whose row is still
    in trouble.json, and deletes the rest, whose session and logs are already
    gone. A post it cannot match to a row is one of those. Returns
    (deleted, failed); with any failure the look runs again next start.
    """
    if rows is None:
        return 0, 0
    path = path or TROUBLE_POSTS
    state = _state_read(path)
    if state is None or state.get('backfilled'):
        return 0, 0
    ch = _trouble_channel()
    bot_id = getattr(client.user, 'id', None)
    if ch is None or bot_id is None:
        return 0, 0
    posts = state.setdefault('posts', {})
    known = set(str(r.get('message')) for r in posts.values()
                if isinstance(r, dict))
    rows = [r for r in rows if isinstance(r, dict) and r.get('session')]
    deleted = failed = 0
    try:
        async for m in ch.history(limit=None):
            if getattr(getattr(m, 'author', None), 'id', None) != bot_id:
                continue
            content = getattr(m, 'content', '') or ''
            if not content.startswith(TROUBLE_HEAD) or str(m.id) in known:
                continue
            row = next((r for r in rows if str(r['session']) not in posts
                        and _trouble_post_matches(content, r)), None)
            if row is not None:
                posts[str(row['session'])] = {'channel': ch.id, 'message': m.id}
                continue
            try:
                await m.delete()
                deleted += 1
            except discord.NotFound:  # already gone from the channel, as wanted
                pass
            except Exception as e:
                failed += 1
                log('trouble: could not delete an old failed-session post '
                    '(%s): %s: %s' % (m.id, type(e).__name__, e))
    except Exception as e:
        failed += 1
        log('trouble: could not read #%s for the old failed-session posts: '
            '%s: %s' % (getattr(ch, 'name', '?'), type(e).__name__, e))
    if not failed:
        state['backfilled'] = True
    try:
        _state_write(path, state)
    except Exception as e:
        log('trouble: could not write %s after the look for old posts: %s: %s'
            % (path, type(e).__name__, e))
    log('trouble: the old failed-session posts: %d written down, %d deleted, '
        '%d failed' % (len(posts), deleted, failed))
    return deleted, failed


async def watch_trouble():
    """
    Say in the staff channel when a session goes wrong, and take the post down
    when that session's logs go (trouble_forget).

    The site reads every session's logs as they arrive and appends the ones
    that went wrong to trouble.json. This reads that file and says each new one
    once. A file rather than a request because both run on this box.

    WHAT IT REMEMBERS AND WHY. The session ids already in the file when this
    starts are treated as said. Without that, every restart of the bot would
    re-announce the last two hundred, which is the fastest way to make a staff
    channel unreadable and therefore unread. It means a session that went wrong
    while the bot was down is not announced, and that is the right trade: it is
    still on the page, in red, which is where somebody looks.

    Nothing in here may end the loop, for the same reason as the site watcher:
    a watcher that dies quietly looks exactly like everything being fine.
    """
    await client.wait_until_ready()

    loop = asyncio.get_running_loop()
    said = _trouble_sessions(await loop.run_in_executor(None, _trouble_rows) or [])
    ch = _trouble_channel()
    log('trouble: watching %s every %ds, speaking in %s, %d already there and '
        'treated as said'
        % (TROUBLE_FILE, TROUBLE_EVERY,
           ('#' + ch.name) if ch is not None else 'NOWHERE, see above',
           len(said)))

    first = True
    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, _trouble_rows)
            if first:
                first = False
                await trouble_backfill(rows)
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                sid = row.get('session') or ''
                if not sid or sid in said:
                    continue
                said.add(sid)
                msg = await trouble_say(_trouble_line(row))
                if msg is not None:
                    trouble_remember(sid, msg)
            await trouble_forget(rows)
        except Exception:
            log('trouble: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(TROUBLE_EVERY)


def _trouble_channel():
    """
    The channel a session that went wrong is announced in: #staff-updates, by
    the id from staff-channel.txt or TROUBLE_CHANNEL_ID, and nothing else.

    No id, or an id that is not a channel this bot can see, is a line in the
    bot log and silence in Discord, the way watch_say has always been. Until
    #2940 it fell back to a channel named staff-general, so the same alert went
    to #staff-updates on a box set up right and to the team's everyday channel
    on one that was not, and nothing in Discord said which. A guess by name
    also hid the missing or wrong id, which is the thing to fix: Install-Bot
    sends staff-channel.txt with the code. And a name can match the wrong
    channel; this server has two called news, one staff and one public.
    """
    if not TROUBLE_ID:
        log('trouble: no channel id, so nothing is said. staff-channel.txt is '
            'missing or unreadable; Install-Bot.ps1 sends it with the code.')
        return None
    ch = client.get_channel(TROUBLE_ID)
    if ch is None:
        log('trouble: channel %d is not one this bot can see, so nothing is '
            'said.' % TROUBLE_ID)
    return ch


async def trouble_say(text):
    """Say it once, in the staff channel. Same rules as watch_say. The
    message, or None when nothing was said."""
    ch = _trouble_channel()
    if ch is None:
        return None
    try:
        # The line carries a name and a line from a log, both from somewhere
        # else. Mentions stay off, as in watch_say and report_say, so an
        # @everyone in it is text and not a ping.
        return await ch.send(text[:1900],
                             allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        log('trouble: could not post in #%s:\n' % getattr(ch, 'name', '?')
            + traceback.format_exc())
        return None
