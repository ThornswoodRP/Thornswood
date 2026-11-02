#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
  Build-Discord.py

  Builds the whole Thornswood Discord in one run: roles, categories, channels,
  permissions, and the words in the read only channels.

  Safe to run more than once. Anything already there by name is left alone,
  anything missing is made, and the read only posts are rewritten from
  content.py. So changing the rules is an edit and a re run, not forty clicks.

      pip install -U discord.py
      python Build-Discord.py

  It never deletes anything unless DISCORD_PRUNE=1 is set, and even then only
  inside the categories it made and only names it knows it no longer wants.
  The names in KEEP are never deleted, whatever any other list in here says.

  It wants a bot token. Put it in the environment rather than on the command
  line, so it does not sit in your shell history:

      $env:DISCORD_TOKEN = 'paste-it-here'
      python Build-Discord.py

  Or run Setup-Discord.ps1, which asks for it without showing it.

  Before any of that:

    1. https://discord.com/developers/applications, the same application the
       website login uses is fine, or a new one.
    2. Bot in the sidebar. Add a bot, then Reset Token and copy it.
    3. Under Bot, turn ON "Server Members Intent". Leave the other two OFF.
    4. OAuth2 then URL Generator: tick "bot", then "Administrator", open the
       URL it makes and add it to the Thornswood server. The bot keeps
       Administrator, for a build and the rest of the time (#3317, Patrick,
       22 Oct 2026: "the bot will keep admin"). A build makes the Owner and
       Co-Owner roles, which carry Administrator, and Discord refuses that
       from a bot without it.
    5. Server Settings, Enable Community. Without it there are no forum
       channels, no announcement channels and no rules screen, and this falls
       back to plain text channels for those. That screen asks for a
       Community Updates and a Safety Notifications channel: take what it
       offers, and the next run of this moves both to #staff-updates.

  The bot needs to be ABOVE the roles it creates, so drag its own role to the
  top of the role list once it has joined.

  ADMINISTRATOR STAYS ON. It used to come off after every build and go back
  on before the next; Patrick ended that on 22 Oct 2026 (#3317). RUN_BITS
  below is still what bot.py itself uses, and the audit says when the bot is
  without Administrator or one of those. To see the invite link without
  building anything, and without a token:

      python Build-Discord.py --invite <application id>

  The application id is on the developer portal's General Information page.
"""

import asyncio
import os
import re
import sys
import types

# ----------------------------------------------------- the running set --
# What bot.py does once the build is over, and nothing more. Each one is
# Discord's own bit number from its permissions page,
# https://docs.discord.com/developers/topics/permissions, not a discord.py
# name, so the integer can be checked against the page by hand. It is read
# off what bot.py calls:
#
#   Manage Channels           log_channel makes the staff only #tickets when
#                             there is none
#   View Channel              every channel it reads or posts in
#   Send Messages             join cards, panels, alerts, closed tickets
#   Attach Files              the join card is a picture
#   Read Message History      finds its own panels to edit in place
#   Manage Roles              the hold and ping buttons give and take roles,
#                             and the two ping roles are made when missing
#   Manage Threads            a ticket thread is private and not invitable, so
#                             only a moderator can add people to it, Close
#                             locks it, and a ticket is deleted 365 days
#                             after it closes (#2353)
#   Create Public Threads     threads the bot opens (the Live smoke session
#                             thread until 11 Oct; forum posts need only Send)
#   Create Private Threads    one per ticket
#   Send Messages in Threads  writes the ticket into its thread
#
# Left out on purpose: Administrator, Manage Server, Manage Webhooks, Manage
# Messages, Pin Messages and Embed Links, which only the build uses or
# nothing uses. Interaction replies and direct messages need no permission.
# The bot holds Administrator as well, for good (#3317, Patrick, 22 Oct 2026),
# so these are the record of what the running bot uses, not its role.
RUN_BITS = (
    ('Manage Channels',           4),
    ('View Channel',             10),
    ('Send Messages',            11),
    ('Attach Files',             15),
    ('Read Message History',     16),
    ('Manage Roles',             28),
    ('Manage Threads',           34),
    ('Create Public Threads',    35),
    ('Create Private Threads',   36),
    ('Send Messages in Threads', 38),
)
RUN_PERMISSIONS = sum(1 << bit for _, bit in RUN_BITS)


def invite_url(app_id, permissions=1 << 3):
    """The bot invite, as https://docs.discord.com/developers/topics/oauth2
       describes it: the application id, scope bot, and the permissions
       integer. Opened for a bot already in the server, it sets these on the
       bot's own role."""
    return ('https://discord.com/oauth2/authorize?client_id=%s&scope=bot'
            '&permissions=%d' % (app_id, permissions))


def say_invite(app_id):
    """All --invite prints: the link that adds the bot with Administrator,
       which it keeps (#3317, Patrick, 22 Oct 2026)."""
    print('  Open this to add the bot with Administrator, which it keeps:')
    print('    ' + invite_url(app_id))
    print('')
    print('  Of that, the running bot itself uses:')
    print('    ' + ', '.join(n for n, _ in RUN_BITS))


# THE DRY PATH. Before discord.py is imported and before any token is read,
# so it runs anywhere, connects to nothing and changes nothing.
if __name__ == '__main__' and '--invite' in sys.argv:
    _rest = sys.argv[sys.argv.index('--invite') + 1:]
    _app = (_rest[0] if _rest else os.environ.get('DISCORD_CLIENT_ID', '')).strip()
    if not _app.isdigit():
        sys.exit('Say which application: python Build-Discord.py --invite '
                 '<application id>. It is on the developer portal\'s General '
                 'Information page.')
    say_invite(_app)
    sys.exit(0)

try:
    import discord
except ImportError:
    sys.exit("discord.py is not installed. Run:  pip install -U discord.py")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content as C
import trust

TOKEN = os.environ.get('DISCORD_TOKEN', '').strip()
# Deleting is off unless asked for, because a script that quietly removes
# channels is a script nobody should run twice.
PRUNE = os.environ.get('DISCORD_PRUNE', '') == '1'

# ROLES AND NOTHING ELSE.
#
# The whole script is safe to re-run and deletes nothing without
# DISCORD_PRUNE, but safe to re-run is not the same as changes only what I
# meant. It also creates any channel or category the plan names and the
# server has not got, rewrites the read-only posts out of content.py, and
# edits the guild's system and AFK channel settings.
#
# On 23 September the only thing wanted was the Banned role, which had
# never been created, and the permission given was for exactly that: add
# that role and reorder roles, add nothing else and remove nothing. So
# there is a switch that means it, rather than a promise that the rest
# would probably be a no-op.
#
#     python Build-Discord.py --roles-only
ROLES_ONLY = ('--roles-only' in sys.argv) or os.environ.get('DISCORD_ROLES_ONLY', '') == '1'
# Rewriting the read only posts means deleting the bot's old messages and
# sending them again, in seven channels. Doing that on every run makes a one
# channel change look like the server being rebuilt, so it is opt in now.
POSTS = os.environ.get('DISCORD_POSTS', '') == '1'
CHECK = os.environ.get('DISCORD_CHECK', '') == '1'

# ONE PART OF THE PLAN AND NOTHING ELSE (#2519).
#
# A whole run does more than the part a change was approved for: it puts
# every role back in its place, lets the bot into every gated channel it is
# not in yet, sets topics and the server's join, AFK and notice settings, and
# lists or prunes what left the plan. On 22 Oct the Gamemasters category, the
# Attach Files overwrite on #welcome-travelers and the GM Rules pin were
# approved, and a whole -Check also planned role moves, #jukebox and two
# server or channel settings. ONLY names the categories and channels a run
# may touch, comma separated:
#
#     $env:DISCORD_ONLY = 'Gamemasters,welcome-travelers'
#     python Build-Discord.py
#
# A category named here is made if missing, with every channel PLAN puts in
# it; a channel named here is made or kept in its own category, which is not
# made for it. No role is made or moved, nothing is listed for pruning or
# pruned, no webhook is made, and no server setting is changed. A name PLAN
# does not have stops the run before Discord is asked anything.
#
# With POSTS as well, the read only posts of the channels named, and of no
# other channel, are rewritten with their Changelog threads (#3656: the -Only
# lore,factions -Posts run of 27 Oct wrote nothing, because ONLY returned
# before the post step, and the one other way to rewrite two posts was a
# whole run, which rewrites all seven and moves roles). Without POSTS no post
# is written.
ONLY = [n.strip() for n in os.environ.get('DISCORD_ONLY', '').split(',') if n.strip()]

# THE AUDIT (#3317). Reads the live server and says where it differs from this
# plan, and changes nothing: no role, channel, post, webhook or setting is
# touched, and nothing is written beside the code.
#
# Patrick asked on 22 Oct for every role's permissions to be right globally,
# per category, per channel and for the bot, and for nobody to hold two ranks
# of one staff category. The plan below only says what a channel this MAKES
# gets, and the live server was gated by hand, so the only way to know what
# people can really do is to read it. This is that read, as a tool anybody can
# run again, rather than a one-off look:
#
#     python Build-Discord.py --audit
#     .\Setup-Discord.ps1 -OnBox -Audit
#
# It says: the bot's own permissions against the running set, each role's
# permissions against ROLES, who holds each staff rank and every double rank
# (STAFF_RANKS), every planned category and channel whose overwrites differ
# from what its mode gives, and the channels the plan does not name.
AUDIT = ('--audit' in sys.argv) or os.environ.get('DISCORD_AUDIT', '') == '1'

# GIVING A STAFF RANK (#3317). Patrick named who holds the council's new
# ranks: Djinn is Co-Owner, he is Lead Dev and Blade is Lead Content Creator.
# The role list in Discord is the only place that is said, and nothing but a
# hand in Server Settings gave a role before this, so the build gives one by
# name, the same way every time:
#
#     $env:DISCORD_GIVE = 'Co-Owner=WiccanDjinn;Lead Dev=Patrick Thornwood'
#     .\Setup-Discord.ps1 -OnBox -Give 'Co-Owner=WiccanDjinn','Lead Dev=Patrick Thornwood'
#
# Only a staff rank (STAFF), only to one member matched exactly by id, user
# name, display name or server nickname, never a second rank of a category
# somebody already holds one of (doubles), and never to somebody holding a
# seat (seat_clashes). Nothing else in the run happens, and with -Check it
# only says what it would give.
GIVE = [tuple(p.strip() for p in e.split('=', 1)) if '=' in e else (e.strip(), '')
        for e in os.environ.get('DISCORD_GIVE', '').split(';') if e.strip()]
GUILD  = os.environ.get('DISCORD_GUILD', '').strip()   # optional server id
WEBHOOK_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'news-webhook.txt')

# ------------------------------------------------------------------ roles --
# Top of this list is the top of the role list. Colour, whether it shows in its
# own group down the side, and what it can do.
#
# Names are Thornswood's rather than Skyrim's job titles, because "Moderator"
# beside "Jarl of Whiterun" reads like two different servers.
#
# THE STAFF COUNCIL (#3317, Patrick, 22 Oct 2026). Each staff category has a
# lead, the leads are the council and decide together, and Owner and Co-Owner
# make the final call. Administrator is for Owner and Co-Owner only; every lead
# gets COUNCIL, which is moderation and nothing that could break the server by
# a misclick. Dev held Administrator until then and holds none now. Every
# other role carries nothing of its own: @everyone holds the everyday set, and
# what a role opens is exactly the channels that name it, so the audit reads
# plainly.
ADMIN = discord.Permissions(administrator=True)
MOD   = discord.Permissions(
    manage_messages=True, kick_members=True, ban_members=True,
    moderate_members=True, manage_threads=True, mute_members=True,
    move_members=True, deafen_members=True, read_message_history=True,
    view_channel=True, send_messages=True, embed_links=True,
    attach_files=True, connect=True, speak=True)
GM    = discord.Permissions(
    manage_messages=True, moderate_members=True, manage_threads=True,
    read_message_history=True, view_channel=True, send_messages=True,
    embed_links=True, attach_files=True, connect=True, speak=True,
    mute_members=True, move_members=True)
# A lead: everything a Moderator and a Gamemaster can do, plus mentioning a
# whole role in an announcement, the server's events, reading who did what,
# and giving roles. Not Manage Channels or Manage Server.
#
# MANAGE ROLES FOR THE LEADS AND SUPPORT (#3317, Patrick, 22 Oct, page card
# q-3317-who-gives-roles, B): they give the role of an accepted application
# by hand. Discord lets a holder give any role below their own highest and
# edit those roles, so the written rule is that each gives only their own
# category's roles (Support: Playtester), and the audit names every role
# given. Every staff role sits above every other role for this reason.
COUNCIL = discord.Permissions(
    MOD.value | GM.value |
    discord.Permissions(mention_everyone=True, manage_events=True,
                        create_events=True, view_audit_log=True,
                        manage_nicknames=True, manage_roles=True).value)
# Support handles tickets: it closes and archives the private ticket threads
# it is added to, and gives Playtester to an accepted playtest application.
SUPPORT = discord.Permissions(manage_threads=True, manage_roles=True)
NONE  = discord.Permissions.none()
PLAIN = discord.Permissions(
    view_channel=True, send_messages=True, read_message_history=True,
    embed_links=True, attach_files=True, add_reactions=True,
    use_external_emojis=True, connect=True, speak=True, stream=True,
    create_public_threads=True, send_messages_in_threads=True,
    use_application_commands=True)

# Raven Rock is a hold like the nine (#3317, Patrick, 22 Oct, page card
# q-3317-raven-rock, A): its Citizen role, its pick on the hold panel and its
# own category.
HOLDS = ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth',
         'Dawnstar', 'Morthal', 'Falkreath', 'Winterhold', 'Raven Rock']


def hold_slug(hold):
    """A hold's channel name: "raven-rock"."""
    return hold.lower().replace(' ', '-')

# THE STAFF, one place (#3317). Each category's ranks, highest first. One
# person holds at most one rank of a category (Patrick: "people dont have
# double roles like dev and lead dev, they can have Owner and Lead Dev as those
# are separate"); ranks of two categories are fine. Owner and Co-Owner are a
# category of their own for that rule. The audit reports a double, and the
# rule is written in every staff space's rules.
#
# space is the category of channels that rank works in; prefix names them.
OWNERS = ('Owner', 'Co-Owner')
STAFF_CATEGORIES = (
    # name          space          prefix     lead                   ranks under the lead
    ('Dev',         'Dev',         'dev',     'Lead Dev',            ('Dev',)),
    ('Gamemasters', 'Gamemasters', 'gm',      'Lead Gamemaster',     ('Gamemaster', 'Trial Gamemaster')),
    ('Lore',        'Lore',        'lore',    'Lead Loremaster',     ('Loremaster',)),
    ('Moderation',  'Moderation',  'mod',     'Lead Moderator',      ('Moderator',)),
    ('Content',     'Content',     'content', 'Lead Content Creator', ('Content Creator',)),
    ('Support',     'Support',     'support', 'Lead Support',        ('Support',)),
)
LEADS = tuple(c[3] for c in STAFF_CATEGORIES)
# The council: who decides, reads every staff space and posts every
# announcement.
COUNCIL_ROLES = OWNERS + LEADS
STAFF_RANKS = (('Owner', OWNERS),) + tuple(
    (c[0], (c[3],) + c[4]) for c in STAFF_CATEGORIES)
# Everybody on staff, whatever their category.
STAFF = OWNERS + tuple(n for c in STAFF_CATEGORIES for n in (c[3],) + c[4])
# Who is pulled into every ticket: the council and the ranks that answer
# tickets. bot.py's STAFF_ROLES default and Install-Bot's -StaffRoles default
# are this list, by name (test-3317-give.py holds the three together).
TICKET_STAFF = COUNCIL_ROLES + ('Gamemaster', 'Dev', 'Loremaster', 'Moderator')


def space_of(name):
    """The staff category whose space is called name, or None."""
    for c in STAFF_CATEGORIES:
        if c[1] == name:
            return c
    return None


# THE ORDER (#3317, Patrick, 22 Oct, page card q-3317-member-list): every
# staff role above every other role ("Staff roles are higher than any roles
# from Patreon, in game positions, holds, server booster etc."), then the
# seats of the world, Jarls and then faction leaders, then Server Booster and
# Patreon, then Playtester. Each of those shows in its own group in the
# member list; everything under Playtester keeps its colour and shows under
# the highest group a person holds. This list is what puts the roles in
# order on every run: a role in the wrong place here drags the real one
# with it.
ROLES = [
    # name                   colour    hoist  permissions
    ('Owner',                0xC9A24B, True,  ADMIN),
    ('Co-Owner',             0xC9A24B, True,  ADMIN),
    ('Lead Dev',             0x9B7BD4, True,  COUNCIL),
    ('Lead Gamemaster',      0x3E8FBF, True,  COUNCIL),
    ('Lead Loremaster',      0x57B8A0, True,  COUNCIL),
    ('Lead Moderator',       0x6FA05A, True,  COUNCIL),
    ('Lead Content Creator', 0xD2603F, True,  COUNCIL),
    ('Lead Support',         0xB8A04E, True,  COUNCIL),
    ('Dev',                  0x9B7BD4, True,  NONE),
    ('Gamemaster',           0x4F9BC7, True,  GM),
    ('Loremaster',           0x57B8A0, True,  NONE),    # writes the world
    ('Trial Gamemaster',     0x79BCDB, True,  GM),
    ('Moderator',            0x6FA05A, True,  MOD),
    ('Content Creator',      0xD2603F, True,  NONE),    # Thornswood's own content
    ('Support',              0xC9B46A, True,  SUPPORT),
]

# In world. One Jarl per hold, and a hold for everybody else to belong to.
# The Jarls are shown in their own group, the seats of the world; a Citizen
# role keeps its colour and shows under Playtester (#3317, page card
# q-3317-member-list).
#
# Every hold has its Jarl, Court, Steward and Guards (#2551), Raven Rock
# included since 16 Oct, because the game has its board, its drop box and its
# jail; since #3317 it is one of HOLDS as well.
OFFICE_HOLDS = list(HOLDS)

for _h in OFFICE_HOLDS:
    ROLES.append(('Jarl of ' + _h, 0xE0C56A, True, NONE))

# THE FACTION LEADERS (#3317, Patrick, 22 Oct, page card q-3317-faction-roles,
# A): one "<faction> Leader" role per named faction, shown in its own group
# under the Jarls, given from an accepted Faction Leader application. The
# factions are bot/factions.json, the list the application already offers;
# a faction's role uses its short name, the way Patrick wrote them
# ("Thalmor Leader, Free Skyrim Trading Company Leader"). A Jarl is a faction
# leader too, with its own application. Nobody on staff holds either seat
# (#3317, Patrick, 22 Oct, 11:03 AM), and the audit says so when one does.
FACTION_SHORT = {'Thalmor Remnant': 'Thalmor', 'The Companions': 'Companions'}


def _factions():
    import json as _json
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'factions.json'), encoding='utf-8') as f:
        return [str(n) for n in _json.load(f)]


FACTIONS = _factions()
FACTION_LEADERS = tuple(FACTION_SHORT.get(f, f) + ' Leader' for f in FACTIONS)
# Each faction's member role is its short name, given and taken by its Leader
# from the bot's panel (#3317, page card q-3317-faction-member-give, A).
FACTION_MEMBERS = tuple(FACTION_SHORT.get(f, f) for f in FACTIONS)


def faction_slug(faction):
    """A faction's channel name: its short name, lower case, hyphens."""
    return FACTION_SHORT.get(faction, faction).lower().replace(' ', '-')


for _name in FACTION_LEADERS:
    ROLES.append((_name, 0xD9B45A, True, NONE))
# The seats of the world: who nobody on staff may also be.
SEATS = tuple('Jarl of ' + _h for _h in OFFICE_HOLDS) + FACTION_LEADERS

# Made by Discord and by Patreon, so only placed and grouped here (NOT_MADE
# below): the build sets their member-list group and nothing else of theirs.
# Patreon's own role is the one group for every supporter, the tiers keep
# their colours (page card q-3317-patreon-group, recommended A, waiting).
ROLES.append(('Server Booster', 0xD98FB0, True,  NONE))   # boosted the server
ROLES.append(('Patreon',        0xF96854, True,  NONE))

ROLES.append(('Playtester',     0xC07A4E, True,  NONE))

# The three Patreon tiers, worst name at the top. Patreon hands these out
# itself once the Discord is connected in its settings, so nothing here
# ever assigns them.
ROLES.append(('Thalmor Boot-Licker', 0x9FBE6B, False, NONE))
ROLES.append(('Talos Worshiper',     0xD8B24C, False, NONE))
ROLES.append(('Milk Drinker',        0xBFD3DE, False, NONE))

for _h in HOLDS:
    ROLES.append(('Citizen of ' + _h, 0x8FA9B8, False, NONE))

# THE OFFICES A JARL GIVES (#2551). Patrick, 15 Oct: each hold has a Court, a
# Steward and its Guards, and they are Discord roles, so the role is the one
# truth for who holds one, in the game and here. That hold's Jarl gives and
# takes them, from the bot's office panel or from the Office page in the game,
# and the bot sets the role either way. "Steward of <Hold>" replaces the one
# shared steward office the game kept by itself. The role is on the account,
# and the game keeps which one character of the account holds the office
# (Patrick, 16 Oct: character based, not account based).
#
# The running bot also makes any of these, and the Jarl roles, that are
# missing when it starts (bot.py, ensure_office_roles), so they exist without
# a build; a build then puts them in this order.
#
# NOT HOISTED (Patrick, 15 Oct: "they must not be shown separately in the
# member list"). They sit under the Citizen roles, so a citizen who also holds
# one keeps their Citizen colour.
#
# The site reads them by these exact names (site\server.js, OFFICE_ROLE), and
# so does the bot's panel (bot.py, office_role). A name changed here and not
# there leaves the office with nobody in it.
OFFICE_ROLES = []
for _h in OFFICE_HOLDS:
    OFFICE_ROLES.append(_h + ' Court')
    OFFICE_ROLES.append('Steward of ' + _h)
    OFFICE_ROLES.append('Guard of ' + _h)
for _name in OFFICE_ROLES:
    ROLES.append((_name, 0xA8977A, False, NONE))

# THE FACTIONS' MEMBERS (#3317, Patrick, 22 Oct: 16 factions, page card
# q-3317-faction-roster B, each with its 4E 252 entry in lore/factions.md,
# approved by him the same day). One role per faction, its short name, given
# and taken by that faction's Leader. Not shown on their own.
#
# The Free Skyrim Trading Company's (#1393, docs/systems/trading-company.md)
# was the role called Trading Company, renamed to the faction's name
# (ROLE_WAS) so everybody holding it keeps it. The site's access.company
# names it, and the game lets a character on an account that holds it buy for
# the company.
for _name in FACTION_MEMBERS:
    ROLES.append((_name, 0xB08D57, False, NONE))

# THE OFFICERS A FACTION'S LEADER NAMES (#3317, Patrick, 22 Oct, page card
# q-3317-faction-category, C: "One Officer role, not Court and Steward", and
# "The Chanel for them will be called leadership since it's not a court").
# Each faction has one "<short> Officer" role, given and taken by its Leader
# from the panel in its seats channel (bot.py, faction_role). The Officers post
# the faction's announcements and sit in its leadership channel. Discord roles
# only: the game knows the Leader and the members. Not hoisted, under the
# members, so a member who is also an Officer keeps the member colour.
FACTION_OFFICE_ROLES = [_s + ' Officer' for _s in FACTION_MEMBERS]
for _name in FACTION_OFFICE_ROLES:
    ROLES.append((_name, 0xA08560, False, NONE))

# Owns a business book in the game (site\server.js, businessOwner). Support
# gives it (#3317). It was made by hand; made here because a role the site
# reads and nothing creates is the Banned mistake below.
ROLES.append(('Business Owner', 0xA08C6A, False, NONE))

# Joined, and answered the rules and age questions (#3317). Member sees the
# front door and Information, read only; Playtester opens the rest.
ROLES.append(('Member', 0x8D9682, False, NONE))

# THE ONE A BAN DEPENDS ON, and it was never created.
#
# site/server.js has keyed access off a role called Banned since it was
# written: cfg.access.banned is ['Banned'] and standing() takes everything away
# from anybody holding it. Not hoisted and grey on purpose: a ban is not a
# badge. No permissions at all, because the site is what a ban acts on.
ROLES.append(('Banned', 0x4A4A4A, False, NONE))

# The bottom two, under Banned on the live server. The bot makes both, so
# they are here for their place in the order and nothing else.
ROLES.append(('News Pings',   0x8D9682, False, NONE))
ROLES.append(('Updates Pings', 0x8D9682, False, NONE))

# ROLES THIS NEVER MAKES, only puts in order.
#
# Discord makes Server Booster itself the first time somebody boosts, Patreon
# makes its own when the shop is connected in its settings, and bot.py makes
# the two ping roles the hold panel's buttons hand out. Creating any of them
# here would leave a second role of the same name that nothing hands out, and
# whichever of the two Discord shows is a coin toss. Nor are their
# permissions changed: the build leaves those to whatever made them. Their
# member-list group is the plan's (#3317, keep_role).
NOT_MADE = ('Server Booster', 'Patreon', 'News Pings', 'Updates Pings')

# Who sees every hold. The gamemaster ranks and the Loremasters run things in
# the holds, Moderators keep the talk there civil, and the council sees
# everything.
HOLD_STAFF = COUNCIL_ROLES + ('Dev', 'Gamemaster', 'Trial Gamemaster',
                              'Loremaster', 'Moderator')

# Who sees every faction's channel (#3317): the council, the gamemaster ranks
# and the Loremasters, who run and watch the stories the factions are in.
FACTION_STAFF = COUNCIL_ROLES + ('Gamemaster', 'Trial Gamemaster', 'Loremaster')

# --------------------------------------------------------------- channels --
# mode:  public       anybody talks, including somebody who has no role yet
#        read         everybody reads, the council posts
#        membersread  Member, Playtester and staff read, the council posts
#        open         Playtester and staff talk, invisible to everybody else
#        testersread  Playtester and staff read, the council posts
#        pathfind     the same people as open; the Playtesters category's own
#        hold         a hold's hall: its Citizen, Jarl and officers, and HOLD_STAFF
#        holdread     its announcements: those read, the Jarl, Steward, Court post
#        holdcourt    its Jarl, Steward and Court, and HOLD_STAFF
#        holdguard    its Jarl and Guards, and HOLD_STAFF
#        faction      a faction's chat: its members, Leader, Officers, FACTION_STAFF
#        factionread  its announcements: those read, the Leader and Officers post
#        factionlead  its leadership: its Leader and Officers, and FACTION_STAFF
#        factionseats its Leader's panel: the Leader and FACTION_STAFF read
#        staff        every staff rank talks, invisible to everybody else
#        staffread    every staff rank reads, the council posts
#        council      Owner, Co-Owner and the leads, nobody else
#        space        one staff category's ranks and the council talk
#        spaceread    that category reads, the council posts (announcements)
#        spacerules   that category reads, its lead, Owner and Co-Owner post
#
# A space mode names its category with space='Gamemasters' (STAFF_CATEGORIES).
# read_extra on a channel's line lets more roles read that one channel and no
# other (the Loremasters reading the GM event plans, #3317).
#
# THE GATE (#3317, Patrick, 22 Oct 2026). Somebody who joins sees Start Here
# and Applications. Member, given when they answer the rules and age questions,
# adds Information, read only. Playtester, given when a playtest application
# is accepted, opens everything else that is not staff. Staff see their own
# space and Staff, and the council sees every space. Until #3317 the gate was
# Member, set by hand on 23 and 24 September, and Playtester opened only
# Testing.
#
# THE BUILD SETS EVERY PLANNED CHANNEL'S OVERWRITES TO ITS MODE (#3317). Until
# #3317 a mode reached only a channel the build made, so the live server
# drifted from the plan wherever a channel was gated by hand, and nothing said
# so. Now every category and channel named here gets exactly the overwrites its
# mode gives, on every run; an overwrite for one member that is not the bot is
# kept as it is. -Check says which would change, and -Audit says how.
#
# key is what the words in content.py point at, so a channel can be renamed
# without every mention of it going stale.
#
# post is the words the build writes in a read only channel, and makes that
# channel a doc: it keeps a changelog (DOCS in content.py, check_docs below).
#
# was lists (category, name) pairs the channel used to be. A channel missing
# from its place is looked for there first and renamed or moved, never made a
# second time, so its id, history, pins and posts go with it (#3317: the bot
# finds #dev-test-tasks by id, and the Testing forums by name).
#
# make=False means the channel is in the plan and is never created: the plan
# is what prune keeps, so this is how a channel that has been deleted on
# purpose stays deleted without becoming something prune would delete the
# next one of its name.
#
# THE CATEGORY A CHANNEL IS IN IS PART OF ITS NAME HERE. A channel is matched
# by name inside the category this names, so a channel dragged into another
# category by hand looks missing and the next run brings it back by its was
# line, or makes a second one when it has none. That is how the live server
# ended up with two #game-rules once.


def _space(cat, extra=()):
    """The four channels every staff space has (#3317): its announcements,
       which that category reads and the council posts in; its rules; its
       chat; and its voice room. extra goes between the rules and the chat."""
    c = space_of(cat)
    name, prefix = c[1], c[2]
    return ([
        dict(kind='text', name=prefix + '-announcements', mode='spaceread', space=name,
             topic='Announcements for %s. The council posts here.' % name),
        dict(kind='text', name=prefix + '-rules', mode='spacerules', space=name,
             key=prefix.upper() + 'RULES', post=True,
             topic='How %s works. %s, Owner and Co-Owner post here.' % (name, c[3])),
    ] + list(extra) + [
        dict(kind='text', name=prefix + '-chat', mode='space', space=name,
             topic='Talk between %s.' % name),
        dict(kind='voice', name=_SPACE_VOICE.get(name, name + ' Voice'),
             mode='space', space=name, was=_SPACE_VOICE_WAS.get(name, ())),
    ])


# A staff space's voice room is "<space> Voice", but for these. Support's is
# Support Staff, since the Support voice in that category is the public one
# people come to for help (Patrick, 22 Oct).
_SPACE_VOICE = {'Gamemasters': 'GM Voice', 'Support': 'Support Staff'}
_SPACE_VOICE_WAS = {'Support': (('Support', 'Support Voice'),)}


# Every Loremaster reads these three (#3317, 10b): the plans before an event
# and the summaries after it, so a scene stays inside the lore.
LORE_READS = ('Loremaster',)

PLAN = [
 ('Start Here', [
   dict(kind='text',  name='rules',       key='RULES',    mode='read',
        topic='Seven rules. Read them.', post=True),
   dict(kind='text',  name='welcome',     key='WELCOME',  mode='read',
        topic="Start here.", post=True),
   dict(kind='text',  name='start-here',  key='START',    mode='read',
        topic="How to actually get in and play.", post=True),
   dict(kind='text',  name='say-hello',   key='HELLO',    mode='public',
        topic='New here? Say hi and tell us a little about yourself. Slowmode is on.'),
 ]),
 # Help and reports, for anybody, under Start Here where a newcomer looks
 # (#3317, q-3317-ticket-split, A). Support answers help, Moderation reports.
 ('Tickets', [
   dict(kind='text',  name='get-help',       key='HELP',   mode='read',
        topic="It will not install, start or connect. Open a ticket below."),
   dict(kind='text',  name='report-someone', key='REPORT', mode='read',
        topic='Something happened and it should not have. Only you and staff see it.'),
 ]),
 ('Information', [
   dict(kind='announce', name='news',     key='NEWS',     mode='membersread',
        topic='What changed, every time it changes.', post=True),
   dict(kind='text',  name='updates',     key='UPDATES',  mode='membersread',
        topic="Restarts and outages. Check here before asking why you can't connect."),
   dict(kind='text',  name='faq',         key='FAQ',      mode='membersread',
        topic='Read this before you ask.', post=True),
 ]),
 # The rules of play and the world, read only, each with its changelog
 # (#3317). Both were in the talk categories before.
 ('Roleplay Guide', [
   dict(kind='text',  name='game-rules',  key='GAMERULES', mode='testersread',
        topic='How roleplay works here. Nine rules, and what we let slide.',
        post=True, was=(('Thornswood', 'game-rules'), ('In Character', 'game-rules'))),
   dict(kind='text',  name='lore',        key='LORE',     mode='testersread',
        topic='4E 252. What happened and who you can be.', post=True,
        was=(('In Character', 'lore'),)),
   # The sixteen factions, lore/factions.md as Patrick approved it on 22 Oct
   # (#3317), with its changelog like the rest.
   dict(kind='text',  name='factions',    key='FACTIONS', mode='testersread',
        topic='The sixteen factions of 4E 252: who they are, where they keep, '
              'who leads them.', post=True),
 ]),
 # Where somebody applies, before they have anything (#3317, page card
 # q-3317-ticket-split, A). One channel a kind of application, each with
 # bot.py's panel for only its kinds (TICKET_DESKS), and the private threads
 # open off it. They were all in #tickets-and-applications, one dropdown of
 # ten. Closed tickets are written in #ticket-log in Staff.
 ('Applications', [
   dict(kind='text',  name='apply-to-playtest', key='PLAYTEST', mode='read',
        topic='How you get into the world. Pick the application below.'),
   dict(kind='text',  name='apply-for-a-seat',  key='SEATS',    mode='read',
        topic='Jarl and Faction Leader, answered in character. Only open seats are listed.'),
   dict(kind='text',  name='apply-for-staff',   key='JOBS',     mode='read',
        topic='Gamemaster, Loremaster, Moderator, Dev and Content Creator.'),
 ]),
 # Out of character. It was the Thornswood category. #general-chat is the one
 # general: it was #general until Patrick renamed it. Its topic was written by
 # hand and sent bug reports to a channel deleted since, which Discord showed
 # as #unknown (Patrick, 23 Oct, #3317), so the plan sets it now, in his words
 # with the channels named by key.
 ('Out of Character', [
   # Where the join cards go, and what the server's system channel points at.
   # JOIN gives the bot Attach Files here as well (JOIN_BOT_NEEDS, #2341).
   # The bot finds it by this name (JOIN_CHANNEL), so it keeps it.
   dict(kind='text',  name='welcome-travelers', key='JOIN', mode='open',
        topic='A card for everybody who joins, posted by the bot. Say hello in '
              '<#GENERAL>.',
        was=(('Thornswood', 'welcome-travelers'),)),
   dict(kind='text',  name='general-chat', key='GENERAL', mode='open',
        topic="Out of character chat for everyone. Talk Thornswood, Skyrim, or "
              "whatever's on your mind, and keep it friendly. Bug reports go in "
              "<#RESULTS>, screenshots and clips go in <#MEDIA>.",
        was=(('Thornswood', 'general-chat'),)),
   dict(kind='text',  name='media',       key='MEDIA',    mode='open',
        topic='Screenshots and clips. Talk about one in a thread under it.',
        was=(('Thornswood', 'media'),)),
   dict(kind='text',  name='server-progression-and-economy', mode='open',
        topic='How the server grows and how its economy works: what you have '
              'seen, and what you would change. Ideas go in <#SUGGESTIONS>.',
        was=(('Thornswood', 'server-progression-and-economy'),)),
   dict(kind='forum', name='suggestions', key='SUGGESTIONS', mode='open',
        topic=C.SUGGEST_TOPIC, was=(('Help', 'suggestions'),)),
   # Made by hand for the music bot, and found by the audit of 22 Oct
   # (#3317). Named so -Prune leaves it; never made here. It was in Voice.
   dict(kind='text',  name='jukebox',     mode='open', make=False,
        topic='Music bot commands go here. Jockie Music plays in the voice room '
              'you are in.',
        was=(('Voice', 'jukebox'),)),
   # Somewhere to talk and somewhere to be idle, from the Voice category,
   # which Patrick retired on 22 Oct (#3317): each voice room now sits with
   # what it is for. Proximity voice is in the launcher, so these are for
   # before, after, and whoever is not in the world.
   dict(kind='voice', name='General',     mode='open', was=(('Voice', 'General'),)),
   dict(kind='voice', name='AFK',         key='AFK', mode='open', was=(('Voice', 'AFK'),)),
   # Both gone from the server, and still named here so prune leaves anything
   # of either name alone. content.py points at them, and post() turns a
   # mention of a channel that is not there into plain words.
   dict(kind='forum', name='bugs',        key='BUGS',     mode='open',
        topic=C.BUGS_TOPIC, make=False),
   dict(kind='text',  name='logs-and-crashes', key='LOGS', mode='open',
        topic='Drag the log in. Explain it after.', make=False),
 ]),
 ('In Character', [
   # Where a playtester picks their hold, which opens that hold's category.
   # The bot posts the buttons. It was the top of The Holds, which went when
   # each hold got a category of its own (#3317).
   dict(kind='text', name='choose-your-hold', key='CHOOSE', mode='testersread',
        topic="Pick your hold with the buttons below. It opens that hold's "
              "channels.",
        was=(('The Holds', 'choose-your-hold'),)),
   dict(kind='forum', name='character-introductions', key='CHARS', mode='open',
        topic='Who are you playing? One post each.'),
   dict(kind='forum', name='tales',       key='TALES',    mode='open',
        topic='What happened out there. One post per story.'),
   dict(kind='text',  name='rp-appreciation', key='APPREC', mode='open',
        topic='Somebody played a blinder. Say so.'),
   dict(kind='text',  name='graveyard',   key='GRAVE',    mode='open',
        topic='They had it coming. Probably.'),
 ]),

] + [
 # A CATEGORY PER FACTION (#3317, Patrick, 22 Oct: "Factions are supposed to
 # have their own invidual categories like the holds", "their own
 # announcements, vcs, faction leaderships channels", and "seats should be in
 # a different channel like how the holds have the add member add court add a
 # steward so one for each faction in it's category"; page card
 # q-3317-faction-category, C: one Officer role, and "The Chanel for them will
 # be called leadership since it's not a court"). In character, all of it:
 #   announcements  its members read; the Leader and Officers post
 #   the chat       everybody in the faction, moved here from Factions by name
 #   leadership     the Leader and Officers
 #   seats          the Leader's panel (bot.py, ensure_faction_panel): only the
 #                  Leader and FACTION_STAFF see it
 #   voice          everybody in the faction, moved here from Factions
 # FACTION_STAFF sees every faction. The shared #seats and the Factions
 # category they were all in are retired.
 (_f, [
   dict(kind='text', name=faction_slug(_f) + '-announcements', mode='factionread',
        faction=_f, topic='What the Leader and the Officers of %s want every '
                          'member to know. In character.' % _f),
   dict(kind='text', name=faction_slug(_f), mode='faction', faction=_f,
        topic='%s: its members and its Leader. In character.' % _f,
        was=(('Factions', faction_slug(_f)),)),
   dict(kind='text', name=faction_slug(_f) + '-leadership', mode='factionlead',
        faction=_f, topic='The Leader and the Officers of %s. In character.' % _f),
   dict(kind='text', name=faction_slug(_f) + '-seats', mode='factionseats', faction=_f,
        topic='The Leader of %s gives and takes its members and Officers '
              'here.' % _f),
   dict(kind='voice', name=_f, mode='faction', faction=_f, was=(('Factions', _f),)),
 ])
 for _f in FACTIONS
] + [
 # A CATEGORY PER HOLD (#3317, Patrick, 22 Oct: "The Holds also need a guards
 # and court channel for the Guards and court members. Each hold needs an
 # announcement channel for the Hold that Jarls of that Hold and the court can
 # post to for needed IC info"; page cards q-3317-hold-layout A and
 # q-3317-hold-office-access A). In character, all of it:
 #   announcements  its citizens and officers read; the Jarl, Steward and
 #                  Court post
 #   the hall       the hold's own channel, today's, moved here by name
 #   court          the Jarl, Steward and Court
 #   guard          the Jarl and the Guards
 # HOLD_STAFF sees every hold.
 (_h, [
   dict(kind='text', name=hold_slug(_h) + '-announcements', mode='holdread',
        hold=_h, topic='What the Jarl and the court of %s want every citizen '
                       'to know. In character.' % _h),
   dict(kind='text', name=hold_slug(_h), key='HOLD_' + hold_slug(_h).upper().replace('-', '_'),
        mode='hold', hold=_h, topic=C.HOLD_TOPICS[hold_slug(_h)],
        was=(('The Holds', hold_slug(_h)),)),
   dict(kind='text', name=hold_slug(_h) + '-court', mode='holdcourt', hold=_h,
        topic='The Jarl, the Steward and the court of %s. In character.' % _h),
   dict(kind='text', name=hold_slug(_h) + '-guard', mode='holdguard', hold=_h,
        topic='The Jarl and the guards of %s. In character.' % _h),
   # The court's voice room (Patrick, 22 Oct), for the same people as
   # #<hold>-court.
   dict(kind='voice', name=_h + ' Court', mode='holdcourt', hold=_h),
 ])
 for _h in HOLDS
] + [
 # The playtesters' own space (#3317, Patrick: "a category for playtester
 # following the same pattern as the staff ones just rembering playtesters
 # arent staff"). It was Testing, renamed with its channels so nothing is made
 # twice. The bot finds #test-tasks, #test-findings and #known-issues by these
 # names (bot.py, the testing channels section), so they keep them; Test-Tasks
 # was the forum's name with capitals, since 11 Oct a forum of test tasks, one
 # thread each, tagged Main since #2276.
 ('Playtesters', [
   dict(kind='text',  name='playtester-announcements', mode='testersread',
        topic='Announcements for playtesters. The council posts here.'),
   dict(kind='text',  name='playtester-rules', key='TESTERRULES', mode='testersread',
        topic='How playtesting works here.', post=True),
   dict(kind='forum', name='test-tasks',   key='TESTS',   mode='pathfind',
        topic='One thread per test task, tagged Main.',
        was=(('Testing', 'Test-Tasks'), ('Testing', 'test-tasks'))),
   dict(kind='text',  name='known-issues', key='KNOWN',   mode='pathfind',
        topic='Known issues the team is working on. Kept by the bot.',
        was=(('Testing', 'known-issues'),)),
   dict(kind='forum', name='test-findings', key='RESULTS', mode='pathfind',
        topic='Pass, fail, and what went wrong.',
        was=(('Testing', 'test-findings'),)),
   dict(kind='text',  name='playtest-sessions', mode='pathfind',
        topic='Call a session and say you are coming.'),
   dict(kind='text',  name='playtester-chat', mode='pathfind',
        topic='Talk about testing: what you are trying and what you found.'),
   dict(kind='voice', name='Playtester Voice', mode='pathfind',
        was=(('Testing', 'play-testing'),)),
 ]),
 # What every staff member shares, and the council's own two channels.
 ('Staff', [
   # The staff #news, renamed so it is not taken for the public #news in
   # Information, which carries the key and the release webhook.
   dict(kind='announce', name='staff-announcements', mode='staffread',
        topic='Announcements for every staff member. The council posts here.',
        was=(('Staff', 'news'),)),
   dict(kind='text',  name='council-decisions', mode='staffread',
        topic='Every council decision, with its date. The council posts here.'),
   # Where staff status updates go (Patrick, 11 Oct), and where the bot says
   # the watchdog's messages and the sessions that went wrong, by the id in
   # staff-channel.txt (#2501). Made by hand, so never made here.
   dict(kind='text',  name='staff-updates', mode='staff', make=False,
        topic='Only what every staff member must act on: a restart, an outage, '
              'or a change to how staff work. The bot and the watchdog post here.'),
   dict(kind='text',  name='staff-general', mode='staff',
        topic='Nobody else can see this.'),
   dict(kind='text',  name='council',       mode='council',
        topic='The council: Owner, Co-Owner and the leads.'),
   # Where the bot writes closed tickets, and where it puts a whole ticket,
   # reports included, when the private thread will not open. Every kind of
   # ticket lands here, so it is the council's: the people who read every
   # kind (#3317; page card q-3317-ticket-log). Never all staff, so a report
   # about somebody never lands in front of them, and Content Creator never
   # reads an application (bot.py, private_channel_ok). bot.py's TICKET_LOG
   # answers to ticket-log and tickets, and checks the permissions.
   dict(kind='text',  name='ticket-log',    mode='council',
        topic='Every ticket that gets closed, with a link back to it, and any '
              'ticket whose private thread would not open. The council only.',
        was=(('Applications', 'tickets'),)),
   dict(kind='voice', name='Staff Room',    mode='staff'),
   # Gone from the server. Named here so prune leaves them alone, never made
   # again: #staff-updates, #staff-general and #dev-test-results carry all
   # three now.
   dict(kind='text',  name='dev-notes',     mode='staff', make=False,
        topic='What we’re on, and what broke doing it.'),
   dict(kind='text',  name='deploys',       mode='staff', make=False,
        topic='Every ship and restart lands here.'),
   dict(kind='text',  name='reports',       mode='staff', make=False,
        topic='Reports about people. Staff only.'),
 ]),
 # The staff spaces (#3317), one per category, each the same shape: its
 # announcements, its rules, its chat and its voice room, and the working
 # channels that category needs.
 #
 # Gamemasters is the first of them (#2519): Djinn's layout of 15 Oct,
 # confirmed on 17 Oct, with #gm-discipline kept from the 14 Oct list. Nothing
 # public goes in here: a public scene listing goes in the Discord's Events
 # channel. Moderators are in it by that layout (SPACE_GUESTS). GM Rules v1.0
 # is pinned in #gm-rules by hand and its text is not in this repository yet
 # (#2519), so #gm-rules has no post here. #gm from the 14 Oct list is named
 # with make=False, so prune leaves it alone and nothing makes it again.
 ('Gamemasters', [
   dict(kind='text',  name='gm-announcements',   mode='spaceread', space='Gamemasters',
        read_extra=LORE_READS,
        topic='Announcements for Gamemasters. The council posts here.'),
   dict(kind='text',  name='gm-rules',           mode='spacerules', space='Gamemasters',
        topic='The GM Rules. Lead Gamemaster, Owner and Co-Owner post here.'),
   dict(kind='text',  name='gm-event-plans',     mode='space', space='Gamemasters',
        read_extra=LORE_READS,
        topic='What an event will be, before it runs. Loremasters read it.'),
   dict(kind='text',  name='gm-scene-summaries', mode='space', space='Gamemasters',
        read_extra=LORE_READS,
        topic='What happened in a scene you ran, after it ends.'),
   dict(kind='text',  name='gm-chat',            mode='space', space='Gamemasters',
        topic='Planning, handoffs and questions between gamemasters.'),
   dict(kind='text',  name='gm-suggestions',     mode='space', space='Gamemasters',
        topic='Ideas for scenes, events and how we run them.'),
   dict(kind='text',  name='gm-discipline',      mode='space', space='Gamemasters',
        topic='Reprimands, punishments and bans only. Nothing else.'),
   dict(kind='voice', name='GM Voice',           mode='space', space='Gamemasters'),
   dict(kind='text',  name='gm',                 mode='space', space='Gamemasters',
        make=False),
 ]),
 ('Lore', _space('Lore')),
 ('Moderation', _space('Moderation')),
 # Support's space, and the voice room people come to for help: Help Voice
 # until Patrick moved it here and named it Support on 22 Oct (#3317). It is
 # open to everybody the old one was; the staff room is Support Staff.
 ('Support', [
   dict(kind='voice', name='Support', mode='open',
        was=(('Voice', 'Help Voice'), ('Help', 'Support'))),
 ] + _space('Support')),
 ('Content', _space('Content')),
 # Dev holds the dev test tasks and results, moved out of Staff by id
 # (Patrick, 22 Oct: "the tasks and finings under staff will go under the new
 # dev category and the others stay"). #dev-test-tasks is made by the bot's
 # one-time `python bot.py --setup-channels --apply`, which finds it by id
 # from then on, never by this: named here so a run moves it, -Prune leaves
 # it, and no run makes a second one. The topic is the bot's DEV_TOPIC.
 ('Dev', _space('Dev', [
   dict(kind='forum', name='dev-test-tasks', mode='space', space='Dev', make=False,
        was=(('Staff', 'dev-test-tasks'),),
        topic='Test tasks someone on dev has to measure, from the board. Kept '
              'by the bot: a post goes when its issue closes as fixed or its '
              'test task no longer says Server: Dev.'),
   # dev-test-findings on the live server (the audit of 22 Oct, #3317), the
   # same word as #test-findings; dev-test-results is the name it was planned
   # under and is answered to as well.
   dict(kind='forum', name='dev-test-findings', mode='space', space='Dev',
        topic='Pass, fail, and what went wrong, for the test tasks in '
              '#dev-test-tasks.',
        was=(('Staff', 'dev-test-findings'), ('Staff', 'dev-test-results'))),
   # The developers' lines to each other: an edit to one of the six shared
   # files coming, the dev feed taken. They moved out of #staff-updates,
   # which is for what every staff member must act on (Patrick, 22 Oct).
   dict(kind='text',  name='dev-coordination', mode='space', space='Dev',
        topic='Developers only: a shared file being edited, the dev feed '
              'taken. Say it here before you do it.'),
 ])),
]

# Categories renamed in place (#3317), so a run renames the old one instead of
# making a second. Help was emptied into Out of Character and Voice, Voice
# into Out of Character and Support, and Factions into a category per faction
# (Patrick, 22 Oct): an empty category named in RETIRED_CATEGORIES goes under
# -Prune and only then.
CATEGORY_WAS = {
    'Out of Character': ('Thornswood',),
    'Playtesters': ('Testing',),
}
RETIRED_CATEGORIES = ('Help', 'The Holds', 'Voice', 'Factions')

# The gate each category has. A category's channels carry their own modes;
# this is the category's own, which the build sets and the audit reads. A
# staff space's category is gated as its space (category_mode).
CATEGORY_MODE = {
    'Start Here': 'public',
    'Tickets': 'public',
    'Applications': 'public',
    'Information': 'membersread',
    'Roleplay Guide': 'testersread',
    'Out of Character': 'open',
    'In Character': 'open',
    'Playtesters': 'pathfind',
    'Staff': 'staff',
}

# Who else talks in one staff space. Moderators are in the Gamemasters space by
# Djinn's layout of 15 Oct (#2519).
SPACE_GUESTS = {'Gamemasters': ('Moderator',)}

# ----------------------------------------------------------------- engine --
# Only what is actually used. Asking for message_content as well made Discord
# refuse the whole connection, because it is a privileged intent that is off by
# default and nothing here reads a message's text: the bot posts, and deletes
# its own posts by author id.
# It logs in with the bot's token, so it trusts what the bot trusts: the
# bot's roots alone, never the machine's stores, which on the box hold an
# emSign root (#3111, #3604). The roots are made at login.
client = trust.client_class()(intents=discord.Intents(guilds=True, members=True))
made, kept, failed = [], [], []


# Channels an earlier version of this made and this one does not want. Named
# rather than worked out, so moving one somewhere else does not save it.
RETIRED = [
    'tech-help', 'looking-for-group', 'off-topic', 'downloads',
    # known-issues was retired here once, and came back on 11 October as the
    # bot's list of open findings (Testing above), so it is not in this list.
    'links-and-credits',
    'Small Table', 'The Longhouse', 'Away',
    # #media does the job of both of these, and the bot channel was never used.
    'screenshots', 'clips', 'bot-commands',
    'The Bannered Mare', 'The Road',
    # Deleted in the channel cleanup and replaced by #test-tasks, which is a
    # new channel rather than this one renamed. Here so a re-run of this
    # script does not make it again.
    'test-these',
    # The text channel Test-Tasks was until 11 Oct, with the Live smoke
    # checklist of early October. Deleted by Patrick's choice (#3317, page
    # card q-3317-old-archives, B): the board and the #test-tasks forum have
    # what is still open.
    'test-tasks-archive',
    # The one ticket channel of before the split, and the closed ticket log
    # from before #ticket-log. Both deleted by Patrick's choice (#3317, page
    # card q-3317-ticket-split, A). -Prune leaves a channel with a thread
    # still open in it (open_threads), so no open ticket goes with it.
    'tickets-and-applications', 'tickets',
    # Every Jarl and faction Leader with the council, and the one faction
    # panel, until each faction got its own category and seats channel
    # (#3317, page card q-3317-faction-category). Its old panel says where
    # the panels went until -Prune deletes it.
    'seats',
]

# NEVER DELETED, by prune or by anything else in here.
#
# Patrick's channels, the ones with his words and his people's posts in them.
# Every one of them is in PLAN as well, which is what keeps prune off them,
# and they are named again here because the cost of the plan being wrong once
# is somebody's channel. This list wins over RETIRED and over the plan: a name
# in both is kept.
#
# Added 2 October after a run made channels again that had been moved or
# renamed, and -Prune was one keystroke from taking the originals with it.
KEEP = (
    'general-chat', 'welcome-travelers', 'server-progression-and-economy',
    'play-testing', 'suggestions', 'dev-test-results', 'dev-test-findings',
    'test-results', 'test-tasks', 'jukebox',
    'test-findings', 'known-issues', 'dev-test-tasks',
    # Where staff status updates go (Patrick, 11 Oct), and where the bot says
    # the watchdog's messages and the sessions that went wrong, by the id in
    # staff-channel.txt. Not in PLAN, so without this a run would list it as
    # no longer in the plan and -Prune would delete it (#2501).
    'staff-updates',
    # Gamemasters category (#2519). Named so -Prune cannot take them.
    'gm-rules', 'gm-scene-summaries', 'gm-chat', 'gm-suggestions',
    'gm-discipline', 'gm voice', 'gm',
    # Their names from before #3317, and the channels #3317 renamed them to.
    # #tickets, the old closed ticket log, is not here any more: Patrick's
    # page card q-3317-ticket-split deletes it (RETIRED).
    'ticket-log', 'staff-announcements', 'playtester voice',
    'news', 'help voice', 'support', 'council', 'council-decisions',
) + tuple(
    # The in-world roles (#2551, Patrick, 15 Oct: the office roles go in the
    # never-delete list). Nothing in this script deletes a role today; these
    # are named so that nothing added later ever may. A role holds who is in
    # an office, and deleting one empties that office in the game as well.
    ['Jarl of ' + _h for _h in OFFICE_HOLDS] + ['Citizen of ' + _h for _h in HOLDS] +
    OFFICE_ROLES + list(FACTION_LEADERS) + list(FACTION_MEMBERS) + FACTION_OFFICE_ROLES
)


def refused(e):
    """Discord's answer to a request it turned down, for the "did not
       manage" list: the status and its own words."""
    return ('%s %s' % (getattr(e, 'status', ''), getattr(e, 'text', '') or e)).strip()


def say(mark, what):
    print('  %-9s %s' % (mark, what))


# THE BOT'S OWN WAY IN, in every channel that shuts everybody else out.
#
# To Do List 223, "The bot is invited with Administrator and keeps it", and
# since #3317 it does for good (Patrick, 22 Oct 2026). These overwrites stay so
# that a server whose bot role loses it still works, and the audit says so.
# Administrator overrides every channel overwrite, and that is the only
# reason the bot can see the staff channels, the channels behind Member and
# the holds, and post in the read only ones: nothing below ever named it.
# Without Administrator the @everyone deny lands on the bot too, since
# nothing here gives it Member, a staff role or a hold. The trouble alerts
# and the watchdog's messages, both in #staff-updates (bot.py, TROUBLE_ID,
# WATCH_ID and staff-channel.txt), go quiet, the hold panel cannot be posted
# in #choose-your-hold, and -Posts can no longer write the rules, welcome,
# news and faq posts.
#
# So the bot gets an overwrite for itself as a member, the way bot.py's
# log_channel already makes #ticket-log. Discord applies a member's own
# overwrite last, after @everyone and every role, so it wins over the deny.
# Three permissions and no more: see the channel, post in it, and read
# back what is there, which is how post() finds its old messages to delete.
# The build itself still wants Administrator, because it makes the Owner and
# Dev roles with Administrator on them and Discord refuses that from a bot
# which does not hold it.
BOT_NEEDS = ('view_channel', 'send_messages', 'read_message_history')

# And two more in the channel bot.py opens its ticket threads in. The read
# mode that channel has in PLAN denies @everyone Send Messages in Threads, and
# the live one was gated by hand, so without Administrator the bot could open
# a private thread there and then not write the ticket into it. A thread takes
# its permissions from the channel it is in, so the bot's role having them
# server wide is not enough once the channel's @everyone deny lands on it.
TICKET_BOT_NEEDS = BOT_NEEDS + ('create_private_threads',
                                'send_messages_in_threads')

# What a role named in a channel's extra_roles gets there: the same three the
# talk overwrite below hands a staff role, and nothing else.
TALK_NEEDS = ('view_channel', 'send_messages', 'read_message_history')


# And one more in the channel the join cards go to (#2341). The card is a
# picture sent as a file (bot.py, on_member_join), the one thing the bot
# attaches anywhere, and posting a file needs Attach Files in that channel.
# The three above were all this channel's overwrite named, so once
# Administrator came off the bot's role (#455) the card depended on the
# role's server-wide bits and the channel's @everyone overwrite both letting
# it through. On 12 Oct the bot's start said it could not post there:
# "the bot is missing Attach Files there". Naming it in the bot's own
# overwrite, which Discord applies last, makes the channel give it whatever
# the role or @everyone say, the way the ticket channel's thread bits do.
JOIN_BOT_NEEDS = BOT_NEEDS + ('attach_files',)


# And in every channel the build writes (#3317): it opens that channel's
# Changelog thread, locks it, and posts the changes in it. A read only
# channel's @everyone overwrite denies threads, so these are named.
DOC_BOT_NEEDS = BOT_NEEDS + ('create_public_threads', 'send_messages_in_threads',
                             'manage_threads')


# The channels bot.py opens ticket threads in, by their keys in PLAN.
TICKET_KEYS = ('HELP', 'REPORT', 'PLAYTEST', 'SEATS', 'JOBS')


def bot_needs(spec):
    key = spec.get('key')
    if spec.get('post'):
        return DOC_BOT_NEEDS
    if key in TICKET_KEYS:
        return TICKET_BOT_NEEDS
    if key == 'JOIN':
        return JOIN_BOT_NEEDS
    return BOT_NEEDS


def with_bot(guild, out, needs=BOT_NEEDS):
    me = getattr(guild, 'me', None)
    if me is not None:
        out[me] = discord.PermissionOverwrite(**dict((n, True) for n in needs))
    return out


def shuts_out(ch, needs=BOT_NEEDS):
    """Whether @everyone's overwrite on this channel takes away one of the
       ones the bot needs there.

       Read off the channel as it stands rather than off its mode in PLAN.
       The gate on the live server was set by hand, and the modes only say
       what a channel this makes gets, so a mode can be wrong about a channel
       that is already there in either direction. Nothing this makes names the
       bot's own role, so without Administrator this deny is what keeps the
       bot out, and where there is none the bot's role already lets it in."""
    ev = getattr(getattr(ch, 'guild', None), 'default_role', None)
    if ev is None:
        return False
    have = ch.overwrites_for(ev)
    return any(getattr(have, n) is False for n in needs)


async def keep_bot(ch, needs=BOT_NEEDS):
    """Give the bot its own overwrite in a channel that is already there.

       overwrites() only reaches a channel when it is made, and every channel
       on the live server was made, or gated by hand, before this existed, so
       without this a re-run would let the bot into nothing. Only a channel
       that shuts @everyone out is touched, and only the bot's own overwrite
       on it. Only the ones it needs are set, anything else already on it
       stays as it is, and a channel that already has all of them is not written
       to at all, so running this again after Administrator is gone changes
       nothing and asks Discord for nothing.

       A channel PLAN names more needs for than the three (the ticket
       channel, the join channel) is touched whether or not @everyone is shut
       out: those bits are the channel's own job, and the bot's role holding
       them server wide is not something a build can see while it still has
       Administrator (#2341)."""
    if ch is None:
        return
    if tuple(needs) == BOT_NEEDS and not shuts_out(ch, needs):
        return
    me = getattr(getattr(ch, 'guild', None), 'me', None)
    if me is None:
        return
    have = ch.overwrites_for(me)
    need = dict((n, True) for n in needs if getattr(have, n) is not True)
    if not need:
        return
    what = '#' + ch.name + ' lets the bot in without Administrator'
    if CHECK:
        say('would change', what)
        return
    have.update(**need)
    try:
        await ch.set_permissions(me, overwrite=have,
                                 reason='Thornswood setup, the bot keeps its '
                                        'channels without Administrator')
        say('bot', what)
    except discord.HTTPException:
        failed.append(what + ' (Discord refused it)')


async def keep_extra(ch, spec, roles):
    """
    Give a channel's extra_roles their overwrite when the channel is already
    there.

    The same reason keep_bot exists: overwrites() only reaches a channel when
    it is made, so a #test-tasks made by hand, or one made by a run from
    before the role existed, would shut out the very people its extra_roles
    name. Only those roles are touched, only the three permissions they need
    are set, anything else already on them stays, and a role that has all
    three is not written to at all, so a second run asks Discord for nothing.
    """
    names = spec.get('extra_roles') or ()
    guild = getattr(ch, 'guild', None)
    if ch is None or not names or guild is None:
        return
    for name in names:
        r = _named(guild, roles, name)
        if r is None:
            continue
        have = ch.overwrites_for(r)
        need = dict((n, True) for n in TALK_NEEDS if getattr(have, n) is not True)
        if not need:
            continue
        what = '#' + ch.name + ' lets ' + name + ' in'
        if CHECK:
            say('would change', what)
            continue
        have.update(**need)
        try:
            await ch.set_permissions(r, overwrite=have,
                                     reason='Thornswood setup, the channel\'s '
                                            'extra roles')
            say('role', what)
        except discord.HTTPException:
            failed.append(what + ' (Discord refused it)')


def _named(guild, roles, name):
    return roles.get(name) or discord.utils.get(guild.roles, name=name)


def _also(guild, roles, out, extra, talk):
    """
    The roles one channel wants on top of what its mode gives everybody.

    A mode is the gate the whole server is built from, so widening one to
    suit a single channel widens every channel that uses it. extra_roles on
    that channel's own line in PLAN is the narrow way to do it: these are
    looked up by name on the server, so a role that is not in ROLES is still
    found, and one that is not there at all is passed over rather than
    guessed at.

    Nothing to add on a public channel, which has no overwrites at all,
    because there is nothing being denied for this to get around.
    """
    for name in (extra or ()):
        r = _named(guild, roles, name)
        if r is not None:
            out[r] = talk
    return out


# Who each mode lets in, by role name: (readers, talkers, posters). A reader
# sees and reads back and cannot post; a talker sees and posts; a poster in a
# read only channel posts and tidies. A name in more than one list ends with
# the last one's overwrite, and Discord lets any allowing role of a person win
# over a denying one, so somebody who is both a reader and a poster posts.
def mode_audience(mode, hold=None, space=None, faction=None):
    tester = ('Playtester',) + STAFF
    if mode == 'read':
        return (), (), COUNCIL_ROLES
    if mode == 'membersread':
        return ('Member',) + tester, (), COUNCIL_ROLES
    if mode in ('open', 'pathfind'):
        return (), tester, ()
    if mode == 'testersread':
        return tester, (), COUNCIL_ROLES
    if mode in ('hold', 'holdread', 'holdcourt', 'holdguard'):
        if hold is None:
            return (), HOLD_STAFF, ()
        jarl, court, steward, guard, citizen = hold_roles(hold)
        if mode == 'hold':
            return (), HOLD_STAFF + (jarl, court, steward, guard, citizen), ()
        if mode == 'holdread':
            return ((citizen, guard) + HOLD_STAFF, (),
                    (jarl, steward, court) + COUNCIL_ROLES)
        if mode == 'holdcourt':
            return (), HOLD_STAFF + (jarl, steward, court), ()
        return (), HOLD_STAFF + (jarl, guard), ()
    if mode in ('faction', 'factionread', 'factionlead', 'factionseats'):
        if faction is None:
            return (), FACTION_STAFF, ()
        lead, officer, member = faction_roles(faction)
        if mode == 'faction':
            return (), FACTION_STAFF + (member, lead, officer), ()
        if mode == 'factionread':
            return (member,) + FACTION_STAFF, (), (lead, officer) + COUNCIL_ROLES
        if mode == 'factionlead':
            return (), FACTION_STAFF + (lead, officer), ()
        return (lead,) + FACTION_STAFF, (), COUNCIL_ROLES
    if mode == 'staff':
        return (), STAFF, ()
    if mode == 'staffread':
        return STAFF, (), COUNCIL_ROLES
    if mode == 'council':
        return (), COUNCIL_ROLES, ()
    if mode in ('space', 'spaceread', 'spacerules'):
        c = space_of(space)
        if c is None:
            raise ValueError('mode %s needs space= one of %s'
                             % (mode, ', '.join(x[1] for x in STAFF_CATEGORIES)))
        ranks = (c[3],) + c[4] + SPACE_GUESTS.get(c[1], ())
        if mode == 'space':
            return (), ranks + COUNCIL_ROLES, ()
        if mode == 'spaceread':
            return ranks, (), COUNCIL_ROLES
        return ranks + COUNCIL_ROLES, (), OWNERS + (c[3],)
    if mode == 'public':
        return (), (), ()
    raise ValueError('no such mode: %s' % mode)


def overwrites(guild, mode, roles, hold=None, needs=BOT_NEEDS, extra=None,
               space=None, read_extra=None, faction=None):
    """Every overwrite a category or channel of this mode gets: @everyone
       shut out (or read only), each role the mode names, extra_roles talking
       and read_extra reading on that one channel, and the bot."""
    ev = guild.default_role
    deny_all  = discord.PermissionOverwrite(view_channel=False)
    read_only = discord.PermissionOverwrite(send_messages=False,
                                            add_reactions=True,
                                            create_public_threads=False,
                                            send_messages_in_threads=False)
    reader    = discord.PermissionOverwrite(view_channel=True,
                                            read_message_history=True,
                                            send_messages=False,
                                            create_public_threads=False,
                                            send_messages_in_threads=False)
    talk      = discord.PermissionOverwrite(view_channel=True,
                                            send_messages=True,
                                            read_message_history=True)
    poster    = discord.PermissionOverwrite(view_channel=True,
                                            send_messages=True,
                                            read_message_history=True,
                                            manage_messages=True)
    # Public has no overwrites at all, so there is nothing being denied for
    # the bot or anybody else to get around.
    if mode == 'public':
        return {}
    readers, talkers, posters = mode_audience(mode, hold, space, faction)
    readers = tuple(readers) + tuple(read_extra or ())
    out = {ev: read_only if mode == 'read' else deny_all}
    for names, ow in ((readers, reader), (talkers, talk), (posters, poster)):
        for n in names:
            r = _named(guild, roles, n)
            if r is not None:
                out[r] = ow
    # Every mode but public shuts @everyone out of something the bot needs,
    # so every one of them names the bot as well.
    return with_bot(guild, _also(guild, roles, out, extra, talk), needs)


def spec_overwrites(guild, spec, roles):
    """overwrites() for one line of PLAN."""
    return overwrites(guild, spec.get('mode', 'open'), roles, spec.get('hold'),
                      bot_needs(spec), spec.get('extra_roles'),
                      spec.get('space'), spec.get('read_extra'), spec.get('faction'))


def hold_roles(hold):
    """(Jarl, Court, Steward, Guard, Citizen) of a hold, by name."""
    if hold not in HOLDS:
        raise ValueError('a hold mode needs hold= one of %s' % ', '.join(HOLDS))
    return ('Jarl of ' + hold, hold + ' Court', 'Steward of ' + hold,
            'Guard of ' + hold, 'Citizen of ' + hold)


def faction_roles(faction):
    """(Leader, Officer, member) of a faction, by name."""
    if faction not in FACTIONS:
        raise ValueError('a faction mode needs faction= one of %s' % ', '.join(FACTIONS))
    i = FACTIONS.index(faction)
    short = FACTION_MEMBERS[i]
    return FACTION_LEADERS[i], short + ' Officer', short


def category_overwrites(guild, catname, roles):
    """overwrites() for a category of the plan: its mode, its space, and
       for a hold's or a faction's category, its hold or faction."""
    cmode, cspace = category_mode(catname)
    return overwrites(guild, cmode, roles, hold=catname if cmode == 'hold' else None,
                      space=cspace, faction=catname if cmode == 'faction' else None)


def category_mode(catname):
    """The mode a category of the plan is gated by, and its space: a staff
       space's category is its space; any other is CATEGORY_MODE's."""
    if space_of(catname) is not None:
        return 'space', catname
    if catname in HOLDS:
        return 'hold', None
    if catname in FACTIONS:
        return 'faction', None
    return CATEGORY_MODE.get(catname, 'open'), None


def rank(r):
    """How high a role sits, the way Discord sorts them: by position, and
       where two share a position the older one (the lower id) above
       (#3317). Positions need not be unique: Discord made the 16 Officer
       roles of 22 Oct all at position 1 and moved nothing up for them."""
    return (r.position, -r.id)


def role_order(guild, out, new=()):
    """Every role under the bot's own, top first, the way the plan wants the
       list (#3317), or None when it already is.

       The plan's roles go in the plan's order into the places the plan's
       roles hold between them, so a role the plan does not name keeps its
       place among them; one made this run (new) first goes straight under
       the plan role above it. Roles something else manages (Server Booster,
       and Patreon and Jockie Music, which their own bots manage) are in the
       list like the rest: the audit said Patreon sat below Playtester after
       every build while they were left out, and a role left out keeps a
       number that the numbers around it can collide with. The bot's own
       highest role is never in it."""
    me = getattr(guild, 'me', None)
    top = getattr(me, 'top_role', None)
    def below_bot(r):
        return (r is not guild.default_role and r.name != '@everyone'
                and (top is None or (r is not top and rank(r) < rank(top))))
    pool = dict((r.id, r) for r in guild.roles if below_bot(r))
    for r in out.values():
        if below_bot(r):
            pool.setdefault(r.id, r)
    have = sorted(pool.values(), key=rank, reverse=True)
    plan = [out[n] for n, _, _, _ in ROLES if n in out and out[n].id in pool]
    made = [r for r in plan if r.name in new]
    order = [r for r in have if r not in made]
    for r in made:
        i = plan.index(r)
        up = [p for p in plan[:i] if p in order]
        order.insert(order.index(up[-1]) + 1 if up else 0, r)
    ids = set(r.id for r in plan)
    slots = [i for i, r in enumerate(order) if r.id in ids]
    for i, r in zip(slots, plan):
        order[i] = r
    if [r.id for r in order] == [r.id for r in have]:
        return None
    return order


def role_positions(order, room):
    """{role: position} that puts order (top first) in that order using only
       positions 1 to room, or None when it cannot be done (#3317).

       Discord turns down a request that asks for a position at or above the
       bot's own role, and the build of 22 Oct asked for 1 to 123 under a
       bot at 110: the 16 Officer roles were made at position 1 beside
       Updates Pings, so 125 roles sat in 109 numbers. A role may share its
       position with the one under it when it is the older of the two (the
       lower id), since Discord sorts a shared position by id, older above
       (rank). Every role takes a position of its own while there is room
       for the rest above it, so a server with room gets 1 to N, and roles
       share only as many positions as the room makes them."""
    up = list(reversed(order))
    n = len(up)
    share = [False] + [up[i].id < up[i - 1].id for i in range(1, n)]
    need = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        need[i] = need[i + 1] + (0 if share[i] else 1)
    if need[0] > room:
        return None
    at = {}
    p = 0
    for i, r in enumerate(up):
        if not (share[i] and p + 1 + need[i + 1] > room):
            p += 1
        at[r] = p
    return at


def _manager(r):
    """Who manages a role, in words: a bot, an integration, server boosting,
       or nothing."""
    tags = getattr(r, 'tags', None)
    if tags is None:
        return 'none' if not getattr(r, 'managed', False) else 'managed'
    if getattr(tags, 'bot_id', None):
        return 'bot %s' % tags.bot_id
    if getattr(tags, 'integration_id', None):
        return 'integration %s' % tags.integration_id
    if tags.is_premium_subscriber():
        return 'server boosting'
    if getattr(tags, 'subscription_listing_id', None):
        return 'server subscription %s' % tags.subscription_listing_id
    if tags.is_guild_connection():
        return 'linked role'
    return 'managed' if getattr(r, 'managed', False) else 'none'


def role_numbers(guild):
    """Lines that say every role's position as Discord gives it, who manages
       it, which positions two roles share, and the positions role_order
       would ask for: what the one order request is made of (#3317). Read
       only."""
    me = getattr(guild, 'me', None)
    top = getattr(me, 'top_role', None)
    pos = getattr(top, 'position', None)
    out = ['the bot\'s highest role is %s, at position %s' % (getattr(top, 'name', '?'), pos)]
    roles = sorted(guild.roles, key=rank, reverse=True)
    for r in roles:
        out.append('%4d  %s  (%s%s)' % (r.position, r.name, _manager(r),
                                        ', above the bot' if top is not None and rank(r) > rank(top)
                                        else ''))
    seen = {}
    for r in roles:
        seen.setdefault(r.position, []).append(r.name)
    for p, names in sorted(seen.items(), reverse=True):
        if len(names) > 1:
            out.append('position %d is held by %d roles: %s' % (p, len(names), ', '.join(names)))
    below = [r for r in roles if top is not None and r is not top and rank(r) < rank(top)
             and r is not guild.default_role]
    out.append('%d roles sit under the bot\'s highest role, %d of them another bot\'s, '
               'in the %s positions under it'
               % (len(below), sum(1 for r in below if _bots_role(r)),
                  max(0, pos - 1) if pos is not None else '?'))
    return out


def _bots_role(r):
    """Discord's own role for a bot, this one or another."""
    try:
        return bool(r.is_bot_managed())
    except AttributeError:
        return False


async def keep_role(role, hoist, perms):
    """Give a role that is already there the permissions and the member-list
       group the plan has for it (#3317). Until then a role kept whatever it
       was made with or given by hand, so the plan said one thing and the
       server another. A role Discord, Patreon or the bot makes keeps its
       own permissions and only takes its group from here (#3317: Server
       Booster and Patreon show in their own group), and one already right is
       left alone, so a second run asks for nothing. Discord's own role for
       a bot is never touched."""
    outside = role.name in NOT_MADE
    if getattr(role, 'managed', False) and not outside:
        return
    change = {}
    if not outside and role.permissions.value != perms.value:
        change['permissions'] = perms
    if bool(getattr(role, 'hoist', hoist)) != bool(hoist):
        change['hoist'] = hoist
    if not change:
        return
    what = 'role %s gets the plan\'s %s' % (role.name, ' and '.join(
        'permissions' if k == 'permissions' else 'member-list group' for k in change))
    if CHECK:
        say('would change', what)
        return
    try:
        await role.edit(reason='Thornswood setup, the role as the plan has it', **change)
        say('role', what)
    except discord.HTTPException as e:
        failed.append('%s (%s)' % (what, refused(e)))


# Roles renamed in place (#3317): a plan role that is missing is looked for
# under these names and renamed, so everybody holding it keeps it and the
# server never has two. Lead GM is how the lead gamemaster role was spelled
# by hand once (the Live smoke lock of 1 October named both).
ROLE_WAS = {
    'Lead Gamemaster': ('Lead GM',),
    'Free Skyrim Trading Company': ('Trading Company',),
}


async def rename_role(have, name):
    """The role name used to be (ROLE_WAS), renamed to name, or None.
       Under -Check it is only said, and the old role is handed back so the
       rest of the check reads it."""
    for old in ROLE_WAS.get(name, ()):
        role = have.get(old)
        if role is None:
            continue
        what = 'role %s becomes %s' % (old, name)
        if CHECK:
            say('would rename', what)
            return role
        try:
            await role.edit(name=name, reason='Thornswood setup, renamed by the plan')
            say('renamed', what)
        except discord.HTTPException as e:
            failed.append('%s (%s)' % (what, refused(e)))
        return role
    return None


async def ensure_roles(guild):
    have = {r.name: r for r in guild.roles}
    out = {}
    new = set()
    for name, colour, hoist, perms in ROLES:
        if name not in have and not ONLY:
            old = await rename_role(have, name)
            if old is not None:
                have[name] = old
        if name in have:
            out[name] = have[name]
            kept.append('role ' + name)
            if not ONLY:
                await keep_role(have[name], hoist, perms)
            continue
        if ONLY:
            continue
        if name in NOT_MADE:
            say('note', 'there is no ' + name + ' role, and Discord, Patreon '
                'or the bot makes that one, not this')
            continue
        if CHECK:
            say('would make', 'role ' + name)
            continue
        try:
            out[name] = await guild.create_role(
                name=name, colour=discord.Colour(colour), hoist=hoist,
                mentionable=True, permissions=perms,
                reason='Thornswood setup')
            new.add(name)
            made.append('role ' + name)
            say('role', name)
        except discord.Forbidden:
            failed.append('role ' + name + ' (the bot needs to be higher up '
                          'the role list than the roles it makes)')
    if ONLY:
        return out
    # The whole list in one request, the one Discord's own client sends when a
    # role is dragged (#3317). It was one role.edit(position=) a role, each
    # worked out by discord.py from the cache of before the last, which the
    # gateway had not yet caught up with: the live build of 22 Oct left seven
    # roles out of place. role_order puts a role made this run under the plan
    # role above it as well. role_positions numbers them under the bot's own
    # role: the 22 Oct run asked for 1 to 123 under a bot at 110 and Discord
    # turned the whole request down (400 Missing Permissions).
    order = role_order(guild, out, new)
    if order is not None:
        what = 'the %d roles under the bot into the plan\'s order' % len(order)
        top = getattr(getattr(guild, 'me', None), 'top_role', None)
        room = (top.position - 1) if top is not None else len(order)
        at = role_positions(order, room)
        if at is None:
            failed.append('the roles were not put in order: %d roles sit under the '
                          'bot\'s role and they do not fit in the %d positions under it, '
                          'even sharing them (-Audit lists the numbers)' % (len(order), room))
        elif CHECK:
            say('would move', what)
        else:
            try:
                got = await guild.edit_role_positions(
                    positions=at, reason='Thornswood setup, the order in the plan')
                say('moved', what)
                wrong = order_after(order, got)
                if wrong:
                    failed.append('Discord took the role order but put %s' % wrong)
            except discord.HTTPException as e:
                failed.append('the roles were not put in order (%s)' % refused(e))
    return out


def order_after(order, roles):
    """What Discord's answer to the order request has out of place, in words,
       or '' when it has every role of order where order put it. Discord
       answers with every role and its new position; this is what says the
       shared positions sorted the way rank says (#3317)."""
    if not roles:
        return ''
    ids = dict((r.id, i) for i, r in enumerate(order))
    names = dict((r.id, r.name) for r in order)
    live = [r for r in sorted(roles, key=rank, reverse=True) if r.id in ids]
    for a, b in zip(live, live[1:]):
        if ids[a.id] > ids[b.id]:
            return '%s above %s' % (names[a.id], names[b.id])
    return ''


def with_members(live, want):
    """want, plus every overwrite live has for one member who is not the
       bot. Those are somebody's own (a moderator's mute, a person let into
       one channel), set by hand on purpose, and the plan never names people."""
    out = dict(want)
    names = set(id(t) for t in want)
    for t, o in (live or {}).items():
        if id(t) in names or hasattr(t, 'permissions'):
            continue
        guild = getattr(t, 'guild', None)
        if getattr(t, 'id', None) == getattr(getattr(guild, 'me', None), 'id', -2):
            continue
        out[t] = o
    return out


async def keep_overwrites(place, want, what):
    """Set a category's or channel's overwrites to exactly what its mode
       gives (#3317), keeping each member's own. Nothing is asked of Discord
       when they already match."""
    guild = getattr(place, 'guild', None)
    live = getattr(place, 'overwrites', {}) or {}
    full = with_members(live, want)
    if not overwrite_diff(guild, live, full):
        return
    if CHECK:
        say('would change', what + ' gets the overwrites of its mode')
        return
    try:
        await place.edit(overwrites=full,
                         reason='Thornswood setup, the overwrites of its mode')
        say('access', what + ' has the overwrites of its mode')
    except discord.HTTPException as e:
        failed.append('%s kept its old overwrites (%s)' % (what, refused(e)))


async def bring_back(guild, cat, spec, want):
    """A planned channel that is not in its place, found under a name and
       category it had before (spec['was']) and renamed or moved here, so its
       id, history and posts go with it. None when there is none; False under
       -Check, which only says it would."""
    for old_cat, old_name in spec.get('was') or ():
        for ch in guild.channels:
            if isinstance(ch, discord.CategoryChannel):
                continue
            where = getattr(getattr(ch, 'category', None), 'name', None)
            # The old category may have been renamed already this run.
            cats = (old_cat,) + tuple(n for n, olds in CATEGORY_WAS.items()
                                      if old_cat in olds)
            if ch.name == old_name and where in cats:
                what = '#%s in %s becomes #%s in %s' % (old_name, where, want,
                                                        getattr(cat, 'name', 'no category'))
                if CHECK:
                    say('would move', what)
                    return False
                try:
                    await ch.edit(name=want, category=cat,
                                  reason='Thornswood setup, renamed or moved by the plan')
                    say('moved', what)
                    return ch
                except discord.HTTPException as e:
                    failed.append('%s (%s)' % (what, refused(e)))
                    return None
    return None


def plan_spec(key):
    """(category, spec) of the plan channel with that key, or (None, None)."""
    for catname, specs in PLAN:
        for spec in specs:
            if spec.get('key') == key:
                return catname, spec
    return None, None


def plan_channel(guild, key):
    """The live channel the plan names by key, found by its name in its
       category, or None."""
    catname, spec = plan_spec(key)
    if spec is None:
        return None
    want = spec['name'].lower().replace(' ', '-') if spec['kind'] != 'voice' else spec['name']
    for ch in getattr(guild, 'channels', ()):
        cat = getattr(ch, 'category', None)
        if ch.name == want and getattr(cat, 'name', None) == catname:
            return ch
    return None


def _plain(key):
    catname, spec = plan_spec(key)
    return '#' + (spec['name'] if spec is not None else key.lower())


def topic_text(guild, spec):
    """The topic the plan gives a channel, as Discord should hold it (#3317).
       A topic names another channel as <#KEY>, the way content.py does, and
       that becomes a mention of the channel the plan has under that key, so
       it follows the channel through a rename and never points at one that
       is gone: #general-chat's hand-written topic sent bug reports to a
       channel deleted since, which Discord shows as #unknown. A key whose
       channel is not on the server becomes its name in plain words."""
    topic = spec.get('topic')
    if not topic:
        return topic
    def one(m):
        ch = plan_channel(guild, m.group(1)) if guild is not None else None
        return '<#%d>' % ch.id if ch is not None else _plain(m.group(1))
    return re.sub(r'<#([A-Z_]+)>', one, topic)


def topic_words(spec):
    """The plan's topic for a reader of the layout doc: each <#KEY> as the
       channel's name."""
    return re.sub(r'<#([A-Z_]+)>', lambda m: _plain(m.group(1)), spec.get('topic') or '')


def gone_mentions(guild, text):
    """The ids of channels text mentions that are not on the server."""
    have = set(getattr(c, 'id', None) for c in getattr(guild, 'channels', ()))
    have.update(getattr(t, 'id', None) for t in getattr(guild, 'threads', ()) or ())
    return [int(i) for i in re.findall(r'<#(\d+)>', text or '') if int(i) not in have]


async def ensure_channel(guild, cat, spec, roles, found):
    name = spec['name']
    kind = spec['kind']
    want = name.lower().replace(' ', '-') if kind != 'voice' else name

    existing = None
    for ch in guild.channels:
        if ch.name == want and getattr(ch, 'category', None) == cat:
            existing = ch
            break
    ow = spec_overwrites(guild, spec, roles)

    if existing is None:
        existing = await bring_back(guild, cat, spec, want)
        if existing is False:
            # -Check: it would be renamed or moved here, and said so.
            return None

    if existing is None and not spec.get('make', True):
        # In the plan so prune leaves the name alone, gone on purpose, and not
        # made again.
        kept.append('#' + want + ' (not there, and not made again)')
        return None
    if existing is None and CHECK:
        say('would make', ('voice ' if kind == 'voice' else '#') + want)
        return None
    if existing is None:
        try:
            if kind == 'voice':
                existing = await guild.create_voice_channel(
                    name, category=cat, overwrites=ow, reason='Thornswood setup')
            elif kind == 'forum':
                try:
                    existing = await guild.create_forum(
                        want, category=cat, topic=topic_text(guild, spec),
                        overwrites=ow, reason='Thornswood setup')
                except Exception:
                    # No Community on this server yet. A text channel does the
                    # same job with less shape to it, and turning Community on
                    # later plus another run makes the forum.
                    existing = await guild.create_text_channel(
                        want, category=cat, topic=topic_text(guild, spec),
                        overwrites=ow, reason='Thornswood setup')
                    say('note', want + ' is a text channel for now, turn on '
                        'Community and run this again for a forum')
            else:
                existing = await guild.create_text_channel(
                    want, category=cat, topic=topic_text(guild, spec),
                    overwrites=ow, reason='Thornswood setup')
            made.append('#' + want)
            say('channel', want)
        except discord.Forbidden:
            failed.append('#' + want + ' (no permission)')
            return None
    else:
        # Made before Community was on, so it came out as a text channel where
        # a forum was wanted. Discord cannot convert one into the other, so the
        # only fix is to delete it and make it again, which is why this says so
        # loudly rather than quietly leaving it wrong.
        if kind == 'forum' and not isinstance(existing, getattr(discord, 'ForumChannel', ())):
            if PRUNE and want in KEEP:
                say('note', '#' + want + ' is a text channel where a forum was '
                    'wanted, and it is never deleted. Make the forum by hand '
                    'if it is wanted')
            elif PRUNE and CHECK:
                # -Check asks Discord for nothing; it said nothing of this
                # and deleted the channel until #3317.
                say('would rebuild', '#' + want + ' as a forum; this deletes it')
            elif PRUNE:
                try:
                    await existing.delete(reason='wrong kind, rebuilding as a forum')
                    existing = await guild.create_forum(
                        want, category=cat, topic=topic_text(guild, spec),
                        overwrites=ow, reason='Thornswood setup')
                    made.append('#' + want + ' (rebuilt as a forum)')
                    say('rebuilt', want + ' is a forum now')
                except Exception:
                    failed.append('#' + want + ' could not be rebuilt as a forum')
            else:
                say('note', '#' + want + ' is a text channel where a forum was '
                    'wanted. The only fix for that deletes it, so ask first')
        kept.append('#' + want)
        topic = topic_text(guild, spec)
        if topic and (getattr(existing, 'topic', None) or '') != topic:
            if CHECK:
                say('would change', '#%s gets the plan\'s topic' % want)
            else:
                try:
                    await existing.edit(topic=topic)
                except discord.HTTPException as e:
                    failed.append('#%s kept its old topic (%s)' % (want, refused(e)))
        await keep_overwrites(existing, ow, '#' + want)

    if kind == 'announce' and isinstance(existing, discord.TextChannel):
        try:
            if existing.type is not discord.ChannelType.news:
                if CHECK:
                    say('would change', 'a server or channel setting')
                else:
                    await existing.edit(type=discord.ChannelType.news)
        except Exception:
            say('note', want + ' could not become an announcement channel, '
                'which needs Community on')

    if spec.get('key'):
        found[spec['key']] = existing
    return existing


# ------------------------------------------------------------ changelogs --
# Every channel the build writes is a doc, and every doc keeps a changelog
# (#3317). The fingerprints are content.py's (doc_print, unrecorded), so a pull
# request's build checks them without discord.py (#3457).

def doc_keys():
    """Every PLAN key whose channel the build writes."""
    return [s['key'] for _, specs in PLAN for s in specs if s.get('post')]


def check_docs():
    """What stops a build: a written channel with no words, or whose words
       have no change line, or a change line or live words that say what a
       public line never says (content.py, NOT_PUBLIC). [] when every doc is
       in order."""
    bad = []
    keys = []
    for key in doc_keys():
        if key not in C.DOCS:
            bad.append('%s is written by the build and content.py DOCS has no words for it' % key)
        else:
            keys.append(key)
    for key, fp in C.unrecorded(keys):
        bad.append('%s: its words have no change line. Add (\'<YYYY-MM-DD>\', '
                   '\'<what changed and why>\', \'%s\') to the end of '
                   'CHANGES[\'%s\'] in content.py' % (key, fp, key))
    for key, where, what, words in C.unpublic(keys):
        bad.append('%s, %s: %s, which a public line never says (#3656): "%s"'
                   % (key, where, what, words))
    return bad


def nice_date(iso):
    import datetime
    d = datetime.date.fromisoformat(iso)
    return '%d %s %d' % (d.day, d.strftime('%b'), d.year)


def change_lines(key):
    """The changelog of a doc as the thread says it, oldest first."""
    return ['**%s**: %s' % (nice_date(d), line) for d, line, _ in C.CHANGES.get(key) or []]


def doc_with_footer(key, thread=None):
    """A doc's words, ending on its newest change and a link to the
       channel's Changelog thread. The link is the way in: the thread's own
       "started a thread" line can be lost, and Discord archives a quiet
       thread out of the channel's list, but a mention always opens it."""
    lines = C.CHANGES.get(key) or []
    text = C.DOCS[key]
    if lines:
        d, line, _ = lines[-1]
        where = ('in the Changelog thread, ' + thread.mention) if thread is not None else 'in the Changelog thread'
        text = text.rstrip() + '\n\n*Last changed %s: %s Every change is %s.*\n' % (
            nice_date(d), line, where)
    return text


CHANGELOG = 'Changelog'


async def find_changelog(channel):
    """The channel's Changelog thread, open or archived, or None. Raises
       discord.HTTPException when the archive cannot be read."""
    for t in getattr(channel, 'threads', None) or []:
        if t.name == CHANGELOG:
            return t
    async for t in channel.archived_threads(limit=100):
        if t.name == CHANGELOG:
            return t
    return None


async def keep_changelog(channel, key):
    """The channel's Changelog thread, made and locked if missing, holding
       its doc's change lines as content.py has them, once each and in order,
       and handed back for the post to link (None when it could not be had).
       content.py is the record of what changed. A line reworded or taken
       out there is reworded or taken out here as well (#3656: two lines
       went out saying "Patrick confirmed it (#3656)" and, until then, the
       thread kept every line it was ever sent): the bot's lines from the
       first one that differs on are taken down and the rest posted again,
       so the order stays the order of the changes."""
    if channel is None or not hasattr(channel, 'create_thread'):
        return None
    try:
        thread = await find_changelog(channel)
    except discord.HTTPException as e:
        failed.append('#%s: its Changelog thread could not be looked for (%s)' % (channel.name, refused(e)))
        return None
    if thread is None:
        try:
            kind = (discord.ChannelType.news_thread
                    if getattr(channel, 'type', None) is discord.ChannelType.news
                    else discord.ChannelType.public_thread)
            # A week, the longest Discord keeps a quiet thread in the list.
            thread = await channel.create_thread(name=CHANGELOG, type=kind,
                                                 auto_archive_duration=10080,
                                                 reason='Thornswood setup, the changelog')
            await thread.edit(locked=True)
            say('changelog', '#' + channel.name + ' has its Changelog thread')
        except discord.HTTPException as e:
            failed.append('#%s: its Changelog thread could not be made (%s)' % (channel.name, refused(e)))
            return None
    want = change_lines(key)
    try:
        mine = await changelog_lines(thread, client.user.id)
        same = 0
        while same < len(mine) and same < len(want) and mine[same].content == want[same]:
            same += 1
        if same < len(mine) and getattr(thread, 'archived', False):
            # Discord refuses a delete in an archived thread, and a send
            # would only bring it back after the deletes were refused.
            await thread.edit(archived=False)
        for m in mine[same:]:
            await m.delete()
        for line in want[same:]:
            await thread.send(line)
        if same < len(mine):
            say('changelog', '#%s: %d line(s) no longer in content.py taken down, %d posted again'
                % (channel.name, len(mine) - same, len(want) - same))
    except discord.HTTPException as e:
        failed.append('#%s: its changelog was not brought up to date (%s)' % (channel.name, refused(e)))
    return thread


async def changelog_lines(thread, me_id):
    """The bot's change lines in a Changelog thread, oldest first: its own
       plain messages, never a line Discord adds or anybody else's."""
    out = []
    async for m in thread.history(limit=500, oldest_first=True):
        if (getattr(getattr(m, 'author', None), 'id', None) == me_id and
                getattr(m, 'type', None) in (discord.MessageType.default, discord.MessageType.reply)):
            out.append(m)
    return out


async def changelog_drift(channel, key, me_id):
    """How a doc channel's changelog differs from content.py, as lines for
       the audit: [] when its Changelog thread is there, holds every change
       line, and the channel's post links it. Reads only."""
    try:
        thread = await find_changelog(channel)
    except discord.HTTPException as e:
        return ['its Changelog thread could not be looked for (%s)' % refused(e)]
    if thread is None:
        return ['it has no Changelog thread; -Posts makes it']
    out = []
    try:
        have = [m.content for m in await changelog_lines(thread, me_id)]
        want = change_lines(key)
        gone = [l for l in want if l not in have]
        stale = [l for l in have if l not in want]
        if gone:
            out.append('its Changelog thread is missing %d change line(s); -Posts adds them' % len(gone))
        if stale:
            out.append('its Changelog thread has %d line(s) content.py no longer has; '
                       '-Posts takes them down' % len(stale))
        elif not gone and have != want:
            out.append('its Changelog thread has its lines out of order or twice; -Posts puts them right')
        linked = False
        async for m in channel.history(limit=50):
            if doc_post_of_mine(m, me_id) and thread.mention in (m.content or ''):
                linked = True
                break
        if not linked:
            out.append('its post does not link its Changelog thread; -Posts writes the link')
    except discord.HTTPException as e:
        out.append('its changelog could not be read (%s)' % refused(e))
    return out


def doc_post_of_mine(message, me_id):
    """A message of the bot's that post() writes and so replaces: its words
       and the "pinned a message" line Discord adds for them. Never the
       "started a thread" line of the Changelog thread: until 23 Oct this
       took every message of the bot's, that line with them, so each -Posts
       run after the first took the changelog out of sight (#3336)."""
    if getattr(getattr(message, 'author', None), 'id', None) != me_id:
        return False
    kind = getattr(message, 'type', None)
    return kind in (discord.MessageType.default, discord.MessageType.reply,
                    discord.MessageType.pins_add)


async def post(channel, text, found):
    """Put the words in, replacing anything this bot put there before, so the
       rules can be edited in content.py and re run rather than in Discord."""
    if channel is None or text is None:
        return
    for token, ch in found.items():
        if ch is not None:
            text = text.replace('<#' + token + '>', ch.mention)
    # Anything left pointing at a channel that does not exist becomes plain
    # words rather than a broken mention.
    import re
    text = re.sub(r'<#([A-Z]+)>', lambda m: '#' + m.group(1).lower(), text)

    # The old posts go first, or the new ones would sit under them twice
    # over. A channel whose old posts cannot be read or removed is left as it
    # is and named under "did not manage" (#2736): writing beside them is how
    # a channel came to say its rules twice.
    try:
        async for old in channel.history(limit=50):
            if doc_post_of_mine(old, client.user.id):
                try:
                    await old.delete()
                except discord.NotFound:
                    pass  # gone already, which is what this wanted
    except discord.HTTPException as e:
        failed.append('#%s was not rewritten: its old posts could not be removed (%s)'
                      % (channel.name, refused(e)))
        return

    chunks, cur = [], ''
    for para in text.split('\n\n'):
        if len(cur) + len(para) + 2 > 1900:
            chunks.append(cur.strip())
            cur = ''
        cur += para + '\n\n'
    if cur.strip():
        chunks.append(cur.strip())

    first = None
    for c in chunks:
        m = await channel.send(c)
        first = first or m
    if first:
        try:
            await first.pin()
        except discord.HTTPException as e:
            failed.append('#%s: its first post could not be pinned (%s)' % (channel.name, refused(e)))
    say('wrote', '#' + channel.name)


async def write_posts(posts, found):
    """The read only posts of this run's channels, (channel, key) pairs: each
       rewritten with its Changelog thread under -Posts, said under -Check,
       and left alone without -Posts. A whole run and an ONLY run both come
       through here, so they write a post the same way (#3656)."""
    # A draft waits for its lead and Patrick (#3317) and is never written.
    drafts = [(ch, k) for ch, k in posts if k in C.DRAFTS]
    posts = [(ch, k) for ch, k in posts if k not in C.DRAFTS]
    for ch, k in drafts:
        say('left alone', '#%s: its words are a draft waiting on approval'
            % getattr(ch, 'name', k.lower()))
    if CHECK and POSTS:
        for ch, key in posts:
            if ch is not None:
                say('would write', '#' + ch.name + ' and its changelog')
    elif CHECK and posts:
        # What the same run without -Check does: it leaves them alone.
        # This said would write for all seven whether or not -Posts was
        # given (#2519, 22 Oct).
        say('left alone', '%d read only post(s). -Posts rewrites them.' % len(posts))
    elif POSTS:
        for ch, key in posts:
            # The thread first, so the post can link it.
            thread = await keep_changelog(ch, key)
            await post(ch, doc_with_footer(key, thread), found)
    elif posts:
        say('left alone', '%d read only post(s). -Posts rewrites them.' % len(posts))


def look_up(guild, found):
    """Under ONLY, the channels of PLAN the run did not reach, found by name
       in their own category and put in found, so a named channel's post
       links the live channels it mentions instead of saying their names
       as plain words. Asks Discord for nothing and changes nothing: a
       channel that is not there stays out of found."""
    def want(spec):
        return spec['name'] if spec['kind'] == 'voice' else spec['name'].lower().replace(' ', '-')
    for catname, specs in PLAN:
        cat = None
        if catname:
            cat = discord.utils.get(guild.categories, name=catname)
            if cat is None:
                continue
        for spec in specs:
            key = spec.get('key')
            if not key or found.get(key) is not None:
                continue
            for ch in guild.channels:
                if ch.name == want(spec) and getattr(ch, 'category', None) == cat:
                    found[key] = ch
                    break


def _flags_differ(guild, flags):
    """True when the server's system-channel flags are not the ones wanted.

    A flag this discord.py does not know is left out, so the older library
    is compared on the flags it has.
    """
    cur = getattr(guild, 'system_channel_flags', None)
    if cur is None:
        return True
    for name in ('join_notifications', 'join_notification_replies',
                 'premium_subscriptions', 'guild_reminder_notifications'):
        if not hasattr(flags, name):
            continue
        if getattr(cur, name, None) != getattr(flags, name):
            return True
    return False


async def apply_welcome_and_afk(guild, found):
    """Discord's plain join line, and where it moves people who go quiet.

    The plain "Welcome X" line is a server setting, not a post, and it turns
    #welcome into a list of names. The bot draws a card instead, so this
    switches the plain one off and leaves boosts and the setup tips alone.
    The system channel is set only when the server has none yet: it was set
    by hand to #welcome-travelers, and a re-run must not move it back.

    Discord moves people into AFK itself after five minutes of silence.

    Under -Check this says would change only when the server is not already
    that way, and it never says set.
    """
    try:
        wel = found.get('WELCOME')
        flags = discord.SystemChannelFlags(
            join_notifications=False,
            join_notification_replies=False,
            premium_subscriptions=True,
            guild_reminder_notifications=False)
        # Only when the server has none yet. It was set by hand to
        # #welcome-travelers, where the join cards go, and a re-run moving
        # it back to #welcome would undo that.
        if wel is not None and guild.system_channel is None:
            if CHECK:
                say('would change', 'a server or channel setting')
            else:
                await guild.edit(system_channel=wel, system_channel_flags=flags)
        elif _flags_differ(guild, flags):
            if CHECK:
                say('would change', 'a server or channel setting')
            else:
                await guild.edit(system_channel_flags=flags)
        if not CHECK:
            say('set', "Discord's own join message is off, the bot's card replaces it")
    except TypeError:
        # Older discord.py has no join_notification_replies.
        try:
            flags = discord.SystemChannelFlags(
                join_notifications=False,
                premium_subscriptions=True,
                guild_reminder_notifications=False)
            if _flags_differ(guild, flags):
                if CHECK:
                    say('would change', 'a server or channel setting')
                else:
                    await guild.edit(system_channel_flags=flags)
                    say('set', "Discord's own join message is off")
            elif not CHECK:
                await guild.edit(system_channel_flags=flags)
                say('set', "Discord's own join message is off")
        except Exception:
            say('note', 'could not switch off the plain join message')
    except Exception:
        say('note', 'could not switch off the plain join message')

    try:
        afk = found.get('AFK')
        if afk is not None and guild.afk_channel != afk:
            if CHECK:
                say('would change', 'a server or channel setting')
            else:
                await guild.edit(afk_channel=afk, afk_timeout=300)
                say('set', 'AFK after five minutes goes to ' + afk.name)
    except Exception:
        say('note', 'could not set the AFK channel')


# Discord's own notices about the server (#2955): Community Updates and Safety
# Notifications, the second about raids, DM spam and moderation, some of it
# about named people. Both go to #staff-updates, where staff notices go
# (Patrick, 20 Oct), and never to #staff-general, which is for talk. By the id
# in staff-channel.txt, the one bot.py speaks in, not by name: a name can be
# two channels. They were a hand step on the Enable Community screen, written
# up in the README as #staff-general, until this set them from the plan.
STAFF_CHANNEL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  'staff-channel.txt')


async def apply_notice_channels(guild):
    """Points Discord's Community Updates and Safety Notifications channels at
    #staff-updates.

    Neither field exists until Community is on, and the closing lines of a
    run already say to turn it on and run again, so a server without it is
    left alone. Under -Check this says would change only when either one
    points somewhere else, and it never says set. What it cannot do goes
    under "did not manage" with the reason.
    """
    if 'COMMUNITY' not in set(getattr(guild, 'features', []) or []):
        return
    what = "Discord's own community and safety notices"
    try:
        with open(STAFF_CHANNEL_FILE, encoding='utf-8') as f:
            want_id = int(f.read().strip())
    except (OSError, ValueError) as e:
        failed.append('%s: staff-channel.txt gives no channel id (%s)' % (what, e))
        return
    want = guild.get_channel(want_id)
    if want is None:
        failed.append('%s: this server has no channel %d, the id in '
                      'staff-channel.txt' % (what, want_id))
        return
    have = (getattr(guild.public_updates_channel, 'id', None),
            getattr(guild.safety_alerts_channel, 'id', None))
    if have == (want_id, want_id):
        say('left alone', '%s already go to #%s' % (what, want.name))
        return
    if CHECK:
        say('would change', '%s to #%s' % (what, want.name))
        return
    try:
        await guild.edit(public_updates_channel=want, safety_alerts_channel=want,
                         reason='Thornswood setup')
    except discord.HTTPException as e:
        failed.append('%s: could not move them to #%s (%s)' % (what, want.name, refused(e)))
        return
    say('set', '%s go to #%s' % (what, want.name))


def plan_for(only):
    """PLAN, or the part of it ONLY names (#2519): a named category with
       all its channels, and a named channel in its own category. A name
       PLAN does not have is a ValueError naming it."""
    if not only:
        return PLAN
    def key(spec):
        return spec['name'] if spec['kind'] == 'voice' else spec['name'].lower().replace(' ', '-')
    cats = set(c for c, _ in PLAN if c)
    chans = set(key(s) for _, specs in PLAN for s in specs)
    unknown = [n for n in only if n not in cats and n not in chans]
    if unknown:
        raise ValueError('not in the plan: ' + ', '.join(unknown) +
                         '. ONLY takes category names and channel names from PLAN')
    out = []
    for catname, specs in PLAN:
        if catname and catname in only:
            out.append((catname, specs))
            continue
        picked = [s for s in specs if key(s) in only]
        if picked:
            out.append((catname, picked))
    return out


# discord.py hands View Channel back under its old name, read_messages. The
# audit says it the way Discord's own permissions page and this file do.
SAID = {'read_messages': 'view_channel'}


def perm_names(p):
    """The permissions a Permissions holds, by discord.py's names, sorted."""
    return sorted(SAID.get(n, n) for n, v in p if v)


def _ow_dict(o):
    """A PermissionOverwrite as {name: True or False}, the unset left out."""
    return dict((SAID.get(n, n), v) for n, v in o if v is not None)


def perm_diff(have, want):
    """(extra, missing): what have holds that want does not, and the other
       way round, by name."""
    h, w = set(perm_names(have)), set(perm_names(want))
    return sorted(h - w), sorted(w - h)


def target_name(guild, t):
    """Who an overwrite is for, in words: a role's name, the bot, or a
       member by id. A member is never named, so the audit's channel lines
       say nothing about people."""
    if getattr(t, 'id', None) == getattr(getattr(guild, 'me', None), 'id', -1):
        return 'the bot'
    if hasattr(t, 'permissions'):
        return t.name
    return 'member %s' % getattr(t, 'id', '?')


def overwrite_diff(guild, live, want):
    """What differs between two {target: PermissionOverwrite} maps, as one
       line per target that differs, by the target's name. A target only in
       live is said with everything it sets; one only in want is said as
       missing."""
    a = dict((target_name(guild, t), o) for t, o in (live or {}).items())
    b = dict((target_name(guild, t), o) for t, o in (want or {}).items())
    out = []
    for name in sorted(set(a) | set(b)):
        la = _ow_dict(a[name]) if name in a else {}
        wb = _ow_dict(b[name]) if name in b else {}
        if name not in a:
            out.append('%s: no overwrite, the plan gives %s'
                       % (name, _ow_words(wb)))
            continue
        if name not in b:
            out.append('%s: not in the plan, has %s' % (name, _ow_words(la)))
            continue
        diff = []
        for perm in sorted(set(la) | set(wb)):
            if la.get(perm) != wb.get(perm):
                diff.append('%s is %s, plan %s' % (perm, _tri(la.get(perm)),
                                                    _tri(wb.get(perm))))
        if diff:
            out.append('%s: %s' % (name, '; '.join(diff)))
    return out


def _tri(v):
    return 'allowed' if v is True else 'denied' if v is False else 'unset'


def _ow_words(d):
    allow = sorted(k for k, v in d.items() if v is True)
    deny = sorted(k for k, v in d.items() if v is False)
    parts = []
    if allow:
        parts.append('allow ' + ', '.join(allow))
    if deny:
        parts.append('deny ' + ', '.join(deny))
    return '; '.join(parts) or 'nothing'


def doubles(members, ranks=None):
    """[(member, category, [rank, ...])] for everybody holding two or more
       ranks of one staff category (STAFF_RANKS)."""
    out = []
    for m in members:
        mine = set(r.name for r in getattr(m, 'roles', ()) or ())
        for cat, names in (ranks or STAFF_RANKS):
            held = [n for n in names if n in mine]
            if len(held) > 1:
                out.append((m, cat, held))
    return out


def seat_clashes(members):
    """[(member, [staff role, ...], [seat, ...])] for everybody on staff who
       also holds a Jarl or faction leader seat (#3317, Patrick, 22 Oct: no
       staff role may also be a faction leader, and Jarls are faction
       leaders)."""
    out = []
    for m in members:
        mine = [r.name for r in getattr(m, 'roles', ()) or ()]
        staff = [n for n in mine if n in STAFF]
        seats = [n for n in mine if n in SEATS]
        if staff and seats:
            out.append((m, staff, seats))
    return out


def order_slips(roles_by_name):
    """[(higher, lower)] for each pair of neighbouring plan roles the live
       list has the wrong way round: higher is above lower in the plan and
       below it on the server. Roles something else manages are counted too,
       since the run moves those too (role_order) and only this says
       where they are."""
    present = [roles_by_name[n] for n, _, _, _ in ROLES if n in roles_by_name]
    return [(a.name, b.name) for a, b in zip(present, present[1:])
            if rank(a) < rank(b)]


def _who(m):
    return getattr(m, 'display_name', None) or getattr(m, 'name', None) or str(getattr(m, 'id', '?'))


def _names_of(m):
    return [n for n in (getattr(m, 'name', None), getattr(m, 'global_name', None),
                        getattr(m, 'nick', None), getattr(m, 'display_name', None)) if n]


def find_member(members, who):
    """Everybody who is exactly who: their id, or their user name, display
       name or server nickname in any case. Never a part of a name."""
    w = (who or '').strip().lower()
    if not w:
        return []
    if w.isdigit():
        return [m for m in members if getattr(m, 'id', None) == int(w)]
    return [m for m in members if any(n.lower() == w for n in _names_of(m))]


def near_members(members, who):
    """Who has who somewhere in a name, for a give that matched nobody."""
    w = (who or '').strip().lower()
    return [m for m in members if w and any(w in n.lower() for n in _names_of(m))]


def give_refusal(member, rank):
    """Why rank is not given to member, or None. 'already' when they hold it."""
    held = set(r.name for r in getattr(member, 'roles', ()) or ())
    if rank in held:
        return 'already'
    for cat, names in STAFF_RANKS:
        if rank in names:
            other = [n for n in names if n in held]
            if other:
                return ('%s holds %s, a rank of %s, and nobody holds two ranks of '
                        'one category; take that off first'
                        % (_who(member), other[0], cat))
    seats = sorted(n for n in held if n in SEATS)
    if seats:
        return '%s holds %s, and staff hold no seat' % (_who(member), ', '.join(seats))
    return None


async def give(guild):
    """GIVE, and nothing else. See GIVE at the top."""
    have = dict((r.name, r) for r in guild.roles)
    print('\n  Giving staff ranks in %s\n' % guild.name, flush=True)
    for rank, who in GIVE:
        if rank not in STAFF:
            failed.append('%s is not a staff rank of the plan; -Give gives only %s'
                          % (rank, ', '.join(STAFF)))
            continue
        role = have.get(rank)
        if role is None:
            failed.append('there is no %s role on the server yet; a build makes it' % rank)
            continue
        found = find_member(guild.members, who)
        if len(found) != 1:
            near = found or near_members(guild.members, who)
            failed.append('%s matches %s, so %s was not given%s'
                          % (who or 'nobody named', 'nobody' if not found else
                             '%d members' % len(found), rank,
                             ('; names like it: ' + ', '.join(
                                 '%s (%s)' % (_who(m), m.id) for m in near[:10]))
                             if near else ''))
            continue
        m = found[0]
        why = give_refusal(m, rank)
        if why == 'already':
            say('already', '%s holds %s' % (_who(m), rank))
            continue
        if why:
            failed.append('%s was not given: %s' % (rank, why))
            continue
        if CHECK:
            say('would give', '%s to %s' % (rank, _who(m)))
            continue
        try:
            await m.add_roles(role, reason='Thornswood setup, -Give (#3317)')
            say('gave', '%s to %s' % (rank, _who(m)))
        except discord.HTTPException as e:
            failed.append('could not give %s to %s (%s)' % (rank, _who(m), refused(e)))
    if failed:
        print('\n  did not manage:')
        for f in failed:
            print('    ' + f)
    print('')
    return len(failed)


# DISCORD'S ONBOARDING STAYS OFF (#3317). Patrick picked the Member button in
# #start-here over Discord's onboarding (q-3317-member-gate, A): two yes or no
# questions, 18 or over and the rules accepted, and the bot gives Member. With
# onboarding on, Discord refuses to shut @everyone out of the last channels it
# can post in, and the live build of 22 Oct left #tickets-and-applications and
# #updates open with "400 Onboarding requires at least one channel where
# @everyone can read and send messages". So a whole build switches it off
# before it gates a channel, and the audit says when it is on.
# Build-Onboarding.py refuses to switch it back on under the gate by its own
# check of the channels @everyone can post in.
ONBOARDING_WHY = ('the plan gives Member by the button in #start-here '
                  '(q-3317-member-gate, A), and while it is on Discord refuses '
                  'to shut @everyone out of its last channels')


async def onboarding_on(guild):
    """True or False, or the reason it could not be read."""
    try:
        ob = await guild.onboarding()
    except discord.HTTPException as e:
        return refused(e)
    return bool(getattr(ob, 'enabled', False))


async def keep_onboarding_off(guild):
    on = await onboarding_on(guild)
    if on is False:
        return
    if on is not True:
        failed.append("could not read Discord's Onboarding (%s)" % on)
        return
    if CHECK:
        say('would', "switch Discord's Onboarding off: " + ONBOARDING_WHY)
        return
    try:
        await guild.edit_onboarding(enabled=False,
                                    reason='Thornswood setup, Member comes from #start-here (#3317)')
        say('switched', "Discord's Onboarding off: " + ONBOARDING_WHY)
    except discord.HTTPException as e:
        failed.append("could not switch Discord's Onboarding off (%s)" % refused(e))


# --------------------------------------------------------------- layout --
# THE LAYOUT, WRITTEN OUT (#3317, Patrick, 22 Oct: "we also need to document
# the discord layout somewhere ... so that we dont accidentally drift using
# the script and we can quickly ask an agent a question about it").
# docs/systems/discord.md is made from ROLES and PLAN by
#
#     python3.12 bot/Build-Discord.py --layout
#
# and bot/tests/test-3317-layout.py fails when the file and the plan differ, so the
# page is the plan in words and never a second copy that drifts. -Audit says
# where the live server differs from both.
LAYOUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                           'docs', 'systems', 'discord.md')

# What each staff rank does, in Patrick's words of 22 Oct (#3317).
ROLE_DOES = {
    'Owner': 'Final decision with Co-Owner. Administrator.',
    'Co-Owner': 'Final decision with Owner. Administrator.',
    'Lead Dev': 'Leads the developers; on the council.',
    'Lead Gamemaster': 'Leads the gamemasters; on the council.',
    'Lead Loremaster': 'Leads the loremasters; on the council.',
    'Lead Moderator': 'Leads the moderators; on the council.',
    'Lead Content Creator': 'Leads Thornswood\'s own content; on the council.',
    'Lead Support': 'Leads support; on the council.',
    'Dev': 'Builds the game, the launcher, the site and the bot. Plays the dev build.',
    'Gamemaster': 'Runs scenes and events in the world.',
    'Trial Gamemaster': 'A gamemaster on trial; where every accepted GM starts.',
    'Loremaster': 'Makes and watches the lore, helps with events, and checks '
                  'that gamemasters keep to the lore.',
    'Moderator': 'Moderates the Discord only. No staff powers in the game.',
    'Content Creator': 'Thornswood\'s own social media and content, not '
                       'community creators.',
    'Support': 'Answers help tickets and playtest applications, and gives Playtester.',
    'Playtester': 'Plays the main build. Opens the Discord past Information.',
    'Member': 'Joined and answered the rules and age questions. Sees Start '
              'Here, Applications and Information.',
    'Banned': 'Takes the site and the game away (site/server.js, access.banned).',
    'Thalmor Boot-Licker': 'A Patreon tier; Patreon gives and takes it.',
    'Talos Worshiper': 'A Patreon tier; Patreon gives and takes it.',
    'Milk Drinker': 'A Patreon tier; Patreon gives and takes it.',
    'Server Booster': 'Boosted the server.',
    'Patreon': 'Supports Thornswood on Patreon; Patreon gives and takes it.',
}
for _h in OFFICE_HOLDS:
    ROLE_DOES['Jarl of ' + _h] = 'The seat of %s. Applied for on its own application.' % _h
for _f, _n in zip(FACTIONS, FACTION_LEADERS):
    ROLE_DOES[_n] = 'Leads %s. Applied for as Faction Leader.' % _f
for _f, _n in zip(FACTIONS, FACTION_MEMBERS):
    ROLE_DOES[_n] = 'A member of %s. Its Leader gives and takes it.' % _f
    ROLE_DOES[_n + ' Officer'] = ('An Officer of %s: posts its announcements and '
                                  'sits in its leadership. Its Leader gives and '
                                  'takes it, to a member.' % _f)
ROLE_DOES['Business Owner'] = 'Owns a business book in the game. Support gives it.'

# The named permission sets, so a role's line says which and the sets are
# spelled out once.
PERMISSION_SETS = (('Administrator', ADMIN), ('council set', COUNCIL),
                   ('moderator set', MOD), ('gamemaster set', GM),
                   ('support set', SUPPORT), ('nothing of its own', NONE))

# Groups a list of role names is said in, largest first.
_GROUPS = (('everybody on staff', STAFF), ('the council', COUNCIL_ROLES),
           ('Owner and Co-Owner', OWNERS))


def _set_name(p):
    for name, q in PERMISSION_SETS:
        if p.value == q.value:
            return name
    return ', '.join(perm_names(p))


def _names_words(names):
    """A list of role names, with whole groups said by the group's name."""
    left = list(dict.fromkeys(names))
    out = []
    for label, group in _GROUPS:
        if group and all(n in left for n in group):
            out.append(label)
            left = [n for n in left if n not in group]
    return ', '.join(out + left) or 'nobody'


def _made_by(name):
    if name == 'Server Booster':
        return 'Discord'
    if name == 'Patreon':
        return 'Patreon'
    if name in ('News Pings', 'Updates Pings'):
        return 'bot.py'
    return 'the build'


def _spec_name(spec):
    return spec['name'] if spec['kind'] == 'voice' else '#' + spec['name'].lower().replace(' ', '-')


def _audience_words(mode, hold=None, space=None, read_extra=(), extra=(), faction=None):
    """(reads, talks, posts) of one place, in words."""
    if mode == 'public':
        return 'everybody', 'everybody', 'everybody'
    readers, talkers, posters = mode_audience(mode, hold, space, faction)
    readers = tuple(readers) + tuple(read_extra or ())
    talkers = tuple(talkers) + tuple(extra or ())
    see = readers + talkers + posters
    if mode == 'read':
        return 'everybody', _names_words(talkers + posters), _names_words(posters)
    return (_names_words(see), _names_words(talkers + posters) if talkers or posters else 'nobody',
            _names_words(posters) if posters else '')


def layout():
    """docs/systems/discord.md, from ROLES and PLAN."""
    L = []
    w = L.append
    w('# The Discord layout')
    w('')
    w('Made from `bot/Build-Discord.py` (ROLES and PLAN) by')
    w('`python3.12 bot/Build-Discord.py --layout`. Do not edit it by hand:')
    w('change the plan and run that, and `bot/tests/test-3317-layout.py` fails when')
    w('the two differ. `Setup-Discord.ps1 -OnBox -Audit` says where the live')
    w('server differs from this page. Issue #3317 is where it was set out.')
    w('')
    w('## The staff council')
    w('')
    w('Each staff category has a lead, and the leads are the council: they')
    w('decide together, and Owner and Co-Owner make the final call. A person')
    w('holds at most one rank in a category (Lead Dev and Dev is a double);')
    w('ranks of two categories are fine, and Owner or Co-Owner with a lead is')
    w('fine. The audit reports every double.')
    w('')
    w('Nobody on staff holds a seat of the world: a Jarl or a faction leader.')
    w('A Jarl is a faction leader with its own application, which lists only')
    w('the holds with no Jarl. The audit reports anybody holding both.')
    w('')
    w('Leads and Support hold Manage Roles and give only their own')
    w('category\'s roles (Support gives Playtester). Every staff role sits')
    w('above every other role.')
    w('')
    w('| Category | Its space | Lead | Ranks under the lead |')
    w('|---|---|---|---|')
    for c in STAFF_CATEGORIES:
        w('| %s | %s | %s | %s |' % (c[0], c[1], c[3], ', '.join(c[4])))
    w('')
    if SPACE_GUESTS:
        for sp, guests in SPACE_GUESTS.items():
            w('Holders of %s also talk in the %s space.' % (' and '.join(guests), sp))
        w('')
    w('## Roles, top of the list first')
    w('')
    w('| Role | Colour | Shown on its own | Permissions | Made by | What it is |')
    w('|---|---|---|---|---|---|')
    for name, colour, hoist, perms in ROLES:
        w('| %s | #%06X | %s | %s | %s | %s |' % (
            name, colour, 'yes' if hoist else 'no',
            'left to what makes it' if name in NOT_MADE else _set_name(perms),
            _made_by(name), ROLE_DOES.get(name, '')))
    w('')
    w('@everyone keeps what the server gives it; the build does not change it,')
    w('and the audit prints it. Every other role opens exactly the channels')
    w('below that name it.')
    w('')
    w('The bot\'s own role keeps Administrator, for a build and the rest of the')
    w('time (Patrick, 22 Oct 2026: "the bot will keep admin"). The audit counts')
    w('it holding Administrator as planned, and its going without as a')
    w('difference. What the running bot itself uses is RUN_BITS in the builder.')
    w('')
    w('### The permission sets')
    w('')
    for name, p in PERMISSION_SETS:
        if p.value:
            w('- **%s**: %s' % (name, ', '.join(perm_names(p))))
    w('')
    w('## Who a mode lets in')
    w('')
    w('Every category and channel has a mode. Reads means sees and reads back;')
    w('talks means posts as well; posts in a read only place means writes and')
    w('tidies there. A staff space mode is said for the space it names.')
    w('')
    w('| Mode | Sees | Talks | Posts |')
    w('|---|---|---|---|')
    for mode in ('public', 'read', 'membersread', 'open', 'pathfind', 'testersread',
                 'staff', 'staffread', 'council'):
        r, t, p = _audience_words(mode)
        w('| %s | %s | %s | %s |' % (mode, r, t, p or '-'))
    r, t, p = _audience_words('hold', 'Whiterun')
    w('| hold (Whiterun) | %s | %s | %s |' % (r, t, p or '-'))
    for mode in ('faction', 'factionread', 'factionlead', 'factionseats'):
        r, t, p = _audience_words(mode, faction='The Companions')
        w('| %s (The Companions) | %s | %s | %s |' % (mode, r, t, p or '-'))
    for mode in ('space', 'spaceread', 'spacerules'):
        r, t, p = _audience_words(mode, space='Lore')
        w('| %s (Lore) | %s | %s | %s |' % (mode, r, t, p or '-'))
    w('')
    w('## Categories and channels, in order')
    w('')
    for catname, specs in PLAN:
        cmode, cspace = category_mode(catname)
        was = CATEGORY_WAS.get(catname)
        w('### %s' % catname)
        w('')
        cwho = cspace or (catname if cmode in ('hold', 'faction') else None)
        w('Category mode: %s%s.%s' % (cmode, ' (%s)' % cwho if cwho else '',
                                      ' It was %s.' % ', '.join(was) if was else ''))
        w('')
        w('| Channel | Kind | Mode | Sees | Talks | Notes |')
        w('|---|---|---|---|---|---|')
        for spec in specs:
            mode = spec.get('mode', 'open')
            r, t, p = _audience_words(mode, spec.get('hold'), spec.get('space'),
                                      spec.get('read_extra'), spec.get('extra_roles'),
                                      spec.get('faction'))
            notes = []
            if p:
                notes.append('posts: ' + p)
            if spec.get('post'):
                notes.append('written by the build from content.py %s%s' % (
                    spec['key'], ', a draft waiting on approval' if spec['key'] in C.DRAFTS
                    else ', with its Changelog thread'))
            if spec.get('make', True) is False:
                notes.append('never made by the build')
            for oc, on in spec.get('was') or ():
                notes.append('was #%s in %s' % (on, oc) if spec['kind'] != 'voice'
                             else 'was %s in %s' % (on, oc))
            if spec.get('topic'):
                notes.append('topic: ' + topic_words(spec).replace('|', '/'))
            w('| %s | %s | %s | %s | %s | %s |' % (
                _spec_name(spec), spec['kind'],
                mode + (' (%s)' % (spec.get('hold') or spec.get('faction'))
                        if spec.get('hold') or spec.get('faction') else ''),
                r, t, '; '.join(notes)))
        w('')
    if RETIRED_CATEGORIES:
        w('## Retired')
        w('')
        w('Categories retired by the plan, removed by `-Prune` once empty: %s.'
          % ', '.join(RETIRED_CATEGORIES))
        w('')
        w('Channel names the build no longer wants, removed by `-Prune`: %s.'
          % ', '.join(RETIRED))
        w('')
    roles = set(n for n, _, _, _ in ROLES)
    w('Channels never deleted by anything in the build: %s.'
      % ', '.join(sorted(set(k for k in KEEP if k not in roles))))
    w('')
    w('Roles never deleted: every Jarl, Citizen and office role, and every '
      'faction\'s Leader, member and Officer role.')
    w('')
    return '\n'.join(L)


async def audit(guild):
    """Says, and changes nothing. See AUDIT at the top."""
    have = dict((r.name, r) for r in guild.roles)
    roles = dict((n, have[n]) for n, _, _, _ in ROLES if n in have)
    planned = dict((n, p) for n, _, _, p in ROLES)
    bad = [0]

    def line(what):
        print('  ' + what, flush=True)

    def off(what):
        bad[0] += 1
        line('DIFFERS  ' + what)

    print('\n  Audit of %s, read only\n' % guild.name, flush=True)

    print('  The bot', flush=True)
    me = guild.me
    mine = me.guild_permissions
    # It keeps Administrator (#3317, Patrick, 22 Oct 2026: "the bot will keep
    # admin"), so holding it is as planned and going without it is not.
    if mine.administrator:
        line('the bot holds Administrator, which it keeps')
    else:
        off('the bot does not hold Administrator, which it keeps (#3317): tick '
            'it on its role')
        extra, missing = perm_diff(mine, discord.Permissions(RUN_PERMISSIONS))
        if missing:
            off('the bot is missing ' + ', '.join(missing))
    line('its roles: ' + ', '.join(r.name for r in me.roles if r != guild.default_role))

    print('\n  @everyone', flush=True)
    line('server wide: ' + (', '.join(perm_names(guild.default_role.permissions)) or 'nothing'))
    on = await onboarding_on(guild)
    if on is True:
        off("Discord's Onboarding is on; " + ONBOARDING_WHY + '. A build switches it off')
    elif on is not False:
        off("Discord's Onboarding could not be read (%s)" % on)

    print('\n  Roles against the plan', flush=True)
    for name, _, _, want in ROLES:
        r = roles.get(name)
        if r is None:
            if name not in NOT_MADE:
                off('role %s is not on the server' % name)
            continue
        if name in NOT_MADE or getattr(r, 'managed', False):
            continue
        extra, missing = perm_diff(r.permissions, want)
        if extra:
            off('role %s holds more than the plan: %s' % (name, ', '.join(extra)))
        if missing:
            off('role %s is missing %s' % (name, ', '.join(missing)))
    for r in guild.roles:
        if (r.name not in planned and r != guild.default_role
                and not getattr(r, 'managed', False)):
            off('role %s is not in the plan, holds %s, %d member(s)'
                % (r.name, ', '.join(perm_names(r.permissions)) or 'nothing',
                   len(r.members)))

    print('\n  Who holds each staff rank', flush=True)
    staff_names = []
    for _, names in STAFF_RANKS:
        staff_names += list(names)
    for n in staff_names:
        r = have.get(n)
        if r is not None:
            line('%s: %s' % (n, ', '.join(sorted(_who(m) for m in r.members)) or 'nobody'))
    for n in ('Playtester', 'Member', 'Banned'):
        r = have.get(n)
        if r is not None:
            line('%s: %d member(s)' % (n, len(r.members)))
    for m, cat, held in doubles(guild.members):
        off('%s holds %s, two ranks of %s' % (_who(m), ' and '.join(held), cat))
    for m, staff, seats in seat_clashes(guild.members):
        off('%s is on staff (%s) and holds %s; staff hold no seat'
            % (_who(m), ', '.join(staff), ', '.join(seats)))

    print('\n  Role order against the plan', flush=True)
    for hi, lo in order_slips(have):
        off('role %s sits below %s; the plan has it above' % (hi, lo))

    # How Discord numbers the roles, as it is (#3317). The build of 22 Oct
    # asked for the plan's order in one request and Discord refused it with
    # Missing Permissions; these are the numbers that request is made of.
    print('\n  How Discord numbers the roles', flush=True)
    for w in role_numbers(guild):
        line(w)
    order = role_order(guild, roles)
    top = getattr(getattr(guild, 'me', None), 'top_role', None)
    if order is None:
        line('a build would ask for no role to move')
    elif top is None:
        line('a build would ask for %d roles, but the bot\'s own role is not known' % len(order))
    else:
        at = role_positions(order, top.position - 1)
        if at is None:
            off('the %d roles under the bot do not fit in the %d positions under '
                'its role, even sharing them' % (len(order), top.position - 1))
        else:
            line('a build would ask for positions 1 to %d under the bot\'s %d, '
                 '%d roles sharing a position, top first: %s'
                 % (max(at.values()), top.position, len(order) - len(set(at.values())),
                    ', '.join('%s %d' % (r.name, at[r]) for r in order)))

    print('\n  Categories and channels against the plan', flush=True)
    ours = set()
    docs = []
    topics = []
    for catname, specs in PLAN:
        cat = discord.utils.get(guild.categories, name=catname) if catname else None
        if catname and cat is None:
            off('category %s is not on the server' % catname)
            continue
        if cat is not None:
            want_ow = category_overwrites(guild, catname, roles)
            for d in overwrite_diff(guild, cat.overwrites,
                                    with_members(cat.overwrites, want_ow)):
                off('category %s, %s' % (catname, d))
        for spec in specs:
            kind = spec['kind']
            want = spec['name'].lower().replace(' ', '-') if kind != 'voice' else spec['name']
            ours.add((catname, want.lower()))
            ch = None
            for c in guild.channels:
                if c.name == want and getattr(c, 'category', None) == cat:
                    ch = c
                    break
            if ch is None:
                if spec.get('make', True):
                    off('#%s is not in %s' % (want, catname))
                continue
            if spec.get('post') and spec.get('key') not in C.DRAFTS:
                docs.append((ch, spec['key']))
            if kind != 'voice':
                topics.append((ch, spec))
            # A member's own overwrite is kept by the build, so it is not a
            # difference either.
            plan = with_members(ch.overwrites, spec_overwrites(guild, spec, roles))
            for d in overwrite_diff(guild, ch.overwrites, plan):
                off('#%s, %s' % (want, d))
    for c in guild.channels:
        if isinstance(c, discord.CategoryChannel):
            continue
        cat = getattr(c, 'category', None)
        if (getattr(cat, 'name', None), c.name.lower()) in ours:
            continue
        where = getattr(cat, 'name', 'no category')
        if c.name.lower() in KEEP:
            # #staff-updates and the like: kept by name, never made by PLAN.
            line('#%s in %s is kept by name and not made by the plan' % (c.name, where))
        else:
            off('#%s in %s is not in the plan' % (c.name, where))

    # Every channel's description (#3317, Patrick, 23 Oct: "We also need to
    # go through and fix old descriptions"): the plan's, mentions and all,
    # and none naming a channel that is gone, the plan's or not.
    print('\n  Channel topics', flush=True)
    for ch, spec in topics:
        live = getattr(ch, 'topic', None) or ''
        want = topic_text(guild, spec) or ''
        if not spec.get('topic'):
            if live:
                off('#%s has a topic the plan does not set: "%s"' % (ch.name, live))
        elif live != want:
            off('#%s has the topic "%s"; the plan has "%s"' % (ch.name, live, want))
    for c in guild.channels:
        for i in gone_mentions(guild, getattr(c, 'topic', None)):
            off('#%s\'s topic names a channel that is gone (<#%d>, which Discord '
                'shows as #unknown)' % (c.name, i))

    # Every doc keeps its changelog (#3317), and the post links it (#3336).
    print('\n  Changelogs', flush=True)
    for ch, key in docs:
        for d in await changelog_drift(ch, key, getattr(me, "id", None)):
            off('#%s, %s' % (ch.name, d))

    # The sidebar's order (#3317, keep_order).
    moved = order_wanted(guild)
    if moved:
        off('%d categories and channels are out of the plan\'s order; a build '
            'puts them back' % len(moved))

    # What bot.env.json is written with (#3317): Install-Bot takes these as
    # they are, and nothing else on the server says a role's id.
    print('\n  Role ids, for bot.env.json', flush=True)
    for name, _, _, _ in ROLES:
        r = roles.get(name)
        if r is not None:
            line('%s: %s' % (name, r.id))
    for what, names in (('-StaffRoles', TICKET_STAFF), ('-UpperStaffRoles', COUNCIL_ROLES)):
        ids = [str(roles[n].id) for n in names if n in roles]
        gone = [n for n in names if n not in roles]
        line("Install-Bot %s '%s'%s" % (what, ','.join(ids),
             ('  (not on the server yet: ' + ', '.join(gone) + ')') if gone else ''))

    print('\n  %d difference(s). Nothing was changed.\n' % bad[0], flush=True)
    return bad[0]


# THE ORDER (#3317, Patrick, 22 Oct: "better organize where each category
# goes on the left side", and "each channel under every category is in an
# order that makes sense"; page card q-3317-discord-order). The sidebar is
# PLAN's order: its categories top to bottom, and each category's channels as
# they are listed there. Discord draws a category's text channels (forums and
# announcements with them) above its voice rooms whatever their positions, so
# each of the two is put in order among its own. A category or a channel the
# plan does not name keeps its place after the planned ones, in the order it
# had.

def _is_voice(ch):
    return getattr(ch, 'type', None) in (discord.ChannelType.voice,
                                         discord.ChannelType.stage_voice)


def _in_order(have, names, name_of):
    """have, sorted as Discord shows them, put in the order names gives, with
       anything names does not hold after, as it was."""
    rank = dict((n, i) for i, n in enumerate(names))
    planned = sorted((c for c in have if name_of(c) in rank), key=lambda c: rank[name_of(c)])
    return planned + [c for c in have if name_of(c) not in rank]


def order_wanted(guild):
    """[(category or channel, position)] for every place whose position has to
       change for the sidebar to be PLAN's order. Empty when it already is.
       A list of places is written whole when any one of them is out of
       place, positions 0 up, which is how Discord's own client sends it."""
    def shown(places):
        return sorted(places, key=lambda c: (c.position, c.id))

    moves = []
    cats = shown(guild.categories)
    want = _in_order(cats, [c for c, _ in PLAN if c], lambda c: c.name)
    if want != cats:
        moves += [(c, i) for i, c in enumerate(want)]
    for catname, specs in PLAN:
        cat = discord.utils.get(guild.categories, name=catname)
        if cat is None:
            continue
        mine = [ch for ch in guild.channels
                if not isinstance(ch, discord.CategoryChannel)
                and getattr(ch, 'category', None) == cat]
        names = [sp['name'] if sp['kind'] == 'voice' else sp['name'].lower().replace(' ', '-')
                 for sp in specs]
        for voice in (False, True):
            have = shown(ch for ch in mine if _is_voice(ch) == voice)
            want = _in_order(have, names, lambda ch: ch.name)
            if want != have:
                moves += [(ch, i) for i, ch in enumerate(want)]
    return moves


async def set_positions(guild, positions):
    """Every position in one request, the one Discord's client sends when a
       category is dragged. discord.py's own move() sends it per channel."""
    await guild._state.http.bulk_channel_update(
        guild.id, [{'id': p.id, 'position': n} for p, n in positions],
        reason='Thornswood setup, the order in the plan')


async def open_threads(guild):
    """{channel id: threads still open off it}, or None when Discord would
       not list them. A channel -Prune deletes takes its threads with it, and
       a ticket is a private thread, so one with any open is left (#3317)."""
    try:
        threads = await guild.active_threads()
    except discord.HTTPException as e:
        say('note', 'the open threads could not be listed (%s)' % refused(e))
        return None
    out = {}
    for t in threads:
        out[t.parent_id] = out.get(t.parent_id, 0) + 1
    return out


async def keep_order(guild):
    moves = order_wanted(guild)
    if not moves:
        return
    what = '%d categories and channels into the plan\'s order' % len(moves)
    if CHECK:
        say('would move', what)
        return
    try:
        await set_positions(guild, moves)
        say('moved', what)
    except discord.HTTPException as e:
        failed.append('the order was not set (%s)' % refused(e))


async def rename_category(guild, catname):
    """The category catname used to be (CATEGORY_WAS), renamed to it, so its
       channels and their ids stay where they are (#3317). Under -Check it is
       only said, and the old category is handed back so the rest of the
       check reads the channels in it."""
    for old in CATEGORY_WAS.get(catname, ()):
        cat = discord.utils.get(guild.categories, name=old)
        if cat is None:
            continue
        what = 'category %s becomes %s' % (old, catname)
        if CHECK:
            say('would rename', what)
            return cat
        try:
            await cat.edit(name=catname, reason='Thornswood setup, renamed by the plan')
            say('renamed', what)
            return cat
        except discord.HTTPException as e:
            failed.append('%s (%s)' % (what, refused(e)))
            return cat
    return None


@client.event
async def on_ready():
    try:
        guild = None
        if GUILD:
            guild = client.get_guild(int(GUILD))
        elif len(client.guilds) == 1:
            guild = client.guilds[0]
        if guild is None:
            print('\nThe bot is in more than one server. Say which:')
            for g in client.guilds:
                print('  %-40s %s' % (g.name, g.id))
            print('\n  $env:DISCORD_GUILD = "<that number>"')
            return await client.close()

        if AUDIT:
            await audit(guild)
            return

        if GIVE:
            await give(guild)
            return

        print('\n  Building %s\n' % guild.name)

        roles = await ensure_roles(guild)

        if ROLES_ONLY:
            # Nothing below this line runs: no category, no channel, no
            # post, no webhook, no guild setting. ensure_roles has already
            # made anything missing and put every role in its place, and
            # the tally below says which of those it did.
            say('roles only', 'nothing else was touched')
            print('')
            print('  made %d, already there %d' % (len(made), len(kept)))
            return await client.close()

        found = {}
        posts = []

        # Before any channel is gated, or Discord refuses the gate (see
        # ONBOARDING_WHY). Under ONLY no server setting changes, so it is
        # only said there.
        if not ONLY:
            await keep_onboarding_off(guild)
        elif await onboarding_on(guild) is True:
            say('note', "Discord's Onboarding is on, and a whole build switches it off")

        for catname, specs in plan_for(ONLY):
            cat = None
            if catname:
                cat_ow = category_overwrites(guild, catname, roles)
                cat = discord.utils.get(guild.categories, name=catname)
                if cat is None:
                    cat = await rename_category(guild, catname)
                if cat is None and ONLY and catname not in ONLY:
                    # Under ONLY a category is made only when it is named
                    # itself, never for a channel named inside it.
                    say('note', 'there is no ' + catname + ' category, and '
                        'only ' + catname + ' itself would make it')
                    continue
                if cat is None and CHECK:
                    # -Check makes nothing, a category included (#2519: the
                    # -Check of 22 Oct, 3:59 AM, made Gamemasters).
                    say('would make', 'category ' + catname)
                    # A channel with a was line is moved into the new
                    # category, not made: the -Check of 22 Oct said "would
                    # make" for the sixteen faction chats the build then
                    # moved with their history (#3317).
                    planned = types.SimpleNamespace(name=catname)
                    for spec in specs:
                        want = (spec['name'] if spec['kind'] == 'voice' else
                                spec['name'].lower().replace(' ', '-'))
                        if await bring_back(guild, planned, spec, want) is False:
                            continue
                        if spec.get('make', True):
                            say('would make', ('voice ' if spec['kind'] == 'voice' else '#') + want)
                    continue
                if cat is None:
                    cat = await guild.create_category(
                        catname, overwrites=cat_ow, reason='Thornswood setup')
                    made.append(catname)
                    say('category', catname)
                else:
                    kept.append(catname)
                    if not ONLY or catname in ONLY:
                        await keep_overwrites(cat, cat_ow, 'category ' + catname)
            done = []
            for spec in specs:
                ch = await ensure_channel(guild, cat, spec, roles, found)
                done.append(ch)
                if spec.get('post'):
                    posts.append((ch, spec['key']))
            # A channel somebody made by hand inside one of these categories
            # is shut to @everyone like the gate around it, and the bot only
            # saw it because of Administrator. The staff #news the site
            # watcher speaks in is one: bot.py says it sits in Staff, and the
            # plan does not name it. keep_bot only writes where @everyone is
            # shut out, so this keeps what the bot can see today and widens
            # nothing, and a channel open to everybody is left alone.
            if cat is not None and (not ONLY or catname in ONLY):
                for ch in list(getattr(cat, 'channels', None) or []):
                    if ch not in done:
                        await keep_bot(ch)

        if ONLY:
            # Nothing past the parts named: no prune list, no webhook, no
            # server setting, and no post but the named channels' own, and
            # those only under -Posts (#3656).
            if posts:
                print('')
                look_up(guild, found)
                await write_posts(posts, found)
            say('only', ', '.join(ONLY) + '. Nothing else was touched')
            print('\n  made %d, already there %d' % (len(made), len(kept)))
            if failed:
                print('\n  did not manage:')
                for f in failed:
                    print('    ' + f)
            print('')
            return

        await keep_order(guild)

        # ------------------------------------------------------- pruning --
        # Only inside the categories this script manages, and only names it
        # knows it does not want. Anything anybody added themselves survives.
        # By category and name (#3317): by name alone, a second #game-rules
        # left in In Character when the plan's moved to Roleplay Guide was
        # taken for the plan's and never listed.
        mine = set()
        for catname, specs in PLAN:
            for spec in specs:
                mine.add((catname, spec['name'].lower().replace(' ', '-')
                          if spec['kind'] != 'voice' else spec['name'].lower()))
        ours = set(c for c, _ in PLAN if c)

        extra = []
        for ch in list(guild.channels):
            if isinstance(ch, discord.CategoryChannel):
                continue
            cat = getattr(ch, 'category', None)
            name = ch.name.lower()
            if name in KEEP:
                continue
            retired = name in [r.lower().replace(' ', '-') for r in RETIRED] \
                      or ch.name in RETIRED
            inside = cat is not None and cat.name in ours
            if retired or (inside and (cat.name, name) not in mine):
                extra.append(ch)

        if extra:
            print('')
            if PRUNE:
                busy = await open_threads(guild)
                for ch in extra:
                    if busy is None:
                        failed.append('#%s was not removed: Discord would not say which '
                                      'threads are open, and an open ticket would go '
                                      'with it' % ch.name)
                        continue
                    if busy.get(ch.id):
                        say('left', '#%s: %d thread(s) still open in it; it goes once '
                            'they are closed' % (ch.name, busy[ch.id]))
                        continue
                    if CHECK:
                        say('would remove', '#' + ch.name)
                        continue
                    try:
                        await ch.delete(reason='Thornswood setup, no longer in the plan')
                        say('removed', '#' + ch.name)
                    except Exception:
                        failed.append('could not remove #' + ch.name)
            else:
                say('note', 'these are not in the plan any more:')
                for ch in extra:
                    print('             #' + ch.name)
                print('             -Prune is what deletes them, and a channel')
                print('             somebody is using belongs in the plan')
                print('             instead. Ask in #staff-updates first.')

        # A category the plan emptied (RETIRED_CATEGORIES), once nothing is
        # left in it. One that still holds a channel is said and left, so
        # nothing in it goes with it.
        for name in RETIRED_CATEGORIES:
            cat = discord.utils.get(guild.categories, name=name)
            if cat is None:
                continue
            inside = [c for c in guild.channels
                      if getattr(c, 'category', None) == cat]
            if inside:
                say('note', 'category %s is retired and still holds %s; '
                    'it goes once it is empty' % (name, ', '.join('#' + c.name for c in inside)))
            elif not PRUNE:
                say('note', 'category %s is empty and retired. -Prune removes it' % name)
            elif CHECK:
                say('would remove', 'category ' + name)
            else:
                try:
                    await cat.delete(reason='Thornswood setup, retired by the plan')
                    say('removed', 'category ' + name)
                except discord.HTTPException as e:
                    failed.append('could not remove category %s (%s)' % (name, refused(e)))

        print('')
        await write_posts(posts, found)

        # A webhook in news, so a release can announce itself without the bot
        # having to be running.
        news = found.get('NEWS')
        if news is not None:
            try:
                hooks = await news.webhooks()
                hook = discord.utils.get(hooks, name='Thornswood')
                if CHECK:
                    # Neither made nor written down: -Check changes nothing,
                    # a file beside the code included (#2519).
                    if hook is None:
                        say('would make', 'the news webhook in #' + news.name)
                    else:
                        say('left alone', 'the news webhook in #' + news.name)
                else:
                    if hook is None:
                        hook = await news.create_webhook(name='Thornswood')
                        say('webhook', 'made one in #' + news.name)
                    with open(WEBHOOK_OUT, 'w', encoding='utf-8') as f:
                        f.write(hook.url)
                    say('webhook', 'saved to ' + os.path.basename(WEBHOOK_OUT))
            except discord.Forbidden:
                failed.append('the news webhook (no permission)')

        await apply_welcome_and_afk(guild, found)
        await apply_notice_channels(guild)

        print('\n  made %d, already there %d' % (len(made), len(kept)))
        if failed:
            print('\n  did not manage:')
            for f in failed:
                print('    ' + f)
        print('')
        feats = set(getattr(guild, 'features', []) or [])
        if 'COMMUNITY' not in feats:
            print('  Server Settings, Enable Community, then run this again.')
            print('  Until then the forums are text channels and #news cannot')
            print('  be an announcement channel.')
        else:
            if guild.rules_channel is None:
                print('  Community then Safety Setup: point the rules screen')
                print('  at #rules. Nothing makes people accept them until you do.')
            if not PRUNE:
                print('  Nothing was deleted. -Prune is what deletes, and it')
                print('  goes through #staff-updates before anybody runs it.')
        print('')
    except Exception as e:
        print('\n  stopped: %r' % (e,))
    finally:
        await client.close()


if __name__ == '__main__' and '--layout' in sys.argv:
    with open(LAYOUT_FILE, 'w', encoding='utf-8', newline='\n') as f:
        f.write(layout())
    print('wrote ' + os.path.normpath(LAYOUT_FILE))
    sys.exit(0)

if __name__ == '__main__':
    _bad = check_docs()
    if _bad and not AUDIT:
        sys.exit('A doc has words with no change line, or a line a public post '
                 'never says, so nothing was asked of Discord (#3317, #3656):\n  '
                 + '\n  '.join(_bad))
    try:
        plan_for(ONLY)
    except ValueError as e:
        sys.exit('DISCORD_ONLY: ' + str(e) + '. Nothing was asked of Discord.')
    _bad = ['%s=%s' % g for g in GIVE if g[0] not in STAFF or not g[1]]
    if _bad:
        sys.exit('DISCORD_GIVE takes "staff rank=member" pairs, and these are not: ' +
                 ', '.join(_bad) + '. The staff ranks are ' + ', '.join(STAFF) +
                 '. Nothing was asked of Discord.')
    if not TOKEN:
        sys.exit('No token. Set DISCORD_TOKEN first, or run Setup-Discord.ps1.')
    try:
        client.run(TOKEN, log_handler=None)
        if GIVE and failed:
            sys.exit(1)
    except discord.LoginFailure:
        sys.exit('Discord refused that token.')
    except discord.PrivilegedIntentsRequired:
        sys.exit('Discord refused the intents. Under Bot in the developer '
                 'portal, "Server Members Intent" must be ON. Check the token '
                 'belongs to that same application.')
