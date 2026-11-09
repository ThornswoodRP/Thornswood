"""
test-4349-dev-server-task.py

A Dev test task that only needs the dev server is a Dev test task (#4349).
docs/guide/the-board.md, "#dev-test-tasks", says a check only a dev can do
needs "staff or dev commands, the dev server, logs, the box, or a setup
testers cannot make". The bot's post_problems held a Dev task to DEV_ONLY,
which named the dev build, launcher, install and release but not the dev
server, so steps that only need devs on the dev server were refused as
ordinary playtester steps.

  A. two devs on the dev server, with no command, is not refused as
     ordinary playtester steps;
  B. the same steps on the normal game are still refused as Dev (that is a
     Main test task);
  C. a dev server task is still refused when a step is one a Claude or a
     command could do, as before.

The real bot module is imported. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)

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


def dev_problems(steps):
    return [p for p in bot.post_problems('dev', 'Trade between two', steps, server='Dev')
            if p.startswith('Dev test tasks')]


ON_DEV = ('1. Two devs join the dev server.\n'
          '2. One gives the other an iron dagger by trading.\n'
          'What should happen: the dagger moves to the second character.')
ON_MAIN = ('1. Two people join the server.\n'
           '2. One gives the other an iron dagger by trading.\n'
           'What should happen: the dagger moves to the second character.')

# A
yes('A1 steps that need only the dev server are a Dev test task',
    dev_problems(ON_DEV) == [])
yes('A2 and "the dev server" is read wherever it is in a step',
    dev_problems('1. On the dev server, open the market stall.\n'
                 'What should happen: the stall opens.') == [])

# B
yes('B1 the same steps on the normal game are still refused as Dev (that is Main)',
    any(p.startswith('Dev test tasks: these are ordinary') for p in dev_problems(ON_MAIN)))
yes('B2 and a server that is not the dev server does not count',
    any(p.startswith('Dev test tasks: these are ordinary')
        for p in dev_problems('1. Join the main server.\n2. Open the stall.\n'
                              'What should happen: it opens.')))

# C
yes('C1 a dev server step a Claude could do is still refused',
    any(p.startswith('Dev test tasks: a Claude')
        for p in dev_problems('1. Claude reads the dev server log and posts the count.\n'
                              'What should happen: one line.')))

print('\n%d failed' % len(FAIL) if FAIL else '\nall passed')
sys.exit(1 if FAIL else 0)
