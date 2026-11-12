# Background SDK wire fixtures

These fixtures are a frozen copy of the proposed background-agent SDK wire contract from `tasks/bakground-agents-ago-sdk/wire-fixtures` in the AGO workspace. `SHA256SUMS` records the copied files, including the manifest and the independently authored SDK expectations in `expected/`. The manifest describes HTTP cases, scenario phases, and the download hash.

The fixtures are proposed examples, not proof of backend or SDK conformance. Existing portions were source-checked against ago-chat commit `e8c5b1cbb8309fc1266d7548ce5da7a5054e9564` and ago-sdk commit `1c116bd896fa225833f472ead8639c9babdc15d7`; the new generic fields, follow and approval routes, and SDK observation lifecycle were absent at those baselines. Selected existing backend envelopes and errors have local HTTP evidence; proposed behavior requires implementation and verification.

Keep wire producers independent of these fixtures and of `expected/`. The expectations describe SDK-facing results and must not be used to generate wire responses. When the contract changes, update the fixture package and checksums in both repositories together.

Verify the copied files with `shasum -a 256 -c SHA256SUMS` from this directory.
