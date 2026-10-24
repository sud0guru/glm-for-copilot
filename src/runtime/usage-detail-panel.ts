import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { getRegion } from '../config';
import { barWidthCss, metricPercent } from './usage-detail-html';
import type { UsagePanelMessage, UsagePanelStrings, UsageMetricView, ResetQuotaView } from './usage-detail-html';
import { panelThemeCss, panelThemeKind } from './panel-theme';
import type { UsageStatusBar } from './usage-bar';
import { usagePanelStrings } from './usage-strings';

/**
 * Singleton webview panel showing z.ai Coding Plan quota detail. Clicking the GLM Usage
 * status bar opens (or reveals) this pane. It never fetches on its own: it renders the
 * effective snapshot pushed by UsageStatusBar via onDidChangeSnapshot.
 */
export class UsageDetailPanel {
	private static currentPanel: UsageDetailPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly bar: UsageStatusBar;
	private subscription: vscode.Disposable | undefined;
	private themeSub: vscode.Disposable | undefined;
	private lastMessage: UsagePanelMessage | null | undefined;

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, bar: UsageStatusBar) {
		this.panel = panel;
		this.bar = bar;

		this.render(this.bar.getSnapshot());

		this.subscription = bar.onDidChangeSnapshot((message) => this.render(message));

		this.themeSub = vscode.window.onDidChangeActiveColorTheme(() => this.render(this.bar.getSnapshot()));

		this.panel.webview.onDidReceiveMessage(
			(message: { type: string }) => this.onMessage(message),
			undefined,
			context.subscriptions,
		);

		this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);
	}

	/**
	 * Reveal the singleton panel if it exists, otherwise create one bound to `bar`.
	 * The panel subscribes to `bar.onDidChangeSnapshot` and re-renders on every push.
	 */
	static createOrShow(context: vscode.ExtensionContext, bar: UsageStatusBar): void {
		if (UsageDetailPanel.currentPanel) {
			UsageDetailPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active, false);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'glmUsageDetail',
			t('usage.panel.title'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: false,
			},
		);
		UsageDetailPanel.currentPanel = new UsageDetailPanel(panel, context, bar);
	}

	/** Handle a user action posted by the usage webview. */
	private async onMessage(message: { type: string }): Promise<void> {
		if (message.type === 'refresh') {
			await this.bar.refresh();
		} else if (message.type === 'setKey') {
			await vscode.commands.executeCommand('glm-copilot.setApiKey');
		} else if (message.type === 'checkStandard') {
			await this.bar.checkStandardApi();
		} else if (message.type === 'useReset') {
			const resetType = (message as { resetType?: string }).resetType === 'WEEK' ? 'WEEK' : 'FIVE_HOUR';
			await this.bar.useResetQuota(resetType);
		} else if (message.type === 'openActivity') {
			await vscode.commands.executeCommand('glm-copilot.openActivity');
		}
	}

	/**
	 * Re-render the panel HTML. Suppresses the transition to `loading` when a non-loading snapshot
	 * is already showing (avoids fltransform on background refresh). Caches the last message.
	 */
	private render(message: UsagePanelMessage | null): void {
		if (message?.status === 'loading' && this.lastMessage != null && this.lastMessage.status !== 'loading') {
			return;
		}
		this.lastMessage = message;
		this.panel.title = t('usage.panel.title');
		this.panel.webview.html = this.buildHtml(message);
	}

	/**
	 * Build the full panel HTML document. Uses a gate-failed fallback message when `message` is null.
	 * Inline scripts run under a nonce CSP; reset-countdown timers are hydrated via `resetsAtMap`.
	 */
	private buildHtml(message: UsagePanelMessage | null): string {
		const nonce = getNonce();
		const theme = panelThemeKind();
		const gateFailed = message === null;
		const effective: UsagePanelMessage = message ?? {
			status: 'no-data',
			metrics: [],
			currency: getRegion() === 'china' ? '¥' : '$',
			offline: false,
			theme,
			strings: usagePanelStrings(),
		};
		const body = gateFailed
			? `<div class="status-message"><p>${escapeHtml(effective.strings.unavailable)}</p></div>`
			: effective.status === 'ok'
				? renderOkBody(effective)
				: renderStatusBody(effective);

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(effective.strings.title)}</title>
	<style nonce="${nonce}">
		${panelThemeCss(theme)}
		${barWidthCss(effective.metrics)}
	</style>
</head>
<body>
	<div class="panel">
	<div class="header">
		<h1>${escapeHtml(effective.strings.title)}</h1>
		<div class="header-actions">
			${message?.status === 'ok' ? `<button id="activity" class="btn secondary">${escapeHtml(effective.strings.activity)}</button>` : ''}
			<button id="refresh" class="btn">${escapeHtml(effective.strings.refresh)}</button>
		</div>
	</div>
	<div id="content">${body}</div>
	</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	const setKeyBtn = document.getElementById('setKey');
	if (setKeyBtn) setKeyBtn.addEventListener('click', () => vscode.postMessage({ type: 'setKey' }));
	const checkStandardBtn = document.getElementById('checkStandard');
	if (checkStandardBtn) checkStandardBtn.addEventListener('click', () => vscode.postMessage({ type: 'checkStandard' }));
	const activityBtn = document.getElementById('activity');
	if (activityBtn) activityBtn.addEventListener('click', () => vscode.postMessage({ type: 'openActivity' }));
	const resetFiveHourBtn = document.getElementById('reset-five-hour');
	if (resetFiveHourBtn) resetFiveHourBtn.addEventListener('click', () => vscode.postMessage({ type: 'useReset', resetType: 'FIVE_HOUR' }));
	const resetWeekBtn = document.getElementById('reset-week');
	if (resetWeekBtn) resetWeekBtn.addEventListener('click', () => vscode.postMessage({ type: 'useReset', resetType: 'WEEK' }));
		const resetsAtTimes = ${jsonForScript(resetsAtMap(effective))};
		if (resetsAtTimes && Object.keys(resetsAtTimes).length > 0) {
			const fmt = (ms) => {
				if (ms <= 0) return '0m';
				const d = Math.floor(ms / 86400000);
				const h = Math.floor((ms % 86400000) / 3600000);
				const m = Math.round((ms % 3600000) / 60000);
				if (d > 0) return d + 'd ' + h + 'h';
				if (h > 0 && m > 0) return h + 'h ' + m + 'm';
				if (h > 0) return h + 'h';
				return m + 'm';
			};
			const tick = () => {
				const now = Date.now();
				for (const [key, ts] of Object.entries(resetsAtTimes)) {
					const el = document.getElementById('resets-' + key);
					if (el) el.textContent = ${jsonForScript(effective.strings.resetsIn)}.replace('{0}', fmt(ts - now));
				}
			};
			tick();
			setInterval(tick, 1000);
		}
	</script>
</body>
</html>`;
	}

	/** Dispose subscriptions, theme listener, and the webview panel; clear the singleton reference. */
	dispose(): void {
		this.subscription?.dispose();
		this.themeSub?.dispose();
		this.panel.dispose();
		UsageDetailPanel.currentPanel = undefined;
	}
}

/** Render the HTML body for the `ok` status: plan header, usage cards, reset-quota card, balance, footer. */
function renderOkBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	const lines: string[] = [];
	const meta: string[] = [];
	if (msg.planName) {
		meta.push(`<div class="plan">${escapeHtml(s.plan.replace('{0}', msg.planName))}</div>`);
	}
	if (msg.renewsAt) {
		meta.push(`<div class="plan">${escapeHtml(s.renewsAt.replace('{0}', msg.renewsAt))}</div>`);
	}
	if (meta.length > 0) {
		lines.push(`<div class="plan-meta">${meta.join('')}</div>`);
	}
	lines.push('<div class="cards">');
	for (const metric of msg.metrics) {
		lines.push(renderMetricCard(metric, s));
	}
	lines.push('</div>');
	if (msg.resetQuota) {
		// Outside the metrics grid: a spanning item inside it would occupy every auto-fit track
		// and stop the grid from collapsing empty tracks, leaving a dead column beside the cards.
		lines.push(renderResetQuotaCard(msg.resetQuota, s));
	}
	if (msg.balance) {
		lines.push(renderBalanceBody(msg));
	}
	const foot: string[] = [];
	if (msg.lastUpdated !== undefined) {
		foot.push(`<div class="last-updated">${escapeHtml(s.lastUpdated.replace('{0}', new Date(msg.lastUpdated).toLocaleTimeString()))}</div>`);
	}
	if (msg.offline) {
		foot.push(`<div class="offline">${escapeHtml(s.offline)}</div>`);
	}
	if (foot.length > 0) {
		lines.push(`<div class="panel-foot">${foot.join('')}</div>`);
	}
	if (msg.recoveryReason) {
		lines.push(renderRecoveryCard(msg));
	}
	return lines.join('');
}

/**
 * Render one usage card in the z.ai style: title, big used number + caption, credits line,
 * progress bar (orange from 80%), and reset-time + countdown footer.
 */
function renderMetricCard(metric: UsageMetricView, s: UsagePanelStrings): string {
	const percent = metricPercent(metric);
	const fillClass = percent >= 80 ? 'bar-fill warn' : 'bar-fill';
	const bigValue = metric.isPercent ? String(Math.round(metric.used)) : String(metric.used);
	const caption = metric.isPercent
		? escapeHtml(s.percentUsed.replace('{0}', ''))
		: escapeHtml(s.cardTitle[metric.kind]);
	const side = metric.usedCredits !== undefined && metric.totalCredits !== undefined
		? escapeHtml(s.credits.replace('{0}', metric.usedCredits).replace('{1}', metric.totalCredits))
		: metric.isPercent
			? ''
			: escapeHtml(`${metric.used} / ${metric.limit}`);
	const foot: string[] = [];
	if (metric.resetsAt !== undefined) {
		foot.push(`<div class="reset-time">${escapeHtml(s.resetTime.replace('{0}', formatResetTime(metric.resetsAt)))}</div>`);
		foot.push(`<div id="resets-${escapeHtml(metric.kind)}" class="resets"></div>`);
	}
	return `<div class="card">
		<div class="card-head"><span class="card-title">${escapeHtml(s.cardTitle[metric.kind])}</span><span class="card-window">${escapeHtml(metric.window)}</span></div>
		<div class="card-body">
			<div class="card-big"><span class="big-num">${escapeHtml(bigValue)}</span> <span class="big-cap">${caption}</span></div>
			${side ? `<div class="card-side">${side}</div>` : ''}
		</div>
		<div class="bar"><div class="${fillClass}" id="fill-${escapeHtml(metric.kind)}"></div></div>
		${foot.length > 0 ? `<div class="card-foot">${foot.join('')}</div>` : ''}
	</div>`;
}

/**
 * Render the Reset Quota card: total unused count, per-window badges, and a redeem button per
 * window that still has cards banked. Buttons message the extension host, which confirms + redeems.
 */
function renderResetQuotaCard(quota: ResetQuotaView, s: UsagePanelStrings): string {
	const total = quota.fiveHourCount + quota.weekCount;
	const badges = [
		`<span class="pill"><span class="dot"></span>${escapeHtml(s.resetBadgeFiveHour.replace('{0}', String(quota.fiveHourCount)))}</span>`,
		`<span class="pill"><span class="dot"></span>${escapeHtml(s.resetBadgeWeekly.replace('{0}', String(quota.weekCount)))}</span>`,
	].join('');
	const actions: string[] = [];
	if (quota.fiveHourCount > 0) {
		actions.push(`<button id="reset-five-hour" class="btn">${escapeHtml(s.useResetFiveHour)}</button>`);
	}
	if (quota.weekCount > 0) {
		actions.push(`<button id="reset-week" class="btn">${escapeHtml(s.useResetWeekly)}</button>`);
	}
	return `<div class="card reset-card">
		<div class="card-head"><span class="card-title">${escapeHtml(s.resetQuotaTitle)}</span><span class="card-badges">${badges}</span></div>
		<div class="card-body">
			<div class="card-big"><span class="big-num">${escapeHtml(String(total))}</span> <span class="big-cap">${escapeHtml(s.resetTimesUnused.replace('{0}', ''))}</span></div>
			${actions.length > 0 ? `<div class="reset-actions">${actions.join('')}</div>` : ''}
		</div>
	</div>`;
}

/** Local "YYYY-MM-DD HH:MM" for a reset timestamp, matching the z.ai usage page. */
function formatResetTime(resetsAt: number): string {
	const d = new Date(resetsAt);
	const pad = (v: number) => String(v).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Render the HTML for the Standard API balance section: cash rows (right-aligned values) + token packages. */
function renderBalanceBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	const b = msg.balance!;
	const c = msg.currency;
	const lines: string[] = [`<div class="balance-section"><h2>${escapeHtml(s.balanceSection)}</h2>`];
	if (b.availableCash !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceAvailable)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.availableCash)}</span></div>`);
	}
	if (b.totalRecharged !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceRecharged)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.totalRecharged)}</span></div>`);
	}
	if (b.giftedAmount !== undefined && b.giftedAmount !== '0') {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceGifted)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.giftedAmount)}</span></div>`);
	}
	if (b.totalSpent !== undefined) {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceSpent)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.totalSpent)}</span></div>`);
	}
	if (b.frozenAmount !== undefined && b.frozenAmount !== '0') {
		lines.push(`<div class="balance-row"><span>${escapeHtml(s.balanceFrozen)}</span><span class="balance-value">${escapeHtml(c)}${escapeHtml(b.frozenAmount)}</span></div>`);
	}
	if (b.tokenPackages.length > 0) {
		lines.push(`<div class="balance-packages">${escapeHtml(s.balancePackages)}</div>`);
		for (const pkg of b.tokenPackages) {
			const modelLabel = pkg.model ? ` <span class="pkg-model">(${escapeHtml(pkg.model)})</span>` : '';
			lines.push(`<div class="balance-row"><span>${escapeHtml(pkg.name)}${modelLabel}</span><span class="balance-value">${escapeHtml(pkg.tokens)} tokens</span></div>`);
		}
	}
	lines.push('</div>');
	return lines.join('');
}

/** Render the HTML body for non-ok statuses: a centered message, plus a Set-Key button on auth errors. */
function renderStatusBody(msg: UsagePanelMessage): string {
	const s = msg.strings;
	if (msg.recoveryReason === 'coding-plan-unavailable') {
		return renderRecoveryCard(msg);
	}
	if (msg.status === 'auth-error') {
		return `<div class="status-message">
			<p>${escapeHtml(s.status['auth-error'])}</p>
			<button id="setKey" class="btn">${escapeHtml(s.setKey)}</button>
		</div>`;
	}
	const text = msg.status === 'no-data' && msg.metrics.length === 0
		? (s.status['no-data'])
		: (s.status[msg.status] || s.status['no-data']);
	return `<div class="status-message"><p>${escapeHtml(text)}</p></div>`;
}

/** Render the opt-in Standard API balance check for a recoverable Coding Plan state. */
function renderRecoveryCard(msg: UsagePanelMessage): string {
	const copy = msg.recoveryReason === 'coding-plan-exhausted'
		? msg.strings.recoveryExhausted
		: msg.strings.recoveryUnavailable;
	return `<div class="recovery-card">
		<p>${escapeHtml(copy)}</p>
		<button id="checkStandard" class="btn">${escapeHtml(msg.strings.checkStandard)}</button>
	</div>`;
}

/** Collect `{ kind: resetsAt }` for metrics that have a reset time, to hydrate the client-side countdown. */
function resetsAtMap(msg: UsagePanelMessage): Record<string, number> {
	const map: Record<string, number> = {};
	for (const m of msg.metrics) {
		if (m.resetsAt !== undefined) {
			map[m.kind] = m.resetsAt;
		}
	}
	return map;
}

/** Generate a CSP nonce for the panel's `<style>` / `<script>` elements. */
function getNonce(): string {
	return randomBytes(16).toString('base64');
}

/** Escape `& < > " '` for safe interpolation into HTML. */
function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON-stringify a value for inline `<script>` interpolation, escaping `<` to prevent tag-break-out. */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
