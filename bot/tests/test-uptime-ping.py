"""
test-uptime-ping.py

The bot pings an outside monitor every minute while it is on Discord, so a
bot or a VPS that stops is noticed from outside the box, whether or not One
is on (issue #449; Patrick, 29 Sep: "I want the bot too as well").

WHY THIS EXISTS. The heartbeat file and the watchdog both live on the VPS.
When the box itself is off, frozen or cut off, nothing on it can say so. The
outside monitor alerts when the pings stop; this checks the bot half:

  - no PING_URL means no ping, said once in bot.log, and the loop ends
  - a monitor that answers gets one GET, and the first success is said once
  - a monitor that is down, refuses, or answers 500 is said once per outage,
    and once when it answers again
  - a slow monitor is cut off by the timeout, and never holds up the event
    loop that handles Discord, and a ping in flight is never doubled
  - nothing is sent while the bot is not on Discord
  - the address never appears in anything the bot logs
  - setup_hook starts the loop, and the setting's name is the one
    Install-Bot.ps1 -SetPing writes

The real bot module is imported and its real functions are run against a fake
monitor on 127.0.0.1. Never connects to anything else.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import http.server
import socket
import threading
import time

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
# Whatever the machine running this has, the module is read with none set.
os.environ.pop('PING_URL', None)
os.environ.pop('PING_EVERY', None)
os.environ.pop('PING_TIMEOUT', None)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# ------------------------------------------------------ fake monitor --
class Monitor:
    mode = 'up'          # up, down (500), slow
    slow = 3.0
    hits = []            # (method, path, user agent)
    busy = 0
    most_busy = 0
    lock = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with Monitor.lock:
            Monitor.busy += 1
            Monitor.most_busy = max(Monitor.most_busy, Monitor.busy)
            Monitor.hits.append(('GET', self.path, self.headers.get('User-Agent', '')))
        try:
            if Monitor.mode == 'slow':
                time.sleep(Monitor.slow)
            code = 500 if Monitor.mode == 'down' else 200
            body = b'OK'
            self.send_response(code)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            pass
        finally:
            with Monitor.lock:
                Monitor.busy -= 1

    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]
# Made here, the shape a monitor's address has: a path nobody could guess.
SECRET = 'ping-' + os.urandom(12).hex()
URL = 'http://127.0.0.1:%d/%s' % (PORT, SECRET)

# A port nothing listens on, for a monitor that refuses.
s = socket.socket()
s.bind(('127.0.0.1', 0))
DEAD_PORT = s.getsockname()[1]
s.close()
DEAD = 'http://127.0.0.1:%d/%s' % (DEAD_PORT, SECRET)


def reset(mode='up'):
    Monitor.mode = mode
    Monitor.hits = []
    Monitor.busy = 0
    Monitor.most_busy = 0
    bot._ping['down'] = False
    bot._ping['ok_once'] = False


said = []
every_line = []


def fake_log(*a):
    line = ' '.join(str(x) for x in a)
    said.append(line)
    every_line.append(line)


bot.log = fake_log
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)


def run_for(seconds, extra=None):
    """Run the real uptime_ping on the loop for a while; hand back the task
       and the longest the loop was ever kept from a 20 ms sleep."""
    lag = [0.0]

    async def ticker():
        while True:
            t = time.monotonic()
            await asyncio.sleep(0.02)
            lag[0] = max(lag[0], time.monotonic() - t - 0.02)

    async def main():
        # The ticker first, so a loop held up by the very first ping counts.
        tick = asyncio.ensure_future(ticker())
        await asyncio.sleep(0.05)
        task = asyncio.ensure_future(bot.uptime_ping())
        await asyncio.sleep(seconds)
        done = task.done()
        exc = task.exception() if done else None
        task.cancel()
        tick.cancel()
        for t in (task, tick):
            try:
                await t
            except BaseException:
                pass
        return done, exc

    done, exc = loop.run_until_complete(main())
    return done, exc, lag[0]


try:
    # ----------------------------------------------------------- defaults --
    yes('every minute by default', bot.PING_EVERY == 60)
    yes('one ping may take ten seconds at most by default', bot.PING_TIMEOUT == 10)
    yes('no PING_URL in env means none is set', bot.PING_URL == '')
    src = harness_bot.source()
    hook = src[src.index('async def setup_hook'):src.index('client = Thornswood(')]
    yes('setup_hook starts the loop once per process', 'asyncio.create_task(uptime_ping())' in hook)
    yes("the setting is read from env as PING_URL", "os.environ.get('PING_URL'" in src)
    ib = open(os.path.join(HERE, '..', 'scripts', 'deploy', 'Install-Bot.ps1'), encoding='utf-8').read()
    yes('and Install-Bot.ps1 -SetPing writes that same name into bot.env.json',
        "[switch]$SetPing" in ib and "`$h['PING_URL'] = `$u" in ib)

    # -------------------------------------------------------------- no URL --
    bot.PING_URL = ''
    reset()
    said.clear()
    t0 = time.monotonic()
    done, exc, _ = run_for(0.3)
    yes('no URL: the loop ends at once, without an error', done and exc is None)
    yes('no URL: said once in bot.log, naming the command that sets it',
        len(said) == 1 and 'PING_URL is not set' in said[0] and '-SetPing' in said[0])
    yes('no URL: nothing is sent', Monitor.hits == [])

    # ------------------------------------------------------ not an address --
    bot.PING_URL = 'file:///C:/' + SECRET
    said.clear()
    done, exc, _ = run_for(0.2)
    yes('not a web address: the loop ends, said once', done and exc is None and len(said) == 1
        and 'not a web address' in said[0])
    yes('and the value is not in what it said', SECRET not in ' '.join(said))
    yes('ping_shape_ok takes https and http only', bot.ping_shape_ok('https://hc-ping.com/x')
        and not bot.ping_shape_ok('ftp://x/y') and not bot.ping_shape_ok('https://a b/c'))

    # ------------------------------------------------------------------ up --
    reset('up')
    said.clear()
    ok = bot.ping_once(URL, timeout=5)
    yes('up: a monitor that answers 200 is a ping that worked', ok is True)
    yes('up: one GET to the address, as thornswood-bot',
        Monitor.hits == [('GET', '/' + SECRET, 'thornswood-bot')])
    yes('up: the first one that works is said once', len(said) == 1 and 'reached the outside monitor' in said[0])
    bot.ping_once(URL, timeout=5)
    yes('up: and the next one says nothing', len(said) == 1)

    # ---------------------------------------------------------------- down --
    reset('down')
    bot._ping['ok_once'] = True
    said.clear()
    ok = bot.ping_once(URL, timeout=5)
    yes('down: a monitor that answers 500 is a ping that failed', ok is False)
    yes('down: said once, with what it answered', len(said) == 1 and 'FAILED' in said[0] and '500' in said[0])
    for _ in range(3):
        bot.ping_once(URL, timeout=5)
    yes('down: three more failures say nothing more', len(said) == 1)
    ok = bot.ping_once(DEAD, timeout=5)
    yes('down: a monitor that refuses the connection fails too, still the same outage',
        ok is False and len(said) == 1)
    Monitor.mode = 'up'
    ok = bot.ping_once(URL, timeout=5)
    yes('down: when it answers again that is said once', ok is True and len(said) == 2
        and 'hears from this bot again' in said[1])
    bot.ping_once(URL, timeout=5)
    yes('down: and then nothing more', len(said) == 2)
    reset('up')
    bot._ping['ok_once'] = True
    said.clear()
    bot.ping_once(DEAD, timeout=5)
    yes('refused: a fresh outage is said once', len(said) == 1 and 'FAILED' in said[0])

    # ---------------------------------------------------------------- slow --
    reset('slow')
    Monitor.slow = 3.0
    said.clear()
    t = time.monotonic()
    ok = bot.ping_once(URL, timeout=1)
    took = time.monotonic() - t
    yes('slow: a monitor slower than the timeout is a ping that failed', ok is False)
    yes('slow: cut off by the timeout (%.1fs), not left waiting' % took, took < 2.5)
    yes('slow: said once', len(said) == 1 and 'FAILED' in said[0])

    # ------------------------------------------------------ the loop itself --
    bot.PING_URL = URL
    bot.PING_EVERY = 1
    bot.PING_LOOK = 0.05
    bot.PING_TIMEOUT = 5

    reset('up')
    bot._beat['connected'] = False
    said.clear()
    done, exc, _ = run_for(0.6)
    yes('not on Discord: nothing is sent', Monitor.hits == [] and not done)

    reset('up')
    bot._beat['connected'] = True
    said.clear()
    done, exc, lag = run_for(2.4)
    n = len(Monitor.hits)
    yes('on Discord, up: the first ping goes at once and then one every PING_EVERY (%d in 2.4 s)' % n,
        2 <= n <= 4)
    yes('on Discord, up: the loop is still running', not done)
    yes('on Discord, up: said once that it reached the monitor',
        len([x for x in said if 'reached the outside monitor' in x]) == 1)

    reset('down')
    bot._ping['ok_once'] = True
    said.clear()
    done, exc, lag = run_for(2.4)
    yes('on Discord, down: it keeps pinging (%d) and keeps running' % len(Monitor.hits),
        len(Monitor.hits) >= 2 and not done)
    yes('on Discord, down: one line for the whole outage', len(said) == 1 and 'FAILED' in said[0])

    reset('slow')
    Monitor.slow = 4.0
    bot.PING_TIMEOUT = 3
    said.clear()
    done, exc, lag = run_for(2.5)
    yes('on Discord, slow: the event loop is never held up (worst %.0f ms)' % (lag * 1000), lag < 0.25)
    yes('on Discord, slow: a ping still in flight is not doubled (%d sent, %d at once)'
        % (len(Monitor.hits), Monitor.most_busy), len(Monitor.hits) == 1 and Monitor.most_busy == 1)
    yes('on Discord, slow: the loop keeps running', not done)
    # Let the one in flight finish and say what it says.
    time.sleep(1.0)
    loop.run_until_complete(asyncio.sleep(0.1))

    # ----------------------------------------------------------- the secret --
    yes('the address is in nothing the bot said, in any of the above (%d lines)' % len(every_line),
        len(every_line) >= 8 and all(SECRET not in x and URL not in x for x in every_line))
    scrubbed = bot._ping_scrub('Error for ' + URL + ' and /' + SECRET, URL)
    yes('the scrubber takes out the address and its path', SECRET not in scrubbed and URL not in scrubbed)
finally:
    bot._beat['connected'] = False
    server.shutdown()
    try:
        loop.run_until_complete(loop.shutdown_default_executor())
    except Exception:
        pass
    loop.close()

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
