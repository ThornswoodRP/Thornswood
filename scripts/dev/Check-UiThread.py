"""
Check-UiThread.py

Finds, and offers to fix, every place the launcher touches the window from a
background thread.

WHY

A playtester's launcher said, on 21 September:

    Could not check profile 1893288986 in with thornswood.net: The calling
    thread cannot access this object because a different thread owns it

on a check in that had SUCCEEDED. Shell.CheckIn runs on a ThreadPool thread. Its
success line called Log(), which writes txtStatus.Text straight at a WPF object,
so it threw; the catch below it reported the throw with PresenceLog, which does
go through the Dispatcher and therefore worked. The launcher told somebody it had
failed to do the thing it had just done.

WHY A SIMPLER SCAN DOES NOT FIND IT, and this is the whole reason this file
exists rather than a grep. The bad call is not inside the delegate:

    ThreadPool.QueueUserWorkItem(delegate {
        foreach (int id in ids) CheckIn(id);     <- the delegate
    });
    ...
    static void CheckIn(int id) { ... Log(...) ... }   <- the call is in here

Anything that only reads the delegate's own braces sees nothing. The first
version of this check did exactly that, was run against the version that HAS the
bug, and reported nothing, which is the only reason it was not believed.

So this follows calls out of the delegate, --depth of them, one by default.

WHAT COUNTS AS SAFE. A call inside a Dispatcher.UIThread.Post, Invoke or
InvokeAsync block (Avalonia's, since #4823; WPF's Dispatcher.Invoke and
BeginInvoke before it) is already on the right thread, and so is one in a method that asks
CheckAccess() first, which is what SafeLog does. Log itself is not reported:
touching the window is its whole job, and the fault is calling it from the wrong
thread rather than its own body.

WHAT IT TOOK TO MAKE IT WORTH READING, because a scan that cries wolf is worse
than no scan. It reported 249 places to begin with and one of them was real. In
order:

  249 -> the closure had no end, so a shared helper seeded once made most of a
         WPF launcher background code. Depth is bounded now.
   15 -> it seeded from the raw delegate body, including the Dispatcher block
         at the end of it where the UI work correctly lives.
   14 -> it read 'if (' and 'foreach (' as calls.
   14 -> new Thread(Loop) has no braces, so the brace search ran forward into
         the next unrelated block and swallowed it. Bounded to the call's own
         brackets.
    1 -> and the last one: methods were keyed by NAME, so seeding Downgrade.Run,
         which really is on a thread, dragged in Shell.Run, a different method
         in a different class, and thirteen of its perfectly good Log calls with
         it. An unqualified call in C# resolves inside its own class, so that is
         how they are looked up now.

One finding on the version that has the bug, at every depth, and nothing at all
on the version without it. That is the only reason to believe it.

WHAT IT FIXES. One thing, mechanically: Log( -> PresenceLog( on a background
path, which is the same line put through the Dispatcher. Anything else it finds,
a control assigned to directly, is printed and left alone, because there is no
one right way to move that and a script guessing is worse than a person reading.

Usage:
    python scripts/dev/Check-UiThread.py
    python scripts/dev/Check-UiThread.py --fix
    python scripts/dev/Check-UiThread.py --depth 3
    python scripts/dev/Check-UiThread.py --app <folder>     (to check it catches things)

Exit code 1 when anything is found and not fixed.
"""

import argparse
import io
import os
import re
import sys

# Calls that go at the window with nothing between. PresenceLog is the marshalled
# twin of Log and is deliberately not here.
UNSAFE_CALLS = {'Log'}
# A control assigned to directly. Named by the prefixes this launcher uses.
CONTROL_WRITE = re.compile(
    r'\b((?:txt|btn|lst|img|pnl|grid|chk|lbl|bar|tab|win)[A-Za-z0-9_]*)\s*\.\s*\w+\s*=[^=]')
# Avalonia's (#4823): every hand back to the window goes through
# Dispatcher.UIThread. The launcher on WPF used Dispatcher.BeginInvoke and
# Dispatcher.Invoke, which name nothing in the launcher now.
DISPATCHER = ('Dispatcher.UIThread.Post', 'Dispatcher.UIThread.InvokeAsync', 'Dispatcher.UIThread.Invoke')
BACKGROUND = ('ThreadPool.QueueUserWorkItem', 'new Thread(', 'Task.Run(')

# Words that are followed by a bracket and are not calls. Without this the
# closure below treats every if and foreach as a method and marks most of the
# launcher as background code: the first run of this reported 249 places, nearly
# all of them page builders that only ever run on the window's thread.
NOT_CALLS = {
    'if', 'for', 'foreach', 'while', 'switch', 'catch', 'lock', 'using', 'return',
    'fixed', 'sizeof', 'typeof', 'nameof', 'new', 'delegate', 'checked', 'unchecked',
    'do', 'else', 'get', 'set', 'add', 'remove', 'when', 'yield', 'throw',
}

# A call to a method of THIS class, which is one with nothing in front of it.
# Verify.Run(cfg) and Shell.Run(args) are different methods that a name alone
# cannot tell apart, and conflating them put thirteen of Run()'s perfectly good
# Log calls on the list. The lookbehind is what keeps a qualified call out.
CALL = re.compile(r'(?<![\w.])([A-Za-z_]\w*)\s*\(')

# A Log inside one of these is already on the window's thread and is right as it
# is. SafeLog is the one that does this and it was reported as a fault until the
# check learned to read it.
CHECKACCESS = re.compile(r'CheckAccess\s*\(\s*\)')

METHOD = re.compile(
    r'^[ \t]*(?:\[[^\]]*\][ \t]*)*'
    r'(?:public|private|internal|protected|static|async|override|virtual|sealed|extern|unsafe|new)[\w \t]*?'
    r'\b([A-Za-z_]\w*)\s*\([^;{)]*\)\s*$', re.M)


def brace_span(text, start):
    """The (open, close) index of the brace block at or after start, or None."""
    i = text.find('{', start)
    if i < 0:
        return None
    depth, j = 0, i
    while j < len(text):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return (i, j)
        j += 1
    return None


def paren_span(text, start):
    """The (open, close) of the bracket pair at or after start, or None."""
    i = text.find('(', start)
    if i < 0:
        return None
    depth, j = 0, i
    while j < len(text):
        if text[j] == '(':
            depth += 1
        elif text[j] == ')':
            depth -= 1
            if depth == 0:
                return (i, j)
        j += 1
    return None


def background_body(text, at, mark):
    """What runs on the background thread for one marker, as (kind, value).

    ('block', (lo, hi))  an inline delegate or lambda: its braces.
    ('method', name)     a method group, as in new Thread(Loop): that method.

    THE SECOND CASE IS WHY THIS FUNCTION EXISTS. Presence.cs has
    'worker = new Thread(Loop);' with no braces at all. Looking for the next
    open brace from there ran forward into whatever came next in the file and
    swallowed a large unrelated region, which is how Shell.Run ended up seeded
    as background code and thirteen of its perfectly good Log calls ended up on
    the list. The search is bounded to the call's own brackets now.
    """
    args = paren_span(text, at + len(mark) - (1 if mark.endswith('(') else 0))
    if not args:
        return None
    lo, hi = args
    brace = text.find('{', lo, hi)
    if brace >= 0:
        span = brace_span(text, brace)
        if span and span[1] <= hi:
            return ('block', span)
        return None
    inside = text[lo + 1:hi].strip()
    if re.match(r'^[A-Za-z_]\w*$', inside):
        return ('method', inside)
    return None


def methods_in(text):
    """name -> (open, close) for every method body in the file."""
    out = {}
    for m in METHOD.finditer(text):
        span = brace_span(text, m.end())
        if span:
            out.setdefault(m.group(1), []).append(span)
    return out


def blanked(text, lo, hi):
    """The body with every Dispatcher block replaced by spaces."""
    body = list(text[lo:hi])
    for mark in DISPATCHER:
        pos = 0
        while True:
            at = text.find(mark, lo, hi)
            if at < 0:
                break
            span = brace_span(text, at)
            if not span or span[1] > hi:
                # No block of its own; blank the call itself so it is not read
                # as a bare window touch.
                for k in range(at - lo, min(at - lo + len(mark), len(body))):
                    body[k] = ' '
                text = text[:at] + ' ' * len(mark) + text[at + len(mark):]
                continue
            for k in range(span[0] - lo, min(span[1] - lo + 1, len(body))):
                body[k] = ' '
            text = text[:span[0]] + ' ' * (span[1] - span[0] + 1) + text[span[1] + 1:]
    return ''.join(body)


def scan(app, depth=1):
    files = {}
    for name in sorted(os.listdir(app)):
        if name.endswith('.cs'):
            files[name] = io.open(os.path.join(app, name),
                                  encoding='utf-8-sig', errors='replace').read()

    """
    KEYED BY FILE AND NAME, NOT BY NAME.

    Downgrade.Run and Shell.Run are different methods in different classes with
    one name between them. Keying on the name alone meant that seeding
    Downgrade.Run, which really is on a background thread, dragged Shell.Run in
    with it and put thirteen of its perfectly good Log calls on the list.

    An unqualified call in C# resolves inside its own class, and a call to
    another class is written with the class in front of it and is already
    excluded by CALL. So a name is looked up in the file it was written in and
    nowhere else.
    """
    bodies = {}
    for name, text in files.items():
        per = {}
        for meth, spans in methods_in(text).items():
            for lo, hi in spans:
                per.setdefault(meth, []).append((lo, hi, blanked(text, lo, hi)))
        bodies[name] = per

    # Seeds: the code inside a background delegate, in the file it is written in.
    seeds = set()
    for name, text in files.items():
        for mark in BACKGROUND:
            at = 0
            while True:
                at = text.find(mark, at)
                if at < 0:
                    break
                what = background_body(text, at, mark)
                if what and what[0] == 'method':
                    # new Thread(Loop): that method is the background thread.
                    seeds.add((name, what[1]))
                    at += len(mark)
                    continue
                span = what[1] if what else None
                if span:
                    # WITH THE DISPATCHER BLOCKS TAKEN OUT FIRST. A background
                    # delegate almost always ends by marshalling its result back
                    # with Dispatcher.UIThread.Post, and everything inside THAT
                    # runs on the window's thread. Seeding from the raw body
                    # marked every page builder in the launcher as background
                    # code: the first run reported 249 places and buried the one
                    # real fault among them.
                    inner = blanked(text, span[0], span[1])
                    for call in CALL.finditer(inner):
                        if call.group(1) not in NOT_CALLS:
                            seeds.add((name, call.group(1)))
                at += len(mark)

    """
    HOW FAR TO FOLLOW, AND WHY NOT ALL THE WAY.

    Following every call to the end was tried first and it is useless: it reports
    248 places, nearly all of them page builders like BuildDiag and BuildNews
    that only ever run on the window's thread. The reason is that a widely used
    helper gets seeded once and then everything IT calls is background too, and
    within three hops that is most of the launcher.

    A regex cannot tell a method called on the pool path from the same method
    called on the window's thread a page later, so the closure cannot be made
    sound. What it can be is SHALLOW and honest: one hop finds the real fault,
    because a background delegate that does work calls the method that does it.
    CheckIn is exactly that shape and is what this was written for.

    So depth is a knob with a default of 1 and the trade written next to it.
    Deeper finds more and means more of it is wrong; this says what it looked at
    rather than implying it looked everywhere.
    """
    background = set()
    frontier = set(k for k in seeds if k[1] in bodies.get(k[0], {}))
    for _hop in range(depth):
        background |= frontier
        nxt = set()
        for fname, meth in frontier:
            for _lo, _hi, bare in bodies[fname][meth]:
                for call in CALL.finditer(bare):
                    nm = call.group(1)
                    key = (fname, nm)
                    if nm in bodies[fname] and key not in background and nm not in NOT_CALLS:
                        nxt.add(key)
        frontier = nxt
        if not frontier:
            break

    found = []
    for fname, meth in sorted(background):
        for lo, hi, bare in bodies[fname].get(meth, []):
            name = fname
            text = files[name]
            # A method that asks CheckAccess() first is marshalling by hand and
            # every Log in it is correct. SafeLog is that method.
            if CHECKACCESS.search(bare):
                continue
            # And Log itself is not a fault. Touching the window is its whole
            # job; the fault is calling it from the wrong thread, which is what
            # every other line here is about. Reporting its own body as a
            # window touch is reporting the definition of the thing.
            if meth in UNSAFE_CALLS:
                continue
            for call in CALL.finditer(bare):
                if call.group(1) not in UNSAFE_CALLS:
                    continue
                at = lo + call.start()
                found.append({'file': name, 'at': at, 'method': meth,
                              'line': text.count('\n', 0, at) + 1,
                              'kind': 'call', 'what': call.group(1)})
            for w in CONTROL_WRITE.finditer(bare):
                at = lo + w.start()
                found.append({'file': name, 'at': at, 'method': meth,
                              'line': text.count('\n', 0, at) + 1,
                              'kind': 'write', 'what': w.group(1)})
    return files, background, found


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    # scripts\dev sits two folders under the repository. Three was right
    # when this file lived one folder deeper, and with no arguments the
    # default then pointed above the repository and crashed (#1216).
    ap.add_argument('--app', default=os.path.join(here, '..', '..', 'launcher', 'app'))
    ap.add_argument('--depth', type=int, default=1,
                    help='how many calls deep to follow from a background delegate')
    ap.add_argument('--fix', action='store_true',
                    help='rewrite Log( as PresenceLog( on a background path')
    args = ap.parse_args()

    files, background, found = scan(args.app, args.depth)
    print('%d method(s) within %d call(s) of a background delegate'
          % (len(background), args.depth))
    if not found:
        print('Nothing touches the window from one.')
        return 0

    print('')
    print('%d place(s) touch the window from a background thread:' % len(found))
    for f in found:
        how = ('calls ' + f['what'] + '()') if f['kind'] == 'call' \
              else ('assigns to ' + f['what'])
        print('  %-12s line %-6d %-22s %s' % (f['file'], f['line'], f['method'] + '()', how))

    fixable = [f for f in found if f['kind'] == 'call' and f['what'] == 'Log']
    if not args.fix:
        print('')
        print('%d of them are Log() and can be rewritten as PresenceLog() with --fix.'
              % len(fixable))
        if len(fixable) != len(found):
            print('The rest assign to a control directly and want a person: there is no one')
            print('right place to put the Dispatcher and a script guessing is worse.')
        return 1

    # Latest first, so an earlier edit cannot move a later offset.
    done = {}
    for f in sorted(fixable, key=lambda x: -x['at']):
        text = files[f['file']]
        at = f['at']
        if text[at:at + 4] != 'Log(':
            print('  skipped %s line %d: it does not read Log( any more'
                  % (f['file'], f['line']))
            continue
        files[f['file']] = text[:at] + 'PresenceLog(' + text[at + 4:]
        done[f['file']] = done.get(f['file'], 0) + 1
    for name, n in sorted(done.items()):
        io.open(os.path.join(args.app, name), 'w', encoding='utf-8-sig',
                newline='').write(files[name])
        print('  %s: %d call(s) put through the Dispatcher' % (name, n))
    left = len(found) - sum(done.values())
    print('')
    print('%d fixed, %d left for a person.' % (sum(done.values()), left))
    return 1 if left else 0


if __name__ == '__main__':
    sys.exit(main())
