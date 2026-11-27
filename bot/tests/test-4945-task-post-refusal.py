"""
test-4945-task-post-refusal.py

/test-task blamed channel permissions for every Discord error (#4945). It
caught every discord.HTTPException from post_test_task and answered "In
#<channel> the bot needs View Channel, Send Messages and Create Posts", so a
Discord outage or a rate limit told the poster to fix permissions that were
fine.

  A. a 403 (Forbidden) names the permissions, in the channel the tag posts to;
  B. a 429 and a 5xx say Discord is having trouble and to try again, and name
     no permission;
  C. anything else gives Discord's own reason, on one line;
  D. /test-task answers through task_post_refusal.

The real bot module is imported. Never connects to anything.
"""
import inspect
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import discord  # noqa: E402

FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


class Answer(object):
    """What discord.py reads off the response an HTTPException is made from."""
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def refused(kind, status, reason, text):
    return kind(Answer(status, reason), text)


PERMS = 'View Channel, Send Messages and Create Posts'

# A
said = bot.task_post_refusal(refused(discord.Forbidden, 403, 'Forbidden', 'Missing Permissions'), bot.TASKS_NAME)
yes('A1 a 403 names the permissions', PERMS in said)
yes('A2 in the channel it posts to', ('#' + bot.TASKS_NAME) in said)
said = bot.task_post_refusal(refused(discord.Forbidden, 403, 'Forbidden', 'Missing Access'), bot.DEV_TASKS_NAME)
yes('A3 and #dev-test-tasks for a Dev task', ('#' + bot.DEV_TASKS_NAME) in said)

# B
for status, reason, kind in ((429, 'Too Many Requests', discord.HTTPException),
                             (500, 'Internal Server Error', discord.DiscordServerError),
                             (502, 'Bad Gateway', discord.DiscordServerError),
                             (503, 'Service Unavailable', discord.DiscordServerError)):
    said = bot.task_post_refusal(refused(kind, status, reason, reason), bot.TASKS_NAME)
    yes('B %d says Discord is having trouble and to try again' % status,
        'Discord is having trouble' in said and 'again' in said)
    yes('B %d names no permission' % status, 'View Channel' not in said and 'Create Posts' not in said)

# C
said = bot.task_post_refusal(refused(discord.HTTPException, 400, 'Bad Request',
                                     'Invalid Form Body\nIn name: Must be 100 or fewer in length.'),
                             bot.TASKS_NAME)
yes('C1 a 400 gives Discord\'s own reason', 'Must be 100 or fewer in length' in said)
yes('C2 on one line, naming no permission', '\n' not in said and 'View Channel' not in said)
said = bot.task_post_refusal(refused(discord.HTTPException, 400, 'Bad Request', 'x' * 900), bot.TASKS_NAME)
yes('C3 and a long reason is cut short', len(said) < 300)

# D
src = inspect.getsource(bot.test_task_cmd.callback if hasattr(bot.test_task_cmd, 'callback') else bot.test_task_cmd)
yes('D1 /test-task answers a refusal through task_post_refusal', 'task_post_refusal(e,' in src)
yes('D2 and no longer names the permissions on its own', PERMS not in src)

print('\n%d failed' % len(FAIL) if FAIL else '\nall passed')
sys.exit(1 if FAIL else 0)
