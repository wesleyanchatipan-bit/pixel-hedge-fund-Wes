/**
 * Shadow book: replays the desk's own rules on recent candles to know how the strategy is doing right now,
 * whether or not anyone traded it. Drives the portfolio brake (freno de cartera).
 *
 * Mirrors the research backtest (1h execution, 0.075% per side):
 * - proto: 4h rejection setup, limit halfway back to the level for 4 1h candles; a fill candle that also
 *   touches the stop is a loss; then stop / 2R target / 120 1h candles.
 * - brk:   4h Donchian(20) breakout with the regime, entry at the next 1h open, 2 ATR stop,
 *   3 ATR chandelier trail tightened at each 4h close, no target.
 * Only trades that have closed count. One trade at a time per asset.
 */
import type { Bar } from '$lib/data/types';
import { BRK_STOP_ATR, BRK_TRAIL_ATR, PROTOCOL_RR, computeProtocolPlan, type ProtocolFamily } from './protocol';

const H1 = 60 * 60_000;
const H4 = 4 * H1;
const FEE = 0.00055 + 0.0002;
const HOLD_1H = 120;
const LIMIT_BARS = 4;
const PLAN_WINDOW = 500;

export interface ShadowTrade {
	family: 'proto' | 'brk';
	side: 'long' | 'short';
	entryTime: number;
	exitTime: number;
	r: number;
}

function wilderAtr(bars: Bar[], period = 14): number[] {
	const out: number[] = [];
	let prev = NaN;
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i];
		const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
		prev = i === 0 ? tr : tr / period + prev * (1 - 1 / period);
		out.push(prev);
	}
	return out;
}

/** Replay one asset. `bars4h` and `bars1h` must be completed candles, oldest first. */
export function shadowTrades(bars4h: Bar[], bars1h: Bar[], family: ProtocolFamily, fromTime: number): ShadowTrade[] {
	if (family === 'none' || bars4h.length < 260 || bars1h.length < 10) return [];
	const fams: ('proto' | 'brk')[] = family === 'both' ? ['proto', 'brk'] : [family];
	const out: ShadowTrade[] = [];
	for (const fam of fams) out.push(...replay(bars4h, bars1h, fam, fromTime));
	return out.sort((a, b) => a.exitTime - b.exitTime);
}

function replay(bars4h: Bar[], bars1h: Bar[], fam: 'proto' | 'brk', fromTime: number): ShadowTrade[] {
	const atr4 = wilderAtr(bars4h);
	// index of the 1h candle whose close equals each 4h close, and the 4h candle closing at each 1h close
	const h1ByOpen = new Map(bars1h.map((b, i) => [b.t, i]));
	const close4At = new Map<number, number>(); // 1h index -> 4h index closing with it
	for (let j = 0; j < bars4h.length; j++) {
		const i = h1ByOpen.get(bars4h[j].t + H4 - H1);
		if (i !== undefined) close4At.set(i, j);
	}
	const n = bars1h.length;
	const trades: ShadowTrade[] = [];
	let busy = -1;
	for (let i = 0; i < n - 1; i++) {
		if (i <= busy) continue;
		const j = close4At.get(i);
		if (j === undefined || j < 260 || bars4h[j].t + H4 < fromTime) continue;
		const plan = computeProtocolPlan(bars4h.slice(Math.max(0, j - PLAN_WINDOW + 1), j + 1), [], fam === 'brk' ? 'brk' : 'proto');
		if (!plan) continue;
		if (fam === 'proto') {
			const s = plan.setup;
			if (!s) continue;
			const side = s.side === 'long' ? 1 : -1;
			let filled = -1;
			for (let k = i + 1; k < Math.min(i + 1 + LIMIT_BARS, n); k++) {
				if (side === 1 ? bars1h[k].l <= s.limit : bars1h[k].h >= s.limit) { filled = k; break; }
			}
			if (filled < 0) continue;
			const ent = s.limit;
			const risk = Math.abs(ent - s.stop);
			if (side === 1 ? bars1h[filled].l <= s.stop : bars1h[filled].h >= s.stop) {
				trades.push({ family: 'proto', side: s.side, entryTime: bars1h[i].t, exitTime: bars1h[filled].t, r: -1 - (2 * FEE * ent) / risk });
				busy = filled;
				continue;
			}
			const start = filled + 1;
			if (start >= n || risk <= 0 || risk / ent > 0.15 || risk / ent < 0.0005) continue;
			const tp = ent + side * PROTOCOL_RR * risk;
			let r: number | null = null;
			let jj = start;
			const last = Math.min(start + HOLD_1H, n) - 1;
			for (jj = start; jj <= last; jj++) {
				const b = bars1h[jj];
				if (side === 1 ? b.l <= s.stop : b.h >= s.stop) { r = -1; break; }
				if (side === 1 ? b.h >= tp : b.l <= tp) { r = PROTOCOL_RR; break; }
			}
			if (r === null) {
				if (start + HOLD_1H > n) break; // still open: not counted
				jj = last;
				r = (side * (bars1h[jj].c - ent)) / risk;
			}
			trades.push({ family: 'proto', side: s.side, entryTime: bars1h[i].t, exitTime: bars1h[jj].t, r: r - (2 * FEE * ent) / risk });
			busy = jj;
		} else {
			const b = plan.breakout;
			if (!b) continue;
			const side = b.side === 'long' ? 1 : -1;
			const ent = bars1h[i + 1].o;
			let stop = ent - side * BRK_STOP_ATR * atr4[j];
			const risk = Math.abs(ent - stop);
			let ext = ent;
			let r: number | null = null;
			let k = i + 1;
			for (; k < n; k++) {
				const bar = bars1h[k];
				if (side === 1 ? bar.l <= stop : bar.h >= stop) { r = (side * (stop - ent)) / risk; break; }
				ext = side === 1 ? Math.max(ext, bar.h) : Math.min(ext, bar.l);
				const jk = close4At.get(k);
				if (jk !== undefined) {
					const trail = ext - side * BRK_TRAIL_ATR * atr4[jk];
					stop = side === 1 ? Math.max(stop, trail) : Math.min(stop, trail);
				}
			}
			if (r === null) break; // still open
			trades.push({ family: 'brk', side: b.side, entryTime: bars1h[i].t, exitTime: bars1h[k].t, r: r - (2 * FEE * ent) / risk });
			busy = k;
		}
	}
	return trades;
}

export const BRAKE_DAYS = 30;
export const BRAKE_R = -10;

export interface BrakeState {
	/** Sum of R of shadow trades closed in the last 30 days across the profiled assets. */
	r30: number;
	trades: number;
	paused: boolean;
	perAsset: Record<string, number>;
	asOf: string;
	/** Some assets could not be replayed (missing or sample data). */
	partial: boolean;
}

export function brakeFrom(perAssetTrades: Record<string, ShadowTrade[]>, now: number, partial: boolean): BrakeState {
	const since = now - BRAKE_DAYS * 86_400_000;
	let r30 = 0;
	let trades = 0;
	const perAsset: Record<string, number> = {};
	for (const [sym, list] of Object.entries(perAssetTrades)) {
		const recent = list.filter((t) => t.exitTime >= since && t.exitTime < now);
		const sum = recent.reduce((s, t) => s + t.r, 0);
		perAsset[sym] = +sum.toFixed(2);
		r30 += sum;
		trades += recent.length;
	}
	return { r30: +r30.toFixed(2), trades, paused: r30 < BRAKE_R, perAsset, asOf: new Date(now).toISOString(), partial };
}
