import { json } from '@sveltejs/kit';
import { completedBars } from '$lib/data/validation';
import { fetchCandles } from '$lib/data/market';
import { ASSET_PROFILES } from '$lib/ta/profiles';
import { brakeFrom, shadowTrades, type BrakeState, type ShadowTrade } from '$lib/ta/shadow';
import type { RequestHandler } from './$types';

// Portfolio brake: replay the profiled crypto assets' own rules on the last ~40 days and sum the R of the
// shadow trades closed in the last 30. Below -10R the desk stops opening new organic positions.
// Backtest (16 assets, 2023-02 to 2026-10): PF 1.29 -> 1.40, max drawdown -50R -> -29R, October 2026 -34.5R -> -8.1R.
const CACHE_MS = 10 * 60_000;
const BRAKE_UNIVERSE = Object.entries(ASSET_PROFILES)
	.filter(([sym, p]) => (p.family === 'proto' || p.family === 'brk') && sym !== 'XAUUSDT' && sym !== 'EURUSDT')
	.map(([sym, p]) => ({ sym, family: p.family }));

let cached: { at: number; state: BrakeState } | null = null;
let inflight: Promise<BrakeState> | null = null;

async function compute(): Promise<BrakeState> {
	const now = Date.now();
	const per: Record<string, ShadowTrade[]> = {};
	let partial = false;
	await Promise.all(
		BRAKE_UNIVERSE.map(async ({ sym, family }) => {
			try {
				const [h4, h1] = await Promise.all([fetchCandles(sym, '4h', 500), fetchCandles(sym, '1h', 1000)]);
				if (h4.sample || h1.sample) { partial = true; return; }
				const b4 = completedBars(h4.bars, 4 * 3_600_000, now);
				const b1 = completedBars(h1.bars, 3_600_000, now);
				if (!b1.length || now - b1[0].t < 31 * 86_400_000) partial = true;
				per[sym] = shadowTrades(b4, b1, family, b1[0]?.t ?? now);
			} catch {
				partial = true;
			}
		})
	);
	return brakeFrom(per, now, partial);
}

export const GET: RequestHandler = async () => {
	if (cached && Date.now() - cached.at < CACHE_MS) return json(cached.state, { headers: { 'Cache-Control': 'no-store' } });
	inflight ??= compute().finally(() => { inflight = null; });
	const state = await inflight;
	cached = { at: Date.now(), state };
	return json(state, { headers: { 'Cache-Control': 'no-store' } });
};
