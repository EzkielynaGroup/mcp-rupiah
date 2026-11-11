# Publishing notes (owner)

**GitHub description (<= 120 chars):**
MCP server for Rupiah: terbilang (angka ke kata), format & parse Rupiah, PPN 12% x 11/12 calculator. Offline, no key.

**Topics (13):** mcp, model-context-protocol, mcp-server, rupiah, terbilang, indonesia, bahasa-indonesia, ppn, vat, currency-format, claude, cursor, opencode

**Homepage:** https://www.npmjs.com/package/mcp-rupiah (after npm publish)

**Owner actions**
1. Create `EzkielynaGroup/mcp-rupiah` (public), push `main`.
2. `npm publish` (name `mcp-rupiah` was free on npm on 11 Nov 2026; re-check with `npm view mcp-rupiah`).
3. Publish `server.json` to the official MCP registry (`mcp-publisher publish`), after npm.

**Keep current:** the PPN defaults follow PMK 131/2024 (checked 11 Nov 2026: general rate still 12%, non-luxury 12% x 11/12).
If the Ministry of Finance changes the rate or the DPP factor, update `PPN_CATEGORIES` + `PPN_SOURCES` in `mcp-rupiah.mjs`,
the README table and the tests, then bump the version.
