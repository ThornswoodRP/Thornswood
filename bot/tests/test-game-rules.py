"""
test-game-rules.py

The rules for playing have one copy, the /rules page, and #game-rules is read
out of it.

From issue #430, "The rules disagree with themselves on the one rule people
get banned over": #game-rules and lore\\game-rules.md said a fight with
another character is asked for out of character first, and
site\\data\\site\\rules.md said "Fights start freely". Two people in the same
fight could each be following the posted rules. Patrick decided on 28 Sep
that fights start freely and that the site page is the one source.

So this checks four things.

  1. One source. content.GAME_RULES carries every paragraph of the page's
     "In the World" part word for word, RULES (the Discord conduct rules) is
     still there beside it, and a copy of content.py pointed at an edited
     rules.md follows the edit, or refuses to load when the part has gone.
  2. No old wording. The site's sentence is in exactly one file, the page,
     and the "ask first" sentences are in none, across bot, site, lore,
     launcher and docs (docs\\archive is the record of how it was, and is
     left alone).
  3. The lore copy is a pointer to /rules and carries no rules of its own.
  4. The enforcement section names what exists: a Discord timeout and a
     removal, not a Moderator and then a Gamemaster in the world.

Read only, apart from a temporary folder it removes.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import importlib.util
import re
import shutil
import tempfile

ROOT = os.path.normpath(os.path.join(HERE, '..'))
RULES_MD = os.path.join(ROOT, 'site', 'data', 'site', 'rules.md')
JOIN_MD = os.path.join(ROOT, 'site', 'data', 'site', 'join.md')
LORE_MD = os.path.join(ROOT, 'lore', 'game-rules.md')
THIS = os.path.abspath(__file__)

# The site's sentence, and below the old ones, are each built from two
# halves, so this file is not itself a copy for issue #430's two searches to
# find.
SITE_SAYS = 'does not need ' + 'asking first'

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n')


def paragraphs(md):
    return [p.strip() for p in md.split('\n\n') if p.strip()]


def site_links(md):
    """Written out again here rather than borrowed from content.py, so a
       mistake in the one there is not checked against itself."""
    return re.sub(r'\]\((/[^)\s]*)\)', r'](<https://thornswood.net\1>)', md)


import content as C  # noqa: E402

rules_raw = read(RULES_MD)
GAME_RULES = getattr(C, 'GAME_RULES', '')
RULES = getattr(C, 'RULES', '')

# ------------------------------------------------------------ one source --
yes('content.py imports with both RULES and GAME_RULES (%d and %d characters)'
    % (len(RULES), len(GAME_RULES)), len(RULES) > 500 and len(GAME_RULES) > 500)
yes('RULES is still the Discord conduct rules, left as they were',
    RULES.startswith('# Rules\n') and 'Nothing sexual involving minors, ever.' in RULES
    and 'Push to talk.' in RULES)

world = rules_raw.split('\n# In the World\n', 1)
yes('rules.md still has its "# In the World" part', len(world) == 2)
world = world[-1].split('\n# ', 1)[0]
want = [p for p in paragraphs(site_links(world)) if p != '---']
missing = [p for p in want if p not in GAME_RULES]
yes('every one of the %d paragraphs of "In the World" is in #game-rules word for word'
    % len(want), want and not missing)
for p in missing[:3]:
    print('      not there: ' + p[:70].replace('\n', ' '))

yes('#game-rules says fights start freely',
    '## 3. Fights start freely. What they cost does not' in GAME_RULES
    and SITE_SAYS in GAME_RULES)
yes('#game-rules names the page it is read out of',
    'https://thornswood.net/rules' in GAME_RULES)
yes('#game-rules has no relative site link Discord could not follow',
    re.search(r'\]\(/', GAME_RULES) is None)
yes('#game-rules has no --- line, which Discord shows as three dashes',
    not any(line.strip() == '---' for line in GAME_RULES.split('\n')))
yes('#game-rules has no em dash', chr(0x2014) not in GAME_RULES)
yes('#game-rules calls nobody by the word the house rules keep out',
    re.search(r'\bplayers?\b', GAME_RULES, re.I) is None)

builder = read(os.path.join(HERE, 'Build-Discord.py'))
# Since #3317 a plan line says post=True and its key names the words in
# content.py's DOCS, so every written channel keeps a changelog.
content_src = read(os.path.join(HERE, 'content.py'))
yes('Build-Discord.py still posts content.GAME_RULES into #game-rules',
    re.search(r"name='game-rules',\s*key='GAMERULES'[^)]*?post=True", builder, re.S) is not None
    and re.search(r"'GAMERULES':\s*GAME_RULES,", content_src) is not None)
yes('and its topic counts nine rules, as the page has',
    'Nine rules, and what we let slide.' in builder and 'Ten rules' not in builder)

# --------------------------------------- one source: an edited rules.md --
TMP = tempfile.mkdtemp(prefix='thornswood-game-rules-')
try:
    os.makedirs(os.path.join(TMP, 'bot'))
    os.makedirs(os.path.join(TMP, 'site', 'data', 'site'))
    shutil.copy(os.path.join(HERE, 'content.py'), os.path.join(TMP, 'bot', 'content.py'))
    shutil.copy(JOIN_MD, os.path.join(TMP, 'site', 'data', 'site', 'join.md'))
    # #factions is read out of lore/factions.md since #3317.
    os.makedirs(os.path.join(TMP, 'lore'))
    shutil.copy(os.path.join(HERE, '..', 'lore', 'factions.md'),
                os.path.join(TMP, 'lore', 'factions.md'))

    def load_with(md, tag):
        with open(os.path.join(TMP, 'site', 'data', 'site', 'rules.md'), 'w',
                  encoding='utf-8', newline='\n') as f:
            f.write(md)
        spec = importlib.util.spec_from_file_location(
            'content_' + tag, os.path.join(TMP, 'bot', 'content.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    edited = rules_raw.replace('Go and get killed by a\ndraugr.',
                               'Go and get eaten by a\nfrostbite spider.')
    try:
        mod = load_with(edited, 'edited')
        yes('an edit to rules.md reaches #game-rules with nothing else changed',
            'frostbite spider' in mod.GAME_RULES and 'draugr' not in mod.GAME_RULES)
    except Exception as e:
        yes('an edit to rules.md reaches #game-rules (content.py did not load: %r)' % (e,), False)

    try:
        load_with(rules_raw.replace('# In the World', '# Out of the World'), 'gone')
        refused = False
    except ValueError:
        refused = True
    except Exception:
        refused = False
    yes('a rules.md without "# In the World" stops content.py loading, rather '
        'than posting an empty #game-rules', refused)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

# ------------------------------------------------------- no old wording --
OLD = [
    'Ask before ' + 'you draw',
    'Fights between people ' + 'are agreed first',
    'One line out of character ' + 'before you draw',
    'takes one line out of ' + 'character first',
    'needs both of you ' + 'wanting it',
]
LOOK_IN = ['bot', 'site', 'lore', 'launcher', 'docs']
SKIP_DIRS = {'node_modules', 'archive', '.git', 'bin', 'obj'}
KINDS = ('.md', '.py', '.js', '.cs', '.xaml', '.html', '.txt', '.json')


def every_file():
    for top in LOOK_IN:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, top)):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                path = os.path.join(dirpath, name)
                if name.endswith(KINDS) and os.path.abspath(path) != THIS:
                    yield path


said = []
old = {}
for path in every_file():
    try:
        text = read(path)
    except (UnicodeDecodeError, OSError):
        continue
    flat = re.sub(r'\s+', ' ', text)
    rel = os.path.relpath(path, ROOT).replace('\\', '/')
    if SITE_SAYS in flat:
        said.append(rel)
    for o in OLD:
        if re.sub(r'\s+', ' ', o) in flat:
            old.setdefault(rel, []).append(o.replace('\n', ' '))

yes('"%s" is in exactly one file, the rules page (found in: %s)'
    % (SITE_SAYS, ', '.join(said) or 'none'), said == ['site/data/site/rules.md'])
yes('the "ask first" fight rule is in no file' +
    ('' if not old else ': ' + '; '.join('%s says "%s"' % (k, v[0]) for k, v in sorted(old.items()))),
    not old)

# ------------------------------------------------ the lore copy points --
lore = read(LORE_MD)
yes('lore/game-rules.md points at /rules', 'https://thornswood.net/rules' in lore)
yes('lore/game-rules.md carries no numbered rules of its own',
    re.search(r'^## \d', lore, re.M) is None)

# ---------------------------------------------------- the enforcement --
enforce = rules_raw.split('\n## How this is enforced\n', 1)[-1].split('\n### ', 1)[0]
yes('rules.md still has "How this is enforced"', '## How this is enforced' in rules_raw)
yes('the enforcement names a Discord timeout and a removal, which exist',
    'times you out in the Discord' in enforce and 'removes you' in enforce)
yes('and no longer escalates to a Gamemaster after a Moderator',
    'a Moderator gets involved. After that, a Gamemaster' not in rules_raw)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
