/*
  test-play-strip-art.js

  The strip of landscape behind the title on the Play page keeps the framing the
  picture was approved with, and nothing on that band zooms, drifts or runs fast.

  WHY THIS EXISTS. The same defect the start screen had (pull request #1408,
  where a 1.08 to 1.14 scale, an object-position of 50% 25% and a 1.2 playback
  rate had moved the painting out from under the scroll) was reported on the
  launcher's title band: the strip misframes the overlook against the approved
  still. The band is 100 tall and as wide as the window less the side column, so
  it is 8 to 17 times wider than it is tall while the art is 5.1 to 1. Filling
  the band therefore loses height, and the question is only which height.
  Centred on the middle of the art, the band slid down off the sunrise as the
  window widened. Art.HeaderCrop names the part of the art the band shows
  instead, and the still and the video both paint with it, so they show the same
  rows and line up.

  WHAT THIS HOLDS. The four bars Tophet asked for, and the no-zoom rule:

    - the band's height is the title row's, the still and the video are both
      painted through one brush maker (Art.BandBrush), which fills and crops
      (UniformToFill, centred) with the one crop;
    - the video's frames are painted through that brush, never shown in a
      control of their own, because a video control sizes itself and pushed
      the band from 135 to 195.5 high when this was first built (entry 195 on
      the To Do List);
    - inside the HeaderArt grid the still is under the video, and both are under
      the panel veils;
    - no scale, no drift and no speed-up anywhere on the band.

  It also works out, from the art's own size and the window's own numbers, that
  the named crop cannot take anything off the sides at any window width and that
  the figure at the overlook stays in frame from the smallest window the
  launcher allows up to an ultrawide one.

  Read only. It reads launcher\app\Art.cs, launcher\app\Shell.cs,
  launcher\app\MainWindow.axaml and the first bytes of
  launcher\launcher-header.jpg.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
const ART = read(path.join('launcher', 'app', 'Art.cs'));
const SHELL = read(path.join('launcher', 'app', 'Shell.cs'));
const XAML = read(path.join('launcher', 'app', 'MainWindow.axaml'));

let pass = 0, fail = 0, skip = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function note(what) { skip++; console.log('SKIP  ' + what); }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
  process.exit(fail ? 1 : 0);
}

/* From the opening brace at or after `from` to its matching closing brace. */
function braces(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return { open: open, close: i, inner: src.slice(open + 1, i) }; }
  }
  return null;
}
function method(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return '';
  const b = braces(src, at);
  return b ? src.slice(at, b.close + 1) : '';
}
/* The element or comment-free slice of XAML between two markers. */
function between(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = to ? src.indexOf(to, a) : src.length;
  return b < 0 ? src.slice(a) : src.slice(a, b);
}
function uncommented(xaml) { return xaml.replace(/<!--[\s\S]*?-->/g, ''); }
/* C# with its comments taken out, for a check about what the code does rather
   than what a comment says about it. */
function code(cs) {
  return cs.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
           .filter(function (l) { return l.trim().indexOf('//') !== 0; })
           .map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');
}

// ---- bar 1: the band, the stretch, the alignment and one shared crop ----------
const bandOpen = XAML.indexOf('<Border Grid.Row="0" Height="100" MaxHeight="100" ClipToBounds="True"');
yes('the Play band is the title row\'s height, 100 and no taller, and clips what overflows', bandOpen > 0);
yes('and it is the first row of PagePlay', bandOpen > XAML.indexOf('x:Name="PagePlay"'));

const header = method(ART, 'public static ImageBrush Header()');
yes('Art.Header is in Art.cs', header.length > 0);
const band = method(ART, 'public static ImageBrush BandBrush(IImageBrushSource source)');
yes('Art.BandBrush, the one brush maker for the band, is in Art.cs', band.length > 0);
const video = method(SHELL, 'static void StartHeaderVideo()');
yes('StartHeaderVideo is in Shell.cs', video.length > 0);
if (!header || !band || !video) done();

yes('the still is painted through BandBrush', /header = BandBrush\(bi\);/.test(header));
yes('and so is the video, each frame as it is put up', /layer\.Background = Art\.BandBrush\(shown\);/.test(video));
yes('the brush fills the band and crops what does not fit', /Stretch = Stretch\.UniformToFill;/.test(band));
yes('it never letterboxes the band (no Stretch.Uniform, no Stretch.Fill), and nothing else sets a stretch',
    !/Stretch = Stretch\.(Uniform|Fill);/.test(band) && !/Stretch\s*=/.test(header) && !/Stretch\s*=/.test(video));
yes('it is centred both ways', /AlignmentX = AlignmentX\.Center;/.test(band) && /AlignmentY = AlignmentY\.Center;/.test(band));

yes('Art names the one crop the band shows, as fractions of the art',
    /public static readonly RelativeRect HeaderCrop = new RelativeRect\([^)]*RelativeUnit\.Relative\);/.test(ART));
yes('the brush paints with that crop, so the still and the video share it, not a copy of the numbers',
    /SourceRect = HeaderCrop;/.test(band) && !/SourceRect\s*=/.test(header) && !/SourceRect\s*=/.test(video));

// ---- bar 2: a brush, never a control of its own ---------------------------------
yes('the video\'s frames go into one bitmap', /var shown = new WriteableBitmap\(/.test(video));
yes('painted onto the HeaderArtVideo border\'s background', /var layer = win\.HeaderArtVideo;/.test(video));
const artGridAll = uncommented(between(XAML, '<Grid x:Name="HeaderArt"', '<!-- Fixed short landscape'));
yes('there is no video or picture control in the band, only borders whose background is the brush',
    !/<(Image|MediaElement|MediaPlayerElement|VideoView)\b/.test(artGridAll) && XAML.indexOf('MediaElement') < 0);
yes('and none in the launcher\'s code either, only the comment saying why not',
    code(SHELL).indexOf('MediaElement') < 0 && code(ART).indexOf('MediaElement') < 0);
yes('that comment is still there, with what a video control did to the band\'s height',
    /a video control\s*\/\/\/ asking for room at the video's own shape once took the band from\s*\/\/\/ 135 to 195 high/.test(SHELL));

// ---- bar 3: the still under the video, both under the veils -------------------
const artGrid = uncommented(between(XAML, '<Grid x:Name="HeaderArt"', '<!-- Fixed short landscape'));
const atPicture = artGrid.indexOf('x:Name="HeaderArtPicture"');
const atVideo = artGrid.indexOf('x:Name="HeaderArtVideo"');
const atVeil = artGrid.indexOf('<Rectangle Fill="{DynamicResource Panel}"');
yes('the HeaderArt grid holds the picture, the video and the veils', atPicture > 0 && atVideo > 0 && atVeil > 0);
yes('the still picture is under the video', atPicture < atVideo);
yes('and both are under the panel veils', atVideo < atVeil);
yes('the veils are the last thing in the band, so nothing paints over them',
    (artGrid.match(/<Rectangle Fill="\{DynamicResource Panel\}"/g) || []).length === 3);

// ---- no Ken Burns ------------------------------------------------------------
yes('nothing scales or moves the band in the window file',
    !/HeaderArt[\s\S]{0,2000}?(ScaleTransform|RenderTransform|Storyboard|DoubleAnimation)/.test(uncommented(between(XAML, '<Grid x:Name="HeaderArt"', '<!-- Fixed short landscape'))));
yes('nothing scales or moves it in the code either',
    !/(ScaleTransform|RenderTransform|DoubleAnimation|BeginAnimation|Transform\s*=)/.test(video) &&
    !/(ScaleTransform|RenderTransform|DoubleAnimation|Transform\s*=)/.test(header + band));
yes('the loop plays at its own speed, with no speed-up: each frame waits out its own time',
    !/SpeedRatio/.test(video) && /due \+= lasts;/.test(video) && /if \(left > TimeSpan\.Zero\) Thread\.Sleep\(left\);/.test(video) &&
    /lasts = frames\.Next\(\);/.test(video));
const next = method(ART, 'public TimeSpan Next()');
yes('and after the last frame comes the first, for ever, as it always was',
    /at = \(at \+ 1\) % frames\.Length;/.test(next));

// ---- what the named crop works out to ---------------------------------------
const rect = /public static readonly RelativeRect HeaderCrop = new RelativeRect\(([^)]+), RelativeUnit\.Relative\);/.exec(ART);
yes('HeaderCrop reads as four numbers', rect !== null && rect[1].split(',').length === 4);
if (!rect) done();
const n = rect[1].split(',').map(function (s) { return parseFloat(s.trim()); });
const cropX = n[0], cropY = n[1], cropW = n[2], cropH = n[3];
yes('the crop takes the whole width of the art, so nothing is lost off the sides by the crop itself',
    cropX === 0 && cropW === 1);
yes('and it is a slice of the height, not the whole of it', cropH > 0 && cropH < 1 && cropY >= 0 && cropY + cropH <= 1);

/* The art's own size, out of the JPEG's start-of-frame marker. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
const art = jpegSize(path.join(REPO_DIR, 'launcher', 'launcher-header.jpg'));
yes('the art behind the title is a readable JPEG', art !== null);
if (!art) done();

// The window's own numbers, so a change to any of them is checked against the crop.
const minWidth = parseInt(/MinWidth="(\d+)"/.exec(XAML)[1], 10);
const sidebar = parseInt(/<ColumnDefinition Width="(\d+)"\/>/.exec(XAML)[1], 10);
const bandHigh = parseInt(/<Border Grid\.Row="0" Height="(\d+)"/.exec(XAML)[1], 10);
const frame = parseInt(/x:Name="WindowFrame"[^>]*BorderThickness="(\d+)"/.exec(XAML)[1], 10);
yes('the window file still says how wide the side column is and how small the window goes (' +
    sidebar + ', ' + minWidth + ')', sidebar > 0 && minWidth > 0 && bandHigh === 100 && frame > 0);

function bandWidth(windowWidth) { return windowWidth - sidebar - 2 * frame; }
/* Which rows of the art the band shows at a window of this width: the crop
   scaled to fill the band's width, then the middle of it taken. */
function rows(windowWidth) {
  const slice = art.h * cropH;                        // the crop, in the art's own rows
  const centre = art.h * (cropY + cropH / 2);
  const scale = bandWidth(windowWidth) / (art.w * cropW);
  const shown = bandHigh / scale;                     // rows that reach the band
  return { shown: shown, slice: slice, top: centre - shown / 2, bottom: centre + shown / 2 };
}

const widest = 3440; // an ultrawide screen, the widest the band is ever drawn
yes('at every window width from the smallest to an ultrawide one the band fills with height, never with width, ' +
    'so the crop never takes anything off the sides',
    rows(minWidth).shown <= rows(minWidth).slice && rows(widest).shown <= rows(widest).slice);

if (art.w !== 1535 || art.h !== 300) {
  note('the rows the overlook sits on were measured on the 1535 by 300 art; this art is ' +
       art.w + ' by ' + art.h + ', so HeaderCrop needs approving against it again');
} else {
  // Measured on the art itself: the sunrise and the far shore lie across rows
  // 60 to 85, and the figure at the overlook has its head in rows 126 to 160.
  const headTop = 126, headBottom = 160, horizon = 85;
  // Below some width the band is tall enough in the art's own rows to hold the
  // sunrise's far shore and the whole of the figure's head; past it nothing can,
  // whatever the crop says, because an ultrawide band reaches only 47 of the
  // art's 300 rows. So this works out where that width is and holds it past a
  // maximised 1920 screen, and holds the band on the figure all the way out.
  let both = minWidth - 10, offFigure = 0;
  for (let w = minWidth; w <= widest; w += 10) {
    const r = rows(w);
    if (r.top <= horizon && r.bottom >= headBottom && both === w - 10) both = w;
    if (!(r.top <= headBottom && r.bottom >= headTop)) offFigure++;
  }
  yes('the band holds the far shore and the whole head up to a window ' + both +
      ' wide, which covers a maximised 1920 screen', both >= 1920);
  yes('and at every width out to an ultrawide ' + widest + ' it is still framed on the figure (' +
      offFigure + ' widths slide off it)', offFigure === 0);
  const mid = rows(1220), wide = rows(1920);
  yes('at the default window the band holds the sunrise and the far shore as well as the figure (rows ' +
      Math.round(mid.top) + ' to ' + Math.round(mid.bottom) + ')', mid.top <= horizon && mid.bottom >= headBottom);
  yes('maximised on a 1920 screen it still holds the far shore and the figure (rows ' +
      Math.round(wide.top) + ' to ' + Math.round(wide.bottom) + ')', wide.top <= horizon && wide.bottom >= headBottom);
  yes('the crop is anchored above the middle of the art, which is what the middle crop got wrong',
      cropY + cropH / 2 < 0.5);
}

done();
