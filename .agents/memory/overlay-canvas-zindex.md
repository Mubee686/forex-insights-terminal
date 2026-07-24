---
name: Overlay canvas z-index
description: SMC overlay canvas needs zIndex:2 or lightweight-charts renders above it, hiding all SMC drawings.
---

# Overlay Canvas Z-Index Fix

## Rule
The `<canvas>` overlay in `src/components/TradingChart.tsx` must have `style={{ zIndex: 2 }}`. Without it, lightweight-charts internal canvases render on top, making every SMC zone invisible.

**Why:** lightweight-charts creates canvas elements inside the chart container div. Even though our overlay canvas is a later sibling in the DOM, the library's stacking wins without an explicit z-index on our element.

**How to apply:** Always add `style={{ zIndex: 2 }}` (or higher) to any overlay canvas placed over a lightweight-charts chart container.

## BOS Detection Fix
After a BOS fires on swing at break candle index B:
- Set `nextHighMinIdx = B + 1` (bullish) or `nextLowMinIdx = B + 1` (bearish)
- Only accept the next swing candidate if its index >= that minimum
- Prevents cycling between two nearby old swings and generating stacked duplicate BOS at the same price level

## BOS Rendering Pattern
- Dashed line from `xOf(startIndex)` → `xOf(endIndex)` at `yOf(price)`
- Filled color badge at `xOf(endIndex)`: above line for bullish, below for bearish
- Guard: skip if `y < 0 || y > cssH` to avoid off-screen draws during price scale transitions
