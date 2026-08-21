// Why: this fork builds Orca from source while the release feed still points at
// the upstream repository, so `updaterOptedOut()` in src/main/updater.ts leaves the
// updater off unless ORCA_ENABLE_UPDATER=1 — otherwise "update" would replace a
// locally built app with an official build and drop whatever the branch adds.
//
// The updater suites exist to exercise that feed, so they opt back in here instead
// of every file remembering to. A test that asserts the opted-out behaviour deletes
// this variable itself.
process.env.ORCA_ENABLE_UPDATER = '1'
