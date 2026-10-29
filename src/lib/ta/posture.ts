import type {
	Bar,
	Bias,
	FloorStatus,
	SignalResponse,
	Side,
	StaffDef,
	StructureTag,
	TraderDef,
	TraderLeg
} from '$lib/data/types';
import { markLeg, traderNotional } from '$lib/characters/cast';
import { PROTOCOL_MAX_HOLD_MS, PROTOCOL_RR, playVerdict } from './protocol';

export type TraderPosture = 'open' | 'considering' | 'watching' | 'counter';

export interface TraderPostureCard {
	posture: TraderPosture;
	status: FloorStatus;
	traderId: string;
	side: Side;
	leverage: number;
	symbol: string;
	cloud?: string;
	entryMark?: number;
	mark?: number;
	unrealizedPnlUsd?: number;
	unrealizedPnlPctMargin?: number;
	stop?: number;
	tp1?: number;
	tp2?: number;
	rrTp1?: number;
	tentativeStop?: number;
	tentativeTp1?: number;
	structure: StructureTag;
	confluence: number;
	bias: Bias;
	aligned?: boolean;
	invalidation?: string;
	sample: boolean;
}

export interface BookEntry {
	entryMark: number;
	stop: number;
	tp1: number;
	tp2: number;
	strategy: 'trend' | 'hedge';
	rrTp1: number;
	rrTp2: number;
	openedAt: number;
	/** Placed by the user through the TIME field: exempt from thesis and time exits. */
	manual?: boolean;
	/** Half the leg was banked at TP1; the stop sits at breakeven or better and the runner rides to TP2. */
	scaledOut?: boolean;
	/** Opened by the 4h protocol: full exit at 2R, fixed level stop, 5-day time stop, no Supertrend thesis exit. */
	protocol?: boolean;
	/** Breakout legs: chandelier trail in 4h ATR, no fixed target, no time stop. */
	trailAtr?: number;
	/** Best mark since entry (high for longs, low for shorts). */
	extreme?: number;
	/** Last 4h candle (open time) the trail was updated on. */
	trailBar?: number;
}
export type OpenBook = Record<string, BookEntry>;
export interface TakeProfitEvent {
	traderId: string;
	pnlUsd: number;
	target: 'TP1' | 'TP2';
}

const RISK_PROFILE: Record<number, { stop: number; tp1: number; tp2: number }> = {
	5: { stop: 1.28, tp1: 1.35, tp2: 2.25 },
	10: { stop: 1.14, tp1: 1.5, tp2: 2.5 },
	25: { stop: 1, tp1: 1.65, tp2: 2.7 },
	50: { stop: 0.84, tp1: 1.8, tp2: 2.9 },
	100: { stop: 0.7, tp1: 2, tp2: 3.1 }
};

/** Counter-trend fades run at half the desk's normal notional. */
export const HEDGE_SIZE_SCALE = 0.5;
/** The risk desk refuses entries that push net exposure past this share of combined desk capacity. */
export const MAX_NET_FRACTION = 0.5;
const BAR_MS = 15 * 60_000;
/** Share of the leg banked at TP1; the rest runs to TP2 behind a breakeven-or-better stop. */
export const SCALE_OUT_FRACTION = 0.5;
/** Typical perp maintenance margin. Isolated liquidation sits about (1 / leverage - MMR) from entry. */
const MAINTENANCE_MARGIN = 0.005;
/** A stop must trigger well before liquidation would: at most this share of the liquidation distance. */
const STOP_LIQ_BUFFER = 0.7;

/** Fraction of entry price at which an isolated position at this leverage gets liquidated. */
export function liquidationDistance(leverage: number): number {
	return Math.max(1 / leverage - MAINTENANCE_MARGIN, 0.001);
}

/** Tight, liquidation-bound stops are noise bait in a wild tape, so the hottest desks sit it out. */
export function tooWildFor(trader: TraderDef, signal: SignalResponse): boolean {
	return trader.leverage >= 50 && signal.atr.state === 'wild';
}

/** A fade that has not worked within a few bars is a wrong idea; hotter desks give up sooner. */
function fadeMaxHoldMs(trader: TraderDef): number {
	const bars = trader.leverage <= 10 ? 12 : trader.leverage <= 25 ? 8 : trader.leverage <= 50 ? 6 : 4;
	return bars * BAR_MS;
}

/** Approximate tape price at time `t`: linear inside the candle that contains it. */
export function priceAt(bars: Bar[], t: number, latest: number, now: number, barMs = BAR_MS): number {
	if (!bars.length || t >= now) return latest;
	if (t <= bars[0].t) return bars[0].o;
	for (let i = bars.length - 1; i >= 0; i--) {
		const b = bars[i];
		if (t < b.t) continue;
		const forming = i === bars.length - 1 && now < b.t + barMs;
		const span = forming ? Math.max(now - b.t, 1) : barMs;
		const close = forming ? latest : b.c;
		return b.o + (close - b.o) * Math.min(1, (t - b.t) / span);
	}
	return bars[0].o;
}

/** A position placed by hand as if opened at `entryMark` at `openedAt`. Stops and
 * targets are laid out from that entry, then moved to the current mark if the
 * tape has already run through them so the position is not stopped out the
 * instant it is created. */
export function forceBookEntry(
	trader: TraderDef,
	signal: SignalResponse,
	existing: BookEntry | undefined,
	entryMark: number,
	mark: number,
	openedAt: number
): BookEntry {
	const strategy = existing?.strategy ?? (mandateMatch(trader.side, signal.bias) ? 'trend' : 'hedge');
	const plan = riskPlan(trader, signal, entryMark, strategy);
	const long = trader.side === 'long';
	const risk = Math.abs(entryMark - plan.stop);
	let { stop, tp1, tp2 } = plan;
	if (long ? mark <= stop : mark >= stop) stop = long ? mark - risk : mark + risk;
	if (long ? mark >= tp1 : mark <= tp1) {
		tp1 = long ? mark + risk * plan.rrTp1 : mark - risk * plan.rrTp1;
		tp2 = long ? mark + risk * plan.rrTp2 : mark - risk * plan.rrTp2;
	}
	return { entryMark, stop, tp1, tp2, strategy, rrTp1: plan.rrTp1, rrTp2: plan.rrTp2, openedAt, manual: true };
}

export interface BookExposure {
	longUsd: number;
	shortUsd: number;
	netUsd: number;
	grossUsd: number;
}

export function bookExposure(legs: TraderLeg[]): BookExposure {
	let longUsd = 0;
	let shortUsd = 0;
	for (const leg of legs) {
		if (leg.side === 'long') longUsd += leg.notionalUsd;
		else shortUsd += leg.notionalUsd;
	}
	return { longUsd, shortUsd, netUsd: longUsd - shortUsd, grossUsd: longUsd + shortUsd };
}

function riskPlan(trader: TraderDef, signal: SignalResponse, entry: number, strategy: 'trend' | 'hedge') {
	if (strategy === 'trend' && protocolMode(signal)) {
		const v = playVerdict(signal.protocol, trader.side, trader.leverage, entry);
		if (v.kind === 'enter' && v.trailAtr) return { stop: v.stop, tp1: entry, tp2: entry, rrTp1: 0, rrTp2: 0, protocol: true, trailAtr: v.trailAtr };
		if (v.kind === 'enter') return { stop: v.stop, tp1: v.tp, tp2: v.tp, rrTp1: PROTOCOL_RR, rrTp2: PROTOCOL_RR, protocol: true };
	}
	const profile = RISK_PROFILE[trader.leverage] ?? RISK_PROFILE[25];
	// The Supertrend stop sits on the trend side, so a fade is risked off ATR instead.
	const baseRisk = strategy === 'hedge'
		? Math.max(signal.atr['14'], entry * 0.0015)
		: Math.max(Math.abs(entry - signal.risk.stop), signal.atr['14'] * 0.7, entry * 0.0015);
	// A stop beyond the liquidation price is fiction: the exchange closes the leg first. High-leverage
	// desks therefore size the stop off their liquidation distance, not the chart, when it is tighter.
	const risk = Math.min(baseRisk * profile.stop, entry * liquidationDistance(trader.leverage) * STOP_LIQ_BUFFER);
	const rrTp1 = strategy === 'hedge' ? Math.min(profile.tp1, 1.35) : profile.tp1;
	const rrTp2 = strategy === 'hedge' ? Math.min(profile.tp2, 2.1) : profile.tp2;
	const long = trader.side === 'long';
	return {
		stop: long ? entry - risk : entry + risk,
		tp1: long ? entry + risk * rrTp1 : entry - risk * rrTp1,
		tp2: long ? entry + risk * rrTp2 : entry - risk * rrTp2,
		rrTp1,
		rrTp2,
		protocol: false
	};
}

/** The 4h protocol drives the desk whenever the signal carries a plan field (even an empty one). */
export function protocolMode(signal: SignalResponse | null | undefined): boolean {
	return !!signal && signal.protocol !== undefined;
}

function mandateMatch(side: Side, bias: Bias): boolean {
	return (side === 'long' && bias === 'LONG') || (side === 'short' && bias === 'SHORT');
}

function stAgainst(side: Side, dir: 1 | -1): boolean {
	return (side === 'long' && dir === -1) || (side === 'short' && dir === 1);
}

/** Open only when confluence supports the desk mandate - never invent a fill. */
export function wantsOpen(trader: TraderDef, signal: SignalResponse, mark = signal.last): boolean {
	if (protocolMode(signal)) return playVerdict(signal.protocol, trader.side, trader.leverage, mark).kind === 'enter';
	if (!mandateMatch(trader.side, signal.bias)) return false;
	if (stAgainst(trader.side, signal.supertrend.direction)) return false;
	const c = signal.confluence;
	const structured = signal.structure !== 'none';
	if (c >= 5) return true;
	if (c >= 4 && trader.leverage <= 50) return true;
	if (c >= 4 && structured) return true;
	if (c >= 3 && trader.leverage <= 25 && structured) return true;
	if (c >= 3 && trader.leverage <= 10) return true;
	return false;
}

/** Both desks scan the tape on their own. The signal's bias and confluence only
 * describe the trend side, so the desk fighting the trend works a separate
 * mean-reversion (fade) playbook: RSI exhaustion plus price stretched from the
 * EMA21 in ATR units. Higher-leverage desks demand deeper exhaustion, and every
 * threshold tightens when the setup and regime timeframes are both strongly
 * aligned against the fade. */
function fadeMetrics(trader: TraderDef, signal: SignalResponse) {
	const tier = trader.leverage <= 10 ? 0 : trader.leverage <= 25 ? 1 : trader.leverage <= 50 ? 2 : 3;
	const strongTrend = !!signal.mtf?.aligned && signal.confluence >= 5;
	const rsiDist = [10, 12, 15, 18][tier] + (strongTrend ? 5 : 0);
	const stretchNeeded = [0.75, 1, 1.25, 1.5][tier] + (strongTrend ? 0.5 : 0);
	const atr = signal.atr['14'];
	const long = trader.side === 'long';
	const away = long ? signal.ema['21'] - signal.last : signal.last - signal.ema['21'];
	return {
		rsiDist,
		stretchNeeded,
		rsiDepth: long ? 50 - signal.rsi : signal.rsi - 50,
		stretch: atr > 0 ? away / atr : 0
	};
}

export function wantsHedgeOpen(trader: TraderDef, signal: SignalResponse): boolean {
	// Fades had no edge in the backtest (PF 1.02 before costs, 0.49 after), so the protocol desk never fades.
	if (protocolMode(signal)) return false;
	if (mandateMatch(trader.side, signal.bias)) return false;
	const m = fadeMetrics(trader, signal);
	return m.rsiDepth >= m.rsiDist && m.stretch >= m.stretchNeeded;
}

function isFadeForming(trader: TraderDef, signal: SignalResponse): boolean {
	if (protocolMode(signal)) return false;
	if (mandateMatch(trader.side, signal.bias) || wantsHedgeOpen(trader, signal)) return false;
	const m = fadeMetrics(trader, signal);
	return m.rsiDepth >= m.rsiDist * 0.7 && m.stretch >= m.stretchNeeded * 0.6;
}

function fadeCloud(trader: TraderDef, signal: SignalResponse): string {
	return `${trader.side === 'long' ? 'dip-buy?' : 'fade the rip?'} RSI ${signal.rsi.toFixed(0)}`;
}

/** Trend legs die when Supertrend flips against them. A fade's thesis is a
 * snap back to the middle, so it is done once RSI has normalised. */
function thesisBroken(trader: TraderDef, strategy: 'trend' | 'hedge', signal: SignalResponse): boolean {
	if (strategy === 'trend') return stAgainst(trader.side, signal.supertrend.direction);
	return trader.side === 'long' ? signal.rsi >= 55 : signal.rsi <= 45;
}

export function isConsidering(trader: TraderDef, signal: SignalResponse): boolean {
	if (wantsOpen(trader, signal)) return false;
	if (!mandateMatch(trader.side, signal.bias)) return false;
	return signal.confluence >= 2 && signal.confluence <= 4;
}

function thoughtText(trader: TraderDef, signal: SignalResponse): string {
	if (trader.side === 'long') {
		if (signal.structure === 'pullback') return 'pullback long?';
		if (signal.structure === 'breakout') return 'breakout long?';
		if (signal.rsi < 45) return 'wait for reclaim';
		return 'ST flip';
	}
	if (signal.structure === 'rejection') return 'rejection short?';
	if (signal.structure === 'breakout') return 'breakout short?';
	if (signal.rsi > 55) return 'wait for flush';
	return 'ST flip';
}

function statusFromPnl(pct: number): FloorStatus {
	if (pct > 0.2) return 'celebrating';
	if (pct < -0.2) return 'stress';
	return 'open';
}

export function postureForTrader(
	trader: TraderDef,
	signal: SignalResponse | null,
	leg: TraderLeg | null,
	held: string | null = null
): TraderPostureCard {
	const sample = signal?.sample ?? leg?.sample ?? true;
	const structure = signal?.structure ?? 'none';
	const confluence = signal?.confluence ?? 0;
	const bias: Bias = signal?.bias ?? 'FLAT';
	const aligned = signal?.mtf?.aligned ?? false;

	const base = {
		traderId: trader.id,
		side: trader.side,
		leverage: trader.leverage,
		symbol: leg?.symbol ?? signal?.symbol ?? 'SOLUSDT',
		structure,
		confluence,
		bias,
		aligned,
		sample
	};

	if (leg) {
		// An open leg remains open between closed-candle decisions. The book is
		// the source of truth here; intrabar signal noise must not rewrite posture.
		const pct = leg.unrealizedPnlUsd / (leg.notionalUsd / leg.leverage);
		return {
			...base,
			posture: 'open',
			status: statusFromPnl(pct),
			entryMark: leg.entryMark,
			mark: leg.mark,
			unrealizedPnlUsd: leg.unrealizedPnlUsd,
			unrealizedPnlPctMargin: pct,
			stop: leg.stop ?? signal?.risk.stop,
			tp1: leg.tp1 ?? signal?.risk.tp1,
			tp2: leg.tp2 ?? signal?.risk.tp2,
			rrTp1: leg.rrTp1 ?? signal?.risk.rr_tp1,
			invalidation: protocolMode(signal) ? (leg.rrTp1 === 0 ? 'trailing 3 ATR, sin objetivo fijo' : 'stop en nivel, 2R o 5 dias') : 'ST flip against side',
			sample: sample || leg.sample
		};
	}

	if (held) {
		return { ...base, posture: 'considering', status: 'thinking', cloud: held };
	}

	if (!signal) {
		return { ...base, posture: 'watching' as const, status: 'watching' as const };
	}

	if (protocolMode(signal)) {
		const regime = signal.protocol?.regime ?? 'FLAT';
		const wanted = trader.side === 'long' ? 'LONG' : 'SHORT';
		if (regime === 'FLAT') return { ...base, posture: 'watching', status: 'watching' };
		if (regime !== wanted) return { ...base, posture: 'counter', status: 'watching' };
		const v = playVerdict(signal.protocol, trader.side, trader.leverage, signal.last);
		if (v.kind === 'enter') {
			return { ...base, posture: 'considering', status: 'thinking', cloud: `setup: ${v.note}`, tentativeStop: v.stop, tentativeTp1: v.tp, stop: v.stop, tp1: v.tp, tp2: v.tp };
		}
		if (v.level !== undefined && (v.note.startsWith('espera') || v.note.startsWith('orden'))) {
			return { ...base, posture: 'considering', status: 'thinking', cloud: v.note, tentativeStop: v.stop, tentativeTp1: v.tp, stop: v.stop, tp1: v.tp, tp2: v.tp };
		}
		if (['tarde', 'stop', 'ruptura', 'activo'].some((k) => v.note.startsWith(k))) {
			return { ...base, posture: 'considering', status: 'thinking', cloud: v.note };
		}
		return { ...base, posture: 'watching', status: 'watching' };
	}

	if (!mandateMatch(trader.side, bias)) {
		if (isFadeForming(trader, signal)) {
			return { ...base, posture: 'considering', status: 'thinking', cloud: fadeCloud(trader, signal) };
		}
		return bias === 'FLAT'
			? { ...base, posture: 'watching' as const, status: 'watching' as const }
			: { ...base, posture: 'counter' as const, status: 'watching' as const };
	}

	if (isConsidering(trader, signal)) {
		return {
			...base,
			posture: 'considering',
			status: 'thinking',
			cloud: thoughtText(trader, signal),
			tentativeStop: signal.risk.stop,
			tentativeTp1: signal.risk.tp1,
			stop: signal.risk.stop,
			tp1: signal.risk.tp1,
			tp2: signal.risk.tp2
		};
	}

	return { ...base, posture: 'watching', status: 'watching' };
}

/**
 * Reconcile at a closed-candle decision point. Existing legs persist between
 * decisions and only leave on an explicit invalidation. Legs already on the
 * book are settled first so the risk desk sizes new entries against real net
 * exposure and refuses any that would push it past MAX_NET_FRACTION.
 */
export function reconcileBook(
	book: OpenBook,
	signal: SignalResponse | null,
	traders: TraderDef[],
	mark: number,
	sample: boolean,
	displaySymbol = 'SOLUSDT',
	exchangeSymbol = 'SOLUSDT',
	decisionPoint = true,
	options: { cooldown?: ReadonlySet<string>; now?: number; usedSetups?: Readonly<Record<string, number>>; /** Portfolio brake: no new organic protocol entries. */ paused?: boolean } = {}
): { book: OpenBook; legs: TraderLeg[]; takeProfits: TakeProfitEvent[]; stopOuts: string[]; timeStops: string[]; riskDenied: string[]; volHeld: string[]; protocolOpened: Record<string, number> } {
	const next: OpenBook = {};
	const legs: TraderLeg[] = [];
	const takeProfits: TakeProfitEvent[] = [];
	const stopOuts: string[] = [];
	const timeStops: string[] = [];
	const riskDenied: string[] = [];
	const volHeld: string[] = [];
	const protocolOpened: Record<string, number> = {};
	if (!signal || mark <= 0) return { book: {}, legs: [], takeProfits, stopOuts, timeStops, riskDenied, volHeld, protocolOpened };
	// One trade per 4h setup and trader: after a stop or target the same trigger candle is not traded again.
	const setupBar = protocolMode(signal) ? signal.protocol?.setup?.barTime : undefined;

	const now = options.now ?? Date.now();
	const netCap = traders.reduce((sum, t) => sum + traderNotional(t.leverage), 0) * MAX_NET_FRACTION;
	let net = 0;
	const order = [...traders.filter((t) => book[t.id]), ...traders.filter((t) => !book[t.id])];

	for (const t of order) {
		const existing = book[t.id];
		const alreadyOpen = existing !== undefined;
		let strategy: 'trend' | 'hedge';
		if (existing) {
			strategy = existing.strategy;
			if (decisionPoint && !existing.manual && !existing.protocol && thesisBroken(t, strategy, signal)) continue;
			if (decisionPoint && !existing.manual && existing.protocol && !existing.trailAtr && now - existing.openedAt >= PROTOCOL_MAX_HOLD_MS) {
				timeStops.push(t.id);
				continue;
			}
			if (decisionPoint && !existing.manual && strategy === 'hedge' && now - existing.openedAt >= fadeMaxHoldMs(t)) {
				timeStops.push(t.id);
				continue;
			}
		} else if (options.cooldown?.has(t.id)) {
			continue;
		} else if (options.paused && protocolMode(signal)) {
			continue;
		} else if (wantsOpen(t, signal, mark) && !(setupBar !== undefined && options.usedSetups?.[t.id] === setupBar)) {
			strategy = 'trend';
		} else if (wantsHedgeOpen(t, signal)) {
			strategy = 'hedge';
		} else {
			continue;
		}
		if (!alreadyOpen && tooWildFor(t, signal)) {
			volHeld.push(t.id);
			continue;
		}
		const scale = (strategy === 'hedge' ? HEDGE_SIZE_SCALE : 1) * (existing?.scaledOut ? 1 - SCALE_OUT_FRACTION : 1);
		if (!alreadyOpen) {
			const signed = (t.side === 'long' ? 1 : -1) * traderNotional(t.leverage) * scale;
			if (Math.abs(net + signed) > netCap && Math.abs(net + signed) > Math.abs(net)) {
				riskDenied.push(t.id);
				continue;
			}
		}
		const entry = existing?.entryMark ?? mark;
		const long = t.side === 'long';
		let leg = markLeg(t, entry, mark, sample, displaySymbol, exchangeSymbol, scale);
		const plan = existing ?? riskPlan(t, signal, entry, strategy);
		let stop = plan.stop;
		let scaledOut = existing?.scaledOut ?? false;
		// Breakout legs trail a chandelier stop: best mark since entry minus N ATR, tightened at each new 4h close.
		const trailAtr = 'trailAtr' in plan ? plan.trailAtr : undefined;
		let extreme = existing?.extreme ?? entry;
		let trailBar = existing?.trailBar ?? signal.protocol?.asOfBar;
		if (trailAtr && signal.protocol) {
			extreme = long ? Math.max(extreme, mark) : Math.min(extreme, mark);
			if (alreadyOpen && signal.protocol.asOfBar > (trailBar ?? 0)) {
				const trail = long ? extreme - trailAtr * signal.protocol.atr : extreme + trailAtr * signal.protocol.atr;
				stop = long ? Math.max(stop, trail) : Math.min(stop, trail);
				trailBar = signal.protocol.asOfBar;
			}
		}
		// The runner's stop only ever tightens: it trails the Supertrend once that is past breakeven.
		if (scaledOut && strategy === 'trend') {
			const st = signal.supertrend.value;
			stop = long ? Math.max(stop, st < mark ? st : stop) : Math.min(stop, st > mark ? st : stop);
		}
		const hit = (level: number) => (long ? mark >= level : mark <= level);
		const beyondEntry = (level: number) => (long ? level > entry : level < entry);
		if (alreadyOpen && scaledOut && beyondEntry(plan.tp2) && hit(plan.tp2) && leg.unrealizedPnlUsd > 0) {
			takeProfits.push({ traderId: t.id, pnlUsd: leg.unrealizedPnlUsd, target: 'TP2' });
			continue;
		}
		if (alreadyOpen && !scaledOut && plan.rrTp2 <= plan.rrTp1 && beyondEntry(plan.tp1) && hit(plan.tp1) && leg.unrealizedPnlUsd > 0) {
			// Single-target legs (the 4h protocol) bank the whole position at the target.
			takeProfits.push({ traderId: t.id, pnlUsd: leg.unrealizedPnlUsd, target: 'TP1' });
			continue;
		}
		if (alreadyOpen && !scaledOut && beyondEntry(plan.tp1) && hit(plan.tp1) && leg.unrealizedPnlUsd > 0) {
			// Bank part of the leg at TP1 and let the rest run risk-free.
			takeProfits.push({ traderId: t.id, pnlUsd: leg.unrealizedPnlUsd * SCALE_OUT_FRACTION, target: 'TP1' });
			scaledOut = true;
			stop = long ? Math.max(stop, entry) : Math.min(stop, entry);
			leg = markLeg(t, entry, mark, sample, displaySymbol, exchangeSymbol, scale * (1 - SCALE_OUT_FRACTION));
		}
		const stopReached = long ? mark <= stop : mark >= stop;
		if (alreadyOpen && stopReached) {
			// A runner stopped at breakeven or a trailed profit is a normal exit, not a losing stop-out.
			const lockedProfit = trailAtr ? (long ? stop >= entry : stop <= entry) : false;
			if (!scaledOut && !lockedProfit) stopOuts.push(t.id);
			continue;
		}
		leg.strategy = strategy;
		leg.stop = stop;
		leg.tp1 = plan.tp1;
		leg.tp2 = plan.tp2;
		leg.rrTp1 = plan.rrTp1;
		leg.rrTp2 = plan.rrTp2;
		next[t.id] = {
			entryMark: entry, stop, tp1: plan.tp1, tp2: plan.tp2, strategy, rrTp1: plan.rrTp1, rrTp2: plan.rrTp2,
			openedAt: existing?.openedAt ?? now,
			...(existing?.manual ? { manual: true } : {}),
			...(scaledOut ? { scaledOut: true } : {}),
			...((existing ? existing.protocol : 'protocol' in plan && plan.protocol) ? { protocol: true } : {}),
			...(trailAtr ? { trailAtr, extreme, ...(trailBar !== undefined ? { trailBar } : {}) } : {})
		};
		legs.push(leg);
		net += (long ? 1 : -1) * leg.notionalUsd;
		if (!alreadyOpen && next[t.id].protocol && setupBar !== undefined) protocolOpened[t.id] = setupBar;
	}
	const rank = new Map(traders.map((t, i) => [t.id, i]));
	legs.sort((a, b) => (rank.get(a.traderId) ?? 0) - (rank.get(b.traderId) ?? 0));
	return { book: next, legs, takeProfits, stopOuts, timeStops, riskDenied, volHeld, protocolOpened };
}

function fmtUsd(usd: number): string {
	const abs = Math.abs(usd);
	return abs >= 1e6 ? `$${(abs / 1e6).toFixed(1)}M` : `$${Math.round(abs / 1e3)}K`;
}

export function staffNote(
	staff: StaffDef,
	signal: SignalResponse | null,
	risk?: BookExposure & { denied: number }
): string {
	if (!signal) return 'waiting on tape';
	const c = signal.confluence;
	const bias = signal.bias;
	switch (staff.role) {
		case 'cio':
			if (risk && risk.denied > 0) return `net cap hit . ${risk.denied} desk${risk.denied > 1 ? 's' : ''} held`;
			return bias === 'FLAT' ? 'VAR glance - book quiet' : `risk glance . ${bias} ${c}/6`;
		case 'pm':
			if (risk && risk.grossUsd > 0) {
				return `net ${risk.netUsd >= 0 ? 'long' : 'short'} ${fmtUsd(risk.netUsd)} / gross ${fmtUsd(risk.grossUsd)}`;
			}
			return bias === 'FLAT'
				? 'alloc: stay balanced'
				: `alloc note: skew ${bias === 'LONG' ? 'longs' : 'shorts'}`;
		case 'senior_analyst':
			return signal.structure !== 'none'
				? `${signal.structure} . RSI ${signal.rsi.toFixed(0)}`
				: `structure none . RSI ${signal.rsi.toFixed(0)}`;
		case 'research_analyst':
			return `clip: ST ${signal.supertrend.direction === 1 ? '↑' : '↓'} ${signal.supertrend.value.toFixed(1)}`;
		case 'quant':
			return `model conf ${c}/6 . ${signal.atr.state}`;
		default:
			return '';
	}
}

export function staffDetails(
	staff: StaffDef,
	signal: SignalResponse | null,
	risk?: BookExposure & { denied: number }
): string[] {
	if (!signal) return ['Waiting for the live tape before making a desk call.'];

	const alignment = signal.mtf.aligned ? 'regime and setup agree' : 'regime and setup are mixed';
	const exposure = risk && risk.grossUsd > 0
		? `net ${risk.netUsd >= 0 ? 'long' : 'short'} ${fmtUsd(risk.netUsd)} / gross ${fmtUsd(risk.grossUsd)}`
		: 'no open simulated exposure';

	switch (staff.role) {
		case 'cio':
			return [
				`Mandate: protect capital while the ${signal.bias === 'FLAT' ? 'book stays balanced' : `${signal.bias} bias develops`}.`,
				`Risk: ${exposure}${risk?.denied ? `; ${risk.denied} desk hold${risk.denied > 1 ? 's' : ''}` : ''}.`,
				`Regime: ${signal.mtf.regime}; setup ${signal.mtf.setup}; ${alignment}.`
			];
		case 'pm':
			return [
				`Allocation: ${exposure}.`,
				`Action: ${signal.bias === 'FLAT' ? 'keep both books balanced' : `control ${signal.bias.toLowerCase()} concentration`}.`,
				`Confluence: ${signal.confluence}/6; ${alignment}.`
			];
		case 'senior_analyst':
			return [
				`Structure: ${signal.structure}.`,
				`Momentum: RSI ${signal.rsi.toFixed(0)}; EMA21 ${signal.ema['21'].toFixed(1)} / EMA55 ${signal.ema['55'].toFixed(1)}.`,
				`Read: ${signal.bias === 'FLAT' ? 'wait for cleaner structure' : 'track whether price holds the structure before sizing up'}.`
			];
		case 'research_analyst':
			return [
				`Trend line: Supertrend ${signal.supertrend.direction === 1 ? 'up' : 'down'} at ${signal.supertrend.value.toFixed(1)}.`,
				`Risk map: stop ${signal.risk.stop.toFixed(1)}; ATR ${signal.atr.pct.toFixed(2)}% (${signal.atr.state}).`,
				`Research flag: ${signal.structure === 'none' ? 'no confirmed structure' : `${signal.structure} structure under review`}.`
			];
		case 'quant':
			return [
				`Model confidence: ${signal.confluence}/6 (${signal.confluenceBand}).`,
				`Volatility: ATR ${signal.atr.pct.toFixed(2)}% and ${signal.atr.state}.`,
				`Cross-check: 4h ${signal.mtf.regime} / 15m ${signal.mtf.setup}; ${alignment}.`
			];
	}
}

export function statusLabel(status: FloorStatus): string {
	switch (status) {
		case 'open':
			return 'In position';
		case 'thinking':
			return 'Thinking';
		case 'watching':
			return 'Watching';
		case 'flat':
			return 'FLAT';
		case 'stress':
			return 'Stress';
		case 'celebrating':
			return 'Celebrating';
	}
}
