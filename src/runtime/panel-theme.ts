import * as vscode from 'vscode';

/**
 * Shared GLM design system for the Usage and Activity webview panels.
 *
 * Tokens mirror the official z.ai / bigmodel.cn frontend palette (accent blue #4099ff dark /
 * #0b7fff light, orange #ff8a30, purple #7b5ce5, 10% surface borders) while surfaces, text, and
 * buttons stay on VS Code theme variables, so the panels keep their GLM identity in any editor
 * theme.
 *
 * Layout is intrinsic — auto-fit card grids, flex-wrap rows, clamp()'d padding — so the design
 * holds at every panel size without dedicated breakpoints, with a centered max-width column on
 * ultra-wide panels.
 */
export function panelThemeCss(theme: 'dark' | 'light'): string {
	const dark = theme === 'dark';
	return `
	:root {
		--glm-accent: ${dark ? '#4099ff' : '#0b7fff'};
		--glm-accent-hover: ${dark ? '#66adff' : '#3f94ff'};
		--glm-accent-soft: ${dark ? 'rgba(64, 153, 255, 0.16)' : 'rgba(11, 127, 255, 0.12)'};
		--glm-warn: ${dark ? '#ff8a30' : '#e07b00'};
		--glm-warn-soft: ${dark ? 'rgba(255, 138, 48, 0.18)' : 'rgba(224, 123, 0, 0.14)'};
		--glm-purple: ${dark ? '#7b5ce5' : '#9e77ed'};
		--glm-fg: var(--vscode-foreground, ${dark ? '#f8f8f8' : '#0d0d0d'});
		--glm-fg-secondary: var(--vscode-descriptionForeground, ${dark ? '#adadad' : '#5c5c5c'});
		--glm-fg-muted: ${dark ? '#7d7d7d' : '#8a8a8a'};
		--glm-card-bg: var(--vscode-editorWidget-background, ${dark ? '#202020' : '#ffffff'});
		--glm-card-border: ${dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(13, 13, 13, 0.1)'};
		--glm-card-bg-subtle: ${dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(13, 13, 13, 0.04)'};
		--glm-track: ${dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(13, 13, 13, 0.08)'};
		--glm-btn-secondary-bg: ${dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(13, 13, 13, 0.05)'};
		--glm-btn-secondary-bg-hover: ${dark ? 'rgba(255, 255, 255, 0.13)' : 'rgba(13, 13, 13, 0.09)'};
		--glm-radius-card: 12px;
		--glm-radius-btn: 8px;
		--glm-radius-pill: 999px;
	}
	* { box-sizing: border-box; }
	body {
		font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
		color: var(--glm-fg);
		background: var(--vscode-editor-background, ${dark ? '#161616' : '#f8f8f8'});
		margin: 0;
		padding: clamp(14px, 3vw, 24px);
		-webkit-font-smoothing: antialiased;
		font-size: 13px;
		line-height: 1.5;
	}
	.panel { max-width: 920px; margin: 0 auto; }

	/* Header */
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px 16px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.header-text { min-width: 0; }
	h1 { font-size: 16px; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
	.header-actions { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
	.plan-meta { display: flex; flex-wrap: wrap; gap: 2px 16px; margin-top: 4px; }
	.plan { color: var(--glm-fg-secondary); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

	/* Buttons: track the editor's button theme so custom editor themes are respected;
	   the GLM palette only fills in when a theme variable is undefined */
	.btn {
		background: var(--vscode-button-background, var(--glm-accent));
		color: var(--vscode-button-foreground, #fff);
		border: none;
		padding: 5px 14px;
		border-radius: var(--glm-radius-btn);
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 550;
		font-family: inherit;
		transition: background-color 0.15s ease;
	}
	.btn:hover { background: var(--vscode-button-hoverBackground, var(--glm-accent-hover)); }
	.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--glm-accent)); outline-offset: 2px; }
	.btn.secondary { background: var(--vscode-button-secondaryBackground, var(--glm-btn-secondary-bg)); color: var(--vscode-button-secondaryForeground, var(--glm-fg)); }
	.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--glm-btn-secondary-bg-hover)); }

	/* Card grid: pairs up metric cards when space allows, always fills rows evenly */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 12px;
	}
	.card {
		padding: 16px;
		border: 1px solid var(--glm-card-border);
		border-radius: var(--glm-radius-card);
		background: var(--glm-card-bg);
		min-width: 0;
	}
	/* Sits below the metrics grid; margin mirrors the grid gap so spacing stays identical */
	.reset-card { margin-top: 12px; }
	.card-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.card-title { font-size: 13.5px; font-weight: 600; }
	.card-window { color: var(--glm-fg-muted); font-size: 11.5px; white-space: nowrap; }
	.card-body {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px 16px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.card-big { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
	.big-num { font-size: 30px; font-weight: 650; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.big-cap { color: var(--glm-fg-secondary); font-size: 12px; }
	.card-side { color: var(--glm-fg-secondary); font-size: 12px; text-align: right; margin-left: auto; font-variant-numeric: tabular-nums; }

	/* Pill progress bar: track clips the fill so it never escapes the rounded corners */
	.bar { background: var(--glm-track); border-radius: var(--glm-radius-pill); height: 8px; overflow: hidden; }
	.bar-fill { background: var(--glm-accent); height: 100%; width: 0; border-radius: var(--glm-radius-pill); transition: width 0.25s ease; }
	.bar-fill.warn { background: var(--glm-warn); }

	.card-foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 2px 16px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
	.reset-time { color: var(--glm-fg-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
	.resets { color: var(--glm-fg-secondary); font-size: 11.5px; margin-left: auto; font-variant-numeric: tabular-nums; }

	/* Badges */
	.card-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; justify-content: flex-end; }
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border: 1px solid var(--glm-card-border);
		border-radius: var(--glm-radius-pill);
		background: var(--glm-card-bg-subtle);
		font-size: 11.5px;
		color: var(--glm-fg-secondary);
		white-space: nowrap;
	}
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--glm-purple); flex: none; }
	.reset-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }

	/* Footer */
	.panel-foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 16px;
		flex-wrap: wrap;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--glm-card-border);
	}
	.last-updated { color: var(--glm-fg-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
	.offline { color: var(--glm-warn); font-size: 11.5px; }

	/* Status + recovery */
	.status-message { text-align: center; padding: 48px 16px; color: var(--glm-fg-secondary); display: flex; flex-direction: column; align-items: center; gap: 12px; }
	.status-message p { margin: 0; max-width: 52ch; }
	.recovery-card {
		margin-top: 16px;
		padding: 16px;
		border: 1px solid var(--glm-card-border);
		border-radius: var(--glm-radius-card);
		background: var(--glm-card-bg);
	}
	.recovery-card p { margin: 0 0 12px; color: var(--glm-fg); line-height: 1.55; }

	/* Balance */
	.balance-section { margin-top: 12px; padding: 16px; border: 1px solid var(--glm-card-border); border-radius: var(--glm-radius-card); background: var(--glm-card-bg); }
	.balance-section h2 { font-size: 13.5px; font-weight: 600; margin: 0 0 12px; color: var(--glm-fg); }
	.balance-row { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; font-size: 12.5px; color: var(--glm-fg-secondary); }
	.balance-row > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.balance-value { font-weight: 600; color: var(--glm-fg); font-variant-numeric: tabular-nums; }
	.balance-packages { margin-top: 12px; font-weight: 600; font-size: 12.5px; color: var(--glm-fg-secondary); }
	.pkg-model { font-weight: 400; color: var(--glm-fg-muted); font-size: 11.5px; }

	/* Activity stat cards */
	.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 164px), 1fr)); gap: 12px; margin-bottom: 12px; }
	.stat-card {
		padding: 14px 16px;
		border: 1px solid var(--glm-card-border);
		border-radius: var(--glm-radius-card);
		background: var(--glm-card-bg);
		min-width: 0;
	}
	.stat-value { font-size: 16px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.stat-label { color: var(--glm-fg-secondary); font-size: 11.5px; margin-top: 2px; }

	/* Heatmap */
	.heatmap-panel { padding: 16px; border: 1px solid var(--glm-card-border); border-radius: var(--glm-radius-card); background: var(--glm-card-bg); }
	.tabs { display: inline-flex; gap: 2px; margin-bottom: 12px; padding: 3px; background: var(--glm-card-bg-subtle); border-radius: var(--glm-radius-pill); }
	.tab {
		background: transparent;
		color: var(--glm-fg-secondary);
		border: none;
		padding: 4px 14px;
		border-radius: var(--glm-radius-pill);
		cursor: pointer;
		font-size: 12px;
		font-family: inherit;
		transition: background-color 0.15s ease, color 0.15s ease;
	}
	.tab:hover { color: var(--glm-fg); }
	.tab:focus-visible { outline: 2px solid var(--glm-accent); outline-offset: 1px; }
	.tab.active { background: var(--glm-card-bg); color: var(--glm-fg); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, ${dark ? '0.4' : '0.12'}); }
	.heatmap-scroll { overflow-x: auto; padding: 2px 2px 6px; }
	.heatmap { display: flex; gap: 3px; width: max-content; }
	.col { display: grid; grid-template-rows: repeat(7, 11px); gap: 3px; }
	.cell { width: 11px; height: 11px; border-radius: 3px; background: var(--glm-track); }
	.cell.empty { opacity: 0.3; }
	.cell[data-level="1"] { background: ${dark ? '#1c4a78' : '#b7dbff'}; }
	.cell[data-level="2"] { background: ${dark ? '#2a6cb3' : '#7cbdfb'}; }
	.cell[data-level="3"] { background: ${dark ? '#4099ff' : '#3f9dff'}; }
	.cell[data-level="4"] { background: ${dark ? '#8ec5ff' : '#0b7fff'}; }
	.months { position: relative; height: 16px; width: max-content; margin-top: 6px; font-size: 10px; color: var(--glm-fg-muted); }
	.month { position: absolute; white-space: nowrap; }
	.heatmap-scroll::-webkit-scrollbar { height: 8px; }
	.heatmap-scroll::-webkit-scrollbar-thumb { background: var(--glm-track); border-radius: var(--glm-radius-pill); }
	.heatmap-scroll::-webkit-scrollbar-track { background: transparent; }

	.spinner {
		width: 22px;
		height: 22px;
		border: 2px solid var(--glm-track);
		border-top-color: var(--glm-accent);
		border-radius: 50%;
		animation: glm-spin 0.8s linear infinite;
	}
	@keyframes glm-spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) {
		* { animation: none !important; transition: none !important; }
	}
`;
}

/** Map the VS Code color theme to a dark/light token (high-contrast counted as dark). */
export function panelThemeKind(): 'dark' | 'light' {
	const kind = vscode.window.activeColorTheme.kind;
	return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
}
