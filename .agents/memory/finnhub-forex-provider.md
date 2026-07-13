---
name: Finnhub forex provider quirks
description: Constraints and gotchas when integrating Finnhub as a live forex market-data provider (REST candles vs WebSocket ticks, runtime WebSocket global).
---

Finnhub's free tier does not include forex historical OHLC. `/forex/candle` and
`/forex/quote` return HTTP 403 ("no access") on a free-tier key even though
the key itself is valid (confirmed stock `/quote` works fine on the same
key). This is a Premium-plan restriction, not a bug or wrong symbol format.

**Why it matters:** any app built on Finnhub for forex history must either
target a paid plan from the start, or design a graceful fallback (e.g. seed
the chart from live ticks only) rather than assuming candles will be
available.

Finnhub's WebSocket (`wss://ws.finnhub.io`) DOES stream live forex trade
ticks on the free tier, but only for OANDA-broker symbols, formatted as
`OANDA:EUR_USD` (broker-prefixed, underscore not slash) — not plain
`EUR/USD`. FXCM/Forex.com/FHFX brokers listed in Finnhub's forex symbol list
do NOT support streaming; only OANDA does. Finnhub allows only one WebSocket
connection per API key, so a server must multiplex all subscriptions through
one persistent upstream connection rather than opening one per browser
session.

**How to apply:** when building a forex feed on Finnhub, use OANDA symbols
for streaming, budget for the free tier's candle-endpoint 403, and build a
single ref-counted WS-to-SSE (or similar) bridge server-side.

Separately: in this project's Vite+Bun dev SSR runtime, the global
`WebSocket` constructor is `undefined` in server route handlers — attempting
`new WebSocket(...)` throws `ReferenceError: WebSocket is not defined`.
Import `WebSocket` explicitly from the `ws` npm package (already a
dependency in this project) instead of relying on a runtime global.
