"""
A Jarl's hold offices.

Part of the bot: bot.py loads it (#5357).
"""
import traceback

import discord

from bot_core import as_typed, by_name, client, log
from bot_holds import (HOLDS, HOLD_CHANNEL, OFFICE_TOWNS, _can_give, _hold_ids,
    _role, _say)
from bot_reports import report_say


# #2551. Patrick, 15 Oct: each hold has a Court, a Steward and Guards, and
# they are Discord roles ("<Hold> Court", "Steward of <Hold>", "Guard of
# <Hold>", made by Build-Discord.py and never hoisted). That hold's Jarl gives
# and takes them, two ways, for their own hold only: here, with Add and Remove
# buttons, and in the game on the Office page of K, where the site sets the
# same roles with this bot's token. The role is the one truth either way, so
# nothing here or in the game keeps a list of who holds what.
#
# A Jarl is whoever holds that hold's "Jarl of <Hold>" role. If two accounts
# hold the same one, neither acts as Jarl here until staff take it from all
# but one (Patrick, 15 Oct); the site tells staff which accounts, through the
# staff log, the moment it sees it.
#
# The panel is a second message in #choose-your-hold, under the hold panel,
# found again by its own buttons. Every change is said in the staff channel
# (report_say), with who changed what, and Discord's audit log keeps it with
# the reason. Changes made in the game come to the staff channel the same way,
# through the site's moderation.log (watch_moderation, office_text).
OFFICES = [('court', 'Court'), ('steward', 'Steward'), ('guard', 'Guard')]
OFFICE_PANEL = ('**Hold offices**\n\n'
                'The Jarl of a hold gives and takes its Court, its Steward and '
                'its Guards here, for their own hold only. Press Add or Remove '
                'beside the office, then pick the person. The roles are the '
                'same ones the game reads, and a Jarl can change them there '
                'too, on the Office page of K. In the game the office is held '
                'by one character: the one the Jarl named there, or the one '
                'its holder chooses on the Office page of K. Every change is '
                'said to staff.')


def office_role(office, town):
    """The role's exact name, as Build-Discord.py makes it and the site reads it."""
    if office == 'court':
        return town + ' Court'
    if office == 'steward':
        return 'Steward of ' + town
    if office == 'guard':
        return 'Guard of ' + town
    return ''


def jarl_towns(member):
    """The towns this member is Jarl of, by their own Jarl of <Hold> roles."""
    out = []
    for r in list(getattr(member, 'roles', None) or []):
        name = getattr(r, 'name', '')
        if name.startswith('Jarl of ') and name[len('Jarl of '):] in OFFICE_TOWNS:
            out.append(name[len('Jarl of '):])
    return out


def jarl_held_twice(guild, town):
    """True when more than one account holds this hold's Jarl role."""
    jarl = _role(guild, 'Jarl of ' + town)
    return jarl is not None and len(list(getattr(jarl, 'members', None) or [])) > 1


def office_text(row):
    """
    One office line for the staff channel, from the site's moderation.log or
    from the panel here: a Jarl's change (office), two accounts holding one
    hold's Jarl role (jarlclash), and that ending (jarlclear). Names were
    typed by people, so they are escaped. None for a row that is not one.
    """
    if not isinstance(row, dict):
        return None
    clean = as_typed
    did = row.get('did')
    if did == 'jarlclash':
        people = [p for p in (row.get('people') or []) if isinstance(p, dict)]
        named = ', '.join('%s (account %s)' % (clean(p.get('name'), 40) or 'somebody',
                                               clean(p.get('id'), 24) or '?')
                          for p in people[:10])
        return ('**Two Jarls of one hold:** %d accounts hold the %s role: %s. '
                'Neither acts as Jarl, in the game or on the office panel, '
                'until staff take the role from all but one.'
                % (len(people), clean(row.get('role'), 40) or 'Jarl', named))[:1900]
    if did == 'jarlclear':
        return ('**One Jarl again:** one account or none holds the %s role now, '
                'so whoever holds it acts as Jarl again.'
                % (clean(row.get('role'), 40) or 'Jarl'))[:1900]
    if did != 'office':
        return None

    def person(name, pid):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            pid = 0
        if pid <= 0:
            return clean(name, 40) or 'somebody'
        return '%s (profile %d)' % (clean(name, 40) or 'somebody', pid)

    hold = clean(row.get('hold'), 20)
    town = hold
    for t in OFFICE_TOWNS:
        if t.lower().replace(' ', '') == hold:
            town = t
    where = {'panel': 'on the office panel', 'dev': 'in the game, on the dev server',
             'main': 'in the game'}.get(row.get('from'), 'in the game')
    role = clean(row.get('role'), 40) or 'an office'
    jarl = person(row.get('byName'), row.get('by'))
    them = person(row.get('whoName'), row.get('who'))
    if row.get('give'):
        did_text = 'gave %s the %s role' % (them, role)
    else:
        did_text = 'took the %s role from %s' % (role, them)
    return ('**Hold office:** %s, Jarl of %s, %s, %s.'
            % (jarl, town, did_text, where))[:1900]


async def office_press(interaction, office, add):
    """Add or Remove beside one office: works out the presser's hold first."""
    guild, who = interaction.guild, interaction.user
    towns = jarl_towns(who) if guild is not None else []
    if not towns:
        await _say(interaction, 'Only the Jarl of a hold gives its offices. A Jarl '
                                'is whoever holds that hold\'s Jarl role.')
        return
    if len(towns) > 1:
        await interaction.response.send_message(
            'You hold more than one Jarl role. Which hold?',
            view=OfficeTownPick(office, add, towns), ephemeral=True)
        return
    await office_for(interaction, office, add, towns[0])


async def office_for(interaction, office, add, town):
    """The picker for one office of one hold: a member to give it, or a holder to take it from."""
    guild = interaction.guild
    if jarl_held_twice(guild, town):
        await _say(interaction, 'Two accounts hold the Jarl of %s role, so neither '
                                'acts as Jarl until staff fix it. Staff have been '
                                'told.' % town)
        return
    name = office_role(office, town)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if add:
        await interaction.response.send_message(
            'Who gets the %s role?' % name, view=OfficeGive(office, town), ephemeral=True)
        return
    holders = [m for m in list(getattr(role, 'members', None) or [])
               if not getattr(m, 'bot', False)]
    if not holders:
        await _say(interaction, 'Nobody holds the %s role.' % name)
        return
    await interaction.response.send_message(
        'Take the %s role from whom?' % name,
        view=OfficeTake(office, town, holders[:25]), ephemeral=True)


async def office_change(interaction, office, town, member, add):
    """
    Give or take the role, with every rule asked again at the moment of the
    change: the presser still holds that hold's Jarl role, nobody else does,
    and the role is one the bot may give. Said to the Jarl, in bot.log and in
    the staff channel, and the reason goes in Discord's audit log.
    """
    guild, who = interaction.guild, interaction.user
    if guild is None or town not in jarl_towns(who):
        await _say(interaction, 'Only the Jarl of %s gives its offices.' % town)
        return
    if jarl_held_twice(guild, town):
        await _say(interaction, 'Two accounts hold the Jarl of %s role, so neither '
                                'acts as Jarl until staff fix it. Staff have been '
                                'told.' % town)
        return
    name = office_role(office, town)
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        await _say(interaction, 'The %s role cannot be given out right now. Ask '
                                'staff.' % name)
        return
    if member is None or not hasattr(member, 'roles'):
        await _say(interaction, 'That person is not in this Discord.')
        return
    if getattr(member, 'bot', False):
        await _say(interaction, 'A bot holds no office.')
        return
    shown = getattr(member, 'display_name', None) or str(member)
    has = role in member.roles
    if add and has:
        await _say(interaction, '%s already holds the %s role.' % (shown, name))
        return
    if not add and not has:
        await _say(interaction, '%s does not hold the %s role.' % (shown, name))
        return
    by = getattr(who, 'display_name', None) or str(who)
    reason = '%s by %s, Jarl of %s, on the office panel' % ('Given' if add else 'Taken', by, town)
    try:
        if add:
            await member.add_roles(role, reason=reason)
        else:
            await member.remove_roles(role, reason=reason)
    except Exception:
        log('office change failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')
        return
    log('office: %s (%s), Jarl of %s, %s %s (%s) the %s role'
        % (by, who.id, town, 'gave' if add else 'took from', shown, member.id, name))
    await _say(interaction, ('%s holds the %s role now. In the game they choose which '
                             'character holds it, on the Office page of K.' if add
                             else '%s no longer holds the %s role.') % (shown, name))
    await report_say(office_text({
        'did': 'office', 'from': 'panel', 'give': bool(add), 'office': office,
        'hold': town.lower().replace(' ', ''), 'role': name,
        'byName': by, 'whoName': shown}))


class OfficeButton(discord.ui.Button):
    def __init__(self, office, label, add, row):
        super().__init__(label=('Add ' if add else 'Remove ') + label,
                         style=(discord.ButtonStyle.primary if add
                                else discord.ButtonStyle.secondary),
                         custom_id='thornswood:office:%s:%s' % ('add' if add else 'remove', office),
                         row=row)
        self.office = office
        self.add = add

    async def callback(self, interaction):
        await office_press(interaction, self.office, self.add)


class OfficePanel(discord.ui.View):
    """Persistent, like the hold panel: Add and Remove for each of the three offices."""
    def __init__(self):
        super().__init__(timeout=None)
        for i, (office, label) in enumerate(OFFICES):
            self.add_item(OfficeButton(office, label, True, i))
            self.add_item(OfficeButton(office, label, False, i))


class OfficeTownSelect(discord.ui.Select):
    def __init__(self, office, add, towns):
        super().__init__(placeholder='The hold',
                         options=[discord.SelectOption(label=t, value=t) for t in towns[:25]])
        self.office = office
        self.add = add

    async def callback(self, interaction):
        await office_for(interaction, self.office, self.add, self.values[0])


class OfficeTownPick(discord.ui.View):
    def __init__(self, office, add, towns):
        super().__init__(timeout=180)
        self.add_item(OfficeTownSelect(office, add, towns))


class OfficeGiveSelect(discord.ui.UserSelect):
    def __init__(self, office, town):
        super().__init__(placeholder='The person', min_values=1, max_values=1)
        self.office = office
        self.town = town

    async def callback(self, interaction):
        picked = self.values[0] if self.values else None
        # A pick of somebody not in this Discord comes back as a User, which
        # has no roles to give.
        member = picked if hasattr(picked, 'roles') else (
            interaction.guild.get_member(getattr(picked, 'id', 0)) if interaction.guild else None)
        await office_change(interaction, self.office, self.town, member, True)


class OfficeGive(discord.ui.View):
    def __init__(self, office, town):
        super().__init__(timeout=180)
        self.add_item(OfficeGiveSelect(office, town))


class OfficeTakeSelect(discord.ui.Select):
    def __init__(self, office, town, holders):
        super().__init__(placeholder='The person', options=[
            discord.SelectOption(label=(getattr(m, 'display_name', None) or str(m))[:100],
                                 value=str(m.id)) for m in holders])
        self.office = office
        self.town = town

    async def callback(self, interaction):
        try:
            mid = int(self.values[0])
        except (TypeError, ValueError, IndexError):
            mid = 0
        member = interaction.guild.get_member(mid) if interaction.guild else None
        await office_change(interaction, self.office, self.town, member, False)


class OfficeTake(discord.ui.View):
    def __init__(self, office, town, holders):
        super().__init__(timeout=180)
        self.add_item(OfficeTakeSelect(office, town, holders))


# The in-world roles the game reads, as Build-Discord.py makes them: name,
# colour, shown as a group of its own. The office roles are never hoisted
# (Patrick, 15 Oct); the Jarl roles are.
JARL_COLOUR = 0xE0C56A
OFFICE_COLOUR = 0xA8977A


def office_roles_wanted():
    out = [('Jarl of ' + t, JARL_COLOUR, True) for t in OFFICE_TOWNS]
    for t in OFFICE_TOWNS:
        for o, _ in OFFICES:
            out.append((office_role(o, t), OFFICE_COLOUR, False))
    return out


async def ensure_office_roles(guild):
    """
    Make any Jarl or office role the game reads that is missing, the way the
    hold panel makes its two ping roles, so the offices exist as soon as the
    bot that gives them is running, without a run of Build-Discord.py (which
    asks for the bot's token at a prompt). Raven Rock's included (#2551,
    Patrick, 16 Oct). Nothing that is there is changed. A new Jarl role goes
    under the lowest Jarl role there is, and a new office role under the
    lowest Citizen role, where Build-Discord.py keeps them; a build later puts
    every role in its exact place. Says in bot.log what it made.
    """
    if not guild.me.guild_permissions.manage_roles:
        log('the office roles cannot be made: the bot has no Manage Roles.')
        return []
    made = []
    for name, colour, hoist in office_roles_wanted():
        if _role(guild, name) is not None:
            continue
        under = [r for r in guild.roles
                 if r.name.startswith('Jarl of ' if hoist else 'Citizen of ')]
        try:
            role = await guild.create_role(name=name, colour=discord.Colour(colour), hoist=hoist,
                                           mentionable=True, reason='Thornswood hold offices (#2551)')
            made.append(name)
            if under:
                low = min(under, key=lambda r: r.position)
                try:
                    await role.edit(position=max(1, low.position))
                except Exception:
                    log('made %s, and could not move it under %s:\n' % (name, low.name)
                        + traceback.format_exc())
        except Exception:
            log('could not make the %s role:\n' % name + traceback.format_exc())
    if made:
        log('made the office roles that were missing: %s' % ', '.join(made))
    return made


def _office_ids_wanted():
    out = []
    for office, _ in OFFICES:
        out += ['thornswood:office:add:' + office, 'thornswood:office:remove:' + office]
    return out


def office_panel_is_current(msg):
    return (getattr(msg, 'content', None) == OFFICE_PANEL and
            _hold_ids(msg) == _office_ids_wanted())


async def ensure_office_panel(guild):
    """The office panel in #choose-your-hold, under the hold panel, found again by its own buttons."""
    ch = by_name(guild, HOLD_CHANNEL)
    if ch is None:
        return
    missing = [office_role(o, t) for t in HOLDS for o, _ in OFFICES
               if _role(guild, office_role(o, t)) is None]
    if missing:
        log('these office roles are missing, so those offices cannot be given '
            'until Build-Discord.py makes them: %s' % ', '.join(missing))
    try:
        async for m in ch.history(limit=30):
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:office:') for i in _hold_ids(m))):
                if office_panel_is_current(m):
                    log('office panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=OFFICE_PANEL, view=OfficePanel())
                log('office panel updated in #%s' % ch.name)
                return
        await ch.send(OFFICE_PANEL, view=OfficePanel())
        log('office panel posted in #%s' % ch.name)
    except Exception:
        log('office panel failed:\n' + traceback.format_exc())
