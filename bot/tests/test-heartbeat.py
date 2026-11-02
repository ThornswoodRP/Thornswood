"""
test-heartbeat.py

The bot writes a heartbeat the watchdog can read, so a bot that is running
but not on Discord is a bot that is down (issue #449).

WHY THIS EXISTS. The watchdog on the VPS knew one thing about the bot: that a
python process with Thornswood-Bot in its command line was alive. A bot stuck
logging in, hung, or cut off from Discord for good is still that process, so
the one outage the bot is there to tell staff about, itself, looked fine. Now
the bot writes heartbeat.json beside itself every minute, and BeatProblem in
scripts\\vps\\Watch-Services.ps1 reads it. This checks the bot half: what the
file says before it connects, while it is connected, after it drops and when
it comes back, that it is written whole or not at all, that a folder it
cannot write to never stops the bot, that it is written from its own loop
started once per process, and that every field the watchdog reads is one the
bot writes. tests\\test-bot-heartbeat.ps1 checks the watchdog half.

The real bot module is imported and its real functions and event handlers are
run. The heartbeat file is pointed at a temporary folder, so this cannot touch
the one beside the code.

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import json
import re
import shutil
import tempfile
import time

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


FIELDS = {'pid', 'started', 'written', 'connected', 'connected_at',
          'last_event', 'last_event_type'}

TMP = tempfile.mkdtemp(prefix='thornswood-heartbeat-')
said = []
real_log = bot.log
bot.log = lambda *a: said.append(' '.join(str(x) for x in a))
try:
    # ----------------------------------------------------------- where --
    yes('by default the heartbeat is heartbeat.json in the bot\'s data folder, where the watchdog reads it',
        os.path.normcase(bot.HEARTBEAT_FILE) == os.path.normcase(os.path.join(bot.DATA_DIR, 'heartbeat.json')))
    ps1 = open(os.path.join(HERE, '..', 'scripts', 'vps', 'Watch-Services.ps1'),
               encoding='utf-8').read()
    yes('and the watchdog reads C:\\Thornswood-Bot\\data\\heartbeat.json, the data folder the service names (#1104)',
        "$botBeat = 'C:\\Thornswood-Bot\\data\\heartbeat.json'" in ps1)
    yes('every minute by default', bot.HEARTBEAT_EVERY == 60)

    beat = os.path.join(TMP, 'heartbeat.json')
    bot.HEARTBEAT_FILE = beat

    # ------------------------------------------------- before Discord --
    t0 = time.time()
    yes('a heartbeat before anything is connected is written', bot.beat_now() is True)
    rec = read(beat)
    yes('it holds exactly the fields the watchdog knows', set(rec) == FIELDS)
    yes("with this process's pid", rec['pid'] == os.getpid())
    yes('when it started and when it was written, in unix seconds',
        isinstance(rec['started'], int) and isinstance(rec['written'], int)
        and rec['started'] <= rec['written'] <= int(t0) + 1)
    yes('not connected, and never has been',
        rec['connected'] is False and rec['connected_at'] == 0)
    yes('and nothing heard from Discord yet', rec['last_event'] == 0 and rec['last_event_type'] == '')
    yes('no half-written file is left beside it', not os.path.exists(beat + '.tmp'))

    # The watchdog's rule reads these names off $beat. Every one it reads has
    # to be one written here, or the rule reads nothing and says nothing.
    rule = ps1[ps1.index('function BeatProblem('):]
    rule = rule[:rule.index('\n}\n')]
    read_names = set(re.findall(r'\$beat\.([A-Za-z_]+)', rule))
    yes('every field BeatProblem reads is one the bot writes (%s)' % ', '.join(sorted(read_names)),
        len(read_names) >= 5 and read_names <= FIELDS)

    # ------------------------------------------------------ connected --
    run(bot.on_connect())
    rec = read(beat)
    yes('on_connect writes at once that it is connected', rec['connected'] is True)
    yes('and when it last was: now', rec['connected_at'] == rec['written'])

    run(bot.on_socket_event_type('GUILD_MEMBER_ADD'))
    later = bot.beat_record(time.time() + 120)
    yes('every event Discord sends is remembered with its time and type',
        later['last_event'] > 0 and later['last_event_type'] == 'GUILD_MEMBER_ADD')
    yes('and a connected bot moves connected_at along with every beat',
        later['connected'] is True and later['connected_at'] == later['written'])

    # ---------------------------------------------------- dropped --------
    run(bot.on_disconnect())
    rec = read(beat)
    yes('on_disconnect writes at once that it is not connected', rec['connected'] is False)
    held = rec['connected_at']
    far = bot.beat_record(held + 900)
    yes('and connected_at stays when it last was, so the watchdog can count from it',
        far['connected'] is False and far['connected_at'] == held and far['written'] - held >= 900)

    run(bot.on_resumed())
    yes('on_resumed is connected again', read(beat)['connected'] is True)
    run(bot.on_connect())
    closed = bot.beat_record(time.time(), closed=True)
    yes('a closed client is never written as connected, whatever the last event said',
        closed['connected'] is False)
    run(bot.on_connect())

    # The four handlers are the ones discord.py calls, by name.
    yes('the handlers are registered on the client discord.py dispatches to',
        all(getattr(bot.client, n, None) is getattr(bot, n)
            for n in ('on_connect', 'on_resumed', 'on_disconnect', 'on_socket_event_type')))

    # ---------------------------------------------- a folder it cannot use --
    said[:] = []
    nowhere = os.path.join(TMP, 'no-such-folder', 'heartbeat.json')
    bot.HEARTBEAT_FILE = nowhere
    ok1 = bot.beat_now()
    ok2 = bot.beat_now()
    yes('a heartbeat it cannot write returns False and raises nothing', ok1 is False and ok2 is False)
    yes('and says so in bot.log once, not every minute',
        len([s for s in said if 'could not write' in s]) == 1)
    bot.HEARTBEAT_FILE = beat
    yes('the next one that works is written', bot.beat_now() is True)
    bot.HEARTBEAT_FILE = nowhere
    bot.beat_now()
    yes('and a later failure is said again, once',
        len([s for s in said if 'could not write' in s]) == 2)
    bot.HEARTBEAT_FILE = beat

    # A file that is there is replaced whole, never appended to or left half.
    with open(beat, 'w', encoding='utf-8') as f:
        f.write('{"pid": 1, "garbage"')
    bot.beat_now()
    yes('a broken file from before is replaced by a whole one', read(beat)['pid'] == os.getpid())

    # --------------------------------------------------------- its loop --
    writes = []
    real_write = bot.beat_write

    def counting(rec, path=None):
        writes.append(rec['written'])
        return real_write(rec, path)

    bot.beat_write = counting
    bot.HEARTBEAT_EVERY = 0.05

    async def a_while():
        t = asyncio.ensure_future(bot.heartbeat())
        await asyncio.sleep(0.32)
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass

    run(a_while())
    bot.beat_write = real_write
    bot.HEARTBEAT_EVERY = 60
    yes('the heartbeat loop writes again and again on its own (%d in a third of a second)' % len(writes),
        len(writes) >= 4)

    # setup_hook starts it, once per process, and not on_ready, which runs
    # again on every reconnect and would start a second loop each time.
    started = []

    async def fake_heartbeat():
        started.append(1)

    real_hb, real_open = bot.heartbeat, bot.site_open
    bot.heartbeat = fake_heartbeat
    bot.site_open = lambda: False

    async def hook():
        await bot.client.setup_hook()
        await asyncio.sleep(0)

    try:
        run(hook())
    finally:
        bot.heartbeat, bot.site_open = real_hb, real_open
    yes('setup_hook starts the heartbeat loop', started == [1])
    src = open(os.path.join(HERE, 'bot.py'), encoding='utf-8').read()
    ready = src[src.index('async def on_ready():'):]
    ready = ready[:ready.index('\n\n\n')]
    yes('and on_ready does not, so a reconnect never starts a second one', 'heartbeat' not in ready)
    main = src[src.index("if __name__ == '__main__':"):]
    yes('one heartbeat is written before client.run, so a bot stuck logging in is seen',
        'beat_now()' in main and main.index('beat_now()') < main.index('client.run(TOKEN)'))
    yes('heartbeat.json is kept out of git, like joins.json',
        'bot/heartbeat.json' in open(os.path.join(HERE, '..', '.gitignore'), encoding='utf-8').read())

finally:
    bot.log = real_log
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
