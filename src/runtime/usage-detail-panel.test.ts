import { describe, it, expect, afterEach, vi } from 'vitest';
import type { UsagePanelMessage } from './usage-detail-html';

const panelHarness = vi.hoisted(() => ({
	messageHandler: undefined as ((message: { type: string }) => Promise<void>) | undefined,
}));

const panel = vi.hoisted(() => ({
	title: '',
	webview: {
		html: '',
		onDidReceiveMessage: vi.fn((handler: (message: { type: string }) => Promise<void>) => {
			panelHarness.messageHandler = handler;
			return { dispose: () => undefined };
		}),
	},
	reveal: vi.fn(),
	onDidDispose: vi.fn(() => ({ dispose: () => undefined })),
	dispose: vi.fn(),
}));

vi.mock('node:crypto', () => ({
	randomBytes: vi.fn(() => Buffer.from('0123456789abcdef')),
}));

vi.mock('vscode', () => ({
	ViewColumn: { Active: 1 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	window: {
		activeColorTheme: { kind: 1 },
		createWebviewPanel: vi.fn(() => panel),
		onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: () => undefined })),
	},
	commands: { executeCommand: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: () => undefined })) },
	env: { language: 'en' },
}));

import { randomBytes } from 'node:crypto';
import { UsageDetailPanel } from './usage-detail-panel';

function recoveryMessage(reason: NonNullable<UsagePanelMessage['recoveryReason']>): UsagePanelMessage {
	return {
		status: reason === 'coding-plan-exhausted' ? 'ok' : 'no-data',
		recoveryReason: reason,
		metrics: reason === 'coding-plan-exhausted'
			? [{ kind: 'session', label: 'Session', window: '5h rolling', used: 100, limit: 100, isPercent: true }]
			: [],
		currency: '$',
		offline: false,
		theme: 'light',
		strings: {
			title: 'GLM Usage',
			refresh: 'Refresh',
			setKey: 'Set API Key',
			checkStandard: 'Check Standard API',
			offline: 'Offline',
			unavailable: 'Unavailable',
			lastUpdated: 'Last updated: {0}',
			resetsIn: 'Resets in {0}',
			plan: 'Plan: {0}',
			renewsAt: 'Renews: {0}',
			window: { session: '5h rolling', weekly: '7-day rolling', 'web-searches': 'Monthly' },
			label: { session: 'Session', weekly: 'Weekly', 'web-searches': 'Web Searches' },
			status: {
				ok: '',
				loading: 'Refreshing',
				'no-data': 'No usage data',
				'auth-error': 'Invalid key',
				'network-error': 'Offline',
				'server-error': 'Request failed',
			},
			balanceSection: 'Balance',
			balanceAvailable: 'Available',
			balanceRecharged: 'Recharged',
			balanceSpent: 'Spent',
			balanceGifted: 'Gifted',
			balanceFrozen: 'Frozen',
			balancePackages: 'Packages',
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
		},
	};
}

function createBar(message: UsagePanelMessage | null) {
	return {
		getSnapshot: () => message,
		onDidChangeSnapshot: vi.fn(() => ({ dispose: () => undefined })),
		refresh: vi.fn(async () => undefined),
		checkStandardApi: vi.fn(async () => undefined),
		useResetQuota: vi.fn(async () => undefined),
	};
}

describe('UsageDetailPanel', () => {
	afterEach(() => {
		const currentPanel = (UsageDetailPanel as unknown as { currentPanel?: { dispose(): void } }).currentPanel;
		currentPanel?.dispose();
		panel.webview.html = '';
		panelHarness.messageHandler = undefined;
		vi.clearAllMocks();
	});

	it('generates the CSP nonce with node crypto', () => {
		const bar = createBar(null);
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);
		const expectedNonce = Buffer.from('0123456789abcdef').toString('base64');
		expect(randomBytes).toHaveBeenCalledWith(16);
		expect(panel.webview.html).toContain(`style-src 'nonce-${expectedNonce}'`);
		expect(panel.webview.html).toContain(`style nonce="${expectedNonce}"`);
		expect(panel.webview.html).toContain(`script nonce="${expectedNonce}"`);
	});

	it.each([
		['coding-plan-unavailable', 'No usable Coding Plan quota was found.'],
		['coding-plan-exhausted', 'Your Coding Plan token quota is exhausted.'],
	] as const)('renders %s recovery with an explicit Standard check', (reason, copy) => {
		const bar = createBar(recoveryMessage(reason));
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		expect(panel.webview.html).toContain(copy);
		expect(panel.webview.html).toContain('Check Standard API');
		if (reason === 'coding-plan-exhausted') {
			expect(panel.webview.html).toContain('100');
			expect(panel.webview.html).toContain('% Used');
		}
	});

	it('routes the Standard check action to the usage controller', async () => {
		const bar = createBar(recoveryMessage('coding-plan-unavailable'));
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		await panelHarness.messageHandler?.({ type: 'checkStandard' });

		expect(bar.checkStandardApi).toHaveBeenCalledTimes(1);
	});

	it('renders the Reset Quota card with badges and redeem buttons', () => {
		const message = recoveryMessage('coding-plan-unavailable');
		const okMessage: UsagePanelMessage = {
			...message,
			status: 'ok',
			metrics: [{ kind: 'weekly', label: 'Weekly', window: '7-day rolling', used: 82, limit: 100, isPercent: true, usedCredits: '49.25K', totalCredits: '60K', resetsAt: 1761385800000 }],
			resetQuota: { fiveHourCount: 0, weekCount: 3 },
		};
		const bar = createBar(okMessage);
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		const html = panel.webview.html;
		expect(html).toContain('Reset Quota');
		expect(html).toMatch(/>3<\/span>/);
		expect(html).toContain('Times Unused');
		expect(html).toContain('Weekly limit · 3 times');
		expect(html).toContain('5-hour limit · 0 times');
		expect(html).toContain('id="reset-week"');
		expect(html).not.toContain('id="reset-five-hour"');
		expect(html).toContain('Credits 49.25K / 60K');
		expect(html).toContain('>82</span>');
		expect(html).toContain('% Used');
		expect(html).toContain('bar-fill warn');
		expect(html).toContain('Reset Time:');
	});

	it('routes reset-redemption actions to the usage controller', async () => {
		const message = recoveryMessage('coding-plan-unavailable');
		message.status = 'ok';
		message.resetQuota = { fiveHourCount: 1, weekCount: 2 };
		const bar = createBar(message);
		UsageDetailPanel.createOrShow(
			{ subscriptions: [] } as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[0],
			bar as unknown as Parameters<typeof UsageDetailPanel.createOrShow>[1],
		);

		await panelHarness.messageHandler?.({ type: 'useReset', resetType: 'WEEK' } as { type: string });

		expect(bar.useResetQuota).toHaveBeenCalledWith('WEEK');
	});
});
