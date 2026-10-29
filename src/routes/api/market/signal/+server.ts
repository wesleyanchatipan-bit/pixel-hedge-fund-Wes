import { json, error } from '@sveltejs/kit';
import { completedBars } from '$lib/data/validation';
import { fetchCandles } from '$lib/data/market';
import { resolveSymbol } from '$lib/data/symbols';
import { computeSignal } from '$lib/ta/signal';
import { computeProtocolPlan } from '$lib/ta/protocol';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const symbol = url.searchParams.get('symbol') ?? 'SOLUSDT';
	const def = resolveSymbol(symbol);
	let setup;
	let regime;
	let hourly;
	try {
		[setup, regime, hourly] = await Promise.all([
			fetchCandles(def.display, '15m', 300),
			fetchCandles(def.display, '4h', 500),
			fetchCandles(def.display, '1h', 320).catch(() => null)
		]);
	} catch (cause) {
		error(503, new Error(`LIVE_SIGNAL_UNAVAILABLE: ${cause instanceof Error ? cause.message : 'Bybit and BloFin did not return live candle data'}`));
	}

	// The final exchange candle is still forming. Build the desk signal from
	// completed candles so posture decisions do not churn intrabar.
	const setupBars = completedBars(setup.bars, 15 * 60_000);
	const regimeBars = completedBars(regime.bars, 4 * 60 * 60_000);
	if (setupBars.length < 55 || regimeBars.length < 55) {
		error(503, 'Waiting for sufficient completed candle history');
	}
	const sample = setup.sample || regime.sample;
	const provider = sample ? 'sample' : setup.provider;
	const signal = computeSignal(setupBars, regimeBars, {
		sample,
		provider,
		symbol: def.display
	});

	// The protocol needs EMA200 plus a 300-candle level window on completed 4h candles.
	// 1h structure is context only: 1h triggers had no edge in the backtest.
	const hourlyBars = hourly && !hourly.sample ? completedBars(hourly.bars, 60 * 60_000) : [];
	const protocol = computeProtocolPlan(regimeBars, hourlyBars);

	return json({ ...signal, protocol }, {
		headers: { 'Cache-Control': 'no-store' }
	});
};
