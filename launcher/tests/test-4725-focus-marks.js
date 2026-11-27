// test-4725-focus-marks.js
//
//     node launcher\tests\test-4725-focus-marks.js
//
// Issue #4725. Moving through the launcher with the keyboard, focus could not
// be seen on a ticked box, on the link buttons or on the nav item of the page
// that is open, because each control's focus style reused a look it already
// had: a link turned the accent as hover does (1.01 to 1 from Muted in
// Forge), a tick box lit the accent edge a ticked box already has, and a nav
// item lit the accent bar the open page already has.
//
// For every control theme in launcher\app\MainWindow.axaml that Tab can
// reach (Button, CheckBox, TextBox, ComboBox, Slider), and in every palette
// in launcher\app\Themes.cs (the nine themes and the DIY starter):
//
//   1. it has a focus mark: a style on :focus-visible, or :focus for a text
//      field;
//   2. the mark is at least 3 to 1 from what is there without focus
//      (WCAG 2.2 2.4.13): for a ring, the ring's colour on every surface it
//      can sit on, or on the accent fill it is drawn over; for a colour
//      change, the focused colour against the unfocused one;
//   3. the mark is not a look another state already gives: no hover,
//      ticked or open page style shows the ring, and a colour change is at
//      least 3 to 1 from what hover, ticked or the open page set on the same
//      part too, so focus still shows on a control that is also in that state;
//   4. the measure has teeth: the focus styles #4725 replaced fail it.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [REPO_DIR].concat(Array.prototype.slice.call(arguments))), 'utf8').split(CR).join('');
}
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const MIN = 3;
const SURFACES = ['Bg', 'Panel', 'Card', 'CardHover', 'Deep'];
const FOCUSABLE = ['Button', 'CheckBox', 'TextBox', 'ComboBox', 'Slider'];

// ---- colours, as test-2771-text-contrast.js and Themes.Over read them -------
function rgba(hex) {
  const h = hex.replace('#', '');
  const a = h.length === 8 ? parseInt(h.slice(0, 2), 16) : 255;
  const rgb = h.slice(-6);
  return { a: a, r: parseInt(rgb.slice(0, 2), 16), g: parseInt(rgb.slice(2, 4), 16), b: parseInt(rgb.slice(4, 6), 16) };
}
function over(top, under) {
  const a = top.a / 255;
  return { a: 255, r: Math.round(top.r * a + under.r * (1 - a)), g: Math.round(top.g * a + under.g * (1 - a)), b: Math.round(top.b * a + under.b * (1 - a)) };
}
function lin(v) { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

function pairs(text) {
  const o = {};
  const re = /"(\w+)","(#[0-9A-Fa-f]{6,8})"/g;
  let m;
  while ((m = re.exec(text))) o[m[1]] = m[2];
  return o;
}
const themesCs = read('launcher', 'app', 'Themes.cs');
const palettes = [];
const makeRe = /Make\("(\w+)",[\s\S]*?new string\[\] \{([\s\S]*?)\}/g;
let mm;
while ((mm = makeRe.exec(themesCs))) palettes.push({ name: mm[1], colors: pairs(mm[2]) });
const diy = /string\[\] diy = new string\[\] \{([\s\S]*?)\};/.exec(themesCs);
if (diy) palettes.push({ name: 'DIY starter', colors: pairs(diy[1]) });
yes('Themes.cs has its nine built-in themes and the DIY starter (' + palettes.length + ' read)', palettes.length === 10);

// A colour name drawn on a surface: the colour as it shows there. "Surface"
// is a part with no fill of its own, which shows the surface itself.
function shown(p, name, surface) {
  const bg = over(rgba(p.colors.Bg), { a: 255, r: 0, g: 0, b: 0 });
  const under = surface === 'Bg' ? bg : over(rgba(p.colors[surface]), bg);
  if (name === 'Surface') return under;
  return over(rgba(p.colors[name]), under);
}

// ---- the window's control themes -----------------------------------------------
function themesOf(xaml) {
  const out = [];
  const re = /<ControlTheme x:Key="([^"]+)" TargetType="(\w+)"[^>]*>([\s\S]*?)\n    <\/ControlTheme>/g;
  let m;
  while ((m = re.exec(xaml))) out.push({ key: m[1], type: m[2], body: m[3] });
  return out;
}
function stylesOf(body) {
  const out = [];
  const re = /<Style Selector="([^"]+)">([\s\S]*?)<\/Style>/g;
  let m;
  while ((m = re.exec(body))) {
    const sel = m[1];
    const part = sel.indexOf(' /template/ ') >= 0 ? sel.slice(sel.indexOf(' /template/ ') + 12).trim() : '';
    const state = (part ? sel.slice(0, sel.indexOf(' /template/ ')) : sel).trim();
    const setters = [];
    const sre = /<Setter Property="([\w.]+)" Value="([^"]+)"\s*\/>/g;
    let s;
    while ((s = sre.exec(m[2]))) setters.push({ prop: s[1], value: s[2] });
    out.push({ state: state, part: part, setters: setters });
  }
  return out;
}
function resName(v) { const m = /^\{DynamicResource (\w+)\}$/.exec(v); return m ? m[1] : null; }

// What a part shows for a property with no state on: its own attribute in the
// template, or the theme's setter it binds to, or the theme's setter for the
// control itself.
function base(theme, part, prop) {
  const outside = theme.body.replace(/<Style Selector[\s\S]*?<\/Style>/g, '');
  const setterOf = (p) => {
    const m = new RegExp('<Setter Property="' + p + '" Value="([^"]+)"').exec(outside);
    return m ? m[1] : null;
  };
  let v = null;
  if (part) {
    const pm = /^(\w+)#(\w+)$/.exec(part);
    if (pm) {
      const el = new RegExp('<' + pm[1] + ' Name="' + pm[2] + '"([^>]*)>').exec(theme.body);
      if (el) {
        const a = new RegExp('\\b' + prop + '="([^"]+)"').exec(el[1]);
        if (a) v = a[1];
      }
    }
  }
  if (v === null) v = setterOf(prop);
  if (v === null) return 'Surface';
  const tb = /^\{TemplateBinding (\w+)\}$/.exec(v);
  if (tb) v = setterOf(tb[1]) || 'Transparent';
  if (v === 'Transparent') return 'Surface';
  return resName(v) || v;
}

const isFocus = (st) => /^\^:focus(-visible)?$/.test(st);
const isOther = (st) => /^\^(:pointerover|:checked|\[Tag=on\])$/.test(st);

// Everything wrong with one theme's focus mark, in every palette.
function problems(theme) {
  const out = [];
  const styles = stylesOf(theme.body);
  const focus = styles.filter((s) => isFocus(s.state));
  if (focus.length === 0) return ['it has no focus style'];
  const others = styles.filter((s) => isOther(s.state));
  let marks = 0;
  for (const f of focus) {
    for (const set of f.setters) {
      if (f.part === 'Rectangle#ring' && set.prop === 'IsVisible' && set.value === 'True') {
        marks++;
        const ring = /<Rectangle Name="ring"([^>]*)\/>/.exec(theme.body);
        if (!ring) { out.push('it shows a ring its template does not have'); continue; }
        const stroke = /Stroke="\{DynamicResource (\w+)\}"/.exec(ring[1]);
        if (!/IsVisible="False"/.test(ring[1]) || !stroke) { out.push('its ring is not hidden until focus, or has no colour of the theme'); continue; }
        if (others.some((o) => o.part === 'Rectangle#ring')) out.push('another state shows its ring too');
        // A ring inside a fill of the accent (Primary, Solid) is drawn on it.
        const onAccent = /<Border Name="\w+" Background="\{DynamicResource Accent\}"/.test(theme.body);
        const under = onAccent ? ['Accent'] : SURFACES;
        for (const p of palettes) {
          const bg = over(rgba(p.colors.Bg), { a: 255, r: 0, g: 0, b: 0 });
          for (const s of under) {
            const u = s === 'Accent' ? over(rgba(p.colors.Accent), bg) : shown(p, 'Surface', s);
            const r = contrast(over(rgba(p.colors[stroke[1]]), u), u);
            if (r < MIN) out.push(p.name + ': the ring in ' + stroke[1] + ' on ' + s + ' is ' + r.toFixed(2));
          }
        }
        continue;
      }
      const to = resName(set.value);
      if (!to) continue;
      const from = base(theme, f.part, set.prop);
      if (from === to) continue;   // what it already is: not the mark
      marks++;
      const where = (f.part ? f.part + ' ' : '') + set.prop;
      for (const p of palettes) {
        for (const s of SURFACES) {
          const r = contrast(shown(p, to, s), shown(p, from, s));
          if (r < MIN) { out.push(p.name + ': ' + where + ' ' + from + ' to ' + to + ' on ' + s + ' is ' + r.toFixed(2)); break; }
        }
      }
      for (const o of others) {
        if (o.part !== f.part) continue;
        const same = o.setters.find((x) => x.prop === set.prop);
        if (!same || !resName(same.value)) continue;
        const v = resName(same.value);
        for (const p of palettes) {
          const r = contrast(shown(p, to, 'Card'), shown(p, v, 'Card'));
          if (r < MIN) { out.push(where + ' on focus is the ' + v + ' ' + o.state.slice(1) + ' already gives (' + p.name + ' ' + r.toFixed(2) + ')'); break; }
        }
      }
    }
  }
  if (marks === 0) out.push('its focus style changes nothing it does not already show');
  return out;
}

const xaml = read('launcher', 'app', 'MainWindow.axaml');
const all = themesOf(xaml);
const focusable = all.filter((t) => FOCUSABLE.includes(t.type));
yes('MainWindow.axaml has control themes Tab can reach (' + focusable.map((t) => t.key).join(', ') + ')', focusable.length >= 10);
for (const k of ['Link', 'Nav', '{x:Type CheckBox}']) yes('  among them ' + k, focusable.some((t) => t.key === k));

// ---- 1 to 3. every focusable control's mark, in every palette ---------------
for (const t of focusable) {
  const p = palettes.length === 10 ? problems(t) : ['the palettes were not read'];
  for (const line of p.slice(0, 6)) console.log('      ' + t.key + ': ' + line);
  yes(t.key + ': keyboard focus shows a mark at least 3 to 1 from every look it has without focus, in every theme', p.length === 0);
}

// ---- 4. teeth: the focus styles #4725 replaced fail ---------------------------
function theme(key) { return all.find((t) => t.key === key); }
function swapped(key, from, to) {
  const t = theme(key);
  if (!t || t.body.indexOf(from) < 0) return null;
  return { key: key, type: t.type, body: t.body.replace(from, to) };
}
const ringOn = '<Style Selector="^:focus-visible /template/ Rectangle#ring"><Setter Property="IsVisible" Value="True"/></Style>';
const oldLink = swapped('Link', ringOn, '<Style Selector="^:focus-visible"><Setter Property="Foreground" Value="{DynamicResource Accent}"/></Style>');
const oldBox = swapped('{x:Type CheckBox}', ringOn, '<Style Selector="^:focus-visible /template/ Border#box"><Setter Property="BorderBrush" Value="{DynamicResource Accent}"/></Style>');
const oldNav = swapped('Nav', ringOn, '<Style Selector="^:focus-visible /template/ Rectangle#bar"><Setter Property="Fill" Value="{DynamicResource Accent}"/></Style>\n      <Style Selector="^:focus-visible"><Setter Property="Foreground" Value="{DynamicResource Ink}"/></Style>');
const forge = palettes.find((p) => p.name === 'Forge');
if (forge) {
  const r = contrast(shown(forge, 'Accent', 'Panel'), shown(forge, 'Muted', 'Panel'));
  console.log('      Forge: Accent against Muted on Panel is ' + r.toFixed(2) + ' to 1');
}
if (oldLink) yes('4. a link that only turns the accent on focus fails, as hover does that', problems(oldLink).some((l) => /hover|pointerover/.test(l)));
if (oldBox) yes('4. a tick box that only lights its accent edge on focus fails, as ticked does that', problems(oldBox).some((l) => /checked/.test(l)));
if (oldNav) yes('4. a nav item that only lights its accent bar on focus fails, as the open page does that', problems(oldNav).some((l) => /Tag=on/.test(l)));
yes('4. the three replaced styles were all rebuilt to try', !!oldLink && !!oldBox && !!oldNav);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
