import { os } from '@orpc/server';
import { z } from 'zod';
import { AntigravityAppTargetSchema } from '@/shared/platform/antigravityAppTarget';
import {
  closeAllAntigravityProcesses,
  closeAntigravity,
  closeProcessByPid,
  isProcessRunning,
  listRunningProcesses,
  startAntigravity,
} from './handler';
import { getProcessOperation } from '../operation';
import { ProcessOperationSchema } from '../types';

const ProcessTargetInputSchema = z
  .object({ target: AntigravityAppTargetSchema.optional() })
  .optional();

const RunningProcessSummarySchema = z.object({
  pid: z.number().int().positive(),
  target: z.enum(['classic', 'ide']),
  executablePath: z.string(),
  userDataDir: z.string().optional(),
});

export const processRouter = os.router({
  getOperation: os
    .input(ProcessTargetInputSchema)
    .output(ProcessOperationSchema)
    .handler(({ input }) => getProcessOperation(input?.target)),
  isProcessRunning: os
    .input(ProcessTargetInputSchema)
    .output(z.boolean())
    .handler(async ({ input }) => {
      return await isProcessRunning(input?.target);
    }),
  listRunningProcesses: os
    .input(ProcessTargetInputSchema)
    .output(z.array(RunningProcessSummarySchema))
    .handler(async ({ input }) => {
      return await listRunningProcesses(input?.target);
    }),
  closeProcessByPid: os
    .input(z.object({ pid: z.number().int().positive() }))
    .output(z.void())
    .handler(async ({ input }) => {
      await closeProcessByPid(input.pid);
    }),
  closeAllProcesses: os
    .input(ProcessTargetInputSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await closeAllAntigravityProcesses(input?.target);
    }),
  closeAntigravity: os
    .input(ProcessTargetInputSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await closeAntigravity(input?.target);
    }),
  startAntigravity: os
    .input(ProcessTargetInputSchema)
    .output(z.void())
    .handler(async ({ input }) => {
      await startAntigravity(input?.target);
    }),
});
