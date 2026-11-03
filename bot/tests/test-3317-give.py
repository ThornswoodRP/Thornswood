"""
test-3317-give.py

What the live build of 22 Oct left (#3317, the Cloud Desk's run, comment
6348042833 on the issue):

  G1 the staff pulled into every ticket are one list, by name, in bot.py's
     STAFF_ROLES default, Install-Bot's -StaffRoles default and
     Build-Discord.py's TICKET_STAFF, and it holds the whole council. The
     run found Install-Bot's default without the council, so every full
     Install-Bot dropped the council from tickets
  G2 -Give finds one member exactly, by id or by a whole name, never by a
     part of one
  G3 -Give refuses a second rank of one category, a rank to a seat holder
     and anything that is not a staff rank, and says when a rank is held
  G4 -Give gives through Discord, and under -Check gives nothing
  G5 a name that matches nobody, or more than one, gives nothing and says
     the names like it
  G6 a whole build switches Discord's Onboarding off before it gates a
     channel (Patrick picked the Member button, q-3317-member-gate A, and
     Onboarding made Discord refuse the gate on two channels); -Check and a
     server with it off ask nothing
  G7 the audit says Onboarding is on, and prints every plan role's id and
     the two Install-Bot lines bot.env.json is written with

Build-Discord.py is imported for real, under another name, so its __main__
block never runs. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import contextlib
import importlib.util
import io
import re
import types

ROOT = os.path.dirname(HERE)

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


# ------------------------------------------------------------------ G1 --
import harness_bot  # noqa: E402
bot_src = harness_bot.source()
m = re.search(r"os\.environ\.get\('STAFF_ROLES',\s*((?:'[^']*'\s*)+)\)", bot_src)
bot_default = ''.join(re.findall(r"'([^']*)'", m.group(1))) if m else ''
m = re.search(r"\[string\]\$StaffRoles\s*=\s*'([^']*)'", read('scripts/deploy/Install-Bot.ps1'))
install_default = m.group(1) if m else ''
yes('G1 Install-Bot\'s -StaffRoles default is bot.py\'s STAFF_ROLES default',
    bot_default and install_default == bot_default)

try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('%d passed, %d failed' % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)

spec = importlib.util.spec_from_file_location(
    'build_discord_give', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

yes('G1 and it is Build-Discord.py\'s TICKET_STAFF, the whole council first',
    bot_default.split(',') == list(B.TICKET_STAFF)
    and list(B.TICKET_STAFF[:len(B.COUNCIL_ROLES)]) == list(B.COUNCIL_ROLES))

CALLS = []


class Role(object):
    def __init__(self, name, rid):
        self.name = name
        self.id = rid
        self.members = []
        self.permissions = discord.Permissions.none()
        self.managed = False
        self.position = 0


class Member(object):
    def __init__(self, mid, name, roles, nick=None, global_name=None):
        self.id = mid
        self.name = name
        self.global_name = global_name
        self.nick = nick
        self.display_name = nick or global_name or name
        self.roles = list(roles)

    async def add_roles(self, *roles, **kw):
        CALLS.append(('add_roles', self.display_name, tuple(r.name for r in roles)))
        self.roles += list(roles)


class Guild(object):
    name = 'Thornswood stand-in'

    def __init__(self, onboarding=False):
        self.roles = [Role(n, 1000 + i) for i, (n, _, _, _) in enumerate(B.ROLES)]
        self.default_role = Role('@everyone', 1)
        self.named = dict((r.name, r) for r in self.roles)
        n = self.named
        self.members = [
            Member(10, 'evilpatrick', [n['Owner']], global_name='Patrick Thornwood'),
            Member(11, 'wiccandjinn', [n['Lead Gamemaster'], n['Dev']], global_name='WiccanDjinn'),
            Member(12, 'bladeworks', [], global_name='Blade'),
            Member(13, 'bladefan', [], global_name='Bladefan'),
            Member(14, 'jarl', [n['Jarl of Riften']]),
            Member(15, 'twin1', [], nick='Twin'),
            Member(16, 'twin2', [], nick='Twin'),
        ]
        self.onboarding_enabled = onboarding

    async def onboarding(self):
        return types.SimpleNamespace(enabled=self.onboarding_enabled)

    async def edit_onboarding(self, **kw):
        CALLS.append(('edit_onboarding', kw.get('enabled')))
        self.onboarding_enabled = kw.get('enabled')


def give(g, pairs, check=False):
    B.GIVE = pairs
    B.CHECK = check
    del B.failed[:]
    del CALLS[:]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        n = asyncio.run(B.give(g))
    return n, buf.getvalue()


# ------------------------------------------------------------------ G2 --
g = Guild()
yes('G2 a member is found by their display name, any case',
    [m.id for m in B.find_member(g.members, 'patrick thornwood')] == [10])
yes('G2 by their user name and by their id',
    [m.id for m in B.find_member(g.members, 'wiccandjinn')] == [11]
    and [m.id for m in B.find_member(g.members, '12')] == [12])
yes('G2 never by a part of a name: Blade is Blade, not Bladefan',
    [m.id for m in B.find_member(g.members, 'Blade')] == [12]
    and B.find_member(g.members, 'Patrick') == [])

# ------------------------------------------------------------------ G3 --
n = g.named
yes('G3 Co-Owner to the Lead Gamemaster is not a double (Owner is its own category)',
    B.give_refusal(g.members[1], 'Co-Owner') is None)
yes('G3 Lead Dev to somebody holding Dev is a double, and is refused',
    'nobody holds two ranks of one category' in (B.give_refusal(g.members[1], 'Lead Dev') or ''))
yes('G3 a staff rank to a Jarl is refused',
    'staff hold no seat' in (B.give_refusal(g.members[4], 'Moderator') or ''))
yes('G3 a rank somebody holds is said as already',
    B.give_refusal(g.members[0], 'Owner') == 'already')

# ------------------------------------------------------------------ G4 --
g = Guild()
bad, out = give(g, [('Co-Owner', 'WiccanDjinn'), ('Lead Dev', 'Patrick Thornwood'),
                    ('Lead Content Creator', 'Blade')])
yes('G4 the three ranks Patrick named are given, each to its one member',
    bad == 0 and CALLS == [('add_roles', 'WiccanDjinn', ('Co-Owner',)),
                           ('add_roles', 'Patrick Thornwood', ('Lead Dev',)),
                           ('add_roles', 'Blade', ('Lead Content Creator',))])
yes('G4 and each is said', 'gave      Co-Owner to WiccanDjinn' in out)
bad, out = give(g, [('Co-Owner', 'WiccanDjinn')])
yes('G4 a second run gives nothing and says it is held',
    bad == 0 and CALLS == [] and 'WiccanDjinn holds Co-Owner' in out)

g = Guild()
bad, out = give(g, [('Co-Owner', 'WiccanDjinn')], check=True)
yes('G4 under -Check nothing is given and it says what would be',
    bad == 0 and CALLS == [] and 'would give Co-Owner to WiccanDjinn' in out)

# ------------------------------------------------------------- G3 and G5 --
g = Guild()
bad, out = give(g, [('Lead Dev', 'WiccanDjinn'), ('Moderator', 'jarl'),
                    ('Playtester', 'Blade'), ('Lead Support', 'Twin'),
                    ('Lead Support', 'Blad')])
yes('G3 a double, a seat holder and a role that is not a staff rank give nothing',
    CALLS == [] and bad == 5)
yes('G3 each is said with its reason',
    'Lead Dev was not given: WiccanDjinn holds Dev' in out
    and 'Moderator was not given: jarl holds Jarl of Riften' in out
    and 'Playtester is not a staff rank of the plan' in out)
yes('G5 two members of one name give nothing and are both named with their ids',
    'Twin matches 2 members' in out and 'Twin (15)' in out and 'Twin (16)' in out)
yes('G5 a name that matches nobody says the names like it',
    'Blad matches nobody' in out and 'Blade (12)' in out and 'Bladefan (13)' in out)

# ------------------------------------------------------------------ G6 --
for on, check, want, what in (
        (True, False, [('edit_onboarding', False)], 'a build with it on switches it off'),
        (True, True, [], 'under -Check it is only said'),
        (False, False, [], 'with it off nothing is asked')):
    g = Guild(onboarding=on)
    B.CHECK = check
    del B.failed[:]
    del CALLS[:]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(B.keep_onboarding_off(g))
    yes('G6 Onboarding: ' + what, CALLS == want and B.failed == [])

src = read('bot/Build-Discord.py')
body = src[src.index('async def on_ready'):]
yes('G6 the build switches it off before the first channel is gated',
    body.index('keep_onboarding_off(guild)') < body.index('for catname, specs in plan_for(ONLY)'))

# ------------------------------------------------------------------ G7 --
g = Guild(onboarding=True)
g.me = Member(5, 'Thornswood', [])
g.me.guild_permissions = discord.Permissions(B.RUN_PERMISSIONS)
g.categories, g.channels = [], []
B.CHECK = False
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    asyncio.run(B.audit(g))
out = buf.getvalue()
yes('G7 the audit says Onboarding is on', "DIFFERS  Discord's Onboarding is on" in out)
yes('G7 the audit prints each plan role\'s id', 'Co-Owner: %d' % g.named['Co-Owner'].id in out)
council = ','.join(str(g.named[x].id) for x in B.COUNCIL_ROLES)
yes('G7 and the -UpperStaffRoles line is the council\'s ids',
    "Install-Bot -UpperStaffRoles '%s'" % council in out)
yes('G7 and the -StaffRoles line is TICKET_STAFF\'s ids',
    "Install-Bot -StaffRoles '%s'" % ','.join(str(g.named[x].id) for x in B.TICKET_STAFF) in out)
yes('G7 the audit asked Discord for nothing', CALLS == [])

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
