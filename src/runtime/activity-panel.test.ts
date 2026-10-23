import { describe, it, expect, afterEach, vi } from 'vitest';

const panel = vi.hoisted(() => ({
	webview: {
		html: '',
		onDidReceiveMessage: vi.fn(() => ({ dispose: () => undefined })),
	},
	reveal: vi.fn(),
	onDidDispose: vi.fn(() => ({ dispose: () => undefined })),
	dispose: vi.fn(),
}));

const messageHandler = vi.hoisted(() => ({
	current: undefined as ((message: { type: string }) => void) | undefined,
}));

vi.mock('vscode', () => ({
	ViewColumn: { Active: 1 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	window: {
		activeColorTheme: { kind: 2 },
		createWebviewPanel: vi.fn(() => panel),
		onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: () => undefined })),
		createOutputChannel: vi.fn(() => ({
			info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), show: vi.fn(), dispose: vi.fn(),
		})),
	},
	commands: { executeCommand: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: (_key: string, def: unknown) => def })) },
	env: { language: 'en' },
}));

import * as vscode from 'vscode';
import { ActivityPanel } from './activity-panel';
import { GLMRequestError } from '../client/errors';
import type { IUsageClient } from '../client/usage';
import type { ActivityDay, IAuthManager } from '../types';

function seriesFor(days: number): ActivityDay[] {
	const series: ActivityDay[] = [];
	const start = new Date('2026-01-01T00:00:00');
	for (let i = 0; i < days; i++) {
		const d = new Date(start);
		d.setDate(d.getDate() + i);
		const pad = (v: number) => String(v).padStart(2, '0');
		series.push({
			date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
			totalTokens: i % 3 === 0 ? 1_000_000 * (i + 1) : 0,
			mcpCalls: 0,
		});
	}
	return series;
}

function createClient(series: ActivityDay[]): { client: IUsageClient; fetchActivity: ReturnType<typeof vi.fn> } {
	const fetchActivity = vi.fn(async () => ({ series, fetchedAt: Date.now() }));
	const client = { fetchActivity } as unknown as IUsageClient;
	return { client, fetchActivity };
}

const auth: IAuthManager = { getApiKey: vi.fn(async () => 'key') } as unknown as IAuthManager;

describe('ActivityPanel', () => {
	afterEach(() => {
		(ActivityPanel as unknown as { currentPanel?: { dispose(): void } }).currentPanel?.dispose();
		panel.webview.html = '';
		messageHandler.current = undefined;
		vi.clearAllMocks();
	});

	it('renders stats, heatmap, and CSP-safe month labels', async () => {
		const { client } = createClient(seriesFor(80));
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('data-mode="daily"'));

		const html = panel.webview.html;
		expect(html).toContain('stat-card');
		expect(html).toContain('data-count-daily');
		// Inline style attributes are stripped by the webview CSP; month label offsets must
		// ride in the nonce'd <style> instead (nth-child rules, one per month).
		expect(html).not.toContain('style="left:');
		expect(html).toMatch(/\.months \.month:nth-child\(1\)\{left:\d+px\}/);
		expect(html).not.toContain('class="spinner"');
	});

	it('shows the loading spinner before data arrives', async () => {
		let resolveFetch: (value: unknown) => void = () => undefined;
		const fetchActivity = vi.fn(async () => {
			await new Promise((resolve) => { resolveFetch = resolve; });
			return { series: [], fetchedAt: Date.now() };
		});
		const client = { fetchActivity } as unknown as IUsageClient;
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		expect(panel.webview.html).toContain('class="spinner"');
		await vi.waitFor(() => expect(fetchActivity).toHaveBeenCalled());
		resolveFetch({ series: [], fetchedAt: Date.now() });
		await vi.waitFor(() => expect(panel.webview.html).not.toContain('class="spinner"'));
	});

	it('renders business failures with the server message', async () => {
		const client = {
			fetchActivity: vi.fn(async () => {
				throw new GLMRequestError({
					message: 'failed',
					kind: 'server',
					baseUrl: 'https://api.z.ai',
					serverMessage: 'no plan found',
					userSummary: 'Request failed',
				});
			}),
		} as unknown as IUsageClient;
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('no plan found'));
	});

	it('refetches when the webview posts refresh', async () => {
		const { client, fetchActivity } = createClient(seriesFor(10));
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('heatmap-panel'));
		const handler = panel.webview.onDidReceiveMessage.mock.calls[0]?.[0] as (message: { type: string }) => void;
		handler?.({ type: 'refresh' });
		await vi.waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2));
	});

	it('never overlaps month labels over a full-year window', async () => {
		// A 365-day window starting in late October puts "Oct" and "Nov" one column apart;
		// without label dropping they render glued as "OctNov".
		const series: ActivityDay[] = [];
		const start = new Date('2025-10-25T00:00:00');
		const end = new Date('2026-10-23T00:00:00');
		const pad = (v: number) => String(v).padStart(2, '0');
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			series.push({
				date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
				totalTokens: 500_000,
				mcpCalls: 0,
			});
			d = new Date(d);
		}
		const { client } = createClient(series);
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('data-mode="daily"'));

		const offsets = [...panel.webview.html.matchAll(/\.months \.month:nth-child\(\d+\)\{left:(\d+)px\}/g)]
			.map((match) => Number(match[1]));
		expect(offsets.length).toBeGreaterThan(10);
		// 3-char months at 10px are ~18px wide: consecutive labels need >= 2 columns (28px).
		for (let i = 1; i < offsets.length; i++) {
			expect(offsets[i] - offsets[i - 1]).toBeGreaterThanOrEqual(28);
		}
	});

	it('anchors heatmap columns to Sun..Sat weeks', async () => {
		// Sun 2026-10-18 through Wed 2026-10-21: the last column must fill rows Sun..Wed
		// (4 leading cells) and leave Thu/Fri/Sat empty, not a Saturday-first rotation.
		const series: ActivityDay[] = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((date) => ({
			date,
			totalTokens: 1_000_000,
			mcpCalls: 0,
		}));
		const { client } = createClient(series);
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('data-mode="daily"'));

		const columns = [...panel.webview.html.matchAll(/<div class="col">([\s\S]*?)<\/div><\/div>/g)];
		const lastColumn = columns[columns.length - 1]?.[1] ?? '';
		const cells = [...lastColumn.matchAll(/<div class="cell( empty)?"/g)].map((match) => match[1] === ' empty');
		expect(cells).toHaveLength(7);
		expect(cells.slice(0, 4)).toEqual([false, false, false, false]);
		expect(cells.slice(4)).toEqual([true, true, true]);
	});

	it('keeps stat card values when the editor theme changes', async () => {
		const fetchActivity = vi.fn(async () => ({
			series: seriesFor(10),
			summary: {
				totalTokens: 10_320_000_000,
				peakDailyTokens: 2_000_000_000,
				peakDailyTokensDate: '2026-10-20',
				totalUsageDurationMs: 6_600_000,
				currentStreakDays: 3,
				longestStreakDays: 9,
			},
			fetchedAt: Date.now(),
		}));
		const client = { fetchActivity } as unknown as IUsageClient;
		ActivityPanel.createOrShow({ subscriptions: [] } as never, client, auth);
		await vi.waitFor(() => expect(panel.webview.html).toContain('10.3B'));

		const themeChange = vi.mocked(vscode.window.onDidChangeActiveColorTheme).mock.calls[0]?.[0] as () => void;
		themeChange();
		await vi.waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(1));
		expect(panel.webview.html).toContain('10.3B');
		expect(panel.webview.html).toContain('9d');
	});
});
