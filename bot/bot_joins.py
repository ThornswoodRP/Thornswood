"""
Join cards and join numbers.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import os
import re
import time
import traceback

import discord
import card

from bot_base import DATA_DIR
from bot_core import WELCOME, _int_env, by_name, client, log


# Which arrival each person was, on disk beside the code.
#
# Patrick, 24 September, with a screenshot of #welcome-travelers: "#28 twice".
# Daggerio came up the road at 19:41 and VENUS at 22:45, and both cards said
# "The 28th to walk in". The number was guild.member_count, the server's size
# at that moment, and the size falls whenever anybody leaves or is removed, so
# one departure between two joins handed the second arrival the first one's
# number, and it could go on doing that for ever.
#
# So the numbers are written down: the last one given out on each server, and
# the one each person got. A new arrival gets the next one, and somebody who
# leaves and comes back keeps theirs. It never goes below member_count, since
# anybody who joined while the bot was down was never counted here. And it
# never goes below JOIN_FLOOR, the highest number known to be on a card
# already: 28, off that screenshot, which is the one number the first join
# after this goes up has to get past, with no record yet and a member count
# that may by then be under it. Set JOIN_NUMBER_FLOOR in bot.env.json on the
# VPS if a later card went higher before this was installed.
#
# Install-Bot.ps1 sends a fixed list of files and deletes nothing in this
# folder, so neither the full run nor -CodeOnly can overwrite or remove it,
# and .gitignore keeps it out of the repo, like open-tickets.json.
JOINS = os.path.join(DATA_DIR, 'joins.json')
JOIN_FLOOR = _int_env('JOIN_NUMBER_FLOOR', 28)

# HOW LONG A NUMBER IS KEPT (#2353). It was kept for ever, after its person
# left too, and the privacy page did not name it. Decided by Patrick on 12
# October: a keeping time for each store, enforced in code. A number is kept
# while its person is in the Discord, and for JOIN_KEEP_DAYS after they leave,
# so coming back within a year still keeps it; then it goes. 'left' in each
# server's part of the record says when each numbered person was first seen
# gone, in milliseconds. 'last' is never aged: it is a count, not a person,
# and it is what stops a number being handed out twice.
JOIN_KEEP_DAYS = 365
JOIN_KEEP_EVERY = 60 * 60


def _joins_read():
    """
    The record, or {} when there is none yet. Raises when there is one and it
    cannot be read, so a file that is there and unreadable is never taken for
    an empty one and written over, which would start the numbers again.
    """
    if not os.path.exists(JOINS):
        return {}
    with open(JOINS, encoding='utf-8') as f:
        d = json.load(f)
    if not isinstance(d, dict):
        raise ValueError(JOINS + ' is not a JSON object')
    return d


def _joins_write(d):
    """Written to a file beside it and swapped in, so a write that fails half
       way leaves the old record whole rather than half of a new one."""
    tmp = JOINS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, JOINS)


def _joins_of(rec, guild):
    """This server's part of the record, and the numbers in it by member id,
       each made empty when it is missing or not the shape it should be."""
    g = rec.get(str(guild.id))
    if not isinstance(g, dict):
        g = {}
    ids = g.get('members')
    if not isinstance(ids, dict):
        ids = {}
    return g, ids


def _joins_number(ids, member_id):
    """The number the record holds for this member, or None."""
    had = ids.get(str(member_id))
    return had if type(had) is int and had > 0 else None


def joins_age(rec, now_ms, here):
    """
    Ages the record in place and returns (marked, dropped).

    here is {server id as text: set of member ids as text} for each server
    whose member list is whole. Somebody numbered there and not in it is
    marked left at now_ms, unless already marked; somebody marked and in it
    again is unmarked. Then, on every server, a number whose person left more
    than JOIN_KEEP_DAYS ago goes with its mark. A mark that is not a time is
    a corrupt one and is left as it is, with its number, rather than guessed
    at. A server not in here (its list not whole, or the bot not in it) is
    never marked, only aged.
    """
    cut = now_ms - JOIN_KEEP_DAYS * 86400000
    marked = dropped = 0
    for gid, g in rec.items():
        if not isinstance(g, dict):
            continue
        ids = g.get('members')
        if not isinstance(ids, dict):
            continue
        left = g.get('left')
        if not isinstance(left, dict):
            left = {}
        if gid in here:
            for k in ids:
                if k not in here[gid] and k not in left:
                    left[k] = now_ms
                    marked += 1
            for k in [k for k in left if k in here[gid]]:
                del left[k]
                marked += 1
        for k in [k for k, t in left.items()
                  if type(t) in (int, float) and t < cut]:
            del left[k]
            ids.pop(k, None)
            dropped += 1
        if left:
            g['left'] = left
        else:
            g.pop('left', None)
    return marked, dropped



# A restore (scripts/vps/vps-restore-services.ps1) moves the joins.json it
# replaces to joins.json-before-restore-<stamp> beside it in the data folder,
# <stamp> the box's local yyyyMMdd-HHmmss, with -2, -3 for a second restore in
# the same second, and nothing deleted it (#3620). Decided by Patrick on 26 Oct
# (B): a set-aside copy is kept 30 days, so a restore can be undone, then
# deleted. By the time in its name, never the file's own times, which a move
# keeps from the original. Delete-Person.ps1 takes a deleted person out of one
# while it is here.
RESTORE_ASIDE_DAYS = 30
RESTORE_ASIDE = re.compile(r'^joins\.json-before-restore-(\d{8})-(\d{6})(?:-\d+)?$')


def age_restore_copies(folder, now):
    """
    Deletes the set-aside joins.json copies in folder older than
    RESTORE_ASIDE_DAYS by the stamp in their names, now a POSIX time in
    seconds. A link, or anything that is not a plain file, is left as it is.
    Returns (deleted names, [(name, reason)] it could not delete).
    """
    cut = now - RESTORE_ASIDE_DAYS * 86400
    deleted, failed = [], []
    try:
        names = sorted(os.listdir(folder))
    except OSError as e:
        return deleted, [(folder, str(e))]
    for n in names:
        m = RESTORE_ASIDE.match(n)
        if not m:
            continue
        try:
            at = datetime.datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M%S').timestamp()
        except ValueError:
            continue
        if at >= cut:
            continue
        p = os.path.join(folder, n)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        try:
            os.remove(p)
            deleted.append(n)
        except OSError as e:
            failed.append((n, str(e)))
    return deleted, failed

async def watch_join_numbers():
    """
    Marks who has left and drops the numbers past JOIN_KEEP_DAYS, as the bot
    comes up and every JOIN_KEEP_EVERY seconds. On the event loop and not in
    an executor, like arrival_number, so a join cannot write the record
    between this reading and writing it. A record that cannot be read or
    written is said in bot.log and left as it is; the next pass tries again.
    Nothing in here may end the loop.
    """
    await client.wait_until_ready()
    partial = set()
    while not client.is_closed():
        try:
            here = {}
            for gd in client.guilds:
                if gd.chunked:
                    here[str(gd.id)] = set(str(m.id) for m in gd.members)
                    partial.discard(gd.id)
                elif gd.id not in partial:
                    partial.add(gd.id)
                    log('join numbers: the member list of "%s" is not whole yet, '
                        'so nobody there is marked as gone until it is' % gd.name)
            rec = _joins_read()
            marked, dropped = joins_age(rec, int(time.time() * 1000), here)
            if marked or dropped:
                _joins_write(rec)
            if dropped:
                log('join numbers: %d dropped, their people gone more than %d days'
                    % (dropped, JOIN_KEEP_DAYS))
        except Exception:
            log('join numbers: could not age %s, so it is as it was until the '
                'next pass:\n%s' % (JOINS, traceback.format_exc()))
        try:
            gone, stuck = age_restore_copies(DATA_DIR, time.time())
            for n in gone:
                log('join numbers: deleted %s, set aside by a restore more than %d days ago'
                    % (n, RESTORE_ASIDE_DAYS))
            for n, why in stuck:
                log('join numbers: COULD NOT DELETE %s (%s); it is tried again in an hour' % (n, why))
        except Exception:
            log('join numbers: could not age the copies a restore set aside:\n%s'
                % traceback.format_exc())
        await asyncio.sleep(JOIN_KEEP_EVERY)


def joins_given(guild):
    """
    {member id: number} for everybody the record has numbered on this server,
    read and never written.

    backfill.py and redraw.py read the record through this and the two above,
    so a card they draw carries the number on_member_join gave, by the same
    reading of the file. Until 24 September they numbered by join order among
    the members still here and never opened it, so redraw.py --all would have
    put numbers on old cards that disagree with the record. Raises, like
    _joins_read, when the record is there and cannot be read.
    """
    g, ids = _joins_of(_joins_read(), guild)
    out = {}
    for k in ids:
        n = _joins_number(ids, k)
        if n is not None and str(k).isdigit():
            out[int(k)] = n
    return out


def arrival_number(guild, member):
    """
    Which arrival this member is on this server: the number they were given
    before, or the next one. When the record cannot be read or written this
    says so in the log and answers member_count, which is what every card
    said before, because a greeting never waits on a file.

    Called on the event loop and not in an executor, so two joins a moment
    apart cannot both read the same last number.
    """
    count = guild.member_count
    try:
        rec = _joins_read()
        g, ids = _joins_of(rec, guild)
        had = _joins_number(ids, member.id)
        if had is not None:
            n, said = had, 'came back and keeps number %d' % had
            left = g.get('left')
            if isinstance(left, dict) and str(member.id) in left:
                del left[str(member.id)]
                rec[str(guild.id)] = g
                _joins_write(rec)
        else:
            last = g.get('last')
            if type(last) is not int:
                last = 0
            n = max(last + 1, JOIN_FLOOR + 1, count or 0)
            ids[str(member.id)] = n
            g['members'] = ids
            g['last'] = n
            rec[str(guild.id)] = g
            _joins_write(rec)
            said = 'is number %d, with %s members' % (n, count)
    except Exception:
        log('join numbers: could not read or write %s, so this card says the '
            'member count, %s, which can repeat a number:\n%s'
            % (JOINS, count, traceback.format_exc()))
        return count
    log('join: %s %s' % (member, said))
    return n


@client.event
async def on_member_join(member):
    # First line in, before anything can go wrong, so the log can tell a join
    # that never reached the bot apart from one that reached it and failed.
    log('join: %s arrived in "%s"' % (member, member.guild.name))

    ch = by_name(member.guild, [WELCOME])
    if ch is None:
        log('no text channel called #%s to greet in' % WELCOME)
        return

    number = arrival_number(member.guild, member)
    name = member.display_name or member.name

    png = None
    try:
        avatar = member.display_avatar.replace(size=256, format='png')
        data = await avatar.read()
        png = await asyncio.get_running_loop().run_in_executor(
            None, card.render, name, data, number, None, member.name)
    except Exception:
        log('card failed:\n' + traceback.format_exc())

    line = '%s came up the road.' % member.mention
    try:
        if png is not None:
            await ch.send(line, file=discord.File(png, 'welcome.png'))
        else:
            await ch.send(line)
    except Exception:
        log('greeting failed:\n' + traceback.format_exc())
