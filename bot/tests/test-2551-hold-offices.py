"""
test-2551-hold-offices.py

The hold offices are Discord roles (#2551). Patrick, 15 Oct:

  - Per hold the Discord builder makes "<Hold> Court", "Steward of <Hold>"
    and "Guard of <Hold>", keeps them in its never-delete list, and does not
    hoist them: only the Jarl and Citizen roles show separately.
  - That hold's Jarl gives and takes them from a bot panel with Add and
    Remove buttons that work only for their own hold, logged with who
    changed what.
  - If two accounts hold the same hold's Jarl role, neither acts as Jarl
    until staff fix it.
  - A change made in the game comes to staff the same way, through the
    site's moderation.log.

Holds:

  R1 every office role of every hold, Raven Rock's included (Patrick,
     16 Oct), is in the builder's role list, not hoisted, carrying nothing
     of its own (#3317), and under the Citizen roles
  R5 Raven Rock has a Jarl role, hoisted like the others, and no Citizen
     role or hold channel, which nobody asked for
  E1 the running bot makes any Jarl or office role that is missing, the way
     it makes its ping roles, hoisted as the builder says, under the lowest
     Jarl or Citizen role, and touches none that is there
  R2 every one is in KEEP, with the Jarl and Citizen roles
  R3 the Jarl roles are still hoisted, and nothing else in world is (the
     Citizen roles lost their group in #3317)
  P1 the office panel is a persistent view of six buttons, Add and Remove for
     each office, and setup_hook registers it
  P2 its message is found again by its own buttons, and the hold panel's
     search passes over it
  O1 a press by somebody with no Jarl role is refused, only to them
  O2 the Jarl of Whiterun's Add asks who, and the pick gives the Steward of
     Whiterun role with the reason, says it to the Jarl and to staff
  O3 Remove offers the holders, and the pick takes the role back
  O4 the Jarl of Whiterun cannot change Riften's roles by any button
  O5 while two accounts hold the Jarl of Whiterun role, neither does anything
  O6 a bot is given nothing, and somebody already holding it is told so
  M1 the staff channel's line for a change in the game, for a clash and for
     the end of one, names who and what, and escapes what people typed

The builder and bot.py are imported for real, the builder under another name
so its __main__ block never runs. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import importlib.util
import inspect

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: E402
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder and the bot cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord_2551', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
bot.log = lambda *a: None

# ------------------------------------------------------------ the builder --
names = [r[0] for r in B.ROLES]
office_names = []
for h in B.HOLDS:
    office_names += [h + ' Court', 'Steward of ' + h, 'Guard of ' + h]
rows = dict((r[0], r) for r in B.ROLES)
last_citizen = max(names.index('Citizen of ' + h) for h in B.HOLDS)
# Plain was the everyday set every role carried until #3317; since then a
# role carries nothing of its own and @everyone holds the base (Patrick, 22
# Oct, page card q-3317-role-base-perms, A).
yes('R1 every office role of every hold is made, not hoisted, carries nothing of its own, under the Citizen roles (%d)'
    % len(office_names),
    len(office_names) == 30 and 'Raven Rock' in B.HOLDS and all(n in rows for n in office_names)
    and all(rows[n][2] is False for n in office_names)
    and all(rows[n][3] == B.NONE for n in office_names)
    and all(names.index(n) > last_citizen for n in office_names))
yes('R2 every one is in KEEP, the never-delete list, with the Jarl and Citizen roles',
    all(n in B.KEEP for n in office_names)
    and all(('Jarl of ' + h) in B.KEEP and ('Citizen of ' + h) in B.KEEP for h in B.HOLDS))
in_world = [r for r in B.ROLES if r[0].startswith(('Jarl of', 'Citizen of')) or r[0] in office_names]
# Citizens lost their group in #3317 (page card q-3317-member-list): a
# citizen shows under Playtester, the Jarls are the seats of the world.
yes('R3 the Jarl roles are still hoisted, and no Citizen or office role is',
    all(r[2] is True for r in in_world if r[0].startswith('Jarl of'))
    and all(r[2] is False for r in in_world if r[0].startswith('Citizen of'))
    and all(r[2] is False for r in in_world if r[0] in office_names))
yes('R4 the bot spells each office the way the builder makes it',
    all(bot.office_role(o, h) in rows for h in B.HOLDS for o, _ in bot.OFFICES))
# Raven Rock is a hold like the nine since #3317 (Patrick, 22 Oct, page card
# q-3317-raven-rock, A).
yes('R5 Raven Rock has a Jarl role, hoisted, in KEEP, a Citizen role and a category of its own',
    'Jarl of Raven Rock' in rows and rows['Jarl of Raven Rock'][2] is True and 'Jarl of Raven Rock' in B.KEEP
    and 'Citizen of Raven Rock' in rows and 'Raven Rock' in dict(B.PLAN))
yes('R6 the bot makes the same roles the builder does, hoisted the same way',
    sorted((n, h) for n, _, h in bot.office_roles_wanted())
    == sorted((r[0], r[2]) for r in B.ROLES if r[0] in office_names or r[0].startswith('Jarl of ')))


# --------------------------------------------------------------- the panel --
async def panel_ids():
    return [i.custom_id for i in bot.OfficePanel().children]

ids = asyncio.run(panel_ids())
yes('P1 the office panel is six buttons, Add and Remove for the Court, the Steward and the Guard',
    sorted(ids) == sorted('thornswood:office:%s:%s' % (k, o) for k in ('add', 'remove')
                          for o in ('court', 'steward', 'guard')))
hook = inspect.getsource(bot.Thornswood.setup_hook)
yes('P1 and setup_hook registers it, so the buttons outlive a restart', 'add_view(OfficePanel())' in hook)
hold_src = inspect.getsource(bot.ensure_hold_panel)
office_src = inspect.getsource(bot.ensure_office_panel)
yes('P2 each panel finds its own message by its own buttons, so neither writes over the other',
    "startswith('thornswood:hold:')" in hold_src and "startswith('thornswood:office:')" in office_src)


# ------------------------------------------------------- a pretend server --
class Role(object):
    def __init__(self, guild, name, rid):
        self.guild = guild
        self.name = name
        self.id = rid

    @property
    def members(self):
        return [m for m in self.guild.members if self in m.roles]

    def __lt__(self, other):
        return True

    def __repr__(self):
        return '<role %s>' % self.name


class Member(object):
    def __init__(self, guild, mid, name, roles, is_bot=False):
        self.guild = guild
        self.id = mid
        self.display_name = name
        self.roles = roles
        self.bot = is_bot
        self.changes = []

    async def add_roles(self, role, reason=None):
        self.roles.append(role)
        self.changes.append(('add', role.name, reason))

    async def remove_roles(self, role, reason=None):
        self.roles = [r for r in self.roles if r is not role]
        self.changes.append(('remove', role.name, reason))

    def __str__(self):
        return self.display_name


class Guild(object):
    def __init__(self):
        self.roles = []
        self.members = []
        perms = discord.Permissions(manage_roles=True)
        self.me = type('Me', (), {'guild_permissions': perms, 'top_role': None})()

    def role(self, name):
        r = Role(self, name, 100 + len(self.roles))
        self.roles.append(r)
        return r

    def member(self, name, roles, is_bot=False):
        m = Member(self, 1000 + len(self.members), name, roles, is_bot)
        self.members.append(m)
        return m

    def get_member(self, mid):
        for m in self.members:
            if m.id == mid:
                return m
        return None


class Response(object):
    def __init__(self):
        self.said = []
        self.views = []

    async def send_message(self, text, view=None, ephemeral=False):
        self.said.append((text, ephemeral))
        if view is not None:
            self.views.append(view)


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.response = Response()


STAFF_SAID = []


async def staff_say(text):
    STAFF_SAID.append(text)

bot.report_say = staff_say


def world():
    g = Guild()
    roles = {}
    for n in ['Jarl of Whiterun', 'Jarl of Riften', 'Whiterun Court', 'Steward of Whiterun',
              'Guard of Whiterun', 'Riften Court', 'Steward of Riften', 'Guard of Riften', 'Member']:
        roles[n] = g.role(n)
    g.me.top_role = Role(g, 'Thornswood Bot', 999)
    people = {
        'jarl': g.member('Balgruuf', [roles['Jarl of Whiterun'], roles['Member']]),
        'rjarl': g.member('Laila', [roles['Jarl of Riften'], roles['Member']]),
        'pro': g.member('Proventus', [roles['Member']]),
        'nobody': g.member('Nobody', [roles['Member']]),
        'botty': g.member('Some Bot', [], is_bot=True),
    }
    return g, roles, people


async def press(guild, who, office, add):
    i = Interaction(guild, who)
    await bot.office_press(i, office, add)
    return i


async def main():
    g, roles, p = world()

    i = await press(g, p['nobody'], 'guard', True)
    yes('O1 somebody with no Jarl role is refused, and only they see it',
        len(i.response.said) == 1 and i.response.said[0][1] is True
        and 'Only the Jarl of a hold' in i.response.said[0][0] and not i.response.views)

    i = await press(g, p['jarl'], 'steward', True)
    view = i.response.views[0] if i.response.views else None
    yes('O2 the Jarl of Whiterun\'s Add asks who gets the Steward of Whiterun role, only to them',
        view is not None and i.response.said[0][1] is True
        and 'Steward of Whiterun' in i.response.said[0][0]
        and isinstance(view.children[0], discord.ui.UserSelect))
    pick = Interaction(g, p['jarl'])
    STAFF_SAID[:] = []
    await bot.office_change(pick, 'steward', 'Whiterun', p['pro'], True)
    yes('O2 the pick gives Proventus the role, with the reason in Discord\'s audit log',
        roles['Steward of Whiterun'] in p['pro'].roles
        and p['pro'].changes[-1] == ('add', 'Steward of Whiterun',
                                     'Given by Balgruuf, Jarl of Whiterun, on the office panel'))
    yes('O2 says it to the Jarl, and to staff with who changed what',
        'Proventus holds the Steward of Whiterun role now.' in pick.response.said[0][0]
        and len(STAFF_SAID) == 1 and 'Balgruuf, Jarl of Whiterun, gave Proventus the Steward of Whiterun role' in STAFF_SAID[0]
        and 'on the office panel' in STAFF_SAID[0])

    again = Interaction(g, p['jarl'])
    await bot.office_change(again, 'steward', 'Whiterun', p['pro'], True)
    yes('O6 giving it again changes nothing, and says so',
        'already holds' in again.response.said[0][0] and len(p['pro'].changes) == 1)
    robot = Interaction(g, p['jarl'])
    await bot.office_change(robot, 'guard', 'Whiterun', p['botty'], True)
    yes('O6 and a bot is given nothing', 'A bot holds no office.' == robot.response.said[0][0]
        and not p['botty'].changes)

    i = await press(g, p['jarl'], 'steward', False)
    view = i.response.views[0] if i.response.views else None
    opts = [o.value for o in view.children[0].options] if view else []
    yes('O3 Remove offers who holds the role', opts == [str(p['pro'].id)])
    take = Interaction(g, p['jarl'])
    await bot.office_change(take, 'steward', 'Whiterun', p['pro'], False)
    yes('O3 and the pick takes it back, with the reason, and staff are told',
        roles['Steward of Whiterun'] not in p['pro'].roles
        and p['pro'].changes[-1] == ('remove', 'Steward of Whiterun',
                                     'Taken by Balgruuf, Jarl of Whiterun, on the office panel')
        and 'took the Steward of Whiterun role from Proventus' in STAFF_SAID[-1])
    none = await press(g, p['jarl'], 'court', False)
    yes('O3 and with nobody holding it, it says so', 'Nobody holds the Whiterun Court role.' == none.response.said[0][0])

    other = Interaction(g, p['jarl'])
    await bot.office_change(other, 'guard', 'Riften', p['pro'], True)
    yes('O4 the Jarl of Whiterun changes nothing of Riften\'s',
        other.response.said[0][0] == 'Only the Jarl of Riften gives its offices.'
        and roles['Guard of Riften'] not in p['pro'].roles)

    p['pro'].roles.append(roles['Jarl of Whiterun'])
    twice = await press(g, p['jarl'], 'guard', True)
    yes('O5 while two accounts hold the Jarl of Whiterun role, the panel does nothing and says why',
        'Two accounts hold the Jarl of Whiterun role' in twice.response.said[0][0]
        and not twice.response.views)
    late = Interaction(g, p['jarl'])
    await bot.office_change(late, 'guard', 'Whiterun', p['nobody'], True)
    yes('O5 even for a pick made before the second one was given',
        'neither acts as Jarl' in late.response.said[0][0] and roles['Guard of Whiterun'] not in p['nobody'].roles)

    both = g.member('Two Holds', [roles['Jarl of Whiterun'], roles['Jarl of Riften']])
    p['pro'].roles.remove(roles['Jarl of Whiterun'])
    pick = await press(g, both, 'guard', True)
    yes('O7 somebody holding two Jarl roles is asked which hold first',
        'Which hold?' in pick.response.said[0][0] and pick.response.views
        and [o.value for o in pick.response.views[0].children[0].options] == ['Whiterun', 'Riften'])

asyncio.run(main())


# ------------------------------------------------- the roles the bot makes --
class MadeRole(object):
    def __init__(self, name, position, hoist=False):
        self.name = name
        self.position = position
        self.hoist = hoist
        self.moves = []

    async def edit(self, position=None):
        self.moves.append(position)
        self.position = position


class RoleGuild(object):
    def __init__(self, names):
        self.roles = [MadeRole(n, 50 - i) for i, n in enumerate(names)]
        perms = discord.Permissions(manage_roles=True)
        self.me = type('Me', (), {'guild_permissions': perms})()
        self.created = []

    async def create_role(self, name=None, colour=None, hoist=False, mentionable=False, reason=None):
        r = MadeRole(name, 1, hoist)
        self.roles.append(r)
        self.created.append((name, hoist, reason))
        return r


async def roles_made():
    have = ['Jarl of Whiterun', 'Jarl of Winterhold', 'Citizen of Whiterun', 'Citizen of Winterhold', 'Guard of Whiterun']
    g = RoleGuild(have)
    made = await bot.ensure_office_roles(g)
    again = await bot.ensure_office_roles(g)
    return g, made, again

g2, made, again = asyncio.run(roles_made())
by = dict((n, h) for n, h, _ in g2.created)
low_jarl = [r for r in g2.roles if r.name == 'Jarl of Winterhold'][0]
low_cit = [r for r in g2.roles if r.name == 'Citizen of Winterhold'][0]
rr = [r for r in g2.roles if r.name == 'Jarl of Raven Rock'][0]
court = [r for r in g2.roles if r.name == 'Raven Rock Court'][0]
yes('E1 the bot makes every missing Jarl and office role, Raven Rock\'s included, and not the ones there (%d)' % len(made),
    'Guard of Whiterun' not in made and 'Jarl of Whiterun' not in made and 'Jarl of Raven Rock' in made
    and 'Raven Rock Court' in made and len(made) == len(bot.office_roles_wanted()) - 3)
yes('E1 the Jarl roles hoisted, the office roles not', by.get('Jarl of Raven Rock') is True
    and by.get('Steward of Riften') is False)
yes('E1 a new Jarl role goes under the lowest Jarl role, and a new office role under the lowest Citizen role',
    rr.moves and rr.moves[0] == 49 and court.moves and court.moves[0] == 47)
yes('E1 and a second start makes nothing', again == [])

# ---------------------------------------------------- the staff channel line --
line = bot.moderation_text('site', {
    'did': 'office', 'from': 'main', 'give': True, 'office': 'guard', 'hold': 'whiterun',
    'role': 'Guard of Whiterun', 'by': 11, 'byName': 'Balgruuf', 'who': 22, 'whoName': '@everyone'})
yes('M1 a change in the game reads who changed what, in the game, and an @everyone typed in a name pings nobody',
    line is not None and line.startswith('**Hold office:** Balgruuf (profile 11), Jarl of Whiterun, gave ')
    and 'the Guard of Whiterun role, in the game.' in line and '@everyone' not in line.replace('@\u200beveryone', ''))
gone = bot.moderation_text('site', {
    'did': 'office', 'from': 'dev', 'give': False, 'hold': 'ravenrock', 'role': 'Guard of Raven Rock',
    'byName': 'Neloth', 'by': 5, 'whoName': 'Teldryn', 'who': 6})
yes('M1 a take on the dev server says so, and Raven Rock is named as a town',
    'Neloth (profile 5), Jarl of Raven Rock, took the Guard of Raven Rock role from Teldryn (profile 6), in the game, on the dev server.' in gone)
clash = bot.moderation_text('site', {'did': 'jarlclash', 'role': 'Jarl of Whiterun',
                                     'people': [{'id': '1', 'name': 'Ann'}, {'id': '2', 'name': 'Bo'}]})
yes('M1 a clash names the role and every account holding it, and what it means',
    clash.startswith('**Two Jarls of one hold:** 2 accounts hold the Jarl of Whiterun role: Ann (account 1), Bo (account 2).')
    and 'until staff take the role from all but one' in clash)
clear = bot.moderation_text('site', {'did': 'jarlclear', 'role': 'Jarl of Whiterun'})
yes('M1 and its end', clear.startswith('**One Jarl again:**') and 'Jarl of Whiterun' in clear)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
