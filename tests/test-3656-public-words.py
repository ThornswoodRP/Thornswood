"""
test-3656-public-words.py

    python tests/test-3656-public-words.py

Issue #3656. On 27 Oct the #lore and #factions posts and their Changelog
threads went out saying "Patrick confirmed it (#3656)", and #factions "as
Patrick approved them". Patrick, 30 Oct: "the discord changelogs can't have
this", "especially the public sided lore and infomation ones". How the team
decided a change is not what changed, and an issue number means nothing to
somebody reading the Discord or the site.

bot/content.py's NOT_PUBLIC says what a public line never says, and
Apply-Discord.py's check_docs refuses to build while a change line or the
live words of a doc say it. That refusal runs only when the Discord is
built, so this runs the same check on every pull request, with nothing but
the standard library. It proves:
  - no change line of any doc, and no live words of a doc, says an issue or
    pull request number or a team member's name;
  - a line saying "Patrick confirmed it (#3656)" is named twice, once for
    the number and once for the name, and a channel name (#lore) is not a
    number;
  - a draft's words are not checked, since a draft is never posted, but
    its change lines are;
  - no page the site shows (site/data/site, lines.md aside, which is no
    page) says an issue or pull request number outside an HTML comment.
Read only. Never connects to anything.
"""
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bot'))
os.environ.pop('THORNSWOOD_OPEN', None)
import content as C  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


keys = sorted(set(C.DOCS) | set(C.CHANGES))
found = C.unpublic(keys)
for key, where, what, words in found:
    print('      %s, %s: %s: "%s"' % (key, where, what, words))
yes('no change line and no live words of a doc say an issue number or a team member\'s name (%d docs)'
    % len(keys), found == [] and len(keys) > 0)

said = C.not_public('Eirik has held the crown twenty-three years. Patrick confirmed it (#3656).')
yes('"Patrick confirmed it (#3656)" is named for the number and for the name',
    sorted(w for w, _ in said) == sorted(['an issue or pull request number',
                                         'a name of somebody on the team, which says how it '
                                         'was decided, not what changed']))
yes('a channel name such as #lore or #test-findings is not a number',
    C.not_public('The full history is in #lore, and bugs go in #test-findings.') == [])

yes('"issue <n>" without hash is refused as an issue or pull request number',
    any(w == 'an issue or pull request number' for w, _ in C.not_public('See issue 3656.')))
yes('"PR <n>" without hash is refused as an issue or pull request number',
    any(w == 'an issue or pull request number' for w, _ in C.not_public('Fixed in PR 4510.')))

NAMES_3693 = [
    'Patrick', 'Djinn', 'Gav\x69n', 'Jhinswife', 'WiccanDjinn',
    'Claude', 'Grok', 'Codex', 'ChatGPT', 'Smeagle', 'Anvil',
    'Herald', 'Waystone', 'Wyrd', 'Cursor',
]
for index, name in enumerate(NAMES_3693, 1):
    for case, variant in enumerate((name.lower(), name.upper(), name), 1):
        hit = C.not_public('Confirmed by %s.' % variant)
        yes('name %d is refused in casing %d' % (index, case),
            any('a name of somebody on the team' in w for w, _ in hit))

# Planted, in memory only: the file is never written.
draft = 'DEVRULES'
saved_drafts = C.DRAFTS
C.DRAFTS = saved_drafts + (draft,)
saved_doc, saved_lines = C.DOCS[draft], C.CHANGES.get(draft)
try:
    C.DOCS[draft] = saved_doc + '\nAsk Patrick.'
    yes('a draft\'s words are not checked, since a draft is never posted', C.unpublic([draft]) == [])
    C.CHANGES[draft] = [('2026-10-30', 'Written for #3656.', '000000000000')]
    yes('but a draft\'s change lines are',
        [w for _k, where, w, _ in C.unpublic([draft])] == ['an issue or pull request number'])
finally:
    C.DRAFTS = saved_drafts
    C.DOCS[draft] = saved_doc
    if saved_lines is None:
        C.CHANGES.pop(draft, None)
    else:
        C.CHANGES[draft] = saved_lines

key = 'FACTIONS'
saved = C.CHANGES[key]
try:
    C.CHANGES[key] = saved + [('2026-10-30', 'Patrick approved them.', saved[-1][2])]
    yes('a live doc\'s change line with a team member\'s name is named',
        [(k, where) for k, where, _w, _ in C.unpublic([key])] == [(key, 'its change line of 2026-10-30')])
finally:
    C.CHANGES[key] = saved

def no_comments(text):
    """The text with its HTML comments out, as noComments in site/lib/pages.js
    does it (#5641): the pass runs until nothing changes, since one pass can
    join two halves into a new opener, and an opener with no end hides the
    rest."""
    was = None
    while was != text:
        was, text = text, re.sub(r'<!--[\s\S]*?-->', '', text)
    open_at = text.find('<!--')
    return text if open_at < 0 else text[:open_at]


SITE = ROOT / 'site' / 'data' / 'site'
pages = sorted(p for p in SITE.glob('*.md') if p.name != 'lines.md')
numbered = []
for p in pages:
    text = no_comments(p.read_text(encoding='utf-8'))
    for n, line in enumerate(text.splitlines(), 1):
        if re.search(r'#\d', line):
            numbered.append('%s: %s' % (p.name, line.strip()))
for n in numbered:
    print('      ' + n)
yes('no page the site shows says an issue or pull request number (%s)'
    % ', '.join(p.name for p in pages), numbered == [] and len(pages) > 0)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
