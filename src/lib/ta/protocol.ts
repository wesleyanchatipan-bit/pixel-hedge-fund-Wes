/**
 * Protocolo 4h: regimen EMA200/EMA50 + niveles S/R por pivotes + vela de rechazo + volumen.
 *
 * Validado fuera del piso (backtest 2022-2026, 8 criptos, comision+slippage 0.075% por lado):
 * PF 1.35, +0.19R por trade, dentro de muestra 1.29 / fuera de muestra 1.44.
 * La logica anterior del piso (Supertrend + EMA + RSI + MACD en 15m) daba PF 1.00 bruto y 0.62 neto.
 *
 * Reglas
 * - Regimen: LONG si cierre > EMA200 y EMA50 > EMA200; SHORT al reves; si no, FLAT (no se opera).
 * - Niveles: pivotes k=5 confirmados (sin mirar el futuro), >=2 toques agrupados a 0.6 ATR, ventana 300 velas.
 * - Gatillo: la ultima vela 4h CERRADA toca el nivel (0.25 ATR), cierra del lado correcto, con color a favor,
 *   y con volumen >= 1.5x su media de 20.
 * - Stop: extremo de la vela o el nivel -/+ 0.5 ATR. Objetivo: 2R. Salida por tiempo: 30 velas (5 dias).
 * - Anti-persecucion: solo se entra si el precio sigue a <= 0.5 ATR del nivel. Si ya se fue, el trade se descarta.
 * - RSI 4h: no se compra con RSI >= 70 ni se vende con RSI <= 30 en la vela gatillo (esos 24 trades perdian -0.39R;
 *   el filtro sube el PF de 1.35 a 1.43, dentro de muestra 1.36 / fuera de muestra 1.53; muestra pequena).
 */
import type { Bar } from '$lib/data/types';

export const PROTOCOL_TF_MS = 4 * 60 * 60_000;
export const PROTOCOL_RR = 2;
export const PROTOCOL_MAX_HOLD_MS = 30 * PROTOCOL_TF_MS;
export const PROTOCOL_CHASE_ATR = 0.5;
const PIVOT_K = 5;
const LEVEL_LOOKBACK = 300;
const CLUSTER_TOL_ATR = 0.6;
const MIN_TOUCHES = 2;
const TOUCH_ATR = 0.25;
const STOP_ATR = 0.5;
const VOLUME_RATIO = 1.5;
const NEAR_LEVEL_ATR = 1.5;
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
/** Half-width of a support/resistance zone: the touch tolerance used by the trigger. */
export const ZONE_ATR = TOUCH_ATR;

export type ProtocolSide = 'long' | 'short';

export interface ProtocolSetup {
	side: ProtocolSide;
	level: number;
	stop: number;
	/** Open time of the 4h candle that fired the trigger. */
	barTime: number;
}

export interface ProtocolPlan {
	tf: '4h';
	regime: 'LONG' | 'SHORT' | 'FLAT';
	close: number;
	ema50: number;
	ema200: number;
	atr: number;
	volumeRatio: number;
	/** Wilder RSI(14) of the last closed 4h candle. */
	rsi: number;
	/** Supports below the last close, nearest first. */
	supports: number[];
	/** Resistances above the last close, nearest first. */
	resistances: number[];
	/** Trigger on the last closed 4h candle, if any. */
	setup: ProtocolSetup | null;
	/** Open time of the last closed 4h candle the plan was built from. */
	asOfBar: number;
}

function ewm(values: number[], span: number): number[] {
	const k = 2 / (span + 1);
	const out = new Array(values.length).fill(NaN);
	let prev = values[0];
	for (let i = 0; i < values.length; i++) {
		prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
		out[i] = prev;
	}
	return out;
}

function wilderRsi(closes: number[], period = 14): number[] {
	const alpha = 1 / period;
	const out = new Array(closes.length).fill(NaN);
	let up = 0;
	let dn = 0;
	for (let i = 1; i < closes.length; i++) {
		const d = closes[i] - closes[i - 1];
		const g = d > 0 ? d : 0;
		const l = d < 0 ? -d : 0;
		up = i === 1 ? g : g * alpha + up * (1 - alpha);
		dn = i === 1 ? l : l * alpha + dn * (1 - alpha);
		out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
	}
	return out;
}

function wilderAtr(bars: Bar[], period = 14): number[] {
	const alpha = 1 / period;
	const out = new Array(bars.length).fill(NaN);
	let prev = NaN;
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i];
		const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
		prev = i === 0 ? tr : tr * alpha + prev * (1 - alpha);
		out[i] = prev;
	}
	return out;
}

/** Pivots confirmed K bars after they print, so a level never uses future candles. */
function pivots(bars: Bar[]): { highs: { at: number; price: number }[]; lows: { at: number; price: number }[] } {
	const highs: { at: number; price: number }[] = [];
	const lows: { at: number; price: number }[] = [];
	for (let i = PIVOT_K; i < bars.length - PIVOT_K; i++) {
		let isHigh = true;
		let isLow = true;
		for (let j = i - PIVOT_K; j <= i + PIVOT_K; j++) {
			if (bars[j].h > bars[i].h) isHigh = false;
			if (bars[j].l < bars[i].l) isLow = false;
		}
		if (isHigh) highs.push({ at: i + PIVOT_K, price: bars[i].h });
		if (isLow) lows.push({ at: i + PIVOT_K, price: bars[i].l });
	}
	return { highs, lows };
}

function clusters(prices: number[], tol: number): number[] {
	const out = new Set<number>();
	for (const p of prices) {
		const group = prices.filter((q) => Math.abs(q - p) <= tol);
		if (group.length >= MIN_TOUCHES) out.add(group.reduce((a, b) => a + b, 0) / group.length);
	}
	return [...out].sort((a, b) => a - b);
}

/** Build the 4h plan from COMPLETED 4h candles only. */
export function computeProtocolPlan(bars: Bar[]): ProtocolPlan | null {
	if (bars.length < 260) return null;
	const closes = bars.map((b) => b.c);
	const e50 = ewm(closes, 50);
	const e200 = ewm(closes, 200);
	const atrs = wilderAtr(bars);
	const i = bars.length - 1;
	const last = bars[i];
	const atr = atrs[i];
	const recentVol = bars.slice(i - 19, i + 1).reduce((s, b) => s + b.v, 0) / 20;
	const volumeRatio = recentVol > 0 ? last.v / recentVol : 0;
	const rsi = wilderRsi(closes)[i];
	const regime = last.c > e200[i] && e50[i] > e200[i] ? 'LONG' : last.c < e200[i] && e50[i] < e200[i] ? 'SHORT' : 'FLAT';

	const { highs, lows } = pivots(bars);
	const inWindow = (at: number) => at >= i - LEVEL_LOOKBACK && at <= i - 1;
	const tol = CLUSTER_TOL_ATR * atr;
	const sup = clusters(lows.filter((p) => inWindow(p.at)).map((p) => p.price), tol);
	const res = clusters(highs.filter((p) => inWindow(p.at)).map((p) => p.price), tol);

	let setup: ProtocolSetup | null = null;
	if (volumeRatio >= VOLUME_RATIO) {
		if (regime === 'LONG' && rsi < RSI_OVERBOUGHT) {
			const level = sup.find((s) => last.l <= s + TOUCH_ATR * atr && last.c > s - TOUCH_ATR * atr && last.c > last.o);
			if (level !== undefined) setup = { side: 'long', level, stop: Math.min(last.l, level) - STOP_ATR * atr, barTime: last.t };
		} else if (regime === 'SHORT' && rsi > RSI_OVERSOLD) {
			const level = res.find((r) => last.h >= r - TOUCH_ATR * atr && last.c < r + TOUCH_ATR * atr && last.c < last.o);
			if (level !== undefined) setup = { side: 'short', level, stop: Math.max(last.h, level) + STOP_ATR * atr, barTime: last.t };
		}
	}

	return {
		tf: '4h',
		regime,
		close: last.c,
		ema50: e50[i],
		ema200: e200[i],
		atr,
		volumeRatio: +volumeRatio.toFixed(2),
		rsi: +rsi.toFixed(1),
		supports: sup.filter((s) => s < last.c).reverse().slice(0, 3),
		resistances: res.filter((r) => r > last.c).slice(0, 3),
		setup,
		asOfBar: last.t
	};
}

export type PlayVerdict =
	| { kind: 'enter'; side: ProtocolSide; stop: number; tp: number; riskPct: number; note: string }
	| { kind: 'wait'; note: string; level?: number; stop?: number; tp?: number };

function fmt(n: number): string {
	const abs = Math.abs(n);
	const digits = abs >= 1000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 4 : 6;
	return n.toFixed(digits);
}

/**
 * What a trader with this side and leverage does RIGHT NOW at `mark`.
 * Used by organic entries and by the desk's play button: it never invents a fill.
 */
export function playVerdict(plan: ProtocolPlan | null | undefined, side: ProtocolSide, leverage: number, mark: number, now = Date.now()): PlayVerdict {
	if (!plan) return { kind: 'wait', note: 'sin historia 4h suficiente' };
	const wanted = side === 'long' ? 'LONG' : 'SHORT';
	if (plan.regime === 'FLAT') return { kind: 'wait', note: 'regimen 4h sin direccion' };
	if (plan.regime !== wanted) return { kind: 'wait', note: `regimen 4h ${plan.regime === 'LONG' ? 'alcista' : 'bajista'}: no ${side === 'long' ? 'largos' : 'cortos'}` };

	const s = plan.setup;
	const fresh = s && s.side === side && now - s.barTime < 2 * PROTOCOL_TF_MS;
	if (s && fresh) {
		const dist = Math.abs(mark - s.level) / plan.atr;
		if (dist > PROTOCOL_CHASE_ATR) return { kind: 'wait', note: `tarde: precio a ${dist.toFixed(1)} ATR del nivel ${fmt(s.level)}` };
		const risk = Math.abs(mark - s.stop);
		const riskPct = risk / mark;
		if ((side === 'long' && s.stop >= mark) || (side === 'short' && s.stop <= mark)) return { kind: 'wait', note: 'el precio ya cruzo el stop' };
		const liqRoom = Math.max(1 / leverage - 0.005, 0.001) * 0.7;
		if (riskPct > liqRoom) return { kind: 'wait', note: `stop ${(riskPct * 100).toFixed(1)}% no cabe en ${leverage}x` };
		if (riskPct < 0.0005 || riskPct > 0.15) return { kind: 'wait', note: 'riesgo fuera de rango' };
		const tp = side === 'long' ? mark + PROTOCOL_RR * risk : mark - PROTOCOL_RR * risk;
		return { kind: 'enter', side, stop: s.stop, tp, riskPct, note: `rechazo en ${fmt(s.level)} con volumen ${plan.volumeRatio}x` };
	}

	if (side === 'long' && plan.rsi >= RSI_OVERBOUGHT) return { kind: 'wait', note: `RSI 4h ${plan.rsi}: sobrecompra, no largos` };
	if (side === 'short' && plan.rsi <= RSI_OVERSOLD) return { kind: 'wait', note: `RSI 4h ${plan.rsi}: sobreventa, no cortos` };
	const level = side === 'long' ? plan.supports[0] : plan.resistances[0];
	if (level === undefined) return { kind: 'wait', note: 'sin nivel cercano' };
	const dist = Math.abs(mark - level) / plan.atr;
	const stop = side === 'long' ? level - (TOUCH_ATR + STOP_ATR) * plan.atr : level + (TOUCH_ATR + STOP_ATR) * plan.atr;
	const tp = side === 'long' ? level + PROTOCOL_RR * (level - stop) : level - PROTOCOL_RR * (stop - level);
	if (dist <= NEAR_LEVEL_ATR) {
		return { kind: 'wait', note: `espera rechazo 4h en ${fmt(level)} con vol >=1.5x`, level, stop, tp };
	}
	return { kind: 'wait', note: `nivel ${fmt(level)} a ${dist.toFixed(1)} ATR`, level, stop, tp };
}

export interface ManualPlay {
	side: ProtocolSide;
	stop: number;
	tp: number;
	riskPct: number;
	/** A = the protocol would take this trade now; B = forced by the user against the rules. */
	grade: 'A' | 'B';
	note: string;
}

/**
 * The play button always trades: it enters at the current mark for the trader's side. When the protocol
 * agrees the plan is the protocol's own (grade A). Otherwise the stop still sits on structure, beyond the
 * nearest level on the wrong side of the trade plus 0.5 ATR (1.5 ATR when no level is in reach), and the
 * reason it breaks the rules is reported (grade B). Stops that do not fit the leverage are pulled inside
 * 70% of the liquidation distance, as the exchange would liquidate first.
 */
export function manualPlay(plan: ProtocolPlan | null | undefined, side: ProtocolSide, leverage: number, mark: number, now = Date.now()): ManualPlay {
	const verdict = playVerdict(plan, side, leverage, mark, now);
	if (verdict.kind === 'enter') {
		return { side, stop: verdict.stop, tp: verdict.tp, riskPct: verdict.riskPct, grade: 'A', note: verdict.note };
	}
	const long = side === 'long';
	const atr = plan?.atr && plan.atr > 0 ? plan.atr : mark * 0.01;
	const level = plan ? (long ? plan.supports.find((s) => s < mark) : plan.resistances.find((r) => r > mark)) : undefined;
	let risk = level !== undefined && Math.abs(mark - level) <= 3 * atr ? Math.abs(mark - level) + STOP_ATR * atr : 1.5 * atr;
	let note = verdict.note;
	const liqRoom = mark * Math.max(1 / leverage - 0.005, 0.001) * 0.7;
	if (risk > liqRoom) {
		risk = liqRoom;
		note = `${note}; stop ajustado a la liquidacion de ${leverage}x`;
	}
	risk = Math.max(risk, mark * 0.0005);
	const stop = long ? mark - risk : mark + risk;
	const tp = long ? mark + PROTOCOL_RR * risk : mark - PROTOCOL_RR * risk;
	return { side, stop, tp, riskPct: risk / mark, grade: 'B', note: `fuera de regla: ${note}` };
}
