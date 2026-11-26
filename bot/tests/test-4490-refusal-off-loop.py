"""
test-4490-refusal-off-loop.py

The forum passes make their refusal comment off the bot's loop, and a
refusal whose comment failed is tried again on the next pass (#4490).

When #known-issues, #test-tasks or #dev-test-tasks refuse a post, the pass
comments on the issue why. That comment is a call to GitHub that can wait 20
seconds (github_say), and the passes made it on the bot's event loop, so the
heartbeat, buttons and slash commands all waited with it, and a click that
waits over 3 seconds fails in Discord. The roadmap pass already ran it off
the loop. And though refuse() stopped remembering a failed comment (#4348),
each pass still marked the issue read at its update time, and a comment that
failed does not move that time, so the next pass skipped the issue and the
comment was never tried again.

Each of the three passes is run for real, with a stand-in GitHub:

  A. while the comment is being made, the loop still runs something else,
     and the comment is made on another thread;
  B. a comment that fails is made again on the next pass, though the issue
     has not changed, and once GitHub takes it the pass after says nothing.

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
import threading
import time

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))


class Forum(object):
    id = 1

    def __getattr__(self, name):
        raise AssertionError('the forum was touched: ' + name)


# ------------------------------------------------------- the three passes --
def world(kind):
    """(state, once) for one pass. once(say) is that pass, run once."""
    if kind == 'dev':
        issue = {'number': 41, 'title': 'Log', 'state': 'open',
                 'updated_at': '2026-10-22T10:00:00Z',
                 'html_url': 'https://github.com/ThornswoodRP/Thornswood/issues/41',
                 'labels': []}
        comments = [{'body': 'Test task: Count the log\nServer: Dev\n1. Claude reads the log.',
                     'created_at': '2026-10-22T09:00:00Z', 'html_url': 'c1'}]
        state = {'dev_since': '2026-10-20T00:00:00Z'}

        def get(url):
            if '/comments' in url:
                return comments
            if '/timeline' in url:
                return []
            if '/issues?' in url or url.endswith('/issues'):
                return [dict(issue)]
            raise AssertionError(url)
        return state, (lambda say: bot.dev_tasks_once(Forum(), state, get, me_id=1, say=say))
    if kind == 'known':
        issue = {'number': 52, 'title': 'Doors stick', 'state': 'open',
                 'updated_at': '2026-10-22T10:00:00Z',
                 'html_url': 'https://github.com/ThornswoodRP/Thornswood/issues/52',
                 'labels': [{'name': label} for label in bot.KNOWN_LABELS]}
        state = {}

        def get(url):
            if '/comments' in url:
                return []       # no "Known issue:" comment: the post is refused
            if '/issues?' in url and 'state=open' in url:
                return [dict(issue)]
            raise AssertionError(url)
        return state, (lambda say: bot.known_issues_once(Forum(), state, get, me_id=1, say=say))
    issue = {'number': 63, 'title': 'Forge', 'state': 'closed', 'state_reason': 'completed',
             'updated_at': '2026-10-22T10:00:00Z', 'closed_at': '2026-10-22T10:00:00Z',
             'html_url': 'https://github.com/ThornswoodRP/Thornswood/issues/63',
             'labels': []}
    comments = [{'body': 'Test task: The forge works\nServer: Main\nOpen the forge and look.',
                 'created_at': '2026-10-22T09:00:00Z', 'html_url': 'c1'}]
    state = {'since': '2026-10-20T00:00:00Z'}

    def get(url):
        if '/comments' in url:
            return comments
        if '/timeline' in url:
            return []
        if '/issues?' in url and 'state=closed' in url:
            return [dict(issue)]
        if '/releases?' in url:
            return []
        raise AssertionError(url)
    return state, (lambda say: bot.test_tasks_once(Forum(), state, get, me_id=1, say=say))


def run(coro):
    return asyncio.run(coro)


for kind in ('known', 'main', 'dev'):
    # A. off the loop
    state, once = world(kind)
    started, ticked = threading.Event(), threading.Event()
    seen = {}

    def slow_say(num, text):
        seen['thread'] = threading.get_ident()
        started.set()
        # Only a loop that is free can run the ticker below while this waits.
        seen['loop_ran'] = ticked.wait(2)
        return {'id': 1}

    async def ticker():
        give_up = time.monotonic() + 5
        while not started.is_set() and time.monotonic() < give_up:
            await asyncio.sleep(0.005)
        ticked.set()

    async def both():
        await asyncio.gather(once(slow_say), ticker())

    try:
        run(both())
        ran = True
    except Exception as e:
        print('      the %s pass raised: %r' % (kind, e))
        ran = False
    yes('A %s: the pass made its refusal comment' % kind, ran and 'thread' in seen)
    yes('A %s: the loop ran something else while the comment was made' % kind,
        seen.get('loop_ran') is True)
    yes('A %s: and the comment was made on another thread' % kind,
        seen.get('thread') not in (None, threading.main_thread().ident))

    # B. a failed comment is made again on the next pass
    state, once = world(kind)
    tried = []

    def refused_by_github(num, text):
        tried.append(num)
        raise OSError('HTTP Error 403: Resource not accessible by integration')

    def taken_by_github(num, text):
        tried.append(num)
        return {'id': 1}

    try:
        run(once(refused_by_github))
        run(once(taken_by_github))
        run(once(taken_by_github))
        ran = True
    except Exception as e:
        print('      the %s pass raised: %r' % (kind, e))
        ran = False
    yes('B %s: a failed comment is made again on the next pass, the issue unchanged (tried %r)'
        % (kind, tried), ran and len(tried) >= 2)
    yes('B %s: and once GitHub took it, the pass after says nothing more' % kind,
        ran and len(tried) == 2)

print('\n%d failed' % len(FAIL) if FAIL else '\nall passed')
sys.exit(1 if FAIL else 0)
