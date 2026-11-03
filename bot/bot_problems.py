"""
Report a problem.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import os
import re
import time
import traceback
import urllib.parse
import urllib.request

import discord

from bot_base import DATA_DIR
from bot_core import (REPORTS_EVERY, REPORTS_FILE, SITE, _role_tokens,
    _who_hits, as_typed, client, log)
from bot_holds import _hold_ids, _rows
from bot_reports import report_say
from bot_tickets import field_said, is_staff
from bot_testing import FINDINGS_NAME, _channel_named, _kind
from bot_github import GITHUB_API, github_token, known_repo_now
from bot_forums import _bot_threads


# Testers' problems onto the board (#3155). Patrick, 21 Oct: a Discord button
# and an in-game button that file an issue on the board with the log and
# where they are.
#
# In the game it is Report a problem on the help panel. The game server sends
# it to the site (kind 'problem' in inbox.json, beside the other reports),
# with where the character stands and the session the launcher has open for
# that account; watch_problems reads it there and files the issue. In Discord
# it is the panel in #test-findings, which opens a form and files the issue
# itself. Either way the issue carries PROBLEM_LABELS, so staff read it before
# it is Main or Dev Findings: those two put an issue on the public
# #known-issues, which is for real bugs only (#3137).
#
# The logs are never copied into the issue: the launcher sends them to the
# site when the game closes, and the issue links that session on the hub's
# sessions page (/sessions?find=), where staff read them with the game
# server's own lines for the same window.
#
# GITHUB_TOKEN needs issues write for this, as for github_say. A refusal is
# said once in the staff channel and the report stays in the inbox, where the
# next look files it once GitHub takes it.
PROBLEM_LABELS = [l.strip() for l in
                  os.environ.get('PROBLEM_LABELS', 'Tester report,area: triage').split(',')
                  if l.strip()]
PROBLEMS_FILED = os.path.join(DATA_DIR, 'problems-filed.json')
PROBLEM_CHANNEL = os.environ.get('PROBLEM_CHANNEL', '').strip().lower() or FINDINGS_NAME
# Who may use the Discord panel: testers and staff.
_TESTER_RAW = [r.strip() for r in os.environ.get('TESTER_ROLES', 'Playtester').split(',')
               if r.strip()]
TESTER_IDS, TESTER_NAMES = _role_tokens(_TESTER_RAW)
# The same as the game and the site take from one person: five an hour.
PROBLEM_HOUR = 5
_problems_by = {}
PROBLEM_PANEL = ('**Report a problem**\n'
                 'Something broken in the game, the launcher or the site? Press the button, '
                 'say what went wrong and what you were doing, and it goes on the board for '
                 'the developers. In the game it is on the help panel (F7), under Getting '
                 'help, and it takes where you are standing with it.')


def _when_text(ms):
    """A moment as people read it, in UTC, on the twelve hour clock."""
    try:
        t = datetime.datetime.fromtimestamp(float(ms) / 1000.0, datetime.timezone.utc)
    except Exception:
        return 'an unknown time'
    hour = t.hour % 12 or 12
    return '%d %s %d, %d:%02d %s UTC' % (t.day, t.strftime('%b'), t.year, hour, t.minute,
                                         'AM' if t.hour < 12 else 'PM')


def _issue_text(v, n):
    """Words somebody typed, inside an issue, as typed: in a <pre>, where
       GitHub reads no markdown and links no mention, with &, < and > made
       entities so nothing in it can close the block."""
    v = str(v or '').strip()[:n]
    return '<pre>' + v.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') + '</pre>'


def _issue_title(text):
    """The issue's title: the first words of what they said, cut at a word."""
    t = re.sub(r'\s+', ' ', str(text or '')).strip()
    if len(t) <= 90:
        return t or 'A problem with nothing said'
    cut = t[:90]
    at = cut.rfind(' ')
    return (cut[:at] if at > 45 else cut).rstrip(' ,.;:') + '...'


def problem_issue(row):
    """The issue for a problem sent from the game: (title, body)."""
    server = 'the dev server' if row.get('server') == 'dev' else 'the main server'
    session = str(row.get('session') or '')
    pos = row.get('pos') if isinstance(row.get('pos'), list) else []
    where = str(row.get('cell') or 'an unknown place')
    if len(pos) == 3:
        where += ', at ' + ', '.join(str(x) for x in pos)
    who = '%s, profile %s' % (str(row.get('by') or 'Somebody')[:60], row.get('profileId') or 'unknown')
    if str(row.get('discordId') or '').isdigit():
        who += ', Discord account %s' % row.get('discordId')
    if session:
        logs = ('[this game\'s session](%s/sessions?find=%s) on the hub. The launcher sends '
                'its logs when the game closes; More details there has them, with the game '
                'server\'s own lines for the same window.' % (SITE, urllib.parse.quote(session)))
    else:
        logs = ('none tied to it: the site found no session open for this account when the '
                'report came in, so look under their Discord account on the hub\'s sessions page.')
    # No issue number in the body: each would link itself on that issue.
    body = ('A tester reported this in game on %s with Report a problem on the help panel '
            'of the game. Read it, then give it its area and Main or Dev Findings, or close it.\n\n'
            '**What they said**\n%s\n\n'
            '- **Who:** %s\n'
            '- **Where:** %s (where the game server had the character)\n'
            '- **When:** %s\n'
            '- **Logs:** %s\n'
            % (server, _issue_text(row.get('title'), 1000), who, where,
               _when_text(row.get('at')), logs))
    return _issue_title(row.get('title')), body


def problem_issue_discord(name, discord_id, what, doing, server, at_ms):
    """The issue for a problem sent from the Discord panel: (title, body)."""
    body = ('A tester reported this in Discord with the Report a problem panel in #%s. '
            'Read it, then give it its area and Main or Dev Findings, or close it.\n\n'
            '**What went wrong**\n%s\n\n'
            '**What they were doing, and where**\n%s\n\n'
            '- **Who:** %s, Discord account %s\n'
            '- **Server:** %s\n'
            '- **When:** %s\n'
            '- **Logs:** [their sessions](%s/sessions?find=%s) on the hub, newest first. A '
            'report from Discord is tied to no one game, so the session is the one closest '
            'to the time above.\n'
            % (PROBLEM_CHANNEL, _issue_text(what, 1000),
               _issue_text(doing, 1000) if str(doing or '').strip() else 'nothing said',
               str(name or 'Somebody')[:60], discord_id,
               str(server or '').strip()[:40] or 'not said', _when_text(at_ms),
               SITE, urllib.parse.quote(str(discord_id))))
    return _issue_title(what), body


def github_file(title, body, labels):
    """Files an issue on the board. The bot's token needs issues write for
       this, as for github_say. Returns the issue's number."""
    token = github_token()
    if not token:
        raise RuntimeError('no GitHub token: none in GITHUB_TOKEN_FILE and no GITHUB_TOKEN in bot.env.json')
    req = urllib.request.Request(
        '%s/repos/%s/issues' % (GITHUB_API, known_repo_now()),
        data=json.dumps({'title': title, 'body': body, 'labels': labels}).encode('utf-8'),
        method='POST',
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'thornswood-bot',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return int(json.loads(r.read().decode('utf-8'))['number'])


def _filed_read():
    try:
        with open(PROBLEMS_FILED, encoding='utf-8') as f:
            got = json.load(f)
        return got if isinstance(got, dict) else {}
    except FileNotFoundError:
        return {}


def _filed_write(filed):
    tmp = PROBLEMS_FILED + '.new'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(filed, f)
    os.replace(tmp, PROBLEMS_FILED)


async def problems_once(rows, filed, file=None, say=None, save=None):
    """
    Files every problem in rows that filed has no number for, oldest first,
    and says each in the staff channel with its number. Returns the reasons
    it could not file, for the caller to say once. filed is changed in place
    and saved after each issue, so a stop half way never files one twice.
    """
    file = file or github_file
    say = say or report_say
    save = save or _filed_write
    loop = asyncio.get_running_loop()
    failed = []
    todo = [r for r in (rows or []) if isinstance(r, dict) and r.get('kind') == 'problem'
            and r.get('id') and str(r['id']) not in filed]
    for r in reversed(todo):
        title, body = problem_issue(r)
        try:
            number = await loop.run_in_executor(None, file, title, body, PROBLEM_LABELS)
        except Exception as e:
            failed.append('%s: %s' % (type(e).__name__, str(e)[:200]))
            break
        filed[str(r['id'])] = number
        await loop.run_in_executor(None, save, filed)
        where = ' on the dev server' if r.get('server') == 'dev' else ''
        await say('**%s reported a problem in game%s**, on the board as #%d.\n%s'
                  % (as_typed(r.get('by'), 40) or 'Somebody', where, number,
                     as_typed(r.get('title'), 300)))
    return failed


async def watch_problems():
    """Files the problems sent from the game on the board (#3155)."""
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()

    def read_rows():
        try:
            with open(REPORTS_FILE, encoding='utf-8') as f:
                rows = json.load(f)
        except FileNotFoundError:
            return []
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    try:
        filed = await loop.run_in_executor(None, _filed_read)
    except Exception:
        # Not read is not empty: empty would file every problem again.
        log('problems: %s will not read, so nothing is filed until it does:\n' % PROBLEMS_FILED
            + traceback.format_exc())
        return
    log('problems: filing what the game sends from %s every %ds, %d filed so far'
        % (REPORTS_FILE, REPORTS_EVERY, len(filed)))
    said_why = ''
    while not client.is_closed():
        try:
            rows = await loop.run_in_executor(None, read_rows)
            if rows is not None:
                failed = await problems_once(rows, filed)
                why = failed[0] if failed else ''
                if why and why != said_why:
                    await report_say('**A problem sent from the game could not be filed on the '
                                     'board**: GitHub said %s. It stays in the inbox on the site, '
                                     'and it is filed as soon as GitHub takes it.' % as_typed(why, 300))
                    log('problems: could not file:', why)
                said_why = why
        except Exception:
            log('problems: the check itself failed, carrying on:\n' + traceback.format_exc())
        await asyncio.sleep(REPORTS_EVERY)


def problem_refusal(member, now):
    """Why this person may not send a problem from Discord now, or ''."""
    if not (is_staff(member) or _who_hits(member, TESTER_IDS, TESTER_NAMES)):
        return ('Report a problem is for playtesters and staff. Apply to playtest in '
                '#apply-to-playtest, or ask in #get-help.')
    seen = [t for t in _problems_by.get(member.id, []) if now - t < 3600]
    _problems_by[member.id] = seen
    if len(seen) >= PROBLEM_HOUR:
        wait = int((seen[0] + 3600 - now) // 60) + 1
        return ('That is %d problems from you in the last hour, which is as many as this '
                'takes. Try again in %d minutes.' % (PROBLEM_HOUR, wait))
    return ''


class ProblemModal(discord.ui.Modal):
    def __init__(self):
        super().__init__(title='Report a problem')
        self.what = discord.ui.TextInput(
            label='What went wrong',
            placeholder='What you saw, and what you expected instead',
            style=discord.TextStyle.paragraph, required=True, max_length=1000)
        self.doing = discord.ui.TextInput(
            label='What you were doing, and where',
            placeholder='Which town or place, and what you pressed',
            style=discord.TextStyle.paragraph, required=False, max_length=1000)
        self.server = discord.ui.TextInput(
            label='Which server, main or dev',
            placeholder='main', style=discord.TextStyle.short,
            required=False, max_length=40)
        self.add_item(self.what)
        self.add_item(self.doing)
        self.add_item(self.server)

    async def on_submit(self, interaction):
        now = time.time()
        no = problem_refusal(interaction.user, now)
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        # Counted before the first await, so two forms at once cannot both pass.
        _problems_by.setdefault(interaction.user.id, []).append(now)
        await interaction.response.defer(ephemeral=True, thinking=True)
        who = interaction.user
        title, body = problem_issue_discord(
            getattr(who, 'display_name', '') or who.name, who.id,
            field_said(self.what), field_said(self.doing), field_said(self.server), now * 1000)
        try:
            number = await asyncio.get_running_loop().run_in_executor(
                None, github_file, title, body, PROBLEM_LABELS)
        except Exception as e:
            log('problems: a problem from Discord could not be filed:', e)
            await interaction.followup.send(
                'It could not be put on the board just now, so nothing was filed. Post it '
                'in this channel as a message instead and staff will read it.', ephemeral=True)
            return
        await interaction.followup.send(
            'It is on the board for the developers. Thank you.', ephemeral=True)
        await report_say('**%s reported a problem in Discord**, on the board as #%d.\n%s'
                         % (as_typed(getattr(who, 'display_name', '') or who.name, 40),
                            number, as_typed(field_said(self.what), 300)))


class ProblemPanel(discord.ui.View):
    """Persistent, like the ticket panel, so the button outlives a restart."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Report a problem', style=discord.ButtonStyle.primary,
                       custom_id='thornswood:problem')
    async def report(self, interaction, button):
        no = problem_refusal(interaction.user, time.time())
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        await interaction.response.send_modal(ProblemModal())


def problem_panel_is_current(msg):
    return (getattr(msg, 'content', None) == PROBLEM_PANEL and
            _rows(msg) == [['thornswood:problem']])


async def ensure_problem_panel(guild):
    """
    The panel in #test-findings, made once and edited when it changes.

    #test-findings is a forum, where a message stands only as a post, so the
    panel is a post of the bot's own, called Report a problem and pinned to
    the top. In a text channel (PROBLEM_CHANNEL set to one) it is a message.
    Found again by its button, never by its words, so a change of words is
    an edit and not a second panel.
    """
    ch = _channel_named(guild, PROBLEM_CHANNEL, ('text', 'forum'))
    if ch is None:
        log('there is no #%s in "%s", so there is no Report a problem panel. Set '
            'PROBLEM_CHANNEL in bot.env.json to the right channel.' % (PROBLEM_CHANNEL, guild.name))
        return
    try:
        if _kind(ch) == 'forum':
            for th in await _bot_threads(ch, client.user.id):
                try:
                    m = await th.fetch_message(th.id)
                except discord.NotFound:
                    continue
                if not (m.components and 'thornswood:problem' in _hold_ids(m)):
                    continue
                if not problem_panel_is_current(m):
                    await m.edit(content=PROBLEM_PANEL, view=ProblemPanel())
                    log('Report a problem panel updated in #%s' % ch.name)
                else:
                    log('Report a problem panel is already current in #%s' % ch.name)
                if getattr(th, 'archived', False) or not getattr(getattr(th, 'flags', None), 'pinned', False):
                    await th.edit(archived=False, pinned=True)
                return
            made = await ch.create_thread(name='Report a problem', content=PROBLEM_PANEL,
                                          view=ProblemPanel(),
                                          allowed_mentions=discord.AllowedMentions.none(),
                                          reason='Report a problem (#3155)')
            th = getattr(made, 'thread', made)
            await th.edit(pinned=True)
            log('Report a problem panel posted and pinned in #%s' % ch.name)
            return
        async for m in ch.history(limit=50):
            if (m.author.id == client.user.id and m.components and
                    'thornswood:problem' in _hold_ids(m)):
                if problem_panel_is_current(m):
                    log('Report a problem panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=PROBLEM_PANEL, view=ProblemPanel())
                log('Report a problem panel updated in #%s' % ch.name)
                return
        await ch.send(PROBLEM_PANEL, view=ProblemPanel())
        log('Report a problem panel posted in #%s' % ch.name)
    except Exception:
        log('could not post the Report a problem panel in #%s:\n' % ch.name
            + traceback.format_exc())
