---
name: Twelve Data forex provider
description: Constraints for using Twelve Data as a live forex market-data provider (used in the MF SMC Trader app's swappable provider architecture).
---

Twelve Data's WebSocket push feed (`wss://ws.twelvedata.com`) is a **Pro-plan-only** feature — a free-tier key cannot open it. "Live" ticks on a free-tier key must come from polling the REST `/price` endpoint on a server-side timer instead of a push connection.

**Why:** confirmed via Twelve Data's own WebSocket FAQ ("Full access to the WebSocket server is available only with the Pro plan"). Free-tier requests are also rate-limited (per-minute), so poll cadence must stay conservative (e.g. one shared timer per distinct symbol, ~8s interval) rather than one poll per browser tab.

**How to apply:** when building or reviewing a Twelve Data integration, check the plan tier before assuming WebSocket push works. `/time_series` (historical OHLC) works fine on free tier with `timezone=UTC&order=ASC` params for consistent UTC-ascending output; `/price` (latest price) also works on free tier and is the right choice for a polling-based "live" feed.
