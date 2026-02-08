import * as vscode from 'vscode';

// Localization Helper
class I18n {
    private static messages: { [key: string]: string } = {
        "blink-20.restPrompt": "Time to rest! Look at something 20 feet away for 20 seconds.",
        "blink-20.startRest": "Start Rest",
        "blink-20.restProgress": "Resting... please look away.",
        "blink-20.restComplete": "Rest Complete! You can continue coding.",
        "blink-20.statusBarTooltip": "Time until next rest",
        "blink-20.ruleIntro": "Every 20 minutes, look at something 20 feet away for 20 seconds.",
        "blink-20.resting": "Resting..."
    };

    private static messagesZh: { [key: string]: string } = {
        "blink-20.restPrompt": "休息时间到了！请注视 20 英尺（约 6 米）外的物体 20 秒。",
        "blink-20.startRest": "开始休息",
        "blink-20.restProgress": "休息中... 请眺望远方。",
        "blink-20.restComplete": "休息结束！由于您的坚持，您的眼睛得到了一次很好的放松。",
        "blink-20.statusBarTooltip": "距离下次休息还有",
        "blink-20.ruleIntro": "每工作 20 分钟，眺望 20 英尺（约 6 米）外的物体 20 秒。",
        "blink-20.resting": "休息中..."
    };

    static get(key: string): string {
        const isZh = vscode.env.language.startsWith('zh');
        return isZh ? this.messagesZh[key] : this.messages[key] || key;
    }
}

let timer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;
let globalState: vscode.Memento;

// Configurable constants
let intervalMs = 20 * 60 * 1000; // 20 minutes
let restDurationMs = 20 * 1000; // 20 seconds
let resetThresholdMs = 5 * 60 * 1000; // 5 minutes to reset logic

const KEYS = {
    TARGET_TIME: 'blink-20.targetTime',
    LAST_FOCUS_TIME: 'blink-20.lastFocusTime',
    IS_RESTING: 'blink-20.isResting'
};

export function activate(context: vscode.ExtensionContext) {
    console.log('Blink 20 is now active!');
    globalState = context.globalState;

    // Clear stale resting state: if IDE was closed/reloaded during rest, we're no longer in rest
    if (globalState.get<boolean>(KEYS.IS_RESTING, false)) {
        globalState.update(KEYS.IS_RESTING, false);
    }

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

    // Check if we came back from a long break (e.g. closed VS Code for a while)
    const lastBlur = globalState.get<number>(KEYS.LAST_FOCUS_TIME, 0);
    if (lastBlur > 0) {
        const blurDuration = Date.now() - lastBlur;
        if (blurDuration > resetThresholdMs) {
            // User was away for > 5 mins (closed IDE), so we reset the timer
            console.log('Long absence detected on startup, resetting timer.');
            resetTimer();
        }
    }

    // Initialize or sync timer
    // If we just activated, ensure we have a valid target or set one
    const currentTarget = getTargetTime();
    if (!currentTarget || currentTarget < Date.now()) {
        // Only reset if it's missing or effectively expired (and not currently resting)
        // Note: The logic above (long absence) might have already called resetTimer().
        // If it didn't reset, and target is in the past, it means we were away for < 5 mins
        // BUT the timer expired during that short time? 
        // Example: Target 2:00. Closed at 1:59. Opened at 2:01. (2 mins away).
        // Logic above: 2 mins < 5 mins -> No reset.
        // Here: 2:00 < 2:01 -> Expired. 
        // The startTimer() loop will pick this up immediately and trigger the notification.
        // This is desired behavior for short breaks.
        
        if (!currentTarget) {
            resetTimer();
        }
    }

    startTimer();

    // Windows Focus State Listener
    context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
            // Regained focus
            const lastBlur = globalState.get<number>(KEYS.LAST_FOCUS_TIME, 0);
            if (lastBlur > 0) {
                const blurDuration = Date.now() - lastBlur;
                if (blurDuration > resetThresholdMs) {
                    // If away for > 5 mins (globally), reset the timer.
                    // This covers the case where the user closed all windows or minimized everything.
                    resetTimer();
                } else {
                    // Came back quickly, check if we missed a break?
                    // The timer loop will handle it.
                }
            }
        } else {
            // Lost focus
            // Record time to check for long breaks later
            // We update this on every blur.
            // If we have multiple windows, simple switching might trigger this.
            // But next focus will show small diff.
            globalState.update(KEYS.LAST_FOCUS_TIME, Date.now());
        }
    }));

    const disposable = vscode.commands.registerCommand('blink-20.showRule', () => {
        vscode.window.showInformationMessage(I18n.get('blink-20.ruleIntro'));
    });

    context.subscriptions.push(disposable);
}

function getTargetTime(): number {
    return globalState.get<number>(KEYS.TARGET_TIME, 0);
}

function resetTimer() {
    const target = Date.now() + intervalMs;
    globalState.update(KEYS.TARGET_TIME, target);
    globalState.update(KEYS.IS_RESTING, false); // Cancel any resting state
    updateStatusBar();
}

function updateStatusBar() {
    statusBarItem.show();
    
    // Check if resting
    const isResting = globalState.get<boolean>(KEYS.IS_RESTING, false);
    if (isResting) {
        // If actually resting, show that
        statusBarItem.text = `$(eye) ${I18n.get('blink-20.resting')}`;
        return;
    }

    const targetTime = getTargetTime();
    const remaining = Math.max(0, targetTime - Date.now());
    
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
        updateStatusBar();

        const targetTime = getTargetTime();
        const now = Date.now();
        const isResting = globalState.get<boolean>(KEYS.IS_RESTING, false);

        // If target time is reached
        if (targetTime > 0 && now >= targetTime) {
            // Only trigger if focused and not already resting (handled by another window or process)
            if (vscode.window.state.focused && !isResting) {
                showRestNotification();
            }
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
    // Set resting state to prevent other windows from popping up
    await globalState.update(KEYS.IS_RESTING, true);
    updateStatusBar(); // Update UI immediately

    const startRest = I18n.get('blink-20.startRest');
    
    // Modal notification
    const selection = await vscode.window.showInformationMessage(
        I18n.get('blink-20.restPrompt'),
        { modal: true },
        startRest,
    );

    // Force rest sequence regardless of which button (or close) was clicked
    await startRestSequence();
}

async function startRestSequence() {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: I18n.get('blink-20.restProgress'),
        cancellable: false
    }, async (progress) => {
        const step = 100 / (restDurationMs / 1000);
        for (let i = 0; i < restDurationMs / 1000; i++) {
            progress.report({ increment: step, message: `${restDurationMs / 1000 - i}s` });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });

    vscode.window.showInformationMessage(I18n.get('blink-20.restComplete'));
    resetTimer(); // Start new cycle
}

export async function deactivate() {
    stopTimer();
    // Save the time when we deactivate (close/reload window)
    if (globalState) {
        await globalState.update(KEYS.LAST_FOCUS_TIME, Date.now());
    }
}
