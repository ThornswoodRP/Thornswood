"""
test-onboarding-defaults.py

A build takes the channels the plan gates off Onboarding's default channels.

Measured on the live server on 12 Nov 2026 (Setup-Discord build of 1:40 PM,
main df3738c): with Onboarding off, Discord still refused to shut @everyone
out of #start-here and #disboard, "400 Onboarding channels must be readable
by everyone", because Onboarding keeps its default channels while it is off.
Every other channel of the plan took its overwrites.

So this checks:

  1. onboarding_shut names the default channels whose plan mode shuts
     @everyone out (#start-here, #disboard), and not one @everyone reads
     (#rules, #welcome-travelers) or one the plan does not name
  2. keep_onboarding_channels takes those off the list and keeps the rest,
     in one edit that names only the default channels (Onboarding itself,
     its prompts and its mode are not sent)
  3. -Check says what it would take and changes nothing; a list with
     nothing to take asks Discord for nothing; a refusal is said as a
     failure
  4. a whole build does it before any channel is gated, and the audit says
     when a default channel is one the plan gates

Build-Discord.py is imported for real under another name. Every guild and
channel is a stand-in. Connects to nothing.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341).
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import contextlib
import importlib.util
import io
import types

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord_onboarding', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


def quiet(coro):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(coro)
    return buf.getvalue()


class Guild(object):
    def __init__(self, names, defaults, refuse=False):
        self.channels = dict((100 + i, types.SimpleNamespace(id=100 + i, name=n))
                             for i, n in enumerate(names))
        by = dict((c.name, c.id) for c in self.channels.values())
        self.ob = types.SimpleNamespace(enabled=False,
                                        default_channel_ids=set(by[n] for n in defaults))
        self.edits = []
        self.refuse = refuse

    def get_channel(self, cid):
        return self.channels.get(cid)

    async def onboarding(self):
        return self.ob

    async def edit_onboarding(self, **kw):
        if self.refuse:
            raise discord.HTTPException(types.SimpleNamespace(status=400, reason='Bad'),
                                        'no')
        self.edits.append(kw)
        if 'default_channels' in kw:
            self.ob.default_channel_ids = set(c.id for c in kw['default_channels'])

    def names(self):
        return sorted(self.channels[i].name for i in self.ob.default_channel_ids)


NAMES = ['rules', 'start-here', 'disboard', 'welcome-travelers', 'somewhere-else']
LIVE = ['rules', 'start-here', 'disboard', 'welcome-travelers', 'somewhere-else']

# ------------------------------------------------------------------ 1 --
g = Guild(NAMES, LIVE)
yes('1 the default channels the plan gates are named: #start-here and #disboard',
    [n for _i, n in B.onboarding_shut(g, g.ob)] == ['start-here', 'disboard'])
yes('1 #rules and #welcome-travelers, which @everyone reads, are not',
    B.everyone_reads(dict((s['name'], s['mode']) for _c, sp in B.PLAN for s in sp
                          if s['kind'] != 'voice')['rules'])
    and B.everyone_reads(dict((s['name'], s['mode']) for _c, sp in B.PLAN for s in sp
                              if s['kind'] != 'voice')['welcome-travelers']))

# ------------------------------------------------------------------ 3 --
B.CHECK = True
B.failed = []
said = quiet(B.keep_onboarding_channels(g))
B.CHECK = False
yes('3 -Check says it would take #start-here and #disboard off, and changes nothing',
    'would' in said and '#start-here' in said and '#disboard' in said and not g.edits)

# ------------------------------------------------------------------ 2 --
said = quiet(B.keep_onboarding_channels(g))
yes('2 a build takes them off in one edit', len(g.edits) == 1
    and g.names() == ['rules', 'somewhere-else', 'welcome-travelers'])
yes('2 the edit sends only the default channels: not Onboarding on or off, its '
    'prompts or its mode', list(g.edits[0]) == ['default_channels', 'reason'])
yes('2 and says what it took', '#start-here' in said and '#disboard' in said
    and not B.failed)
quiet(B.keep_onboarding_channels(g))
yes('3 a second run asks Discord for nothing', len(g.edits) == 1)

# The live build of 12 Nov, 4:03 PM: Onboarding still listed a channel
# deleted since, and Discord refused the whole edit, "Unknown channel".
d = Guild(NAMES, LIVE)
d.ob.default_channel_ids.add(999)
real_edit = d.edit_onboarding


async def strict(**kw):
    if any(c.id not in d.channels for c in kw.get('default_channels', [])):
        raise discord.HTTPException(types.SimpleNamespace(status=400, reason='Bad'),
                                    'Unknown channel')
    await real_edit(**kw)
d.edit_onboarding = strict
B.failed = []
said = quiet(B.keep_onboarding_channels(d))
yes('2 a deleted channel still on the list is left off what is sent back, so Discord '
    'takes the edit', not B.failed and len(d.edits) == 1
    and sorted(c.id for c in d.edits[0]['default_channels']) == [100, 103, 104]
    and 'deleted' in said)

r = Guild(NAMES, LIVE, refuse=True)
B.failed = []
quiet(B.keep_onboarding_channels(r))
yes('3 a refusal is said as a failure, naming the channels',
    len(B.failed) == 1 and '#start-here' in B.failed[0])
B.failed = []

# ------------------------------------------------------------------ 5 --
# The live build of 13 Nov, 5:20 PM: with both off the default list, Discord
# still refused to gate #start-here and #disboard. The Welcome Screen and
# Onboarding's answers point people at channels too.


class Screen(object):
    def __init__(self, guild, names):
        self.welcome_channels = [discord.WelcomeChannel(
            channel=types.SimpleNamespace(id=cid), description='about ' + n, emoji=None)
            for cid, n in ((dict((c.name, c.id) for c in guild.channels.values())[n], n)
                           for n in names)]
        self.description = 'Hello'
        self.enabled = True


w = Guild(NAMES, ['rules'])
w.screen = Screen(w, ['rules', 'start-here', 'disboard', 'welcome-travelers'])
w.screen_edits = []


async def _screen():
    return w.screen


async def _edit_screen(**kw):
    w.screen_edits.append(kw)
w.welcome_screen = _screen
w.edit_welcome_screen = _edit_screen
yes('5 the Welcome Screen channels the plan gates are named: #start-here and #disboard',
    [n for _i, n in B.welcome_shut(w, w.screen)] == ['start-here', 'disboard'])
B.CHECK = True
B.failed = []
said = quiet(B.keep_welcome_screen(w))
B.CHECK = False
yes('5 -Check says it would take them off the Welcome Screen and changes nothing',
    'would' in said and '#start-here' in said and not w.screen_edits)
said = quiet(B.keep_welcome_screen(w))
sent = w.screen_edits[0] if w.screen_edits else {}
yes('5 a build takes them off in one edit, keeping the others with their words',
    len(w.screen_edits) == 1
    and [c.channel.id for c in sent.get('welcome_channels', [])] == [100, 103]
    and [c.description for c in sent['welcome_channels']] == ['about rules',
                                                              'about welcome-travelers']
    and 'description' not in sent and 'enabled' not in sent and not B.failed)


async def _no_screen():
    raise discord.HTTPException(types.SimpleNamespace(status=404, reason='Not Found'), 'none')
n = Guild(NAMES, ['rules'])
n.welcome_screen = _no_screen
B.failed = []
quiet(B.keep_welcome_screen(n))
yes('5 a server with no Welcome Screen is left alone, and that is no failure', not B.failed)

ob = types.SimpleNamespace(prompts=[types.SimpleNamespace(title='Why are you here', options=[
    types.SimpleNamespace(title='To chat', channel_ids={101}),
    types.SimpleNamespace(title='To read', channel_ids={100})])])
guide = {'enabled': True, 'new_member_actions': [{'channel_id': '102', 'title': 'Bump'}],
         'resource_channels': [{'channel_id': '100', 'title': 'Rules'}]}
yes('5 the Server Guide channels the plan gates are named, wherever in it they are',
    B.guide_shut(w, guide) == {'disboard'})
yes('5 an Onboarding answer that points to a gated channel is named',
    B.prompt_shut(w, ob) == ['Why are you here: To chat: #start-here'])

# ------------------------------------------------------------------ 4 --
src = open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
build = src[src.index('found = {}\n        posts = []'):]
yes('4 a whole build does it, and the Welcome Screen, before it gates any channel',
    build.index('await keep_onboarding_channels(guild)')
    < build.index('for catname, specs in plan_for(ONLY):')
    and build.index('await keep_welcome_screen(guild)')
    < build.index('for catname, specs in plan_for(ONLY):'))
audit = src[src.index('async def audit('):]
yes('4 the audit names a gated channel on the Welcome Screen and in an Onboarding answer',
    'welcome_shut(guild, await guild.welcome_screen())' in audit
    and 'prompt_shut(guild, ob)' in audit
    and 'guide_shut(guild, await read_server_guide(guild))' in audit)
yes('4 the audit says when a default channel is one the plan gates, and names a '
    'deleted one still on the list',
    'onboarding_shut(guild, ob)' in audit and 'which the server no' in audit)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
