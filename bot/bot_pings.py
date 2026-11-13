"""
The ping buttons, in #welcome.

Part of the bot: bot.py loads it (#5357).

Two roles somebody can give themselves: News Pings, which the bot pings when
it posts a change to the live server in #news (bot_news.py), and Updates
Pings, which it pings when it warns of a live game server restart in #updates
(bot_restarts.py). One button for each, pressed again to stop.

They were under the hold buttons in #choose-your-hold until 12 Nov 2026, when
Patrick moved them out: "those buttons don't fit well there and also aren't
IC nor about choosing a hold so maybe in #welcome". #choose-your-hold opens
only to Playtesters and staff, so a Member who read #news and #updates could
not ask to be pinged for them. #welcome opens with Member (the order of
bot_rules_gate.py), so everybody who reads the two channels can press them.
Pressing them takes the same: Member, Playtester or a staff role, the second
lock, so a button reached some other way does nothing for somebody not in.

The two roles are made when missing, not mentionable, so only the bot and
staff who can already mention everyone can ping them.
"""
import os
import traceback

import discord

from bot_core import _who_hits, by_name, client, log
from bot_rules_gate import MEMBER_IDS, MEMBER_NAMES, keeps_more


PING_CHANNEL = [n.strip().lower() for n in
                os.environ.get('PING_CHANNEL', 'welcome').split(',') if n.strip()]
# key, role name, button label
PINGS = [('news', 'News Pings', 'News pings'),
         ('updates', 'Updates Pings', 'Updates pings')]
NEWS_PING_ROLE = 'News Pings'

PING_FIRST_LINE = '**Pings**'
PING_PANEL = (PING_FIRST_LINE + '\n\n'
              'News pings you when the bot posts a change to the live server, '
              'the launcher, the site or the Discord in #news. Updates pings '
              'you a few minutes before the live game server restarts, in '
              '#updates. Press either again to stop.')


def may_ping(who):
    """Member, Playtester or staff: everybody who can read #news and #updates."""
    return _who_hits(who, MEMBER_IDS, MEMBER_NAMES) or keeps_more(who)


def _role(guild, name):
    for r in getattr(guild, 'roles', None) or []:
        if r.name.lower() == name.lower():
            return r
    return None


def _can_give(guild, role):
    """Discord refuses a role at or above the bot's own highest with a bare
       Forbidden, so it is checked first and said in words."""
    me = guild.me
    return bool(me.guild_permissions.manage_roles) and role < me.top_role


async def _say(interaction, text):
    await interaction.response.send_message(text, ephemeral=True)


async def toggle_ping(interaction, name):
    guild, who = interaction.guild, interaction.user
    if guild is None or not may_ping(who):
        await _say(interaction, 'Pings open with the Member role: react to the '
                                'rules in #rules for it.')
        return
    role = _role(guild, name)
    if role is None or not _can_give(guild, role):
        log('cannot give %s: the role is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.' % name)
        await _say(interaction, 'Pings cannot be changed right now. Ask staff.')
        return
    try:
        if role in who.roles:
            await who.remove_roles(role, reason='Turned off in #welcome')
            await _say(interaction, '%s off.' % name)
        else:
            await who.add_roles(role, reason='Turned on in #welcome')
            await _say(interaction, '%s on.' % name)
    except Exception:
        log('ping toggle failed:\n' + traceback.format_exc())
        await _say(interaction, 'That did not go through. Try again, or ask staff.')


class PingButton(discord.ui.Button):
    def __init__(self, key, name, label):
        super().__init__(label=label, style=discord.ButtonStyle.primary,
                         custom_id='thornswood:ping:' + key, row=0)
        self.role_name = name

    async def callback(self, interaction):
        await toggle_ping(interaction, self.role_name)


class PingPanel(discord.ui.View):
    """Persistent, like the hold panel, so the buttons outlive a restart."""
    def __init__(self):
        super().__init__(timeout=None)
        for key, name, label in PINGS:
            self.add_item(PingButton(key, name, label))


def _ids_wanted():
    return ['thornswood:ping:' + k for k, _, _ in PINGS]


def _ids(msg):
    ids = []
    try:
        for row in getattr(msg, 'components', None) or []:
            for item in getattr(row, 'children', None) or []:
                ids.append(getattr(item, 'custom_id', ''))
    except Exception:
        return []
    return ids


def ping_panel_is_current(msg):
    return getattr(msg, 'content', None) == PING_PANEL and _ids(msg) == _ids_wanted()


def ping_role(guild, name):
    """The role to ping, or None when it is not there."""
    return _role(guild, name)


async def ensure_ping_roles(guild):
    for _, name, _ in PINGS:
        if _role(guild, name) is not None:
            continue
        if not guild.me.guild_permissions.manage_roles:
            log('there is no %s role and the bot cannot make one without '
                'Manage Roles.' % name)
            continue
        try:
            await guild.create_role(name=name, mentionable=False,
                                    reason='Ping role for the buttons in #welcome')
            log('made the %s role' % name)
        except Exception:
            log('could not make %s:\n' % name + traceback.format_exc())


async def ensure_ping_panel(guild):
    await ensure_ping_roles(guild)
    ch = by_name(guild, PING_CHANNEL)
    if ch is None:
        log('there is no #%s in "%s", so there are no ping buttons. Set '
            'PING_CHANNEL in bot.env.json to the right channel.'
            % (PING_CHANNEL[0], guild.name))
        return
    try:
        async for m in ch.history(limit=50):
            if (m.author.id == client.user.id and m.components and
                    any(i.startswith('thornswood:ping:') for i in _ids(m))):
                if ping_panel_is_current(m):
                    log('ping panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=PING_PANEL, view=PingPanel())
                log('ping panel updated in #%s' % ch.name)
                return
        await ch.send(PING_PANEL, view=PingPanel())
        log('ping panel posted in #%s' % ch.name)
    except Exception:
        log('could not post the ping panel in #%s:\n' % ch.name
            + traceback.format_exc())
