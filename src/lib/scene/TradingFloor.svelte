<script lang="ts">
	import { goto } from '$app/navigation';
	import { exchangeFetch } from '$lib/client/exchangeHeaders';
	import { completedBars } from '$lib/data/validation';
	import { onMount } from 'svelte';
	import Skyline from './Skyline.svelte';
	import RainLayer from './RainLayer.svelte';
	import SnowLayer from './SnowLayer.svelte';
	import TickerTape from './TickerTape.svelte';
	import TaHud from './TaHud.svelte';
	import CharacterSprite from './CharacterSprite.svelte';
	import MiniChart from './MiniChart.svelte';
	import FaxMachine from './FaxMachine.svelte';
	import StickyNotes from './StickyNotes.svelte';
	import FloorPet from './FloorPet.svelte';
	import TrashCan from './TrashCan.svelte';
	import CrtPnlCart from './CrtPnlCart.svelte';
	import DeskBookReader from './DeskBookReader.svelte';
	import { DESK_LIBRARY, type DeskBookId } from '$lib/books/deskLibrary';
	import MariachiBand from './MariachiBand.svelte';
	import DeskConsole from './DeskConsole.svelte';
	import ToastStack from '$lib/ui/ToastStack.svelte';
	import {
		loadDeskSettings,
		saveDeskSettings,
		type DeskSettings,
		type OfficeTheme
	} from '$lib/persist/deskSettings';
	import MonitorPanel from './MonitorPanel.svelte';
	import QuickTradePanel from './QuickTradePanel.svelte';
	import ProfitCalcPanel from './ProfitCalcPanel.svelte';
	import { TRADERS, STAFF } from '$lib/characters/cast';
	import { DEFAULT_OFFICE_FLAG, OFFICE_FLAGS } from '$lib/data/officeFlags';
	import {
		loadBloFinAssignments,
		type BloFinAssignments
	} from '$lib/persist/blofinAssignments';
	import {
		loadScenePosition,
		saveScenePosition
	} from '$lib/persist/scenePositions';
	import { initialSimClock, tickSimClock, applyForcedChristmasSnow, SIM_MINUTES_PER_REAL_SECOND } from '$lib/weather/timeCycle';
	import { initialUfo, tickUfo } from '$lib/weather/ufoEvent';
	import { initialMariachi, tickMariachi } from '$lib/weather/mariachiEvent';
	import { DEFAULT_DISPLAY, SYMBOLS, SYMBOL_CATEGORIES, resolveSymbol, spotWireSymbol, symbolsInCategory, type SymbolCategory } from '$lib/data/symbols';
	import type {
		Bar,
		CandlesResponse,
		QuoteResponse,
		SignalResponse,
		SimClockState,
		StaffDef,
		TraderDef,
		TraderLeg,
	} from '$lib/data/types';
	import { bookExposure, forceBookEntry, postureForTrader, priceAt, protocolMode, reconcileBook, staffDetails, staffNote, statusLabel, type BookEntry, type OpenBook } from '$lib/ta/posture';
	import { PROTOCOL_RR, RSI_OVERBOUGHT, RSI_OVERSOLD, ZONE_ATR, manualPlay } from '$lib/ta/protocol';
	import { pushToast } from '$lib/ui/toast';
	import {
		loadLeverageOverrides,
		saveLeverageOverrides,
		applyLeverageOverrides,
		isLeverage,
		type LeverageOverrides
	} from '$lib/persist/leverage';

	const STORAGE_KEY = 'phf-active-symbol';
	const BREAK_STATE_KEY = 'phf-floor-break-state';
	type PersistedBreakState = {
		version: 1;
		symbol: string;
		savedAt: number;
		book: OpenBook;
		legs: TraderLeg[];
		reentryCooldowns: Record<string, number>;
		reassessUntil: Record<string, number>;
		riskDenied: string[];
	};

	let clock = $state<SimClockState>(initialSimClock());
	let quote = $state<QuoteResponse | null>(null);
	let tapeQuotes = $state<QuoteResponse[]>([]);
	let signal = $state<SignalResponse | null>(null);
	let bars = $state<Bar[]>([]);
	let legs = $state<TraderLeg[]>([]);
	let book = $state<OpenBook>({});
	let riskDenied = $state<string[]>([]);
	let volHeld = $state<string[]>([]);
	type TakeProfitFlash = { pnlUsd: number; target: 'TP1' | 'TP2'; expiresAt: number };
	let takeProfitFlashes = $state<Record<string, TakeProfitFlash>>({});
	let reentryCooldowns = $state<Record<string, number>>({});
	let lastDecisionCandle = 0;
	let marketRequest = 0;
	let tapeRequest = 0;
	let tapeController: AbortController | null = null;
	let tapePending = false;
	let tapeFailures = 0;
	let tapeRetryAt = 0;
	let tapeError = $state<string | null>(null);
	let err = $state<string | null>(null);
	let animTick = $state(0);
	let totalSimMinutes = $state(0);
	let inspectedId = $state('L05');
	let pinnedId = $state<string | null>(null);
	let activeDisplay = $state(DEFAULT_DISPLAY);
	let ufo = $state(initialUfo());
	let lastUfoPulse = $state(-1);
	let mariachi = $state(initialMariachi());
	let leverageOverrides = $state<LeverageOverrides>({});
	let deskConsoleOpen = $state(false);
	let deskBookOpen = $state(false);
	let deskBookId = $state<DeskBookId | null>(null);
	let monitorPanelOpen = $state(false);
	let quickTradeOpen = $state(false);
	let quickTradePresetTraderId = $state<string | null>(null);
	let profitCalcOpen = $state(false);
	let coffeeTripActive = $state(false);
	let coffeeTripTimer: ReturnType<typeof setTimeout> | null = null;
	let deskSettings = $state(loadDeskSettings());
	let settingsOpen = $state(false);
	const selectedOfficeFlag = $derived(OFFICE_FLAGS.find((flag) => flag.id === deskSettings.officeFlag) ?? DEFAULT_OFFICE_FLAG);
	let wallNow = $state(Date.now());
	// Traders released with the desk's release button show a 'rethinking' cloud until this time.
	let reassessUntil = $state<Record<string, number>>({});
	// What a trader said when the play button found no valid trade right now (shown as their cloud for a minute).
	let playNotes = $state<Record<string, { note: string; until: number }>>({});
	// Last 4h setup candle each trader already traded, so a stop or target is not followed by a re-entry on the same trigger.
	let usedSetups = $state<Record<string, number>>({});
	const RELEASE_MS = 60_000;
	// Last successful market read. The TIME field prices entries from it so a dropped poll does not block editing.
	let lastMarket = $state<{ signal: SignalResponse; quote: QuoteResponse; bars: Bar[]; sample: boolean } | null>(null);
	let blofinAssignments = $state<BloFinAssignments>({});
	let blofinOverlay = $state<Record<string, string>>({});
	let sceneFrame = $state<HTMLDivElement>();
	let officeFloor = $state<HTMLElement>();
	let clipboardRoot = $state<HTMLElement>();
	let clipboardLeft = $state(16);
	let clipboardTop = $state(155);
	let clipboardReady = $state(false);
	let clipboardDragging = $state(false);
	let clipboardPointerId: number | null = null;
	let clipboardOffsetX = 0;
	let clipboardOffsetY = 0;

	const PRICE_PAD_KEY = 'phf-price-pad-pos';
	const CLIPBOARD_KEY = 'phf-clipboard-pos';
	const WIRE_MARKET_KEY = 'phf-wire-market';
	type WireDecorId = 'horse' | 'cabinet' | 'plant';
	const WIRE_DECOR_KEYS: Record<WireDecorId, string> = {
		horse: 'phf-market-wire-horse-pos',
		cabinet: 'phf-market-wire-cabinet-pos',
		plant: 'phf-market-wire-plant-pos'
	};
	const WIRE_DECOR_DEFAULTS: Record<WireDecorId, { left: number; top: number }> = {
		horse: { left: 393, top: 192 },
		cabinet: { left: 356, top: 245 },
		plant: { left: 728, top: 219 }
	};
	let wireDecorEls: Partial<Record<WireDecorId, HTMLElement>> = {};
	let wireDecorPositions = $state<Record<WireDecorId, { left: number; top: number; dragging: boolean }>>({
		horse: { ...WIRE_DECOR_DEFAULTS.horse, dragging: false },
		cabinet: { ...WIRE_DECOR_DEFAULTS.cabinet, dragging: false },
		plant: { ...WIRE_DECOR_DEFAULTS.plant, dragging: false }
	});
	const wireDecorDrag: Partial<Record<WireDecorId, { pointerId: number; offsetX: number; offsetY: number }>> = {};
	type LoungeDecorId = 'fortune' | 'loungePlant' | 'sofa';
	const LOUNGE_DECOR_KEYS: Record<LoungeDecorId, string> = {
		fortune: 'phf-lounge-fortune-pos', loungePlant: 'phf-lounge-plant-pos', sofa: 'phf-lounge-sofa-pos'
	};
	const LOUNGE_DECOR_DEFAULTS: Record<LoungeDecorId, { left: number; top: number }> = {
		fortune: { left: 295, top: 778 },
		loungePlant: { left: 1264, top: 546 },
		// Matches where the sofa used to sit as static scenery (right:9/bottom:11 of the lounge).
		sofa: { left: 1326, top: 823 }
	};
	let loungeDecorEls: Partial<Record<LoungeDecorId, HTMLElement>> = {};
	let loungeDecorPositions = $state<Record<LoungeDecorId, { left: number; top: number; dragging: boolean }>>({
		fortune: { left: 0, top: 0, dragging: false }, loungePlant: { left: 0, top: 0, dragging: false },
		sofa: { left: 0, top: 0, dragging: false }
	});
	const loungeDecorDrag: Partial<Record<LoungeDecorId, { pointerId: number; offsetX: number; offsetY: number }>> = {};
	const OFFICE_FLAG_KEY = 'phf-office-flag-pos';
	const OFFICE_FLAG_DEFAULT = { left: 934, top: 901 };
	const OFFICE_FLAG_INSET = 12;
	const CLIPBOARD_DEFAULT = { left: 30, top: 184 };
	const PRICE_PAD_DEFAULT = { left: 1150, top: 314 };
	let officeFlagEl = $state<HTMLElement>();
	let officeFlagPosition = $state({ ...OFFICE_FLAG_DEFAULT, dragging: false });
	const officeFlagDrag: { pointerId: number | null; offsetX: number; offsetY: number } = { pointerId: null, offsetX: 0, offsetY: 0 };
	let pricePadRoot = $state<HTMLElement>();
	let pricePadLeft = $state(18);
	let pricePadTop = $state(0);
	let pricePadReady = $state(false);
	let pricePadPlaced = $state(false);
	let pricePadDragging = $state(false);
	let pricePadPointerId: number | null = null;
	let pricePadOffsetX = 0;
	let pricePadOffsetY = 0;
	let pricePadSaved = $state<{ left: number; top: number } | null>(null);

	function onWireDecorPointerDown(id: WireDecorId, event: PointerEvent) {
		const el = wireDecorEls[id];
		if (!el || !sceneFrame || wireDecorDrag[id]) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const rect = sceneFrame.getBoundingClientRect();
		wireDecorDrag[id] = {
			pointerId: event.pointerId,
			offsetX: (event.clientX - rect.left) * sceneFrame.clientWidth / rect.width - wireDecorPositions[id].left,
			offsetY: (event.clientY - rect.top) * sceneFrame.clientHeight / rect.height - wireDecorPositions[id].top
		};
		wireDecorPositions = { ...wireDecorPositions, [id]: { ...wireDecorPositions[id], dragging: true } };
		el.setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onWireDecorPointerMove(id: WireDecorId, event: PointerEvent) {
		const meta = wireDecorDrag[id];
		const el = wireDecorEls[id];
		if (!meta || meta.pointerId !== event.pointerId || !sceneFrame || !el) return;
		const parentRect = sceneFrame.getBoundingClientRect();
		const scaleX = parentRect.width > 0 ? sceneFrame.clientWidth / parentRect.width : 1;
		const scaleY = parentRect.height > 0 ? sceneFrame.clientHeight / parentRect.height : 1;
		const width = el.offsetWidth;
		const height = el.offsetHeight;
		const left = Math.max(0, Math.min(sceneFrame.clientWidth - width, (event.clientX - parentRect.left) * scaleX - meta.offsetX));
		const top = Math.max(0, Math.min(sceneFrame.clientHeight - height, (event.clientY - parentRect.top) * scaleY - meta.offsetY));
		wireDecorPositions = { ...wireDecorPositions, [id]: { ...wireDecorPositions[id], left, top } };
		event.preventDefault();
	}

	function onWireDecorPointerUp(id: WireDecorId, event: PointerEvent) {
		const meta = wireDecorDrag[id];
		const el = wireDecorEls[id];
		if (!meta || meta.pointerId !== event.pointerId) return;
		const position = wireDecorPositions[id];
		saveScenePosition(WIRE_DECOR_KEYS[id], position);
		wireDecorPositions = { ...wireDecorPositions, [id]: { ...position, dragging: false } };
		delete wireDecorDrag[id];
		if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
	}

	function onWireDecorKeyDown(id: WireDecorId, event: KeyboardEvent) {
		const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		const move = delta[event.key];
		if (!move) return;
		event.preventDefault();
		const step = event.shiftKey ? 20 : 5;
		const position = wireDecorPositions[id];
		wireDecorPositions = { ...wireDecorPositions, [id]: { ...position, left: position.left + move[0] * step, top: position.top + move[1] * step } };
		clampWireDecorToScene();
		saveScenePosition(WIRE_DECOR_KEYS[id], wireDecorPositions[id]);
	}

	function bindWireDecor(node: HTMLElement, id: WireDecorId) {
		wireDecorEls[id] = node;
		return {
			destroy() {
				delete wireDecorEls[id];
			}
		};
	}

	function placeOfficeFlag() {
		if (!sceneFrame || !officeFlagEl) return;
		const saved = loadScenePosition(OFFICE_FLAG_KEY);
		const narrow = sceneFrame.clientWidth <= 768;
		const maxLeft = Math.max(0, sceneFrame.clientWidth - officeFlagEl.offsetWidth);
		const maxTop = Math.max(0, sceneFrame.clientHeight - officeFlagEl.offsetHeight);
		const insetX = Math.min(OFFICE_FLAG_INSET, maxLeft / 2);
		const insetY = Math.min(OFFICE_FLAG_INSET, maxTop / 2);
		const mobileDefault = { left: maxLeft - insetX, top: insetY };
		const source = narrow && (!saved || saved.left > maxLeft) ? mobileDefault : (saved ?? OFFICE_FLAG_DEFAULT);
		officeFlagPosition = {
			...officeFlagPosition,
			left: Math.min(Math.max(insetX, source.left), maxLeft - insetX),
			top: Math.min(Math.max(insetY, source.top), maxTop - insetY)
		};
	}
	function onOfficeFlagPointerDown(event: PointerEvent) {
		if (!officeFlagEl || !sceneFrame || officeFlagDrag.pointerId !== null) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const rect = sceneFrame.getBoundingClientRect();
		officeFlagDrag.pointerId = event.pointerId;
		officeFlagDrag.offsetX = (event.clientX - rect.left) * sceneFrame.clientWidth / rect.width - officeFlagPosition.left;
		officeFlagDrag.offsetY = (event.clientY - rect.top) * sceneFrame.clientHeight / rect.height - officeFlagPosition.top;
		officeFlagPosition = { ...officeFlagPosition, dragging: true };
		officeFlagEl.setPointerCapture(event.pointerId);
		event.preventDefault();
	}
	function onOfficeFlagPointerMove(event: PointerEvent) {
		if (!sceneFrame || !officeFlagEl || officeFlagDrag.pointerId !== event.pointerId) return;
		const rect = sceneFrame.getBoundingClientRect();
		const scaleX = rect.width > 0 ? sceneFrame.clientWidth / rect.width : 1;
		const scaleY = rect.height > 0 ? sceneFrame.clientHeight / rect.height : 1;
		const maxLeft = Math.max(0, sceneFrame.clientWidth - officeFlagEl.offsetWidth);
		const maxTop = Math.max(0, sceneFrame.clientHeight - officeFlagEl.offsetHeight);
		const insetX = Math.min(OFFICE_FLAG_INSET, maxLeft / 2);
		const insetY = Math.min(OFFICE_FLAG_INSET, maxTop / 2);
		officeFlagPosition = {
			...officeFlagPosition,
			left: Math.min(Math.max(insetX, (event.clientX - rect.left) * scaleX - officeFlagDrag.offsetX), maxLeft - insetX),
			top: Math.min(Math.max(insetY, (event.clientY - rect.top) * scaleY - officeFlagDrag.offsetY), maxTop - insetY)
		};
		event.preventDefault();
	}
	function onOfficeFlagPointerUp(event: PointerEvent) {
		if (!officeFlagEl || officeFlagDrag.pointerId !== event.pointerId) return;
		saveScenePosition(OFFICE_FLAG_KEY, officeFlagPosition);
		officeFlagPosition = { ...officeFlagPosition, dragging: false };
		officeFlagDrag.pointerId = null;
		if (officeFlagEl.hasPointerCapture(event.pointerId)) officeFlagEl.releasePointerCapture(event.pointerId);
	}
	function bindOfficeFlag(node: HTMLElement) {
		officeFlagEl = node;
		return { destroy() { if (officeFlagEl === node) officeFlagEl = undefined; } };
	}

	function bindLoungeDecor(node: HTMLElement, id: LoungeDecorId) {
		loungeDecorEls[id] = node;
		return { destroy() { delete loungeDecorEls[id]; } };
	}

	function placeLoungeDecor() {
		if (!sceneFrame || !officeFloor) return;
		for (const id of Object.keys(LOUNGE_DECOR_KEYS) as LoungeDecorId[]) {
			const saved = loadScenePosition(LOUNGE_DECOR_KEYS[id]);
			const el = loungeDecorEls[id];
			if (!el) continue;
			const source = saved ?? LOUNGE_DECOR_DEFAULTS[id];
			loungeDecorPositions = { ...loungeDecorPositions, [id]: {
				...loungeDecorPositions[id], left: Math.max(0, Math.min(source.left, sceneFrame.clientWidth - el.offsetWidth)),
				top: Math.max(0, Math.min(source.top, sceneFrame.clientHeight - el.offsetHeight))
			} };
		}
	}

	function onLoungeDecorPointerDown(id: LoungeDecorId, event: PointerEvent) {
		const el = loungeDecorEls[id];
		if (!el || !sceneFrame || loungeDecorDrag[id] || (event.pointerType === 'mouse' && event.button !== 0)) return;
		const rect = sceneFrame.getBoundingClientRect();
		loungeDecorDrag[id] = { pointerId: event.pointerId, offsetX: (event.clientX - rect.left) * sceneFrame.clientWidth / rect.width - loungeDecorPositions[id].left, offsetY: (event.clientY - rect.top) * sceneFrame.clientHeight / rect.height - loungeDecorPositions[id].top };
		loungeDecorPositions = { ...loungeDecorPositions, [id]: { ...loungeDecorPositions[id], dragging: true } };
		el.setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onLoungeDecorPointerMove(id: LoungeDecorId, event: PointerEvent) {
		const meta = loungeDecorDrag[id];
		const el = loungeDecorEls[id];
		if (!meta || meta.pointerId !== event.pointerId || !el || !sceneFrame) return;
		const rect = sceneFrame.getBoundingClientRect();
		const scaleX = sceneFrame.clientWidth / rect.width;
		const scaleY = sceneFrame.clientHeight / rect.height;
		const left = Math.max(0, Math.min(sceneFrame.clientWidth - el.offsetWidth, (event.clientX - rect.left) * scaleX - meta.offsetX));
		const top = Math.max(0, Math.min(sceneFrame.clientHeight - el.offsetHeight, (event.clientY - rect.top) * scaleY - meta.offsetY));
		loungeDecorPositions = { ...loungeDecorPositions, [id]: { ...loungeDecorPositions[id], left, top } };
		event.preventDefault();
	}

	function onLoungeDecorPointerUp(id: LoungeDecorId, event: PointerEvent) {
		const meta = loungeDecorDrag[id];
		const el = loungeDecorEls[id];
		if (!meta || meta.pointerId !== event.pointerId) return;
		const position = loungeDecorPositions[id];
		saveScenePosition(LOUNGE_DECOR_KEYS[id], position);
		loungeDecorPositions = { ...loungeDecorPositions, [id]: { ...position, dragging: false } };
		delete loungeDecorDrag[id];
		if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
	}

	function clampWireDecorToScene() {
		if (!sceneFrame) return;
		for (const id of Object.keys(WIRE_DECOR_KEYS) as WireDecorId[]) {
			const el = wireDecorEls[id];
			if (!el) continue;
			const position = wireDecorPositions[id];
			const left = Math.max(0, Math.min(position.left, sceneFrame.clientWidth - el.offsetWidth));
			const top = Math.max(0, Math.min(position.top, sceneFrame.clientHeight - el.offsetHeight));
			if (left !== position.left || top !== position.top) {
				wireDecorPositions = { ...wireDecorPositions, [id]: { ...position, left, top } };
			}
		}
	}


	/** Individual desk props - each drags alone; positions in localStorage. */
	type DeskPropId = 'pad' | 'calc' | 'coffee' | 'set' | 'keyboard' | 'wsj' | 'legal' | 'break';
	type DeskPropState = {
		left: number;
		top: number;
		ready: boolean;
		placed: boolean;
		dragging: boolean;
		suppressClick: boolean;
	};

	const DESK_PROP_KEYS: Record<DeskPropId, string> = {
		pad: 'phf-tool-pad-pos',
		calc: 'phf-tool-calc-pos',
		coffee: 'phf-tool-coffee-pos',
		set: 'phf-tool-set-pos',
		keyboard: 'phf-tool-keyboard-pos',
		wsj: 'phf-wsj-pos',
		legal: 'phf-legal-pad-pos',
		break: 'phf-tool-break-pos'
	};
	const DESK_PROP_DEFAULT_KEYS: Record<DeskPropId, string> = {
		pad: 'phf-default-tool-pad-pos', calc: 'phf-default-tool-calc-pos', coffee: 'phf-default-tool-coffee-pos',
		set: 'phf-default-tool-set-pos', keyboard: 'phf-default-tool-keyboard-pos', wsj: 'phf-default-wsj-pos', legal: 'phf-default-legal-pad-pos',
		break: 'phf-default-tool-break-pos'
	};

	const DESK_PROP_DEFAULTS: Record<DeskPropId, { left: number; top: number }> = {
		pad: { left: 1065, top: 31 },
		calc: { left: 1175, top: 77 },
		coffee: { left: 1232, top: 17 },
		set: { left: 1323, top: 78 },
		keyboard: { left: 870, top: 69 },
		wsj: { left: 232, top: 20 },
		legal: { left: 384, top: 21 },
		break: { left: 1323, top: 17 }
	};

	let foregroundDesk = $state<HTMLElement>();
	let foregroundDeskTop = $state(0);
	let deskPropEls: Partial<Record<DeskPropId, HTMLElement>> = {};
	// Content that loads above the foreground desk (market data filling in empty panels) can
	// shift the desk's position after the first paint. Keep recomputing default prop placement
	// until the layout has gone quiet for a bit, then lock it so later resizes never move it.
	let deskLayoutSettled = false;
	let deskSettleTimer: ReturnType<typeof setTimeout> | undefined;
	// The market fetch is what actually grows the content above the desk and can take well
	// over a second; don't allow the settle countdown to start until it has resolved once.
	let firstMarketPollDone = false;
	let deskProps = $state<Record<DeskPropId, DeskPropState>>(
		(Object.keys(DESK_PROP_DEFAULTS) as DeskPropId[]).reduce(
			(acc, id) => {
				acc[id] = {
					...DESK_PROP_DEFAULTS[id],
					ready: false,
					placed: false,
					dragging: false,
					suppressClick: false
				};
				return acc;
			},
			{} as Record<DeskPropId, DeskPropState>
		)
	);

	/** MARKET WIRE category filter */
	let wireCategory = $state<SymbolCategory | 'all'>('all');
	let wireMarket = $state<'futures' | 'spot'>('futures');
	const filteredTapeQuotes = $derived(
		tapeQuotes.filter((q) => {
			if (wireCategory === 'all') return true;
			return (q.category ?? resolveSymbol(q.display).category) === wireCategory;
		})
	);
	const wireChannels = $derived.by(() => {
		const seen = new Set<string>();
		const rows = filteredTapeQuotes
			.slice(0, 20)
			.map((q) => ({ display: q.display, label: q.label ?? resolveSymbol(q.display).label }))
			.filter((row) => {
				if (seen.has(row.display)) return false;
				seen.add(row.display);
				return true;
			});
		return rows.length ? rows : symbolsInCategory(wireCategory).map((s) => ({ display: s.display, label: s.label }));
	});
	const wireTokenQuotes = $derived(
		filteredTapeQuotes.filter((q) => /(?:\d+(?:L|S)|\d+X(?:LONG|SHORT))$/i.test(q.display.replace(/USDT$/, '')))
	);

	/** WSJ headlines for active symbol */
	type DeskHeadline = { title: string; link: string; source: string };
	function sampleDeskHeadlines(label: string): DeskHeadline[] {
		return [
			{ title: `${label} in focus as crypto desks watch flows`, link: '', source: 'SAMPLE' },
			{ title: `Markets: traders map levels for ${label}`, link: '', source: 'SAMPLE' },
			{ title: `${label} tape quiet - SAMPLE wire`, link: '', source: 'SAMPLE' }
		];
	}
	let newsHeadlines = $state<DeskHeadline[]>(sampleDeskHeadlines(DEFAULT_DISPLAY));
	let newsSample = $state(true);
	let wsjExpanded = $state(false);
	let legalPadExpanded = $state(false);

	/** Live exchange positions for yellow legal pad */
	type DeskPosLine = { venue: 'BF' | 'BY'; text: string };
	let deskPosLines = $state<DeskPosLine[]>([]);
	let deskPosNote = $state<string | null>(null);

	const activeDef = $derived(resolveSymbol(activeDisplay));
	const traders = $derived(applyLeverageOverrides(TRADERS, leverageOverrides));
	const longTraders = $derived(traders.filter((t) => t.side === 'long'));
	const shortTraders = $derived(traders.filter((t) => t.side === 'short'));
	const inspectedTrader = $derived(traders.find((t) => t.id === inspectedId) ?? null);
	const inspectedStaff = $derived(STAFF.find((s) => s.id === inspectedId) ?? null);
	const pinnedTrader = $derived(traders.find((t) => t.id === pinnedId) ?? null);
	const inspectedLeg = $derived(
		inspectedTrader ? (legs.find((l) => l.traderId === inspectedTrader.id) ?? null) : null
	);
	const inspectedPosture = $derived(
		inspectedTrader ? postureForTrader(inspectedTrader, signal, inspectedLeg, heldReason(inspectedTrader.id, inspectedLeg != null)) : null
	);
	const pinnedLeg = $derived(
		pinnedTrader ? (legs.find((l) => l.traderId === pinnedTrader.id) ?? null) : null
	);
	const pinnedPosture = $derived(
		pinnedTrader ? postureForTrader(pinnedTrader, signal, pinnedLeg, heldReason(pinnedTrader.id, pinnedLeg != null)) : null
	);
	const longOpen = $derived(
		longTraders.filter(
			(t) =>
				postureForTrader(t, signal, legs.find((l) => l.traderId === t.id) ?? null).posture ===
				'open'
		).length
	);
	const shortOpen = $derived(
		shortTraders.filter(
			(t) =>
				postureForTrader(t, signal, legs.find((l) => l.traderId === t.id) ?? null).posture ===
				'open'
		).length
	);
	const priceDecimals = $derived(activeDef.decimals);
	// The badge follows the data the floor actually trades on (the active pair), not the build mode.
	const wireSample = $derived(quote ? quote.sample : tapeQuotes.length === 0 || tapeQuotes.every((q) => q.sample));
	const bookRisk = $derived({ ...bookExposure(legs), denied: riskDenied.length });

	function legFor(id: string) {
		return legs.find((l) => l.traderId === id) ?? null;
	}
	function tradeDurationFor(id: string): number | null {
		const entry = book[id];
		if (!entry || !legFor(id)) return null;
		return Math.max(0, Math.floor((wallNow - entry.openedAt) / 60_000));
	}
	// Typing N minutes places the trader in a position opened N minutes ago, priced
	// at the tape then. It works whether or not the trader already holds a position.
	function setTraderTradeDuration(traderId: string, minutes: number) {
		const trader = traders.find((t) => t.id === traderId);
		const market = lastMarket;
		if (!trader || !market) return;
		if (!Number.isInteger(minutes) || minutes < 0 || minutes > 100000) return;
		const now = Date.now();
		const mark = market.quote.mark || market.quote.price;
		const historyMinutes = Math.max(0, Math.floor((now - market.bars[0].t) / 60_000));
		const openedAt = now - Math.min(minutes, historyMinutes) * 60_000;
		const forced = forceBookEntry(trader, market.signal, book[traderId], priceAt(market.bars, openedAt, mark, now), mark, openedAt);
		const def = resolveSymbol(activeDisplay);
		wallNow = now;
		if (reassessUntil[traderId]) reassessUntil = { ...reassessUntil, [traderId]: 0 };
		applyBookResult(
			reconcileBook({ ...book, [traderId]: forced }, market.signal, traders, mark, market.sample, def.display, def.bybit, false, { cooldown: activeCooldowns(now), now, usedSetups }),
			now
		);
	}
	function isFiniteNumber(value: unknown): value is number {
		return typeof value === 'number' && Number.isFinite(value);
	}
	function isBookEntry(value: unknown): value is BookEntry {
		if (!value || typeof value !== 'object') return false;
		const entry = value as Record<string, unknown>;
		return (
			isFiniteNumber(entry.entryMark) &&
			isFiniteNumber(entry.stop) &&
			isFiniteNumber(entry.tp1) &&
			isFiniteNumber(entry.tp2) &&
			(entry.strategy === 'trend' || entry.strategy === 'hedge') &&
			isFiniteNumber(entry.rrTp1) &&
			isFiniteNumber(entry.rrTp2) &&
			isFiniteNumber(entry.openedAt) &&
			(entry.manual === undefined || typeof entry.manual === 'boolean') &&
			(entry.protocol === undefined || typeof entry.protocol === 'boolean')
		);
	}
	function isTraderLeg(value: unknown): value is TraderLeg {
		if (!value || typeof value !== 'object') return false;
		const leg = value as Record<string, unknown>;
		return (
			typeof leg.traderId === 'string' &&
			TRADERS.some((trader) => trader.id === leg.traderId) &&
			(leg.side === 'long' || leg.side === 'short') &&
			isFiniteNumber(leg.leverage) &&
			typeof leg.symbol === 'string' &&
			typeof leg.exchangeSymbol === 'string' &&
			isFiniteNumber(leg.notionalUsd) &&
			isFiniteNumber(leg.entryMark) &&
			isFiniteNumber(leg.mark) &&
			isFiniteNumber(leg.unrealizedPnlUsd) &&
			isFiniteNumber(leg.unrealizedPnlPctMargin) &&
			typeof leg.sample === 'boolean'
		);
	}
	function loadNumericMap(value: unknown): Record<string, number> {
		if (!value || typeof value !== 'object') return {};
		const result: Record<string, number> = {};
		for (const [key, raw] of Object.entries(value)) {
			if (isFiniteNumber(raw)) result[key] = raw;
		}
		return result;
	}
	function clearBreakState() {
		try {
			localStorage.removeItem(BREAK_STATE_KEY);
		} catch {
			/* ignore unavailable storage */
		}
	}
	function saveBreakState() {
		const snapshot: PersistedBreakState = {
			version: 1,
			symbol: activeDisplay,
			savedAt: Date.now(),
			book,
			legs,
			reentryCooldowns,
			reassessUntil,
			riskDenied
		};
		try {
			localStorage.setItem(BREAK_STATE_KEY, JSON.stringify(snapshot));
		} catch {
			/* ignore unavailable or full storage */
		}
	}
	function restoreBreakState(symbol: string) {
		try {
			const raw = localStorage.getItem(BREAK_STATE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<PersistedBreakState>;
			if (parsed.version !== 1 || parsed.symbol !== symbol || !parsed.book || typeof parsed.book !== 'object') return;
			const restoredBook: OpenBook = {};
			for (const [traderId, entry] of Object.entries(parsed.book)) {
				if (TRADERS.some((trader) => trader.id === traderId) && isBookEntry(entry)) restoredBook[traderId] = entry;
			}
			book = restoredBook;
			legs = Array.isArray(parsed.legs) ? parsed.legs.filter(isTraderLeg) : [];
			reentryCooldowns = loadNumericMap(parsed.reentryCooldowns);
			reassessUntil = loadNumericMap(parsed.reassessUntil);
			riskDenied = Array.isArray(parsed.riskDenied)
				? parsed.riskDenied.filter((id): id is string => typeof id === 'string' && TRADERS.some((trader) => trader.id === id))
				: [];
			wallNow = Date.now();
			clearBreakState();
		} catch {
			clearBreakState();
		}
	}
	function takeBreak() {
		saveBreakState();
		void goto('/elevator?to=home');
	}
	// Closes the trader's position (organic or forced) with no P&L event and hands them back to their own
	// decision loop: they show a thinking cloud for a minute, then scan and enter on their own rules again.
	function releaseTrader(traderId: string) {
		if (!book[traderId]) return;
		const now = Date.now();
		const { [traderId]: _closed, ...rest } = book;
		book = rest;
		legs = legs.filter((leg) => leg.traderId !== traderId);
		reentryCooldowns = { ...reentryCooldowns, [traderId]: now + RELEASE_MS };
		reassessUntil = { ...reassessUntil, [traderId]: now + RELEASE_MS };
		wallNow = now;
	}
	// Closes every trader's simulated leg and gives the whole desk a minute of "rethinking" before
	// they resume scanning and entering on their own rules again.
	function resetAllTradersToThinking() {
		const now = Date.now();
		const resetUntil = Object.fromEntries(traders.map((trader) => [trader.id, now + RELEASE_MS]));
		book = {};
		legs = [];
		riskDenied = [];
		takeProfitFlashes = {};
		reentryCooldowns = resetUntil;
		reassessUntil = resetUntil;
		wallNow = now;
		clearBreakState();
	}
	// Play: the trader always takes a trade at the current mark (never backdated). The 4h protocol sets the
	// stop and the 2R target: grade A when the protocol would take it now, grade B when it is forced against
	// the rules, with the reason shown in a toast and on the desk.
	function startTrader(traderId: string) {
		const trader = traders.find((t) => t.id === traderId);
		const market = lastMarket;
		if (!trader || !market) return;
		if (!protocolMode(market.signal)) {
			setTraderTradeDuration(traderId, 0);
			return;
		}
		const now = Date.now();
		const mark = market.quote.mark || market.quote.price;
		const play = manualPlay(market.signal.protocol, trader.side, trader.leverage, mark, now);
		const setupBar = market.signal.protocol?.setup?.barTime;
		wallNow = now;
		const { [traderId]: _cleared, ...restNotes } = playNotes;
		playNotes = restNotes;
		if (reassessUntil[traderId]) reassessUntil = { ...reassessUntil, [traderId]: 0 };
		if (reentryCooldowns[traderId]) reentryCooldowns = { ...reentryCooldowns, [traderId]: 0 };
		const entry: BookEntry = {
			entryMark: mark,
			stop: play.stop,
			tp1: play.tp,
			tp2: play.tp,
			strategy: 'trend',
			rrTp1: PROTOCOL_RR,
			rrTp2: PROTOCOL_RR,
			openedAt: now,
			protocol: true
		};
		const def = resolveSymbol(activeDisplay);
		applyBookResult(
			reconcileBook({ ...book, [traderId]: entry }, market.signal, traders, mark, market.sample, def.display, def.bybit, false, { cooldown: activeCooldowns(now), now, usedSetups }),
			now
		);
		if (!book[traderId]) {
			pushToast('err', `${trader.name}: no se pudo abrir`, 'el libro rechazo la posicion');
			return;
		}
		if (play.grade === 'A' && setupBar !== undefined) usedSetups = { ...usedSetups, [traderId]: setupBar };
		const d = activeDef.decimals;
		pushToast(
			play.grade === 'A' ? 'ok' : 'info',
			`${trader.name} ${trader.side === 'long' ? 'LONG' : 'SHORT'} ${trader.leverage}x @ ${mark.toFixed(d)} [${play.grade}]`,
			`stop ${play.stop.toFixed(d)} (${(play.riskPct * 100).toFixed(2)}%) . TP ${play.tp.toFixed(d)} (2R) . ${play.note}`,
			7000
		);
	}
	function activeCooldowns(now: number): Set<string> {
		return new Set(traders.filter((trader) => (reentryCooldowns[trader.id] ?? 0) > now).map((trader) => trader.id));
	}
	function applyBookResult(result: ReturnType<typeof reconcileBook>, now: number) {
		book = result.book;
		if (Object.keys(result.protocolOpened).length) usedSetups = { ...usedSetups, ...result.protocolOpened };
		riskDenied = result.riskDenied;
		volHeld = result.volHeld;
		legs = result.legs;
		for (const profit of result.takeProfits) {
			showTakeProfit(profit.traderId, profit.pnlUsd, profit.target);
			reentryCooldowns = { ...reentryCooldowns, [profit.traderId]: now + 90_000 };
		}
		// Desks sit out after a stop-out instead of re-firing into the same tape.
		for (const traderId of result.stopOuts) {
			reentryCooldowns = { ...reentryCooldowns, [traderId]: now + 240_000 };
		}
		// A timed-out fade sits out a full candle before trying the idea again.
		for (const traderId of result.timeStops) {
			reentryCooldowns = { ...reentryCooldowns, [traderId]: now + 900_000 };
		}
	}
	function blofinBadgeFor(traderId: string): string | null {
		if (!deskSettings.showBlofinBadges) return null;
		if (blofinOverlay[traderId]) return blofinOverlay[traderId];
		const assigned = Object.entries(blofinAssignments)
			.filter(([, tid]) => tid === traderId)
			.map(([pid]) => pid);
		return assigned.length ? `BFx${assigned.length}` : null;
	}
	function openDeskConsole() {
		deskConsoleOpen = true;
	}
	function openMonitorPanel() {
		monitorPanelOpen = true;
	}

	function openDeskBook(id: DeskBookId) {
		deskBookId = id;
		deskBookOpen = true;
	}

	function openQuickTrade() {
		quickTradePresetTraderId = null;
		quickTradeOpen = true;
	}

	/** Floor trader click -> fund panel preset to that desk (also pins). */
	function openQuickTradeFor(traderId: string) {
		quickTradePresetTraderId = traderId;
		inspectedId = traderId;
		pinnedId = traderId;
		quickTradeOpen = true;
	}
	function openProfitCalc() {
		profitCalcOpen = true;
	}
	const DRAGGABLE_SETTING_KEYS = [
		'showClipboard',
		'showPricePad',
		'showFax',
		'showPet',
		'showTrash',
		'showCrtCart'
	] as const;

	function updateDeskSetting<K extends keyof DeskSettings>(key: K, value: DeskSettings[K]) {
		const next = { ...deskSettings, [key]: value };
		if ((DRAGGABLE_SETTING_KEYS as readonly string[]).includes(key)) {
			const allHidden = DRAGGABLE_SETTING_KEYS.every((setting) => !next[setting]);
			next.hideAllDraggables = allHidden;
		}
		deskSettings = next;
		saveDeskSettings(deskSettings);
	}

	function updateOfficeTheme(value: OfficeTheme) {
		updateDeskSetting('officeTheme', value);
	}

	function toggleHideAllDraggables() {
		const hide = !deskSettings.hideAllDraggables;
		const next = { ...deskSettings, hideAllDraggables: hide };
		for (const setting of DRAGGABLE_SETTING_KEYS) next[setting] = !hide;
		deskSettings = next;
		saveDeskSettings(deskSettings);
	}

	function openDeskSettings() {
		settingsOpen = true;
	}

	function triggerCoffeeTrip() {
		if (deskSettings.disableCoffeeTrip || deskSettings.reduceMotion) return;
		if (coffeeTripActive) return;
		coffeeTripActive = true;
		if (coffeeTripTimer) clearTimeout(coffeeTripTimer);
		const ms = 2000 + Math.floor(Math.random() * 2000); // 2"4s
		coffeeTripTimer = setTimeout(() => {
			coffeeTripActive = false;
			coffeeTripTimer = null;
		}, ms);
	}
	function postureFor(t: TraderDef) {
		return postureForTrader(t, signal, legFor(t.id), heldReason(t.id, legFor(t.id) != null));
	}
	function heldReason(id: string, hasLeg: boolean): string | null {
		if (hasLeg) return null;
		if ((playNotes[id]?.until ?? 0) > wallNow) return playNotes[id].note;
		if ((reassessUntil[id] ?? 0) > wallNow) return 'rethinking the trade';
		if (volHeld.includes(id)) return 'tape too wild for this leverage';
		return riskDenied.includes(id) ? 'risk desk: net cap' : null;
	}
	function showTakeProfit(traderId: string, pnlUsd: number, target: 'TP1' | 'TP2') {
		const expiresAt = Date.now() + 2800;
		takeProfitFlashes = { ...takeProfitFlashes, [traderId]: { pnlUsd, target, expiresAt } };
		window.setTimeout(() => {
			if (takeProfitFlashes[traderId]?.expiresAt !== expiresAt) return;
			const { [traderId]: _, ...rest } = takeProfitFlashes;
			takeProfitFlashes = rest;
		}, 2800);
	}
	function pin(id: string) {
		inspectedId = id;
		pinnedId = pinnedId === id ? null : id;
	}
	function inspectStaff(s: StaffDef) {
		inspectedId = s.id;
	}
	function setTraderLeverage(traderId: string, raw: number | string) {
		const n = Number(raw);
		if (!isLeverage(n)) return;
		const next: LeverageOverrides = { ...leverageOverrides, [traderId]: n };
		leverageOverrides = next;
		legs = legs.map((leg) =>
			leg.traderId === traderId
				? { ...leg, leverage: n, unrealizedPnlPctMargin: leg.unrealizedPnlUsd / (leg.notionalUsd / n) }
				: leg
		);
		saveLeverageOverrides(next);
		void pollMarket();
		pollNews();
		pollDeskPositions();
	}

	// Support/resistance zone around a 4h level: the band the trigger counts as a touch.
	function zoneText(level: number | undefined): string {
		const p = signal?.protocol;
		if (level == null || !p) return '-';
		const half = ZONE_ATR * p.atr;
		return `${fmt(level - half)} - ${fmt(level + half)}`;
	}
	function rsiText(rsi: number | undefined): string {
		if (rsi == null || !Number.isFinite(rsi)) return '-';
		return `${rsi.toFixed(1)} ${rsi >= RSI_OVERBOUGHT ? 'SOBRECOMPRA' : rsi <= RSI_OVERSOLD ? 'SOBREVENTA' : 'NEUTRO'}`;
	}
	function volText(ratio: number | undefined): string {
		if (ratio == null || !Number.isFinite(ratio)) return '-';
		return `${ratio.toFixed(2)}x ${ratio >= 1.5 ? 'CONFIRMA' : 'BAJO (<1.5x)'}`;
	}
	function fmt(n: number | undefined, digits = priceDecimals) {
		return n == null || !Number.isFinite(n) ? '-' : n.toFixed(digits);
	}
	function pnl(n: number | undefined) {
		if (n == null) return '-';
		return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
	}

	function clipboardBounds() {
		if (!sceneFrame || !clipboardRoot) return null;
		const width = clipboardRoot.offsetWidth;
		const height = clipboardRoot.offsetHeight;
		const maxLeft = Math.max(0, sceneFrame.clientWidth - width);
		const maxTop = Math.max(0, sceneFrame.clientHeight - height);
		return { maxLeft, maxTop };
	}

	function clampClipboard(left: number, top: number) {
		const bounds = clipboardBounds();
		if (!bounds) return { left, top };
		return {
			left: Math.min(Math.max(0, left), bounds.maxLeft),
			top: Math.min(Math.max(0, top), bounds.maxTop)
		};
	}

	function setClipboardPosition(left: number, top: number) {
		const next = clampClipboard(left, top);
		clipboardLeft = next.left;
		clipboardTop = next.top;
	}

	function placeClipboard() {
		if (!sceneFrame || !clipboardRoot || !officeFloor || !foregroundDesk || clipboardReady) return;
		const saved = loadScenePosition(CLIPBOARD_KEY);
		const narrow = sceneFrame.clientWidth <= 480;
		const mobileDefault = { left: 8, top: deskSurfaceOffsetTop() + 556 };
		const mobileMinTop = deskSurfaceOffsetTop();
		const source = narrow && (!saved || saved.top < mobileMinTop)
			? mobileDefault
			: { left: saved?.left ?? CLIPBOARD_DEFAULT.left, top: saved?.top ?? CLIPBOARD_DEFAULT.top };
		setClipboardPosition(source.left, source.top);
		clipboardReady = true;
	}

	function reflowClipboard() {
		// Positions are intentional user layout, so a viewport change must not move them.
	}

	function onClipboardPointerDown(event: PointerEvent) {
		if (!clipboardRoot || clipboardPointerId !== null) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest('a, button, input, select, textarea, [data-no-drag]')) return;

		event.preventDefault();
		const frameRect = sceneFrame?.getBoundingClientRect();
		const panelRect = clipboardRoot.getBoundingClientRect();
		const scaleX = frameRect && frameRect.width > 0 ? sceneFrame!.clientWidth / frameRect.width : 1;
		const scaleY = frameRect && frameRect.height > 0 ? sceneFrame!.clientHeight / frameRect.height : 1;
		clipboardOffsetX = (event.clientX - panelRect.left) * scaleX;
		clipboardOffsetY = (event.clientY - panelRect.top) * scaleY;
		clipboardPointerId = event.pointerId;
		clipboardDragging = true;
		clipboardRoot.setPointerCapture(event.pointerId);
	}

	function onClipboardPointerMove(event: PointerEvent) {
		if (!clipboardDragging || clipboardPointerId !== event.pointerId || !sceneFrame) return;
		const frameRect = sceneFrame.getBoundingClientRect();
		const scaleX = frameRect.width > 0 ? sceneFrame.clientWidth / frameRect.width : 1;
		const scaleY = frameRect.height > 0 ? sceneFrame.clientHeight / frameRect.height : 1;
		setClipboardPosition(
			(event.clientX - frameRect.left) * scaleX - clipboardOffsetX,
			(event.clientY - frameRect.top) * scaleY - clipboardOffsetY
		);
	}

	function stopClipboardDragging(event: PointerEvent) {
		if (!clipboardRoot || clipboardPointerId !== event.pointerId) return;
		if (clipboardDragging) {
			saveScenePosition(CLIPBOARD_KEY, { left: clipboardLeft, top: clipboardTop });
		}
		clipboardDragging = false;
		clipboardPointerId = null;
		if (clipboardRoot.hasPointerCapture(event.pointerId)) clipboardRoot.releasePointerCapture(event.pointerId);
	}

	function pricePadBounds() {
		if (!sceneFrame || !pricePadRoot) return null;
		const width = pricePadRoot.offsetWidth;
		const height = pricePadRoot.offsetHeight;
		return {
			maxLeft: Math.max(0, sceneFrame.clientWidth - width),
			maxTop: Math.max(0, sceneFrame.clientHeight - height)
		};
	}

	function clampPricePad(left: number, top: number) {
		const bounds = pricePadBounds();
		if (!bounds) return { left, top };
		return {
			left: Math.min(Math.max(0, left), bounds.maxLeft),
			top: Math.min(Math.max(0, top), bounds.maxTop)
		};
	}

	function setPricePadPosition(left: number, top: number) {
		const next = clampPricePad(left, top);
		pricePadLeft = next.left;
		pricePadTop = next.top;
	}

	function defaultPricePadPosition() {
		return PRICE_PAD_DEFAULT;
	}

	function mobilePricePadPosition() {
		if (!foregroundDesk) return defaultPricePadPosition();
		return { left: 12, top: deskSurfaceOffsetTop() + 448 };
	}

	function placePricePad() {
		if (!sceneFrame || !pricePadRoot || !foregroundDesk || pricePadPlaced) return;
		const fallback = defaultPricePadPosition();
		const narrow = sceneFrame.clientWidth <= 768;
		const source = narrow && (!pricePadSaved || pricePadSaved.top < deskSurfaceOffsetTop())
			? mobilePricePadPosition()
			: { left: pricePadSaved?.left ?? fallback.left, top: pricePadSaved?.top ?? fallback.top };
		setPricePadPosition(source.left, source.top);
		pricePadPlaced = true;
		pricePadReady = true;
	}

	function reflowPricePad() {
		// Positions are intentional user layout, so a viewport change must not move them.
	}

	function onPricePadPointerDown(event: PointerEvent) {
		if (!pricePadRoot || pricePadPointerId !== null) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest('a, button, input, select, textarea, [data-no-drag]')) return;

		event.preventDefault();
		const frameRect = sceneFrame?.getBoundingClientRect();
		const panelRect = pricePadRoot.getBoundingClientRect();
		const scaleX = frameRect && frameRect.width > 0 ? sceneFrame!.clientWidth / frameRect.width : 1;
		const scaleY = frameRect && frameRect.height > 0 ? sceneFrame!.clientHeight / frameRect.height : 1;
		pricePadOffsetX = (event.clientX - panelRect.left) * scaleX;
		pricePadOffsetY = (event.clientY - panelRect.top) * scaleY;
		pricePadPointerId = event.pointerId;
		pricePadDragging = true;
		pricePadRoot.setPointerCapture(event.pointerId);
	}

	function onPricePadPointerMove(event: PointerEvent) {
		if (!pricePadDragging || pricePadPointerId !== event.pointerId || !sceneFrame) return;
		const frameRect = sceneFrame.getBoundingClientRect();
		const scaleX = frameRect.width > 0 ? sceneFrame.clientWidth / frameRect.width : 1;
		const scaleY = frameRect.height > 0 ? sceneFrame.clientHeight / frameRect.height : 1;
		setPricePadPosition(
			(event.clientX - frameRect.left) * scaleX - pricePadOffsetX,
			(event.clientY - frameRect.top) * scaleY - pricePadOffsetY
		);
	}

	function stopPricePadDragging(event: PointerEvent) {
		if (!pricePadRoot || pricePadPointerId !== event.pointerId) return;
		if (pricePadDragging) {
			saveScenePosition(PRICE_PAD_KEY, { left: pricePadLeft, top: pricePadTop });
		}
		pricePadDragging = false;
		pricePadPointerId = null;
		if (pricePadRoot.hasPointerCapture(event.pointerId)) pricePadRoot.releasePointerCapture(event.pointerId);
	}


	function deskSurfaceOffsetTop() {
		// Desk-prop left/top are scene-frame-relative (see clampDeskProp), but offsetTop is
		// relative to foregroundDesk's own offsetParent, which is not always sceneFrame - that
		// mismatch placed the mobile "row below the CRT" on top of the CRT instead.
		if (!foregroundDesk || !sceneFrame) return foregroundDesk?.offsetTop ?? 0;
		return foregroundDesk.getBoundingClientRect().top - sceneFrame.getBoundingClientRect().top;
	}

	function clampDeskProp(id: DeskPropId, left: number, top: number) {
		const parent = sceneFrame;
		const el = deskPropEls[id];
		if (!parent || !el) return { left, top };
		return {
			left: Math.min(Math.max(0, left), Math.max(0, parent.clientWidth - el.offsetWidth)),
			top: Math.min(Math.max(0, top), Math.max(0, parent.clientHeight - el.offsetHeight))
		};
	}

	function setDeskPropPos(id: DeskPropId, left: number, top: number) {
		const next = clampDeskProp(id, left, top);
		deskProps = {
			...deskProps,
			[id]: { ...deskProps[id], left: next.left, top: next.top }
		};
	}

	function saveCurrentDeskLayoutAsDefault() {
		const deskTop = deskSurfaceOffsetTop();
		for (const id of Object.keys(DESK_PROP_DEFAULTS) as DeskPropId[]) {
			saveScenePosition(DESK_PROP_DEFAULT_KEYS[id], {
				left: deskProps[id].left,
				top: deskProps[id].top - deskTop
			});
		}
	}

	function mobileDeskPropLayout(): Record<DeskPropId, { left: number; top: number }> {
		const deskTop = deskSurfaceOffsetTop();
		const mobileTop = deskTop + 224;
		const phone = (sceneFrame?.clientWidth ?? 0) <= 480;
		if (!phone || !sceneFrame) {
			return {
				wsj: { left: 8, top: mobileTop },
				legal: { left: 150, top: mobileTop },
				keyboard: { left: 8, top: mobileTop + 116 },
				pad: { left: 154, top: mobileTop + 116 },
				calc: { left: 250, top: mobileTop + 116 },
				coffee: { left: 306, top: mobileTop + 116 },
				set: { left: 356, top: mobileTop + 116 },
				break: { left: 356, top: mobileTop + 172 }
			};
		}
		const width = sceneFrame.clientWidth;
		return {
			wsj: { left: 8, top: mobileTop },
			legal: { left: Math.max(8, width - 113), top: mobileTop },
			keyboard: { left: 8, top: mobileTop + 116 },
			pad: { left: 154, top: mobileTop + 116 },
			calc: { left: Math.max(8, width - 44), top: mobileTop + 116 },
			coffee: { left: 8, top: mobileTop + 172 },
			set: { left: 50, top: mobileTop + 172 },
			break: { left: 92, top: mobileTop + 172 }
		};
	}

	function placeDeskProp(id: DeskPropId) {
		// Recompute freely until the desk layout settles (see deskLayoutSettled); once settled,
		// an already-placed prop is locked in and a resize alone will not move it again.
		if ((deskLayoutSettled && deskProps[id].placed) || !deskPropEls[id] || !sceneFrame || !foregroundDesk) return;
		const saved = loadScenePosition(DESK_PROP_KEYS[id]);
		const narrow = sceneFrame.clientWidth <= 768;
		const deskTop = deskSurfaceOffsetTop();
		const mobileLayout = mobileDeskPropLayout();
		const savedDefault = loadScenePosition(DESK_PROP_DEFAULT_KEYS[id]);
		// Earlier builds stored default positions in scene coordinates. Normalize
		// those once while keeping new defaults desk-relative.
		const defaultTop = savedDefault
			? (savedDefault.top >= deskTop ? savedDefault.top - deskTop : savedDefault.top)
			: DESK_PROP_DEFAULTS[id].top;
		const fallback = {
			left: savedDefault?.left ?? DESK_PROP_DEFAULTS[id].left,
			top: defaultTop + deskTop
		};
		// Migrate legacy desk-local saves (tops lived in the ~150px foreground strip).
		let left = saved?.left ?? fallback.left;
		let top = saved?.top ?? fallback.top;
		if (narrow && (!saved || saved.left >= sceneFrame.clientWidth || saved.top < deskTop || saved.top > deskTop + foregroundDesk.clientHeight)) {
			left = mobileLayout[id].left;
			top = mobileLayout[id].top;
		}
		if (saved && saved.top <= 160 && deskTop > 0) {
			top = saved.top + deskTop;
		}
		setDeskPropPos(id, left, top);
		deskProps = {
			...deskProps,
			[id]: { ...deskProps[id], placed: true, ready: true }
		};
	}

	function placeAllDeskProps() {
		(Object.keys(DESK_PROP_DEFAULTS) as DeskPropId[]).forEach(placeDeskProp);
	}

	function reflowDeskProps() {
		// Positions are intentional user layout, so a viewport change must not move them.
	}

	/** Click-vs-drag: arm on pointerdown; drag after >4px or 200ms hold. */
	const deskDragMeta: Partial<
		Record<
			DeskPropId,
			{
				pointerId: number | null;
				offsetX: number;
				offsetY: number;
				startX: number;
				startY: number;
				armed: boolean;
				holdTimer: ReturnType<typeof setTimeout> | null;
			}
		>
	> = {};

	function deskDragMetaFor(id: DeskPropId) {
		if (!deskDragMeta[id]) {
			deskDragMeta[id] = {
				pointerId: null,
				offsetX: 0,
				offsetY: 0,
				startX: 0,
				startY: 0,
				armed: false,
				holdTimer: null
			};
		}
		return deskDragMeta[id]!;
	}

	function beginDeskDrag(id: DeskPropId, event: PointerEvent) {
		const el = deskPropEls[id];
		const parent = sceneFrame;
		const meta = deskDragMetaFor(id);
		if (!el || !parent) return;
		const parentRect = parent.getBoundingClientRect();
		const panelRect = el.getBoundingClientRect();
		const scaleX = parentRect.width > 0 ? parent.clientWidth / parentRect.width : 1;
		const scaleY = parentRect.height > 0 ? parent.clientHeight / parentRect.height : 1;
		meta.offsetX = (event.clientX - panelRect.left) * scaleX;
		meta.offsetY = (event.clientY - panelRect.top) * scaleY;
		deskProps = {
			...deskProps,
			[id]: { ...deskProps[id], dragging: true, suppressClick: true }
		};
		el.setPointerCapture(event.pointerId);
	}

	function onDeskPropPointerDown(id: DeskPropId, event: PointerEvent) {
		const el = deskPropEls[id];
		const meta = deskDragMetaFor(id);
		if (!el || meta.pointerId !== null) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		meta.pointerId = event.pointerId;
		meta.armed = true;
		meta.startX = event.clientX;
		meta.startY = event.clientY;
		deskProps = {
			...deskProps,
			[id]: { ...deskProps[id], suppressClick: false }
		};
		/* Paper/legal: movement-only drag so a click can expand. Tools: also allow 200ms hold. */
		if (id !== 'wsj' && id !== 'legal') {
			meta.holdTimer = setTimeout(() => {
				if (meta.armed && meta.pointerId === event.pointerId && !deskProps[id].dragging) {
					beginDeskDrag(id, event);
				}
			}, 200);
		}
	}

	function onDeskPropPointerMove(id: DeskPropId, event: PointerEvent) {
		const meta = deskDragMetaFor(id);
		const parent = sceneFrame;
		if (meta.pointerId !== event.pointerId || !meta.armed || !parent) return;
		const dx = event.clientX - meta.startX;
		const dy = event.clientY - meta.startY;
		if (!deskProps[id].dragging && Math.hypot(dx, dy) > 4) {
			if (meta.holdTimer) {
				clearTimeout(meta.holdTimer);
				meta.holdTimer = null;
			}
			beginDeskDrag(id, event);
		}
		if (!deskProps[id].dragging) return;
		event.preventDefault();
		const parentRect = parent.getBoundingClientRect();
		const scaleX = parentRect.width > 0 ? parent.clientWidth / parentRect.width : 1;
		const scaleY = parentRect.height > 0 ? parent.clientHeight / parentRect.height : 1;
		setDeskPropPos(
			id,
			(event.clientX - parentRect.left) * scaleX - meta.offsetX,
			(event.clientY - parentRect.top) * scaleY - meta.offsetY
		);
	}

	function onDeskPropPointerUp(id: DeskPropId, event: PointerEvent) {
		const meta = deskDragMetaFor(id);
		const el = deskPropEls[id];
		if (meta.pointerId !== event.pointerId) return;
		if (meta.holdTimer) {
			clearTimeout(meta.holdTimer);
			meta.holdTimer = null;
		}
		if (deskProps[id].dragging) {
			saveScenePosition(DESK_PROP_KEYS[id], {
				left: deskProps[id].left,
				top: deskProps[id].top
			});
		}
		deskProps = {
			...deskProps,
			[id]: { ...deskProps[id], dragging: false }
		};
		meta.armed = false;
		meta.pointerId = null;
		if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
	}

	function deskPropAction(node: HTMLElement, id: DeskPropId) {
		bindDeskProp(id, node);
		return {
			destroy() {
				delete deskPropEls[id];
			}
		};
	}

	function bindDeskProp(id: DeskPropId, node: HTMLElement) {
		deskPropEls[id] = node;
		// Initial placement runs from the ResizeObserver effect below, once foregroundDesk/sceneFrame
		// are bound - placing here too raced content that loads above the desk and shifts it down,
		// baking in a stale offset that the "never move after placement" guard then made permanent.
	}

	function deskPropClick(id: DeskPropId, action: () => void) {
		if (deskProps[id].suppressClick) {
			deskProps = {
				...deskProps,
				[id]: { ...deskProps[id], suppressClick: false }
			};
			return;
		}
		action();
	}

	function setWireCategory(cat: SymbolCategory | 'all') {
		wireCategory = cat;
		queueMicrotask(() => {
			if (!wireChannels.some((s) => s.display === activeDisplay) && wireChannels[0]) {
				selectWireTicker(wireChannels[0].display);
			}
		});
	}

	function setWireMarket(market: 'futures' | 'spot') {
		if (market === wireMarket) return;
		wireMarket = market;
		tapePending = true;
		tapeFailures = 0;
		tapeRetryAt = 0;
		tapeController?.abort();
		try {
			localStorage.setItem(WIRE_MARKET_KEY, market);
		} catch {
			/* ignore */
		}
		void pollTape(market);
	}

	function wireLabel(display: string, q?: QuoteResponse): string {
		return q?.label ? `${q.label} . ${q.venue ?? 'WIRE'}` : wireMarket === 'spot' ? spotWireSymbol(display) : resolveSymbol(display).label;
	}

	function wireDecimals(display: string, price: number, q?: QuoteResponse): number {
		if (q?.decimals != null) return q.decimals;
		const known = SYMBOLS.find((s) => s.display === display);
		if (known) return known.decimals;
		return price < 1 ? 8 : 4;
	}

	function selectWireTicker(display: string) {
		setSymbol(display);
	}

	async function pollTape(market = wireMarket) {
		if (marketDisposed || tapeController || Date.now() < tapeRetryAt) return;
		tapePending = false;
		const controller = new AbortController();
		tapeController = controller;
		const timeout = setTimeout(() => controller.abort(new Error('Request timed out after 20 seconds')), 20_000);
		const request = ++tapeRequest;
		try {
			const res = await marketFetch(`/api/market/tape?market=${market}`, controller.signal);
			const tape = (await res.json()) as { market?: 'futures' | 'spot'; quotes?: QuoteResponse[] };
			if (marketDisposed || tapePending || request !== tapeRequest || market !== wireMarket) return;
			tapeQuotes = tape.quotes ?? [];
			tapeFailures = 0;
			tapeRetryAt = 0;
			tapeError = null;
		} catch (e) {
			if (marketDisposed || tapePending || request !== tapeRequest || market !== wireMarket) return;
			tapeQuotes = [];
			tapeFailures++;
			tapeRetryAt = Date.now() + Math.min(120_000, 10_000 * 2 ** Math.min(tapeFailures, 4));
			tapeError = e instanceof Error ? e.message : 'Market Wire unavailable';
		} finally {
			clearTimeout(timeout);
			controller.abort();
			tapeController = null;
			if (!marketDisposed && (tapePending || market !== wireMarket)) void pollTape();
		}
	}

	async function pollNews() {
		const sym = activeDisplay;
		try {
			const res = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}`);
			if (!res.ok) throw new Error('news HTTP');
			const data = (await res.json()) as {
				sample?: boolean;
				headlines?: { title: string; link: string; source: string }[];
			};
			if (sym !== activeDisplay) return;
			const incoming = (data.headlines ?? []).slice(0, 5).map((h) => ({
				title: h.title,
				link: h.link ?? '',
				source: h.source ?? ''
			}));
			newsHeadlines = incoming.length ? incoming : sampleDeskHeadlines(activeDef.label);
			newsSample = !!data.sample || incoming.length === 0;
		} catch {
			if (sym !== activeDisplay) return;
			newsSample = true;
			newsHeadlines = sampleDeskHeadlines(activeDef.label);
		}
	}

	async function pollDeskPositions() {
		const lines: DeskPosLine[] = [];
		let note: string | null = null;
		try {
			const [bfRes, byRes] = await Promise.all([
				exchangeFetch('/api/blofin/positions'),
				exchangeFetch('/api/bybit/positions')
			]);
			if (bfRes.ok) {
				const bf = (await bfRes.json()) as {
					ok?: boolean;
					sample?: boolean;
					error?: string;
					positions?: Array<{
						instId: string;
						side: string;
						size: number;
						leverage: number;
					}>;
				};
				if (!bf.ok && bf.error) {
					if (/403|network|block|cloudfront|country/i.test(bf.error)) {
						note = 'BF network blocked';
					} else if (!bf.sample) {
						note = `BF: ${bf.error}`;
					}
				}
				for (const p of bf.positions ?? []) {
					if (!p.size || p.side === 'flat') continue;
					const sym = String(p.instId ?? '').replace(/-USDT|_USDT|USDT/gi, '') || p.instId;
					lines.push({
						venue: 'BF',
						text: `${sym} ${String(p.side).toUpperCase()} ${p.size}x ${p.leverage}x`
					});
				}
			} else if (bfRes.status === 403 || bfRes.status === 503) {
				note = 'BF network blocked';
			}
			if (byRes.ok || byRes.status === 503) {
				const by = (await byRes.json()) as {
					ok?: boolean;
					note?: string;
					error?: string;
					positions?: Array<{
						symbol: string;
						deskSide: string;
						size: number;
						leverage: number;
					}>;
				};
				if (by.note && !note) note = by.note;
				for (const p of by.positions ?? []) {
					if (!p.size || p.deskSide === 'flat') continue;
					const sym = String(p.symbol ?? '').replace(/USDT$/i, '');
					lines.push({
						venue: 'BY',
						text: `${sym} ${String(p.deskSide).toUpperCase()} ${p.size}x ${p.leverage}x`
					});
				}
			}
		} catch {
			if (!note) note = 'Positions unreachable';
		}
		deskPosLines = lines;
		deskPosNote = note;
	}


	function persistSymbol(display: string) {
		try {
			localStorage.setItem(STORAGE_KEY, display);
		} catch {
			/* ignore */
		}
		const url = new URL(window.location.href);
		url.searchParams.set('symbol', display);
		history.replaceState(null, '', url);
	}

	function setSymbol(display: string) {
		const def = resolveSymbol(display);
		if (def.display === activeDisplay) return;
		activeDisplay = def.display;
		book = {};
		riskDenied = [];
		legs = [];
		reentryCooldowns = {};
		takeProfitFlashes = {};
		reassessUntil = {};
		clearBreakState();
		lastDecisionCandle = 0;
		lastMarket = null;
		quote = null;
		signal = null;
		bars = [];
		newsHeadlines = sampleDeskHeadlines(def.label);
		newsSample = true;
		persistSymbol(def.display);
		refreshMarket();
		pollNews();
		pollDeskPositions();
	}

	function onChannelChange(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		selectWireTicker(v);
	}

	const MARKET_POLL_MS = 10_000;
	let marketTimer: ReturnType<typeof setTimeout> | null = null;
	let marketController: AbortController | null = null;
	let marketFailures = 0;
	let marketPending = false;
	let marketDisposed = false;

	async function marketFetch(path: string, abortSignal: AbortSignal): Promise<Response> {
		try {
			const res = await fetch(path, { signal: abortSignal });
			if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
			return res;
		} catch (e) {
			throw new Error(`${path.split('?')[0]}: ${e instanceof Error ? e.message : 'Request failed'}`);
		}
	}

	function refreshMarket() {
		marketFailures = 0;
		marketPending = true;
		marketController?.abort();
		void pollMarket();
	}

	async function pollMarket() {
		if (marketDisposed || marketController) return;
		if (marketTimer) clearTimeout(marketTimer);
		marketTimer = null;
		marketPending = false;
		const controller = new AbortController();
		marketController = controller;
		const timeout = setTimeout(() => controller.abort(new Error('Request timed out after 20 seconds')), 20_000);
		const request = ++marketRequest;
		const sym = activeDisplay;
		void pollTape();
		try {
			const [qRes, sRes, cRes] = await Promise.all([
				marketFetch(`/api/market/quote?symbol=${encodeURIComponent(sym)}`, controller.signal),
				marketFetch(`/api/market/signal?symbol=${encodeURIComponent(sym)}`, controller.signal),
				marketFetch(`/api/market/candles?symbol=${encodeURIComponent(sym)}&tf=15m&limit=80`, controller.signal)
			]);
			const [q, s, candles] = await Promise.all([
				qRes.json() as Promise<QuoteResponse>, sRes.json() as Promise<SignalResponse>, cRes.json() as Promise<CandlesResponse>
			]);
			// Ignore stale responses if user switched mid-flight
			if (marketDisposed || marketPending || request !== marketRequest || sym !== activeDisplay) return;
			quote = q;
			signal = s;
			bars = candles.bars;
			const mark = q.mark || q.price;
			if (!Number.isFinite(mark) || mark <= 0) throw new Error('Invalid mark price from the tape');
			const def = resolveSymbol(sym);
			const now = Date.now();
			lastMarket = candles.bars.length ? { signal: s, quote: q, bars: candles.bars, sample: q.sample || s.sample || candles.sample } : null;
			const decisionCandle = completedBars(bars, 15 * 60_000).at(-1)?.t ?? 0;
			const decisionPoint = decisionCandle !== 0 && decisionCandle !== lastDecisionCandle;
			const result = reconcileBook(
				book,
				s,
				traders,
				mark,
				q.sample || s.sample || candles.sample,
				def.display,
				def.bybit,
				decisionPoint,
				{ cooldown: activeCooldowns(now), now, usedSetups }
			);
			if (decisionPoint) lastDecisionCandle = decisionCandle;
			applyBookResult(result, now);
			wallNow = now;
			marketFailures = 0;
			err = null;
		} catch (e) {
			if (marketDisposed || marketPending || request !== marketRequest || sym !== activeDisplay) return;
			quote = null;
			signal = null;
			bars = [];
			wallNow = Date.now();
			// Keep the last known cast legs through a transient tape failure. A
			// missing poll is not a closed-candle invalidation and should not
			// turn open traders into thinking or watching traders.
			marketFailures++;
			const retrySeconds = Math.min(120, 10 * 2 ** Math.min(marketFailures, 4));
			err = `${e instanceof Error ? e.message : 'Market poll failed'}; retrying in ${retrySeconds}s`;
		} finally {
			clearTimeout(timeout);
			controller.abort();
			marketController = null;
			if (!marketDisposed) {
				if (marketPending || sym !== activeDisplay) void pollMarket();
				else marketTimer = setTimeout(() => { void pollMarket(); }, Math.min(120_000, MARKET_POLL_MS * 2 ** Math.min(marketFailures, 4)));
			}
			// The first poll to resolve (success or failure) is what settles the layout above
			// the foreground desk; let the desk-prop placement debounce know it can start.
			if (!marketDisposed && !firstMarketPollDone) {
				firstMarketPollDone = true;
				requestAnimationFrame(() => requestAnimationFrame(updateDeskTop));
			}
		}
	}

	onMount(() => {
		deskSettings = loadDeskSettings();
		let initial = DEFAULT_DISPLAY;
		try {
			const params = new URLSearchParams(window.location.search);
			const fromUrl = params.get('symbol');
			const fromStore = localStorage.getItem(STORAGE_KEY);
			const candidate = (fromUrl || fromStore || DEFAULT_DISPLAY).toUpperCase();
			initial = SYMBOLS.some((s) => s.display === candidate)
				? resolveSymbol(candidate).display
				: /^[A-Z0-9]+USDT$/.test(candidate)
					? candidate
					: DEFAULT_DISPLAY;
		} catch {
			initial = DEFAULT_DISPLAY;
		}
		activeDisplay = initial;
		restoreBreakState(initial);
		newsHeadlines = sampleDeskHeadlines(resolveSymbol(initial).label);
		newsSample = true;
		try {
			const storedMarket = localStorage.getItem(WIRE_MARKET_KEY);
			if (storedMarket === 'spot' || storedMarket === 'futures') wireMarket = storedMarket;
		} catch {
			/* ignore */
		}
		persistSymbol(initial);

		let raf = 0;
		let last = performance.now();
		marketDisposed = false;
		leverageOverrides = loadLeverageOverrides();
		blofinAssignments = loadBloFinAssignments();
		pricePadSaved = loadScenePosition(PRICE_PAD_KEY);
		for (const id of Object.keys(WIRE_DECOR_KEYS) as WireDecorId[]) {
			const saved = loadScenePosition(WIRE_DECOR_KEYS[id]);
			if (saved) wireDecorPositions = { ...wireDecorPositions, [id]: { ...wireDecorPositions[id], ...saved } };
		}
		const onSceneResize = () => {
			foregroundDeskTop = deskSurfaceOffsetTop();
		};
		window.addEventListener('resize', onSceneResize);
		requestAnimationFrame(clampWireDecorToScene);
		requestAnimationFrame(placeLoungeDecor);
		requestAnimationFrame(placeOfficeFlag);
		void (async () => {
			const asg = blofinAssignments;
			if (!Object.keys(asg).length) return;
			try {
				const res = await exchangeFetch('/api/blofin/positions');
				const data = await res.json();
				const positions = Array.isArray(data?.positions) ? data.positions : [];
				const byPos = new Map(positions.map((pos: { positionId: string; instId: string; side: string }) => [pos.positionId, pos]));
				const overlay: Record<string, string> = {};
				for (const [positionId, traderId] of Object.entries(asg)) {
					const pos = byPos.get(positionId) as { instId: string; side: string } | undefined;
					const label = pos
						? `${pos.instId} ${pos.side === 'flat' ? '' : String(pos.side).toUpperCase()}`.trim()
						: `BFx1`;
					overlay[traderId] = overlay[traderId] ? `${overlay[traderId]} . ${label}` : label;
				}
				blofinOverlay = overlay;
			} catch {
				/* ignore - console will refresh */
			}
		})();
		pollMarket();
		const loop = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			totalSimMinutes += dt * SIM_MINUTES_PER_REAL_SECOND;
			clock = applyForcedChristmasSnow(tickSimClock(clock, dt, totalSimMinutes), deskSettings.forceChristmasSnow);
			const pulse = Math.floor(now / 350);
			const animPulse = pulse !== lastUfoPulse;
			if (animPulse) lastUfoPulse = pulse;
			ufo = tickUfo(ufo, clock.phase, totalSimMinutes, animPulse);
			mariachi = tickMariachi(mariachi, clock.phase, totalSimMinutes, animPulse);
			animTick = Math.floor(now / 2800);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		const newsPollTimer = setInterval(() => { void pollNews(); }, 60_000);
		void pollNews();
		void pollDeskPositions();
		const posPollTimer = setInterval(() => { void pollDeskPositions(); }, 18_000);
		return () => {
			marketDisposed = true;
			if (marketTimer) clearTimeout(marketTimer);
			marketController?.abort();
			tapeController?.abort();
			cancelAnimationFrame(raf);
			marketRequest++;
			tapeRequest++;
			clearInterval(newsPollTimer);
			clearInterval(posPollTimer);
			window.removeEventListener('resize', onSceneResize);
		};
	});
	$effect(() => {
		if (!clipboardRoot || !sceneFrame) return;
		requestAnimationFrame(() => {
			if (!clipboardRoot || !sceneFrame) return;
			placeClipboard();
		});
	});
	$effect(() => {
		if (!pricePadRoot || !sceneFrame) return;
		requestAnimationFrame(() => {
			if (!pricePadRoot || !sceneFrame) return;
			placePricePad();
		});
	});
	function updateDeskTop() {
		if (!sceneFrame || !foregroundDesk) return;
		foregroundDeskTop = deskSurfaceOffsetTop();
		placeAllDeskProps();
		// Don't even start the settle countdown until the first market poll has resolved
		// (success or failure) - that fetch is what actually grows the content above the
		// desk, and it can take well over a second, far longer than a short fixed debounce.
		if (!deskLayoutSettled && firstMarketPollDone) {
			clearTimeout(deskSettleTimer);
			deskSettleTimer = setTimeout(() => { deskLayoutSettled = true; }, 600);
		}
	}
	$effect(() => {
		if (!sceneFrame || !foregroundDesk) return;
		const observer = new ResizeObserver(updateDeskTop);
		// foregroundDesk's own box is a fixed height at most breakpoints, so watch sceneFrame too -
		// content loading above the desk (market data filling in empty panels) grows sceneFrame's
		// height and pushes the desk down without foregroundDesk's own size ever changing.
		observer.observe(foregroundDesk);
		observer.observe(sceneFrame);
		requestAnimationFrame(updateDeskTop);
		return () => { observer.disconnect(); clearTimeout(deskSettleTimer); };
	});
	$effect(() => {
		if (!sceneFrame || !officeFlagEl) return;
		requestAnimationFrame(placeOfficeFlag);
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			if (legalPadExpanded) legalPadExpanded = false;
			else if (settingsOpen) settingsOpen = false;
			else pinnedId = null;
		}
	}}
/>

<main
	class="scene"
	data-theme={deskSettings.officeTheme}
	class:reduce-motion={deskSettings.reduceMotion}
	class:night-tint={deskSettings.nightModeTint}
	class:crt-scan={deskSettings.crtScanlines} data-phase={clock.phase}>
	<div class="scene-frame" bind:this={sceneFrame}>
		<section class="upper-wall">
			<div class="wall-panel left-wall">
				<div class="fund-sign">
					<div class="monogram">PHF</div>
					<div>
						<strong>PIXEL HEDGE FUND</strong><small>DISCIPLINE . RESEARCH . RETURNS</small>
					</div>
				</div>
				<div class="whiteboard">
					<h3>TODAY:</h3>
					<p>[ ] Review {activeDef.label} regime</p>
					<p>[ ] Check ST risk stops</p>
					<p>[ ] Rebalance allocation</p>
					<p>[ ] Watch funding / tape</p>
					<b>-> SMALL EDGE COMPOUNDS</b>
				</div>
			</div>

			<div class="window-wall" aria-label={`Panoramic ${deskSettings.officeTheme === 'miami-vice' ? 'Miami Vice' : 'New York'} skyline at sunset`}>
				<!-- Render the view once so the skyline, sun, and ESB span all panes. -->
				<div class="panoramic-skyline">
					<Skyline
						phase={clock.phase}
						outdoorLux={clock.outdoorLux}
						raining={clock.raining}
						snowing={clock.snowing}
						theme={deskSettings.officeTheme}
						ufoActive={ufo.active}
						ufoFrame={ufo.frame}
						reduceMotion={deskSettings.reduceMotion}
					/>
					<RainLayer intensity={clock.rainIntensity} />
					<SnowLayer intensity={clock.snowIntensity} reduceMotion={deskSettings.reduceMotion} />
				</div>
				{#each [0, 1, 2] as pane}
					<div class="window-pane">
						<div class="glass-glare"></div>
					</div>
				{/each}
				<StickyNotes />
			</div>

			<div class="wall-panel right-wall">
				<div class="market-board">
					<header>
						<span>MARKET WIRE . {wireMarket.toUpperCase()}</span>
						<i class:wire-sample={wireSample} class:wire-live={!wireSample} aria-label={wireSample ? 'Sample market data' : 'Live market data'}>
							{wireSample ? 'SAMPLE' : 'LIVE'}
						</i>
					</header>

					<div class="wire-cats" role="tablist" aria-label="Wire categories">
						{#each SYMBOL_CATEGORIES as cat (cat.id)}
							<button
								type="button"
								role="tab"
								class="wire-cat"
								class:active={wireCategory === cat.id}
								aria-selected={wireCategory === cat.id}
								onclick={() => setWireCategory(cat.id)}
							>{cat.label}</button>
						{/each}
					</div>
					<div class="wire-market-toggle" role="group" aria-label="Market Wire venue">
						<span>VENUE</span>
						<button type="button" class:active={wireMarket === 'futures'} onclick={() => setWireMarket('futures')}>FUTURES</button>
						<button type="button" class:active={wireMarket === 'spot'} onclick={() => setWireMarket('spot')}>SPOT</button>
					</div>
					<label class="channel-switch">
						<span>CHANNEL</span>
						<select value={activeDisplay} onchange={onChannelChange} aria-label="Active trading symbol">
							{#if !wireChannels.some((s) => s.display === activeDisplay)}
								<option value={activeDisplay}>{activeDisplay} (selected)</option>
							{/if}
							{#each wireChannels as s (s.display)}
								<option value={s.display}>{s.label} . {s.display}</option>
							{/each}
						</select>
					</label>
					{#if (wireCategory === 'etf' || wireCategory === 'stock') && !filteredTapeQuotes.length}
						<p class="wire-note">No live ETF/stock perps on desk venues - tabs reserved.</p>
					{/if}
					{#if wireMarket === 'futures'}
						<p class="wire-note">TOP 20 VOLUME . BYBIT + BLOFIN</p>
					{/if}
					{#if wireMarket === 'spot' && wireTokenQuotes.length === 0}
						<p class="wire-note">No live leveraged spot tokens returned by Bybit right now . checked SHIB3L / SHIB3S / SHIB5L / SHIB5S.</p>
					{:else if wireMarket === 'spot'}
						<div class="wire-token-heading">LEVERAGED SPOT TOKENS</div>
						{#each wireTokenQuotes as tq (tq.display)}
							<div class="wire-token-row">
								<b>{wireLabel(tq.display, tq)}</b>
								<strong>{tq.price.toFixed(wireDecimals(tq.display, tq.price, tq))}</strong>
								<em class:down={(tq.change24h ?? 0) < 0}>{tq.change24h == null ? '-' : `${tq.change24h >= 0 ? '+' : ''}${tq.change24h.toFixed(1)}%`}</em>
							</div>
						{/each}
					{/if}
					<div class="wire-quote-list">
					{#each filteredTapeQuotes.slice(0, 20) as tq (tq.display)}
						<button
							type="button"
							class="wire-quote-row"
							class:active={tq.display === activeDisplay}
							aria-pressed={tq.display === activeDisplay}
							onclick={() => selectWireTicker(tq.display)}
						>
							<b>{wireLabel(tq.display, tq)}</b>
							<strong>{tq.price.toFixed(wireDecimals(tq.display, tq.price, tq))}</strong>
							<em class:down={(tq.change24h ?? 0) < 0}
								>{tq.change24h == null
									? '-'
									: `${tq.change24h >= 0 ? '+' : ''}${tq.change24h.toFixed(1)}%`}</em
							>
						</button>
					{/each}
					</div>
				</div>
			</div>
		</section>
		<div
			class="horse wire-decor-piece"
			class:is-dragging={wireDecorPositions.horse.dragging}
			hidden={deskSettings.hideAllDraggables}
			use:bindWireDecor={'horse'}
			style={`left: ${wireDecorPositions.horse.left}px; top: ${wireDecorPositions.horse.top}px;`}
			role="button" tabindex="0" aria-label="Drag market horse decoration" title="Drag market horse"
			onpointerdown={(e) => onWireDecorPointerDown('horse', e)}
			onpointermove={(e) => onWireDecorPointerMove('horse', e)}
			onpointerup={(e) => onWireDecorPointerUp('horse', e)}
			onpointercancel={(e) => onWireDecorPointerUp('horse', e)}
			onlostpointercapture={(e) => onWireDecorPointerUp('horse', e)}
			onkeydown={(e) => onWireDecorKeyDown('horse', e)}
		><span class="horse-head" aria-hidden="true">♞</span></div>
		<div
			class="cabinet wire-decor-piece"
			class:is-dragging={wireDecorPositions.cabinet.dragging}
			hidden={deskSettings.hideAllDraggables}
			use:bindWireDecor={'cabinet'}
			style={`left: ${wireDecorPositions.cabinet.left}px; top: ${wireDecorPositions.cabinet.top}px;`}
			role="button" tabindex="0" aria-label="Drag market cabinet decoration" title="Drag market cabinet"
			onpointerdown={(e) => onWireDecorPointerDown('cabinet', e)}
			onpointermove={(e) => onWireDecorPointerMove('cabinet', e)}
			onpointerup={(e) => onWireDecorPointerUp('cabinet', e)}
			onpointercancel={(e) => onWireDecorPointerUp('cabinet', e)}
			onlostpointercapture={(e) => onWireDecorPointerUp('cabinet', e)}
			onkeydown={(e) => onWireDecorKeyDown('cabinet', e)}
		><i></i><i></i><i></i></div>
		<div
			class="plant tall wire-decor-piece"
			class:is-dragging={wireDecorPositions.plant.dragging}
			hidden={deskSettings.hideAllDraggables}
			use:bindWireDecor={'plant'}
			style={`left: ${wireDecorPositions.plant.left}px; top: ${wireDecorPositions.plant.top}px;`}
			role="button" tabindex="0" aria-label="Drag market plant decoration" title="Drag market plant"
			onpointerdown={(e) => onWireDecorPointerDown('plant', e)}
			onpointermove={(e) => onWireDecorPointerMove('plant', e)}
			onpointerup={(e) => onWireDecorPointerUp('plant', e)}
			onpointercancel={(e) => onWireDecorPointerUp('plant', e)}
			onlostpointercapture={(e) => onWireDecorPointerUp('plant', e)}
			onkeydown={(e) => onWireDecorKeyDown('plant', e)}
		><i></i><i></i><i></i></div>

		<div class="ticker-anchor">
			<TickerTape quotes={tapeQuotes} {activeDisplay} market={wireMarket} bias={signal?.bias ?? 'FLAT'} sample={wireSample} />
		</div>

		<div class="office-flag" class:is-dragging={officeFlagPosition.dragging} use:bindOfficeFlag style={`left: ${officeFlagPosition.left}px; top: ${officeFlagPosition.top}px;`} title={`${selectedOfficeFlag.name} - drag to move`} aria-label={`Draggable office flag: ${selectedOfficeFlag.name}`} role="button" tabindex="0" onpointerdown={onOfficeFlagPointerDown} onpointermove={onOfficeFlagPointerMove} onpointerup={onOfficeFlagPointerUp} onpointercancel={onOfficeFlagPointerUp} onlostpointercapture={onOfficeFlagPointerUp}>
			<div class="flag-pole"></div>
			<div class="flag-cloth">
				<img src={`https://flagcdn.com/w320/${selectedOfficeFlag.id.toLowerCase()}.png`} alt={selectedOfficeFlag.name} draggable="false" />
			</div>
		</div>

		<section class="office-floor" bind:this={officeFloor}>
			<div class="floor-light"></div>
			<div class="back-staff" aria-label="Management and research desks">
				<div class="staff-zone-sign"><span>FLOOR MANAGEMENT</span><b>STAFF</b></div>
				<div class="staff-row">
				{#each STAFF as s (s.id)}
					<CharacterSprite
						staff={s}
						note={staffNote(s, signal, bookRisk)}
						{bars}
						lampBoost={0.22}
						tick={animTick}
						pinned={pinnedId === s.id}
						onInspect={() => inspectStaff(s)}
						onPin={() => {
							inspectedId = s.id;
							pinnedId = pinnedId === s.id ? null : s.id;
						}}
					/>
				{/each}
				</div>
				<!-- Serenades Nora Blake (center staff desk) -->
				<MariachiBand active={mariachi.active} frame={mariachi.frame} anchor="nora" />
			</div>

			<div class="desk-zones">
				<div class="desk-zone long-zone" class:active={signal?.bias === 'LONG'}>
					<div class="zone-sign"><span>LONG BOOK</span><b>{longOpen} OPEN</b></div>
					<div class="trader-row">
						{#each longTraders as t (t.id)}
							<CharacterSprite
								trader={t}
								leg={legFor(t.id)}
								posture={postureFor(t)}
								tradeDurationMinutes={tradeDurationFor(t.id)}
								tradeDurationEnabled={lastMarket != null}
								canRelease={!!book[t.id]}
								onRelease={() => releaseTrader(t.id)}
								onStart={() => startTrader(t.id)}
								takeProfit={takeProfitFlashes[t.id] ? { pnlUsd: takeProfitFlashes[t.id].pnlUsd, target: takeProfitFlashes[t.id].target } : null}
								{bars}
								lampBoost={signal?.bias === 'LONG' ? 0.22 : 0}
								tick={animTick}
								pinned={pinnedId === t.id}
								blofinBadge={blofinBadgeFor(t.id)}
								onInspect={() => (inspectedId = t.id)}
								onPin={() => openQuickTradeFor(t.id)}
								onLeverageCommit={(value) => setTraderLeverage(t.id, value)}
								onTradeDurationCommit={(value) => setTraderTradeDuration(t.id, value)}
							/>
						{/each}
					</div>
				</div>
				<div class="aisle">
					<span>RISK <br />AISLE</span><i></i><i></i><i></i>
				</div>
				<div class="desk-zone short-zone" class:active={signal?.bias === 'SHORT'}>
					<div class="zone-sign"><span>SHORT BOOK</span><b>{shortOpen} OPEN</b></div>
					<div class="trader-row">
						{#each shortTraders as t (t.id)}
							<CharacterSprite
								trader={t}
								leg={legFor(t.id)}
								posture={postureFor(t)}
								tradeDurationMinutes={tradeDurationFor(t.id)}
								tradeDurationEnabled={lastMarket != null}
								canRelease={!!book[t.id]}
								onRelease={() => releaseTrader(t.id)}
								onStart={() => startTrader(t.id)}
								takeProfit={takeProfitFlashes[t.id] ? { pnlUsd: takeProfitFlashes[t.id].pnlUsd, target: takeProfitFlashes[t.id].target } : null}
								{bars}
								lampBoost={signal?.bias === 'SHORT' ? 0.22 : 0}
								tick={animTick}
								pinned={pinnedId === t.id}
								blofinBadge={blofinBadgeFor(t.id)}
								onInspect={() => (inspectedId = t.id)}
								onPin={() => openQuickTradeFor(t.id)}
								onLeverageCommit={(value) => setTraderLeverage(t.id, value)}
								onTradeDurationCommit={(value) => setTraderTradeDuration(t.id, value)}
							/>
						{/each}
					</div>
				</div>
			</div>

		</section>
		<div
			class="coffee-table lounge-decor-piece"
			class:is-dragging={loungeDecorPositions.fortune.dragging}
			use:bindLoungeDecor={'fortune'}
			style={`left: ${loungeDecorPositions.fortune.left}px; top: ${loungeDecorPositions.fortune.top}px;`}
			role="button" tabindex="0" aria-label="Drag Fortune table decoration" title="Drag Fortune table"
			onpointerdown={(e) => onLoungeDecorPointerDown('fortune', e)}
			onpointermove={(e) => onLoungeDecorPointerMove('fortune', e)}
			onpointerup={(e) => onLoungeDecorPointerUp('fortune', e)}
			onpointercancel={(e) => onLoungeDecorPointerUp('fortune', e)}
			onlostpointercapture={(e) => onLoungeDecorPointerUp('fortune', e)}
		><span>FORTUNE</span></div>
		<div
			class="sofa lounge-decor-piece"
			class:is-dragging={loungeDecorPositions.sofa.dragging}
			use:bindLoungeDecor={'sofa'}
			style={`left: ${loungeDecorPositions.sofa.left}px; top: ${loungeDecorPositions.sofa.top}px;`}
			role="button" tabindex="0" aria-label="Drag lounge sofa decoration" title="Drag lounge sofa"
			onpointerdown={(e) => onLoungeDecorPointerDown('sofa', e)}
			onpointermove={(e) => onLoungeDecorPointerMove('sofa', e)}
			onpointerup={(e) => onLoungeDecorPointerUp('sofa', e)}
			onpointercancel={(e) => onLoungeDecorPointerUp('sofa', e)}
			onlostpointercapture={(e) => onLoungeDecorPointerUp('sofa', e)}
		><span class="sofa-arm sofa-arm-l" aria-hidden="true"></span><span class="sofa-arm sofa-arm-r" aria-hidden="true"></span><span class="sofa-leg sofa-leg-l" aria-hidden="true"></span><span class="sofa-leg sofa-leg-r" aria-hidden="true"></span><i></i><i></i></div>
		<div
			class="plant lounge-decor-piece lounge-plant"
			class:is-dragging={loungeDecorPositions.loungePlant.dragging}
			use:bindLoungeDecor={'loungePlant'}
			style={`left: ${loungeDecorPositions.loungePlant.left}px; top: ${loungeDecorPositions.loungePlant.top}px;`}
			role="button" tabindex="0" aria-label="Drag lounge plant decoration" title="Drag lounge plant"
			onpointerdown={(e) => onLoungeDecorPointerDown('loungePlant', e)}
			onpointermove={(e) => onLoungeDecorPointerMove('loungePlant', e)}
			onpointerup={(e) => onLoungeDecorPointerUp('loungePlant', e)}
			onpointercancel={(e) => onLoungeDecorPointerUp('loungePlant', e)}
			onlostpointercapture={(e) => onLoungeDecorPointerUp('loungePlant', e)}
		><i></i><i></i><i></i></div>

		{#if deskSettings.showFax && !deskSettings.hideAllDraggables}
			<FaxMachine
				{signal}
				{quote}
				{bars}
				displaySymbol={activeDisplay}
				decimals={priceDecimals}
				sceneFrame={sceneFrame}
				mobileDeskTop={foregroundDeskTop}
			/>
		{/if}
		{#if deskSettings.showPet && !deskSettings.hideAllDraggables}
			<FloorPet
				bias={signal?.bias ?? 'FLAT'}
				confluenceBand={signal?.confluenceBand ?? 'weak'}
				tick={animTick}
				sceneFrame={sceneFrame}
			/>
		{/if}
		{#if deskSettings.showTrash && !deskSettings.hideAllDraggables}
			<TrashCan
				{signal}
				{quote}
				displaySymbol={activeDisplay}
				decimals={priceDecimals}
				sceneFrame={sceneFrame}
				mobileDeskTop={foregroundDeskTop}
			/>
		{/if}
		{#if deskSettings.showCrtCart && !deskSettings.hideAllDraggables}
			<CrtPnlCart
				{legs}
				sceneFrame={sceneFrame}
				compact={deskSettings.compactDeskTools}
				crtScanlines={deskSettings.crtScanlines}
				reduceMotion={deskSettings.reduceMotion}
			/>
		{/if}

		<section class="foreground-desk" bind:this={foregroundDesk}>
			<div class="desk-edge"></div>
			<div class="book-stack" role="group" aria-label="Desk reference books">
				{#each DESK_LIBRARY as book, i (book.id)}
					<button
						type="button"
						class="book-spine"
						class:spine-0={i === 0}
						class:spine-1={i === 1}
						class:spine-2={i === 2}
						class:spine-3={i === 3}
						aria-label={`Open desk primer: ${book.spineTitle}`}
						title={book.spineTitle}
						onclick={() => openDeskBook(book.id)}
					>
						{#each book.spineTitle.split(' ') as word, wi}
							{#if wi > 0}<br />{/if}{word}
						{/each}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="foreground-monitor"
				aria-label="Open desk CRT terminal"
				title="Desk CRT - chart / quote / signal"
				onclick={openMonitorPanel}
			>
				<div class="monitor-bezel">
					{#if pinnedTrader && pinnedPosture}
						<div class="pinned-head">
							<span>PINNED: {pinnedTrader.name} . {pinnedTrader.leverage}x</span>
							<b>{pinnedPosture.status.toUpperCase()}</b>
						</div>
						<div class="pinned-chart">
							<MiniChart
								{bars}
								bias={pinnedPosture.bias}
										label={`${activeDef.bybit} . PINNED DESK`}
								showLevels={true}
								stop={pinnedPosture.stop}
								tp1={pinnedPosture.tp1}
								tp2={pinnedPosture.tp2}
							/>
						</div>
						<div class="pinned-risk">
							SL {fmt(pinnedPosture.stop)} . TP1 {fmt(pinnedPosture.tp1)} . TP2 {fmt(
								pinnedPosture.tp2
							)}
						</div>
					{:else}
						<TaHud {signal} displaySymbol={activeDisplay} />
					{/if}
				</div>
				<div class="monitor-foot"></div>
			</button>
			<div class="phone-main"><span></span><i></i></div>
		</section>

		<div
			class="wsj desk-prop"
			class:expanded={wsjExpanded}
			class:is-dragging={deskProps.wsj.dragging}
			class:is-ready={deskProps.wsj.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.wsj.left}px`}
			style:top={`${deskProps.wsj.top}px`}
			use:deskPropAction={'wsj'}
			onpointerdown={(e) => onDeskPropPointerDown('wsj', e)}
			onpointermove={(e) => onDeskPropPointerMove('wsj', e)}
			onpointerup={(e) => onDeskPropPointerUp('wsj', e)}
			onpointercancel={(e) => onDeskPropPointerUp('wsj', e)}
			role="button"
			tabindex="0"
			aria-label="Wall Street Journal - news for active coin"
			title="Drag to move . click for more headlines"
			onclick={() => deskPropClick('wsj', () => (wsjExpanded = !wsjExpanded))}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					deskPropClick('wsj', () => (wsjExpanded = !wsjExpanded));
				}
			}}
		>
			<header>THE WALL STREET JOURNAL</header>
			{#if newsHeadlines[0] && !wsjExpanded}
				<b class="wsj-hed"
					>{activeDef.label}: {newsHeadlines[0].title.slice(0, 48)}{newsHeadlines[0].title
						.length > 48
						? '...'
						: ''}</b
				>
			{:else if !wsjExpanded}
				<b class="wsj-hed">Markets Watch<br />{activeDef.label}</b>
			{/if}
			{#if newsSample}<em class="wsj-sample">SAMPLE</em>{:else}<em class="wsj-live">LIVE</em>{/if}
			{#if wsjExpanded}
				<div class="wsj-edition">
					<p class="wsj-kicker">MARKET EDITION . {activeDef.label}</p>
					{#if newsHeadlines[0]}
						{#if newsHeadlines[0].link}
							<a class="wsj-story-link" href={newsHeadlines[0].link} target="_blank" rel="noreferrer" onclick={(event) => event.stopPropagation()}>
								<h2>{newsHeadlines[0].title}</h2>
							</a>
						{:else}
							<h2>{newsHeadlines[0].title}</h2>
						{/if}
						<p class="wsj-byline">{newsHeadlines[0].source} . full wire headline</p>
					{/if}
					<p class="wsj-dek">Latest complete headlines for the active market. Click the paper again to fold it up.</p>
					<ul class="wsj-more">
						{#each newsHeadlines.slice(1) as h, i (i)}
							<li>
								<strong>{h.source}</strong> -
								{#if h.link}
									<a class="wsj-story-link" href={h.link} target="_blank" rel="noreferrer" onclick={(event) => event.stopPropagation()}>{h.title}</a>
								{:else}
									{h.title}
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
		<div
			class="legal-pad desk-prop"
			class:is-dragging={deskProps.legal.dragging}
			class:is-ready={deskProps.legal.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.legal.left}px`}
			style:top={`${deskProps.legal.top}px`}
			use:deskPropAction={'legal'}
			onpointerdown={(e) => onDeskPropPointerDown('legal', e)}
			onpointermove={(e) => onDeskPropPointerMove('legal', e)}
			onpointerup={(e) => onDeskPropPointerUp('legal', e)}
			onpointercancel={(e) => onDeskPropPointerUp('legal', e)}
			role="button"
			tabindex="0"
			aria-label="Positions pad - click to expand"
			title="Drag to move . click to expand"
			onclick={() => deskPropClick('legal', () => (legalPadExpanded = !legalPadExpanded))}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					deskPropClick('legal', () => (legalPadExpanded = !legalPadExpanded));
				}
			}}
		>
			<header>POSITIONS:</header>
			{#if deskPosNote}
				<p class="pos-note">{deskPosNote}</p>
			{/if}
			{#if deskPosLines.length}
				{#each deskPosLines.slice(0, 4) as line, i (i)}
					<p>{line.venue} {line.text}</p>
				{/each}
			{:else}
				<p>FLAT - no open positions</p>
			{/if}
			<p class="pos-ta">
				TA {signal?.bias === 'LONG' ? 'LONG' : signal?.bias === 'SHORT' ? 'SHORT' : 'FLAT'}
				{activeDef.label} . {signal?.confluence ?? '-'}/6
			</p>
			<span></span>
		</div>
		<button
			type="button"
			class="keyboard-main desk-prop"
			class:is-dragging={deskProps.keyboard.dragging}
			class:is-ready={deskProps.keyboard.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.keyboard.left}px`}
			style:top={`${deskProps.keyboard.top}px`}
			use:deskPropAction={'keyboard'}
			onpointerdown={(e) => onDeskPropPointerDown('keyboard', e)}
			onpointermove={(e) => onDeskPropPointerMove('keyboard', e)}
			onpointerup={(e) => onDeskPropPointerUp('keyboard', e)}
			onpointercancel={(e) => onDeskPropPointerUp('keyboard', e)}
			aria-label="Open desk console"
			title="Desk console (BloFin live) - drag to move"
			onclick={() => deskPropClick('keyboard', openDeskConsole)}
		><i></i></button>
		<button
			type="button"
			class="mouse-pad desk-prop"
			class:is-dragging={deskProps.pad.dragging}
			class:is-ready={deskProps.pad.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.pad.left}px`}
			style:top={`${deskProps.pad.top}px`}
			use:deskPropAction={'pad'}
			onpointerdown={(e) => onDeskPropPointerDown('pad', e)}
			onpointermove={(e) => onDeskPropPointerMove('pad', e)}
			onpointerup={(e) => onDeskPropPointerUp('pad', e)}
			onpointercancel={(e) => onDeskPropPointerUp('pad', e)}
			aria-label="Create position - fund trader with percent equity"
			title="CREATE POSITION - fund trader with % equity - drag to move"
			onclick={() => deskPropClick('pad', openQuickTrade)}
		>
			<span class="pad-target" aria-hidden="true"></span>
		</button>
		<button
			type="button"
			class="calculator desk-prop"
			class:is-dragging={deskProps.calc.dragging}
			class:is-ready={deskProps.calc.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.calc.left}px`}
			style:top={`${deskProps.calc.top}px`}
			use:deskPropAction={'calc'}
			onpointerdown={(e) => onDeskPropPointerDown('calc', e)}
			onpointermove={(e) => onDeskPropPointerMove('calc', e)}
			onpointerup={(e) => onDeskPropPointerUp('calc', e)}
			onpointercancel={(e) => onDeskPropPointerUp('calc', e)}
			aria-label="Open profit calculator"
			title="P&L calculator - drag to move"
			onclick={() => deskPropClick('calc', openProfitCalc)}
		>
			<span class="calc-display" aria-hidden="true">0.00</span>
			<span class="calc-keys" aria-hidden="true">
				<i>7</i><i>8</i><i>9</i><i>4</i><i>5</i><i>6</i><i>1</i><i>2</i><i>3</i>
			</span>
		</button>
		<button
			type="button"
			class="coffee desk-prop"
			class:is-dragging={deskProps.coffee.dragging}
			class:is-ready={deskProps.coffee.ready}
			class:compact={deskSettings.compactDeskTools}
			class:is-tripping={coffeeTripActive}
			style:left={`${deskProps.coffee.left}px`}
			style:top={`${deskProps.coffee.top}px`}
			use:deskPropAction={'coffee'}
			onpointerdown={(e) => onDeskPropPointerDown('coffee', e)}
			onpointermove={(e) => onDeskPropPointerMove('coffee', e)}
			onpointerup={(e) => onDeskPropPointerUp('coffee', e)}
			onpointercancel={(e) => onDeskPropPointerUp('coffee', e)}
			aria-label="Sip PHF coffee - brief trip"
			title="PHF coffee - drag to move"
			onclick={() => deskPropClick('coffee', triggerCoffeeTrip)}
		><b></b><i></i><span class="brew"></span><span class="plaque"><em>PHF</em></span><u></u></button>
		<button
			type="button"
			class="desk-settings-btn desk-prop"
			class:is-dragging={deskProps.set.dragging}
			class:is-ready={deskProps.set.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.set.left}px`}
			style:top={`${deskProps.set.top}px`}
			use:deskPropAction={'set'}
			onpointerdown={(e) => onDeskPropPointerDown('set', e)}
			onpointermove={(e) => onDeskPropPointerMove('set', e)}
			onpointerup={(e) => onDeskPropPointerUp('set', e)}
			onpointercancel={(e) => onDeskPropPointerUp('set', e)}
			aria-label="Open desk settings"
			title="Desk settings - drag to move"
			onclick={() => deskPropClick('set', openDeskSettings)}
		><span class="settings-glyph" aria-hidden="true"></span><b>SET</b></button>
		<button
			type="button"
			class="desk-break-btn desk-prop"
			class:is-dragging={deskProps.break.dragging}
			class:is-ready={deskProps.break.ready}
			class:compact={deskSettings.compactDeskTools}
			style:left={`${deskProps.break.left}px`}
			style:top={`${deskProps.break.top}px`}
			use:deskPropAction={'break'}
			onpointerdown={(e) => onDeskPropPointerDown('break', e)}
			onpointermove={(e) => onDeskPropPointerMove('break', e)}
			onpointerup={(e) => onDeskPropPointerUp('break', e)}
			onpointercancel={(e) => onDeskPropPointerUp('break', e)}
			aria-label="Take a break - leave the floor and go back to the lobby"
			title="Take a break - drag to move"
			onclick={() => deskPropClick('break', takeBreak)}
		><span class="break-glyph" aria-hidden="true"></span><b>BREAK</b></button>
{#if deskSettings.showClipboard && !deskSettings.hideAllDraggables && ((inspectedTrader && inspectedPosture) || inspectedStaff)}
	<aside
		bind:this={clipboardRoot}
		class="clipboard-panel"
		class:is-dragging={clipboardDragging}
		class:staff-card={!!inspectedStaff && !inspectedTrader}
		data-side={inspectedTrader?.side ?? 'staff'}
		role="group"
		aria-label="Draggable desk clipboard"
		title="Drag clipboard"
		style:left={`${clipboardLeft}px`}
		style:top={`${clipboardTop}px`}
		onpointerdown={onClipboardPointerDown}
		onpointermove={onClipboardPointerMove}
		onpointerup={stopClipboardDragging}
		onpointercancel={stopClipboardDragging}
		onlostpointercapture={stopClipboardDragging}
	>
			<div class="clip"></div>
			{#if inspectedTrader && inspectedPosture}
				<header>
					<div>
						<small>DESK CLIPBOARD . DRAG</small><strong>{inspectedTrader.name}</strong>
					</div>
					<b>{inspectedTrader.side.toUpperCase()} . {inspectedTrader.leverage}x</b>
				</header>
				<div class="panel-status" data-status={inspectedPosture.status}>
					<i></i>{statusLabel(inspectedPosture.status)}
				</div>
				<dl>
					<div>
						<dt>PAIR</dt>
						<dd>{activeDisplay}</dd>
					</div>
					{#if signal?.protocol}
						<div>
							<dt>REGIMEN 4H</dt>
							<dd>{signal.protocol.regime}</dd>
						</div>
						<div>
							<dt>SOPORTE 4H</dt>
							<dd class="positive">{zoneText(signal.protocol.supports[0])}</dd>
						</div>
						<div>
							<dt>RESISTENCIA 4H</dt>
							<dd class="negative">{zoneText(signal.protocol.resistances[0])}</dd>
						</div>
						<div>
							<dt>RSI 4H</dt>
							<dd>{rsiText(signal.protocol.rsi)}</dd>
						</div>
						<div>
							<dt>VOLUMEN 4H</dt>
							<dd>{volText(signal.protocol.volumeRatio)}</dd>
						</div>
					{:else}
						<div>
							<dt>BIAS / STRUCTURE</dt>
							<dd>{inspectedPosture.bias} / {inspectedPosture.structure}</dd>
						</div>
						<div>
							<dt>CONFLUENCE</dt>
							<dd
								>{inspectedPosture.confluence}/6 {inspectedPosture.aligned
									? '. ALIGNED'
									: '. COUNTER'}</dd
							>
						</div>
					{/if}
					<div>
						<dt>ENTRY</dt>
						<dd>{fmt(inspectedPosture.entryMark)}</dd>
					</div>
					<div>
						<dt>MARK</dt>
						<dd>{fmt(inspectedPosture.mark ?? quote?.mark)}</dd>
					</div>
					<div>
						<dt>UNREALIZED</dt>
						<dd
							class:positive={(inspectedPosture.unrealizedPnlUsd ?? 0) >= 0}
							class:negative={(inspectedPosture.unrealizedPnlUsd ?? 0) < 0}
							>{pnl(inspectedPosture.unrealizedPnlUsd)}</dd
						>
					</div>
					<div>
					<dt>STOP . RISK</dt>
						<dd class="negative">{fmt(inspectedPosture.stop)}</dd>
					</div>
					<div>
					<dt>TP1 . {inspectedPosture.rrTp1?.toFixed(2) ?? '1.50'}R</dt>
						<dd class="positive">{fmt(inspectedPosture.tp1)}</dd>
					</div>
					{#if !signal?.protocol}
					<div>
					<dt>TP2 . TRAIL</dt>
						<dd class="positive">{fmt(inspectedPosture.tp2)}</dd>
					</div>
					{/if}
				</dl>
				<p>
					{inspectedPosture.posture === 'open'
						? signal?.protocol
							? 'Salida: stop en el nivel, objetivo 2R o 5 dias.'
							: 'Invalidation: Supertrend flips against position.'
						: (inspectedPosture.cloud ?? 'Mandate does not support current tape. No fill.')}
				</p>
				<footer>
					CLICK DESK TO {pinnedId === inspectedTrader.id ? 'UNPIN' : 'PIN CRT'}
					{inspectedPosture.sample ? '. WAITING FOR LIVE TAPE' : ''}
				</footer>
			{:else if inspectedStaff}
				<header>
					<div>
						<small>STAFF NOTE . DRAG</small><strong>{inspectedStaff.name}</strong>
					</div>
					<b>{inspectedStaff.title}</b>
				</header>
				<div class="staff-sheet">{staffNote(inspectedStaff, signal, bookRisk)}</div>
				<div class="staff-details" aria-label="Staff detail note">
					{#each staffDetails(inspectedStaff, signal, bookRisk) as detail}
						<p>{detail}</p>
					{/each}
				</div>
			{/if}
	</aside>
{/if}
		{#if deskSettings.showPricePad && !deskSettings.hideAllDraggables}
		<aside
			bind:this={pricePadRoot}
			class="wire-status price-pad"
			class:is-dragging={pricePadDragging}
			class:is-ready={pricePadReady}
			role="group"
			aria-label="Draggable price widget"
			title="Drag price pad"
			style:left={`${pricePadLeft}px`}
			style:top={`${pricePadTop}px`}
			onpointerdown={onPricePadPointerDown}
			onpointermove={onPricePadPointerMove}
			onpointerup={stopPricePadDragging}
			onpointercancel={stopPricePadDragging}
			onlostpointercapture={stopPricePadDragging}
		>
			<div class="clip"></div>
			<div>
				<span class:dot-live={!!quote && !quote.sample}></span>{!quote ? 'LIVE DATA UNAVAILABLE' : quote.sample
					? 'SAMPLE TAPE'
					: `${quote.provider.toUpperCase()} . ${activeDisplay}`}
			</div>
			<strong>{quote?.price?.toFixed(priceDecimals) ?? '-'}</strong>
			<small
				>{clock.label} . {clock.phase.toUpperCase()}{clock.raining
					? ' . RAIN'
					: ''}{clock.snowing
					? ' . XMAS . SNOW'
					: clock.holidayWindow
						? ' . XMAS'
					: ''}{ufo.active
					? ' . UFO!'
					: ''}{mariachi.active ? ' . MARIACHI!' : ''}</small
			>
		</aside>
		{/if}
	</div>


</main>

{#if legalPadExpanded}
	<div class="legal-expanded-backdrop" role="presentation" onclick={() => (legalPadExpanded = false)}>
		<dialog
			open
			class="legal-expanded"
			aria-modal="true"
			aria-label="Expanded positions pad"
			onclick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				class="expanded-close"
				onclick={() => (legalPadExpanded = false)}
				aria-label="Close expanded positions pad"
			>x</button>
			<h2>POSITIONS PAD</h2>
			{#if deskPosNote}
				<p class="legal-expanded-note">{deskPosNote}</p>
			{/if}
			{#if deskPosLines.length}
				<div class="legal-expanded-lines">
					{#each deskPosLines as line, i (i)}
						<p><strong>{line.venue}</strong> {line.text}</p>
					{/each}
				</div>
			{:else}
				<p class="legal-expanded-empty">FLAT . NO OPEN POSITIONS</p>
			{/if}
			<p class="legal-expanded-ta">
				TA {signal?.bias === 'LONG' ? 'LONG' : signal?.bias === 'SHORT' ? 'SHORT' : 'FLAT'}
				{activeDef.label} . {signal?.confluence ?? '-'}/6
			</p>
			<small>CLICK OUTSIDE OR PRESS ESC TO CLOSE</small>
		</dialog>
	</div>
{/if}

{#if coffeeTripActive}
	<div class="coffee-trip" aria-hidden="true"></div>
{/if}

<DeskConsole
	bind:open={deskConsoleOpen}
	onAssignmentsChange={(a) => (blofinAssignments = a)}
	onOverlayChange={(o) => (blofinOverlay = o)}
/>
<MonitorPanel
	bind:open={monitorPanelOpen}
	{bars}
	{quote}
	{signal}
	{tapeQuotes}
	{activeDisplay}
	{priceDecimals}
	onSelectSymbol={setSymbol}
	onResetTraders={resetAllTradersToThinking}
/>
<QuickTradePanel
	bind:open={quickTradeOpen}
	{activeDisplay}
	{quote}
	{signal}
	{priceDecimals}
	presetTraderId={quickTradePresetTraderId}
	onSelectSymbol={setSymbol}
	onAssignmentsChange={(a) => (blofinAssignments = a)}
/>
<DeskBookReader bind:open={deskBookOpen} bind:bookId={deskBookId} />
<ProfitCalcPanel
	bind:open={profitCalcOpen}
	{quote}
	{priceDecimals}
	{activeDisplay}
/>

	
{#if settingsOpen}
	<div class="settings-backdrop" role="presentation" onclick={() => (settingsOpen = false)}></div>
	<div class="desk-settings-panel" role="dialog" aria-modal="true" aria-label="Desk settings">
		<header>
			<strong>DESK SETTINGS</strong>
			<button type="button" class="x" onclick={() => (settingsOpen = false)} aria-label="Close settings">X</button>
		</header>
		<div class="settings-body">
			<section>
				<h4>DRAGGABLES</h4>
				<label><input type="checkbox" checked={deskSettings.showClipboard} onchange={(e) => updateDeskSetting('showClipboard', e.currentTarget.checked)} /> Clipboard</label>
				<label><input type="checkbox" checked={deskSettings.showPricePad} onchange={(e) => updateDeskSetting('showPricePad', e.currentTarget.checked)} /> Price pad</label>
				<label><input type="checkbox" checked={deskSettings.showFax} onchange={(e) => updateDeskSetting('showFax', e.currentTarget.checked)} /> Fax</label>
				<label><input type="checkbox" checked={deskSettings.showPet} onchange={(e) => updateDeskSetting('showPet', e.currentTarget.checked)} /> Pet</label>
				<label><input type="checkbox" checked={deskSettings.showTrash} onchange={(e) => updateDeskSetting('showTrash', e.currentTarget.checked)} /> Trash</label>
				<label><input type="checkbox" checked={deskSettings.showCrtCart} onchange={(e) => updateDeskSetting('showCrtCart', e.currentTarget.checked)} /> CRT P&amp;L cart</label>
				<button type="button" class="ghost" onclick={toggleHideAllDraggables}>
					{deskSettings.hideAllDraggables ? 'SHOW ALL DRAGGABLES' : 'HIDE ALL DRAGGABLES'}
				</button>
				<button type="button" class="ghost" onclick={saveCurrentDeskLayoutAsDefault}>USE CURRENT TOOL LAYOUT AS DEFAULT</button>
			</section>
			<section>
				<h4>OFFICE DECOR</h4>
				<label class="theme-picker">
					<span>Theme</span>
					<select value={deskSettings.officeTheme} onchange={(e) => updateOfficeTheme(e.currentTarget.value as OfficeTheme)} aria-label="Office theme">
						<option value="nyc">NYC dusk</option>
						<option value="miami-vice">Miami Vice</option>
					</select>
				</label>
				<label class="flag-picker">
					<span>Flag</span>
					<select value={deskSettings.officeFlag} onchange={(e) => updateDeskSetting('officeFlag', e.currentTarget.value)} aria-label="Office flag">
						{#each OFFICE_FLAGS as flag (flag.id)}
							<option value={flag.id}>{flag.name}</option>
						{/each}
					</select>
				</label>
			</section>
			<section>
				<h4>MOTION / DESK</h4>
				<label><input type="checkbox" checked={deskSettings.reduceMotion} onchange={(e) => updateDeskSetting('reduceMotion', e.currentTarget.checked)} /> Reduce motion</label>
				<label><input type="checkbox" checked={deskSettings.disableCoffeeTrip} onchange={(e) => updateDeskSetting('disableCoffeeTrip', e.currentTarget.checked)} /> Disable coffee trip</label>
				<label><input type="checkbox" checked={deskSettings.compactDeskTools} onchange={(e) => updateDeskSetting('compactDeskTools', e.currentTarget.checked)} /> Compact desk tools</label>
				<label><input type="checkbox" checked={deskSettings.showBlofinBadges} onchange={(e) => updateDeskSetting('showBlofinBadges', e.currentTarget.checked)} /> Show BloFin BF badges</label>
				<label><input type="checkbox" checked={deskSettings.soundOff} onchange={(e) => updateDeskSetting('soundOff', e.currentTarget.checked)} /> Sound off (stub)</label>
				<label><input type="checkbox" checked={deskSettings.nightModeTint} onchange={(e) => updateDeskSetting('nightModeTint', e.currentTarget.checked)} /> Night mode tint</label>
				<label><input type="checkbox" checked={deskSettings.crtScanlines} onchange={(e) => updateDeskSetting('crtScanlines', e.currentTarget.checked)} /> CRT scanlines</label>
				<label><input type="checkbox" checked={deskSettings.forceChristmasSnow} onchange={(e) => updateDeskSetting('forceChristmasSnow', e.currentTarget.checked)} /> Force Christmas snow</label>
			</section>
			<p class="hint">Saved in localStorage <code>phf-desk-settings</code>.</p>
		</div>
	</div>
{/if}

<ToastStack />

{#if err || tapeError}<div class="error-note">TAPE WIRE: {err ?? tapeError}</div>{/if}

<style>
	:global(:root) {
		--pixel: 'Courier New', monospace;
		--mono: 'Courier New', monospace;
	}
	.scene {
		position: relative;
		min-height: 100vh;
		background: #0c0807;
		color: #f0e4cf;
		font-family: var(--mono);
		overflow-x: hidden;
		display: block;
		padding: 0;
	}
	.scene-frame {
		position: relative;
		width: min(1440px, 100%);
		min-width: 0;
		min-height: 1040px;
		margin: 0 auto;
		overflow: hidden;
		background: #0f1813;
		box-shadow: 0 0 80px #000;
		image-rendering: pixelated;
	}
	.upper-wall {
		position: relative;
		height: 295px;
		display: grid;
		grid-template-columns: 230px 1fr 275px;
		/* Forest-green lacquered wall with a brass chair rail, matching the marble floor below. */
		background: #172a21;
		border-bottom: 8px solid #8a6c34;
		box-shadow: inset 0 -12px 25px rgba(2, 8, 5, 0.65), 0 2px 0 #c9a45c;
	}
	.wall-panel {
		position: relative;
		/* Raised green panelling: inset brass-edged panels over a darker field. */
		background:
			linear-gradient(90deg, rgba(176, 141, 74, 0.35) 0 1px, transparent 1px calc(100% - 1px), rgba(176, 141, 74, 0.35) calc(100% - 1px)),
			repeating-linear-gradient(0deg, transparent 0 58px, rgba(0, 0, 0, 0.28) 58px 60px, rgba(176, 141, 74, 0.18) 60px 61px),
			linear-gradient(90deg, #1f3a2d, #16291f);
		border-right: 6px solid #0b140f;
		border-left: 4px solid #8a6c34;
	}
	.fund-sign {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: 16px 10px 10px;
		padding: 10px 8px;
		background: #1b1512;
		border: 3px solid #9c7040;
		box-shadow:
			0 0 12px rgba(239, 183, 89, 0.18),
			4px 4px 0 rgba(20, 8, 3, 0.5);
	}
	.monogram {
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		color: #1d140d;
		background: #d7ae63;
		border: 3px solid #76512e;
		font-size: 12px;
		font-weight: 900;
	}
	.fund-sign strong {
		display: block;
		color: #efc66f;
		font-size: 9px;
		letter-spacing: 0.08em;
	}
	.fund-sign small {
		display: block;
		margin-top: 4px;
		color: #ab8e64;
		font-size: 5px;
		letter-spacing: 0.08em;
	}
	.whiteboard {
		margin: 16px 13px;
		padding: 10px 10px 8px;
		background: #ece6d5;
		color: #26333a;
		border: 5px solid #8a6c34;
		box-shadow: 4px 5px 0 rgba(20, 8, 4, 0.5);
		transform: rotate(-0.4deg);
	}
	.whiteboard h3 {
		margin: 0 0 5px;
		font-size: 10px;
		border-bottom: 2px solid #45585d;
	}
	.whiteboard p {
		margin: 4px 0;
		color: #17262d;
		font-size: 8px;
		font-weight: 700;
		line-height: 1.3;
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
	}
	.whiteboard b {
		display: block;
		margin-top: 7px;
		color: #9c412c;
		font-size: 8px;
		font-weight: 800;
		line-height: 1.25;
		transform: rotate(-2deg);
	}
	.window-wall {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0;
		padding: 10px 8px 0;
		background: #0f1813;
	}
	.panoramic-skyline {
		position: absolute;
		inset: 10px 8px 0;
		overflow: hidden;
		z-index: 1;
	}
	.window-wall::after {
		content: '';
		position: absolute;
		inset: 10px 8px 0;
		pointer-events: none;
		z-index: 3;
		background: linear-gradient(
			90deg,
			transparent 0 calc(33.333% - 3.5px),
			#2b2418 calc(33.333% - 3.5px) calc(33.333% + 3.5px),
			transparent calc(33.333% + 3.5px) calc(66.666% - 3.5px),
			#2b2418 calc(66.666% - 3.5px) calc(66.666% + 3.5px),
			transparent calc(66.666% + 3.5px) 100%
		);
	}
	.window-pane {
		position: relative;
		overflow: hidden;
		/* Bronze window frames with a brass inner bead and a brass sill. */
		border: 5px solid #2b2418;
		border-bottom: 10px solid #8a6c34;
		box-shadow: inset 0 0 0 2px #b08d4a, inset 0 0 0 3px #1a140c;
		z-index: 2;
	}
	.glass-glare {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			rgba(255, 255, 255, 0.1),
			transparent 24%,
			transparent 67%,
			rgba(255, 190, 130, 0.06)
		);
		z-index: 8;
		pointer-events: none;
	}
	.market-board {
		margin: 14px 12px 8px;
		padding: 8px;
		max-height: 268px;
		overflow: hidden;
		background: #11130f;
		border: 5px solid #8a6c34;
		box-shadow:
			inset 0 0 16px #000,
			4px 5px 0 rgba(15, 5, 2, 0.5);
	}
	.market-board header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 5px;
		color: #d8b76c;
		border-bottom: 1px solid #5a5134;
		font-size: 7px;
	}
	.market-board header i {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #d8bb71;
		font-style: normal;
	}
	.market-board header i::before {
		content: '';
		width: 5px;
		height: 5px;
		background: #d8bb71;
		box-shadow: 0 0 0 1px #5a5134;
	}
	.market-board header i.wire-live {
		color: #f47764;
	}
	.market-board header i.wire-live::before {
		background: #f04b4b;
		border-radius: 50%;
		box-shadow: 0 0 4px 2px rgba(240, 75, 75, 0.75);
		animation: wire-live-pulse 1.8s ease-in-out infinite;
	}
	@keyframes wire-live-pulse {
		0%,
		100% {
			opacity: 0.7;
		}
		50% {
			opacity: 1;
			box-shadow: 0 0 6px 3px rgba(240, 75, 75, 0.95);
		}
	}
	.wire-market-toggle {
		display: flex !important;
		grid-template-columns: none !important;
		align-items: center;
		gap: 3px !important;
		margin-top: 5px !important;
		font-size: 6px;
		color: #9d886f;
	}
	.wire-market-toggle button {
		padding: 3px 5px;
		background: #1a1c16;
		border: 1px solid #5a5134;
		color: #9d886f;
		font: 6px var(--mono);
		cursor: pointer;
	}
	.wire-market-toggle button.active {
		background: #efc870;
		border-color: #efc870;
		color: #0c0e0a;
	}
	.wire-token-heading {
		display: block !important;
		margin-top: 6px !important;
		font-size: 6px;
		color: #efc870;
		letter-spacing: 0.06em;
	}
	.wire-token-row {
		border-top: 1px solid #5a5134;
		padding-top: 4px;
	}
	.channel-switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin: 6px 0 4px;
		padding: 4px 5px;
		background: #1a1c16;
		border: 1px solid #5a5134;
		font-size: 6px;
		color: #9d886f;
	}
	.channel-switch select {
		flex: 1;
		max-width: 150px;
		background: #0c0e0a;
		color: #79dfa0;
		border: 1px solid #3a5134;
		font: 7px var(--mono);
		padding: 2px 3px;
		cursor: pointer;
	}
	.market-board > div {
		display: grid;
		grid-template-columns: 1fr auto 37px;
		gap: 6px;
		margin-top: 5px;
		font-size: 6px;
	}
	.market-board .wire-quote-list {
		display: block;
		max-height: 104px;
		overflow-y: auto;
		margin-top: 5px;
		padding-right: 3px;
	}
	.market-board .wire-quote-row {
		display: grid;
		grid-template-columns: 1fr auto 37px;
		gap: 6px;
		margin-top: 5px;
		font-size: 6px;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	.market-board .wire-quote-row:hover,
	.market-board .wire-quote-row.active {
		background: #25291d;
	}
	.market-board strong {
		color: #e8d9b7;
	}
	.market-board em {
		color: #62d18b;
		font-style: normal;
		text-align: right;
	}
	.market-board em.down {
		color: #ed6c59;
	}
	.cabinet {
		position: absolute;
		left: 33px;
		bottom: 0;
		width: 62px;
		height: 48px;
		box-sizing: border-box;
		padding: 4px 5px 3px;
		background: linear-gradient(90deg, #414840 0 10%, #697167 11% 78%, #4d544d 79% 100%);
		border: 3px solid #252a25;
		box-shadow: inset 2px 2px #9da69a, inset -3px 0 #30362f, 3px 4px 0 rgba(25, 12, 6, 0.35);
	}
	.cabinet::before {
		content: 'MARKET FILES';
		position: absolute;
		left: 7px;
		top: -8px;
		padding: 1px 3px;
		background: #d5bf7a;
		color: #302818;
		border: 1px solid #403821;
		font: 4px/1 var(--mono, monospace);
		letter-spacing: 0.05em;
	}
	.cabinet i {
		position: relative;
		display: block;
		height: 11px;
		margin-bottom: 1px;
		background: linear-gradient(#778077, #596159);
		border: 1px solid #30362f;
		border-bottom: 2px solid #30362f;
		box-shadow: inset 1px 1px rgba(214, 222, 210, 0.32);
	}
	.cabinet i::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 4px;
		width: 12px;
		height: 2px;
		transform: translateX(-50%);
		background: #20251f;
		box-shadow: 0 1px #abb29e;
	}
	/* The desk's original decor: the market wire's horse is just the black-chess-knight glyph in brass. */
	.horse {
		/* left/top come from the drag position inline style; width/height anchor from the top-left. */
		position: absolute;
		width: 44px;
		height: 44px;
		filter: drop-shadow(3px 3px 0 #402711);
	}
	.horse-head {
		position: absolute;
		display: block;
		left: 0;
		bottom: 0;
		font: 44px/1 var(--pixel, var(--mono, monospace));
		color: #e3bd61;
		text-shadow: 2px 2px 0 #5b3518, -1px 0 #5b3518, 1px 0 #5b3518, 0 -1px #5b3518, 0 1px #5b3518;
	}

	.plant {
		position: absolute;
		width: 48px;
		height: 72px;
	}
	.plant.tall {
		right: 3px;
		bottom: 0;
	}
	.plant:after {
		content: '';
		position: absolute;
		left: 11px;
		bottom: 0;
		width: 31px;
		height: 25px;
		background: linear-gradient(90deg, #9e542d, #c17138 47%, #813d23);
		border: 3px solid #402517;
		box-shadow: inset 2px 2px #dd8a47, inset -3px -2px #5f2c1b, 2px 3px rgba(22, 9, 4, 0.34);
	}
	.plant::before {
		content: '';
		position: absolute;
		left: 15px;
		bottom: 24px;
		width: 20px;
		height: 40px;
		background: #264a29;
		clip-path: polygon(48% 0, 62% 37%, 100% 4%, 76% 51%, 100% 59%, 58% 65%, 69% 100%, 48% 76%, 25% 100%, 37% 64%, 0 62%, 23% 49%, 0 8%, 37% 37%);
		filter: drop-shadow(2px 2px #16321e);
	}
	.plant i {
		position: absolute;
		left: 22px;
		bottom: 19px;
		width: 12px;
		height: 47px;
		background: linear-gradient(90deg, #274b2c, #4f803b);
		clip-path: polygon(50% 0, 100% 65%, 65% 55%, 65% 100%, 35% 100%, 35% 55%, 0 65%);
	}
	.plant i:nth-child(2) {
		transform: rotate(38deg) translateY(2px);
		height: 39px;
	}
	.plant i:nth-child(3) {
		transform: rotate(-42deg) translateY(2px);
		height: 36px;
	}
	.wire-decor-piece {
		position: absolute;
		left: auto;
		top: auto;
		right: auto;
		bottom: auto;
		z-index: 70;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.wire-decor-piece.is-dragging {
		z-index: 95;
		cursor: grabbing;
	}
	.wire-decor-piece.horse {
		font-size: inherit;
	}
	.wire-decor-piece.cabinet {
		left: auto;
		bottom: auto;
	}
	.wire-decor-piece.plant.tall {
		right: auto;
		bottom: auto;
	}

	.office-floor {
		position: relative;
		height: auto;
		min-height: 580px;
		padding: 12px 14px 64px;
		box-sizing: border-box;
		/* Polished forest-green marble HQ floor with a brass inlay strip where it meets the wall -
		   it picks up the banker's lamps, the PHF mug, and the brass trim on the desk props. */
		background:
			linear-gradient(180deg, #2a221a 0 6px, #b08d4a 6px 8px, transparent 8px),
			linear-gradient(180deg, #1f3129 0%, #19281f 55%, #121d17 100%);
		box-shadow: inset 0 10px 18px rgba(0, 0, 0, 0.45);
		overflow: visible;
	}
	.office-floor:before {
		content: '';
		position: absolute;
		inset: 8px 0 0;
		/* 48px tiles with dark grout, pale marble veining, and a soft overhead sheen. */
		background:
			radial-gradient(ellipse 70% 40% at 50% 8%, rgba(150, 200, 170, 0.12), transparent 70%),
			repeating-linear-gradient(118deg, transparent 0 37px, rgba(190, 220, 200, 0.07) 37px 38px, transparent 38px 91px),
			repeating-linear-gradient(64deg, transparent 0 53px, rgba(190, 220, 200, 0.05) 53px 54px, transparent 54px 127px),
			repeating-linear-gradient(90deg, rgba(5, 12, 8, 0.55) 0 1px, transparent 1px 48px),
			repeating-linear-gradient(0deg, rgba(5, 12, 8, 0.55) 0 1px, transparent 1px 48px),
			repeating-conic-gradient(rgba(255, 255, 255, 0.035) 0 25%, rgba(0, 0, 0, 0.08) 0 50%) 0 0 / 96px 96px;
		transform: perspective(480px) rotateX(7deg);
		transform-origin: top;
		pointer-events: none;
	}

	.office-flag {
		position: absolute;
		z-index: 72;
		width: 92px;
		height: 64px;
		color: #d7bd80;
		font-size: 7px;
		text-align: center;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.office-flag.is-dragging {
		z-index: 95;
		cursor: grabbing;
	}
	.flag-pole {
		position: absolute;
		top: -2px;
		left: 5px;
		z-index: 3;
		width: 7px;
		height: 58px;
		box-sizing: border-box;
		background: #c08a48;
		border: 1px solid #43291b;
		box-shadow: 2px 0 #e0ad5d, 4px 0 #4b2c1b;
		pointer-events: none;
	}
	.flag-pole::before {
		content: '';
		position: absolute;
		top: -5px;
		left: -3px;
		width: 11px;
		height: 5px;
		box-sizing: border-box;
		background: #d7a45a;
		border: 1px solid #43291b;
	}
	.flag-pole::after {
		content: '';
		position: absolute;
		bottom: -4px;
		left: -4px;
		width: 15px;
		height: 4px;
		background: #744625;
		border: 1px solid #3a2116;
	}
	.flag-cloth {
		position: absolute;
		top: 3px;
		left: 10px;
		z-index: 1;
		width: 70px;
		height: 38px;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		overflow: hidden;
		background: #24150f;
		border: 2px solid #8f6539;
		box-shadow: 3px 3px 0 rgba(0,0,0,.35);
	}
	.flag-cloth img { display:block; min-width:0; min-height:0; max-width:100%; max-height:100%; width:100%; height:100%; object-fit:cover; image-rendering:auto; }
	.floor-light {
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 50% 0, rgba(235, 190, 110, 0.16), transparent 60%);
		pointer-events: none;
	}
	.back-staff {
		/* Hosts mariachi over Nora (center staff) */
		position: relative;
		z-index: 4;
		box-sizing: border-box;
		min-height: 220px;
		margin: 4px 12px 12px;
		padding: 24px 16px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border: 2px solid rgba(176, 141, 74, 0.45);
		background: rgba(4, 10, 7, 0.3);
		/* Sit on the carpet - no divider ...perch" line under feet */
		overflow: visible;
	}
	.back-staff :global(.mariachi) {
		z-index: 20;
	}
	.staff-zone-sign {
		position: absolute;
		left: 9px;
		top: 4px;
		right: 9px;
		display: flex;
		justify-content: space-between;
		font-size: 7px;
		letter-spacing: 0.12em;
		color: #d1b16a;
		pointer-events: none;
	}
	.staff-zone-sign b {
		font-size: 6px;
		color: #9d886f;
	}
	.staff-row {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: 14px;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		padding: 10px 8px 6px;
		margin: 0 auto;
		overflow: visible;
		box-sizing: border-box;
	}
	.staff-row :global(.character) {
		flex: 0 0 auto;
		width: 128px;
		min-width: 118px;
		max-width: 132px;
	}
	.staff-row :global(.character:nth-child(even)) {
		transform: translateY(6px);
	}
	.desk-zones {
		position: relative;
		z-index: 7;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 58px minmax(0, 1fr);
		height: auto;
		min-height: 280px;
		margin: 0 0 8px;
		padding: 8px 18px 28px 12px;
		gap: 4px;
		box-sizing: border-box;
		overflow: visible;
	}
	.desk-zone {
		position: relative;
		min-width: 0;
		padding: 18px 6px 18px;
		border: 2px solid rgba(176, 141, 74, 0.45);
		background: rgba(4, 10, 7, 0.3);
		transition: box-shadow 0.4s;
		overflow: visible;
		box-sizing: border-box;
	}
	.desk-zone.active {
		box-shadow: inset 0 0 28px rgba(72, 217, 137, 0.11);
	}
	.short-zone.active {
		box-shadow: inset 0 0 28px rgba(239, 100, 78, 0.12);
	}
	.zone-sign {
		position: absolute;
		left: 9px;
		top: 4px;
		right: 9px;
		display: flex;
		justify-content: space-between;
		font-size: 7px;
		letter-spacing: 0.12em;
		color: #72d99a;
	}
	.zone-sign b {
		font-size: 6px;
		color: #d1b16a;
	}
	.short-zone .zone-sign {
		color: #ef7767;
	}
	.trader-row {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: 0;
		min-width: 0;
		padding: 18px 0 8px;
		box-sizing: border-box;
		overflow: visible;
	}
	.trader-row :global(.character) {
		flex: 1 1 0;
		width: auto;
		min-width: 0;
		max-width: 128px;
	}
	.trader-row :global(.thought) {
		max-width: min(115px, calc(100% + 8px));
	}
	.trader-row :global(.character:nth-child(even)) {
		transform: none;
	}
	.aisle {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 33px;
		color: #b8a070;
		font-size: 6px;
		text-align: center;
		letter-spacing: 0.13em;
	}
	.aisle i {
		display: block;
		width: 3px;
		height: 34px;
		margin: 5px 0;
		background: repeating-linear-gradient(#b08d4a 0 6px, transparent 6px 12px);
	}
	/* Draggable lounge sofa - was static scenery, now a lounge-decor-piece like the table/plant. */
	/* Oxblood leather chesterfield: rolled arms, tufted cushions with brass rivets, short wood legs. */
	.sofa {
		width: 105px;
		height: 50px;
		background: linear-gradient(160deg, #7a3530 0%, #5a231f 55%, #431a17 100%);
		border: 3px solid #2a1210;
		border-radius: 9px 9px 3px 3px;
		box-shadow: inset 0 -15px #3a1613, inset 0 2px #9a4a42;
	}
	.sofa-arm {
		position: absolute;
		top: -6px;
		bottom: -3px;
		width: 13px;
		background: linear-gradient(160deg, #7a3530, #431a17 85%);
		border: 3px solid #2a1210;
		border-radius: 7px 7px 3px 3px;
		box-shadow: inset 1px 1px #9a4a42;
	}
	.sofa-arm-l {
		left: -9px;
	}
	.sofa-arm-r {
		right: -9px;
	}
	.sofa-leg {
		position: absolute;
		bottom: -8px;
		width: 6px;
		height: 9px;
		background: linear-gradient(180deg, #d9a94a, #8a6a34);
		border: 1px solid #5b4420;
	}
	.sofa-leg-l {
		left: 11px;
	}
	.sofa-leg-r {
		right: 11px;
	}
	.sofa i {
		position: absolute;
		top: 6px;
		width: 41px;
		height: 25px;
		background: linear-gradient(160deg, #944038 0%, #6b2b26 60%, #4c1e1a 100%);
		border: 2px solid #2a1210;
		border-radius: 3px;
		box-shadow: inset 1px 1px #b8564a, inset -2px -2px #341210;
	}
	.sofa i::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 3px;
		height: 3px;
		margin: -1.5px 0 0 -1.5px;
		background: #d9a94a;
		border-radius: 50%;
		box-shadow: 0 0 0 1px #2a1210;
	}
	.sofa i:first-child {
		left: 6px;
	}
	.sofa i:last-child {
		right: 6px;
	}
	.coffee-table {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 77px;
		height: 25px;
		background: linear-gradient(#a46034 0 32%, #734021 33% 100%);
		border: 3px solid #331d12;
		transform: skewX(-8deg);
		box-shadow: inset 0 2px #d1884b, inset 0 -4px #4c2816, 3px 4px rgba(20, 8, 3, 0.3);
	}
	.coffee-table::before,
	.coffee-table::after {
		content: '';
		position: absolute;
		top: 20px;
		width: 7px;
		height: 11px;
		background: #4b2817;
		border: 2px solid #2a160c;
	}
	.coffee-table::before { left: 8px; }
	.coffee-table::after { right: 8px; }
	.coffee-table span {
		display: block;
		width: 38px;
		margin: 2px 5px;
		background: #ead9a3;
		color: #3d2918;
		font-size: 5px;
		transform: rotate(-7deg);
		box-shadow: 1px 1px #513b20;
	}
	.lounge-decor-piece {
		position: absolute;
		z-index: 65;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.lounge-decor-piece.is-dragging {
		z-index: 95;
		cursor: grabbing;
	}
	.lounge-decor-piece.coffee-table {
		bottom: auto;
	}
	.lounge-plant {
		right: auto;
		bottom: auto;
		transform: scale(0.78) rotate(2deg);
		transform-origin: bottom left;
		filter: saturate(1.14);
	}

	.clipboard-panel {
		position: absolute;
		z-index: 70;
		box-sizing: border-box;
		width: 278px;
		min-height: 270px;
		padding: 19px 16px 13px;
		background: #d5bd84;
		color: #382719;
		border: 4px solid #5b3a22;
		box-shadow:
			7px 7px 0 rgba(25, 10, 4, 0.48),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
		font-family: var(--mono);
		margin: 0;
		touch-action: none;
		user-select: none;
		cursor: grab;
	}
	.clipboard-panel.is-dragging,
	.clipboard-panel.is-dragging .clip {
		cursor: grabbing;
	}
	.clipboard-panel:before {
		content: '';
		position: absolute;
		inset: 6px;
		border: 1px solid rgba(91, 58, 34, 0.25);
		pointer-events: none;
	}
	.clip {
		position: absolute;
		top: -9px;
		left: 83px;
		width: 70px;
		height: 20px;
		background: #74543a;
		border: 3px solid #392619;
		box-shadow: inset 0 3px #9e7957;
		cursor: grab;
	}
	.clipboard-panel header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 10px;
		padding-bottom: 8px;
		border-bottom: 3px solid #5d4930;
	}
	.clipboard-panel header small,
	.clipboard-panel header strong {
		display: block;
	}
	.clipboard-panel header small {
		font-size: 7px;
		font-weight: 700;
		opacity: 0.82;
		letter-spacing: 0.04em;
	}
	.clipboard-panel header strong {
		font-size: 14px;
		line-height: 1.1;
	}
	.clipboard-panel header > b {
		font-size: 8px;
		color: #355f4a;
		letter-spacing: 0.03em;
	}
	.clipboard-panel[data-side='short'] header > b {
		color: #9a4436;
	}
	.panel-status {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		margin: 8px 0 7px;
		padding: 4px 7px;
		background: #f6e7b7;
		border: 2px solid #6f5230;
		font-size: 8px;
		font-weight: 900;
		text-transform: uppercase;
	}
	.panel-status i {
		width: 7px;
		height: 7px;
		background: #6abf84;
	}
	.panel-status[data-status='thinking'] i {
		background: #d4a94f;
	}
	.panel-status[data-status='flat'] i,
	.panel-status[data-status='watching'] i {
		background: #807970;
	}
	.panel-status[data-status='stress'] i {
		background: #c8503f;
	}
	.panel-status[data-status='celebrating'] i {
		background: #4ecf72;
		box-shadow: 0 0 4px #4ecf72;
	}
	.clipboard-panel dl {
		margin: 0 0 3px;
	}
	.clipboard-panel dl div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 0;
		border-bottom: 1px dotted rgba(70, 45, 25, 0.55);
		font-size: 8px;
		line-height: 1.2;
	}
	.clipboard-panel dt {
		opacity: 0.82;
		font-weight: 700;
		letter-spacing: 0.025em;
	}
	.clipboard-panel dd {
		margin: 0;
		font-weight: 900;
		font-size: 8.5px;
		text-align: right;
	}
	.positive {
		color: #287348;
	}
	.negative {
		color: #9c392e;
	}
	.clipboard-panel p {
		margin: 9px 0;
		font-size: 8px;
		font-weight: 700;
		line-height: 1.45;
	}
	.clipboard-panel footer {
		font-size: 7px;
		font-weight: 700;
		color: #694b2c;
		border-top: 2px solid #80613d;
		padding-top: 6px;
	}
	.staff-sheet {
		margin: 15px 0 8px;
		padding: 12px;
		background: #f0e2b9;
		border: 1px solid #7f6240;
		font-size: 11px;
		line-height: 1.35;
		font-weight: 900;
	}
	.staff-details {
		display: grid;
		gap: 5px;
		margin-top: 8px;
	}
	.staff-details p {
		margin: 0;
		padding: 7px 8px;
		background: #211914;
		border-left: 3px solid #d2a45d;
		color: #f3e2b6;
		font-size: 9px;
		font-weight: 700;
		line-height: 1.45;
		letter-spacing: 0.01em;
		overflow-wrap: anywhere;
	}
	.staff-card {
		min-height: 150px;
	}

	.foreground-desk {
		position: relative;
		z-index: 55;
		height: 150px;
		background: linear-gradient(#a76530 0 9px, #78451f 9px 100%);
		border-top: 7px solid #3d2516;
		box-shadow:
			0 -12px 24px rgba(24, 9, 3, 0.45),
			inset 0 5px #c57c3c;
		overflow: visible;
	}
	.desk-edge {
		position: absolute;
		inset: auto 0 0;
		height: 14px;
		background: #462817;
		border-top: 3px solid #9b5a2d;
	}
	.book-stack {
		position: absolute;
		left: 18px;
		bottom: 13px;
		width: 155px;
	}
	.book-stack .book-spine {
		position: relative;
		display: block;
		width: 100%;
		height: 27px;
		padding: 5px 10px 4px 13px;
		border: 2px solid #24150d;
		border-left-width: 6px;
		box-shadow: inset 0 2px rgba(255, 255, 255, 0.18), inset 0 -3px rgba(0, 0, 0, 0.26), 3px 3px 0 rgba(38, 15, 6, 0.28);
		color: #ead7a1;
		font-size: 6px;
		font-weight: 900;
		letter-spacing: 0.08em;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		line-height: 1.15;
		transition: filter 0.12s ease, transform 0.12s ease;
	}
	.book-stack .book-spine::before {
		content: '';
		position: absolute;
		left: 3px;
		top: 3px;
		bottom: 3px;
		width: 2px;
		background: rgba(244, 219, 158, 0.55);
		box-shadow: 3px 0 rgba(21, 10, 5, 0.44);
	}
	.book-stack .book-spine::after {
		content: '';
		position: absolute;
		left: 12px;
		right: 8px;
		bottom: 3px;
		height: 1px;
		background: rgba(246, 221, 157, 0.27);
	}
	.book-stack .book-spine:hover,
	.book-stack .book-spine:focus-visible {
		filter: brightness(1.18);
		transform: translateX(3px);
		outline: none;
		z-index: 1;
		position: relative;
	}
	.book-stack .book-spine:focus-visible {
		box-shadow:
			inset 0 2px rgba(255, 255, 255, 0.12),
			0 0 0 2px #f0d9a8;
	}
	.book-stack .spine-0 {
		background: linear-gradient(90deg, #342719 0 14%, #58442f 14% 100%);
	}
	.book-stack .spine-1 {
		width: 145px;
		background: linear-gradient(90deg, #4d1f1a 0 14%, #853b32 14% 100%);
	}
	.book-stack .spine-2 {
		width: 135px;
		background: linear-gradient(90deg, #15352f 0 14%, #326156 14% 100%);
	}
	.book-stack .spine-3 {
		width: 148px;
		background: linear-gradient(90deg, #40301f 0 14%, #776245 14% 100%);
	}
	.wsj {
		position: absolute;
		left: 185px;
		top: 20px;
		width: 130px;
		height: 94px;
		padding: 8px 7px 6px;
		box-sizing: border-box;
		background: linear-gradient(105deg, #eee7d0, #d8d0b6 78%, #c9bea4);
		color: #2d2a25;
		border: 2px solid #403a31;
		transform: rotate(-2deg);
		overflow: hidden;
		box-shadow: 4px 5px 0 rgba(42, 22, 10, 0.35), inset 0 0 0 2px rgba(255, 252, 234, 0.5);
	}
	.wsj:not(.expanded)::before {
		content: 'MARKET EDITION';
		display: block;
		width: fit-content;
		padding: 1px 3px;
		margin-bottom: 3px;
		background: #7d3028;
		color: #f7edd0;
		font: 5px/1 var(--mono, monospace);
		letter-spacing: 0.08em;
	}
	.wsj header {
		font: bold 8px/1 Georgia, serif;
		letter-spacing: 0.02em;
		border-top: 1px solid #554d41;
		border-bottom: 3px solid #333;
		white-space: nowrap;
		overflow: hidden;
	}
	.wsj b,
	.wsj .wsj-hed {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
		margin: 5px 0 0;
		font: bold 9px/1.12 Georgia, serif;
		word-break: break-word;
	}
	.legal-pad {
		position: absolute;
		left: 325px;
		top: 16px;
		width: 105px;
		height: 105px;
		padding: 12px 10px 8px 16px;
		box-sizing: border-box;
		background:
			linear-gradient(90deg, transparent 0 10px, rgba(174, 74, 45, 0.45) 10px 11px, transparent 11px),
			repeating-linear-gradient(#f6df8c 0 13px, #c9b365 13px 14px);
		color: #3d3422;
		border: 3px solid #6e5d37;
		transform: rotate(1deg);
		font-size: 8px;
		font-weight: 700;
		line-height: 1.2;
		text-shadow: 0 1px rgba(255, 250, 190, 0.64);
		box-shadow: 4px 5px 0 rgba(45, 22, 8, 0.3), inset 0 0 0 2px rgba(255, 248, 180, 0.46);
		overflow: hidden;
	}
	.legal-pad::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 3px;
		height: 6px;
		background: repeating-linear-gradient(90deg, #584626 0 5px, #d4b766 5px 9px);
		border-bottom: 1px solid #69532d;
	}
	.legal-pad header {
		position: relative;
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.04em;
		border-bottom: 2px solid #594626;
	}
	.legal-pad p {
		margin: 4px 0;
		line-height: 1.2;
	}
	.legal-pad span {
		position: absolute;
		right: 17px;
		bottom: 5px;
		width: 4px;
		height: 74px;
		background: #242521;
		transform: rotate(36deg);
		box-shadow: 1px 0 #b7a367;
	}
	.foreground-monitor {
		position: absolute;
		left: 50%;
		bottom: 4px;
		width: 325px;
		height: 176px;
		padding: 0;
		background: #a99e82;
		border: 5px solid #403a31;
		border-radius: 8px 8px 3px 3px;
		box-shadow:
			inset 4px 4px #d4c9a6,
			6px 6px 0 rgba(32, 14, 6, 0.45);
		transform: translateX(-50%);
		cursor: pointer;
		z-index: 5;
	}
	.foreground-monitor:hover,
	.foreground-monitor:focus-visible {
		outline: 2px solid #efc870;
		outline-offset: 3px;
	}
	.monitor-bezel {
		position: absolute;
		inset: 12px 14px 24px;
		border: 4px solid #35342b;
		background: #06120d;
		overflow: hidden;
	}
	.monitor-foot {
		position: absolute;
		left: 130px;
		bottom: -18px;
		width: 67px;
		height: 18px;
		background: #8e846d;
		border: 4px solid #3e3930;
		border-top: 0;
	}
	.pinned-head {
		display: flex;
		justify-content: space-between;
		padding: 6px 8px 3px;
		color: #70dfa1;
		background: #07150f;
		font-size: 7px;
	}
	.pinned-head b {
		color: #e9c76d;
	}
	.pinned-chart {
		height: 91px;
	}
	.pinned-risk {
		padding: 4px 8px;
		color: #e9c76d;
		background: #07150f;
		font-size: 7px;
	}
	.keyboard-main {
		position: absolute;
		left: 790px;
		top: 52px;
		width: 180px;
		height: 57px;
		padding: 0;
		background: linear-gradient(#d1c6a8 0 12%, #9c937d 13% 100%);
		border: 4px solid #302d27;
		transform: skewX(-12deg);
		box-shadow: 5px 5px 0 rgba(40, 17, 7, 0.38), inset 0 2px #efe2bf, inset 0 -3px #696254;
		cursor: pointer;
		z-index: 6;
	}
	.keyboard-main:hover,
	.keyboard-main:focus-visible {
		background: linear-gradient(#e3d7b8 0 12%, #b6aa8e 13% 100%);
		outline: 2px solid #efc870;
		outline-offset: 2px;
	}
	.keyboard-main:active {
		transform: skewX(-12deg) translateY(1px);
	}
	.keyboard-main i {
		position: absolute;
		inset: 8px 9px 7px;
		border: 2px solid #4a463e;
		background:
			repeating-linear-gradient(90deg, #5a564c 0 8px, #ded3b5 8px 10px),
			repeating-linear-gradient(0deg, transparent 0 8px, #716b5d 8px 10px),
			#c4baa0;
		box-shadow: inset 0 2px rgba(255, 250, 224, 0.7), inset 0 -2px #736c5c;
	}
	.keyboard-main i::before {
		content: '';
		position: absolute;
		left: 28%;
		right: 18%;
		bottom: 3px;
		height: 6px;
		background: #4c493f;
		box-shadow: inset 0 1px #847d6a;
	}
	/* Phone tucked small - reduces desk clutter */
	.phone-main {
		position: absolute;
		left: 720px;
		top: 18px;
		width: 56px;
		height: 38px;
		background: #a59c83;
		border: 3px solid #3b3731;
		border-radius: 6px;
		opacity: 0.9;
		z-index: 4;
	}
	.phone-main span {
		position: absolute;
		left: 4px;
		top: -7px;
		width: 48px;
		height: 11px;
		background: #797365;
		border: 3px solid #3a3630;
		border-radius: 8px;
	}
	.phone-main i {
		position: absolute;
		left: 14px;
		top: 12px;
		width: 26px;
		height: 16px;
		background: repeating-radial-gradient(#4c4940 0 2px, #aaa085 2px 5px);
	}
	/* Individually draggable desk props - scene-frame absolute coords */
	.desk-prop {
		position: absolute;
		z-index: 60;
		pointer-events: auto;
		touch-action: none;
		user-select: none;
		/* Stay visible - never gate on is-ready (expand/reflow races were blanking props) */
		visibility: visible;
		opacity: 1;
	}
	/* Force absolute over later .calculator/.coffee/.mouse-pad/.desk-settings-btn relative rules */
	.calculator.desk-prop,
	.coffee.desk-prop,
	.mouse-pad.desk-prop,
	.desk-settings-btn.desk-prop,
	.desk-break-btn.desk-prop,
	.keyboard-main.desk-prop,
	.wsj.desk-prop,
	.legal-pad.desk-prop {
		position: absolute;
	}
	.desk-prop.is-dragging {
		visibility: visible;
	}
	.desk-prop.is-dragging {
		cursor: grabbing;
		z-index: 80;
	}
	.desk-prop.compact {
		transform: scale(0.86);
		transform-origin: center bottom;
	}
	.wsj.desk-prop.compact {
		transform: rotate(-2deg) scale(0.86);
		transform-origin: center bottom;
	}
	.legal-pad.desk-prop.compact {
		transform: rotate(1deg) scale(0.86);
		transform-origin: center bottom;
	}
	.keyboard-main.desk-prop.compact {
		transform: skewX(-12deg) scale(0.86);
		transform-origin: center bottom;
	}
	.wsj.desk-prop,
	.legal-pad.desk-prop {
		cursor: grab;
	}
	.wsj.desk-prop.is-dragging,
	.legal-pad.desk-prop.is-dragging {
		cursor: grabbing;
	}
	.wsj-sample {
		display: inline-block;
		margin-top: 2px;
		padding: 0 3px;
		font: 6px var(--mono);
		color: #7a3a2a;
		border: 1px solid #7a3a2a;
	}
	.wsj-live {
		display: inline-block;
		margin-top: 2px;
		padding: 0 3px;
		color: #8f261a;
		font: bold 9px/1.25 monospace;
		letter-spacing: 0.08em;
		border: 1px solid #8f261a;
		animation: wsj-live-pulse 1.8s ease-in-out infinite;
	}
	@keyframes wsj-live-pulse {
		50% { opacity: 0.48; }
	}
	.wsj.expanded,
	.wsj:has(.wsj-more) {
		height: auto;
		width: min(390px, calc(100vw - 28px));
		max-height: min(480px, calc(100vh - 28px));
		min-height: 300px;
		/* Must stay above .foreground-desk (z 55) - old z-index:18 hid the paper under the wood */
		z-index: 300005;
		overflow: auto;
		box-shadow: 7px 9px 0 rgba(20, 10, 4, 0.5);
		transform: rotate(-1deg);
		padding: 12px;
	}
	.wsj.expanded header {
		font-size: 12px;
		border-bottom-width: 3px;
	}
	.wsj-edition {
		color: #2d2a25;
	}
	.wsj-kicker,
	.wsj-byline,
	.wsj-dek {
		margin: 7px 0;
		font: 10px/1.25 Georgia, serif;
	}
	.wsj-kicker {
		font-family: var(--mono, monospace);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	.wsj-edition h2 {
		margin: 5px 0;
		font: bold 20px/1.05 Georgia, serif;
		letter-spacing: -0.025em;
	}
	.legal-expanded-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300010;
		display: grid;
		place-items: center;
		padding: 14px;
		background: rgba(12, 7, 4, 0.68);
	}
	.legal-expanded {
		position: relative;
		box-sizing: border-box;
		width: min(440px, calc(100vw - 28px));
		max-height: min(82vh, 640px);
		margin: 0;
		padding: 26px 24px 22px;
		overflow: auto;
		background: repeating-linear-gradient(#f1d77b 0 32px, #c9b365 32px 34px);
		color: #21170b;
		border: 3px solid #6e5d37;
		box-shadow: 9px 11px 0 rgba(20, 10, 4, 0.58);
		transform: rotate(1deg);
		font: 700 16px/1.35 var(--mono);
	}
	.legal-expanded h2 {
		margin: 0 0 18px;
		padding-bottom: 8px;
		border-bottom: 3px solid #594626;
		font-size: clamp(20px, 4vw, 28px);
		letter-spacing: 0.08em;
	}
	.legal-expanded .expanded-close {
		position: absolute;
		top: 8px;
		right: 9px;
		width: 32px;
		height: 32px;
		padding: 0;
		background: #594626;
		color: #f9e7a3;
		border: 2px solid #332415;
		font: 900 18px/1 var(--mono);
		cursor: pointer;
	}
	.legal-expanded .expanded-close:hover,
	.legal-expanded .expanded-close:focus-visible {
		background: #2d2114;
		outline: 2px solid #21170b;
		outline-offset: 2px;
	}
	.legal-expanded p {
		margin: 11px 0;
	}
	.legal-expanded-note {
		font-size: 14px;
		font-weight: 900;
	}
	.legal-expanded-lines {
		border-top: 2px solid rgba(89, 70, 38, 0.72);
	}
	.legal-expanded-lines p {
		margin: 0;
		padding: 10px 0;
		border-bottom: 2px solid rgba(89, 70, 38, 0.5);
		word-break: break-word;
	}
	.legal-expanded-lines strong {
		color: #7a2b1d;
	}
	.legal-expanded-empty {
		font-weight: 900;
	}
	.legal-expanded-ta {
		font-weight: 900;
		color: #594626;
	}
	.legal-expanded small {
		display: block;
		margin-top: 18px;
		font: 900 10px/1.3 var(--mono);
		letter-spacing: 0.04em;
		color: #594626;
	}
	.wsj-story-link {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: #846d3c;
		text-underline-offset: 2px;
	}
	.wsj-story-link:hover {
		color: #604621;
	}
	.wsj-byline {
		font-weight: 700;
	}
	.wsj-dek {
		padding: 7px 0;
		border-top: 1px solid #554d41;
		border-bottom: 1px solid #554d41;
	}
	.wsj-more {
		margin: 8px 0 0;
		padding: 0 0 0 18px;
		font: 12px/1.3 Georgia, serif;
		box-sizing: border-box;
	}
	.wsj-more li {
		margin: 0 0 8px;
		overflow: visible;
		text-overflow: clip;
	}
	.pos-note {
		color: #7a3a2a !important;
		font-weight: 700;
	}
	.pos-ta {
		opacity: 0.75;
		font-size: 6px !important;
	}
	.wire-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		margin: 5px 0 4px;
	}
	.wire-cat {
		padding: 2px 5px;
		font: 6px var(--mono);
		letter-spacing: 0.06em;
		color: #9d886f;
		background: #1a1c16;
		border: 1px solid #5a5134;
		cursor: pointer;
	}
	.wire-cat.active {
		color: #0c0e0a;
		background: #efc870;
		border-color: #efc870;
	}
	.wire-note {
		margin: 0 0 4px;
		font: 6px var(--mono);
		color: #9d886f;
	}

	.mouse-pad {
		flex: 0 0 auto;
		width: 88px;
		height: 54px;
		padding: 0;
		background: #27362d;
		border: 3px solid #171d18;
		border-radius: 4px 5px 6px 5px;
		transform: rotate(-2deg);
		cursor: pointer;
		box-shadow:
			4px 4px 0 rgba(40, 17, 7, 0.35),
			inset 2px 2px 0 rgba(152, 178, 139, 0.18),
			inset -2px -2px 0 rgba(6, 12, 8, 0.45);
	}
	.mouse-pad::before {
		content: '';
		position: absolute;
		inset: 5px;
		border: 1px dashed rgba(204, 169, 103, 0.52);
		box-shadow: inset 0 0 0 1px rgba(8, 19, 12, 0.62);
	}
	.mouse-pad::after {
		content: '';
		position: absolute;
		left: 50%;
		top: -8px;
		width: 3px;
		height: 10px;
		background: #151b17;
		border-left: 1px solid #667564;
		transform: translateX(-50%);
		box-shadow: 1px 0 #09100c;
	}
	.mouse-pad:hover,
	.mouse-pad:focus-visible {
		outline: 2px solid #efc870;
		outline-offset: 2px;
		background: #344838;
	}
	.mouse-pad:active {
		transform: rotate(-2deg) translateY(1px);
	}
	.pad-target {
		position: absolute;
		left: 50%;
		top: 52%;
		z-index: 1;
		width: 25px;
		height: 33px;
		transform: translate(-50%, -50%);
		border: 2px solid #4d493e;
		border-radius: 11px 11px 9px 9px;
		background:
			linear-gradient(90deg, transparent 47%, #645f51 47% 53%, transparent 53%),
			linear-gradient(#d1c6aa 0 44%, #a89e87 45% 100%);
		box-shadow:
			inset 2px 2px 0 rgba(255, 246, 218, 0.42),
			inset -2px -2px 0 rgba(69, 63, 52, 0.3),
			2px 2px 0 rgba(6, 13, 8, 0.5);
	}
	.pad-target::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 7px;
		width: 3px;
		height: 7px;
		transform: translate(-50%, -50%);
		border: 1px solid #3d433b;
		border-radius: 1px;
		background: #59685a;
	}
	.calculator {
		flex: 0 0 auto;
		width: 40px;
		height: 50px;
		padding: 4px;
		background: linear-gradient(90deg, #343a35, #202622 75%, #171b18);
		color: #b8e0be;
		border: 3px solid #111511;
		cursor: pointer;
		box-shadow: 3px 3px 0 rgba(40, 17, 7, 0.35), inset 1px 1px #596158;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.calc-display {
		display: block;
		padding: 2px 2px 1px;
		background: #8cae89;
		color: #102315;
		border: 2px solid #172319;
		box-shadow: inset 0 1px rgba(232, 255, 220, 0.58);
		font: 700 6px/1 var(--mono, monospace);
		text-align: right;
	}
	.calc-keys {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
	}
	.calc-keys i {
		display: grid;
		place-items: center;
		height: 7px;
		background: #c0b693;
		color: #25251e;
		box-shadow: inset 1px 1px #ece2be, inset -1px -1px #625c4d;
		font: 700 5px/1 var(--mono, monospace);
		font-style: normal;
	}
	.calculator:hover,
	.calculator:focus-visible {
		outline: 2px solid #efc870;
		outline-offset: 2px;
		background: #3e433d;
	}
	.coffee {
		flex: 0 0 auto;
		position: relative;
		container-type: inline-size;
		width: 72px;
		height: 88px;
		padding: 0;
		background: linear-gradient(90deg, #2f7050 0 14%, #245a41 14% 76%, #1a4230 76% 100%);
		border: 3px solid #0f1f18;
		border-radius: 3px 3px 12px 12px;
		box-sizing: border-box;
		box-shadow: inset 0 -6px rgba(0, 0, 0, 0.2), 3px 3px 0 rgba(20, 10, 5, 0.45);
		overflow: visible;
		cursor: pointer;
	}
	/* brass pinstripe near the foot, echoing the wall sign */
	.coffee::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 14%;
		height: 3px;
		background: #d9a94a;
		box-shadow: 0 -4px #0f1f18, 0 4px #0f1f18;
	}
	.coffee:hover,
	.coffee:focus-visible {
		outline: 2px solid #efc870;
		outline-offset: 2px;
	}
	.coffee.is-tripping {
		cursor: wait;
		opacity: 0.9;
	}
	/* brass lip with the coffee visible inside */
	.coffee .brew {
		position: absolute;
		left: -5px;
		right: -5px;
		top: -6px;
		height: 14px;
		background: #d9a94a;
		border: 3px solid #0f1f18;
		border-radius: 3px;
		box-sizing: border-box;
		box-shadow: inset 0 3px #f2d283;
	}
	.coffee .brew::after {
		content: '';
		position: absolute;
		left: 4px;
		right: 4px;
		top: 2px;
		height: 3px;
		background: #3a2214;
		box-shadow: 0 1px #5a3a20;
	}
	/* PHF monogram plaque, same brass tile as the wall sign */
	.coffee .plaque {
		position: absolute;
		left: 50%;
		top: 28%;
		width: 72%;
		height: 36%;
		display: grid;
		place-items: center;
		transform: translateX(-50%);
		background: #d9a94a;
		border: 2px solid #0f1f18;
		box-sizing: border-box;
		box-shadow: inset 0 0 0 2px #f2d283, 2px 2px 0 rgba(0, 0, 0, 0.35);
	}
	.coffee .plaque em {
		font: normal 900 17cqw/1 var(--pixel, var(--mono, monospace));
		letter-spacing: 0.04em;
		color: #2a1a0c;
		padding-left: 0.04em;
	}
	/* ear */
	.coffee i {
		position: absolute;
		right: -15px;
		top: 20%;
		width: 15px;
		height: 38%;
		border: 5px solid #245a41;
		border-left: 0;
		border-radius: 0 14px 14px 0;
		box-sizing: border-box;
		box-shadow: 2px 0 0 #0f1f18, 0 -2px 0 #0f1f18, 0 2px 0 #0f1f18;
	}
	/* saucer */
	.coffee u {
		position: absolute;
		left: -10px;
		right: -10px;
		bottom: -10px;
		height: 10px;
		text-decoration: none;
		background: #e8dcc0;
		border: 3px solid #0f1f18;
		border-radius: 2px 2px 9px 9px;
		box-sizing: border-box;
		box-shadow: inset 0 -3px #c9b891;
	}
	.coffee b {
		position: absolute;
		left: 50%;
		margin-left: -8px;
		top: -27px;
		width: 4px;
		height: 20px;
		background: rgba(235, 225, 205, 0.45);
		box-shadow: 8px -3px rgba(235, 225, 205, 0.35);
		animation: steam 2s ease-in-out infinite;
	}
	@container (max-width: 40px) {
		.coffee::before { height: 2px; box-shadow: 0 -2px #0f1f18, 0 2px #0f1f18; }
		.coffee .brew { left: -3px; right: -3px; top: -4px; height: 9px; border-width: 2px; }
		.coffee .brew::after { left: 2px; right: 2px; top: 1px; height: 2px; }
		.coffee .plaque { border-width: 1px; box-shadow: inset 0 0 0 1px #f2d283; }
		.coffee i { right: -9px; width: 9px; border-width: 3px; box-shadow: 1px 0 0 #0f1f18, 0 -1px 0 #0f1f18, 0 1px 0 #0f1f18; }
		.coffee u { left: -6px; right: -6px; bottom: -7px; height: 7px; border-width: 2px; }
		.coffee b { top: -20px; height: 12px; width: 3px; margin-left: -5px; box-shadow: 5px -2px rgba(235, 225, 205, 0.35); }
	}
	@keyframes steam {
		50% {
			transform: translateY(-4px);
			opacity: 0.3;
		}
	}
	/* Coffee sip - short full-scene trip, always clears */
	.coffee-trip {
		position: fixed;
		inset: 0;
		z-index: 300000;
		pointer-events: none;
		background:
			repeating-linear-gradient(
				0deg,
				transparent 0 2px,
				rgba(0, 0, 0, 0.18) 2px 3px
			),
			radial-gradient(ellipse at 50% 40%, rgba(255, 100, 180, 0.12), transparent 60%);
		mix-blend-mode: color-dodge;
		animation: coffee-trip-fx 3s ease-in-out forwards;
		filter: hue-rotate(0deg) saturate(1.4);
	}
	.coffee-trip::before,
	.coffee-trip::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.coffee-trip::before {
		background: linear-gradient(90deg, rgba(255, 0, 80, 0.12), transparent 40%, rgba(0, 255, 200, 0.1));
		mix-blend-mode: screen;
		animation: coffee-chroma 0.4s steps(2) infinite;
	}
	.coffee-trip::after {
		box-shadow: inset 0 0 80px rgba(20, 0, 40, 0.45);
		animation: coffee-wobble 0.35s ease-in-out infinite alternate;
	}
	@keyframes coffee-trip-fx {
		0% {
			opacity: 0;
			filter: hue-rotate(0deg) saturate(1);
		}
		12% {
			opacity: 1;
		}
		50% {
			filter: hue-rotate(160deg) saturate(2.2) contrast(1.15);
		}
		88% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			filter: hue-rotate(320deg) saturate(1);
		}
	}
	@keyframes coffee-chroma {
		0% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(2px, -1px);
		}
		100% {
			transform: translate(-2px, 1px);
		}
	}
	@keyframes coffee-wobble {
		from {
			transform: rotate(-0.6deg) scale(1.01);
		}
		to {
			transform: rotate(0.6deg) scale(1.02);
		}
	}
	.wire-status.price-pad {
		/* Same in-scene absolute drag pattern as clipboard / fax / pet / trash */
		position: absolute;
		z-index: 72;
		box-sizing: border-box;
		width: 170px;
		margin: 0;
		padding: 17px 8px 8px;
		background: #241914;
		border: 3px solid #5a3b27;
		box-shadow:
			inset 0 0 9px #000,
			6px 6px 0 rgba(25, 10, 4, 0.42);
		touch-action: none;
		user-select: none;
		cursor: grab;
		visibility: hidden;
	}
	.wire-status.price-pad.is-ready {
		visibility: visible;
	}
	.wire-status.price-pad.is-dragging,
	.wire-status.price-pad.is-dragging .clip {
		cursor: grabbing;
	}
	.wire-status .clip {
		left: 50%;
		transform: translateX(-50%);
	}
	.wire-status div {
		font-size: 6px;
		color: #9d886f;
	}
	.wire-status span {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 5px;
		background: #d09a45;
	}
	.wire-status span.dot-live {
		background: #59cf84;
		box-shadow: 0 0 5px #59cf84;
	}
	.wire-status strong {
		display: block;
		margin: 5px 0;
		color: #efc870;
		font-size: 18px;
	}
	.wire-status small {
		display: block;
		font-size: 6px;
		color: #bca58d;
	}
	.error-note {
		position: fixed;
		left: 12px;
		bottom: 12px;
		z-index: 100;
		padding: 8px 10px;
		background: #7d3028;
		color: #ffe0d4;
		border: 2px solid #c66b59;
		font-size: 8px;
	}
	/* -- Responsive: tablet (~768"1100) + phone (~375"480) -- */
	@media (max-width: 1100px) {
		.scene-frame {
			min-height: 0;
		}
		.upper-wall {
			grid-template-columns: minmax(160px, 200px) minmax(0, 1fr) minmax(180px, 230px);
			height: 260px;
		}
		.desk-zones {
			padding: 5px 10px 20px;
		}
		.clipboard-panel {
			max-width: calc(100vw - 16px);
		}
		.foreground-monitor {
			left: 50%;
			width: 300px;
		}
		.keyboard-main {
			left: 640px;
			width: 150px;
		}
		.phone-main {
			left: 580px;
		}
		.mouse-pad {
			width: 78px;
			height: 48px;
		}
		.calculator {
			width: 36px;
			height: 46px;
		}
		.coffee {
			width: 32px;
			height: 40px;
		}
	}

	/* Tablet: stack books, compress skyline, keep desk props readable */
	@media (max-width: 768px) {
		.scene {
			padding-bottom: env(safe-area-inset-bottom, 0);
		}
		.scene-frame {
			width: 100%;
			min-height: 0;
			overflow-x: hidden;
		}
		.upper-wall {
			display: grid;
			grid-template-columns: 1fr;
			grid-template-rows: auto auto auto;
			height: auto;
		}
		.left-wall {
			border-right: 0;
			border-bottom: 4px solid #8a6c34;
		}
		.right-wall {
			border-left: 0;
			border-top: 4px solid #8a6c34;
			min-height: 160px;
		}
		.window-wall {
			height: 160px;
			order: -1; /* panoramic skyline first on narrow */
		}
		.panoramic-skyline {
			inset: 8px 6px 0;
		}
		.window-wall::after {
			inset: 8px 6px 0;
		}
		.wire-decor-piece {
			display: none;
		}
		.fund-sign {
			margin: 10px 10px 8px;
		}
		.fund-sign strong {
			font-size: 10px;
		}
		.fund-sign small {
			font-size: 6px;
		}
		.whiteboard {
			margin: 8px 12px 12px;
		}
		.whiteboard p,
		.whiteboard b {
			font-size: 8px;
		}
		.market-board {
			margin: 10px 12px 8px;
			max-height: none;
		}
		.market-board header {
			font-size: 9px;
		}
		.channel-switch {
			font-size: 8px;
			padding: 6px 8px;
			gap: 8px;
		}
		.channel-switch select {
			max-width: none;
			font-size: 11px;
			padding: 6px 8px;
			min-height: 36px; /* touch-friendly */
		}
		.market-board > div {
			font-size: 9px;
			grid-template-columns: 1fr auto minmax(44px, auto);
		}
		.market-board .wire-quote-list {
			max-height: 180px;
		}
		.market-board .wire-quote-row {
			font-size: 9px;
			grid-template-columns: 1fr auto minmax(44px, auto);
		}

		.office-floor {
			height: auto;
			min-height: 420px;
			padding: 8px 8px 56px;
			overflow: visible;
		}
		.back-staff {
			min-height: 0;
			height: auto;
			margin: 4px 4px 8px;
			padding: 22px 6px 10px;
		}
		.staff-row {
			flex-wrap: wrap;
			justify-content: center;
			align-items: flex-end;
			gap: 8px 10px;
		}
		.staff-row :global(.character) {
			flex: 0 0 auto;
			width: 128px;
			max-width: 140px;
			min-width: 118px;
		}
		.staff-row :global(.character:nth-child(even)) {
			transform: none;
		}
		.desk-zones {
			display: flex;
			flex-direction: column;
			height: auto;
			min-height: 0;
			padding: 4px 4px 24px;
			gap: 10px;
		}
		.desk-zone {
			padding: 22px 6px 10px;
		}
		.zone-sign {
			font-size: 9px;
		}
		.zone-sign b {
			font-size: 8px;
		}
		.trader-row {
			flex-wrap: wrap;
			justify-content: center;
			align-items: flex-end;
			gap: 4px 2px;
			padding-top: 8px;
		}
		.trader-row :global(.character) {
			flex: 0 1 auto;
			width: 88px;
			max-width: 96px;
			min-width: 80px;
		}
		.trader-row :global(.character:nth-child(even)) {
			transform: none;
		}
		.aisle {
			flex-direction: row;
			justify-content: center;
			gap: 10px;
			padding: 6px 0;
			font-size: 8px;
			letter-spacing: 0.16em;
		}
		.aisle br {
			display: none;
		}
		.aisle i {
			width: 28px;
			height: 3px;
			margin: 0;
			background: repeating-linear-gradient(90deg, #b38961 0 6px, transparent 6px 12px);
		}
		.sofa.lounge-decor-piece {
			display: none; /* avoid overlap when floor stacks */
		}

		/* Foreground desk: flex layout for key controls; hide overflow props */
		.foreground-desk {
			height: auto;
			min-height: 0;
			padding: 12px 10px 18px;
			display: grid;
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.desk-edge {
			display: none;
		}
		.wsj,
		.keyboard-main,
		.phone-main,
		.calculator,
		.coffee {
			display: none;
		}
		.legal-pad,
		.legal-pad.desk-prop {
			position: relative;
			left: auto;
			top: auto;
			width: 100%;
			max-width: 280px;
			height: auto;
			min-height: 72px;
			margin: 0 auto;
			transform: none;
			font-size: 10px;
		}
		.foreground-monitor {
			position: relative;
			left: auto;
			bottom: auto;
			width: 100%;
			max-width: 420px;
			height: 200px;
			margin: 0 auto;
			transform: none;
		}
		.monitor-foot {
			left: 50%;
			transform: translateX(-50%);
		}
		.mouse-pad,
		.mouse-pad.desk-prop {
			position: relative;
			left: auto;
			top: auto;
			width: 100%;
			max-width: 200px;
			height: 48px;
			margin: 0 auto;
			transform: none;
		}
		.mouse-pad .pad-target {
			width: 25px;
			height: 33px;
		}

		.clipboard-panel {
			width: min(300px, calc(100vw - 16px));
			min-height: 280px;
			font-size: inherit;
		}
		.clipboard-panel header strong {
			font-size: 15px;
		}
		.clipboard-panel dl div,
		.panel-status {
			font-size: 9px;
		}
		.clipboard-panel dd,
		.clipboard-panel p {
			font-size: 9px;
		}
		.clip {
			left: 50%;
			transform: translateX(-50%);
			width: 84px;
			height: 24px; /* larger drag handle */
		}
		.wire-status {
			width: min(180px, calc(100vw - 24px));
			padding: 10px;
		}
		.wire-status strong {
			font-size: 16px;
		}
		.wire-status div,
		.wire-status small {
			font-size: 8px;
		}
	}

	/* Phone (~375px): tighter skyline crop, denser trader wrap, safer overlays */
	@media (max-width: 480px) {
		.window-wall {
			height: 120px;
			padding: 6px 4px 0;
			gap: 0;
		}
		.panoramic-skyline {
			inset: 6px 4px 0;
		}
		.window-wall::after {
			inset: 6px 4px 0;
		}
		.window-pane {
			border-width: 3px;
			border-bottom-width: 6px;
		}
		.fund-sign {
			flex-wrap: wrap;
		}
		.monogram {
			width: 36px;
			height: 36px;
			font-size: 11px;
		}
		.whiteboard {
			display: none; /* reclaim vertical space on phone */
		}
		.channel-switch {
			flex-wrap: wrap;
		}
		.channel-switch select {
			width: 100%;
			max-width: 100%;
			font-size: 12px;
		}
		.staff-row :global(.character) {
			flex: 0 0 auto;
			width: 112px;
			max-width: 120px;
			min-width: 100px;
		}
		.trader-row :global(.character) {
			width: 72px;
			min-width: 68px;
			max-width: 88px;
		}
		.foreground-monitor {
			height: 180px;
		}
		.pinned-head,
		.pinned-risk {
			font-size: 8px;
		}
		.clipboard-panel {
			width: calc(100vw - 16px);
			max-height: calc(100vh - 24px);
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
		}
		.clipboard-panel header {
			flex-wrap: wrap;
		}
		.error-note {
			left: 8px;
			right: 8px;
			bottom: max(8px, env(safe-area-inset-bottom, 8px));
			font-size: 10px;
		}
	}

	/* Keep the foreground desk's small tools available on touch layouts. The
	 * desktop tools remain independently positioned; mobile gets a compact,
	 * readable second row below the CRT. */
	@media (max-width: 768px) {
		.foreground-desk {
			height: 360px;
			min-height: 360px;
			padding: 0;
			display: block;
		}
		.foreground-monitor {
			position: absolute !important;
			left: 10px;
			top: 12px;
			bottom: auto;
			width: calc(100% - 20px);
			max-width: none;
			height: 190px;
			margin: 0;
			transform: none;
		}
		.phone-main {
			display: none !important;
		}
		.book-stack {
			display: block !important;
			position: absolute;
			left: 12px;
			top: 220px;
			bottom: auto;
			width: min(155px, calc(100% - 24px));
			z-index: 80;
		}
		.wsj.desk-prop,
		.legal-pad.desk-prop,
		.keyboard-main.desk-prop,
		.mouse-pad.desk-prop,
		.calculator.desk-prop,
		.coffee.desk-prop,
		.desk-settings-btn.desk-prop,
		.desk-break-btn.desk-prop {
			display: block !important;
			position: absolute !important;
			bottom: auto !important;
			margin: 0;
		}
		.wsj.desk-prop {
			width: 132px;
			height: 94px;
		}
		.wsj.desk-prop.expanded {
			width: min(390px, calc(100vw - 28px));
			height: auto;
			max-height: min(480px, calc(100vh - 28px));
		}
		.legal-pad.desk-prop {
			width: 105px;
			height: 105px;
			min-height: 0;
			font-size: 8px;
		}
		.keyboard-main.desk-prop {
			width: 140px;
			height: 48px;
		}
		.mouse-pad.desk-prop {
			width: 86px;
			height: 48px;
		}
		.calculator.desk-prop {
			width: 36px;
			height: 46px;
		}
		.coffee.desk-prop {
			width: 32px;
			height: 40px;
		}
		.desk-settings-btn.desk-prop {
			width: 52px;
			height: 42px;
		}
		.desk-break-btn.desk-prop {
			width: 52px;
			height: 42px;
		}
	}

	@media (max-width: 480px) {
		.foreground-desk {
			height: 860px;
			min-height: 860px;
		}
		.foreground-monitor {
			height: 180px;
		}
	}

	/* Expanded news is a reading surface, so keep it centered in the viewport
	 * instead of leaving it at the newspaper's draggable desk coordinates. */
	.wsj.desk-prop.expanded {
		position: fixed !important;
		left: 50% !important;
		top: 50% !important;
		right: auto !important;
		bottom: auto !important;
		transform: translate(-50%, -50%) rotate(-1deg) !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.coffee-trip,
		.coffee-trip::before,
		.coffee-trip::after {
			animation: none !important;
			opacity: 0 !important;
		}
		.coffee b {
			animation: none;
		}
	}

	.desk-settings-btn {
		flex: 0 0 auto;
		width: 54px;
		height: 48px;
		padding: 3px 2px 2px;
		background: linear-gradient(135deg, #4e4030, #2e281f 68%);
		border: 3px solid #18130d;
		border-radius: 3px;
		color: #f0cf72;
		font: 700 9px/1 var(--mono, monospace);
		cursor: pointer;
		box-shadow: 3px 3px 0 rgba(0,0,0,0.4), inset 1px 1px #776449, inset -2px -2px #17120c;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		transform: rotate(2deg);
	}
	.desk-settings-btn b {
		font-size: 7px;
		letter-spacing: 0.08em;
	}
	.settings-glyph {
		position: relative;
		width: 18px;
		height: 18px;
		background: #d8ad4e;
		clip-path: polygon(38% 0, 62% 0, 67% 20%, 83% 12%, 100% 30%, 84% 45%, 100% 62%, 82% 86%, 65% 78%, 60% 100%, 38% 100%, 33% 79%, 16% 87%, 0 68%, 15% 52%, 0 34%, 18% 14%, 34% 22%);
		filter: drop-shadow(1px 1px #1d170d);
	}
	.settings-glyph::after {
		content: '';
		position: absolute;
		left: 6px;
		top: 6px;
		width: 6px;
		height: 6px;
		background: #3b3022;
		border: 1px solid #f4d77f;
		border-radius: 50%;
	}
	.desk-settings-btn:hover,
	.desk-settings-btn:focus-visible {
		outline: 2px solid #efc870;
		outline-offset: 2px;
		background: #4a4030;
	}
	.desk-break-btn {
		flex: 0 0 auto;
		width: 54px;
		height: 48px;
		padding: 3px 2px 2px;
		background: linear-gradient(135deg, #37503f, #21332a 68%);
		border: 3px solid #101a15;
		border-radius: 3px;
		color: #c7e8b8;
		font: 700 9px/1 var(--mono, monospace);
		cursor: pointer;
		box-shadow: 3px 3px 0 rgba(0,0,0,0.4), inset 1px 1px #5a7a63, inset -2px -2px #0e1911;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		transform: rotate(-1.5deg);
	}
	.desk-break-btn b {
		padding: 2px 3px 1px;
		background: #102117;
		border: 1px solid #8fc89b;
		color: #f3ffe8;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.1em;
		line-height: 1;
		text-shadow: 1px 1px 0 #07100a;
		white-space: nowrap;
	}
	.break-glyph {
		position: relative;
		width: 18px;
		height: 18px;
	}
	.break-glyph::before {
		content: '';
		position: absolute;
		left: 3px;
		top: 1px;
		width: 8px;
		height: 16px;
		background: #7ad19a;
		border: 1px solid #1d170d;
	}
	.break-glyph::after {
		content: '';
		position: absolute;
		right: 0;
		top: 7px;
		width: 0;
		height: 0;
		border-style: solid;
		border-width: 3px 0 3px 6px;
		border-color: transparent transparent transparent #7ad19a;
		filter: drop-shadow(1px 1px #1d170d);
	}
	.desk-break-btn:hover,
	.desk-break-btn:focus-visible {
		outline: 2px solid #7ad19a;
		outline-offset: 2px;
		background: #375542;
	}
	.settings-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300000;
		background: rgba(8, 4, 2, 0.55);
	}
	.desk-settings-panel {
		position: fixed;
		z-index: 300001;
		left: 50%;
		top: 50%;
		right: auto;
		bottom: auto;
		transform: translate(-50%, -50%);
		width: min(360px, calc(100vw - 32px));
		max-height: min(70vh, calc(100vh - 48px));
		overflow-x: hidden;
		overflow-y: auto;
		padding-bottom: 4px;
		background: #120e06;
		color: #e3d072;
		border: 4px solid #5a4a2f;
		box-shadow: 6px 6px 0 rgba(0,0,0,0.55);
		font-family: var(--mono, monospace);
	}
	.desk-settings-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
		background: #1f180c;
		border-bottom: 2px solid #5a4a2f;
		font-size: 10px;
		letter-spacing: 0.08em;
	}
	.desk-settings-panel .x {
		background: transparent;
		border: 1px solid #5a4a2f;
		color: #e3d072;
		width: 24px;
		height: 24px;
		padding: 0;
		font: 900 13px/1 var(--mono, monospace);
		cursor: pointer;
	}
	.settings-body {
		padding: 10px 10px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.settings-body h4 {
		margin: 0 0 6px;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: #efc870;
	}
	.settings-body label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 9px;
		margin: 0 0 5px;
		cursor: pointer;
	}
	.settings-body .flag-picker {
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.settings-body .theme-picker {
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.settings-body .flag-picker span {
		font-size: 9px;
	}
	.settings-body select {
		min-width: 185px;
		padding: 5px 6px;
		background: #241a0e;
		border: 1px solid #6a5a30;
		color: #f0dfaa;
		font: 8px var(--mono, monospace);
	}
	.settings-body .ghost {
		margin-top: 6px;
		width: 100%;
		padding: 8px;
		background: #2a2010;
		border: 2px dashed #6a5a30;
		color: #c8b870;
		font: 8px var(--mono, monospace);
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.settings-body .hint {
		margin: 0;
		font-size: 8px;
		opacity: 0.7;
	}
	.scene.night-tint .scene-frame {
		filter: saturate(0.85) brightness(0.92) hue-rotate(-8deg);
	}
	.scene.crt-scan .scene-frame::after {
		content: '';
		pointer-events: none;
		position: absolute;
		inset: 0;
		z-index: 50;
		background: repeating-linear-gradient(
			to bottom,
			rgba(0, 0, 0, 0.06) 0 1px,
			transparent 1px 3px
		);
		mix-blend-mode: multiply;
	}
	.scene.reduce-motion :global(*),
	.scene.reduce-motion :global(*::before),
	.scene.reduce-motion :global(*::after) {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
	}

</style>
