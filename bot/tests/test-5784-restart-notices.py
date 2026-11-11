"""
test-5784-restart-notices.py

Planned restarts said in Discord before they happen (#5784): whatever stops a
game server leaves for-bot\\restart-<environment>.json (the deploy agent:
tools\\DeployAgent\\RestartNotice.cs), and the bot posts it (bot.restart_docs,
restart_plan, restart_text, restarts_once).

It holds:
  - the files are read in the agent's shape; no folder is no notice, a file
    that does not read or is not a notice is left out;
  - a "coming" is posted once, ahead, with the time it goes down as Discord's
    own timestamp; the live server's in #updates with the Updates Pings
    role's mention, a dev one in the dev updates channel with none;
  - "back", "down" and "off" are posted once each, after a "coming" was;
  - a "coming" long past, and an end whose "coming" never went out, are
    written down without a post;
  - a post that fails is tried again next pass;
  - the record keeps the newest 200;
  - the loop is started with the others, reads the agent's folder, and
    #updates is the Information category's channel or UPDATES_CHANNEL_ID.

The real bot module is imported. Never connects to anything.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import json
import shutil
import tempfile
import time

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''

import harness_bot  # noqa: E402

bot = harness_bot.whole()
FAIL = []
NOW = 1_800_000_000


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def stamp(t):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))


def notice(env, rid, state='coming', down=None, why='an update'):
    return {'environment': env, 'id': rid, 'state': state,
            'downUtc': stamp(NOW + 300 if down is None else down), 'why': why,
            'writtenUtc': stamp(NOW)}


class Msg:
    def __init__(self, i):
        self.id = i


class World:
    def __init__(self):
        self.posts, self.saves = [], 0
        self.down = set()

    async def send(self, channel, doc, what):
        if channel in self.down:
            return None
        self.posts.append((channel, doc['id'], what, bot.restart_text(doc, what, ping='@pings' if channel == 'main' and what == 'coming' else '')))
        return Msg(700 + len(self.posts))

    def save(self, state):
        self.saves += 1


def run(state, w, docs, now=NOW):
    return asyncio.run(bot.restarts_once(state, docs, w.send, w.save, now=now))


# ---- the files -------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix='tw-restarts-')
try:
    yes('no folder is no notice', bot.restart_docs(os.path.join(tmp, 'none')) == [])
    with open(os.path.join(tmp, 'restart-main.json'), 'w', encoding='utf-8') as f:
        json.dump(notice('main', 'main-1'), f)
    with open(os.path.join(tmp, 'restart-dev.json'), 'w', encoding='utf-8') as f:
        f.write('{ not json')
    with open(os.path.join(tmp, 'restart-site.json'), 'w', encoding='utf-8') as f:
        json.dump({'id': 'x', 'state': 'sideways', 'downUtc': stamp(NOW)}, f)
    with open(os.path.join(tmp, 'news-main.json'), 'w', encoding='utf-8') as f:
        json.dump(notice('main', 'main-9'), f)
    got = bot.restart_docs(tmp)
    yes('a notice is read; one that does not read, one that is not a notice and the news are left out',
        [d['id'] for d in got] == ['main-1'])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ---- coming, then back -----------------------------------------------------
state, w = {}, World()
done = run(state, w, [notice('main', 'main-1')])
yes('a live server restart is posted ahead, in #updates', done == [('main-1', 'coming')]
    and w.posts[0][:3] == ('main', 'main-1', 'coming'))
text = w.posts[0][3]
yes('  it pings Updates Pings and gives the time as Discord\'s timestamp',
    text.startswith('@pings ') and ('<t:%d:t>' % (NOW + 300)) in text and ('<t:%d:R>' % (NOW + 300)) in text)
yes('  it says why and that nobody has to log out', 'for an update' in text and 'do not need to log out' in text)
run(state, w, [notice('main', 'main-1')])
yes('and is never posted twice', len(w.posts) == 1)
done = run(state, w, [notice('main', 'main-1', 'back')])
yes('the server back is posted once, without a ping', done == [('main-1', 'end')]
    and w.posts[-1][3] == 'The server is back up after the restart.')
run(state, w, [notice('main', 'main-1', 'back')])
yes('  and not again', len(w.posts) == 2)

# ---- dev, down and off -----------------------------------------------------
state, w = {}, World()
run(state, w, [notice('dev', 'dev-1', down=NOW + 60), notice('main', 'main-2')])
yes('a dev restart goes to the dev updates channel with no ping',
    ('dev', 'dev-1', 'coming') == w.posts[0][:3] and w.posts[0][3].startswith('The dev server restarts'))
run(state, w, [notice('dev', 'dev-1', 'down', down=NOW + 60), notice('main', 'main-2', 'off')])
yes('one that did not come back, and one called off, are each said',
    'did not come back' in w.posts[2][3] and 'called off' in w.posts[3][3] and 'The server stays up' in w.posts[3][3])

# ---- what is not posted ----------------------------------------------------
state, w = {}, World()
done = run(state, w, [notice('main', 'old-1', down=NOW - 20 * 60), notice('main', 'missed-1', 'back', down=NOW - 60)])
yes('a coming long past and an end whose coming never went out are written down unposted',
    sorted(done) == [('missed-1', 'skip'), ('old-1', 'skip')] and w.posts == [])
run(state, w, [notice('main', 'old-1', 'back', down=NOW - 20 * 60)])
yes('  and nothing follows them', w.posts == [])

# ---- a post that fails -----------------------------------------------------
state, w = {}, World()
w.down.add('main')
done = run(state, w, [notice('main', 'main-3'), notice('dev', 'dev-3', down=NOW + 60)])
yes('a failed post waits, the other channel goes on', done == [('dev-3', 'coming')] and 'main-3' not in state['said'])
w.down.clear()
done = run(state, w, [notice('main', 'main-3')])
yes('next pass it goes', done == [('main-3', 'coming')])

# ---- the record keeps the newest -------------------------------------------
state, w = {'said': dict(('old-%d' % i, {'at': i, 'coming': 1, 'end': 'back'}) for i in range(bot.RESTART_KEEP))}, World()
run(state, w, [notice('main', 'main-4')])
yes('the record keeps the newest 200', len(state['said']) == bot.RESTART_KEEP
    and 'main-4' in state['said'] and 'old-0' not in state['said'])

# ---- started, where, and how often -----------------------------------------
src = harness_bot.source()
yes('the loop is started with the others', 'asyncio.create_task(watch_restarts())' in src)
yes('it reads the folder the agent writes', bot.restart_docs.__defaults__ == (None,) and bot.NEWS_DIR in (
    r'C:\Thornswood-Deploys\for-bot', os.environ.get('THORNSWOOD_NEWS_DIR')))
yes('it looks often enough for dev\'s one-minute lead', bot.RESTART_EVERY <= 30)
yes('#updates is the Information category\'s, as Build-Discord.py plans it',
    "('Information', [" in open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
    and "name='updates'" in open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
    and bot.UPDATES_CATEGORY == 'information' and bot.UPDATES_NAME == 'updates')
yes('the ping role is the one the hold panel hands out', ('updates', bot.UPDATES_PING_ROLE, 'Updates pings') in bot.PINGS)

print()
print('%d failed' % len(FAIL) if FAIL else 'all passed')
sys.exit(1 if FAIL else 0)
