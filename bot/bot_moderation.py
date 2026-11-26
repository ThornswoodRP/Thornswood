"""
What staff do in the world, said in the staff channel.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import traceback

from bot_core import DATA_DIR, TROUBLE_FILE, _int_env, _state_write, as_typed, client, log
from bot_offices import office_text
from bot_reports import (copy_key, copy_state, forget_copies,
    copy_notice, reconcile_copies, report_say, send_copy, source_key)

MODERATION_POSTS = os.path.join(DATA_DIR, 'moderation-posts.json')


# What a moderator did in the game (#412): /kick, /freeze, /silence, /warn and
# the rest. The gamemode appends one JSON line per action to
# for-bot\moderation.log beside each game server, on this same box, and this
# says each new line once in the staff channel, so the record is outside the
# game and in front of the rest of staff. A file rather than a request, for the
# same reason as watch_trouble: no new secret, port or ticket.
#
# for-bot, not private (#2321): private is SYSTEM's and Administrators' alone,
# and a rule on one file in it could only be given once the gamemode had made
# the file, long after the install that gives it. Install-Bot.ps1 gives the
# bot's account read on the for-bot folder, which a file made later takes.
MODERATION_LOGS = [
    ('live', os.environ.get('MODERATION_LOG',
                            r'C:\Thornswood-Server\for-bot\moderation.log')),
    ('dev', os.environ.get('MODERATION_LOG_DEV',
                           r'C:\Thornswood-Server-Dev\for-bot\moderation.log')),
    # Bans and notes made on the hub, which the site writes beside
    # trouble.json. The game's own /ban and /note are in the two above.
    ('site', os.environ.get('MODERATION_LOG_SITE',
                            os.path.join(os.path.dirname(TROUBLE_FILE), 'moderation.log'))),
]
MODERATION_EVERY = _int_env('MODERATION_EVERY', 30)
# More than this in one look from one server is said as a count, not a wall.
MODERATION_AT_ONCE = 10

_MOD_DID = {
    'kick': 'removed %s from the world',
    'freeze': 'froze %s in place',
    'unfreeze': 'let %s move again',
    'bring': 'brought %s to them',
    'goto': 'went to %s',
    'silence': 'silenced %s',
    'unsilence': 'let %s speak again',
    'warn': 'warned %s',
    'give': 'gave %s',
    'spawn': 'spawned beside %s',
    # The creature is named in why, not in the character fields.
    'despawn': 'despawned a creature',
    'hurt': 'used /hurt on %s',
    'tp': 'sent %s',
    'heal': 'used /heal on %s',
    'rankup': 'advanced a rank for %s',
    'rename': 'renamed %s',
    'setneeds': 'changed a need for %s',
    'tpto': 'teleported to %s for testing',
    # One character, or the whole account, and a character killed for good (#1010).
    'ban': 'banned the character %s',
    'unban': 'lifted the ban on the character %s',
    'banaccount': 'banned the whole account of %s, every character on it',
    'unbanaccount': 'lifted the ban on the account of %s',
    'pk': 'killed %s for good (PK), quietly',
    # An admin undoing a PK made by mistake (#1010, 29 September).
    'unpk': 'undid the PK of %s, so the character can be played again',
    'note': 'wrote a note on %s',
    'docsave': 'saved page %s',
    'inboxdismiss': 'marked inbox report not doing this: %s',
    'inboxreopen': 'reopened inbox report %s',
    'inboxdelete': 'deleted inbox report %s',
    'uploaddelete': 'deleted upload %s',
    # Staff at a building's door, from the Office page of K (#2551, Patrick,
    # 17 Oct): the why names the building and its hold, and the rent set.
    'evict': 'ended the claim of %s',
    'rent': 'set the rent on the claim of %s',
    'norent': 'took the rent off the claim of %s',
    # Rent handed over in person, marked paid on the Office page (#3895).
    'rentpaid': 'marked rent paid by %s',
    # Staff on the world's card, the Office page of K (#513): the stage is
    # the who, and the why says from where, to where, and the force.
    'worldpropose': 'proposed moving the world to %s',
    'worldconfirm': 'confirmed moving the world to %s',
    'worlddrop': 'dropped the proposal to move the world to %s',
    # The subject is the company's terms, and why describes the changes.
    'companypropose': 'proposed changes to %s',
    'companydrop': 'dropped proposed changes to %s',
    'companyconfirm': 'confirmed changes to %s',
    # Staff on the crafting card, the Office page of K (#3167): the why says
    # which rank from what to what, or what was given back and why.
    'craftrank': 'raised a rank of %s',
    'craftrecipes': 'handed the newer recipe list to the game of %s',
    'craftgive': 'gave back to %s',
    # Playtest scene commands identify the acting character. Changes made to
    # a character's equipment or progression also name the target.
    'fly': 'changed their flight mode',
    'phase': 'used /phase',
    'godmode': 'changed their invulnerability',
    'invisible': 'changed their visibility',
    'cleareffects': 'used /cleareffects',
    'killall': 'used /killall',
    'tools-off': 'ended scene tools for %s',
    'setclass': 'changed the class of %s',
    'setprofession': 'changed the profession of %s',
    'repair': 'repaired equipment for %s',
    'galleryapprove': 'accepted gallery picture %s',
    'galleryremove': 'removed gallery picture %s',
    'gallerydismiss': 'dismissed a report on gallery picture %s',
    # Not staff: somebody's own /stuck (#414), said as its why reads.
    'stuck': 'used /stuck',
    # Not staff either: the server took somebody idle out of the world (#1142).
    'idle': 'was moved out for being idle',
    # An admin taking gold or a thing back out of a character from the hub's
    # Gold and trades page, done by the game server (#6271): the why says
    # how much of how much was asked, on which server, and why.
    'takeback': 'took back from %s',
    'takebackfailed': 'could not take back from %s',
    # Not staff: 1000 gold or more handed to somebody, flagged by the gold
    # and trade log (#6270), said as its why reads.
    'gold': 'was flagged for gold',
}


def moderation_text(where, row):
    """
    One line of moderation.log as the staff channel reads it, or None for a
    line that is not one. Names and reasons were typed in the game, so they
    are escaped: nothing in them can ping anybody or dress itself up.
    """
    if isinstance(row, dict) and row.get('did') in ('office', 'jarlclash', 'jarlclear'):
        return office_text(row)
    if not isinstance(row, dict) or row.get('did') not in _MOD_DID:
        return None

    clean = as_typed

    def person(name, pid):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            pid = 0
        # The hub knows a person by account, not by profile.
        if pid <= 0:
            return clean(name, 40) or 'somebody'
        return '%s (profile %d)' % (clean(name, 40) or 'somebody', pid)

    # /stuck is not a staff action: the person did it to themselves, and the
    # gamemode writes the whole sentence (from where, to where, the account).
    if row['did'] == 'stuck':
        why = clean(row.get('why'), 600) or 'used /stuck.'
        return ('**/stuck on the %s server:** %s %s'
                % (where, person(row.get('byName'), row.get('by')), why))[:1900]

    # Moved out of the world for being idle (#1142): nobody did it to them, so
    # it reads as what happened and why, which the gamemode writes.
    if row['did'] == 'idle':
        why = clean(row.get('why'), 600) or 'nothing from their game for too long'
        return ('**Idle on the %s server:** %s was taken back to the character choice and put in line: %s'
                % (where, person(row.get('whoName'), row.get('who')), why))[:1900]

    # A big move of gold (#6270): the gamemode writes the whole sentence, who
    # handed how much to whom and where, with the accounts.
    if row['did'] == 'gold':
        why = clean(row.get('why'), 600) or 'a big move of gold.'
        return ('**Gold flagged on the %s server:** %s' % (where, why))[:1900]

    if row['did'] == 'uploaddelete':
        subject = clean(row.get('whoName'), 240) or 'an unnamed upload'
        if row.get('phase') == 'metadata':
            did = 'removed the upload listing for %s' % subject
        else:
            did = _MOD_DID['uploaddelete'] % subject
        return ('**Staff on the site:** %s %s.'
                % (person(row.get('byName'), None), did))[:1900]

    did = _MOD_DID[row['did']]
    gallery_phase = row.get('phase')
    if row['did'] == 'galleryapprove' and gallery_phase == 'updated':
        did = 'updated gallery picture %s'
    elif row['did'] == 'galleryremove' and isinstance(gallery_phase, str):
        did = {
            'approved': 'removed gallery picture %s from the public gallery',
            'pending': 'removed gallery picture %s from the approval queue',
            'reports': 'cleared reports while removing gallery picture %s',
            'file': 'deleted the stored file for gallery picture %s',
            'hidden': 'marked the stored file for gallery picture %s as removed',
        }.get(gallery_phase, did)
    if '%s' in did:
        # Generated picture names exceed the character-name bound. Keep the
        # filename distinct, escaped as typed, without treating it as a person.
        subject = (clean(row.get('whoName'), 240) or 'an unnamed picture') if row['did'] in (
            'galleryapprove', 'galleryremove', 'gallerydismiss') else person(row.get('whoName'), row.get('who'))
        did = did % subject
    try:
        minutes = int(row.get('minutes') or 0)
    except (TypeError, ValueError):
        minutes = 0
    if row['did'] == 'silence' and minutes > 0:
        did += ' for %d minute%s' % (minutes, '' if minutes == 1 else 's')
    why = clean(row.get('why'), 300)
    head = ('**Staff on the site:**' if where == 'site'
            else '**Staff on the %s server:**' % where)
    return ('%s %s %s%s'
            % (head, person(row.get('byName'), row.get('by')), did,
               (': ' + why) if why else '.'))[:1900]


def _moderation_lines(path):
    """
    (lines, why, complete). lines is every whole line in one moderation.log, [] when
    there is no file yet (no staff action on that server so far), None when it
    could not be read, and then why says what refused it. A last line with no
    line ending is left for the next look, the same as _watch_log_lines.
    """
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return [], '', False
    except Exception as e:
        return None, '%s: %s' % (type(e).__name__, e), False
    try:
        parts = data.decode('utf-8-sig').split('\n')
    except UnicodeDecodeError as e:
        return None, 'UnicodeDecodeError: %s' % e, False
    lines = [p.rstrip('\r') for p in parts[:-1] if p.strip()]
    complete, why = not parts[-1], ''
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            record = None
        if not isinstance(record, dict):
            complete, why = False, 'InvalidLineError: a complete line is not a JSON object'
            break
    return lines, why, complete


def _moderation_unreadable(unread, where, path, why):
    """
    Say in bot.log when one moderation.log cannot be read, and when it can be
    again, once each rather than every look (#2321). Until #2321 a refused
    read was skipped with nothing logged, so a server whose staff log the
    bot's account could not open said nothing anywhere.
    """
    if why and unread.get(where) != why:
        unread[where] = why
        log('moderation: cannot read %s completely (%s), so source expiry on %s '
            'cannot be proved. Repair corrupt input or read access before '
            'private-copy cleanup can resume. Install-Bot.ps1 gives the bot\'s '
            'account read on that folder.'
            % (path, why, 'the site' if where == 'site' else 'the %s server' % where))
    elif not why and where in unread:
        del unread[where]
        log('moderation: %s can be read again' % path)


async def watch_moderation():
    """Deliver retained unacknowledged actions using durable copy receipts.

    Pending uncertain sends are reconciled before newer actions from that
    source. Unreadable/incomplete input never proves a private copy expired.
    """
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    unread = {}
    log('moderation: reading %s every %ds'
        % (', '.join(p for _, p in MODERATION_LOGS), MODERATION_EVERY))

    while not client.is_closed():
        try:
            state = copy_state(MODERATION_POSTS)
            for where, path in MODERATION_LOGS:
                lines, why, complete = await loop.run_in_executor(None, _moderation_lines, path)
                _moderation_unreadable(unread, where, path, why)
                if lines is None:
                    continue
                source = source_key(where, path)
                if state is not None:
                    if await reconcile_copies(state, source, client):
                        _state_write(MODERATION_POSTS, state)
                    if complete and await forget_copies(state, source,
                                                       {copy_key(line) for line in lines}, client):
                        _state_write(MODERATION_POSTS, state)
                posts = state.get(source, {}) if state is not None else {}
                texts = []
                for line in dict.fromkeys(lines):
                    if copy_key(line) in posts:
                        continue
                    try:
                        text = moderation_text(where, json.loads(line))
                    except ValueError:
                        text = None
                    if text:
                        texts.append((line, text))
                if state is None:
                    if texts and copy_notice((source, 'corrupt', len(texts)),
                                             'moderation: receipt index unreadable; private copies are paused.'):
                        await report_say('**%d staff action%s remain on %s.** Staff copies are '
                                         'paused because their saved receipts cannot be read.'
                                         % (len(texts), '' if len(texts) == 1 else 's', where))
                elif not any('attempt' in post for post in posts.values()):
                    if len(texts) > MODERATION_AT_ONCE:
                        await send_copy(MODERATION_POSTS, state, source,
                                        [copy_key(line) for line, _ in texts],
                                        '**%d staff action%s on %s** since the last look. '
                                        'See %s on the VPS for details.'
                                        % (len(texts), '' if len(texts) == 1 else 's',
                                           'the site' if where == 'site' else 'the %s server' % where, path), client)
                    else:
                        for line, text in texts:
                            if not await send_copy(MODERATION_POSTS, state, source,
                                                   [copy_key(line)], text, client):
                                break
        except Exception:
            log('moderation: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(MODERATION_EVERY)
