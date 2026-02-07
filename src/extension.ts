import * as vscode from 'vscode';

// Localization Helper
class I18n {
    private static messages: { [key: string]: string } = {
        "blink-20.restPrompt": "Time to rest! Look at something 20 feet away for 20 seconds.",
        "blink-20.startRest": "Start Rest",
        "blink-20.skip": "Skip",
        "blink-20.restProgress": "Resting... please look away.",
        "blink-20.restComplete": "Rest Complete! You can continue coding.",
        "blink-20.statusBarTooltip": "Time until next rest",
        "blink-20.ruleIntro": "Every 20 minutes, look at something 20 feet away for 20 seconds."
    };

    private static messagesZh: { [key: string]: string } = {
        "blink-20.restPrompt": "休息时间到了！请注视 20 英尺（约 6 米）外的物体 20 秒。",
        "blink-20.startRest": "开始休息",
        "blink-20.skip": "跳过",
        "blink-20.restProgress": "休息中... 请眺望远方。",
        "blink-20.restComplete": "休息结束！由于您的坚持，您的眼睛得到了一次很好的放松。",
        "blink-20.statusBarTooltip": "距离下次休息还有",
        "blink-20.ruleIntro": "每工作 20 分钟，眺望 20 英尺（约 6 米）外的物体 20 秒。"
    };

    static get(key: string): string {
        const isZh = vscode.env.language.startsWith('zh');
        return isZh ? this.messagesZh[key] : this.messages[key] || key;
    }
}

let timer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;
let accumulatedTime = 0;
let lastBlurTime = 0;
let intervalMs = 20 * 60 * 1000; // 20 minutes
let restDurationMs = 20 * 1000; // 20 seconds
let resetThresholdMs = 5 * 60 * 1000; // 5 minutes to reset logic

export function activate(context: vscode.ExtensionContext) {
    console.log('Blink 20 is now active!');

    // Check for Development Mode
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        console.log('Running in Development Mode: Fast Timer');
        intervalMs = 10 * 1000; // 10 seconds for testing
        restDurationMs = 5 * 1000; // 5 seconds for testing
        resetThresholdMs = 2 * 1000; // 2 seconds for testing
    }

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'blink-20.showRule';
    context.subscriptions.push(statusBarItem);

    if (vscode.window.state.focused) {
        startTimer();
    } else {
        lastBlurTime = Date.now();
        startTimer(); // Start timer even if initially blurred
    }

    // Windows Focus State Listener
    context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
            // Regained focus
            if (lastBlurTime > 0) {
                const blurDuration = Date.now() - lastBlurTime;
                if (blurDuration > resetThresholdMs) {
                    // If away for > 5 mins, reset the timer (assume they rested)
                    accumulatedTime = 0;
                } else if (accumulatedTime >= intervalMs) {
                     // If away for < 5 mins BUT timer finished during break, trigger rest now
                     showRestNotification();
                }
                lastBlurTime = 0;
            }
        } else {
            // Lost focus
            lastBlurTime = Date.now();
            // Do NOT stop timer. Timer continues to run.
        }
    }));

    const disposable = vscode.commands.registerCommand('blink-20.showRule', () => {
        vscode.window.showInformationMessage(I18n.get('blink-20.ruleIntro'));
    });

    context.subscriptions.push(disposable);
}

function updateStatusBar(paused: boolean = false) {
    statusBarItem.show();
    
    // Timer no longer pauses on blur, so we don't show "Paused" state
    const remaining = Math.max(0, intervalMs - accumulatedTime);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    statusBarItem.text = `$(eye) ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    statusBarItem.tooltip = I18n.get('blink-20.statusBarTooltip');
}

function startTimer() {
    if (timer) {
        clearInterval(timer);
    }
    
    timer = setInterval(() => {
        accumulatedTime += 1000;
        updateStatusBar();

        if (accumulatedTime >= intervalMs) {
            // Only trigger rest if user is currently focused
            if (vscode.window.state.focused) {
                showRestNotification();
                stopTimer(); // Stop measuring while modal is open/resting
            }
            // If not focused, the timer continues to run, and the notification will be triggered
            // when focus is regained (handled by onDidChangeWindowState).
        }
    }, 1000);
    
    updateStatusBar();
}

function stopTimer() {
    if (timer) {
        clearInterval(timer);
        timer = undefined;
    }
}

async function showRestNotification() {
    stopTimer(); // Ensure it's not running
    statusBarItem.text = `$(eye) Resting...`;

    const startRest = I18n.get('blink-20.startRest');
    
    // Modal notification to force attention
    const selection = await vscode.window.showInformationMessage(
        I18n.get('blink-20.restPrompt'),
        { modal: true },
        startRest
    );

    if (selection === startRest) {
        await startRestSequence();
    } else {
        // If closed (undefined), just restart the timer
        // Reset accumulated time after rest prompt (even if suppressed, we prompted)
        // Or should we only reset if they actually rested? The rule usually implies "Prompt -> Rest".
        // If they close the modal, they might interpret it as "Snooze" or "Skip".
        // Previous logic: restart timer (effectively reset for next 20m).
        accumulatedTime = 0;
        startTimer();
    }
}

async function startRestSequence() {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: I18n.get('blink-20.restProgress'),
        cancellable: false // Prevent cancellation to enforce rest
    }, async (progress) => {
        const step = 100 / (restDurationMs / 1000);
        for (let i = 0; i < restDurationMs / 1000; i++) {
            progress.report({ increment: step, message: `${restDurationMs / 1000 - i}s` });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });

    vscode.window.showInformationMessage(I18n.get('blink-20.restComplete'));
    accumulatedTime = 0;
    startTimer();
}

export function deactivate() {
    stopTimer();
}
