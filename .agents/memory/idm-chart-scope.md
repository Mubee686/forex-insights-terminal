---
name: IDM chart scope
description: The chart-specific constraints for Smart Money Concept inducement detection.
---

IDM is a chart-window feature, not a full-history analysis zone. The detector must receive the current visible logical candle range, use the existing swing definition to find the active major structure, and emit only the latest minor liquidity sweep that reverses before the major structural break.

**Why:** Drawing full-history IDM candidates caused off-screen markers, unswept labels, and repeated/outdated points when users panned or live candles changed.

**How to apply:** Keep IDM rendering owned by the chart overlay. Cache by visible range and candle state, key markers by their swing index, require a confirmed reversal after the wick/close-through, and invalidate the point after the major high/low is structurally broken.