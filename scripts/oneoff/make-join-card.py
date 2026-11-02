"""
make-join-card.py

Builds bot/assets/join-card.png, the picture every join card is drawn on, from
the Thornswood banner art in bot/.

One-shot generator; lives under scripts/oneoff/ so bot tooling sweeps do not
treat it as production bot code.

    python scripts/oneoff/make-join-card.py              writes bot/assets/join-card.png
    python scripts/oneoff/make-join-card.py --out FILE   writes FILE instead, to look at

Patrick, 24 September, with a tester's note "make it a Thornswood banner":
"the banner backgound needs changed to the thornswood". The card had been
drawn on a plain starfield with nothing of Thornswood in it.

Built from invite-splash-1920x1080.jpg rather than server-banner-960x540.png:
the two are the same picture, and the card is 1000 wide, so the 960 banner
would have to be scaled up and the 1920 one is scaled down. The wordmark sits
across the middle of the upper half and the name is drawn across the middle
of the card, so the crop is the landscape under the wordmark: the traveller
on the rock sits under the avatar, and the lake and the towns sit under the
name.

The art is far brighter and busier than the starfield was, so the area under
the words is darkened, and the ring round the avatar gets a darker patch to
sit on. card.render still lays its own wash over the text side, so what these
numbers are tuned for is what the words end up on, and
bot/tests/test-join-card.py measures that against the starfield card, and runs this
script from scripts/oneoff/.
Only the background changes: card.py draws the same size, layout, fonts and
colours it always did.

Pillow only. Never connects to anything.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
BOT = os.path.normpath(os.path.join(HERE, '..', '..', 'bot'))
SOURCE = os.path.join(BOT, 'invite-splash-1920x1080.jpg')
OUT = os.path.join(BOT, 'assets', 'join-card.png')

# The card, and where card.render puts things on it.
W, H = 1000, 360
AVATAR = (74, 82, 270, 278)            # the circle, left side
TEXT = (290, 52, W + 60, 300)          # the three lines and the gold rule

# The part of the art that is used: the full height below the wordmark, whose
# lowest point, the tip of the thorn crest, is at y 457 in the 1920 picture
# (measured, the last row with its dark outline in it), and the middle of the
# width that leaves.
TOP = 470
LEFT = 113

# How dark each part ends up, as a fraction of the art's own brightness.
# UNDER_TEXT is about the lightest that keeps every line at least as readable
# as it was on the starfield, by contrast against the middle of what is behind
# it. At 0.27 the caps line measured 6.68 and the gold rule 7.70, against the
# starfield's 6.70 and 7.75; 0.25 was the first at or past it on all four
# lines, by a hair, and 0.24 leaves a little room. EVERYWHERE takes the edge
# off the sunset so the card sits in Discord's dark theme.
EVERYWHERE = 0.80
UNDER_TEXT = 0.24
UNDER_AVATAR = 0.55


def build(source=SOURCE):
    art = Image.open(source).convert('RGB')
    sw, sh = art.size
    h = sh - TOP
    w = int(round(h * W / float(H)))
    left = min(max(LEFT, 0), sw - w)
    im = art.crop((left, TOP, left + w, sh)).resize((W, H), Image.LANCZOS)

    black = Image.new('RGB', (W, H), (0, 0, 0))
    im = Image.blend(black, im, EVERYWHERE)

    # The text side: a soft edged block, darker in the middle than at its
    # rim, so there is no line where the shade starts.
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        TEXT, radius=60, fill=int(round(255 * (1 - UNDER_TEXT / EVERYWHERE))))
    mask = mask.filter(ImageFilter.GaussianBlur(34))
    im = Image.composite(black, im, mask)

    # A darker patch for the avatar to sit on, so the gold ring reads against
    # a sunset as well as it did against the night sky.
    x0, y0, x1, y1 = AVATAR
    pad = 22
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse(
        (x0 - pad, y0 - pad, x1 + pad, y1 + pad),
        fill=int(round(255 * (1 - UNDER_AVATAR / EVERYWHERE))))
    mask = mask.filter(ImageFilter.GaussianBlur(26))
    im = Image.composite(black, im, mask)
    return im


def main(argv):
    out = OUT
    if '--out' in argv:
        i = argv.index('--out')
        if i + 1 >= len(argv):
            raise SystemExit('--out wants a file name')
        out = argv[i + 1]
    im = build()
    folder = os.path.dirname(os.path.abspath(out))
    if not os.path.isdir(folder):
        os.makedirs(folder)
    im.save(out, 'PNG', optimize=True)
    print('wrote %s, %dx%d' % (out, im.size[0], im.size[1]))


if __name__ == '__main__':
    main(sys.argv[1:])
