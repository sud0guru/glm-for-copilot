import type * as vscode from 'vscode';

export type ThinkingMode = 'enabled' | 'disabled';
export type ApiMode = 'coding-plan' | 'standard';
export type Region = 'international' | 'china';

export type ThinkingEffort = 'none' | 'low' | 'high' | 'max';

export interface ThinkingEffortSpec {
	/** Levels shown in the picker, in order. */
	levels: ThinkingEffort[];
	/** Level used when the user has not chosen one. */
	default: ThinkingEffort;
}

export interface GLMModelCapabilities {
	/** `true` enables tool calling with the default cap; a number sets a custom cap. */
	toolCalling: number | boolean;
	thinking: boolean;
	/** Whether the model accepts image content blocks directly. */
	nativeImageInput: boolean;
	/** Present ⇒ model supports thinking-effort selection. Absent ⇒ binary thinking only. */
	thinkingEffort?: ThinkingEffortSpec;
}

/** A GLM model exposed in the Copilot Chat picker. */
export interface GLMModel {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: GLMModelCapabilities;
	/** API modes that expose this model. The picker filters built-ins by the active mode. */
	availableIn: ApiMode[];
}

/** A user-defined model from the `customModels` setting (string id or object). */
export interface CustomModelConfig {
	id: string;
	name?: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	thinking?: boolean;
	nativeImageInput?: boolean;
}

// ---- Usage tracking (Coding Plan quota + Standard API balance) ----

export type UsageMetricKind = 'session' | 'weekly' | 'web-searches';

export interface UsageMetric {
	kind: UsageMetricKind;
	/** Percentage (0-100) for session/weekly; count used for web-searches. */
	used: number;
	/** 100 for session/weekly; monthly total for web-searches. */
	limit: number;
	/** Epoch-ms when the window resets. */
	resetsAt?: number;
	/** Credits used in this window (credit-limit plans); undefined for token/percentage-only plans. */
	usedCredits?: number;
	/** Total credits for this window (credit-limit plans). */
	totalCredits?: number;
}

/** Which quota window a banked reset card can reset. */
export type ResetCardWindow = 'FIVE_HOUR' | 'WEEK';

/** A banked reset card ("Reset Quota") on a Coding Plan key. */
export interface ResetCard {
	/** Numeric record id posted back verbatim on `/use`. */
	recordId: number;
	resetType: ResetCardWindow;
	/** Raw expiry timestamp from the API (site-local "YYYY-MM-DD HH:MM:SS" or ISO). */
	expiresAt?: string;
	/** Package name shown on the site, when present. */
	title?: string;
}

/** Banked reset cards for a Coding Plan key, grouped by window. */
export interface ResetQuota {
	fiveHourCards: ResetCard[];
	weekCards: ResetCard[];
	lastFiveHourResetAt?: string;
	lastWeekResetAt?: string;
}

/** Summary stats for the Coding Plan activity endpoint. */
export interface ActivitySummary {
	totalTokens: number;
	peakDailyTokens: number;
	peakDailyTokensDate?: string;
	totalUsageDurationMs: number;
	currentStreakDays: number;
	longestStreakDays: number;
}

/** One day of token activity for the heatmap. */
export interface ActivityDay {
	/** Local date, `YYYY-MM-DD`. */
	date: string;
	totalTokens: number;
	mcpCalls: number;
}

/** Result of the activity endpoint fetch. */
export interface ActivitySnapshot {
	summary?: ActivitySummary;
	/** Ascending by date; may be empty. */
	series: ActivityDay[];
	fetchedAt: number;
}

/** A token resource package on the China Standard API (pay-as-you-go). */
export interface TokenPackage {
	name: string;
	/** Remaining tokens in this package. */
	remainingTokens: number;
	/** Magnitude divisor (e.g. 1000 = thousands). */
	magnitude: number;
	/** Package status (e.g. "EFFECTIVE"). */
	status: string;
	/** Model this package is valid for, if any. */
	model?: string;
}

/** Cash + token-package balance for the Standard API. */
export interface UsageBalance {
	/** Available cash balance (after deducting spent + frozen). */
	availableCash?: number;
	/** Total amount recharged by the user. */
	totalRecharged?: number;
	/** Total amount spent so far. */
	totalSpent?: number;
	/** Gifted/promotional amount. */
	giftedAmount?: number;
	/** Frozen (held) amount. */
	frozenAmount?: number;
	/** Active token resource packages. */
	tokenPackages: TokenPackage[];
}

export type UsageStatus =
	| 'ok'
	| 'no-data'
	| 'auth-error'
	| 'network-error'
	| 'server-error'
	| 'loading';

export type UsageFailureReason = 'coding-plan-unavailable';

export interface UsageSnapshot {
	status: UsageStatus;
	/** Machine-readable cause for a recognized usage failure. */
	failureReason?: UsageFailureReason;
	planName?: string;
	/** ISO date string from the subscription response. */
	renewsAt?: string;
	/** 0..3 metrics, ordered session, weekly, web-searches. Coding Plan only. */
	metrics: UsageMetric[];
	/** Cash + token-package balance. Standard API only. */
	balance?: UsageBalance;
	/** Banked reset cards ("Reset Quota"). Coding Plan only; supplementary. */
	resetQuota?: ResetQuota;
	/** Epoch-ms of the fetch that produced this snapshot. */
	fetchedAt: number;
}

// ---- OpenAI-compatible wire types ----

export interface GLMToolFunction {
	name: string;
	description?: string;
	parameters?: unknown;
}

export interface GLMTool {
	type: 'function';
	function: GLMToolFunction;
}

export interface GLMToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface GLMTextContentPart {
	type: 'text';
	text: string;
}

export interface GLMImageUrlContentPart {
	type: 'image_url';
	image_url: {
		url: string;
	};
}

export type GLMMessageContent = string | Array<GLMTextContentPart | GLMImageUrlContentPart>;

export interface GLMMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: GLMMessageContent;
	tool_calls?: GLMToolCall[];
	tool_call_id?: string;
	reasoning_content?: string;
}

export interface GLMChatRequest {
	model: string;
	messages: GLMMessage[];
	stream: boolean;
	tools?: GLMTool[];
	tool_choice?: 'auto' | 'none';
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	thinking?: { type: ThinkingMode; clear_thinking?: boolean };
	reasoning_effort?: Exclude<ThinkingEffort, 'none'>;
	stream_options?: { include_usage: boolean };
}

export interface GLMUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
}

// ---- Streaming delta shapes ----

export interface GLMDeltaToolCall {
	index: number;
	id?: string;
	type?: 'function';
	function?: { name?: string; arguments?: string };
}

export interface GLMDelta {
	content?: string;
	reasoning_content?: string;
	tool_calls?: GLMDeltaToolCall[];
}

export interface GLMChoice {
	delta?: GLMDelta;
	finish_reason?: string | null;
}

export interface GLMStreamChunk {
	choices?: GLMChoice[];
	usage?: GLMUsage;
}

// ---- Callback + collaborator contracts ----

export interface RetryBackoffInfo {
	status: number;
	nextAttempt: number;
	maxAttempts: number;
	delayMs: number;
}

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: GLMToolCall) => void;
	onUsage?: (usage: GLMUsage) => void;
	onRetryBackoff?: (info: RetryBackoffInfo) => void;
	onDone: () => void;
	onError: (error: unknown) => void;
}

/** Streaming GLM chat client. Implemented by `client/core.ts`. */
export interface IGLMClient {
	streamChatCompletion(
		request: GLMChatRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: vscode.CancellationToken,
	): Promise<void>;
}

/** Options for contextualizing the API-key input box. */
export interface ApiKeyPromptOptions {
	title?: string;
	prompt?: string;
}

/** API-key manager. Implemented by `auth.ts`. */
export interface IAuthManager {
	getApiKey(): Promise<string | undefined>;
	hasApiKey(): Promise<boolean>;
	promptForApiKey(options?: ApiKeyPromptOptions): Promise<boolean>;
	deleteApiKey(): Promise<void>;
}
