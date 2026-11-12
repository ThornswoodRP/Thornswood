"""
test-everyone-sees-the-gate.py

Somebody who has just joined sees #rules and #welcome-travelers and talks in
neither. Reacting to the rules gives Member (bot_rules_gate.py, #5841), and
Member reads the welcome, about, ticket and application channels. Playtester
opens the rest.

Measured on the live server on 10 Nov 2026 (Setup-Discord -OnBox -Audit):
@everyone held no View Channels server wide. Every read channel's overwrite
only takes posting away, so it leaned on @everyone for View Channels, and
somebody with no role saw nothing of the gate. Patrick's order of 12 Nov
2026 (page cards q-discord-hand-given-member and q-discord-readback, A):
somebody new sees only #rules and #welcome-travelers; reacting to the rules
gives Member; Member lets them apply and read the welcome and about
channels, #game-rules, #lore and #factions included; nobody talks in
#welcome-travelers; #disboard is read only for everybody but staff, who
bump.

So this checks:

  1. The problem, measured: with @everyone as the audit read it, a newcomer
     sees neither #rules nor #welcome-travelers.
  2. keep_everyone gives @everyone what it is missing of PLAIN, keeps what it
     holds beyond it, changes nothing under -Check, and asks nothing when
     nothing is missing. The audit names what is missing.
  3. After it, by the plan's own modes: a newcomer sees and cannot post in
     #rules and #welcome-travelers and sees nothing else of the gate; a
     Member sees and cannot post in the welcome, about, ticket and
     application channels and #disboard, and still not #general-chat; nobody
     but the bot posts in #welcome-travelers; in #disboard a Member and a
     Playtester run no command and staff talk and run commands. #disboard is
     #say-hello renamed.

Build-Discord.py is imported for real under another name, so its __main__
block never runs. Every guild, role and channel is a stand-in. A member's
permissions are worked out in Discord's documented order, as
test-bot-overwrites.py does. Read only; connects to nothing.
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
    'build_discord_gate', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

# @everyone server wide, as the audit of 10 Nov 2026 printed it.
LIVE = ('add_reactions', 'attach_files', 'change_nickname', 'connect',
        'create_instant_invite', 'create_private_threads', 'create_public_threads',
        'embed_links', 'external_emojis', 'external_stickers',
        'read_message_history', 'request_to_speak', 'send_messages',
        'send_messages_in_threads', 'send_polls', 'send_voice_messages',
        'set_voice_channel_status', 'speak', 'stream', 'use_application_commands',
        'use_embedded_activities', 'use_external_apps', 'use_external_sounds',
        'use_soundboard', 'use_voice_activation')


def live_everyone():
    p = discord.Permissions.none()
    for n in LIVE:
        setattr(p, n, True)
    return p


class Role(object):
    def __init__(self, name, rid, perms):
        self.name = name
        self.id = rid
        self.permissions = discord.Permissions(perms.value)
        self.edits = []

    async def edit(self, **kw):
        self.edits.append(kw)
        if 'permissions' in kw:
            self.permissions = kw['permissions']

    def __repr__(self):
        return '<role %s>' % self.name


class Member(object):
    def __init__(self, roles):
        self.roles = list(roles)


def resolve(everyone, member, ow):
    """A member's permissions in a channel, in Discord's documented order."""
    p = discord.Permissions(everyone.permissions.value)
    for r in member.roles:
        p.value |= r.permissions.value
    if p.administrator:
        return discord.Permissions.all()
    if everyone in ow:
        a, d = ow[everyone].pair()
        p.handle_overwrite(a.value, d.value)
    allow = deny = 0
    for r in member.roles:
        if r in ow:
            a, d = ow[r].pair()
            allow |= a.value
            deny |= d.value
    p.handle_overwrite(allow, deny)
    return p


def quiet(coro):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(coro)
    return buf.getvalue()


ids = iter(range(1000, 9999))
everyone = Role('@everyone', 1, live_everyone())
roles = dict((name, Role(name, next(ids), perms)) for name, _c, _h, perms in B.ROLES)
guild = types.SimpleNamespace(default_role=everyone, me=None,
                              roles=[everyone] + list(roles.values()))

newcomer = Member([])
member = Member([roles['Member']])
tester = Member([roles['Playtester']])
support = Member([roles['Support']])

# Every planned text place, with the overwrites its mode gives.
places = {}
for catname, specs in B.PLAN:
    places[catname] = B.category_overwrites(guild, catname, roles)
    for s in specs:
        if s['kind'] == 'voice':
            continue
        places['#' + s['name']] = B.spec_overwrites(guild, s, roles)

GATE = ['Start Here', '#rules', '#welcome-travelers']
MEMBERS_READ = ['Tickets', 'Applications', 'Information', 'Roleplay Guide',
                '#welcome', '#start-here', '#get-help', '#report-someone',
                '#apply-to-playtest', '#apply-for-a-seat', '#apply-for-staff',
                '#news', '#updates', '#faq', '#game-rules', '#lore',
                '#factions', '#disboard']
BEHIND = ['#general-chat', '#media', '#choose-your-hold', '#suggestions']

# ------------------------------------------------------ 1. the problem --
yes('as the audit read it, a newcomer sees neither #rules nor #welcome-travelers',
    not any(resolve(everyone, newcomer, places[p]).view_channel
            for p in ('#rules', '#welcome-travelers')))

# -------------------------------------------------- 2. keep_everyone --
B.CHECK = True
said = quiet(B.keep_everyone(guild))
B.CHECK = False
yes('-Check says @everyone would get View Channels and changes nothing',
    'would change' in said and 'view_channel' in said.replace(' ', '_').lower()
    and everyone.edits == [])

B.failed = []
quiet(B.keep_everyone(guild))
yes('a build gives @everyone View Channels in one edit', len(everyone.edits) == 1
    and everyone.permissions.view_channel)
_, missing = B.perm_diff(everyone.permissions, B.PLAIN)
yes('  and @everyone then holds every one of PLAIN', not missing)
yes('  and keeps what it held beyond PLAIN: voice activity, invites, polls',
    all(getattr(everyone.permissions, n) for n in LIVE))
quiet(B.keep_everyone(guild))
yes('a second run asks nothing', len(everyone.edits) == 1)

src = open(os.path.join(HERE, 'Build-Discord.py'), encoding='utf-8').read()
audit = src[src.index('async def audit('):]
audit = audit[:audit.index('\nasync def ') if '\nasync def ' in audit[10:] else len(audit)]
yes('the audit names what @everyone is missing of PLAIN',
    'perm_diff(guild.default_role.permissions, PLAIN)' in audit)

# ------------------------------------------------ 3. the gate, after --
for p in GATE:
    got = resolve(everyone, newcomer, places[p])
    if not p.startswith('#'):
        yes('a newcomer sees the %s category' % p, got.view_channel)
        continue
    yes('a newcomer sees %s and cannot post in it' % p,
        got.view_channel and got.read_message_history and not got.send_messages)
    yes('  and can react there (the rules reaction is how Member is given)',
        got.add_reactions)
for p in MEMBERS_READ:
    yes('a newcomer does not see %s' % p,
        not resolve(everyone, newcomer, places[p]).view_channel)
    got = resolve(everyone, member, places[p])
    if not p.startswith('#'):
        yes('  and a Member sees the %s category' % p, got.view_channel)
        continue
    yes('  and a Member sees it, reads it back and cannot post in it',
        got.view_channel and got.read_message_history and not got.send_messages)
for who, m in (('a Member', member), ('a Playtester', tester), ('staff', support)):
    got = resolve(everyone, m, places['#welcome-travelers'])
    yes('%s reads #welcome-travelers and does not talk or run a command there' % who,
        got.view_channel and not got.send_messages and not got.use_application_commands)
for who, m in (('a Member', member), ('a Playtester', tester)):
    got = resolve(everyone, m, places['#disboard'])
    yes('%s reads #disboard, does not post and runs no command there (a /bump is one)' % who,
        got.view_channel and not got.send_messages and not got.use_application_commands)
for who, m in (('staff (Support)', support),
               ('staff who are a Member and a Playtester as well',
                Member([roles['Member'], roles['Playtester'], roles['Moderator']]))):
    got = resolve(everyone, m, places['#disboard'])
    yes('%s talk and run commands in #disboard, so staff bump' % who,
        got.view_channel and got.send_messages and got.use_application_commands)
for p in BEHIND:
    yes('a Member still does not see %s, which is Playtester\'s' % p,
        not resolve(everyone, member, places[p]).view_channel)
    yes('  and a Playtester does', resolve(everyone, tester, places[p]).view_channel)

hello = [s for _c, specs in B.PLAN for s in specs if s['name'] == 'disboard']
yes('#disboard is #say-hello renamed in Start Here, so its id and history go '
    'with it', len(hello) == 1 and ('Start Here', 'say-hello') in hello[0].get('was', ())
    and ('Start Here', 'dishboard') in hello[0].get('was', ()))
yes('there is no #say-hello in the plan beside it',
    not [s for _c, specs in B.PLAN for s in specs if s['name'] == 'say-hello'])

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
