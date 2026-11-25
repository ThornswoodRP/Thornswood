"""Actual bot formatter for the site's gallery audit rows; no Discord sends."""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
import harness_bot  # noqa: E402

bot = harness_bot.whole()
passed = failed = 0


def yes(name, okay):
    global passed, failed
    print(('PASS ' if okay else 'FAIL ') + name)
    if okay:
        passed += 1
    else:
        failed += 1


picture = '20261125-' + 'a' * 40 + '.png'
for did, words in [('galleryapprove', 'accepted gallery picture'),
                   ('galleryremove', 'removed gallery picture'),
                   ('gallerydismiss', 'dismissed a report on gallery picture')]:
    row = {'did': did, 'byName': 'Current Aela', 'whoName': picture}
    text = bot.moderation_text('site', row)
    yes(did + ' says action, verified actor and complete generated filename',
        text is not None and '**Staff on the site:** Current Aela ' + words in text
        and picture in text and 'profile ' not in text)
    hostile = bot.moderation_text('site', {'did': did,
        'byName': '@everyone <@111111111111111111>',
        'whoName': '@everyone <@&111111111111111111> **[x](http://e.invalid).png'})
    yes(did + ' escapes names and cannot ping or format injected text',
        hostile is not None and '@everyone' not in hostile and '@\u200beveryone' in hostile
        and '<@111111111111111111>' not in hostile and '<@&111111111111111111>' not in hostile
        and '\\[x](http://e.invalid)' in hostile and '\\*\\*' in hostile)
    bounded = bot.moderation_text('site', {'did': did, 'byName': 'a' * 5000, 'whoName': 'b' * 5000})
    yes(did + ' stays within the existing message limit', bounded is not None and len(bounded) <= 1900)

print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
