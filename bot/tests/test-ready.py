"""
test-ready.py

Startup does the one-off things once, and the panel is read before it is
written.

From the To Do List: "on_ready re-registers views, re-syncs commands and
re-edits the panel on every reconnect... On a flaky evening the bot is one of
the things making the evening worse for itself, and a rate-limited sync writes
a traceback the log viewer then hides."

on_ready is not a startup hook. It fires every time the gateway connection
drops and comes back, which is exactly when Discord is already unhappy, and
every one of those was three writes to Discord that changed nothing plus an
edit to the ticket panel.

The real bot module is imported and the real coroutine is run. Only the things
that touch Discord are replaced: the guild list, the command tree's three
calls, and the stamp file, which is pointed at a temporary folder so this
cannot touch the one beside the code.

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
import shutil
import tempfile

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


class Guild(object):
    def __init__(self, gid, name):
        self.id = gid
        self.name = name


class Cmd(object):
    """
    One command in the tree.

    A group is a Cmd given children, and it holds them in `commands`, the
    name discord.py's Group uses. A plain command has no such attribute at
    all, the same as a real Command, so the walk is proved against both.
    """

    def __init__(self, name, children=()):
        self.name = name
        if children:
            self.commands = [command(c) for c in children]


def command(spec):
    """A name is a plain command; (name, [children]) is a group."""
    if isinstance(spec, tuple):
        return Cmd(spec[0], spec[1])
    return Cmd(spec)


class Tree(object):
    """
    The command tree, counting instead of calling Discord.

    copied, synced and cleared are the three writes. A sync is the one Discord
    rate limits hardest, so the number that matters in every check below is
    synced.
    """

    def __init__(self, names):
        self._commands = [command(n) for n in names]
        self.copied = 0
        self.synced = 0
        self.cleared = 0

    def get_commands(self):
        return list(self._commands)

    def copy_global_to(self, guild=None):
        self.copied += 1

    def clear_commands(self, guild=None):
        self.cleared += 1

    async def sync(self, guild=None):
        self.synced += 1


class Client(object):
    def __init__(self, guilds):
        self.guilds = guilds


def run(names, guilds, force=0):
    """One start of the bot, with the real register_commands."""
    tree = Tree(names)
    was_tree, was_client, was_force = bot.tree, bot.client, bot.FORCE_SYNC
    bot.tree, bot.client, bot.FORCE_SYNC = tree, Client(guilds), force
    try:
        asyncio.run(bot.register_commands())
    finally:
        bot.tree, bot.client, bot.FORCE_SYNC = was_tree, was_client, was_force
    return tree


def fingerprint(names):
    """What the stamp would hold for that tree, without registering anything."""
    was_tree = bot.tree
    bot.tree = Tree(names)
    try:
        return bot._command_names()
    finally:
        bot.tree = was_tree


TMP = tempfile.mkdtemp(prefix='thornswood-ready-')
bot.STAMP = os.path.join(TMP, 'commands-synced.json')

try:
    HOME = [Guild(1, 'Thornswood')]

    # ------------------------------------------------ the first start ever
    first = run(['close'], HOME)
    yes('a first start registers the commands', first.synced == 2 and first.copied == 1)
    yes('and clears the global list, so nothing appears twice in the picker',
        first.cleared == 1)
    yes('and writes down what it registered', os.path.exists(bot.STAMP))

    # ------------------------------------------------- THE ONE THIS IS FOR
    second = run(['close'], HOME)
    yes('a reconnect or a restart registers nothing at all',
        second.synced == 0 and second.copied == 0 and second.cleared == 0)

    # ------------------------------------------------------ a new command
    third = run(['close', 'roll'], HOME)
    yes('adding a command registers again', third.synced == 2)
    fourth = run(['close', 'roll'], HOME)
    yes('and then stops again', fourth.synced == 0)

    # The order commands come back in is not something to depend on.
    fifth = run(['roll', 'close'], HOME)
    yes('the same commands in a different order are the same commands',
        fifth.synced == 0)

    # ------------------------------------- a subcommand under a group --
    #
    # /live-smoke report was merged, deployed with Install-Bot.ps1 -CodeOnly,
    # and never reached the picker: the stamp held top level names only, so a
    # new child of a group that was already registered left it identical and
    # the start skipped the sync. It took FORCE_COMMAND_SYNC to put the
    # subcommand there, which is not something a deploy should need.
    GROUP = ('live-smoke', ['start', 'reset', 'refresh'])
    GROUP_PLUS = ('live-smoke', ['start', 'reset', 'refresh', 'report'])

    yes('a group is named with each of its children under it',
        fingerprint(['close', GROUP])
        == ['close', 'live-smoke', 'live-smoke refresh', 'live-smoke reset',
            'live-smoke start'])

    yes('A CHILD ADDED TO A GROUP CHANGES THE LIST, which is the bug this is '
        'for', fingerprint([GROUP]) != fingerprint([GROUP_PLUS]))

    yes('and the child it gained is the difference',
        sorted(set(fingerprint([GROUP_PLUS])) - set(fingerprint([GROUP])))
        == ['live-smoke report'])

    yes('a group inside a group is named the whole way down',
        'live-smoke rows show'
        in fingerprint([('live-smoke', [('rows', ['show'])])]))

    # The stamp is read back as whatever json held, so every name in it has to
    # be a string and the list has to be in one order whatever the tree's is.
    jumbled = fingerprint([GROUP_PLUS, 'close'])
    yes('the list is sorted and the same however the tree hands them over',
        jumbled == sorted(jumbled) and fingerprint(['close', GROUP_PLUS]) == jumbled)
    yes('and every name in it is a string, so the stamp is json it can read',
        all(isinstance(n, str) for n in jumbled))

    grouped = run(['close', GROUP], HOME)
    yes('a group registers like anything else', grouped.synced == 2)
    again = run(['close', GROUP], HOME)
    yes('and a restart with the same group registers nothing', again.synced == 0)
    gained = run(['close', GROUP_PLUS], HOME)
    yes('ADDING A SUBCOMMAND REGISTERS AGAIN, with no FORCE_COMMAND_SYNC and '
        'no deleting the stamp by hand', gained.synced == 2)
    settled = run(['close', GROUP_PLUS], HOME)
    yes('and then stops again', settled.synced == 0)

    lost = run(['close', GROUP], HOME)
    yes('a subcommand taken away registers again too', lost.synced == 2)

    # What goes in the file and what comes back out of it have to be the same
    # list, or every start after this one registers again.
    wrote, _ = bot._stamp_read()
    yes('the stamp holds what was registered, children and all',
        wrote == fingerprint(['close', GROUP]))

    # ---------------------------------------------------- a second server
    both = [Guild(1, 'Thornswood'), Guild(2, 'Thornswood dev')]
    sixth = run(['close', 'roll'], both)
    yes('a server the bot has just been added to is registered',
        sixth.synced == 3 and sixth.copied == 2)
    seventh = run(['close', 'roll'], both)
    yes('and the next start after that does nothing', seventh.synced == 0)

    # A server it was in and is no longer does not make it register again.
    eighth = run(['close', 'roll'], HOME)
    yes('leaving a server does not set it off', eighth.synced == 0)

    # ------------------------------------------------------- the override
    ninth = run(['close', 'roll'], HOME, force=1)
    yes('FORCE_COMMAND_SYNC registers whatever the stamp says', ninth.synced == 2)

    # ------------------------------------------ and it fails the safe way
    #
    # A stamp that cannot be read is a stamp that says nothing was registered,
    # so the commands go up. An unnecessary sync costs one rate limit slot; a
    # skipped one costs a slash command nobody has.
    with open(bot.STAMP, 'w') as f:
        f.write('this is not json')
    tenth = run(['close', 'roll'], HOME)
    yes('an unreadable stamp registers rather than assuming', tenth.synced == 2)

    # A folder that cannot be written to is the same answer: it registers
    # every start, which is what it did before any of this.
    bot.STAMP = os.path.join(TMP, 'no-such-folder', 'commands-synced.json')
    eleventh = run(['close'], HOME)
    yes('a stamp that cannot be written registers every time', eleventh.synced == 2)
    twelfth = run(['close'], HOME)
    yes('and says so by doing it again rather than by going quiet',
        twelfth.synced == 2)

    # ------------------------------------------------------- the panel --
    #
    # The options a dropdown offers live in the message that was posted, not
    # in the View this process builds on startup, so both have to be compared.

    class Option(object):
        def __init__(self, value, label):
            self.value = value
            self.label = label

    class Item(object):
        def __init__(self, options):
            self.options = options

    class Row(object):
        def __init__(self, children):
            self.children = children

    class Message(object):
        def __init__(self, content, pairs):
            self.content = content
            self.components = [Row([Item([Option(v, l) for v, l in pairs])])]

    live = [(k, lab) for k, lab, _ in bot.KINDS]

    yes('a panel that already says the right thing is left alone',
        bot.panel_is_current(Message(bot.PANEL, live)))

    changed = live[:-1] + [(live[-1][0], live[-1][1] + ' (new wording)')]
    yes('a renamed ticket kind is edited', not bot.panel_is_current(Message(bot.PANEL, changed)))

    added = live + [('newkind', 'Apply: something new')]
    yes('A KIND ADDED LATER IS EDITED, which is the bug the comment records',
        not bot.panel_is_current(Message(bot.PANEL, added)))

    dropped = live[:-1]
    yes('a kind taken away is edited', not bot.panel_is_current(Message(bot.PANEL, dropped)))

    yes('different words with the same options are edited',
        not bot.panel_is_current(Message(bot.PANEL + ' and something else', live)))

    yes('the same words in a different order are not the same panel',
        not bot.panel_is_current(Message(bot.PANEL, list(reversed(live)))))

    # A message with no components at all, or one this cannot read: it is
    # edited. Failing that way round costs one audit log line; the other way
    # costs somebody a ticket they cannot open.
    blank = Message(bot.PANEL, live)
    blank.components = []
    yes('a message whose dropdown cannot be read is edited', not bot.panel_is_current(blank))

    broken = Message(bot.PANEL, live)
    broken.components = None
    yes('and so is one with nothing there at all', not bot.panel_is_current(broken))

    # ------------------------------------------- the tree this bot has --
    #
    # Nothing above touches the real tree, so read it here: the names the next
    # start will write down are the ones a person sees in the picker.
    real = bot._command_names()
    yes('the real tree names /close', 'close' in real)
    yes('and /test-task', 'test-task' in real)
    yes('and /faction-seat is gone', 'faction-seat' not in real)
    yes('and the Live smoke group is gone, every subcommand with it (11 Oct)',
        not [n for n in real if n.startswith('live-smoke')])

    # ------------------------------------- the views are not in on_ready --
    src = harness_bot.source()
    ready = src[src.index('async def on_ready():'):]
    yes('the persistent views are registered once, not on every reconnect',
        'add_view' not in ready and 'async def setup_hook' in src)

finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
