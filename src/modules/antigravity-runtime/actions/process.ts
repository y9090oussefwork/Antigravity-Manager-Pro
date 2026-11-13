import { ipc } from '@/ipc/manager';
import type { AntigravityAppTarget } from '@/shared/platform/antigravityAppTarget';

export function isProcessRunning(target?: AntigravityAppTarget) {
  return ipc.client.proc.isProcessRunning({ target });
}

export function listRunningProcesses(target?: AntigravityAppTarget) {
  return ipc.client.proc.listRunningProcesses({ target });
}

export function closeProcessByPid(pid: number) {
  return ipc.client.proc.closeProcessByPid({ pid });
}

export function closeAllProcesses(target?: AntigravityAppTarget) {
  return ipc.client.proc.closeAllProcesses({ target });
}

export function closeAntigravity(target?: AntigravityAppTarget) {
  return ipc.client.proc.closeAntigravity({ target });
}

export function startAntigravity(target?: AntigravityAppTarget) {
  return ipc.client.proc.startAntigravity({ target });
}

export function getProcessOperation(target?: AntigravityAppTarget) {
  return ipc.client.proc.getOperation({ target });
}
