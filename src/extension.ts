import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let pollTimer: NodeJS.Timeout | undefined;
let lastPollTime = 0;
let pollIntervalMs = 0; // configured interval in milliseconds
let extContext: vscode.ExtensionContext;

// Simple in-memory cache to avoid excessive API calls
let cachedBalance: number | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5000; // 5 seconds

export function activate(context: vscode.ExtensionContext) {
	extContext = context;
	console.log('DeepSeek Usage Monitor is now active!');

	// 1. Create status bar item (right side, priority 100)
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'deepseek-usage.refresh';
	statusBarItem.tooltip = 'Click to refresh DeepSeek usage';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// 2. Register manual refresh command
	const refreshCommand = vscode.commands.registerCommand('deepseek-usage.refresh', () => {
		updateUsageDisplay();
	});
	context.subscriptions.push(refreshCommand);

	// 3. Read poll interval config
	const config = vscode.workspace.getConfiguration('deepseekUsage');
	const intervalMinutes = config.get<number>('refreshInterval', 5);
	pollIntervalMs = intervalMinutes * 60 * 1000;

	// 4. Immediate first update (only if window is focused)
	if (vscode.window.state.focused) {
		updateUsageDisplay();
	}

	// 5. Listen for window focus changes: pause polling when unfocused, resume when focused
	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((e) => {
			if (e.focused) {
				// Resume polling — scheduleNextPoll will compute remaining wait time
				scheduleNextPoll();
			} else {
				// Pause polling
				clearPollTimer();
			}
		})
	);

	// 6. Listen for config changes to update poll interval dynamically
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('deepseekUsage.refreshInterval')) {
				const newInterval = vscode.workspace.getConfiguration('deepseekUsage').get<number>('refreshInterval', 5);
				pollIntervalMs = newInterval * 60 * 1000;
				scheduleNextPoll();
			}
		})
	);
}

function clearPollTimer() {
	if (pollTimer) {
		clearTimeout(pollTimer);
		pollTimer = undefined;
	}
}

function scheduleNextPoll() {
	clearPollTimer();
	if (pollIntervalMs <= 0) return;
	if (!vscode.window.state.focused) return; // don't schedule when unfocused

	const elapsed = Date.now() - lastPollTime;
	const remaining = Math.max(0, pollIntervalMs - elapsed);

	pollTimer = setTimeout(() => {
		updateUsageDisplay();
	}, remaining);
}

async function updateUsageDisplay() {
	const config = vscode.workspace.getConfiguration('deepseekUsage');
	const apiKey = config.get<string>('apiKey');

	if (!apiKey) {
		statusBarItem.text = `DeepSeek: Set API Key`;
		statusBarItem.tooltip = 'Click to open Settings and set your DeepSeek API Key';
		return;
	}

	statusBarItem.text = `DeepSeek: Updating...`;

	try {
		const balance = await fetchBalance(apiKey);

		// Compute today's usage via balance difference
		const todayKey = `startBalance_${new Date().toISOString().split('T')[0]}`;
		let startBalance = extContext.globalState.get<number>(todayKey);

		if (startBalance === undefined || balance > startBalance) {
			// First refresh of the day, or balance increased (e.g. top-up): reset baseline
			startBalance = balance;
			await extContext.globalState.update(todayKey, balance);

			// Clean up stale keys (older than 3 days)
			cleanupOldBalanceKeys();
		}

		// Today's usage = starting balance - current balance (clamp to >= 0)
		const todayUsage = Math.max(0, startBalance - balance);

		const balanceStr = balance.toFixed(2);
		const usageStr = todayUsage.toFixed(2);

		statusBarItem.text = `DeepSeek: ¥${balanceStr} | 今日 ¥${usageStr}`;
		statusBarItem.tooltip = `Balance: ¥${balanceStr}\nToday's Usage: ¥${usageStr} (computed from balance change)\nClick to refresh`;
	} catch (error: any) {
		console.error('[DeepSeek Usage] Failed to fetch:', error.message);
		statusBarItem.text = `DeepSeek: API Error`;
		statusBarItem.tooltip = error.message || 'Failed to fetch usage data';
	}

	lastPollTime = Date.now();
	scheduleNextPoll();
}

async function fetchBalance(apiKey: string): Promise<number> {
	// Check cache
	if (cachedBalance !== null && Date.now() - lastFetchTime < CACHE_TTL) {
		return cachedBalance;
	}

	const response = await fetch('https://api.deepseek.com/user/balance', {
		headers: { 'Authorization': `Bearer ${apiKey}` }
	});

	if (!response.ok) {
		throw new Error(`Balance API error: ${response.status} ${response.statusText}`);
	}

	const data: any = await response.json();

	// DeepSeek balance API returns: { "is_available": true, "balance_infos": [{"currency": "CNY", "total_balance": "...", ...}] }
	let balance = 0;
	if (data.balance_infos && Array.isArray(data.balance_infos)) {
		for (const info of data.balance_infos) {
			balance += parseFloat(info.total_balance) || 0;
		}
	} else if (typeof data.balance === 'number') {
		balance = data.balance;
	} else if (typeof data.total_balance === 'string') {
		balance = parseFloat(data.total_balance) || 0;
	}

	cachedBalance = balance;
	lastFetchTime = Date.now();
	return balance;
}

/** Remove balance snapshot keys older than 3 days to keep storage clean */
async function cleanupOldBalanceKeys() {
	const keys = extContext.globalState.keys();
	const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;

	for (const key of keys) {
		if (!key.startsWith('startBalance_')) {
			continue;
		}
		const dateStr = key.replace('startBalance_', '');
		const ts = new Date(dateStr + 'T00:00:00Z').getTime();
		if (!isNaN(ts) && ts < cutoff) {
			await extContext.globalState.update(key, undefined);
		}
	}
}

export function deactivate() {
	clearPollTimer();
	console.log('DeepSeek Usage Monitor deactivated.');
}
