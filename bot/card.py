"""
Draws the card that goes up when somebody joins.

Pillow only, and the background is a file rather than something generated at
runtime, so a join never waits on anything and a failure here can never stop
the greeting going out. bot.py falls back to plain text if this throws.

Names on Discord are dressed up: letters from the mathematical alphabets
(so MemeLordMaka arrives as bold script letters), fullwidth letters, circled
letters, and emoji on either end. The serif that draws the name has none of
those glyphs and on 2026-09-16 a card went up reading as a row of boxes. So
the name is folded back to ordinary letters first (NFKC does that in one
call), and whatever the serif still cannot draw is drawn from the system's
emoji font, then its symbol and CJK fonts, run by run along one baseline.
What no font knows is left out rather than drawn as a box, and a name with
nothing drawable left falls back to the account name.
"""
import io
import os
import unicodedata

from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
BACKGROUND = os.path.join(HERE, 'assets', 'join-card.png')

GOLD = (201, 162, 75)
PAGE = (232, 229, 219)
QUIET = (150, 158, 143)

# Windows ships all of these somewhere in this list. The first one that opens
# wins, and the last resort is Pillow's own bitmap font, which is ugly but is
# never the reason a card does not appear.
SERIF = ['georgiab.ttf', 'constanb.ttf', 'pala.ttf', 'timesbd.ttf',
         'DejaVuSerif-Bold.ttf']
SANS = ['segoeui.ttf', 'calibri.ttf', 'arial.ttf', 'DejaVuSans.ttf']
# For the characters the serif has no glyph for. Segoe UI Emoji is a colour
# font and Pillow draws it in colour; Noto Color Emoji is the Linux stand-in.
EMOJI = ['seguiemj.ttf', 'NotoColorEmoji.ttf']
# Then symbols, Chinese, Japanese, Korean, Indic and African scripts, in the
# bold weights Windows Server ships. Every one that exists is tried in turn.
OTHERS = ['seguisym.ttf', 'msyhbd.ttc', 'YuGothB.ttc', 'malgunbd.ttf',
          'NirmalaB.ttf', 'ebrimabd.ttf', 'segoeuib.ttf', 'DejaVuSans-Bold.ttf']
FONT_DIRS = ('C:/Windows/Fonts', '/usr/share/fonts/truetype/dejavu',
             '/usr/share/fonts/truetype/noto', '')

# Emoji glyphs are drawn a little under the letter size, or they tower over
# the name they sit in.
EMOJI_SCALE = 0.86


def _font(names, size):
    for n in names:
        f = _find(n, size)
        if f is not None:
            return f
    return ImageFont.load_default()


def _find(name, size):
    for d in FONT_DIRS:
        p = os.path.join(d, name) if d else name
        if d and not os.path.exists(p):
            continue
        try:
            return ImageFont.truetype(p, size)
        except OSError:  # a bare name not found, or a file Pillow cannot open as a font
            continue
    return None


def _emoji_font(size):
    """The emoji font at this size, and the factor its drawing has to be
       shrunk by. Colour bitmap fonts (Noto Color Emoji) only open at their
       one built-in size, so those come back at that size with a factor
       below 1; a scalable one comes back at the size asked with 1. None when
       there is no emoji font at all."""
    for n in EMOJI:
        for d in FONT_DIRS:
            p = os.path.join(d, n) if d else n
            if d and not os.path.exists(p):
                continue
            try:
                return ImageFont.truetype(p, size), 1.0
            except OSError:  # not scalable: it opens only at its built-in size, tried below
                pass
            for fixed in (109, 128, 136, 160, 96, 72, 64, 48, 32):
                try:
                    return ImageFont.truetype(p, fixed), float(size) / fixed
                except OSError:  # not this size; the next built-in size is tried
                    continue
    return None, 1.0


def _fallbacks(size):
    """(font, shrink, colour) in the order tried for what the serif cannot
       draw: the emoji font, then each of the symbol and script fonts."""
    out = []
    f, s = _emoji_font(int(round(size * EMOJI_SCALE)))
    if f is not None:
        out.append((f, s, True))
    for n in OTHERS:
        f = _find(n, size)
        if f is not None:
            out.append((f, 1.0, False))
    return out


_MISSING = {}


def _has(font, ch):
    """Whether this font has a glyph of its own for ch. Pillow does not expose
       the character map, so the character is drawn and compared with what
       the font draws for a character no font has, its missing-glyph box."""
    try:
        key = (getattr(font, 'path', None), getattr(font, 'size', None))
        ref = _MISSING.get(key) if key[0] else None
        if ref is None:
            ref = _shape(font, '\U000F0000')
            if key[0]:
                _MISSING[key] = ref
        return _shape(font, ch) != ref
    except Exception:
        return False


def _shape(font, ch):
    """The rendered pixels of one character, as something comparable."""
    m = font.getmask(ch)
    return (tuple(m.size), bytes(m))


def _plain(text):
    """The name with its dressing-up undone: mathematical, fullwidth and
       circled letters back to ordinary ones, and the invisible joiners and
       variation selectors that emoji sequences carry dropped, because
       without a shaping engine they would each draw as a box."""
    text = unicodedata.normalize('NFKC', text or '')
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat in ('Cc', 'Cf', 'Mn', 'Me', 'Cs', 'Co', 'Cn'):
            continue
        if 0x1F3FB <= ord(ch) <= 0x1F3FF:      # skin tone modifiers
            continue
        out.append(ch)
    return ' '.join(''.join(out).split())


def _runs(text, main, fallbacks):
    """[font, text, shrink, colour] runs: the main font for everything it can
       draw, the first fallback that knows each other character, and nothing
       for what no font knows."""
    runs = []
    for ch in text:
        pick = None
        if ch.isspace() or _has(main, ch):
            pick = (main, 1.0, False)
        else:
            for f, s, col in fallbacks:
                if _has(f, ch):
                    pick = (f, s, col)
                    break
        if pick is None:
            continue
        if runs and runs[-1][0] is pick[0]:
            runs[-1][1] += ch
        else:
            runs.append([pick[0], ch, pick[1], pick[2]])
    return runs


def _width(draw, runs):
    w = 0.0
    for f, t, s, _ in runs:
        w += draw.textlength(t, font=f) * s
    return w


def _fit(draw, text, start, maxw, minsize=28):
    """Shrink until it fits rather than cutting it off, because a name that is
       cut off is worse than a name that is small. Returns the main font and
       the runs to draw."""
    size = start
    while True:
        main = _font(SERIF, size)
        runs = _runs(text, main, _fallbacks(size))
        if _width(draw, runs) <= maxw or size <= minsize:
            return main, runs
        size -= 2


def _draw_runs(base, draw, x, baseline, runs, fill):
    """Left to right along one baseline. Colour fonts are drawn in colour; a
       bitmap emoji font is drawn at its own size on a patch and shrunk into
       place."""
    for f, t, s, col in runs:
        w = draw.textlength(t, font=f)
        if s == 1.0:
            if col:
                try:
                    draw.text((round(x), baseline), t, font=f, anchor='ls',
                              embedded_color=True)
                except Exception:
                    draw.text((round(x), baseline), t, font=f, fill=fill, anchor='ls')
            else:
                draw.text((round(x), baseline), t, font=f, fill=fill, anchor='ls')
            x += w
            continue
        # Not in a try any more (#2736): a glyph that could not be drawn was
        # left out of the name with nothing said. A failure here now fails the
        # card, which on_member_join logs with its trace and greets without.
        asc, desc = f.getmetrics()
        pw, ph = int(w) + 4, asc + desc + 4
        patch = Image.new('RGBA', (max(pw, 1), max(ph, 1)), (0, 0, 0, 0))
        pd = ImageDraw.Draw(patch)
        try:
            pd.text((2, asc + 2), t, font=f, anchor='ls', embedded_color=True)
        except Exception:
            pd.text((2, asc + 2), t, font=f, fill=fill, anchor='ls')
        small = patch.resize((max(int(pw * s), 1), max(int(ph * s), 1)),
                             Image.LANCZOS)
        base.alpha_composite(small, (int(round(x)),
                                     int(round(baseline - (asc + 2) * s))))
        x += w * s


def _circle(avatar_bytes, size):
    """The avatar, round, with a thin gold ring. Anti-aliased by drawing the
       mask four times the size and shrinking it."""
    im = Image.open(io.BytesIO(avatar_bytes)).convert('RGB')
    im = im.resize((size, size), Image.LANCZOS)

    big = size * 4
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, big - 1, big - 1], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)

    ring = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([6, 6, big - 7, big - 7], outline=GOLD + (255,),
                                 width=10)
    out.alpha_composite(ring.resize((size, size), Image.LANCZOS))
    return out


def shown_name(name, alt=None):
    """What the card will say for this name: the name folded to plain
       letters, or the account name when nothing is left of it, or
       'A traveller' when there is nothing at all."""
    for candidate in (name, alt):
        p = _plain(candidate)
        if p:
            return p
    return 'A traveller'


def render(name, avatar_bytes, number=None, line=None, alt=None):
    """PNG bytes. name is what to greet, number is which member they are,
       alt is the plain account name to fall back on when the display name
       has nothing the fonts can draw."""
    try:
        base = Image.open(BACKGROUND).convert('RGBA')
    except Exception:
        base = Image.new('RGBA', (1000, 360), (11, 14, 10, 255))
    W, H = base.size

    # A soft dark wash behind the text side only, so the art cannot eat the
    # words. scripts/oneoff/make-join-card.py darkens the banner under them as well.
    wash = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(wash).rectangle([300, 0, W, H], fill=(6, 8, 7, 120))
    wash = wash.filter(ImageFilter.GaussianBlur(40))
    base.alpha_composite(wash)

    # Discord hands the avatar over as a PNG (on_member_join asks for one), so
    # one that will not open is a fault worth its trace: it fails the card,
    # which on_member_join logs and greets without (#2736).
    if avatar_bytes:
        av = _circle(avatar_bytes, 196)
        base.alpha_composite(av, (74, (H - 196) // 2))

    d = ImageDraw.Draw(base)
    x = 316
    maxw = W - x - 60

    f_small = _font(SANS, 26)
    d.text((x, 96), (line or 'A traveller reaches the pass').upper(),
           font=_font(SANS, 24), fill=QUIET)

    text = shown_name(name, alt)
    f_name, runs = _fit(d, text, 62, maxw)
    if not ''.join(t for _, t, _, _ in runs).strip():
        # The display name had nothing any font knows. The account name is
        # plain letters by Discord's rules.
        text = shown_name(alt) if alt else 'A traveller'
        f_name, runs = _fit(d, text, 62, maxw)
    # The top of the name used to sit at 136; the same line, as a baseline,
    # so every font in the name shares it.
    baseline = 136 + f_name.getmetrics()[0]
    _draw_runs(base, d, x, baseline, runs, PAGE)

    if number:
        d.text((x, 228), 'The %s to walk in' % _ordinal(number),
               font=f_small, fill=GOLD)

    # A hairline under the name, the same one the site uses.
    d.line([(x, 214), (x + 120, 214)], fill=GOLD, width=2)

    out = io.BytesIO()
    base.convert('RGB').save(out, 'PNG', optimize=True)
    out.seek(0)
    return out


def describe(name, number=None, alt=None):
    """The card in words, for the image description a screen reader says in
       place of the picture (#4491): the name and the join number render()
       draws, which are otherwise only in the image."""
    words = 'Welcome card for %s' % shown_name(name, alt)
    if number:
        words += ', the %s to walk in' % _ordinal(number)
    return words + '.'


def _ordinal(n):
    n = int(n)
    if 10 <= n % 100 <= 20:
        suf = 'th'
    else:
        suf = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return '%d%s' % (n, suf)
