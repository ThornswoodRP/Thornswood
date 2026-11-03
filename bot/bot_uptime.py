"""
The outside monitor's ping.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import os
import time
import traceback
import urllib.request

from bot_core import _int_env, client, log
from bot_heartbeat import _beat


# The heartbeat above is read on the box, by the watchdog, and a box that is
# off, frozen or cut off reads nothing and says nothing. So the bot also pings
# an outside monitor (Patrick, 29 Sep: "I want the bot too as well"): one GET
# to PING_URL every PING_EVERY seconds while it is on Discord. When the pings
# stop for longer than the monitor's grace, the monitor sends its alert,
# whether the bot hung, lost Discord or stopped, or the whole VPS went down,
# and whether or not One is on.
#
# PING_URL lives only in bot.env.json on the VPS, put there by
# .\scripts\deploy\Install-Bot.ps1 -SetPing on ssh's standard input. Whoever
# has it can keep the monitor quiet, so it is never logged, not even in an
# error. Each ping runs on a worker thread with its own timeout, so a slow or
# dead monitor never holds up anything Discord sends, and a ping still in
# flight is never doubled. It is sent from the event loop, so a hung bot stops
# pinging, which is the point. A failure is said once per outage and once
# when it works again; nothing here can stop the bot.
PING_URL = os.environ.get('PING_URL', '').strip()
PING_EVERY = _int_env('PING_EVERY', 60)
PING_TIMEOUT = _int_env('PING_TIMEOUT', 10)
# How often the loop looks, so the first ping follows connecting by seconds.
PING_LOOK = 5

_ping = {'down': False, 'ok_once': False}


def ping_shape_ok(url):
    """A web address, and nothing that could be a file or a command."""
    return (url.lower().startswith(('https://', 'http://'))
            and not any(c.isspace() for c in url))


def _ping_scrub(text, url):
    """text with the address, and its path, taken out."""
    text = str(text)
    for part in (url, url.split('://', 1)[-1]):
        if part:
            text = text.replace(part, 'the ping address')
    tail = url.split('://', 1)[-1].split('/', 1)
    if len(tail) == 2 and len(tail[1]) > 3:
        text = text.replace(tail[1], 'the ping address')
    return text


def ping_once(url, timeout=None):
    """One ping. True when the monitor answered 2xx. Never raises."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'thornswood-bot'})
        with urllib.request.urlopen(req, timeout=timeout or PING_TIMEOUT) as r:
            r.read(256)
            code = r.status
        ok = 200 <= code < 300
        why = 'it answered %d' % code
    except Exception as e:
        ok = False
        code = getattr(e, 'code', None)
        if isinstance(code, int):
            why = 'it answered %d' % code
        else:
            why = '%s: %s' % (type(e).__name__, getattr(e, 'reason', None) or e)
    # Only the log lines and the record of what was said, none of which
    # throws, so they sit outside the try (#2736).
    if ok:
        if _ping['down']:
            log('uptime ping: the outside monitor hears from this bot again')
        elif not _ping['ok_once']:
            log('uptime ping: reached the outside monitor, and pings it every '
                '%ds while on Discord' % PING_EVERY)
        _ping['down'] = False
        _ping['ok_once'] = True
    else:
        if not _ping['down']:
            log('uptime ping FAILED (%s). The outside monitor alerts if it '
                'hears nothing past its grace. Said once until it works '
                'again.' % _ping_scrub(why, url))
        _ping['down'] = True
    return ok


async def uptime_ping():
    """Started once, in setup_hook. Runs until the process ends, or returns
       at once when there is nothing to ping."""
    if not PING_URL:
        log('uptime ping: PING_URL is not set in bot.env.json, so no outside '
            'monitor hears from this bot. Install-Bot.ps1 -SetPing sets it.')
        return
    if not ping_shape_ok(PING_URL):
        log('uptime ping: PING_URL in bot.env.json is not a web address, so '
            'nothing is sent. Install-Bot.ps1 -SetPing sets it again.')
        return
    loop = asyncio.get_running_loop()
    inflight = None
    last = None
    while True:
        try:
            now = time.monotonic()
            if (_beat['connected'] and not client.is_closed()
                    and (inflight is None or inflight.done())
                    and (last is None or now - last >= PING_EVERY)):
                last = now
                inflight = loop.run_in_executor(None, ping_once, PING_URL)
        except Exception:
            log('uptime ping: could not start one, carrying on:\n'
                + _ping_scrub(traceback.format_exc(), PING_URL))
        await asyncio.sleep(PING_LOOK)
