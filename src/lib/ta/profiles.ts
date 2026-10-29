/**
 * Per-asset strategy profile, chosen walk-forward: for each asset, the family whose trades had the best average R
 * over the previous 12 months (at least 8 trades and a positive average), or no trading when neither family made
 * money. Families:
 * - 'proto': 4h rejection at a support/resistance level with volume (src/lib/ta/protocol.ts).
 * - 'brk':   4h Donchian(20) breakout with the regime, 2 ATR initial stop, 3 ATR chandelier trail, no fixed target.
 * - 'both':  either family (default for assets without a profile).
 * - 'none':  the desk does not trade the asset on its own; the play button still can (grade B).
 *
 * Backtest of the selection rule (16 crypto assets, 2023-02 to 2026-10, executed on 1h candles, 0.075% per side):
 * PF 1.29, +202R (in-sample 1.25, out-of-sample 1.32) vs protocol only PF 1.15, +80R. Choosing a different
 * short-term direction indicator per asset did not survive out of sample, so direction stays the 4h regime.
 * Regenerate quarterly from the research scripts; these choices go stale.
 */
import type { ProtocolFamily } from './protocol';

export const PROFILES_AS_OF = '2026-10-29';

export interface AssetProfile {
	family: ProtocolFamily;
	/** Average R per trade of the chosen family over the last 12 months, and its trade count. */
	avgR?: number;
	trades?: number;
	note: string;
}

const P = (family: ProtocolFamily, avgR: number | undefined, trades: number | undefined, note: string): AssetProfile => ({ family, avgR, trades, note });

export const ASSET_PROFILES: Record<string, AssetProfile> = {
	BTCUSDT: P('proto', 0.22, 19, 'rechazos en niveles; rupturas apenas +0.04R'),
	ETHUSDT: P('proto', 0.28, 16, 'ambas familias ganan; protocolo levemente mejor'),
	XRPUSDT: P('proto', 0.0, 12, 'rupturas pierden (-0.25R); protocolo en equilibrio'),
	DOTUSDT: P('proto', 0.67, 9, 'rechazos fuertes; rupturas sin edge'),
	AVAXUSDT: P('proto', 0.43, 17, 'rupturas pierden (-0.13R)'),
	BNBUSDT: P('proto', 0.07, 20, 'edge pequeno'),
	LTCUSDT: P('proto', 0.13, 12, 'rupturas pierden'),
	ZECUSDT: P('brk', 0.63, 40, 'tendencia persistente (VR 1.2): rupturas +25R en 12m, rechazos -2.3R'),
	SOLUSDT: P('brk', 0.11, 42, 'rupturas mejor que rechazos'),
	ADAUSDT: P('brk', 0.34, 36, 'rupturas +12R en 12m'),
	NEARUSDT: P('brk', 0.01, 42, 'edge marginal'),
	XAUUSDT: P('brk', 0.38, 45, 'oro en tendencia: rupturas PF 1.43 (proxy PAXG); rechazos pierden'),
	LINKUSDT: P('none', undefined, undefined, 'ambas familias perdieron en los ultimos 12 meses'),
	AAVEUSDT: P('none', undefined, undefined, 'ambas familias perdieron en los ultimos 12 meses'),
	DOGEUSDT: P('none', undefined, undefined, 'ambas familias perdieron en los ultimos 12 meses'),
	SUIUSDT: P('none', undefined, undefined, 'ambas familias perdieron en los ultimos 12 meses'),
	TRXUSDT: P('none', undefined, undefined, 'ambas familias perdieron en los ultimos 12 meses'),
	EURUSDT: P('none', undefined, undefined, 'sin edge: costos mayores que el movimiento (PF 0.27-0.60)')
};

export function profileFor(display: string): AssetProfile {
	return ASSET_PROFILES[display.toUpperCase()] ?? P('both', undefined, undefined, 'sin perfil propio: usa ambas familias');
}

export function familyLabel(family: ProtocolFamily): string {
	return family === 'proto' ? 'RECHAZO S/R' : family === 'brk' ? 'RUPTURA' : family === 'both' ? 'MIXTO' : 'SIN EDGE';
}
