import type { TokenPackage, UsageBalance, UsageMetric, UsageSnapshot, UsageStatus } from '../types';
import { formatAmount, formatTokens } from './format';

export type UsageRecoveryReason = 'coding-plan-unavailable' | 'coding-plan-exhausted';

/** Render-ready metric row (session / weekly / web-searches) for the detail panel. */
export interface UsageMetricView {
	kind: 'session' | 'weekly' | 'web-searches';
	label: string;
	window: string;
	used: number;
	limit: number;
	isPercent: boolean;
	resetsAt?: number;
	/** Credits used in this window (credit-limit plans), pre-formatted ("49.25K"). */
	usedCredits?: string;
	/** Total credits for this window (credit-limit plans), pre-formatted ("60K"). */
	totalCredits?: string;
}

/** Render-ready token resource package row with a pre-formatted token count. */
export interface TokenPackageView {
	name: string;
	tokens: string;
	status: string;
	model?: string;
}

/** Render-ready cash balance section (all amounts are pre-formatted strings with currency). */
export interface UsageBalanceView {
	availableCash?: string;
	totalRecharged?: string;
	totalSpent?: string;
	giftedAmount?: string;
	frozenAmount?: string;
	tokenPackages: TokenPackageView[];
}

/** Render-ready banked-reset ("Reset Quota") summary for the detail panel. */
export interface ResetQuotaView {
	/** Cards that reset the 5-hour window. */
	fiveHourCount: number;
	/** Cards that reset the weekly window. */
	weekCount: number;
}

export interface UsagePanelMessage {
	status: UsageStatus;
	recoveryReason?: UsageRecoveryReason;
	planName?: string;
	renewsAt?: string;
	metrics: UsageMetricView[];
	balance?: UsageBalanceView;
	/** Banked reset cards (Coding Plan only), when the key has card support. */
	resetQuota?: ResetQuotaView;
	/** Currency symbol for balance amounts: `$` (international) or `¥` (china). */
	currency: string;
	lastUpdated?: number;
	offline: boolean;
	theme: 'dark' | 'light';
	strings: UsagePanelStrings;
}

export interface UsagePanelStrings {
	title: string;
	refresh: string;
	setKey: string;
	checkStandard: string;
	offline: string;
	unavailable: string;
	lastUpdated: string;
	resetsIn: string;
	plan: string;
	renewsAt: string;
	window: Record<UsageMetric['kind'], string>;
	label: Record<UsageMetric['kind'], string>;
	status: Record<UsageStatus, string>;
	balanceSection: string;
	balanceAvailable: string;
	balanceRecharged: string;
	balanceSpent: string;
	balanceGifted: string;
	balanceFrozen: string;
	balancePackages: string;
	recoveryUnavailable: string;
	recoveryExhausted: string;
	/** Card titles matching the z.ai usage page. */
	cardTitle: Record<UsageMetric['kind'], string>;
	/** "{0} % Used" — big number caption on metric cards. */
	percentUsed: string;
	/** "Credits {0} / {1}". */
	credits: string;
	/** "Reset Time: {0}". */
	resetTime: string;
	/** Reset Quota card title. */
	resetQuotaTitle: string;
	/** "{0} Times Unused". */
	resetTimesUnused: string;
	/** "5-hour limit · {0} times" badge. */
	resetBadgeFiveHour: string;
	/** "Weekly limit · {0} times" badge. */
	resetBadgeWeekly: string;
	/** Button: redeem a 5-hour reset card. */
	useResetFiveHour: string;
	/** Button: redeem a weekly reset card. */
	useResetWeekly: string;
	/** Header button opening the Activity panel. */
	activity: string;
}

/**
 * Convert a UsageSnapshot (the bar's effective state) into the render-ready view model that the
 * detail panel bakes into its HTML server-side. Returns null when there is no snapshot to show
 * (gate failed while pane is open). Pure: no VS Code dependency.
 */
export function buildUsageMessage(
	snapshot: UsageSnapshot | null,
	offline: boolean,
	strings: UsagePanelStrings,
	theme: 'dark' | 'light',
	currency: string,
	recoveryReason?: UsageRecoveryReason,
): UsagePanelMessage | null {
	if (snapshot === null) {
		return null;
	}
	return {
		status: snapshot.status,
		recoveryReason,
		planName: snapshot.planName,
		renewsAt: snapshot.renewsAt,
		metrics: snapshot.metrics.map(toMetricView, strings),
		balance: snapshot.balance ? toBalanceView(snapshot.balance) : undefined,
		resetQuota: snapshot.resetQuota
			? {
				fiveHourCount: snapshot.resetQuota.fiveHourCards.length,
				weekCount: snapshot.resetQuota.weekCards.length,
			}
			: undefined,
		currency,
		lastUpdated: snapshot.status === 'ok' ? snapshot.fetchedAt : undefined,
		offline,
		theme,
		strings,
	};
}

/** Map a {@link UsageMetric} to a {@link UsageMetricView}, pulling labels from `this` (the strings bag). */
function toMetricView(this: UsagePanelStrings, metric: UsageMetric): UsageMetricView {
	const isPercent = metric.kind === 'session' || metric.kind === 'weekly';
	return {
		kind: metric.kind,
		label: this.label[metric.kind],
		window: this.window[metric.kind],
		used: metric.used,
		limit: metric.limit,
		isPercent,
		resetsAt: metric.resetsAt,
		...(metric.usedCredits !== undefined && metric.totalCredits !== undefined
			? {
				usedCredits: formatCredits(metric.usedCredits),
				totalCredits: formatCredits(metric.totalCredits),
			}
			: {}),
	};
}

/**
 * Compact credit formatting matching the z.ai usage page: 49250 → "49.25K", 60000 → "60K",
 * 1032000000 → "1.03B", 41 → "41".
 */
export function formatCredits(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1e9) return `${trimFraction(value / 1e9)}B`;
	if (abs >= 1e6) return `${trimFraction(value / 1e6)}M`;
	if (abs >= 1e3) return `${trimFraction(value / 1e3)}K`;
	return String(Math.round(value));
}

/** Round to at most 2 decimals, dropping trailing zeros ("49.25", "60", "1"). */
function trimFraction(value: number): string {
	return String(Math.round(value * 100) / 100);
}

/** Map a {@link UsageBalance} to a {@link UsageBalanceView} with formatted amounts and packages. */
function toBalanceView(balance: UsageBalance): UsageBalanceView {
	return {
		availableCash: balance.availableCash !== undefined ? formatAmount(balance.availableCash) : undefined,
		totalRecharged: balance.totalRecharged !== undefined ? formatAmount(balance.totalRecharged) : undefined,
		totalSpent: balance.totalSpent !== undefined ? formatAmount(balance.totalSpent) : undefined,
		giftedAmount: balance.giftedAmount !== undefined ? formatAmount(balance.giftedAmount) : undefined,
		frozenAmount: balance.frozenAmount !== undefined ? formatAmount(balance.frozenAmount) : undefined,
		tokenPackages: balance.tokenPackages.map(toPackageView),
	};
}

/** Map a {@link TokenPackage} to a {@link TokenPackageView}, formatting the token count compactly. */
function toPackageView(pkg: TokenPackage): TokenPackageView {
	const tokens = pkg.remainingTokens * pkg.magnitude;
	return {
		name: pkg.name,
		tokens: formatTokens(tokens),
		status: pkg.status,
		model: pkg.model,
	};
}

/** Bar fill width for a metric, as a clamped 0..100 integer percent. */
export function metricPercent(view: UsageMetricView): number {
	const raw = view.isPercent ? view.used : Math.round((view.used / Math.max(view.limit, 1)) * 100);
	return Math.min(Math.max(raw, 0), 100);
}

/**
 * CSS rules that size each bar fill, one `#fill-<kind>{width:N%}` per metric. Injected into the
 * panel's nonce'd <style> element so the width survives the webview CSP, which strips inline
 * style="" attributes (a nonce authorizes <style> elements, never style attributes).
 */
export function barWidthCss(metrics: UsageMetricView[]): string {
	return metrics.map((m) => `#fill-${m.kind}{width:${metricPercent(m)}%}`).join('\n');
}
