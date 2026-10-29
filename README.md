# Pixel Hedge Fund

A SvelteKit **lived-in pixel office** — not a dashboard. Warm 90s hedge-fund floor (Apex Capital / sim vibe), panoramic NYC sunset windows, wooden CRT desks, and Chart Desk TA driving real trader behavior.

Art reference: [`static/ref/apex-capital-office.png`](./static/ref/apex-capital-office.png)

## Run

```bash
cd pixel-hedge-fund   # repo root
npm install
npm run dev -- --port 5173
```

```bash
npm test
npm run check
npm run build
```

Do not expose the dev server to your network (`--host 0.0.0.0`) on a machine that holds `.env.local` or `.secrets/`: the `/api/blofin/*` and `/api/bybit/*` write routes fall back to those keys. Cross-site requests to them are rejected, but they have no login.

## Landing: One World Trade Center

`/` opens on a street-level shot of One World Trade Center. The skyline behind it is the same `Skyline.svelte` component and sim clock (`src/lib/weather/timeCycle.ts`) the trading floor uses, so day/night, weather, and sky birds match the floor exactly — with the rare UFO event hardcoded off; this page never imports it. Below the skyline: a modest "PHF · Floor 84" tenant plaque partway up the tower (not on the building itself), then a sidewalk with a curb, streetlamps, bigger trees, benches, and animated pedestrians (varied skin tone, hair, and outfit; some walking dogs), and stray cats. Below that, in its own space, the National September 11 Memorial: twin one-acre reflecting pools ("Reflecting Absence") with a bronze-parapet edge detail, the real Survivor Tree, a small "GROUND ZERO" sign, and a plaque with accurate site facts. **ACCESS THE FLOOR** navigates to `/elevator`, a 5 second ride showing one random desk tip (`src/lib/data/elevatorTips.ts`), then hands off to `/floor` (the trading floor; `?symbol=` still persists there; a **BREAK** desk prop next to **SET** takes you back to `/`). Each step is a real route, so the browser URL and back button reflect where you are. The memorial is a still, respectful presence with no interactive elements — keep it that way in future edits.

## Scene (office-first)

Camera sits **behind a cluttered foreground desk** looking across the floor:

- Panoramic **NYC sunset windows** (Empire State silhouette, mullions, rain on glass; switchable **Miami Vice** neon skyline; rare UFO abduction event)
- Wall **PIXEL HEDGE FUND** sign + values: Discipline / Research / Returns
- **TODAY** whiteboard, **MARKET WIRE** board with **CHANNEL** pair switch + multi-crypto rows
- Lounge sofa + Fortune, plants, brass horse-head trophy on a filing cabinet
- 10 traders at wooden CRT desks (5 LONG / 5 SHORT, 5×–100×) + CIO, PM, Senior Analyst, Research Analyst, Quant
- Foreground props: books, WSJ, legal pad, beige CRT, keyboard, corded phone, calculator, **PHF-monogram coffee mug** (deep green with a brass PHF plaque, click for the coffee trip), **PAIR** desk pad

HUD lives **in the room** (wall board, LED tape, foreground CRT) — no floating metric cards.

**Desk clipboard** (hover/inspect): pointer-**draggable**, clamped to the floor, slight paper tilt while dragging.

## Active pair switching

Diegetic controls (MARKET WIRE **CHANNEL** select + foreground **PAIR** pad) change the floor’s trading symbol. Selection persists in the URL (`?symbol=ETHUSDT`) and `localStorage`. Quote, signal, candles, and trader positions reload for the chosen pair.

## Cast behavior: 4h protocol (current)

Trend entries now come from the 4h protocol in `src/lib/ta/protocol.ts`, attached to `/api/market/signal` as `protocol`:

- **Regime**: LONG when the 4h close is above EMA200 and EMA50 is above EMA200; SHORT the other way; otherwise FLAT and nobody trades.
- **Levels**: pivot highs/lows (5 candles each side, confirmed without lookahead), at least 2 touches clustered within 0.6 ATR, 300-candle window.
- **Trigger**: the last closed 4h candle touches the level (0.25 ATR), closes on the right side with the right colour, and prints volume at least 1.5x its 20-candle average.
- **RSI guard**: no long when the trigger candle's 4h RSI is 70 or more, no short at 30 or less (PF 1.35 to 1.43 in the backtest, small sample).
- **Risk**: stop at the candle or level extreme plus 0.5 ATR, one target at 2R, 5-day time stop. No Supertrend thesis exit.
- **Entry timing**: organic entries rest a limit halfway from the trigger candle's close back to the level, alive for one 4h candle (cancelled if not filled, or if price trades through the stop). In a backtest executed on 1h candles (2023-02 to 2026-10, 8 crypto majors) this kept PF at 1.34 (vs 1.33) while taking 44% more trades, +85R vs +56R, every year positive, and a tighter median stop (2.6% vs 3.0%). The grid of limit depth (25-100% of the way) and life (2-8 hours) stayed within PF 1.24-1.42, so the choice is not a fragile optimum.
- **1h structure**: 1h support/resistance is shown on the clipboard and CRT as context. 1h triggers were tested and rejected: rejections at 1h levels scored PF 0.87, rejections on 1h candles at 4h zones PF 1.06.
- **Anti-chase**: the play button takes a live setup at market only while the mark is within 0.5 ATR of the level. A trader whose stop does not fit inside 70% of its liquidation distance refuses the trade instead of squeezing the stop.
- **Play button** (the triangle next to TIME): the trader always takes a trade at the current mark, never backdated. Grade **A** when the protocol would take it now (its level stop and 2R target). Grade **B** when it is forced against the rules: the stop still sits 0.5 ATR beyond the nearest level on the losing side (1.5 ATR when none is in reach), the target is 2R, and a toast says which rule it breaks. A stop that does not fit the leverage is pulled inside 70% of the liquidation distance.
- **Per-asset profile** (`src/lib/ta/profiles.ts`): each asset runs the family that earned the best average R over the previous 12 months, chosen walk-forward: **RECHAZO S/R** (this protocol), **RUPTURA** (4h Donchian 20 breakout with the regime, 2 ATR initial stop, 3 ATR chandelier trail tightened at each 4h close, no fixed target, no time stop), **MIXTO** (both, the default for assets without a profile) or **SIN EDGE** (the desk does not trade it on its own). Across 16 crypto assets (2023-02 to 2026-10, 1h execution) the selection rule scored PF 1.29 and +202R (in-sample 1.25, out-of-sample 1.32) against PF 1.15 and +80R for the protocol alone. ZEC, SOL, ADA, NEAR and gold run breakouts; BTC, ETH, XRP, DOT, AVAX, BNB and LTC run rejections; LINK, AAVE, DOGE, SUI, TRX and EURUSD sit out. Profiles are dated and go stale: regenerate them quarterly.
- **Portfolio brake** (`src/lib/ta/shadow.ts`, `GET /api/market/brake`, cached 10 minutes): the server replays each profiled crypto asset's own rules on the last ~40 days of 4h and 1h candles (a shadow book, whether or not anyone traded) and sums the R of the trades closed in the last 30 days. Below -10R the desk opens no new organic positions until the sum recovers; open legs are never closed by it, and the play button still trades (its toast says the brake is on). Backtest of the walk-forward profiles: PF 1.29 to 1.40, max drawdown -50R to -29R, October 2026 -34.5R to -8.1R. It is the best of the thresholds tried (-10/-15/-20/-30R over 14/30/60 days: PF 1.24-1.40), so expect less in live trading. The TS shadow book matches the Python backtest trade for trade on BTC, ETH and SOL, and 15 of 16 on ZEC. With BloFin as the fallback (500 1h candles, about 20 days) the reading is marked partial.
- Tested and rejected: a 1.5x volume filter on breakouts (looked like PF 1.39 when applied after the fact, PF 1.22 when applied at entry) and ADX >= 20/25 on breakouts (out-of-sample PF 1.00-1.05).
- **Direction**: the headline direction on the Chart Desk is the 4h regime. Short-term direction indicators (15m Supertrend, 1h EMA 20/50, 24h momentum, 1h Donchian) predicted the next 4h and 24h at 48-52% hit rate, and picking a different one per asset lost out of sample.
- The desk clipboard and the Chart Desk CRT show the 4h regime, the nearest support and resistance zones (level plus or minus 0.25 ATR), RSI 4h and the volume ratio.
- Each trader trades a given 4h trigger once. Counter-trend fades are off in protocol mode.

Backtest (2022 to 2026-10 on 4h candles, 8 crypto majors, 0.075% fee plus slippage per side): the old 15m signal scored PF 1.00 before costs and 0.62 after; the protocol scores PF 1.35 (in-sample 1.29, out-of-sample 1.44). XAUUSD and EURUSD trade the same logic but have **no** validated edge (PF 0.61 and 0.28), so treat the FX tab as a simulation.

## Cast behavior (Chart Desk, legacy)

Signals without a `protocol` field fall back to the legacy behavior below.

Positions come from live `/api/market/signal` (Supertrend + EMA21/55 + RSI + MACD + ATR; 15m setup / 4h regime). See `src/lib/ta/signal.ts` and `src/lib/ta/posture.ts`.

| Tape | Desk mandate | Floor read |
|------|--------------|------------|
| Confluence ≥5, or ≥4 with structure / lower leverage | Same side as bias | **OPEN** in the simulated cast book. Each trader locks an entry-specific stop and TP1/TP2 plan using the Supertrend distance, ATR floor, and their leverage profile. |
| RSI exhaustion plus price stretched from the EMA21 (in ATR units) | Opposite side, any leverage | **HEDGE OPEN** (fade). The desk fighting the trend, or either desk on a FLAT tape, runs a half-size mean-reversion leg with an ATR-based stop. Higher leverage needs deeper exhaustion (longs need RSI at or below 40 for 5x/10x, 38 for 25x, 35 for 50x, 32 for 100x; shorts mirror it above 60/62/65/68), and every threshold tightens when setup and regime are both strongly aligned against the fade. |
| Fade forming (about 70% of the way to the trigger) | Opposite side | **Thinking** + a "dip-buy?" / "fade the rip?" cloud |
| Confluence 2–4, not yet a fill | Same side | **Thinking** + thought cloud |
| Bias against desk, or ST flipped | Opposite / invalid | **FLAT / Watching** — no invented fill |

Lower-leverage traders have wider stops; higher-leverage traders use tighter stops and require larger reward multiples. Every stop is also bounded by liquidation: a leg's stop sits at no more than 70% of the isolated-margin liquidation distance (1/leverage minus a 0.5% maintenance margin), so a 100x desk runs a much tighter stop than a 10x desk instead of a chart stop the exchange would never honour. A TP1 fill banks half the leg (pixel cash-stack animation, 90-second re-entry cooldown), moves the stop to breakeven, and lets the other half run to TP2; a trend runner's stop then trails the Supertrend and only ever tightens. A runner closed at breakeven or a trailed profit is a normal exit, not a stop-out. The 50x and 100x desks sit out new entries while the ATR volatility state is wild and show a "tape too wild for this leverage" cloud. Stops and invalidations close simulated legs. A losing stop-out puts the desk on a 4-minute re-entry cooldown. Fade legs also carry a time stop (12 / 8 / 6 / 4 candles for 5-10x / 25x / 50x / 100x) checked at closed-candle decisions, followed by a one-candle cooldown. The risk desk refuses any new entry that would push one-way net exposure past 50% of combined desk capacity (a fully one-sided default book fits exactly, so it binds once a desk's leverage is raised or the cap is tightened); entries that reduce net exposure are always allowed, existing legs are never force-closed, and a held desk shows a "risk desk: net cap" cloud. The PM's note shows live net/gross exposure and the CIO's note flags held desks. Trend legs exit when Supertrend flips against them; fade legs are not liquidated by a bias flip and instead exit once RSI normalises (55 / 45), or on their stop or TP. These cast positions are visual simulations only and never send an order to Bybit or BloFin.

Hover / focus a trader → desk **clipboard** to view that trader's entry, mark, unrealized PNL, risk stop, and individual targets. Click to **pin** CRT snippet. Esc unpins.

## Bybit mapping (multi-crypto)

| Display | Bybit linear | Notes |
|---------|----------------|-------|
| **BTCUSDT** | **`BTCUSDT`** | `XBTUSDT` is accepted as an alias |
| **ETHUSDT** | **`ETHUSDT`** | |
| **XRPUSDT** | **`XRPUSDT`** | |
| **SOLUSDT** | **`SOLUSDT`** | Default |
| **ADAUSDT** | **`ADAUSDT`** | |
| **DOGEUSDT** | **`DOGEUSDT`** | |
| **LINKUSDT** | **`LINKUSDT`** | |
| **AVAXUSDT** | **`AVAXUSDT`** | |

- `GET /api/market/quote?symbol=SOLUSDT`
- `GET /api/market/candles?symbol=ETHUSDT&tf=15m`
- `GET /api/market/signal?symbol=BTCUSDT`
- `GET /api/market/tape` - all live tape symbols from Bybit and BloFin
- `GET /api/market/health`
- `GET /api/market/leveraged-tokens`, `GET /api/market/leveraged-token-quote`, `GET /api/news`

The full symbol list lives in `SYMBOLS` in `src/lib/data/symbols.ts`; unlisted `*USDT` names resolve as dynamic channels.

Production is always live-only: Bybit is tried first, BloFin is the permitted public-data fallback, and unavailable exchange data returns an empty or `503` response. Local `npm run dev` keeps the labeled SAMPLE fallback for offline work; set `PHF_LIVE_ONLY=true` locally when you want to test the live-only behavior.

The floor waits for each market poll to finish before waiting ten seconds for the next poll. Failed polls back off for 20, 40, 80, then 120 seconds; a successful poll restores the normal interval. Requests time out after 20 seconds, pair changes cancel stale requests, and leaving the floor cancels pending requests and timers. Tape requests also avoid overlap and back off after errors. The error note names the failed PHF endpoint and its HTTP status; existing simulated trader legs survive transient failures.

To verify polling with mocked APIs, start a local preview after `npm run build`, then run `node scripts/market-poll-test.mjs`. `TEST_URL` defaults to `http://127.0.0.1:5173/floor`; set `TEST_BROWSER` to your Chromium browser executable if it is not installed at the default Windows Chrome path. The test covers failures, backoff, recovery, slow requests, pair cancellation, timeouts, tape rate limits, and live/SAMPLE labels without calling exchange APIs.

### Real WSJ wire headlines

The WSJ desk prop requests real, multi-outlet crypto headlines through Google News RSS at `GET /api/news?symbol=BTCUSDT`. The active symbol's configured news phrase is searched, each story keeps its publisher and link, and successful results are cached for five minutes. The visible `SAMPLE` stories remain the final fallback when the live feed is unavailable.


## Feature pack (office toys)

### 90s fax / printer
Pixel fax by the lounge. **Click** to open **PRINT REPORT** options built from live Chart Desk signal + candles (never invents prices; labels **SAMPLE** when needed):

- Bias & confluence desk brief
- Supertrend / EMA structure sheet
- Risk card (SL, TP1/TP2, ATR vol state)
- Multi-timeframe alignment memo
- Session tape / funding-style summary

After print: on-screen 90s “fax spit”, **Printable HTML**, or **Download .txt**.

### Sticky notes on the window
**+ NOTE** control on the panoramic glass → type, pick a color, **Stick**. Drag notes on the window; **×** deletes. Persists in `localStorage` (`phf-window-stickies`).

### Change trader leverage
Click a trader's leverage badge (for example, `5×`) → enter an integer from `1` to `1000`, then press Enter or blur to commit (Escape cancels). Posture gates and P&L margin % update; overrides persist (`phf-leverage-overrides`).

### Set how long a trader has been in
Each trader's **TIME** field is in **minutes** (900 seconds is `15`). Type the total time and press Enter or click away: the trader gets a position opened that long ago, priced at the tape then (linear inside the 15m candle), so P&L reflects the real move since. It works on a flat trader (it forces a position) and on one already in a trade (it re-times and re-prices it, keeping its strategy and size). A forced position is a long or short by the trader's book and full or half size by the current tape, just as an organic entry would be. History is capped at the loaded candles (about 20 hours). Forced positions skip thesis and time-stop exits, and if the tape already ran through the stop or target, those are re-laid around the current mark so the position is not closed the instant it is created. The counter runs in real minutes and is not persisted across reloads.

### Bull / bear pets
When tape bias is **LONG** and confluence is **tradeable/high** → mini **bull** pet on the floor. **SHORT** + tradeable → **bear cub**. **FLAT** → sleeping “zzz” pet (otherwise hidden). Pets are **draggable** (clamped to the scene frame); position persists as `phf-pet-pos`.

### Trash can (busted thesis)
Pixel trash can on the floor — **draggable**, position in `phf-trash-pos`. **Click** opens a crumpled “busted thesis / wrong call” research note built from live Chart Desk bias (counter-trend idea that failed, confluence that flipped, etc.). Post-mortem narrative only — real signal context, no fake live P&L.

### Rare mariachi
Same rarity spirit as the UFO: eligible in **day** or **golden** sim phases, ≤ once per sim-day, ~**7%** roll. Band enters the aisle, plays with note sprites (~36 frames). Wire status shows `MARIACHI!` while active.

## Skyline theme and rare UFO event

Use **SET → Office Decor → Theme** to switch between the default NYC dusk view and a Miami Vice skyline with magenta/cyan neon, palms, waterline accents, and the same moving bird layer.

The rare UFO abduction event appears over the Empire State Building (center window pane):

- Eligible only during **dusk** or **night** sim phases
- At most **once per sim-day** (1440 sim-minutes)
- ~**8%** roll on first eligible tick of that day
- Brief sequence: approach → hover beam → abduct a pixel silhouette → depart (~36 frames)
- Birds hide while the event is active.
- Wire status shows `UFO!` while active — intentionally rare, not every cycle
