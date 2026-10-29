/** Shared market / TA / cast types for Pixel Hedge Fund v1 */

export type Bias = 'LONG' | 'SHORT' | 'FLAT';
export type Side = 'long' | 'short';
export type Tf = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type VolState = 'quiet' | 'normal' | 'wild';
export type StructureTag = 'pullback' | 'breakout' | 'rejection' | 'none';
export type ConfluenceBand = 'weak' | 'tradeable' | 'high';
export type MarketCategory = 'majors' | 'meme' | 'defi' | 'ai' | 'etf' | 'stock' | 'layer1' | 'forex';
export type AnimState = 'idle' | 'type' | 'phone' | 'walk' | 'point' | 'celebrate' | 'stress';
export type FloorStatus = 'open' | 'thinking' | 'watching' | 'flat' | 'stress' | 'celebrating';

export interface Bar {
	t: number;
	o: number;
	h: number;
	l: number;
	c: number;
	v: number;
}

export interface CandlesResponse {
	symbol: string;
	display: string;
	tf: Tf;
	provider: 'bybit' | 'blofin' | 'sample';
	sample: boolean;
	bars: Bar[];
}

export interface QuoteResponse {
	symbol: string;
	display: string;
	price: number;
	mark: number;
	bid: number;
	ask: number;
	t: number;
	provider: 'bybit' | 'blofin' | 'sample';
	sample: boolean;
	change24h?: number;
	volume24h?: number;
	category?: MarketCategory;
	venue?: 'BYBIT' | 'BLOFIN';
	label?: string;
	decimals?: number;
}

export interface SignalResponse {
	symbol: string;
	tf: string;
	asof: string;
	last: number;
	bias: Bias;
	mtf: { regime: Bias; setup: Bias; aligned: boolean };
	supertrend: { value: number; direction: 1 | -1 };
	ema: { '21': number; '55': number };
	rsi: number;
	macd: { line: number; signal: number; hist: number };
	atr: { '14': number; pct: number; state: VolState };
	structure: StructureTag;
	confluence: number;
	confluenceBand: ConfluenceBand;
	risk: {
		stop: number;
		risk_pct: number;
		tp1: number;
		tp2: number;
		rr_tp1: number;
	};
	sample: boolean;
	provider: 'bybit' | 'blofin' | 'sample';
	/** 4h protocol plan (regime + S/R + rejection + volume). Drives trend entries when present. */
	protocol?: import('$lib/ta/protocol').ProtocolPlan | null;
}

// Trader leverage is user-editable within the persisted 1-1000 range.
export type Leverage = number;

export interface TraderDef {
	id: string;
	name: string;
	role: 'trader';
	side: Side;
	leverage: Leverage;
	skin: string;
	female?: boolean;
	row: 'long' | 'short';
	col: number;
}

export interface StaffDef {
	id: string;
	name: string;
	role: 'cio' | 'pm' | 'senior_analyst' | 'research_analyst' | 'quant';
	title: string;
	skin: string;
	female?: boolean;
	zone: 'corner' | 'pit_walk' | 'analyst' | 'research' | 'quant';
}

export type CastMember = TraderDef | StaffDef;

export interface TraderLeg {
	traderId: string;
	side: Side;
	leverage: Leverage;
	symbol: string;
	exchangeSymbol: string;
	notionalUsd: number;
	entryMark: number;
	mark: number;
	unrealizedPnlUsd: number;
	unrealizedPnlPctMargin: number;
	sample: boolean;
	stop?: number;
	tp1?: number;
	tp2?: number;
	/** Simulated floor-book mandate. Never represents an exchange order. */
	strategy?: 'trend' | 'hedge';
	rrTp1?: number;
	rrTp2?: number;
}

export type DayPhase = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

export interface SimClockState {
	hour: number;
	phase: DayPhase;
	label: string;
	outdoorLux: number;
	raining: boolean;
	rainIntensity: number;
	/** Soft white snowfall on the panoramic glass (holiday window). */
	snowing: boolean;
	snowIntensity: number;
	/** Real-calendar Dec 1-Jan 5: snow can replace rain in weather rolls. */
	holidayWindow: boolean;
}
