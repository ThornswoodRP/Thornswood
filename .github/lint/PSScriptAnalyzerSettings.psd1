# PSScriptAnalyzer settings for the build check's step "Lint (warnings only)",
# issue #1343. Errors and warnings, no informational rules. The step reports
# counts and never fails the build.
# PSAvoidUsingConvertToSecureStringWithPlainText: each hit wraps a value already
# plain in memory, or a test's own fixture, so it stays off the command line
# (#1069). The files it would hit, one place each (the harness for #4188
# holds this list to the tree, by file, since line numbers move with every edit):
#   scripts/deploy/Setup-Discord.ps1
#   scripts/ops/Discord-Hook.ps1
#   tests/test-prove-secret.ps1
#   tests/test-secret-channel.ps1
@{
    Severity     = @('Error', 'Warning')
    ExcludeRules = @(
        'PSAvoidUsingWriteHost'
        'PSAvoidUsingConvertToSecureStringWithPlainText'
    )
}
