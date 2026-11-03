"""
The heartbeat the watchdog reads.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import time
import traceback

from bot_base import DATA_DIR
from bot_core import _int_env, client, log


# How the watchdog tells a running bot from a working one (issue #449).
#
# The watchdog on the VPS used to know one thing about the bot: whether a
# python process with Thornswood-Bot in its command line was alive. A bot
# stuck logging in, hung, or cut off from Discord and never getting back is
# still that process, so the one outage the bot exists to tell staff about,
# itself, looked fine. So this writes heartbeat.json beside this file every
# HEARTBEAT_EVERY seconds: its pid, when it started, when it wrote it,
# whether it is connected to Discord, when it last was, and when it last
# handled something Discord sent it and what. The watchdog reads it
# (BeatProblem in scripts\vps\Watch-Services.ps1) and treats ten quiet
# minutes of any of those as the bot being down while its process runs.
#
# It is written from its own loop, so a hung event loop stops it, which is
# the point. Written to a temporary file and renamed over the old one, so
# the watchdog never reads half of one.
HEARTBEAT_FILE = os.environ.get(
    'HEARTBEAT_FILE',
    os.path.join(DATA_DIR, 'heartbeat.json'))
HEARTBEAT_EVERY = _int_env('HEARTBEAT_EVERY', 60)

# The fields the watchdog reads. test-heartbeat.py checks the two agree.
_beat = {
    'pid': os.getpid(),
    'started': int(time.time()),
    'connected': False,
    'connected_at': 0,
    'last_event': 0,
    'last_event_type': '',
}
_beat_failed = False


def beat_record(now, closed=False):
    """What heartbeat.json says at unix time now. closed is the client having
       been closed, which no event says."""
    if closed:
        _beat['connected'] = False
    if _beat['connected']:
        _beat['connected_at'] = int(now)
    rec = dict(_beat)
    rec['written'] = int(now)
    return rec


def beat_write(rec, path=None):
    """Put rec in heartbeat.json. True when it is there. A failure is said in
       bot.log once, not every minute, and never stops the bot."""
    global _beat_failed
    path = path or HEARTBEAT_FILE
    tmp = path + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(rec, f)
        os.replace(tmp, path)
        _beat_failed = False
        return True
    except Exception:
        if not _beat_failed:
            log('could not write ' + path + ', so the watchdog cannot tell '
                'whether this bot is on Discord:\n' + traceback.format_exc())
        _beat_failed = True
        return False


def beat_now():
    return beat_write(beat_record(time.time(), client.is_closed()))


async def heartbeat():
    """Started once, in setup_hook. Runs until the process ends."""
    while True:
        beat_now()
        await asyncio.sleep(HEARTBEAT_EVERY)


def beat_connected(on):
    _beat['connected'] = bool(on)
    beat_now()


@client.event
async def on_connect():
    beat_connected(True)


@client.event
async def on_resumed():
    beat_connected(True)


@client.event
async def on_disconnect():
    beat_connected(False)


@client.event
async def on_socket_event_type(event_type):
    # Every event Discord sends, whether or not anything here handles it.
    # Kept in memory only; the loop above writes it.
    _beat['last_event'] = int(time.time())
    _beat['last_event_type'] = str(event_type)
