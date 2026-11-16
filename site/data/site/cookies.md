# Cookies

Last changed: 11 November 2026.

This page is every cookie and every piece of browser storage thornswood.net
uses, what each one is for, and how long it lasts. The site uses them for
signing in and for your age statement, and nothing else. Cloudflare, which
carries every connection to the site, can set two of its own to keep scripts
off it. There is no advertising cookie, no Google Analytics and no tracking
embed.

## Cookies

| Name | Set by | Purpose | Duration |
| --- | --- | --- | --- |
| `twa` | the site | Signed Discord identity. Access is checked against your Discord roles each time; signing in alone does not grant staff access. | Up to 30 days; cleared on sign-out, and a copy made before a sign-out is refused after it. |
| `twst_*` | the site | One-use security state during a Discord sign-in, scoped to `/auth/discord`. | Ten minutes; cleared when the sign-in returns. |
| `tw` | the site | Fallback member-password sign-in, used only when Discord sign-in is not set up. Ignored when it is. | Up to one year; cleared on sign-out. |
| `tw-age-18` | the site | Remembers that this browser stated eighteen or older. It does not verify age. | One year. |
| `__cf_bm` | Cloudflare | Tells a browser apart from a script hammering the site. Cloudflare sets it only while its Bot Fight Mode is on for the site. | Ends after 30 minutes of nothing. |
| `cf_clearance` | Cloudflare | Says this browser passed a Cloudflare check, so it is not asked again. | Set by Cloudflare. |

The three sign-in cookies are HttpOnly and SameSite=Lax, and Secure over
HTTPS. `tw-age-18` is SameSite=Lax and Secure over HTTPS, and is not HttpOnly,
because the page reads it. Cloudflare makes its two separately for every site
and says it does not use them to follow anybody from site to site
([Cloudflare's cookies](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/)).

## Browser storage

| Key | Where | Purpose | Duration |
| --- | --- | --- | --- |
| `tw-age-18` | localStorage, on every page | A second copy of the age statement, for a browser that blocks the cookie. It holds the date it runs out. | One year, then the page drops it and asks again. |
| `tw:who` | localStorage, on the staff hub only | The name a member of staff typed on the hub, so they are not asked again. It never leaves the browser. | Until the browser's site data is cleared. |

Both copies of the age statement ask again when the gate's wording changes what
you agreed to.

## Clearing them

Clearing this site's cookies signs you out. Clearing its site data, cookies and
storage together, removes the age statement as well and makes the gate ask
again.

## Why there is no consent banner

Everything above supports something you asked for: signing in, the age gate,
or reaching the site at all. The site loads no optional analytics or
advertising storage, so there is nothing to consent to. Cloudflare Web
Analytics, which counts page visits and load times, stores nothing in your
browser: no cookie and no localStorage (see [Privacy](/privacy)). If anything
that tracks is ever added, its consent comes first and this page says so.

See [Privacy](/privacy) for what is kept about you and how to have it deleted,
and [Terms](/terms) for the adult-content notice. Cookie rules depend on where
you live; this page describes the storage the site really uses rather than
claiming every country's rules are met.
