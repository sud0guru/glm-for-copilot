import { describe, it, expect } from 'vitest';
import { buildUsageMessage, metricPercent, barWidthCss, formatCredits } from './usage-detail-html';
import type { UsageSnapshot } from '../types';
import type { UsageMetricView, UsagePanelStrings } from './usage-detail-html';

function view(m: Omit<UsageMetricView, 'label' | 'window' | 'resetsAt'>): UsageMetricView {
	return { label: '', window: '', ...m };
}

const strings: UsagePanelStrings = {
	title: 'GLM Usage',
	refresh: 'Refresh',
	setKey: 'Set API Key',
	checkStandard: 'Check Standard API',
	offline: 'Offline · showing last data',
	unavailable: 'Usage unavailable.',
	lastUpdated: 'Last updated: {0}',
	resetsIn: 'Resets in {0}',
	plan: 'Plan: {0}',
	renewsAt: 'Renews: {0}',
	window: { session: '5h rolling', weekly: '7-day rolling', 'web-searches': 'Monthly' },
	label: { session: 'Session', weekly: 'Weekly', 'web-searches': 'Web Searches' },
	status: {
		ok: '', loading: 'Refreshing…', 'no-data': 'No usage data.',
		'auth-error': 'API key invalid.', 'network-error': 'Usage unavailable (offline).',
		'server-error': 'Usage request failed.',
	},
	balanceSection: 'Standard API balance',
	balanceAvailable: 'Available',
	balanceRecharged: 'Recharged',
	balanceSpent: 'Spent',
	balanceGifted: 'Gifted',
	balanceFrozen: 'Frozen',
	balancePackages: 'Token packages',
	recoveryUnavailable: 'No usable Coding Plan quota was found.',
	recoveryExhausted: 'Your Coding Plan token quota is exhausted.',
	cardTitle: { session: '5-hour limit', weekly: 'Weekly limit', 'web-searches': 'Web Searches' },
	percentUsed: '{0} % Used',
	credits: 'Credits {0} / {1}',
	resetTime: 'Reset Time: {0}',
	resetQuotaTitle: 'Reset Quota',
	resetTimesUnused: '{0} Times Unused',
	resetBadgeFiveHour: '5-hour limit · {0} times',
	resetBadgeWeekly: 'Weekly limit · {0} times',
	useResetFiveHour: 'Reset 5-hour limit',
	useResetWeekly: 'Reset weekly limit',
	activity: 'Activity',
};

describe('buildUsageMessage', () => {
	it('returns null for gate-failed (no snapshot)', () => {
		expect(buildUsageMessage(null, false, strings, 'dark', '$')).toBeNull();
	});

	it('maps ok with all three metrics, ordered session/weekly/web-searches', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1_000_000, planName: 'GLM Coding Max', renewsAt: '2026-03-12',
			metrics: [
				{ kind: 'session', used: 15, limit: 100, resetsAt: 2_000_000 },
				{ kind: 'weekly', used: 3, limit: 100, resetsAt: 3_000_000 },
				{ kind: 'web-searches', used: 1828, limit: 4000 },
			],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.status).toBe('ok');
		expect(msg?.planName).toBe('GLM Coding Max');
		expect(msg?.renewsAt).toBe('2026-03-12');
		expect(msg?.offline).toBe(false);
		expect(msg?.theme).toBe('dark');
		expect(msg?.lastUpdated).toBe(1_000_000);
		expect(msg?.metrics).toHaveLength(3);
		expect(msg?.metrics[0]).toMatchObject({ kind: 'session', label: 'Session', window: '5h rolling', used: 15, limit: 100, isPercent: true });
		expect(msg?.metrics[1]).toMatchObject({ kind: 'weekly', label: 'Weekly', window: '7-day rolling', used: 3, isPercent: true });
		expect(msg?.metrics[2]).toMatchObject({ kind: 'web-searches', label: 'Web Searches', window: 'Monthly', used: 1828, limit: 4000, isPercent: false });
	});

	it('maps ok with session-only metric', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1, metrics: [{ kind: 'session', used: 42, limit: 100 }],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.metrics).toHaveLength(1);
		expect(msg?.metrics[0].kind).toBe('session');
	});

	it('marks offline true when cache-fallback flag is set', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1, metrics: [{ kind: 'session', used: 42, limit: 100 }],
		};
		const msg = buildUsageMessage(snap, true, strings, 'dark', '$');
		expect(msg?.offline).toBe(true);
	});

	it('maps loading status with empty metrics and no lastUpdated', () => {
		const snap: UsageSnapshot = { status: 'loading', fetchedAt: 1, metrics: [] };
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.status).toBe('loading');
		expect(msg?.metrics).toEqual([]);
		expect(msg?.lastUpdated).toBeUndefined();
	});

	it('maps error statuses with empty metrics', () => {
		for (const status of ['no-data', 'auth-error', 'network-error', 'server-error'] as const) {
			const snap: UsageSnapshot = { status, fetchedAt: 1, metrics: [] };
			const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
			expect(msg?.status).toBe(status);
			expect(msg?.metrics).toEqual([]);
		}
	});

	it('forwards resetsAt from source metrics', () => {
		const snap: UsageSnapshot = {
			status: 'ok', fetchedAt: 1,
			metrics: [{ kind: 'session', used: 1, limit: 100, resetsAt: 9_999_999 }],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.metrics[0].resetsAt).toBe(9_999_999);
	});

	it('forwards the recovery reason selected by the controller', () => {
		const snap: UsageSnapshot = { status: 'no-data', fetchedAt: 1, metrics: [] };
		const msg = buildUsageMessage(
			snap,
			false,
			strings,
			'dark',
			'$',
			'coding-plan-unavailable',
		);
		expect(msg?.recoveryReason).toBe('coding-plan-unavailable');
	});
});

describe('metricPercent', () => {
	it('passes percent metrics through unchanged', () => {
		expect(metricPercent(view({ kind: 'session', used: 28, limit: 100, isPercent: true }))).toBe(28);
	});

	it('clamps percent metrics to 0..100', () => {
		expect(metricPercent(view({ kind: 'session', used: 150, limit: 100, isPercent: true }))).toBe(100);
		expect(metricPercent(view({ kind: 'weekly', used: -5, limit: 100, isPercent: true }))).toBe(0);
	});

	it('computes a ratio percent for count metrics', () => {
		expect(metricPercent(view({ kind: 'web-searches', used: 21, limit: 4000, isPercent: false }))).toBe(1);
		expect(metricPercent(view({ kind: 'web-searches', used: 1828, limit: 4000, isPercent: false }))).toBe(46);
	});

	it('avoids divide-by-zero when limit is 0', () => {
		expect(metricPercent(view({ kind: 'web-searches', used: 5, limit: 0, isPercent: false }))).toBe(100);
	});
});

describe('barWidthCss', () => {
	it('emits one width rule per metric keyed by fill id', () => {
		const css = barWidthCss([
			view({ kind: 'session', used: 28, limit: 100, isPercent: true }),
			view({ kind: 'weekly', used: 20, limit: 100, isPercent: true }),
			view({ kind: 'web-searches', used: 21, limit: 4000, isPercent: false }),
		]);
		expect(css).toContain('#fill-session{width:28%}');
		expect(css).toContain('#fill-weekly{width:20%}');
		expect(css).toContain('#fill-web-searches{width:1%}');
	});

	it('returns an empty string when there are no metrics', () => {
		expect(barWidthCss([])).toBe('');
	});
});

describe('reset quota + credits mapping', () => {
	it('maps banked reset cards to counts', () => {
		const snap: UsageSnapshot = {
			status: 'ok',
			fetchedAt: 1,
			metrics: [],
			resetQuota: {
				fiveHourCards: [{ recordId: 1, resetType: 'FIVE_HOUR' }],
				weekCards: [
					{ recordId: 2, resetType: 'WEEK' },
					{ recordId: 3, resetType: 'WEEK' },
				],
			},
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.resetQuota).toEqual({ fiveHourCount: 1, weekCount: 2 });
	});

	it('leaves resetQuota undefined when the snapshot has no card data', () => {
		const msg = buildUsageMessage({ status: 'ok', fetchedAt: 1, metrics: [] }, false, strings, 'dark', '$');
		expect(msg?.resetQuota).toBeUndefined();
	});

	it('formats credits compactly like the z.ai usage page', () => {
		expect(formatCredits(0)).toBe('0');
		expect(formatCredits(41)).toBe('41');
		expect(formatCredits(12000)).toBe('12K');
		expect(formatCredits(49250)).toBe('49.25K');
		expect(formatCredits(60000)).toBe('60K');
		expect(formatCredits(1032000000)).toBe('1.03B');
	});

	it('maps credit metrics to pre-formatted used/total credits', () => {
		const snap: UsageSnapshot = {
			status: 'ok',
			fetchedAt: 1,
			metrics: [{ kind: 'weekly', used: 82, limit: 100, usedCredits: 49250, totalCredits: 60000 }],
		};
		const msg = buildUsageMessage(snap, false, strings, 'dark', '$');
		expect(msg?.metrics[0].usedCredits).toBe('49.25K');
		expect(msg?.metrics[0].totalCredits).toBe('60K');
	});
});
