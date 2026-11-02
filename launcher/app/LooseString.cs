using System;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Thornswood
{
    /// <summary>
    /// Reads a JSON string member the way the launcher's documents have always
    /// been read: a number, true or false where a string belongs comes back as
    /// its text instead of refusing the whole document.
    ///
    /// The documents were read by .NET Framework's DataContractJsonSerializer
    /// until the move to .NET 10 (#4823), which System.Text.Json replaced
    /// because the native build cannot run a serializer that reads types at
    /// run time. That serializer took 1 or true into a string field without a
    /// word, and the feed counts on it: "maintenance" is a string so that
    /// true, "true", 1, null and "yes" all read (measured on 24 September,
    /// VersionDoc in Config.cs). System.Text.Json refuses a number in a string
    /// member and throws, and a throw there is the whole feed unread, so every
    /// context that reads a document from outside the launcher carries this.
    /// Null stays null: the serializer hands null to a string member itself.
    /// </summary>
    public sealed class LooseString : JsonConverter<string>
    {
        public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.String:
                    return reader.GetString();
                case JsonTokenType.Number:
                    return reader.HasValueSequence
                        ? Encoding.UTF8.GetString(System.Buffers.BuffersExtensions.ToArray(reader.ValueSequence))
                        : Encoding.UTF8.GetString(reader.ValueSpan);
                case JsonTokenType.True:
                    return "true";
                case JsonTokenType.False:
                    return "false";
                default:
                    throw new JsonException("a string was expected, not " + reader.TokenType);
            }
        }

        public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(value);
        }
    }
}
