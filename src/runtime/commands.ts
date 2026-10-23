import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../consts';
import { resolveKeyPageUrl } from '../endpoint';
import { logger } from '../logger';

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.getApiKey', () =>
			vscode.env.openExternal(vscode.Uri.parse(resolveKeyPageUrl())),
		),
		vscode.commands.registerCommand('glm-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION),
		),
		vscode.commands.registerCommand('glm-copilot.showLogs', () => logger.show()),
	);
}
