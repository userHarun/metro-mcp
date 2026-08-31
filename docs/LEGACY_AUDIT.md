# Legacy code audit

The reference project at `C:\dev\ask-houston-metro` was inspected without modifying its working tree. Its uncommitted feature work was treated as reference material, not a source tree to copy wholesale.

## Reused ideas

- A bounded HTTP client with timeouts, accepted content types, response-size limits, and redacted structured logging
- V2 Alerts parsing and normalized route associations
- GTFS Realtime Trip Updates decoding and deterministic arrival ordering
- Static GTFS-to-D1 import flow and SQL query patterns
- Security tests around keys, URLs, upstream bodies, malformed data, and oversized responses

## Rewritten for this repository

- All shared schemas and provider boundaries
- The MCP registrations and local stdio runtime
- Worker routing, error mapping, rate limiting, and Static Assets integration
- D1 schema and catalog repository
- React composition, styling, installation snippets, and showcase behavior
- Workspace, build, CI, and documentation structure

No legacy secret, generated artifact, dependency tree, Git metadata, or full UI/Worker module was copied. The only credential-bearing file copied into this working tree is `.dev.vars`; it is explicitly ignored, and `.dev.vars.example` contains placeholders only.
