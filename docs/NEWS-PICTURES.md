# Pictures in News

A release can include one captioned screenshot. Add it as a detail directly
under its release note, alongside the text details:

```markdown
Release note: Character creation is easier to follow
- Back and Next guide you through the tabs.
- ![The character creation panel](https://thornswood.net/news-creation-panel-20261117.png)
```

Capture the actual released interface, check the picture, and put the image
in `site/public` before the note goes out. Use an unused name starting with
`news-`, lowercase letters, digits and hyphens, ending in `.png`, `.jpg` or
`.webp`. Keep it below four megabytes. The caption is required and at most
160 characters (emoji count twice). Publish the site first so the picture is available when the
note reaches Discord and the app. Never overwrite a picture used by an old
note.

Only HTTPS pictures at `thornswood.net` with that naming pattern are loaded;
links with queries, another host or another path are plain text. The website
and app preserve the whole picture's proportions and offer the full image.
Discord uses the same image as its News embed and includes its caption.
An unavailable picture leaves the text and caption readable.

This changes how a note is displayed. It does not change which releases each
News page shows or when a release reaches Main.
