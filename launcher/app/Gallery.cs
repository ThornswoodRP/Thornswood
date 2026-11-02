using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Avalonia.Media.Imaging;
using SkiaSharp;

namespace Thornswood
{
    /// <summary>
    /// The pictures thornswood.net is showing from the world, and the doors
    /// this end may write through: submit, report, and for staff the queue
    /// behind it (approve, reject, take an approved picture down).
    ///
    /// The site still keeps the queue and gallery.json. Play's rotating card
    /// and the Gallery page both ask /api/public for what is already public.
    /// Upload, Report, Accept and Delete live on the Gallery page; Play keeps
    /// the approved spotlight only. Reject is not offered in the launcher UI;
    /// unaccepted items sit in the Gallery grid until Accept or Delete (#731).
    ///
    /// WHAT THE LAUNCHER MAY DO AT THE SITE (#731).
    /// /api/gallery/submit and /api/gallery/report take the launcher's signed
    /// ticket in the query, verified the way /api/play/join verifies it.
    ///
    /// The six staff doors took the cookie and nothing else until the site's
    /// #744 put one gate in front of all of them, galleryStaff, which takes
    /// either that cookie or a ticket whose Discord account holds a staff role
    /// (st.dev, the access.dev set: Owner, Dev, Gamemaster, Moderator,
    /// Loremaster). So the queue, approve, reject and the delete of an approved
    /// picture are reachable from here over the same ticket Report uses.
    ///
    /// Nothing at this end decides who staff are. The site asks Discord about
    /// the account the ticket names on every one of these calls and refuses
    /// what it does not like; hiding staff tools from everybody else is
    /// tidiness on the page, not the gate.
    ///
    /// A site older than #744 answers these doors 403 {"error":"staff only"}
    /// with no "why" beside it, because it never read the ticket at all. That
    /// one shape is told apart from a real refusal, so an old site is reported
    /// as an old site instead of as an account that was turned down.
    ///
    /// Waiting pictures are fetched from /up/&lt;name&gt;?ticket=... when the
    /// site has #755 (galleryStaff on that door). Older sites refuse without
    /// a cookie; the queue still shows Accept / Delete / name / note either way.
    ///
    /// Reading fails quietly. A site that is down or a picture that will not
    /// load leaves Play's card as it was, and an empty list hides it, with
    /// nothing said.
    /// What speaks is what somebody pressed a button for, because they are
    /// owed an answer either way.
    /// </summary>
    static class Gallery
    {
        /// <summary>One picture in the feed, and the loaded image once it has been fetched.</summary>
        public class Shot
        {
            public string Name = "";
            public string By = "";
            public string ImageUrl = "";     // absolute, ready to fetch
            public Bitmap Image;             // null until Fetch has loaded it
        }

        /// <summary>
        /// What /api/gallery/who says, for whoever is asking.
        ///
        /// Answered is the useful one here: a site older than the gallery
        /// doors has no such address and says nothing, and the Gallery page hides
        /// Report and upload rather than offering buttons that cannot work. The rest is
        /// the site's word about a BROWSER session, so from the launcher, which
        /// carries no cookie, Signed and Staff read false however the person is
        /// signed in elsewhere. Who the launcher is acting for is its ticket,
        /// and whether that ticket is staff is the dev flag /api/play/join
        /// already hands back (Standing.Dev), which is the same access.dev set
        /// the site calls staff.
        /// </summary>
        public class Who
        {
            public bool Answered;
            public bool Signed;
            public bool CanSubmit;
            public bool Staff;
            public bool Admin;
            public string Name = "";
        }

        // The public document. Same host the door and the roster already ask.
        static string Feed { get { return Discord.Site + "/api/public"; } }

        /// <summary>
        /// Site uploads page. Not shown as a launcher placeholder: Accept /
        /// Delete live as real buttons on the Gallery page (#731).
        /// </summary>
        public static string StaffPage { get { return Discord.Site + "/uploads"; } }

        /// <summary>One picture waiting in the queue, as /api/gallery/pending lists it.</summary>
        public class Pending
        {
            public string Name = "";
            public string By = "";
            public string Note = "";
            public string From = "";
            /// <summary>Local time it was sent, or MinValue when the site did not say.</summary>
            public DateTime When = DateTime.MinValue;
            /// <summary>Loaded image once FetchPending has got it, or null.</summary>
            public Bitmap Image;
            /// <summary>
            /// The widths of the smaller copies that came with it (#3218),
            /// which the card shows beside it and Accept names.
            /// </summary>
            public int[] Copies = new int[0];
        }

        /// <summary>
        /// The widths of a picture's smaller copies (#3218), the site's
        /// SMALL_WIDTHS: the site shows these in its place on screens that
        /// draw it smaller, and cannot make them itself.
        /// </summary>
        public static readonly int[] CopyWidths = new int[] { 800, 1600 };

        /// <summary>
        /// Blocking. Call it off the UI thread. The pictures the site is
        /// showing, in the order it put them; an empty list when it shows
        /// none, and null when the feed cannot be read, so a read that failed
        /// is not taken for a gallery with nothing on it. No image is fetched
        /// here; that waits until the card turns to one.
        /// </summary>
        public static List<Shot> Load()
        {
            var shots = new List<Shot>();
            try
            {
                string text = GetText(Feed, 5000);
                if (text.Length == 0) return null;

                // Only the gallery array out of the document, so a "url" or a
                // "name" somewhere else in it is not read as a picture.
                string arr = ArrayField(text, "gallery");
                if (arr.Length == 0) return shots;

                foreach (Match m in Regex.Matches(arr, "\\{(.*?)\\}", RegexOptions.Singleline))
                {
                    string body = m.Groups[1].Value;
                    string img = Resolve(Str(body, "url"), Str(body, "name"));
                    if (img.Length == 0) continue;

                    var s = new Shot();
                    s.Name = Str(body, "name");
                    s.By = Str(body, "by");
                    s.ImageUrl = img;
                    shots.Add(s);
                }
            }
            catch
            {
                // The gallery is a nicety on the Play page, never a reason to
                // stop anybody. A feed that will not read leaves the card as it
                // was, and nothing is logged over a picture.
                return null;
            }
            return shots;
        }

        /// <summary>
        /// Gives each picture in a list just read the image already loaded for
        /// the same address in the list before it, so reading the list again
        /// does not send the Play card back to downloading every picture.
        /// </summary>
        public static void KeepLoaded(List<Shot> fresh, List<Shot> had)
        {
            if (fresh == null || had == null) return;
            foreach (Shot s in fresh)
            {
                if (s == null || s.Image != null) continue;
                foreach (Shot h in had)
                {
                    if (h == null || h.Image == null) continue;
                    if (!string.Equals(h.ImageUrl, s.ImageUrl, StringComparison.Ordinal)) continue;
                    s.Image = h.Image;
                    break;
                }
            }
        }

        /// <summary>
        /// The picture behind a shot, fetched once and kept on it. Blocking;
        /// call it off the UI thread. Null when it cannot be loaded, and the
        /// caller then turns to the next one.
        /// </summary>
        public static Bitmap Fetch(Shot shot)
        {
            if (shot == null) return null;
            if (shot.Image != null) return shot.Image;
            try
            {
                byte[] raw = GetBytes(shot.ImageUrl, 8000);
                if (raw == null || raw.Length == 0) return null;

                // Avalonia reads the whole picture when the Bitmap is made, so
                // the stream can close under it and nothing is read lazily and
                // left blank. A Bitmap may be made off the window's thread and
                // drawn on it.
                Bitmap bi;
                using (var ms = new MemoryStream(raw)) bi = new Bitmap(ms);
                shot.Image = bi;
                return bi;
            }
            catch { return null; }
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. The bytes of one waiting picture
        /// at /up/&lt;name&gt;, with this copy's ticket in the query so staff can
        /// see it without a browser cookie (#755). Null when the site refuses
        /// or the picture will not load; the card still shows Accept / Delete.
        /// </summary>
        public static Bitmap FetchPending(Pending item)
        {
            if (item == null || item.Name == null || item.Name.Length == 0) return null;
            if (item.Image != null) return item.Image;
            item.Image = LoadUp(item.Name, 0);
            return item.Image;
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. One smaller copy of a waiting
        /// picture (#3218), from /up/&lt;name&gt;?w=&lt;width&gt; the same
        /// way, for the card to show beside it. Null when it will not load.
        /// </summary>
        public static Bitmap FetchCopy(Pending item, int width)
        {
            if (item == null || item.Name == null || item.Name.Length == 0) return null;
            return LoadUp(item.Name, width);
        }

        static Bitmap LoadUp(string name, int width)
        {
            if (Discord.Ticket == null) return null;
            try
            {
                string url = Discord.Site + "/up/" + Uri.EscapeDataString(name) +
                             "?ticket=" + Uri.EscapeDataString(Discord.Ticket) +
                             (width > 0 ? "&w=" + width : "");
                byte[] raw = GetBytes(url, 8000);
                if (raw == null || raw.Length == 0) return null;

                using (var ms = new MemoryStream(raw)) return new Bitmap(ms);
            }
            catch (Exception ex)
            {
                Swallow.Note(width > 0 ? "Gallery.FetchCopy" : "Gallery.FetchPending", ex);
                return null;
            }
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. What the site says the caller
        /// may do on the gallery, or an unanswered Who when the address is not
        /// there or the site could not be reached.
        /// </summary>
        public static Who AskWho()
        {
            var w = new Who();
            string text = GetText(Discord.Site + "/api/gallery/who", 5000);
            // A site without the gallery doors answers 404, which GetText
            // brings back as "". Anything else must at least carry the fields
            // before it is read as an answer.
            if (text.IndexOf("\"signed\"", StringComparison.Ordinal) < 0) return w;
            w.Answered = true;
            w.Signed = Flag(text, "signed");
            w.CanSubmit = Flag(text, "canSubmit");
            w.Staff = Flag(text, "staff");
            w.Admin = Flag(text, "admin");
            w.Name = Str(text, "name");
            return w;
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Reports one approved picture to
        /// staff, over the same signed ticket the door uses at /api/play/join.
        /// "" when the site took it, and a sentence to show the person when it
        /// did not.
        ///
        /// Nothing comes down here: the report sits in gallery-reports.json for
        /// staff to look at, and the picture stays on the gallery until one of
        /// them takes it off at the site.
        /// </summary>
        public static string Report(string name, string why)
        {
            if (name == null || name.Trim().Length == 0)
                return "There is no picture on the card to report.";
            if (!Discord.Linked)
                return "Connect Discord first, so the site knows who is reporting this.";

            string reason = why == null ? "" : why.Trim();
            // The site keeps the first 500 characters and drops the rest, so
            // the cut happens here rather than surprising anybody later.
            if (reason.Length > 500) reason = reason.Substring(0, 500);

            string url = Discord.Site + "/api/gallery/report?ticket=" +
                         Uri.EscapeDataString(Discord.Ticket);
            string body = "{\"name\":\"" + Discord.Escape(name.Trim()) + "\"" +
                          ",\"why\":\"" + Discord.Escape(reason) + "\"}";

            string reply = "";
            int code;
            try { code = Discord.PostJson(url, body, out reply); }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Report", ex);
                return "Could not reach thornswood.net to send that report.";
            }

            if (code == 200) return "";
            if (code == 0) return "Could not reach thornswood.net to send that report.";

            // The site says why on every refusal it means. Its own words are
            // better than anything invented here, so they are what is shown.
            string said = Str(reply, "error");
            if (said.Length == 0) said = Str(reply, "message");
            if (said.Length > 0) return said;

            if (code == 401) return "The site would not take this copy's Discord link. Connect Discord again and try once more.";
            if (code == 403) return "That Discord account is not allowed to report pictures.";
            if (code == 404) return "That picture is not on the gallery any more.";
            return "The site answered " + code + ", so the report was not kept.";
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Sends one screenshot into the
        /// site's gallery queue over /api/gallery/submit. The body IS the file;
        /// the ticket, offered name, byline and note ride in the query, matching
        /// the site's receiveUpload path. What the file says about where and
        /// when it was made (Exif, XMP, GPS and the like) is taken out first,
        /// by MediaStrip, so it never leaves this machine (#3648).
        ///
        /// "" when the site took it, and a sentence to show the person when it
        /// did not. Allowed kinds match the site's GALLERY_ALLOW: png, jpg,
        /// jpeg, webp, gif, mp4, webm. Cap is 100 MB to match the site.
        ///
        /// Then its smaller copies (SendCopies, #3218). copies is "" when they
        /// went or none was needed, and a sentence when one did not; the
        /// picture is in either way.
        /// </summary>
        public static string Submit(string path, string by, string note, out string copies)
        {
            copies = "";
            if (path == null || path.Trim().Length == 0)
                return "Choose a picture to send first.";
            if (!Discord.Linked)
                return "Connect Discord first, so the site knows who is sending this.";
            if (!File.Exists(path))
                return "That file is not there any more.";

            string offered = Path.GetFileName(path);
            string ext = Path.GetExtension(offered).ToLowerInvariant();
            if (Array.IndexOf(AllowExt, ext) < 0)
                return "That kind of file is not allowed. Send a png, jpg, jpeg, webp, gif, mp4 or webm.";

            // Cap matches the site's GALLERY_CAP (100 MB). Cut here so a huge
            // file is refused before the bytes leave the machine.
            const long Cap = 100L * 1024L * 1024L;
            long len;
            try { len = new FileInfo(path).Length; }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Submit size", ex);
                return "Could not read that file.";
            }
            if (len <= 0) return "That file is empty.";
            if (len > Cap) return "That file is over 100 MB.";

            byte[] data;
            try { data = File.ReadAllBytes(path); }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Submit read", ex);
                return "Could not read that file.";
            }

            // Where and when it was made stays on this machine (#3648): a
            // phone or camera picture says so in its Exif, GPS included, and
            // the site serves the file it is sent to anyone.
            Exception unwalked;
            byte[] clean = MediaStrip.Clean(data, ext, out unwalked);
            if (clean == null)
            {
                if (unwalked != null) Swallow.Note("Gallery.Submit clean", unwalked);
                return "That file could not be read to take out where and when it was made, so it was not sent.";
            }
            data = clean;

            string who = by == null ? "" : by.Trim();
            if (who.Length > 40) who = who.Substring(0, 40);
            string remark = note == null ? "" : note.Trim();
            if (remark.Length > 300) remark = remark.Substring(0, 300);

            string url = Discord.Site + "/api/gallery/submit?ticket=" +
                         Uri.EscapeDataString(Discord.Ticket) +
                         "&name=" + Uri.EscapeDataString(offered) +
                         "&by=" + Uri.EscapeDataString(who) +
                         "&note=" + Uri.EscapeDataString(remark);

            string reply = "";
            int code;
            try { code = Discord.PostBytes(url, data, ContentTypeFor(ext), 60000, out reply); }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Submit", ex);
                return "Could not reach thornswood.net to send that picture.";
            }

            if (code == 200)
            {
                copies = SendCopies(data, ext, Str(reply, "name"));
                return "";
            }
            if (code == 0) return "Could not reach thornswood.net to send that picture.";

            string said = Str(reply, "error");
            if (said.Length == 0) said = Str(reply, "message");
            if (said.Length > 0) return said;

            if (code == 401) return "The site would not take this copy's Discord link. Connect Discord again and try once more.";
            if (code == 403) return "That Discord account is not allowed to send pictures.";
            if (code == 413) return "That file is over 100 MB.";
            if (code == 415) return "That kind of file is not allowed. Send a png, jpg, jpeg, webp, gif, mp4 or webm.";
            return "The site answered " + code + ", so the picture was not kept.";
        }

        /// <summary>Extensions the site's GALLERY_ALLOW accepts today.</summary>
        static readonly string[] AllowExt = new string[] { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm" };

        static string ContentTypeFor(string ext)
        {
            if (ext == ".png") return "image/png";
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".webp") return "image/webp";
            if (ext == ".gif") return "image/gif";
            if (ext == ".mp4") return "video/mp4";
            if (ext == ".webm") return "video/webm";
            return "application/octet-stream";
        }

        /// <summary>
        /// Blocking. A picture's smaller copies (#3218), sent after it to
        /// /api/gallery/copy, because the site cannot make a picture smaller:
        /// one for each of CopyWidths the picture is wider than, as it is shown
        /// (a camera JPEG turned a quarter by its Exif is turned here too, as
        /// the site reads it), at the picture's shape. JPEG, as the WPF
        /// launcher sent them, since it could write no WebP; SkiaSharp, which
        /// reads and writes them now, could, and that would be a change of
        /// its own. The site checks each against the picture's own size, and
        /// staff see them beside it before Accept.
        ///
        /// "" when they went or none was needed (a gif, a recording, a picture
        /// 800 wide or less), or a sentence saying the first that did not go.
        /// A picture with see-through parts gets none, since a JPEG cannot keep
        /// them; staff make WebP copies of it on the hub.
        /// </summary>
        static string SendCopies(byte[] data, string ext, string name)
        {
            if (ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp") return "";
            const string Full = ", so it will show at full size until staff make them.";
            if (name.Length == 0) return "The site took it but did not say its name, so its smaller copies were not sent" + Full;

            // The whole picture, decoded once, four bytes a pixel with its
            // alpha as it is (not premultiplied), so SeeThrough can read it.
            SKBitmap whole;
            int turn;
            try
            {
                using (var codec = SKCodec.Create(new MemoryStream(data)))
                {
                    if (codec == null) throw new InvalidDataException("SkiaSharp knows no decoder for it.");
                    turn = ext == ".jpg" || ext == ".jpeg" ? Orientation(codec) : 1;
                    SKImageInfo info = codec.Info;
                    whole = SKBitmap.Decode(codec, new SKImageInfo(info.Width, info.Height, SKColorType.Bgra8888,
                        info.AlphaType == SKAlphaType.Opaque ? SKAlphaType.Opaque : SKAlphaType.Unpremul));
                    if (whole == null) throw new InvalidDataException("SkiaSharp could not decode it.");
                }
            }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.SendCopies read", ex);
                return "This copy of Windows could not read it to make its smaller copies" + Full;
            }
            using (whole)
            {
                bool quarter = turn >= 5 && turn <= 8;
                int shownWide = quarter ? whole.Height : whole.Width;

                foreach (int width in CopyWidths)
                {
                    if (width >= shownWide) continue;
                    byte[] jpg;
                    try
                    {
                        // Turned a quarter, its height on disk is its width shown.
                        int wide, high;
                        if (quarter) { high = width; wide = Math.Max(1, (int)Math.Round(whole.Width * (double)width / whole.Height)); }
                        else { wide = width; high = Math.Max(1, (int)Math.Round(whole.Height * (double)width / whole.Width)); }
                        using (SKBitmap small = whole.Resize(new SKImageInfo(wide, high, whole.ColorType, whole.AlphaType),
                                                             new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear)))
                        {
                            if (small == null) throw new InvalidOperationException("SkiaSharp could not make it " + width + " wide.");
                            if (SeeThrough(small)) return "It has see-through parts, which a JPEG copy cannot keep" + Full;
                            using (SKBitmap shown = Turned(small, turn))
                            using (SKData enc = shown.Encode(SKEncodedImageFormat.Jpeg, 85))
                            {
                                if (enc == null) throw new InvalidOperationException("SkiaSharp could not write it as a JPEG.");
                                jpg = enc.ToArray();
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Swallow.Note("Gallery.SendCopies make " + width, ex);
                        return "Its " + width + " pixel copy could not be made here" + Full;
                    }

                    string url = Discord.Site + "/api/gallery/copy?ticket=" +
                                 Uri.EscapeDataString(Discord.Ticket) +
                                 "&name=" + Uri.EscapeDataString(name) +
                                 "&w=" + width;
                    string reply = "";
                    int code;
                    try { code = Discord.PostBytes(url, jpg, "image/jpeg", 60000, out reply); }
                    catch (Exception ex)
                    {
                        Swallow.Note("Gallery.SendCopies send " + width, ex);
                        code = 0;
                    }
                    if (code == 200) continue;
                    string said = Str(reply, "error");
                    if (said.Length == 0) said = code == 0 ? "thornswood.net could not be reached" : "the site answered " + code;
                    return "Its " + width + " pixel copy did not go (" + said.TrimEnd('.') + ")" + Full;
                }
            }
            return "";
        }

        /// <summary>
        /// The Exif orientation of a JPEG, 1 to 8, or 1 when it says none.
        /// Only a JPEG is asked: the WPF launcher could not read a PNG's or a
        /// WebP's, and took them as 1, and so does this.
        /// </summary>
        static int Orientation(SKCodec codec)
        {
            int n = (int)codec.EncodedOrigin;
            return n < 1 || n > 8 ? 1 : n;
        }

        /// <summary>
        /// A picture stored with that Exif orientation, the way it is shown: a
        /// mirror, a quarter turn, or both. Each matrix maps a pixel where it
        /// is stored to where it is shown; a quarter turn swaps the width and
        /// the height. 1 is shown as it is stored, and comes back as a copy.
        /// </summary>
        static SKBitmap Turned(SKBitmap src, int turn)
        {
            if (turn < 1 || turn > 8) turn = 1;
            bool quarter = turn >= 5;
            float w = quarter ? src.Height : src.Width, h = quarter ? src.Width : src.Height;
            SKMatrix m;
            switch (turn)
            {
                case 2: m = new SKMatrix(-1, 0, w, 0, 1, 0, 0, 0, 1); break;    // mirrored
                case 3: m = new SKMatrix(-1, 0, w, 0, -1, h, 0, 0, 1); break;   // half a turn
                case 4: m = new SKMatrix(1, 0, 0, 0, -1, h, 0, 0, 1); break;    // upside down, mirrored
                case 5: m = new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1); break;     // a quarter turn clockwise, mirrored
                case 6: m = new SKMatrix(0, -1, w, 1, 0, 0, 0, 0, 1); break;    // a quarter turn clockwise
                case 7: m = new SKMatrix(0, -1, w, -1, 0, h, 0, 0, 1); break;   // three quarters clockwise, mirrored
                case 8: m = new SKMatrix(0, 1, 0, -1, 0, h, 0, 0, 1); break;    // three quarters clockwise
                default: m = SKMatrix.Identity; break;
            }
            var dst = new SKBitmap(new SKImageInfo((int)w, (int)h, src.ColorType, src.AlphaType));
            using (var canvas = new SKCanvas(dst))
            {
                canvas.SetMatrix(m);
                canvas.DrawBitmap(src, 0, 0);
            }
            return dst;
        }

        /// <summary>
        /// Whether any pixel of a picture is less than solid. A picture saved
        /// with an alpha channel that is solid throughout, as many screenshots
        /// are, is not. The picture is four bytes a pixel, alpha last.
        /// </summary>
        static bool SeeThrough(SKBitmap bi)
        {
            if (bi.AlphaType == SKAlphaType.Opaque) return false;
            ReadOnlySpan<byte> px = bi.GetPixelSpan();
            for (int i = 3; i < px.Length; i += 4)
                if (px[i] != 255) return true;
            return false;
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. What is waiting for staff to
        /// look at, in the order the site keeps it.
        ///
        /// bad is "" when the list is the site's own answer, and a sentence to
        /// show the person when it is not, so an empty list with an empty bad
        /// means nothing is waiting rather than nothing was learnt.
        /// </summary>
        public static List<Pending> Queue(out string bad)
        {
            bad = "";
            var waiting = new List<Pending>();
            if (!Discord.Linked) { bad = NotLinked; return waiting; }

            string reply;
            int code = Ask("GET", "/api/gallery/pending", null, out reply);
            if (code != 200) { bad = Trouble(code, reply, "read the gallery queue"); return waiting; }

            // Only the pending array, so a name or a note somewhere else in the
            // document is not read as a picture, the same as Load does.
            string arr = ArrayField(reply, "pending");
            if (arr.Length == 0) return waiting;

            foreach (Match m in Regex.Matches(arr, "\\{(.*?)\\}", RegexOptions.Singleline))
            {
                string body = m.Groups[1].Value;
                var p = new Pending();
                p.Name = Str(body, "name");
                if (p.Name.Length == 0) continue;
                p.By = Str(body, "by");
                p.Note = Str(body, "note");
                p.From = Str(body, "from");
                p.When = Moment(Num(body, "at"));
                p.Copies = Widths(body, "copies");
                waiting.Add(p);
            }
            return waiting;
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Puts one waiting picture on the
        /// public gallery. "" when the site did it, and a sentence to show the
        /// person when it did not.
        ///
        /// Doing it twice is not an error: the site leaves a name that is
        /// already on the gallery where it is and answers 200 either way.
        ///
        /// shown is the widths of the smaller copies the card showed beside it
        /// (#3218). The site puts only those on the gallery with it, so what
        /// goes out is what staff saw.
        /// </summary>
        public static string Approve(string name, int[] shown)
        {
            var list = new List<string>();
            if (shown != null)
                foreach (int n in shown)
                    if (Array.IndexOf(CopyWidths, n) >= 0) list.Add(n.ToString());
            return Staff("POST", "/api/gallery/approve", name, "approve that picture",
                         ",\"copies\":[" + string.Join(",", list.ToArray()) + "]");
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Takes one waiting picture off
        /// the queue without putting it up. "" when the site did it, and a
        /// sentence to show the person when it did not.
        ///
        /// The site decides what happens to the file (#2352): it is deleted,
        /// unless somebody reported the picture, and then the site keeps it out
        /// of sight for 30 days for staff and deletes it after. Nothing here
        /// says which.
        /// </summary>
        public static string Reject(string name)
        {
            // Pending delete shares DELETE /api/gallery/approved (#774); no Reject door.
            return Staff("DELETE", "/api/gallery/approved", name, "delete that picture");
        }

        /// <summary>
        /// Blocking. Call it off the UI thread. Takes an approved picture off
        /// the public gallery, which is what a report is answered with. "" when
        /// the site did it, and a sentence to show the person when it did not.
        ///
        /// The site moves any open report against that name onto the file's
        /// note in the same move and keeps the file out of sight for 30 days
        /// for staff, then deletes it; with no report the file is deleted
        /// (#2352).
        /// </summary>
        public static string TakeDown(string name)
        {
            return Staff("DELETE", "/api/gallery/approved", name, "take that picture down");
        }

        /// <summary>
        /// The three doors that are a name and nothing else, sent the one way:
        /// this copy's ticket in the query, the name in the body, both escaped.
        /// </summary>
        static string Staff(string method, string door, string name, string what)
        {
            return Staff(method, door, name, what, "");
        }

        /// <summary>The same, with more fields after the name (more starts with a comma).</summary>
        static string Staff(string method, string door, string name, string what, string more)
        {
            if (name == null || name.Trim().Length == 0)
                return "There is no picture on the card to work on.";
            if (!Discord.Linked) return NotLinked;

            string reply;
            string body = "{\"name\":\"" + Discord.Escape(name.Trim()) + "\"" + more + "}";
            int code = Ask(method, door, body, out reply);
            if (code == 200) return "";
            return Trouble(code, reply, what);
        }

        /// <summary>
        /// One call to a staff door, with this copy's ticket in the query the
        /// way Report sends its own. Blocking. The status code, and whatever the
        /// site said in reply; 0 when it could not be reached at all.
        /// </summary>
        static int Ask(string method, string door, string body, out string reply)
        {
            reply = "";
            try
            {
                string url = Discord.Site + door + "?ticket=" +
                             Uri.EscapeDataString(Discord.Ticket);
                return Discord.Send(method, url, body, out reply);
            }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Ask " + door, ex);
                return 0;
            }
        }

        const string NotLinked = "Connect Discord first, so the site knows who is asking.";

        /// <summary>
        /// The sentence to show when a staff door did not answer 200. The site
        /// says why on every refusal it means, and its own words are better than
        /// anything invented here, so they are what is shown.
        ///
        /// The one refusal that is read rather than repeated is a site older
        /// than #743: those doors never looked at a ticket, and their 403 is the
        /// flat "staff only" with no why beside it. Showing that would tell a
        /// Gamemaster that their account is not staff, when the truth is that
        /// the site has not been updated yet, so it is named for what it is and
        /// the person is pointed at the site page, which still works.
        /// </summary>
        static string Trouble(int code, string reply, string what)
        {
            if (code == 0) return "Could not reach thornswood.net to " + what + ".";

            if (code == 403 && Str(reply, "why").Length == 0 &&
                Str(reply, "error") == "staff only")
                return "This thornswood.net does not take staff work from the launcher yet. " +
                       "Deploy the site update that lets a ticket work the gallery queue (#744), then try Accept again.";

            string said = Str(reply, "error");
            if (said.Length == 0) said = Str(reply, "message");
            if (said.Length > 0) return said;

            if (code == 401) return "The site would not take this copy's Discord link. Connect Discord again and try once more.";
            if (code == 403) return "That Discord account may not work the gallery queue.";
            if (code == 404) return "That picture is not on the gallery any more.";
            return "The site answered " + code + ", so nothing changed.";
        }

        /// <summary>
        /// The address to fetch a picture from. An absolute url is used as it
        /// is; a site-relative one such as /shot/&lt;name&gt; hangs off the
        /// site; failing both, the name alone goes to the shot door the site
        /// serves pictures from.
        /// </summary>
        static string Resolve(string url, string name)
        {
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return url;
            if (url.Length > 0)
                return Discord.Site + (url.StartsWith("/") ? url : "/" + url);
            if (name.Length > 0)
                return Discord.Site + "/shot/" + name;
            return "";
        }

        // One client for every read here, as HttpClient is meant to be used.
        // Its own timeout is far too long, so each read has its own: ms for
        // the site to answer, so a site that is merely slow does not look like
        // a hung launcher, and five minutes for the bytes after that, the
        // read limit the WebClient this replaced had.
        static readonly HttpClient web = new HttpClient() { Timeout = Timeout.InfiniteTimeSpan };

        /// <summary>The body of a GET, or null when it failed or did not answer 2xx.</summary>
        static byte[] GetBytes(string url, int ms)
        {
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Get, url))
                using (var answer = new CancellationTokenSource(ms))
                {
                    req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher/" + Updater.Version);
                    using (HttpResponseMessage resp = web.Send(req, HttpCompletionOption.ResponseHeadersRead, answer.Token))
                    using (var read = new CancellationTokenSource(TimeSpan.FromMinutes(5)))
                    {
                        if (!resp.IsSuccessStatusCode) return null;
                        // With the token, so the limit holds for the whole body.
                        return resp.Content.ReadAsByteArrayAsync(read.Token).GetAwaiter().GetResult();
                    }
                }
            }
            catch { return null; }
        }

        static string GetText(string url, int ms)
        {
            byte[] raw = GetBytes(url, ms);
            if (raw == null || raw.Length == 0) return "";
            int at = 0;
            if (raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) at = 3;
            return Encoding.UTF8.GetString(raw, at, raw.Length - at);
        }

        /// <summary>
        /// The value of one array field out of a flat document, brackets and
        /// all, aware of strings so a bracket inside a name or a byline does
        /// not end it early. "" when the key is not there.
        /// </summary>
        static string ArrayField(string json, string key)
        {
            int i = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            if (i < 0) return "";
            i = json.IndexOf('[', i);
            if (i < 0) return "";

            int depth = 0;
            bool inStr = false;
            for (int j = i; j < json.Length; j++)
            {
                char c = json[j];
                if (inStr)
                {
                    if (c == '\\') { j++; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '[') depth++;
                else if (c == ']') { depth--; if (depth == 0) return json.Substring(i, j - i + 1); }
            }
            return "";
        }

        /// <summary>
        /// One string field out of an object body. Read with a regex rather
        /// than a serializer, as Roster does it: written when the launcher's
        /// only serializer could not read a shape it was not told in advance,
        /// and still enough for the few fields read here.
        /// </summary>
        /// <summary>
        /// A list of copy widths out of an object body, such as
        /// "copies":[800,1600], keeping only the widths in CopyWidths. Empty
        /// when it is not there.
        /// </summary>
        static int[] Widths(string body, string key)
        {
            var m = Regex.Match(body, "\"" + key + "\"\\s*:\\s*\\[([0-9,\\s]*)\\]");
            var list = new List<int>();
            if (!m.Success) return list.ToArray();
            foreach (string part in m.Groups[1].Value.Split(','))
            {
                int n;
                if (int.TryParse(part.Trim(), out n) && Array.IndexOf(CopyWidths, n) >= 0 && !list.Contains(n)) list.Add(n);
            }
            return list.ToArray();
        }

        static string Str(string body, string key)
        {
            var m = Regex.Match(body, "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            if (!m.Success) return "";
            return m.Groups[1].Value
                    .Replace("\\\"", "\"")
                    .Replace("\\/", "/")
                    .Replace("\\\\", "\\");
        }

        /// <summary>
        /// One true or false field out of a flat document. Anything that is
        /// not the word true reads as false, so a field the site stops sending
        /// is a no rather than a yes.
        /// </summary>
        static bool Flag(string json, string key)
        {
            return Regex.IsMatch(json, "\"" + key + "\"\\s*:\\s*true");
        }

        /// <summary>
        /// One whole number field out of an object body, or 0 when it is not
        /// there and when it is not a number.
        /// </summary>
        static long Num(string body, string key)
        {
            var m = Regex.Match(body, "\"" + key + "\"\\s*:\\s*(-?[0-9]+)");
            long v;
            if (!m.Success || !long.TryParse(m.Groups[1].Value, out v)) return 0;
            return v;
        }

        /// <summary>
        /// The site's milliseconds since 1970 as local time, or MinValue when
        /// there is no time in it, so a queue entry from a site that did not
        /// say when simply does not say when on the card.
        /// </summary>
        static DateTime Moment(long ms)
        {
            if (ms <= 0) return DateTime.MinValue;
            try
            {
                return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                       .AddMilliseconds(ms).ToLocalTime();
            }
            catch (Exception ex)
            {
                Swallow.Note("Gallery.Moment", ex);
                return DateTime.MinValue;
            }
        }
    }
}
