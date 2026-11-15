import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  resolveAntigravityAppTarget,
  type AntigravityAppTarget,
} from '@/shared/platform/antigravityAppTarget';
import { logger } from '@/shared/logging/logger';
import { prepareLaunchContext } from '../launchContext';
import { observeProcesses } from '../processObserver';
import { runProcessOperation } from '../operation';
import { stopFromContext } from '../stop';
import type { GuiTarget, RuntimeProcess } from '../types';

export { startAntigravity } from '../launch';

const runFile = promisify(execFile);

export interface RunningProcessSummary {
  pid: number;
  target: GuiTarget;
  executablePath: string;
  userDataDir?: string;
}

function extractUserDataDir(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--user-data-dir=')) {
      const value = arg.slice('--user-data-dir='.length).trim();
      if (value) {
        return value;
      }
    }
    if (arg === '--user-data-dir' && args[index + 1]) {
      const value = args[index + 1]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function toRunningProcessSummary(target: GuiTarget, proc: RuntimeProcess): RunningProcessSummary {
  return {
    pid: proc.pid,
    target,
    executablePath: proc.executablePath,
    userDataDir: extractUserDataDir(proc.args),
  };
}

async function terminatePid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await runFile('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    return;
  }
  process.kill(pid, 'SIGTERM');
}

export async function isProcessRunning(target?: AntigravityAppTarget | null): Promise<boolean> {
  const resolved = resolveAntigravityAppTarget(target);
  if (resolved === 'agy') {
    return false;
  }
  try {
    return (await observeProcesses(resolved)).length > 0;
  } catch {
    logger.warn(`Antigravity process status could not be observed: ${resolved}`);
    return false;
  }
}

export async function listRunningProcesses(
  target?: AntigravityAppTarget | null,
): Promise<RunningProcessSummary[]> {
  const targets: GuiTarget[] = target
    ? (() => {
        const resolved = resolveAntigravityAppTarget(target);
        return resolved === 'agy' ? [] : [resolved];
      })()
    : ['classic', 'ide'];

  const results = new Map<number, RunningProcessSummary>();
  for (const currentTarget of targets) {
    try {
      const observed = await observeProcesses(currentTarget);
      for (const proc of observed) {
        if (!results.has(proc.pid)) {
          results.set(proc.pid, toRunningProcessSummary(currentTarget, proc));
        }
      }
    } catch (error) {
      logger.warn(`Antigravity processes could not be observed for ${currentTarget}:`, error);
    }
  }
  return [...results.values()];
}

export async function closeProcessByPid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  const running = await listRunningProcesses();
  const match = running.find((proc) => proc.pid === pid);
  if (!match) {
    return;
  }
  await terminatePid(match.pid);
}

export async function closeAllAntigravityProcesses(
  target?: AntigravityAppTarget | null,
): Promise<void> {
  const running = await listRunningProcesses(target);
  for (const proc of running) {
    try {
      await terminatePid(proc.pid);
    } catch (error) {
      logger.warn(`Failed to terminate Antigravity process ${proc.pid}:`, error);
    }
  }
}

export async function closeAntigravity(target?: AntigravityAppTarget | null): Promise<void> {
  const resolved = resolveAntigravityAppTarget(target);
  if (resolved === 'agy') {
    return;
  }
  return runProcessOperation(resolved, 'stopping', async () => {
    const context = await prepareLaunchContext(resolved);
    await stopFromContext(context);
  });
}
