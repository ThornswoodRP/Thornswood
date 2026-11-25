"""
_pyguard.py

The one Python version check for the bot and every bot test (#2276). Import
it first, before anything else:

    import _pyguard  # noqa: F401

The bot runs on Python 3.12 (Install-Bot.ps1). The hash-locked requirements
support 3.11 and 3.12: Pillow needs at least 3.11, and from 3.13 discord.py
needs audioop-lts, which this lock does not include (#4502).

Standard library only, and nothing that will not parse on an old Python, so
an unsupported interpreter sees this message before any library import.
"""
import sys

SUPPORTED_PYTHON = ((3, 11), (3, 12))


def unsupported_python(version=None, exe=None):
    """None on a supported Python, otherwise a plain diagnostic."""
    v = tuple(version or sys.version_info)[:3]
    if v[:2] in SUPPORTED_PYTHON:
        return None
    supported = ' or '.join('%d.%d' % pair for pair in SUPPORTED_PYTHON)
    return ('The Thornswood bot needs Python %s (it runs on 3.12), '
            'and this is Python %s at %s. On Windows, run it with py -3.12 '
            'instead of python.' % (supported, '.'.join(str(x) for x in v),
                                    exe or sys.executable))


def require():
    said = unsupported_python()
    if said:
        raise SystemExit(said)


require()
