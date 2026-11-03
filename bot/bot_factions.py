"""
A faction Leader's members and officers.

Part of the bot: bot.py loads it (#5357).
"""
import traceback

import discord

from bot_core import by_name, client, log
from bot_holds import _can_give, _hold_ids, _role, _say
from bot_tickets import FACTION_SHORT, faction_leader_role, faction_names


# #3317. Patrick, 22 Oct, page card q-3317-faction-member-give, A: a
# faction's Leader gives and takes its member role from a bot panel. The
# member role is the faction's short name ("Thalmor", "Companions"), made by
# Build-Discord.py with its "<short name> Leader" role, and the Leader is
# whoever holds that role. Like a Jarl's offices: their own faction only, and
# when two accounts hold one Leader role neither acts until staff take it
# from all but one.
#
# Patrick, 22 Oct, later: "seats should be in a different channel like how
# the holds have the add member add court add a steward so one for each
# faction in it's category", and on page card q-3317-faction-category, C:
# "One Officer role, not Court and Steward". So each faction has its own
# category, and in it its own seats channel with this panel: Add and Remove
# for its members and its Officers ("<short> Officer"). The faction is the
# channel's. The shared #seats it was in until then is retired; its old panel
# says where the panels went until -Prune deletes it.
#
# A change goes in bot.log and in Discord's audit log with its reason; it is
# not said to staff, because staff have nothing to do about it (Patrick,
# 22 Oct: #staff-updates only when staff must act).
FACTION_OFFICES = [('member', 'member'), ('officer', 'Officer')]
FACTION_LABELS = {
    'member': ('Add member', 'Remove member'),
    'officer': ('Add Officer', 'Remove Officer'),
}
# The one shared panel of before, in #seats.
OLD_FACTION_PANEL_CHANNEL = ['seats']


def faction_slug(faction):
    """A faction's channel name: its short name, lower case, hyphens, as
       Build-Discord.py names its channels."""
    return FACTION_SHORT.get(faction, faction).lower().replace(' ', '-')


def faction_seats(faction):
    """The channel a faction's panel is in: "#companions-seats"."""
    return faction_slug(faction) + '-seats'


def faction_role(office, faction):
    """A faction's role for an office, as Build-Discord.py makes it."""
    short = FACTION_SHORT.get(faction, faction)
    if office == 'officer':
        return short + ' Officer'
    return short


def faction_member_role(faction):
    """The member role of a named faction: "Thalmor"."""
    return faction_role('member', faction)


def faction_of_channel(ch):
    """The faction whose seats channel this is, or None."""
    name = (getattr(ch, 'name', '') or '').lower()
    for f in faction_names():
        if faction_seats(f) == name:
            return f
    return None


def faction_panel_text(faction):
    return ('**%s: seats**\n\n'
            'The Leader of %s gives and takes its roles here: its members and '
            'its Officers. Press a button, then pick the person. Only the '
            'Leader can use them. An Officer is a member first, and taking '
            'somebody\'s membership takes their Officer role with it.'
            % (faction, faction))


def led_factions(member):
    """The named factions this member leads, by their own Leader roles."""
    held = set(getattr(r, 'name', '') for r in list(getattr(member, 'roles', None) or []))
    return [f for f in faction_names() if faction_leader_role(f) in held]


def leader_held_twice(guild, faction):
    """True when more than one account holds this faction's Leader role."""
    lead = _role(guild, faction_leader_role(faction))
    return lead is not None and len(list(getattr(lead, 'members', None) or [])) > 1


LEADER_TWICE = ('Two accounts hold the %s role, so neither acts as its Leader '
                'until staff take it from all but one.')


async def faction_press(interaction, add, office='member'):
    """A button on a faction's panel: that faction's, by the channel it is
       in, for its Leader only. Off a seats channel (the old shared panel),
       the presser's own faction, asked which when they lead two."""
    guild, who = interaction.guild, interaction.user
    led = led_factions(who) if guild is not None else []
    here = faction_of_channel(getattr(interaction, 'channel', None))
    if here is not None:
        if here not in led:
            await _say(interaction, 'Only the Leader of %s uses these buttons.' % here)
            return
        await faction_for(interaction, here, add, office)
        return
    if not led:
        await _say(interaction, 'Only the Leader of a faction gives its member '
                                'role. A Leader is whoever holds that faction\'s '
                                'Leader role.')
        return
    if len(led) > 1:
        await interaction.response.send_message(
            'You lead more than one faction. Which one?',
            view=FactionPick(add, led, office), ephemeral=True)
        return
    await faction_for(interaction, led[0], add, office)


def _faction_ask(faction, office):
    if office == 'officer':
        return 'Who becomes an Officer of %s?' % faction
    return 'Who joins %s?' % faction


async def faction_for(interaction, faction, add, office='member'):
    """The picker for one faction and office: a person to give the role, or a
       holder to take it from."""
    guild = interaction.guild
    if leader_held_twice(guild, faction):
        await _say(interaction, LEADER_TWICE % faction_leader_role(faction))
        return
    name = faction_role(office, faction)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if add:
        await interaction.response.send_message(
            _faction_ask(faction, office), view=FactionGive(faction, office), ephemeral=True)
        return
    holders = [m for m in list(getattr(role, 'members', None) or [])
               if not getattr(m, 'bot', False)]
    if not holders:
        await _say(interaction, 'Nobody holds the %s role.' % name)
        return
    await interaction.response.send_message(
        'Take the %s role from whom?' % name,
        view=FactionTake(faction, holders[:25], office), ephemeral=True)


async def faction_change(interaction, faction, member, add, office='member'):
    """
    Give or take one of the faction's roles, with every rule asked again at
    the moment of the change: the presser still holds the faction's Leader
    role, nobody else does, and the role is one the bot may give. The
    Officer role goes only to a member, and taking the member role takes it
    with it.
    """
    guild, who = interaction.guild, interaction.user
    if guild is None or faction not in led_factions(who):
        await _say(interaction, 'Only the Leader of %s gives its %s.' % (
            faction, 'member role' if office == 'member' else 'roles'))
        return
    if leader_held_twice(guild, faction):
        await _say(interaction, LEADER_TWICE % faction_leader_role(faction))
        return
    name = faction_role(office, faction)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if member is None or not hasattr(member, 'roles'):
        await _say(interaction, 'That person is not in this Discord.')
        return
    if getattr(member, 'bot', False):
        await _say(interaction, 'A bot joins no faction.')
        return
    shown = getattr(member, 'display_name', None) or str(member)
    has = role in member.roles
    if add and has:
        await _say(interaction, '%s already holds the %s role.' % (shown, name))
        return
    if not add and not has:
        await _say(interaction, '%s does not hold the %s role.' % (shown, name))
        return
    if add and office != 'member':
        joined = _role(guild, faction_member_role(faction))
        if joined is None or joined not in member.roles:
            await _say(interaction, '%s is not a member of %s. Add them as a '
                                    'member first.' % (shown, faction))
            return
    by = getattr(who, 'display_name', None) or str(who)
    reason = '%s by %s, Leader of %s, on the faction panel' % (
        'Given' if add else 'Taken', by, faction)
    # Leaving the faction leaves its offices too.
    also = []
    if not add and office == 'member':
        also = [r for r in (_role(guild, faction_role(o, faction))
                            for o, _ in FACTION_OFFICES if o != 'member')
                if r is not None and r in member.roles]
    try:
        if add:
            await member.add_roles(role, reason=reason)
        else:
            for r in [role] + also:
                await member.remove_roles(r, reason=reason)
    except Exception:
        log('faction change failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')
        return
    log('faction: %s (%s), Leader of %s, %s %s (%s) the %s role'
        % (by, who.id, faction, 'gave' if add else 'took from', shown, member.id,
           ', '.join([name] + [r.name for r in also])))
    if add:
        said = '%s holds the %s role now.' % (shown, name)
    elif also:
        said = '%s no longer holds the %s role, nor %s.' % (
            shown, name, ' or '.join(r.name for r in also))
    else:
        said = '%s no longer holds the %s role.' % (shown, name)
    await _say(interaction, said)


class FactionButton(discord.ui.Button):
    def __init__(self, add, office='member', row=None):
        add_label, remove_label = FACTION_LABELS[office]
        # The member buttons keep the custom_id the one shared panel had.
        tail = '' if office == 'member' else ':' + office
        super().__init__(label=add_label if add else remove_label,
                         style=(discord.ButtonStyle.primary if add
                                else discord.ButtonStyle.secondary),
                         custom_id='thornswood:faction:%s%s' % ('add' if add else 'remove', tail),
                         row=row)
        self.add = add
        self.office = office

    async def callback(self, interaction):
        await faction_press(interaction, self.add, self.office)


class FactionPanel(discord.ui.View):
    """Persistent, like the office panel: Add and Remove for each of the
       faction's roles, a row each. The same buttons in every faction's seats
       channel; the channel says which faction."""
    def __init__(self):
        super().__init__(timeout=None)
        for row, (office, _label) in enumerate(FACTION_OFFICES):
            self.add_item(FactionButton(True, office, row))
            self.add_item(FactionButton(False, office, row))


class FactionPickSelect(discord.ui.Select):
    def __init__(self, add, factions, office='member'):
        super().__init__(placeholder='The faction',
                         options=[discord.SelectOption(label=f[:100], value=f) for f in factions[:25]])
        self.add = add
        self.office = office

    async def callback(self, interaction):
        await faction_for(interaction, self.values[0], self.add, self.office)


class FactionPick(discord.ui.View):
    def __init__(self, add, factions, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionPickSelect(add, factions, office))


class FactionGiveSelect(discord.ui.UserSelect):
    def __init__(self, faction, office='member'):
        super().__init__(placeholder='The person', min_values=1, max_values=1)
        self.faction = faction
        self.office = office

    async def callback(self, interaction):
        picked = self.values[0] if self.values else None
        member = picked if hasattr(picked, 'roles') else (
            interaction.guild.get_member(getattr(picked, 'id', 0)) if interaction.guild else None)
        await faction_change(interaction, self.faction, member, True, self.office)


class FactionGive(discord.ui.View):
    def __init__(self, faction, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionGiveSelect(faction, office))


class FactionTakeSelect(discord.ui.Select):
    def __init__(self, faction, holders, office='member'):
        super().__init__(placeholder='The person', options=[
            discord.SelectOption(label=(getattr(m, 'display_name', None) or str(m))[:100],
                                 value=str(m.id)) for m in holders])
        self.faction = faction
        self.office = office

    async def callback(self, interaction):
        try:
            mid = int(self.values[0])
        except (TypeError, ValueError, IndexError):
            mid = 0
        member = interaction.guild.get_member(mid) if interaction.guild else None
        await faction_change(interaction, self.faction, member, False, self.office)


class FactionTake(discord.ui.View):
    def __init__(self, faction, holders, office='member'):
        super().__init__(timeout=180)
        self.add_item(FactionTakeSelect(faction, holders, office))


def faction_panel_ids():
    return [b.custom_id for b in FactionPanel().children]


def faction_panel_is_current(msg, faction):
    return (getattr(msg, 'content', None) == faction_panel_text(faction) and
            _hold_ids(msg) == faction_panel_ids())


FACTION_MOVED_HEAD = '**Faction panels have moved**'


async def ensure_faction_panel(guild):
    """Each faction's panel in its own seats channel, found again by its own
       buttons; the old shared one in #seats told where they went."""
    missing = [faction_role(o, f) for f in faction_names() for o, _ in FACTION_OFFICES
               if _role(guild, faction_role(o, f)) is None]
    if missing:
        log('these faction roles are missing, so they cannot be given until '
            'Build-Discord.py makes them: %s' % ', '.join(missing))
    here = []
    nowhere = []
    for f in faction_names():
        ch = by_name(guild, [faction_seats(f)])
        if ch is None:
            nowhere.append(faction_seats(f))
            continue
        here.append(ch)
        await _faction_panel_in(ch, f)
    if nowhere:
        log('no #%s yet, so those factions\' panels wait for Build-Discord.py '
            'to make them' % ', #'.join(nowhere))
    old = by_name(guild, OLD_FACTION_PANEL_CHANNEL)
    if old is not None and here:
        await _old_faction_panel(old, here)


async def _faction_panel_in(ch, faction):
    text = faction_panel_text(faction)
    try:
        async for m in ch.history(limit=30):
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:faction:') for i in _hold_ids(m))):
                if faction_panel_is_current(m, faction):
                    log('faction panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=text, view=FactionPanel())
                log('faction panel updated in #%s' % ch.name)
                return
        await ch.send(text, view=FactionPanel())
        log('faction panel posted in #%s' % ch.name)
    except Exception:
        log('faction panel failed in #%s:\n' % ch.name + traceback.format_exc())


async def _old_faction_panel(old, here):
    text = (FACTION_MOVED_HEAD + '\n\nEach faction has its own seats channel '
            'now, in its own category, with its Leader\'s buttons for its '
            'members and its Officers.')
    try:
        async for m in old.history(limit=30):
            if m.author.id != client.user.id:
                continue
            if m.content == text and not m.components:
                return
            if (m.components and any(i.startswith('thornswood:faction:') for i in _hold_ids(m))) \
                    or (m.content or '').startswith(FACTION_MOVED_HEAD):
                await m.edit(content=text, view=None)
                log('the old faction panel in #%s now says where the panels went' % old.name)
                return
    except Exception:
        log('the old faction panel in #%s could not be changed:\n' % old.name
            + traceback.format_exc())
