import { randomUUID } from 'node:crypto';
import { ACTIVITY_PATH, BALANCE_PATHS, RESET_PATHS, USAGE_PATHS, USAGE_REQUEST_TIMEOUT_MS } from '../consts';
import { logger } from '../logger';
import type { TokenPackage, UsageBalance, UsageMetric, UsageSnapshot, UsageStatus, ResetCard, ResetCardWindow, ResetQuota, ActivitySnapshot, ActivitySummary, ActivityDay } from '../types';
import {
	createBusinessError,
	createHttpError,
	createResponseParseError,
	formatRequestError,
	GLMRequestError,
	isAbortError,
	isAuthenticationRequestError,
	isCodingPlanUnavailableRequestError,
	normalizeRequestError,
} from './errors';
import { readBusinessJson } from './response';

interface ZaiLimit {
	type?: string;
	name?: string;
	unit?: number;
	usage?: number;
	currentValue?: number;
	percentage?: number;
	nextResetTime?: number;
	remaining?: number;
}

interface ZaiQuotaResponse {
	code?: number;
	data?: { limits?: ZaiLimit[] } | ZaiLimit[];
}

interface ZaiSubscriptionResponse {
	data?: Array<{ productName?: string; nextRenewTime?: string }>;
}

interface ZaiResetCardRaw {
	recordId?: unknown;
	id?: unknown;
	packageResetId?: unknown;
	resetId?: unknown;
	status?: string;
	state?: string;
	available?: boolean;
	consumed?: boolean;
	redeemed?: boolean;
	expireTime?: string;
	expiredTime?: string;
	expiresAt?: string;
	endTime?: string;
	packageName?: string;
	name?: string;
	title?: string;
}

interface ZaiResetCardListResponse {
	code?: number;
	success?: boolean;
	data?: {
		fiveHourResets?: ZaiResetCardRaw[];
		weekResets?: ZaiResetCardRaw[];
		lastFiveHourResetTime?: string;
		lastWeekResetTime?: string;
	};
}

interface GlmActivityResponse {
	code?: number | null;
	msg?: string;
	success?: boolean;
	data?: {
		summary?: {
			totalTokens?: number;
			peakDailyTokens?: number;
			peakDailyTokensDate?: string;
			totalUsageDurationMs?: number;
			currentStreakDays?: number;
			longestStreakDays?: number;
		};
		series?: Array<{ date?: string; totalTokens?: number; mcpCalls?: number }>;
	};
}

interface BigmodelAccountReport {
	success?: boolean;
	data?: {
		balance?: number;
		rechargeAmount?: number;
		giveAmount?: number;
		totalSpendAmount?: number;
		frozenBalance?: number;
		availableBalance?: number;
	};
}

interface BigmodelTokenAccount {
	tokenBalance?: number;
	tokensMagnitude?: number;
	status?: string;
	resourcePackageName?: string;
	suitableModel?: string;
}

interface BigmodelTokenAccountsResponse {
	code?: number;
	rows?: BigmodelTokenAccount[];
}

/** Contract for the usage/balance client used by {@link UsageStatusBar}. */
export interface IUsageClient {
	/** Fetch Coding Plan quota (session/weekly/web-searches) as a {@link UsageSnapshot}. */
	fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot>;
	/** Fetch Standard API balance (cash + token packages) as a snapshot with `balance` populated. */
	fetchBalance(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot>;
	/** Redeem one banked reset card on a Coding Plan key. Resolves only on success. */
	useResetCard(apiKey: string, card: ResetCard, signal?: AbortSignal): Promise<void>;
	/** Fetch Coding Plan activity history (summary stats + per-day heatmap series). */
	fetchActivity(apiKey: string, signal?: AbortSignal): Promise<ActivitySnapshot>;
}

/**
 * GLM usage + balance client. `fetchSnapshot` fetches Coding Plan quota (subscription + quota GETs);
 * `fetchBalance` fetches Standard API cash balance + token packages (two parallel GETs).
 * Supplementary request failures preserve usable primary data and otherwise set the error status.
 *
 * Both stations (z.ai international + open.bigmodel.cn china) share the same paths and JSON
 * shapes; only the host and Authorization header differ. The China (open.bigmodel.cn) monitor
 * endpoint authenticates with the RAW API key (no `Bearer` prefix), while z.ai uses `Bearer {key}`. The scheme is detected
 * from the request URL (which carries the region host).
 *
 * The host is resolved on EVERY `fetchSnapshot` call (via `resolveHost`) rather than captured at
 * construction, so the bar follows `glm-copilot.region` changes without recreating the client. A
 * static string is still accepted (normalized to a constant resolver) for convenience in tests. The
 * region is resolved once per snapshot so the subscription + quota sub-requests always hit one host.
 */
export class UsageClient implements IUsageClient {
	private readonly resolveHost: () => string;

	constructor(
		hostOrResolver: string | (() => string),
		private readonly fetchImpl: typeof fetch = fetch,
	) {
		this.resolveHost = typeof hostOrResolver === 'string' ? () => hostOrResolver : hostOrResolver;
	}

	/**
	 * Fetch Coding Plan usage quota. Resolves the host, then fires subscription + quota requests in
	 * parallel; the subscription result (plan name + renewal) is merged into the quota snapshot.
	 * Subscription failure is best-effort when quota data is usable and otherwise determines the
	 * error status instead of being reduced to `no-data`.
	 */
	async fetchSnapshot(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const host = this.resolveHost();
		const [subscriptionResult, quotaResult, resetResult] = await Promise.allSettled([
			this.fetchSubscription(host, apiKey, signal),
			this.fetchQuota(host, apiKey, signal),
			this.fetchResetQuota(host, apiKey, signal),
		]);
		if (quotaResult.status === 'rejected') {
			throw quotaResult.reason;
		}
		const snapshot = quotaResult.value;
		// Banked reset cards are supplementary: failures never degrade a usable quota snapshot.
		if (resetResult.status === 'fulfilled' && resetResult.value) {
			snapshot.resetQuota = resetResult.value;
		} else if (resetResult.status === 'rejected' && !isAbortError(resetResult.reason)) {
			this.logRequestError(resetResult.reason, host);
		}
		if (subscriptionResult.status === 'fulfilled') {
			return { ...snapshot, ...subscriptionResult.value };
		}
		if (isAbortError(subscriptionResult.reason)) {
			throw subscriptionResult.reason;
		}
		if (
			isAuthenticationRequestError(subscriptionResult.reason) ||
			snapshot.status === 'no-data'
		) {
			return this.toErrorSnapshot(subscriptionResult.reason, host, snapshot.fetchedAt);
		}
		this.logRequestError(subscriptionResult.reason, host);
		return snapshot;
	}

	/**
	 * Fetch Standard API balance. Two parallel GETs against the biz gateway: a cash account report
	 * and a token resource-package list. Either may fail independently — the account report is the
	 * primary signal; token packages are supplementary.
	 */
	async fetchBalance(apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const host = this.resolveHost();
		const fetchedAt = Date.now();
		const [accountResult, packagesResult] = await Promise.allSettled([
			this.fetchAccountReport(host, apiKey, signal),
			this.fetchTokenAccounts(host, apiKey, signal),
		]);

		// If the primary (account report) failed, surface its error status.
		if (accountResult.status === 'rejected') {
			if (isAbortError(accountResult.reason)) {
				throw accountResult.reason;
			}
			return this.toErrorSnapshot(accountResult.reason, host, fetchedAt);
		}
		const account = accountResult.value;

		const hasAccountData =
			account.availableCash !== undefined ||
			account.totalRecharged !== undefined ||
			account.totalSpent !== undefined ||
			account.giftedAmount !== undefined ||
			account.frozenAmount !== undefined;
		if (packagesResult.status === 'rejected' && isAbortError(packagesResult.reason)) {
			throw packagesResult.reason;
		}
		if (
			packagesResult.status === 'rejected' &&
			(isAuthenticationRequestError(packagesResult.reason) || !hasAccountData)
		) {
			return this.toErrorSnapshot(packagesResult.reason, host, fetchedAt);
		}
		if (packagesResult.status === 'rejected') {
			this.logRequestError(packagesResult.reason, host);
		}
		const packages = packagesResult.status === 'fulfilled' ? packagesResult.value : [];

		const balance: UsageBalance = { ...account, tokenPackages: packages };
		const hasData = hasAccountData || packages.length > 0;
		return {
			status: hasData ? 'ok' : 'no-data',
			balance,
			metrics: [],
			fetchedAt,
		};
	}
	/**
	 * Fetch the cash account report (balance, recharge, spend, gift, frozen) from the biz gateway.
	 * Throws on HTTP error so the caller can map it to an error status.
	 */
	private async fetchAccountReport(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<Omit<UsageBalance, 'tokenPackages'>> {
		const response = await this.get(`${host}${BALANCE_PATHS.accountReport}`, apiKey, signal);
		const parsed = await readBusinessJson<BigmodelAccountReport>(response, {
			baseUrl: host,
			operation: 'account report',
		});
		const d = parsed?.data;
		return {
			availableCash: finiteOr(d?.availableBalance ?? d?.balance),
			totalRecharged: finiteOr(d?.rechargeAmount),
			totalSpent: finiteOr(d?.totalSpendAmount),
			giftedAmount: finiteOr(d?.giveAmount),
			frozenAmount: finiteOr(d?.frozenBalance),
		};
	}

	/**
	 * Fetch the list of token resource packages. Filters to EFFECTIVE packages (plus any with a
	 * non-null balance). The caller decides whether a failure can degrade to cash-only data.
	 */
	private async fetchTokenAccounts(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<TokenPackage[]> {
		const url = `${host}${BALANCE_PATHS.tokenAccounts}?pageNum=1&pageSize=100`;
		const response = await this.get(url, apiKey, signal);
		const parsed = await readBusinessJson<BigmodelTokenAccountsResponse>(response, {
			baseUrl: host,
			operation: 'token accounts',
		});
		const rows = parsed?.rows;
		if (!Array.isArray(rows)) {
			return [];
		}
		return rows
			.filter((r) => r.status === 'EFFECTIVE' || r.tokenBalance !== undefined)
			.map((r) => ({
				name: r.resourcePackageName ?? 'Token Package',
				remainingTokens: numberOr(r.tokenBalance),
				magnitude: numberOr(r.tokensMagnitude, 1),
				status: r.status ?? 'UNKNOWN',
				model: r.suitableModel,
			}));
	}

	/**
	 * Fetch the Coding Plan subscription plan name and renewal time.
	 */
	private async fetchSubscription(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<{ planName?: string; renewsAt?: string }> {
		const response = await this.get(`${host}${USAGE_PATHS.subscription}`, apiKey, signal);
		const data = await readBusinessJson<ZaiSubscriptionResponse>(response, {
			baseUrl: host,
			operation: 'subscription',
		});
		const first = data?.data?.[0];
		if (!first) {
			return {};
		}
		return {
			planName: first.productName,
			renewsAt: first.nextRenewTime,
		};
	}

	/**
	 * List banked reset cards ("Reset Quota"). Returns undefined when the account has no card
	 * support or no cards banked — supplementary data that must not affect the snapshot status.
	 */
	private async fetchResetQuota(
		host: string,
		apiKey: string,
		signal?: AbortSignal,
	): Promise<ResetQuota | undefined> {
		const url = `${host}${RESET_PATHS.list}?targetType=PERSONAL`;
		const response = await this.get(url, apiKey, signal);
		const parsed = await readBusinessJson<ZaiResetCardListResponse>(response, {
			baseUrl: host,
			operation: 'reset cards',
		});
		const data = parsed?.data;
		if (!data || typeof data !== 'object') {
			return undefined;
		}
		const fiveHourCards = parseResetCards(data.fiveHourResets, 'FIVE_HOUR');
		const weekCards = parseResetCards(data.weekResets, 'WEEK');
		return {
			fiveHourCards,
			weekCards,
			lastFiveHourResetAt: data.lastFiveHourResetTime,
			lastWeekResetAt: data.lastWeekResetTime,
		};
	}

	/**
	 * Redeem one banked reset card via `/use`. Mirrors the official dashboard: `targetType` is
	 * fixed to PERSONAL, `recordId` is posted as the numeric id from the list response, and a
	 * fresh `requestId` guards against double submission. Resolves only when the envelope
	 * reports success; business failures throw with the server message.
	 */
	async useResetCard(apiKey: string, card: ResetCard, signal?: AbortSignal): Promise<void> {
		const host = this.resolveHost();
		const url = `${host}${RESET_PATHS.use}`;
		const body = JSON.stringify({
			targetType: 'PERSONAL',
			resetType: card.resetType,
			recordId: card.recordId,
			requestId: randomUUID(),
		});
		const response = await this.post(url, apiKey, body, signal);
		const parsed = await readBusinessJson<{ success?: boolean; msg?: string }>(response, {
			baseUrl: host,
			operation: 'use reset card',
		});
		if (parsed?.success !== true) {
			throw createBusinessError({
				baseUrl: host,
				operation: 'use reset card',
				serverMessage: parsed?.msg,
			});
		}
	}

	/**
	 * Fetch the Coding Plan activity history backing the site's Activity page. The window is the
	 * last 365 days (site-local "YYYY-MM-DD HH:MM:SS", matching the official frontend). The
	 * endpoint's success check is looser than the biz gateway's: `code` 0/200/null with
	 * `success !== false` all count as success.
	 */
	async fetchActivity(apiKey: string, signal?: AbortSignal): Promise<ActivitySnapshot> {
		const host = this.resolveHost();
		const { startTime, endTime } = activityTimeRange();
		// `type` routes the monitor family: 1 = personal Coding Plan, 3 = team credit-usage
		// (per the official client; a literal like PERSONAL fails parameter validation).
		const url = `${host}${ACTIVITY_PATH}?type=1&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
		const response = await this.get(url, apiKey, signal);
		if (!response.ok) {
			throw await createHttpError(response, { baseUrl: host });
		}
		let parsed: GlmActivityResponse;
		try {
			parsed = await response.json() as GlmActivityResponse;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			throw createResponseParseError({ baseUrl: host, operation: 'activity' }, error);
		}
		if (!isActivitySuccess(parsed)) {
			throw createBusinessError({
				baseUrl: host,
				operation: 'activity',
				code: parsed?.code !== undefined && parsed?.code !== null ? String(parsed.code) : undefined,
				serverMessage: parsed?.msg,
			});
		}
		const data = parsed?.data;
		const summary: ActivitySummary | undefined = data?.summary
			? {
				totalTokens: numberOr(data.summary.totalTokens),
				peakDailyTokens: numberOr(data.summary.peakDailyTokens),
				peakDailyTokensDate: data.summary.peakDailyTokensDate,
				totalUsageDurationMs: numberOr(data.summary.totalUsageDurationMs),
				currentStreakDays: numberOr(data.summary.currentStreakDays),
				longestStreakDays: numberOr(data.summary.longestStreakDays),
			}
			: undefined;
		const series: ActivityDay[] = (data?.series ?? [])
			.filter((day) => typeof day?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date))
			.map((day) => ({
				date: day.date as string,
				totalTokens: numberOr(day.totalTokens),
				mcpCalls: numberOr(day.mcpCalls),
			}))
			.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		return { summary, series, fetchedAt: Date.now() };
	}

	/**
	 * Fetch the Coding Plan quota limits and map them to {@link UsageMetric}s. Aborts propagate;
	 * HTTP/parse failures map to error statuses. Empty or unparseable limits map to `no-data`.
	 */
	private async fetchQuota(host: string, apiKey: string, signal?: AbortSignal): Promise<UsageSnapshot> {
		const fetchedAt = Date.now();
		let parsed: ZaiQuotaResponse;
		try {
			const response = await this.get(`${host}${USAGE_PATHS.quota}`, apiKey, signal);
			parsed = await readBusinessJson<ZaiQuotaResponse>(response, {
				baseUrl: host,
				operation: 'quota',
			});
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			return this.toErrorSnapshot(error, host, fetchedAt);
		}
		const limits = extractLimits(parsed);
		if (!Array.isArray(limits) || limits.length === 0) {
			return { status: 'no-data', metrics: [], fetchedAt };
		}
		const metrics = buildMetrics(limits);
		if (metrics.length === 0) {
			return { status: 'no-data', metrics: [], fetchedAt };
		}
		return { status: 'ok', metrics, fetchedAt };
	}

	/**
	 * GET a URL with the host-appropriate Authorization header, a {@link USAGE_REQUEST_TIMEOUT_MS}
	 * timeout, and caller-signal forwarding. Re-throws aborts; converts timeout aborts to a TypeError.
	 */
	private async get(url: string, apiKey: string, signal?: AbortSignal): Promise<Response> {
		const controller = new AbortController();
		let didTimeout = false;
		if (signal?.aborted) {
			controller.abort();
		}
		const timer = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, USAGE_REQUEST_TIMEOUT_MS);
		timer.unref?.();
		const onCallerAbort = () => controller.abort();
		signal?.addEventListener('abort', onCallerAbort, { once: true });
		try {
			return await this.fetchImpl(url, {
				method: 'GET',
				headers: {
					Authorization: this.authHeader(url, apiKey),
					Accept: 'application/json',
				},
				signal: controller.signal,
			});
		} catch (error) {
			if (didTimeout && isAbortError(error)) {
				throw Object.assign(new TypeError('fetch timed out'), {
					cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
				});
			}
			throw error;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onCallerAbort);
		}
	}

	/**
	 * POST a JSON body with the host-appropriate Authorization header. Same timeout and
	 * abort-forwarding semantics as {@link get}.
	 */
	private async post(url: string, apiKey: string, body: string, signal?: AbortSignal): Promise<Response> {
		const controller = new AbortController();
		let didTimeout = false;
		if (signal?.aborted) {
			controller.abort();
		}
		const timer = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, USAGE_REQUEST_TIMEOUT_MS);
		timer.unref?.();
		const onCallerAbort = () => controller.abort();
		signal?.addEventListener('abort', onCallerAbort, { once: true });
		try {
			return await this.fetchImpl(url, {
				method: 'POST',
				headers: {
					Authorization: this.authHeader(url, apiKey),
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body,
				signal: controller.signal,
			});
		} catch (error) {
			if (didTimeout && isAbortError(error)) {
				throw Object.assign(new TypeError('fetch timed out'), {
					cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
				});
			}
			throw error;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onCallerAbort);
		}
	}

	/**
	 * Build the Authorization header for a URL. China (open.bigmodel.cn) uses the RAW key;
	 * z.ai uses `Bearer {key}`. Detected from the request URL, not the region setting, so the
	 * header always matches the actual host.
	 */
	private authHeader(url: string, apiKey: string): string {
		return url.includes('bigmodel.cn') ? apiKey : `Bearer ${apiKey}`;
	}

	/**
	 * Map a structured request error to a {@link UsageSnapshot} status.
	 */
	private toErrorSnapshot(error: unknown, host: string, fetchedAt: number): UsageSnapshot {
		const normalized = normalizeRequestError(error, { baseUrl: host });
		logger.warn('GLM usage request failed:', formatRequestError(normalized));
		let status: UsageStatus = 'server-error';
		if (isAuthenticationRequestError(normalized)) {
			status = 'auth-error';
		} else if (normalized instanceof GLMRequestError && normalized.kind === 'network') {
			status = 'network-error';
		}
		return {
			status,
			metrics: [],
			fetchedAt,
			...(isCodingPlanUnavailableRequestError(normalized)
				? { failureReason: 'coding-plan-unavailable' as const }
				: {}),
		};
	}

	private logRequestError(error: unknown, host: string): void {
		const normalized = normalizeRequestError(error, { baseUrl: host });
		logger.warn('GLM supplementary usage request failed:', formatRequestError(normalized));
	}
}

/** Extract the `limits` array from a quota response, tolerating both `data.limits` and top-level array shapes. */
function extractLimits(response: ZaiQuotaResponse): ZaiLimit[] | undefined {
	const container = response.data ?? response;
	if (Array.isArray(container)) {
		return container;
	}
	return (container as { limits?: ZaiLimit[] }).limits;
}

/**
 * Ported verbatim from openusage plugins/zai/plugin.js findLimit. Matches by `type || name`;
 * filters by `unit` when supplied; the first matching entry whose `unit` is undefined is the
 * fallback.
 */
function findLimit(limits: ZaiLimit[], type: string, unit?: number): ZaiLimit | null {
	let fallback: ZaiLimit | null = null;
	for (const item of limits) {
		if (item.type === type || item.name === type) {
			if (unit === undefined) {
				return item;
			}
			if (item.unit === unit) {
				return item;
			}
			if (fallback === null && item.unit === undefined) {
				fallback = item;
			}
		}
	}
	return fallback;
}

/** Coerce to a finite number, falling back to `fallback` (default 0) when not numeric. */
function numberOr(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a finite number, returning undefined when not numeric (for optional balance fields). */
function finiteOr(value: unknown, fallback?: number): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	// Reject empty/whitespace-only strings: Number("") === Number("  ") === 0, which would
	// wrongly turn a missing balance field into a zero value. Keep valid numeric strings.
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) {
			return n;
		}
	}
	return fallback;
}

/** Epoch-ms of the next UTC midnight on the 1st of the month (default reset for monthly web-search windows lacking a `nextResetTime`). */
function nextUtcFirstOfMonthMs(now: Date = new Date()): number {
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Map raw `TOKENS_LIMIT` / `CREDIT_LIMIT` / `TIME_LIMIT` entries to the ordered metric list
 * (`session` → `weekly` → `web-searches`), skipping any window that is absent.
 */
function buildMetrics(limits: ZaiLimit[]): UsageMetric[] {
	const metrics: UsageMetric[] = [];
	const session = findLimit(limits, 'TOKENS_LIMIT', 3) ?? findLimit(limits, 'CREDIT_LIMIT', 3);
	if (session) {
		metrics.push({
			kind: 'session',
			used: numberOr(session.percentage),
			limit: 100,
			resetsAt: session.nextResetTime,
			...creditsOf(session),
		});
	}
	const weekly = findLimit(limits, 'TOKENS_LIMIT', 6) ?? findLimit(limits, 'CREDIT_LIMIT', 6);
	if (weekly) {
		metrics.push({
			kind: 'weekly',
			used: weekly.percentage !== undefined && Number.isFinite(weekly.percentage) ? weekly.percentage : 0,
			limit: 100,
			resetsAt: weekly.nextResetTime,
			...creditsOf(weekly),
		});
	}
	const time = findLimit(limits, 'TIME_LIMIT');
	if (time) {
		metrics.push({
			kind: 'web-searches',
			used: numberOr(time.currentValue),
			limit: numberOr(time.usage),
			resetsAt: time.nextResetTime ?? nextUtcFirstOfMonthMs(),
		});
	}
	return metrics;
}

/**
 * Credit used/total for a `CREDIT_LIMIT` entry, as shown on the official usage page
 * ("Credits currentValue / usage"). Omitted when either side is missing or non-finite.
 */
function creditsOf(limit: ZaiLimit): Pick<UsageMetric, 'usedCredits' | 'totalCredits'> {
	if (
		typeof limit.currentValue === 'number' && Number.isFinite(limit.currentValue) &&
		typeof limit.usage === 'number' && Number.isFinite(limit.usage) && limit.usage > 0
	) {
		return { usedCredits: limit.currentValue, totalCredits: limit.usage };
	}
	return {};
}

/** z.ai renders timezone-less timestamps as site-local; parse them as UTC while keeping ISO support. */
function parseResetCardExpiry(value: string): number | null {
	const zai = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
	if (zai) {
		return Date.UTC(Number(zai[1]), Number(zai[2]) - 1, Number(zai[3]), Number(zai[4]), Number(zai[5]), Number(zai[6]));
	}
	const iso = Date.parse(value);
	return Number.isFinite(iso) ? iso : null;
}

/** Parse one raw reset-card bucket, dropping unavailable/consumed/expired entries. */
function parseResetCards(entries: unknown, resetType: ResetCardWindow): ResetCard[] {
	if (!Array.isArray(entries)) {
		return [];
	}
	const now = Date.now();
	const cards: ResetCard[] = [];
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const record = entry as ZaiResetCardRaw;
		const status = String(record.status ?? record.state ?? '').trim().toLowerCase();
		if (['consumed', 'redeeming', 'redeemed', 'used', 'expired', 'unavailable'].includes(status)) {
			continue;
		}
		if (record.available === false || record.consumed === true || record.redeemed === true) {
			continue;
		}
		const rawId = record.recordId ?? record.id ?? record.packageResetId ?? record.resetId;
		const recordId = typeof rawId === 'number' && Number.isFinite(rawId)
			? rawId
			: typeof rawId === 'string' && rawId.trim() !== '' && Number.isFinite(Number(rawId))
				? Number(rawId)
				: undefined;
		if (recordId === undefined) {
			continue;
		}
		const expiresAt = record.expireTime ?? record.expiredTime ?? record.expiresAt ?? record.endTime;
		if (expiresAt) {
			const expiresMs = parseResetCardExpiry(expiresAt);
			if (expiresMs !== null && expiresMs <= now) {
				continue;
			}
		}
		cards.push({
			recordId,
			resetType,
			...(expiresAt ? { expiresAt } : {}),
			title: record.packageName ?? record.name ?? record.title,
		});
	}
	// Earliest expiry first, mirroring the site's redemption order.
	return cards.sort((a, b) => {
		const aMs = a.expiresAt ? parseResetCardExpiry(a.expiresAt) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
		const bMs = b.expiresAt ? parseResetCardExpiry(b.expiresAt) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
		return aMs - bMs;
	});
}

/** The activity endpoint accepts `code` 0/200/null with `success !== false` as success. */
function isActivitySuccess(parsed: GlmActivityResponse | undefined): boolean {
	if (!parsed || parsed.success === false) {
		return false;
	}
	return parsed.code === undefined || parsed.code === null || parsed.code === 0 || parsed.code === 200;
}

/** Site-format "YYYY-MM-DD HH:MM:SS" for the activity window: the last 365 days (official client parity). */
function activityTimeRange(now: Date = new Date()): { startTime: string; endTime: string } {
	const fmt = (d: Date) =>
		`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
	const start = new Date(end);
	start.setDate(start.getDate() - 365);
	start.setHours(0, 0, 0, 0);
	return { startTime: fmt(start), endTime: fmt(end) };
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}
