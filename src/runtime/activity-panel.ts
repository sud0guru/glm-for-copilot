import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getApiMode } from '../config';
import { t } from '../i18n';
import { logger } from '../logger';
import { formatRequestError, GLMRequestError, isAbortError, normalizeRequestError } from '../client/errors';
import type { IUsageClient } from '../client/usage';
import type { ActivityDay, ActivitySummary, IAuthManager } from '../types';
import { formatTokens } from './format';
import { panelThemeCss, panelThemeKind } from './panel-theme';

/**
 * Singleton webview panel showing GLM Coding Plan activity: summary stat cards plus a
 * GitHub-style heatmap with Daily / Weekly / Cumulative views, mirroring the z.ai Activity
 * page. Unlike {@link UsageDetailPanel}, this panel fetches its own data (the activity series
 * is large and only needed here) and refetches on Refresh.
 */
export class ActivityPanel {
	private static currentPanel: ActivityPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly client: IUsageClient;
	private readonly auth: IAuthManager;
	private controller: AbortController | null = null;
	private themeSub: vscode.Disposable | undefined;

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, client: IUsageClient, auth: IAuthManager) {
		this.panel = panel;
		this.client = client;
		this.auth = auth;

		this.renderLoading();
		void this.fetchAndRender();

		this.panel.webview.onDidReceiveMessage(
			(message: { type: string }) => {
				if (message.type === 'refresh') {
					void this.fetchAndRender();
				}
			},
			undefined,
			context.subscriptions,
		);
		this.themeSub = vscode.window.onDidChangeActiveColorTheme(() => void this.fetchAndRender({ preserveData: true }));
		this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);
	}

	/** Reveal the singleton panel if it exists, otherwise create one and fetch activity. */
	static createOrShow(context: vscode.ExtensionContext, client: IUsageClient, auth: IAuthManager): void {
		if (ActivityPanel.currentPanel) {
			ActivityPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active, false);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'glmActivity',
			t('usage.activity.panel.title'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: false,
			},
		);
		ActivityPanel.currentPanel = new ActivityPanel(panel, context, client, auth);
	}

	/** Fetch the activity series and re-render; `preserveData` keeps the last series on theme change. */
	private async fetchAndRender(options: { preserveData?: boolean } = {}): Promise<void> {
		if (getApiMode() !== 'coding-plan') {
			this.renderError(t('usage.panel.unavailable'));
			return;
		}
		const apiKey = await this.auth.getApiKey();
		if (!apiKey) {
			this.renderError(t('usage.panel.unavailable'));
			return;
		}
		if (options.preserveData && this.lastSeries) {
			this.renderData(this.lastSeries, this.lastSummary);
			return;
		}
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.renderLoading();
		try {
			const snapshot = await this.client.fetchActivity(apiKey, controller.signal);
			if (controller.signal.aborted) {
				return;
			}
			this.renderData(snapshot.series, snapshot.summary);
		} catch (error) {
			if (isAbortError(error)) {
				return;
			}
			logger.warn('GLM activity fetch failed', error);
			const reason = error instanceof GLMRequestError
				? (error.serverMessage ?? error.userSummary)
				: formatRequestError(normalizeRequestError(error, { baseUrl: '' }));
			this.renderError(t('usage.activity.error', reason));
		}
	}

	private lastSeries: ActivityDay[] | null = null;
	private lastSummary: ActivitySummary | undefined;

	/** Render the loading state. */
	private renderLoading(): void {
		this.panel.webview.html = this.buildHtml({ kind: 'loading' });
	}

	/** Render the error state with the failure reason. */
	private renderError(message: string): void {
		this.panel.webview.html = this.buildHtml({ kind: 'error', message });
	}

	/** Render the data state: stat cards + heatmap document. */
	private renderData(series: ActivityDay[], summary?: ActivitySummary): void {
		this.lastSeries = series;
		this.lastSummary = summary;
		this.panel.webview.html = this.buildHtml({ kind: 'data', series, summary });
	}

	/**
	 * Build the full panel HTML. The heatmap is rendered server-side as a grid of `<div>`s with
	 * baked `data-level` attributes; a small nonce'd script switches Daily/Weekly/Cumulative
	 * buckets client-side and drives the month labels.
	 */
	private buildHtml(state: ActivityState): string {
		const nonce = getNonce();
		const theme = panelThemeKind();
		const s = activityStrings();
		const data = state.kind === 'data' ? dataBody(state, s) : null;
		const fallback = state.kind === 'loading'
			? `<div class="status-message"><div class="spinner"></div><p>${escapeHtml(s.loading)}</p></div>`
			: state.kind === 'error'
				? `<div class="status-message"><p>${escapeHtml(state.message)}</p></div>`
				: '';
		const body = data !== null ? data.html : fallback;
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(s.title)}</title>
	<style nonce="${nonce}">${panelThemeCss(theme)}${data !== null ? data.css : ''}</style>
</head>
<body>
	<div class="panel">
	<div class="header">
		<h1>${escapeHtml(s.title)}</h1>
		<div class="header-actions">
			<button id="refresh" class="btn">${escapeHtml(s.refresh)}</button>
		</div>
	</div>
	<div id="content">${body}</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
		// The year grid is wider than narrow panels; open it scrolled to the most recent weeks.
		// Run again on load: the parse-time assignment can race the first layout pass.
		const scroller = document.querySelector('.heatmap-scroll');
		const showLatest = () => { if (scroller) scroller.scrollLeft = scroller.scrollWidth; };
		showLatest();
		window.addEventListener('load', showLatest);
		function levelOf(value, max) {
			const ratio = value / Math.max(max, 1);
			if (ratio <= 0) return '0';
			if (ratio < 0.25) return '1';
			if (ratio < 0.5) return '2';
			if (ratio < 0.75) return '3';
			return '4';
		}
		function applyMode(mode) {
			const cells = Array.from(document.querySelectorAll('[data-count-daily]'));
			let max = 0;
			for (const cell of cells) {
				max = Math.max(max, Number(cell.getAttribute('data-count-' + mode) || '0'));
			}
			for (const cell of cells) {
				const value = Number(cell.getAttribute('data-count-' + mode) || '0');
				cell.setAttribute('data-level', levelOf(value, max));
				cell.title = cell.getAttribute('data-title-' + mode) || '';
			}
		}
		const tabs = document.querySelectorAll('.tab');
		tabs.forEach((tab) => tab.addEventListener('click', () => {
			tabs.forEach((other) => other.classList.toggle('active', other === tab));
			applyMode(tab.getAttribute('data-mode'));
		}));
	</script>
</body>
</html>`;
	}

	/** Dispose theme subscription + panel; clear the singleton reference. */
	dispose(): void {
		this.controller?.abort();
		this.themeSub?.dispose();
		this.panel.dispose();
		ActivityPanel.currentPanel = undefined;
	}
}

type ActivityState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'data'; series: ActivityDay[]; summary?: ActivitySummary };

interface ActivityStrings {
	title: string;
	refresh: string;
	loading: string;
	cumulativeTokens: string;
	peakTokens: string;
	totalDuration: string;
	currentStreak: string;
	longestStreak: string;
	daily: string;
	weekly: string;
	cumulative: string;
	empty: string;
}

function activityStrings(): ActivityStrings {
	return {
		title: t('usage.activity.panel.title'),
		refresh: t('usage.activity.refresh'),
		loading: t('usage.activity.loading'),
		cumulativeTokens: t('usage.activity.cumulativeTokens'),
		peakTokens: t('usage.activity.peakTokens'),
		totalDuration: t('usage.activity.totalDuration'),
		currentStreak: t('usage.activity.currentStreak'),
		longestStreak: t('usage.activity.longestStreak'),
		daily: t('usage.activity.daily'),
		weekly: t('usage.activity.weekly'),
		cumulative: t('usage.activity.cumulative'),
		empty: t('usage.activity.empty'),
	};
}

/** Render the data body: the five stat cards, then the heatmap panel with mode tabs. */
function dataBody(state: Extract<ActivityState, { kind: 'data' }>, s: ActivityStrings): { html: string; css: string } {
	const summary = state.summary;
	const series = state.series;
	const cards: Array<{ value: string; label: string }> = [
		{ value: summary ? formatTokens(summary.totalTokens) : '—', label: s.cumulativeTokens },
		{
			value: summary && summary.peakDailyTokens > 0
				? formatTokens(summary.peakDailyTokens) + (summary.peakDailyTokensDate ? ` · ${summary.peakDailyTokensDate}` : '')
				: '—',
			label: s.peakTokens,
		},
		{ value: summary ? formatDuration(summary.totalUsageDurationMs) : '—', label: s.totalDuration },
		{ value: summary ? `${summary.currentStreakDays}d` : '—', label: s.currentStreak },
		{ value: summary ? `${summary.longestStreakDays}d` : '—', label: s.longestStreak },
	];
	const statCards = cards.map((card) =>
		`<div class="stat-card"><div class="stat-value">${escapeHtml(card.value)}</div><div class="stat-label">${escapeHtml(card.label)}</div></div>`
	).join('');
	if (series.length === 0) {
		return { html: `<div class="stats">${statCards}</div><div class="status-message"><p>${escapeHtml(s.empty)}</p></div>`, css: '' };
	}
	const heatmap = heatmapHtml(series, s);
	return { html: `<div class="stats">${statCards}</div>${heatmap.html}`, css: heatmap.css };
}

/**
 * Render the heatmap: one column per week (Sun..Sat rows), each cell carrying
 * data-count-daily / -weekly / -cumulative plus per-mode tooltips. Month labels are positioned
 * by nth-child CSS in the returned stylesheet: the webview CSP strips inline style attributes,
 * so `style="left:…"` never survives (same constraint as the usage bar widths). Labels closer
 * than two columns to the previous one are dropped so month names never overlap.
 */
function heatmapHtml(series: ActivityDay[], s: ActivityStrings): { html: string; css: string } {
	const byDate = new Map(series.map((day) => [day.date, day.totalTokens]));
	const firstDate = new Date(`${series[0].date}T00:00:00`);
	const lastDate = new Date(`${series[series.length - 1].date}T00:00:00`);
	// Anchor the grid so every column is a complete Sun..Sat week: push the end to the Saturday
	// on/after the last day, then step back 52 weeks to the Sunday starting the first column.
	const end = new Date(lastDate);
	end.setDate(end.getDate() + (6 - end.getDay()));
	const start = new Date(end);
	start.setDate(start.getDate() - 52 * 7 - 6); // 53 week columns like the site

	const columns: string[] = [];
	// Labels need >= 2 columns (28px) of clearance: a 3-char month at 10px is ~18px wide, so
	// months starting in adjacent columns (e.g. a 365-day window opening in late October) would
	// render as one glued "OctNov" run. GitHub's heatmap drops these too-close labels as well.
	const monthLabels: Array<{ label: string; index: number }> = [];
	let lastMonth = -1;
	let lastLabelIndex = -2;
	let cumulative = 0;
	for (let weekStart = new Date(start); weekStart <= end; weekStart.setDate(weekStart.getDate() + 7)) {
		// Collect the week's values first so every cell reports the full weekly total.
		const days: Array<{ date: string; daily: number } | null> = [];
		let weekTotal = 0;
		for (let offset = 0; offset < 7; offset++) {
			const day = new Date(weekStart);
			day.setDate(day.getDate() + offset);
			if (day > lastDate || day < firstDate) {
				days.push(null);
				continue;
			}
			const key = dateKey(day);
			const daily = byDate.get(key) ?? 0;
			weekTotal += daily;
			days.push({ date: key, daily });
		}
		const cells = days.map((entry) => {
			if (entry === null) {
				return '<div class="cell empty"></div>';
			}
			cumulative += entry.daily;
			const day = new Date(`${entry.date}T00:00:00`);
			const month = day.getMonth();
			if (month !== lastMonth) {
				lastMonth = month;
				const index = columns.length;
				if (index - lastLabelIndex >= 2) {
					lastLabelIndex = index;
					monthLabels.push({ label: day.toLocaleString('en', { month: 'short' }), index });
				}
			}
			return `<div class="cell" data-count-daily="${entry.daily}" data-count-weekly="${weekTotal}" data-count-cumulative="${cumulative}"
				data-title-daily="${escapeHtml(`${entry.date}: ${formatTokens(entry.daily)} tokens`)}"
				data-title-weekly="${escapeHtml(`week of ${entry.date}: ${formatTokens(weekTotal)} tokens`)}"
				data-title-cumulative="${escapeHtml(`${entry.date} cumulative: ${formatTokens(cumulative)} tokens`)}"
				data-level="${levelOfHtml(entry.daily, series)}"></div>`;
		});
		columns.push(`<div class="col">${cells.join('')}</div>`);
	}
	const labelRow = monthLabels.map(({ label }) => `<span class="month">${escapeHtml(label)}</span>`).join('');
	const labelCss = monthLabels
		.map(({ index }, i) => `.months .month:nth-child(${i + 1}){left:${index * 14}px}`)
		.join('\n');
	return {
		html: `<div class="heatmap-panel">
		<div class="tabs">
			<button class="tab active" data-mode="daily">${escapeHtml(s.daily)}</button>
			<button class="tab" data-mode="weekly">${escapeHtml(s.weekly)}</button>
			<button class="tab" data-mode="cumulative">${escapeHtml(s.cumulative)}</button>
		</div>
		<div class="heatmap-scroll">
			<div class="heatmap">${columns.join('')}</div>
			<div class="months">${labelRow}</div>
		</div>
	</div>`,
		css: labelCss,
	};
}

/** Static server-side level for the initial (daily) rendering; the script recomputes on tab change. */
function levelOfHtml(daily: number, series: ActivityDay[]): string {
	const max = Math.max(...series.map((day) => day.totalTokens), 1);
	const ratio = daily / max;
	if (ratio <= 0) return '0';
	if (ratio < 0.25) return '1';
	if (ratio < 0.5) return '2';
	if (ratio < 0.75) return '3';
	return '4';
}

function dateKey(day: Date): string {
	const pad = (v: number) => String(v).padStart(2, '0');
	return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** "177h 43m" formatting for the total usage duration. */
function formatDuration(ms: number): string {
	const totalMinutes = Math.floor(ms / 60000);
	const hours = Math.floor(totalMinutes / 60);
	return `${hours}h ${totalMinutes % 60}m`;
}

/** Map the VS Code color theme to a dark/light token. */
function getNonce(): string {
	return randomBytes(16).toString('base64');
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

