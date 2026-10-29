<script lang="ts">
	import type { SignalResponse } from '$lib/data/types';
	import { resolveSymbol } from '$lib/data/symbols';

	let {
		signal,
		displaySymbol = 'SOLUSDT'
	}: { signal: SignalResponse | null; displaySymbol?: string } = $props();

	const instrument = $derived(resolveSymbol(signal?.symbol ?? displaySymbol));
	const marketLabel = $derived(instrument.bybit || instrument.display);
	const decimals = $derived(resolveSymbol(signal?.symbol ?? displaySymbol).decimals);
</script>

<div class="chart-desk" class:sample={signal?.sample}>
	<div class="crt-topline">
		<span>CHART DESK / {marketLabel}</span>
		<span>{!signal ? 'LIVE DATA UNAVAILABLE' : signal.sample ? 'SAMPLE' : `${signal.provider.toUpperCase()} LIVE`}</span>
	</div>
	{#if signal}
		<div class="readout">
			<div class="bias" data-bias={signal.bias}>{signal.bias}</div>
			<div class="pips" aria-label={`Confluence ${signal.confluence} of 6`}>
				{#each Array(6) as _, i}<i class:on={i < signal.confluence}></i>{/each}
			</div>
			<div class="structure">
				{signal.structure === 'none' ? 'NO STRUCTURE' : signal.structure.toUpperCase()}
			</div>
		</div>
		{#if signal.protocol}
			{@const p = signal.protocol}
			<div class="terminal-grid">
				<span>LAST</span><b>{signal.last.toFixed(decimals)}</b>
				<span>4H REGIME</span><b>{p.regime}</b>
				<span>SOPORTE</span><b>{p.supports[0] != null ? p.supports[0].toFixed(decimals) : '-'}{p.supports[1] != null ? ` / ${p.supports[1].toFixed(decimals)}` : ''}</b>
				<span>RESIST.</span><b>{p.resistances[0] != null ? p.resistances[0].toFixed(decimals) : '-'}{p.resistances[1] != null ? ` / ${p.resistances[1].toFixed(decimals)}` : ''}</b>
				<span>S/R 1H</span><b>{p.h1?.supports[0] != null ? p.h1.supports[0].toFixed(decimals) : '-'} / {p.h1?.resistances[0] != null ? p.h1.resistances[0].toFixed(decimals) : '-'}</b>
				<span>RSI 4H</span><b>{p.rsi.toFixed(1)} {p.rsi >= 70 ? 'OB' : p.rsi <= 30 ? 'OS' : ''}</b>
				<span>VOL 4H</span><b>{p.volumeRatio.toFixed(2)}x {p.volumeRatio >= 1.5 ? 'OK' : 'LOW'}</b>
			</div>
		{:else}
		<div class="terminal-grid">
			<span>LAST</span><b>{signal.last.toFixed(decimals)}</b>
			<span>RSI 14</span><b>{signal.rsi.toFixed(1)}</b>
			<span>EMA 21 / 55</span
			><b>{signal.ema['21'].toFixed(decimals)} / {signal.ema['55'].toFixed(decimals)}</b>
			<span>SUPERTRND</span
			><b
				>{signal.supertrend.value.toFixed(decimals)}
				{signal.supertrend.direction === 1 ? '↑' : '↓'}</b
			>
			<span>MACD HIST</span><b>{signal.macd.hist.toFixed(3)}</b>
			<span>ATR / VOL</span><b>{signal.atr.pct.toFixed(2)}% {signal.atr.state.toUpperCase()}</b>
		</div>
		{/if}
		{#if signal.protocol}
			<div class="mtf">
				PROTOCOLO 4H . {signal.protocol.setup ? `${signal.protocol.setup.side.toUpperCase()} LIM ${(signal.protocol.setup.limit ?? signal.protocol.setup.level).toFixed(decimals)} . NIVEL ${signal.protocol.setup.level.toFixed(decimals)}` : 'SIN SETUP'}
			</div>
		{:else}
		<div class="risk-rail">
			<span class="stop">SL {signal.risk.stop.toFixed(decimals)}</span>
			<span>TP1 {signal.risk.tp1.toFixed(decimals)}</span>
			<span>TP2 {signal.risk.tp2.toFixed(decimals)}</span>
		</div>
		<div class="mtf">
			4H {signal.mtf.regime} / 15M {signal.mtf.setup} . {signal.mtf.aligned ? 'ALIGNED' : 'COUNTER'}
		</div>
		{/if}
	{:else}
		<div class="boot">TAPE WIRE LIVE DATA UNAVAILABLE<span>_</span></div>
	{/if}
	<div class="scanlines"></div>
</div>

<style>
	.chart-desk {
		position: relative;
		height: 100%;
		padding: 5px 10px;
		overflow: hidden;
		background: #06120d;
		color: #72e3a3;
		font-family: var(--mono, monospace);
		text-shadow: 0 0 5px rgba(80, 255, 150, 0.32);
	}
	.crt-topline {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding-bottom: 2px;
		border-bottom: 1px solid rgba(95, 220, 145, 0.35);
		font-size: 7px;
		letter-spacing: 0.09em;
	}
	.readout {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 7px;
		margin: 3px 0 2px;
	}
	.bias {
		font-size: 18px;
		font-weight: 900;
		letter-spacing: 0.06em;
	}
	.bias[data-bias='SHORT'] {
		color: #ff766a;
	}
	.bias[data-bias='FLAT'] {
		color: #e8c976;
	}
	.pips {
		display: flex;
		gap: 2px;
	}
	.pips i {
		width: 6px;
		height: 6px;
		border: 1px solid #38634e;
	}
	.pips i.on {
		background: #72e3a3;
		box-shadow: 0 0 4px #72e3a3;
	}
	.structure {
		color: #ecc66f;
		font-size: 7px;
		text-align: right;
	}
	.terminal-grid {
		display: grid;
		grid-template-columns: max-content max-content;
		justify-content: center;
		gap: 1px 16px;
		font-size: 7px;
	}
	.terminal-grid span {
		opacity: 0.55;
		text-align: right;
	}
	.terminal-grid b {
		font-weight: 500;
		text-align: left;
	}
	.risk-rail {
		display: flex;
		justify-content: space-between;
		margin-top: 3px;
		padding-top: 2px;
		border-top: 1px dotted rgba(95, 220, 145, 0.35);
		color: #ecc66f;
		font-size: 6px;
	}
	.risk-rail .stop {
		color: #ff766a;
	}
	.mtf {
		margin-top: 2px;
		font-size: 6px;
		opacity: 0.65;
	}
	.boot {
		padding: 32px 0;
		text-align: center;
		font-size: 10px;
	}
	.scanlines {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: repeating-linear-gradient(
			0deg,
			transparent 0 2px,
			rgba(0, 0, 0, 0.22) 2px 3px
		);
		box-shadow: inset 0 0 20px rgba(43, 255, 130, 0.13);
	}
	.sample {
		color: #e8c976;
	}
</style>
