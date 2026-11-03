"""
The hold panel and the ping roles.

Part of the bot: bot.py loads it (#5357).
"""
import os
import traceback

import discord

from bot_core import (STAFF_IDS, STAFF_NAMES, _role_tokens, _who_hits, by_name,
    client, log)


# #choose-your-hold, where a Member picks the hold their character calls home
# and which announcements they want a ping for.
#
# The hold channels are private: each hold's category is open to its own
# Citizen, Jarl and officers and to staff, so picking a hold here is what
# opens it. One
# hold per person. Picking another takes the old Citizen role away, and
# pressing the one you already have leaves it. Jarl roles are never touched
# here; a Jarl is appointed, not picked.
#
# Only somebody with the Member role, or a staff role, can use it. The channel
# is hidden from everybody else already, and this is the second lock, so a
# button reached some other way still does nothing for somebody not yet in.
#
# The two ping roles are made if they are missing, and made not mentionable,
# so only staff who can already mention everyone can ping them.
HOLD_CHANNEL = [n.strip().lower() for n in
                os.environ.get('HOLD_CHANNEL', 'choose-your-hold').split(',')
                if n.strip()]
MEMBER_ROLE = os.environ.get('MEMBER_ROLE', 'Member').strip().lower()
MEMBER_IDS, MEMBER_NAMES = _role_tokens([MEMBER_ROLE] if MEMBER_ROLE else [])
# Raven Rock is a hold like the nine since #3317 (Patrick, 22 Oct, page card
# q-3317-raven-rock, A), last, on a row of its own on the panel.
HOLDS = ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth',
         'Dawnstar', 'Morthal', 'Falkreath', 'Winterhold', 'Raven Rock']
# The towns a hold role can name: every hold, Raven Rock included.
OFFICE_TOWNS = list(HOLDS)
# key, role name, button label
PINGS = [('news', 'News Pings', 'News pings'),
         ('updates', 'Updates Pings', 'Updates pings')]

HOLD_PANEL = ('**Choose your hold**\n\n'
              'Pick the hold your character calls home and its channels open '
              'to you. One hold at a time: picking another moves you there, '
              'and pressing the one you have leaves it.\n\n'
              '**Pings**\n\n'
              'News pings you when a release goes out in #news. Updates pings '
              'you for restarts and notices in #updates. Press either again '
              'to stop.')


def _citizen(hold):
    return 'Citizen of ' + hold


def _role(guild, name):
    want = name.lower()
    for r in guild.roles:
        if r.name.lower() == want:
            return r
    return None


def _may_pick(member):
    return (_who_hits(member, MEMBER_IDS, MEMBER_NAMES)
            or _who_hits(member, STAFF_IDS, STAFF_NAMES))


def _can_give(guild, role):
    """
    Discord refuses a role at or above the bot's own highest role with a
    Forbidden and nothing else, so it is checked first and said in words.
    """
    me = guild.me
    return bool(me.guild_permissions.manage_roles) and role < me.top_role


async def _say(interaction, text):
    await interaction.response.send_message(text, ephemeral=True)


async def pick_hold(interaction, hold):
    guild, who = interaction.guild, interaction.user
    if guild is None or not _may_pick(who):
        await _say(interaction, 'Holds open once your application is approved '
                                'and you have the Member role.')
        return
    role = _role(guild, _citizen(hold))
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % _citizen(hold))
        await _say(interaction, 'That hold cannot be given out right now. Ask '
                                'staff to give it to you.')
        return
    try:
        if role in who.roles:
            await who.remove_roles(role, reason='Left their hold in #choose-your-hold')
            await _say(interaction, 'You are no longer a citizen of %s.' % hold)
            return
        old = [r for r in who.roles
               if r.name.lower().startswith('citizen of ') and r != role
               and _can_give(guild, r)]
        if old:
            await who.remove_roles(*old, reason='Moved hold in #choose-your-hold')
        await who.add_roles(role, reason='Picked in #choose-your-hold')
        said = 'You are now a citizen of %s. Its channel is open to you.' % hold
        if old:
            said += ' You are no longer a citizen of %s.' % ', '.join(
                r.name[len('Citizen of '):] for r in old)
        await _say(interaction, said)
    except Exception:
        log('hold pick failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')


async def toggle_ping(interaction, name):
    guild, who = interaction.guild, interaction.user
    if guild is None or not _may_pick(who):
        await _say(interaction, 'Pings open once your application is approved '
                                'and you have the Member role.')
        return
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'Pings cannot be changed right now. Ask staff.')
        return
    try:
        if role in who.roles:
            await who.remove_roles(role, reason='Turned off in #choose-your-hold')
            await _say(interaction, '%s off.' % name)
        else:
            await who.add_roles(role, reason='Turned on in #choose-your-hold')
            await _say(interaction, '%s on.' % name)
    except Exception:
        log('ping toggle failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')


class HoldButton(discord.ui.Button):
    def __init__(self, hold, row):
        super().__init__(label=hold, style=discord.ButtonStyle.secondary,
                         custom_id='thornswood:hold:' + hold.lower(), row=row)
        self.hold = hold

    async def callback(self, interaction):
        await pick_hold(interaction, self.hold)


# THE PANEL'S ROWS (#3317, Patrick, 22 Oct: "These button layouts also need
# fixed"). Five holds to a row wrapped on a phone, four and then Markarth on
# its own, three and then Winterhold on its own. Three to a row fits a phone
# and reads as a block on a desktop: nine holds in three rows of three, and
# the two pings in a row of their own under them.
HOLDS_PER_ROW = 3


class PingButton(discord.ui.Button):
    def __init__(self, key, name, label):
        super().__init__(label=label, style=discord.ButtonStyle.primary,
                         custom_id='thornswood:ping:' + key,
                         row=-(-len(HOLDS) // HOLDS_PER_ROW))
        self.role_name = name

    async def callback(self, interaction):
        await toggle_ping(interaction, self.role_name)


class HoldPanel(discord.ui.View):
    """Persistent, like the ticket panel, so the buttons outlive a restart."""
    def __init__(self):
        super().__init__(timeout=None)
        for i, hold in enumerate(HOLDS):
            self.add_item(HoldButton(hold, i // HOLDS_PER_ROW))
        for key, name, label in PINGS:
            self.add_item(PingButton(key, name, label))


def _hold_ids_wanted():
    return (['thornswood:hold:' + h.lower() for h in HOLDS] +
            ['thornswood:ping:' + k for k, _, _ in PINGS])


def _hold_rows_wanted():
    """The panel's buttons by row, as Discord gives a posted message back."""
    ids = ['thornswood:hold:' + h.lower() for h in HOLDS]
    return ([ids[i:i + HOLDS_PER_ROW] for i in range(0, len(ids), HOLDS_PER_ROW)] +
            [['thornswood:ping:' + k for k, _, _ in PINGS]])


def _rows(msg):
    """A posted message's buttons by row, so a panel laid out differently
       is not taken for current because its buttons are the same."""
    try:
        return [[getattr(item, 'custom_id', '') for item in getattr(row, 'children', None) or []]
                for row in getattr(msg, 'components', None) or []]
    except Exception:
        return []


def _hold_ids(msg):
    ids = []
    try:
        for row in getattr(msg, 'components', None) or []:
            for item in getattr(row, 'children', None) or []:
                ids.append(getattr(item, 'custom_id', ''))
    except Exception:
        return []
    return ids


def hold_panel_is_current(msg):
    return (getattr(msg, 'content', None) == HOLD_PANEL and
            _rows(msg) == _hold_rows_wanted())


async def ensure_hold_panel(guild):
    ch = by_name(guild, HOLD_CHANNEL)
    if ch is None:
        log('there is no #%s in "%s", so there is no hold panel. Set '
            'HOLD_CHANNEL in bot.env.json to the right channel.'
            % (HOLD_CHANNEL[0], guild.name))
        return

    missing = [_citizen(h) for h in HOLDS if _role(guild, _citizen(h)) is None]
    if missing:
        log('these hold roles are missing, so those buttons will say so: %s'
            % ', '.join(missing))

    for _, name, _ in PINGS:
        if _role(guild, name) is not None:
            continue
        if not guild.me.guild_permissions.manage_roles:
            log('there is no %s role and the bot cannot make one without '
                'Manage Roles.' % name)
            continue
        try:
            await guild.create_role(name=name, mentionable=False,
                                    reason='Ping role for #choose-your-hold')
            log('made the %s role' % name)
        except Exception:
            log('could not make %s:\n' % name + traceback.format_exc())

    try:
        async for m in ch.history(limit=30):
            # Its own message, by its buttons: the office panel (#2551) is
            # the bot's too, in the same channel, and must not be written over.
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:hold:') for i in _hold_ids(m))):
                if hold_panel_is_current(m):
                    log('hold panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=HOLD_PANEL, view=HoldPanel())
                log('hold panel updated in #%s' % ch.name)
                return
        await ch.send(HOLD_PANEL, view=HoldPanel())
        log('hold panel posted in #%s' % ch.name)
    except Exception:
        log('hold panel failed:\n' + traceback.format_exc())
