using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Wraps the two or three strings on this machine that are worth stealing:
    /// the server password, the update token, and the Discord ticket.
    ///
    /// DPAPI with CurrentUser scope, which means Windows ties the ciphertext to
    /// this Windows account on this machine. Another account on the same PC
    /// cannot read it, and copying config.json onto a different machine gets
    /// you a file that will not open. That is the whole ambition. It does not
    /// defend against something already running as this person, because nothing
    /// short of a password prompt on every launch would, and nobody wants that
    /// to start a game.
    ///
    /// Everything is tagged so an old plaintext file still loads. Unprotect
    /// hands back anything without the tag unchanged, which is what makes this
    /// safe to drop into an install that already exists: the next Save writes
    /// it back encrypted and the plaintext is gone.
    ///
    /// Protect never hands a secret back unencrypted. When DPAPI refuses it
    /// logs the refusal and throws, so the caller writes nothing rather than
    /// a secret in the clear. Unprotect still gives back an empty string on
    /// failure, because there is nothing to recover and the launcher asks
    /// for it again.
    /// </summary>
    public static class Secrets
    {
        const string Tag = "dpapi:";
        static readonly byte[] Extra = Encoding.UTF8.GetBytes("Thornswood");

        public static string Protect(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return "";
            if (plain.StartsWith(Tag, StringComparison.Ordinal)) return plain;
            try
            {
                byte[] b = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain),
                                                 Extra, DataProtectionScope.CurrentUser);
                return Tag + Convert.ToBase64String(b);
            }
            catch (Exception ex)
            {
                // This used to hand the plain string back, so a machine where
                // DPAPI refused wrote the password or the Discord ticket into
                // its file in the clear, and nothing anywhere said so. A
                // secret this cannot encrypt is not stored at all: the line
                // below says why and the throw stops the caller writing it.
                // Both callers already catch and log (Config.Save,
                // Discord.Save), so the launcher still starts and asks for
                // the secret again. The line reads "Swallowed in" because
                // that is Swallow's own wording; the exception goes on up.
                Swallow.Note("Secrets.Protect, Windows would not encrypt a secret for this " +
                             "account, so it was not stored and never in the clear", ex);
                throw;
            }
        }

        public static string Unprotect(string stored)
        {
            if (string.IsNullOrEmpty(stored)) return "";
            if (!stored.StartsWith(Tag, StringComparison.Ordinal)) return stored;
            try
            {
                byte[] b = Convert.FromBase64String(stored.Substring(Tag.Length));
                return Encoding.UTF8.GetString(
                    ProtectedData.Unprotect(b, Extra, DataProtectionScope.CurrentUser));
            }
            catch
            {
                // Written by a different Windows account, or the profile was
                // rebuilt. Nothing to recover: the launcher asks for it again.
                return "";
            }
        }

        /// <summary>
        /// Takes inherited permissions off a file and leaves this account as the
        /// only one on it. Belt to the DPAPI's braces, and the thing that stops
        /// a file appearing in somebody's zipped-up folder being readable.
        /// </summary>
        public static void LockDown(string path)
        {
            try
            {
                if (!File.Exists(path)) return;
                var file = new FileInfo(path);
                var acl = file.GetAccessControl();
                acl.SetAccessRuleProtection(true, false);
                foreach (FileSystemAccessRule r in
                         acl.GetAccessRules(true, false, typeof(NTAccount)))
                {
                    acl.RemoveAccessRule(r);
                }
                acl.AddAccessRule(new FileSystemAccessRule(
                    WindowsIdentity.GetCurrent().Name,
                    FileSystemRights.FullControl,
                    AccessControlType.Allow));
                file.SetAccessControl(acl);
            }
            catch (Exception ex) { Swallow.Note("Secrets.LockDown, " + path, ex); }
        }
    }
}
