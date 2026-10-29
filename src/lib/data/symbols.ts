/**
 * Display <-> venue instrument mapping.
 *
 * Display uses *USDT form for the office floor.
 * Bybit is the primary market source; BloFin is the permitted exchange fallback.
 */

import type { MarketCategory } from './types';

export type SymbolCategory = MarketCategory;

export interface SymbolDef {
	display: string;
	/** Bybit linear USDT perpetual symbol (always set for tape fill-in). */
	bybit: string;
	/** Bybit spot symbol; defaults to the linear symbol when omitted. */
	bybitSpot?: string;
	canonical: string;
	/** Rough SAMPLE mid when live fetch fails - labeled sample only. */
	sampleMid: number;
	/** Price decimals for tape / HUD. */
	decimals: number;
	label: string;
	category: SymbolCategory;
	/** Google News / headline search phrase. */
	newsQuery: string;
}

export const SYMBOL_CATEGORIES: readonly { id: SymbolCategory | 'all'; label: string }[] = [
	{ id: 'all', label: 'ALL' },
	{ id: 'majors', label: 'MAJORS' },
	{ id: 'meme', label: 'MEME' },
	{ id: 'defi', label: 'DEFI' },
	{ id: 'ai', label: 'AI' },
	{ id: 'etf', label: 'ETF' },
	{ id: 'stock', label: 'STOCK' },
	{ id: 'layer1', label: 'L1' },
	{ id: 'forex', label: 'FX' }
] as const;

export const SYMBOLS: readonly SymbolDef[] = [
	// -- majors (Bybit) --
	{
		display: 'BTCUSDT',
		bybit: 'BTCUSDT',
		canonical: 'CRYPTO:BYBIT:BTCUSDT',
		sampleMid: 80_000,
		decimals: 1,
		label: 'BTC',
		category: 'majors',
		newsQuery: 'Bitcoin OR BTC crypto'
	},
	{
		display: 'ETHUSDT',
		bybit: 'ETHUSDT',
		canonical: 'CRYPTO:BYBIT:ETHUSDT',
		sampleMid: 3_400,
		decimals: 2,
		label: 'ETH',
		category: 'majors',
		newsQuery: 'Ethereum OR ETH crypto'
	},
	{
		display: 'XRPUSDT',
		bybit: 'XRPUSDT',
		canonical: 'CRYPTO:BYBIT:XRPUSDT',
		sampleMid: 0.62,
		decimals: 4,
		label: 'XRP',
		category: 'majors',
		newsQuery: 'XRP OR Ripple crypto'
	},
	{
		display: 'SOLUSDT',
		bybit: 'SOLUSDT',
		canonical: 'CRYPTO:BYBIT:SOLUSDT',
		sampleMid: 108.5,
		decimals: 2,
		label: 'SOL',
		category: 'majors',
		newsQuery: 'Solana OR SOL crypto'
	},
	{
		display: 'ADAUSDT',
		bybit: 'ADAUSDT',
		canonical: 'CRYPTO:BYBIT:ADAUSDT',
		sampleMid: 0.55,
		decimals: 4,
		label: 'ADA',
		category: 'layer1',
		newsQuery: 'Cardano OR ADA crypto'
	},
	{
		display: 'AVAXUSDT',
		bybit: 'AVAXUSDT',
		canonical: 'CRYPTO:BYBIT:AVAXUSDT',
		sampleMid: 28,
		decimals: 3,
		label: 'AVAX',
		category: 'layer1',
		newsQuery: 'Avalanche OR AVAX crypto'
	},
	// -- meme --
	{
		display: 'DOGEUSDT',
		bybit: 'DOGEUSDT',
		canonical: 'CRYPTO:BYBIT:DOGEUSDT',
		sampleMid: 0.14,
		decimals: 5,
		label: 'DOGE',
		category: 'meme',
		newsQuery: 'Dogecoin OR DOGE crypto'
	},
	{
		display: 'PEPEUSDT',
		bybit: 'PEPEUSDT',
		canonical: 'CRYPTO:BYBIT:PEPEUSDT',
		sampleMid: 0.0000095,
		decimals: 8,
		label: 'PEPE',
		category: 'meme',
		newsQuery: 'PEPE meme coin crypto'
	},
	{
		display: 'WIFUSDT',
		bybit: 'WIFUSDT',
		canonical: 'CRYPTO:BYBIT:WIFUSDT',
		sampleMid: 1.85,
		decimals: 4,
		label: 'WIF',
		category: 'meme',
		newsQuery: 'dogwifhat OR WIF crypto'
	},
	{
		display: 'BONKUSDT',
		bybit: 'BONKUSDT',
		canonical: 'CRYPTO:BYBIT:BONKUSDT',
		sampleMid: 0.000022,
		decimals: 8,
		label: 'BONK',
		category: 'meme',
		newsQuery: 'BONK Solana meme crypto'
	},
	{
		display: 'SHIBUSDT',
		bybit: 'SHIB1000USDT',
		bybitSpot: 'SHIBUSDT',
		canonical: 'CRYPTO:BYBIT:SHIB1000USDT',
		sampleMid: 0.000018,
		decimals: 8,
		label: 'SHIB',
		category: 'meme',
		newsQuery: 'Shiba Inu OR SHIB crypto'
	},
	// -- defi --
	{
		display: 'LINKUSDT',
		bybit: 'LINKUSDT',
		canonical: 'CRYPTO:BYBIT:LINKUSDT',
		sampleMid: 14.5,
		decimals: 3,
		label: 'LINK',
		category: 'defi',
		newsQuery: 'Chainlink OR LINK crypto'
	},
	{
		display: 'AAVEUSDT',
		bybit: 'AAVEUSDT',
		canonical: 'CRYPTO:BYBIT:AAVEUSDT',
		sampleMid: 185,
		decimals: 2,
		label: 'AAVE',
		category: 'defi',
		newsQuery: 'Aave OR AAVE DeFi crypto'
	},
	{
		display: 'UNIUSDT',
		bybit: 'UNIUSDT',
		canonical: 'CRYPTO:BYBIT:UNIUSDT',
		sampleMid: 8.5,
		decimals: 3,
		label: 'UNI',
		category: 'defi',
		newsQuery: 'Uniswap OR UNI crypto'
	},
	// -- ai --
	{
		display: 'FETUSDT',
		bybit: 'FETUSDT',
		canonical: 'CRYPTO:BYBIT:FETUSDT',
		sampleMid: 1.15,
		decimals: 4,
		label: 'FET',
		category: 'ai',
		newsQuery: 'Fetch.ai OR FET OR ASI crypto AI'
	},
	{
		display: 'RENDERUSDT',
		bybit: 'RENDERUSDT',
		canonical: 'CRYPTO:BYBIT:RENDERUSDT',
		sampleMid: 5.8,
		decimals: 3,
		label: 'RENDER',
		category: 'ai',
		newsQuery: 'Render OR RNDR crypto AI'
	},
	// -- forex / metales (perpetuos lineales USDT de Bybit; BloFin solo cubre XAU) --
	{
		display: 'XAUUSDT',
		bybit: 'XAUUSDT',
		canonical: 'CFD:BYBIT:XAUUSDT',
		sampleMid: 4_000,
		decimals: 2,
		label: 'XAU',
		category: 'forex',
		newsQuery: 'gold price OR XAUUSD'
	},
	{
		display: 'EURUSDT',
		bybit: 'EURUSDUSDT',
		canonical: 'FX:BYBIT:EURUSDUSDT',
		sampleMid: 1.1,
		decimals: 5,
		label: 'EUR',
		category: 'forex',
		newsQuery: 'EUR/USD OR EURUSD euro dollar'
	},
	// ETF / STOCK: no reliable Bybit equity-perp tickers in this pack -
	// tabs remain for filter UI; leave lists empty (filter shows note).
] as const;

export const DEFAULT_DISPLAY = 'SOLUSDT';

export function categoryForBase(baseInput: string): SymbolCategory {
	const base = baseInput.toUpperCase();
	if (/^(DOGE|SHIB|PEPE|WIF|BONK|FLOKI|BRETT|BOME|MEME|MOG|TURBO|1000SHIB|1000PEPE)$/.test(base)) return 'meme';
	if (/^(LINK|AAVE|UNI|MKR|LDO|CRV|COMP|SNX|SUSHI|DYDX|JUP|RAY|CAKE)$/.test(base)) return 'defi';
	if (/^(FET|TAO|RENDER|RNDR|NEAR|GRT|ARKM|WLD|AGIX|VIRTUAL|IO)$/.test(base)) return 'ai';
	if (/^(SOL|ADA|AVAX|DOT|ATOM|NEAR|SUI|APT|SEI|TON|TRX|ALGO|XLM|HBAR|ICP|EGLD|KAS)$/.test(base)) return 'layer1';
	if (/^(XAU|XAG|EURUSD|GBPUSD|USDJPY)$/.test(base)) return 'forex';
	if (/^(SPY|QQQ|IWM|DIA|TLT|GLD|SLV)$/.test(base)) return 'etf';
	if (/^(TSLA|MSTR|COIN|NVDA|AAPL|AMZN|META|MSFT|GOOGL|HOOD)$/.test(base)) return 'stock';
	return 'majors';
}

const BY_DISPLAY = new Map(SYMBOLS.map((s) => [s.display, s]));
const BY_BYBIT = new Map(SYMBOLS.map((s) => [s.bybit, s]));

/** Aliases accepted on API input -> display symbol. */
const ALIASES: Record<string, string> = {
	BTCUSDT: 'BTCUSDT',
	BTCUSD: 'BTCUSDT',
	BTC: 'BTCUSDT',
	XBTUSDT: 'BTCUSDT',
	XBTUSD: 'BTCUSDT',
	ETHUSDT: 'ETHUSDT',
	ETHUSD: 'ETHUSDT',
	ETH: 'ETHUSDT',
	XRPUSDT: 'XRPUSDT',
	XRPUSD: 'XRPUSDT',
	XRP: 'XRPUSDT',
	SOLUSDT: 'SOLUSDT',
	SOLUSD: 'SOLUSDT',
	SOL: 'SOLUSDT',
	ADAUSDT: 'ADAUSDT',
	ADAUSD: 'ADAUSDT',
	ADA: 'ADAUSDT',
	DOGEUSDT: 'DOGEUSDT',
	DOGEUSD: 'DOGEUSDT',
	DOGE: 'DOGEUSDT',
	LINKUSDT: 'LINKUSDT',
	LINKUSD: 'LINKUSDT',
	LINK: 'LINKUSDT',
	AVAXUSDT: 'AVAXUSDT',
	AVAXUSD: 'AVAXUSDT',
	AVAX: 'AVAXUSDT',
	PEPEUSDT: 'PEPEUSDT',
	PEPE: 'PEPEUSDT',
	WIFUSDT: 'WIFUSDT',
	WIF: 'WIFUSDT',
	BONKUSDT: 'BONKUSDT',
	BONK: 'BONKUSDT',
	SHIBUSDT: 'SHIBUSDT',
	SHIB: 'SHIBUSDT',
	SHIB1000USDT: 'SHIBUSDT',
	AAVEUSDT: 'AAVEUSDT',
	AAVE: 'AAVEUSDT',
	UNIUSDT: 'UNIUSDT',
	UNI: 'UNIUSDT',
	FETUSDT: 'FETUSDT',
	FET: 'FETUSDT',
	RENDERUSDT: 'RENDERUSDT',
	RENDER: 'RENDERUSDT',
	RNDR: 'RENDERUSDT',
	XAUUSDT: 'XAUUSDT',
	XAUUSD: 'XAUUSDT',
	XAU: 'XAUUSDT',
	GOLD: 'XAUUSDT',
	EURUSDT: 'EURUSDT',
	EURUSD: 'EURUSDT',
	EURUSDUSDT: 'EURUSDT',
	EUR: 'EURUSDT'
};

export function resolveSymbol(input: string | null | undefined): SymbolDef {
	const raw = (input ?? DEFAULT_DISPLAY).toUpperCase().replace(/[^A-Z0-9_]/g, '');
	const display =
		ALIASES[raw] ??
		(BY_DISPLAY.has(raw) ? raw : BY_BYBIT.get(raw)?.display);
	const known = BY_DISPLAY.get(display ?? '');
	if (known) return known;
	if (/^[A-Z0-9]+USDT$/.test(raw)) {
		const base = raw.slice(0, -4);
		return {
			display: raw,
			bybit: raw,
			canonical: `CRYPTO:BYBIT:${raw}`,
			sampleMid: 1,
			decimals: 6,
			label: base,
			category: categoryForBase(base),
			newsQuery: `${base} crypto`
		};
	}
	return BY_DISPLAY.get(DEFAULT_DISPLAY)!;
}

export function isKnownDisplay(display: string): boolean {
	return BY_DISPLAY.has(display.toUpperCase());
}


export function bybitSpotSymbol(def: SymbolDef): string {
	return def.bybitSpot ?? def.bybit;
}

/** Human-facing spot wire ticker: omit USDT and show regular pairs as USD. */
export function spotWireSymbol(input: string): string {
	const raw = input.toUpperCase();
	const base = raw.replace(/USDT$/, '');
	if (/(?:\d+(?:L|S)|\d+X(?:LONG|SHORT))$/i.test(base)) return base;
	return `${base}USD`;
}

export function symbolsInCategory(cat: SymbolCategory | 'all'): SymbolDef[] {
	if (cat === 'all') return [...SYMBOLS];
	return SYMBOLS.filter((s) => s.category === cat);
}

export const TAPE_DISPLAYS = SYMBOLS.map((s) => s.display);
