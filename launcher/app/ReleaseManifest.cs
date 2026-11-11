using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Thornswood
{
    /// <summary>
    /// The members of a signed Windows catalog (#2163): the digest of each
    /// file it lists, which for a file that is not a program is its sha256.
    /// The signed release record of every merge release is a catalog over
    /// manifest.json (VeloRecord.cs), and this is how its list is read;
    /// Signature.Refusal is what says the catalog is ours.
    ///
    /// The check of the old update feed's release.json against the feed's
    /// assets went with the feed (#5608). Kept apart, with nothing in it but
    /// the framework, so launcher\tests\test-2163-manifest-check.ps1 can
    /// compile it with Signature on their own and point them at a catalog
    /// ThornswoodRelease really signed.
    /// </summary>
    public static partial class ReleaseManifest
    {
        public static string Sha256(string path)
        {
            using (var sha = SHA256.Create())
            using (var fs = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
        }

        // ---- the catalog's members, through wintrust ------------------------

        const uint CRYPTCAT_OPEN_EXISTING = 0x00000004;
        const uint CRYPTCAT_VERSION_1 = 0x100;
        const uint CRYPTCAT_VERSION_2 = 0x200;
        const uint ENCODING = 0x00010001; // X509_ASN_ENCODING | PKCS_7_ASN_ENCODING

        [StructLayout(LayoutKind.Sequential)]
        struct BLOB
        {
            public uint cbData;
            public IntPtr pbData;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct CRYPTCATMEMBER
        {
            public uint cbStruct;
            public IntPtr pwszReferenceTag;
            public IntPtr pwszFileName;
            public Guid gSubjectType;
            public uint fdwMemberFlags;
            public IntPtr pIndirectData;
            public uint dwCertVersion;
            public uint dwReserved;
            public IntPtr hReserved;
            public BLOB sEncodedIndirectData;
            public BLOB sEncodedMemberInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SIP_INDIRECT_DATA
        {
            public IntPtr DataObjId;
            public BLOB DataValue;
            public IntPtr DigestAlgorithmObjId;
            public BLOB DigestAlgorithmParameters;
            public BLOB Digest;
        }

        [LibraryImport("wintrust.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial IntPtr CryptCATOpen(string fileName, uint openFlags, IntPtr hProv, uint publicVersion, uint encodingType);

        [LibraryImport("wintrust.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool CryptCATClose(IntPtr hCatalog);

        [LibraryImport("wintrust.dll")]
        private static partial IntPtr CryptCATEnumerateMember(IntPtr hCatalog, IntPtr prevMember);

        /// <summary>
        /// The digest of every member of the catalog, lowercase hex. For a
        /// file that is not a program (manifest.json) that is its sha256. Read
        /// from the catalog itself; Signature.Refusal is what says the catalog
        /// is ours. Throws when the catalog cannot be opened.
        /// </summary>
        public static HashSet<string> CatalogDigests(string catalogPath)
        {
            string full = Path.GetFullPath(catalogPath);
            IntPtr cat = CryptCATOpen(full, CRYPTCAT_OPEN_EXISTING, IntPtr.Zero, CRYPTCAT_VERSION_2, ENCODING);
            if (cat == IntPtr.Zero || cat == new IntPtr(-1))
                cat = CryptCATOpen(full, CRYPTCAT_OPEN_EXISTING, IntPtr.Zero, CRYPTCAT_VERSION_1, ENCODING);
            if (cat == IntPtr.Zero || cat == new IntPtr(-1))
                throw new Exception("Windows could not open the catalog (error " + Marshal.GetLastWin32Error() + ").");
            var digests = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                IntPtr m = IntPtr.Zero;
                while ((m = CryptCATEnumerateMember(cat, m)) != IntPtr.Zero)
                {
                    var member = Marshal.PtrToStructure<CRYPTCATMEMBER>(m);
                    if (member.pIndirectData == IntPtr.Zero) continue;
                    var ind = Marshal.PtrToStructure<SIP_INDIRECT_DATA>(member.pIndirectData);
                    if (ind.Digest.cbData == 0 || ind.Digest.pbData == IntPtr.Zero) continue;
                    var b = new byte[ind.Digest.cbData];
                    Marshal.Copy(ind.Digest.pbData, b, 0, b.Length);
                    digests.Add(BitConverter.ToString(b).Replace("-", "").ToLowerInvariant());
                }
            }
            finally
            {
                CryptCATClose(cat);
            }
            return digests;
        }
    }
}
