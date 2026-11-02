"""
test-read-channels.py

#start-here, #welcome and #faq say what the join page says, because they are
read out of it, and every message the builder would send fits in Discord.

From the To Do List, entry 185: "The start channel promises two files, twenty
gigabytes copied into place, and that the Skyrim you already play will not be
touched; the person then meets Vortex, a collection and a downgrade." And the
way it asked for it to be fixed: "Generate them from join.md and help.md so
they cannot drift."

So this checks three things.

  1. The words. The dead promises are gone and Vortex, Nexus and the
     collection are there, in the real content.py read against the real
     site/data/site/join.md.
  2. That they cannot drift. Every paragraph of join.md is in #start-here,
     and a copy of content.py pointed at an edited join.md follows the edit,
     or refuses to load when the paragraph it quotes has gone.
  3. That they fit. Build-Discord.py's own post() is run on every read only
     post with a stand in channel that keeps what it is sent, and every
     message has to be under Discord's 2000 characters with nothing lost.

Build-Discord.py is loaded as a module, which defines things and connects to
nothing: client.run is only reached when it is run as a script, and no token
is involved. Nothing here posts anywhere.

Read only, apart from a temporary folder it removes.
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
import shutil
import tempfile

JOIN_MD = os.path.join(HERE, '..', 'site', 'data', 'site', 'join.md')

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def paragraphs(md):
    return [p.strip() for p in md.replace('\r\n', '\n').split('\n\n') if p.strip()]


def site_links(md):
    """join.md's relative links as the channel should carry them. Written out
       again here rather than borrowed from content.py, so a mistake in the one
       there is not checked against itself."""
    return re.sub(r'\]\((/[^)\s]*)\)', r'](<https://thornswood.net\1>)', md)


import content as C  # noqa: E402

WELCOME = getattr(C, 'WELCOME', '')
START = getattr(C, 'START', '')
FAQ = getattr(C, 'FAQ', '')
ALL3 = {'#welcome': WELCOME, '#start-here': START, '#faq': FAQ}
join_file = open(JOIN_MD, encoding='utf-8').read()
# #428: join.md marks its alpha and its open wording, and only the one the
# switch is on goes out, on the site and here. Compared through the same
# reading, so a paragraph of the other mode is not wanted in #start-here.
join_raw = C.for_mode(join_file) if hasattr(C, 'for_mode') else join_file
yes('join.md is read through its alpha and open markers, and none is left over',
    '<!--' not in START and (C.OPEN or '## 1. Come into the Discord' not in START))

# ------------------------------------------------------------ the words --
for word in ('Vortex', 'Nexus', 'collection', 'Downgrade', 'half a gigabyte'):
    yes('#start-here says ' + word, word in START)
for word in ('Vortex', 'Nexus', 'collection', '1.6.1170'):
    yes('#faq says ' + word, word in FAQ)
yes('#welcome says Vortex and Purge Mods, what happens to your own Skyrim',
    'Vortex' in WELCOME and 'Purge Mods' in WELCOME)

DEAD = [
    'twenty gigabytes',          # the old zip, copied into place
    'Two files',                 # a small exe and a large zip
    'both installer files',
    'small **exe**',
    'installs its own copy',     # it goes into the Skyrim you already have now
    'never touches yours',
    'leaves yours alone',
    'CrashLogger',               # a crash log folder that is not where they are
]
for name, text in sorted(ALL3.items()):
    left = [d for d in DEAD if d in text]
    yes(name + ' has none of the old installer\'s promises' +
        ('' if not left else ': still says ' + ', '.join(left)), not left)

for name, text in sorted(ALL3.items()):
    yes(name + ' has no relative site link Discord could not follow',
        re.search(r'\]\(/', text) is None)
    yes(name + ' has no --- line, which Discord shows as three dashes',
        not any(line.strip() == '---' for line in text.split('\n')))
    yes(name + ' has no em dash', chr(0x2014) not in text)
    yes(name + ' calls nobody by the word the house rules keep out',
        re.search(r'\bplayers?\b', text, re.I) is None)

# --------------------------------------------------- cannot drift: here --
want = [p for p in paragraphs(site_links(join_raw))
        if p != '---' and not p.startswith('# ')]
missing = [p for p in want if p not in START]
yes('every one of join.md\'s %d paragraphs is in #start-here word for word' % len(want),
    want and not missing)
for p in missing[:3]:
    print('      not there: ' + p[:70].replace('\n', ' '))

need = join_raw.split('## What you need', 1)[-1].split('\n## ', 1)[0]
need = paragraphs(site_links(need))
yours = [p for p in need if 'the Skyrim you already have' in p]
yes('join.md still has its paragraph about the Skyrim you already have', len(yours) == 1)
yes('#welcome carries that paragraph, word for word', bool(yours) and yours[0] in WELCOME)
yes('#faq carries all of "What you need", word for word',
    bool(need) and all(p in FAQ for p in need))

as_discord = getattr(C, 'as_discord', None)
section = getattr(C, 'section', None)
longest = getattr(C, 'LONGEST_PARAGRAPH', None)
yes('content.py reads the page through as_discord and section',
    callable(as_discord) and callable(section) and isinstance(longest, int))
if callable(as_discord) and isinstance(longest, int):
    out = as_discord('# T\n\nSee the [rules](/rules).\n\n---\n\nEnd.\n')
    yes('a relative link becomes the full address with no preview card',
        '[rules](<https://thornswood.net/rules>)' in out)
    yes('a --- line goes and leaves one blank line, not three',
        '---' not in out and '\n\n\n' not in out and out.endswith('End.'))
    try:
        as_discord('# T\n\n' + ('word ' * (longest // 5 + 10)) + '\n')
        refused = False
    except ValueError:
        refused = True
    yes('a paragraph longer than %d characters is refused when content.py loads, '
        'not halfway through a re-post' % longest, refused)
if callable(section):
    try:
        section('# T\n\n## Here\n\nx\n', 'Gone')
        refused = False
    except ValueError:
        refused = True
    yes('a section the channel reads from that has gone is refused by name', refused)

# ------------------------------------------ cannot drift: an edited page --
# A copy of content.py, laid out the way the repo is, beside a join.md that
# says something else. What content.py makes has to follow the page.
TMP = tempfile.mkdtemp(prefix='thornswood-read-channels-')
try:
    os.makedirs(os.path.join(TMP, 'bot'))
    os.makedirs(os.path.join(TMP, 'site', 'data', 'site'))
    shutil.copy(os.path.join(HERE, 'content.py'), os.path.join(TMP, 'bot', 'content.py'))
    # #game-rules is read out of rules.md since issue #430, so content.py
    # needs it beside join.md to load at all. test-game-rules.py edits it.
    shutil.copy(os.path.join(HERE, '..', 'site', 'data', 'site', 'rules.md'),
                os.path.join(TMP, 'site', 'data', 'site', 'rules.md'))
    # And #factions out of lore/factions.md since #3317.
    os.makedirs(os.path.join(TMP, 'lore'))
    shutil.copy(os.path.join(HERE, '..', 'lore', 'factions.md'),
                os.path.join(TMP, 'lore', 'factions.md'))

    def load_with(md, tag):
        with open(os.path.join(TMP, 'site', 'data', 'site', 'join.md'), 'w',
                  encoding='utf-8', newline='\n') as f:
            f.write(md)
        spec = importlib.util.spec_from_file_location(
            'content_' + tag, os.path.join(TMP, 'bot', 'content.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    edited = join_raw.replace('about half a gigabyte', 'about three quarters of a gigabyte')
    edited = edited.replace('Purge Mods', 'Purge Everything')
    try:
        mod = load_with(edited, 'edited')
        yes('an edit to join.md reaches #start-here with nothing else changed',
            'three quarters of a gigabyte' in mod.START and 'half a gigabyte' not in mod.START)
        yes('and reaches #welcome and #faq',
            'Purge Everything' in mod.WELCOME and 'Purge Everything' in mod.FAQ)
    except Exception as e:
        yes('an edit to join.md reaches #start-here (content.py did not load: %r)' % (e,), False)

    gone = '\n\n'.join(p for p in join_raw.split('\n\n')
                       if 'the Skyrim you already have' not in p)
    try:
        load_with(gone, 'gone')
        refused = False
    except ValueError:
        refused = True
    except Exception:
        refused = False
    yes('a join.md without the paragraph #welcome quotes stops content.py loading, '
        'rather than posting a welcome without it', refused)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

# ------------------------------------------------------------ they fit --
try:
    import discord  # noqa: F401
    have_discord = True
except ImportError:
    have_discord = False

if not have_discord:
    print('SKIP  discord.py is not installed, so Build-Discord.py\'s post() was not run')
else:
    spec = importlib.util.spec_from_file_location(
        'build_discord_under_test', os.path.join(HERE, 'Build-Discord.py'))
    B = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(B)

    class Message(object):
        async def pin(self):
            pass

    class History(object):
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    class Channel(object):
        """Keeps what it is sent. A channel id is up to 19 digits, so a
           mention grows from <#PLAYTEST> to 22 characters and the longest
           ids are used here."""
        n = 0

        def __init__(self, name):
            Channel.n += 1
            self.name = name
            self.id = 1234567890123456000 + Channel.n
            self.mention = '<#%d>' % self.id
            self.sent = []

        def history(self, limit=None):
            return History()

        async def send(self, text):
            self.sent.append(text)
            return Message()

    found = {}
    posts = []
    keys = []
    for _, specs in B.PLAN:
        for s in specs:
            ch = Channel(s['name'])
            if s.get('key'):
                found[s['key']] = ch
            if s.get('post'):
                # What -Posts writes: the words with their Last changed line
                # (#3317). A draft is never written, and is measured as its
                # words alone so it fits the day it is approved.
                k = s['key']
                posts.append((ch, B.C.DOCS[k] if k in B.C.DRAFTS else B.doc_with_footer(k)))
                keys.append(k)
    yes('the plan still posts #welcome, #start-here and #faq from content.py',
        all(k in keys for k in ('WELCOME', 'START', 'FAQ')) and
        B.C.DOCS['WELCOME'] is B.C.WELCOME and B.C.DOCS['START'] is B.C.START
        and B.C.DOCS['FAQ'] is B.C.FAQ)

    for ch, text in posts:
        with contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(B.post(ch, text, found))
        sizes = [len(m) for m in ch.sent]
        yes('#%s goes out as %d message(s), the longest %d characters, all under 2000'
            % (ch.name, len(sizes), max(sizes) if sizes else 0),
            sizes and all(0 < n < 2000 for n in sizes))
        yes('#%s: every channel mention was filled in' % ch.name,
            not any(re.search(r'<#[A-Z_]+>', m) for m in ch.sent))
        whole = text
        for key, c in found.items():
            whole = whole.replace('<#' + key + '>', c.mention)
        yes('#%s: nothing was lost or added between content.py and Discord' % ch.name,
            '\n\n'.join(ch.sent) == whole.strip())

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
