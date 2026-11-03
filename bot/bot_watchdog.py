"""
The box's watchdog's messages.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import time
import traceback

import discord

from bot_base import DATA_DIR
from bot_core import WATCH_DIR, WATCH_ID, WATCH_READ_EVERY, client, log
from bot_staff_channel import watch_send


# Watch-Services.ps1 puts a watchdog on the VPS that restarts whatever stops
# answering, and since issue #447 it also decides what is down: one message
# when a thing dies and one when it is back, however long it stays down and
# however often it flaps. It writes them to alerts.jsonl in its folder, one
# JSON line each (id, at, service, kind, text). This says each one in the
# staff channel, by id through watch_say, which has no public fallback, and
# writes its id to alerts-sent-bot.txt, so it is said once across restarts of
# the bot too.
#
# When this bot is down, or up and not posting, the watchdog posts the message
# itself through a webhook kept on the box and writes its id to
# alerts-sent-webhook.txt. This reads that list too, so what the webhook said
# is not said again when the bot comes back.
#
# The watchdog decides and this only delivers, so there is no counting here.
# It replaced a reader of watch.log that tried to work out outages from the
# watchdog's sentences, and repeated "needs a look" every hour.
# tests\test-watch-alerts.ps1 drives the watchdog, and test-watch-services.py
# drives this against an outbox the real watchdog wrote.
#
# WHAT IT CANNOT CATCH is the whole box going down, which takes the watchdog
# with it. That needs something off the machine (issue #448).
WATCH_ALERTS = os.path.join(WATCH_DIR, 'alerts.jsonl')
WATCH_SENT_BOT = os.path.join(WATCH_DIR, 'alerts-sent-bot.txt')
WATCH_SENT_HOOK = os.path.join(WATCH_DIR, 'alerts-sent-webhook.txt')
# Taking a notice back (#3328). Say-Staff.ps1 -Unsay puts its id in
# alerts-unsay.txt, through say-staff.ps1 on the box, which takes back only the
# sender's own notices. The bot keeps the Discord message each notice became in
# staff-messages.txt, and what it did with each ask in staff-unsaid.txt, both
# in its own data folder, the one place it writes; say-staff.ps1 -Check reads
# the second. On 22 Oct a notice that should not have gone out stayed up until
# Patrick deleted it by hand: nothing knew which message it was.
WATCH_UNSAY = os.path.join(WATCH_DIR, 'alerts-unsay.txt')
STAFF_MESSAGES = os.path.join(DATA_DIR, 'staff-messages.txt')
STAFF_UNSAID = os.path.join(DATA_DIR, 'staff-unsaid.txt')
# How far back a notice said before staff-messages.txt existed is looked for.
UNSAY_LOOK_BACK = 200
# The watchdog's $alertMaxAge: a message a day late is noise, not news.
WATCH_ALERT_MAX_AGE = 24 * 3600


def watch_alerts_due(lines, sent, now):
    """
    The (id, text) of each message in the outbox still to be said, in order.

    lines are the outbox's lines, sent every id already said by the bot or the
    webhook, now the time in unix seconds. A line that is not a message is
    skipped rather than stopping the rest, and so is one older than
    WATCH_ALERT_MAX_AGE. An id twice in the outbox is said once.
    """
    out = []
    seen = set(sent)
    for raw in lines:
        try:
            a = json.loads(raw)
            aid = str(a['id']).strip()
            text = str(a['text'])
            at = int(a['at'])
        except Exception:
            continue
        if not aid or not text.strip() or aid in seen:
            continue
        if now - at > WATCH_ALERT_MAX_AGE:
            continue
        seen.add(aid)
        out.append((aid, text[:1900]))
    return out


def _watch_lines(path):
    """
    Every whole, non-empty line of path, [] when there is no such file, and
    None when it is there and cannot be read, so an unreadable outbox is never
    taken for an empty one.

    A last line with no line ending is left for the next read: the watchdog
    may be halfway through writing it.
    """
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return []
    except Exception:
        return None
    parts = data.decode('utf-8-sig', errors='replace').split('\n')
    return [p.strip() for p in parts[:-1] if p.strip()]


def _watch_mark(aid):
    """Write down that the bot said it. Blocking, so run through an executor."""
    with open(WATCH_SENT_BOT, 'a', encoding='ascii', errors='replace') as f:
        f.write(aid + '\r\n')


def _watch_note(path, *fields):
    """One tab separated line onto path. Blocking, so run through an executor."""
    with open(path, 'a', encoding='utf-8') as f:
        f.write('\t'.join(str(x).replace('\t', ' ').replace('\n', ' ')
                          for x in fields) + '\n')


def _watch_table(path):
    """{first field: the rest} of a tab separated file, the last line winning.
    {} when there is none, None when it is there and cannot be read."""
    lines = _watch_lines(path)
    if lines is None:
        return None
    out = {}
    for line in lines:
        parts = line.split('\t')
        if parts[0]:
            out[parts[0]] = parts[1:]
    return out


def unsay_plan(asked, done, messages, by_bot, by_hook, texts):
    """
    What to do with each notice asked to be taken back, in the order asked:
    (id, how). how is 'message' (its Discord message is known), 'look' (the bot
    said it before it kept message ids, so it is looked for by its words),
    'webhook' (the watchdog's webhook said it, which the bot cannot delete),
    'withhold' (not said yet, so it never is) or 'unknown' (no such notice).
    An id already done, or asked twice, is planned once.
    """
    out = []
    seen = set(done)
    for aid in asked:
        aid = aid.strip()
        if not aid or aid in seen:
            continue
        seen.add(aid)
        if aid in messages:
            how = 'message'
        elif aid in by_bot:
            how = 'look'
        elif aid in by_hook:
            how = 'webhook'
        elif aid in texts:
            how = 'withhold'
        else:
            how = 'unknown'
        out.append((aid, how))
    return out


async def watch_unsay(lines, said):
    """
    Take back every notice asked for that is not done yet. lines is the
    outbox, said the ids this run of the bot said. Each ask is written down in
    staff-unsaid.txt once, whatever came of it, so a failed one is not tried
    every minute for ever; its line says why.
    """
    loop = asyncio.get_running_loop()
    asked = await loop.run_in_executor(None, _watch_lines, WATCH_UNSAY)
    if not asked:
        return
    done = await loop.run_in_executor(None, _watch_table, STAFF_UNSAID)
    messages = await loop.run_in_executor(None, _watch_table, STAFF_MESSAGES)
    mine = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_BOT)
    hook = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_HOOK)
    if done is None or messages is None or mine is None or hook is None:
        return
    texts = {}
    for raw in lines:
        try:
            a = json.loads(raw)
            texts[str(a['id']).strip()] = str(a['text'])[:1900]
        except Exception:
            continue
    plan = unsay_plan(asked, done, messages, set(mine) | said, set(hook), texts)
    ch = client.get_channel(WATCH_ID) if WATCH_ID else None
    for aid, how in plan:
        result = how
        try:
            if how == 'withhold':
                # Marked said, so neither this loop nor the watchdog's webhook
                # ever says it; staff-unsaid.txt says why it is marked.
                await loop.run_in_executor(None, _watch_mark, aid)
                said.add(aid)
                result = 'withheld'
            elif how in ('message', 'look'):
                if ch is None:
                    continue
                target = None
                if how == 'message':
                    target = ch.get_partial_message(int(messages[aid][-1]))
                else:
                    me = getattr(client.user, 'id', None)
                    async for m in ch.history(limit=UNSAY_LOOK_BACK):
                        if getattr(m.author, 'id', None) == me and m.content == texts.get(aid):
                            target = m
                            break
                if target is None:
                    result = 'gone'
                else:
                    try:
                        await target.delete()
                        result = 'deleted'
                    except discord.NotFound:
                        result = 'gone'
        except Exception as e:
            log('services: could not take back %s:\n%s' % (aid, traceback.format_exc()))
            result = 'failed ' + type(e).__name__
        await loop.run_in_executor(None, _watch_note, STAFF_UNSAID, aid, result)
        log('services: took back %s: %s' % (aid, result))


async def watch_services():
    """
    Every WATCH_READ_EVERY seconds, say what the watchdog's outbox holds that
    nobody has said yet.

    A message that could not be said is left unmarked and the rest of that
    round waits, so they stay in order; the watchdog posts it through its
    webhook once it has waited long enough.

    Nothing in here may end the loop: a watcher that dies quietly looks
    exactly like everything being fine.
    """
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    said = set()
    unreadable = False
    log('services: saying what %s holds, every %ds, in channel %d'
        % (WATCH_ALERTS, WATCH_READ_EVERY, WATCH_ID))

    while not client.is_closed():
        try:
            lines = await loop.run_in_executor(None, _watch_lines, WATCH_ALERTS)
            mine = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_BOT)
            hook = await loop.run_in_executor(None, _watch_lines, WATCH_SENT_HOOK)
            if lines is None or mine is None or hook is None:
                if not unreadable:
                    log('services: could not read the watchdog\'s files in %s, '
                        'trying again every %ds' % (WATCH_DIR, WATCH_READ_EVERY))
                unreadable = True
            else:
                unreadable = False
                await watch_unsay(lines, said)
                due = watch_alerts_due(lines, said | set(mine) | set(hook),
                                       int(time.time()))
                for aid, text in due:
                    ok, msg = await watch_send(text)
                    if not ok:
                        break
                    said.add(aid)
                    log('services: said ' + aid)
                    await loop.run_in_executor(None, _watch_mark, aid)
                    if getattr(msg, 'id', None):
                        await loop.run_in_executor(None, _watch_note, STAFF_MESSAGES,
                                                   aid, WATCH_ID, msg.id)
        except Exception:
            log('services: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(WATCH_READ_EVERY)
