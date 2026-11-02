// test-sidebar-brand.js
//
//     node launcher\tests\test-sidebar-brand.js
//
// The sidebar brand sits beside the small emblem in a 208 column. On the live
// launcher that label is one line, Thornswood. On the dev launcher the same
// spot used to set "Thornswood Dev" on one line, and the last letters ran off
// the icon. The fix is two lines in that same TextBlock: Thornswood, then Dev.
//
// WHAT THIS HOLDS.
//   - the side column stays 208, and the brand row's own margins and emblem
//     size are the ones that leave the text its gap;
//   - TxtBrandSmall's live text is still the one-line word Thornswood, same
//     type, same ink, wrapping allowed so a newline can break;
//   - that TextBlock is only as wide as its longest line (no Width or
//     MaxWidth), so Thornswood stays left of the remaining gap next to the
//     icon, and TextAlignment Center puts Dev under the word, not under the
//     icon and not against the T;
//   - Wire() writes Thornswood, then a newline, then Dev, only onto
//     TxtBrandSmall, and only when this build is the dev channel;
//   - the window title and TxtBrandBig stay the one-line "Thornswood Dev".
//
// The two-line string fits because its first line is the live label in the
// same TextBlock, same type and same column, and that live label is already
// the one-line word that sits there. Dev is shorter than Thornswood, so the
// second line cannot be the one that runs out. Centered Dev is still inside
// that first-line width.
//
// Read only. It reads launcher\app\MainWindow.axaml and launcher\app\Shell.cs.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8').split(CR).join('');
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const XAML = read(path.join('launcher', 'app', 'MainWindow.axaml'));
const SHELL = read(path.join('launcher', 'app', 'Shell.cs'));

function between(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  if (b < 0) return '';
  return src.slice(a, b);
}

function braces(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return { open: open, close: i, inner: src.slice(open + 1, i) };
    }
  }
  return null;
}

function method(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return '';
  const b = braces(src, at);
  return b ? src.slice(at, b.close + 1) : '';
}

function attr(tag, name) {
  const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : '';
}

function marginBox(value) {
  const p = String(value || '').split(',').map(Number);
  if (p.length === 1 && !isNaN(p[0])) return { left: p[0], top: p[0], right: p[0], bottom: p[0] };
  if (p.length === 4 && p.every(function (n) { return !isNaN(n); })) {
    return { left: p[0], top: p[1], right: p[2], bottom: p[3] };
  }
  return null;
}

// ---- the 208 column --------------------------------------------------------
const columns = between(XAML, '<Grid.ColumnDefinitions>', '</Grid.ColumnDefinitions>');
const colWidths = [];
columns.replace(/<ColumnDefinition Width="([^"]+)"\/>/g, function (m, w) {
  colWidths.push(w);
  return m;
});
yes('the side column is still the first column and still 208',
    colWidths[0] === '208' && colWidths[1] === '*');

const sidebar = parseInt(colWidths[0], 10);
const border = /<Border Grid\.Column="0"[^>]*BorderThickness="([^"]+)"/.exec(XAML);
const borderRight = border ? Number(String(border[1]).split(',')[2] || 0) : NaN;
yes('the side panel still has a 1-wide rule on its right edge', borderRight === 1);

// ---- the brand row beside EmblemSmall --------------------------------------
const brandAt = XAML.indexOf('x:Name="EmblemSmall"');
const brandFrom = brandAt < 0 ? -1 : XAML.lastIndexOf('<StackPanel', brandAt);
const brandTo = brandFrom < 0 ? -1 : XAML.indexOf('</StackPanel>', brandAt);
const brandRow = (brandFrom >= 0 && brandTo > brandFrom) ? XAML.slice(brandFrom, brandTo) : '';
yes('EmblemSmall and TxtBrandSmall still sit in one horizontal row',
    /x:Name="EmblemSmall"/.test(brandRow) && /x:Name="TxtBrandSmall"/.test(brandRow) &&
    /Orientation="Horizontal"/.test(brandRow));

const rowMargin = marginBox(attr(brandRow, 'Margin'));
const emblemTag = /<Image\b[^>]*x:Name="EmblemSmall"[^>]*>/.exec(brandRow);
const brandTag = /<TextBlock\b[^>]*x:Name="TxtBrandSmall"[^>]*>/.exec(brandRow);
yes('the brand row still names its margin and the two controls',
    !!(rowMargin && emblemTag && brandTag));

const emblemW = emblemTag ? Number(attr(emblemTag[0], 'Width')) : NaN;
const emblemGap = emblemTag ? marginBox(attr(emblemTag[0], 'Margin')) : null;
yes('the small emblem is still 28 wide with a 12 gap before the name',
    emblemW === 28 && !!(emblemGap && emblemGap.right === 12));

const inner = sidebar - borderRight - rowMargin.left - emblemW - emblemGap.right - rowMargin.right;
yes('the name still has ' + inner + ' of the 208 column after the emblem and the row margins',
    inner === 208 - 1 - 22 - 28 - 12 - 18 && inner > 0);

// ---- live TxtBrandSmall stays one line, Thornswood -------------------------
yes('TxtBrandSmall\'s live text is still the one-line word Thornswood',
    attr(brandTag[0], 'Text') === 'Thornswood');
yes('and it still uses Constantia at 17 with small capitals and the ink brush',
    attr(brandTag[0], 'FontFamily') === 'Constantia, Georgia' &&
    attr(brandTag[0], 'FontSize') === '17' &&
    attr(brandTag[0], 'FontFeatures') === '+smcp' &&
    attr(brandTag[0], 'Foreground') === '{DynamicResource Ink}');
yes('it wraps, so a newline can put Dev under the name, and it has no width that would break Thornswood',
    attr(brandTag[0], 'TextWrapping') === 'Wrap' &&
    !/\bWidth=/.test(brandTag[0]) && !/\bMinWidth=/.test(brandTag[0]) && !/\bMaxWidth=/.test(brandTag[0]));
yes('lines are centered inside that block, so Dev sits under the word, not under the icon',
    attr(brandTag[0], 'TextAlignment') === 'Center' &&
    !/\bHorizontalAlignment=/.test(brandTag[0]));

// ---- Wire() sets the two-line dev name only on the small brand -------------
const wire = method(SHELL, 'static void Wire()');
yes('Wire() is still in Shell.cs', wire.length > 0);

const devAt = wire.indexOf('if (cfg.IsDev)');
const dev = devAt < 0 ? '' : (braces(wire, devAt) || { inner: '' }).inner;
yes('the dev channel block is still inside Wire()', dev.length > 0);

yes('TxtBrandSmall is Thornswood, then a newline, then Dev',
    /txtBrandSmall\.Text = "Thornswood\\nDev"/.test(dev));
yes('that two-line assignment is only inside the dev channel block',
    (SHELL.match(/txtBrandSmall\.Text\s*=/g) || []).length === 1 &&
    (dev.match(/txtBrandSmall\.Text\s*=/g) || []).length === 1);
yes('the live path never writes TxtBrandSmall, so the xaml word Thornswood stays',
    wire.indexOf('txtBrandSmall.Text') === wire.indexOf('txtBrandSmall.Text = "Thornswood\\nDev"'));

yes('TxtBrandBig stays the one-line Thornswood Dev',
    /txtBrandBig\.Text = "Thornswood Dev"/.test(dev));
yes('the window title stays the one-line Thornswood Dev',
    /win\.Title = "Thornswood Dev"/.test(dev));

const smallAssign = /txtBrandSmall\.Text = "([^"]*)"/.exec(dev);
const lines = smallAssign ? smallAssign[1].split('\\n') : [];
yes('the two-line string is exactly Thornswood over Dev',
    lines.length === 2 && lines[0] === 'Thornswood' && lines[1] === 'Dev');
yes('the first line is the live label, so it already fits in this 208 column',
    lines[0] === attr(brandTag[0], 'Text') && lines[0] === 'Thornswood');
yes('Dev is shorter than Thornswood, so the second line cannot run past the name',
    lines[1] === 'Dev' && lines[1].length < lines[0].length);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
