import {
  AgentCommandValidationError,
  createPendingAgentBills,
} from '../agent/AgentCommandService';
import type { Repositories } from '../database';
import { AgentOperationPayloadMismatchError } from '../database/repositories/AgentOperationRepository';
import { BookkeepingInputError } from '../domain/policies/bookkeepingInputPolicy';
import {
  completeAgentCommand,
  listPendingAgentCommands,
} from '../native/AgentCommandInbox';

export type AgentCommandAutoImportResult = {
  queuedCount: number;
  importedCount: number;
  failedCount: number;
};

let importInFlight: Promise<AgentCommandAutoImportResult> | undefined;

async function runImport(
  repositories: Repositories,
): Promise<AgentCommandAutoImportResult> {
  const commands = await listPendingAgentCommands();
  let importedCount = 0;
  let failedCount = 0;
  for (const command of commands) {
    try {
      const outcome = await createPendingAgentBills(command, repositories);
      await completeAgentCommand({
        key: command.key,
        status: outcome.status,
        transactionIds: outcome.transactions.map(item => item.id),
        completedAt: new Date().toISOString(),
      });
      importedCount += 1;
    } catch (error) {
      const terminalErrorCode =
        error instanceof AgentOperationPayloadMismatchError ||
        error instanceof AgentCommandValidationError
          ? error.code
          : error instanceof BookkeepingInputError
            ? 'AGENT-INPUT-TEXT-TOO-LONG'
            : undefined;
      if (terminalErrorCode !== undefined) {
        try {
          await completeAgentCommand({
            key: command.key,
            status: 'REJECTED',
            transactionIds: [],
            completedAt: new Date().toISOString(),
            errorCode: terminalErrorCode,
          });
        } catch {
          // If the result file cannot be committed, leave the command queued.
        }
      }
      // Preserve failed commands for diagnosis/retry. A later command must not
      // be blocked by one database failure.
      failedCount += 1;
    }
  }
  return { queuedCount: commands.length, importedCount, failedCount };
}

export function importPendingAgentCommandsAutomatically(
  repositories: Repositories,
): Promise<AgentCommandAutoImportResult> {
  if (importInFlight !== undefined) return importInFlight;
  importInFlight = runImport(repositories).finally(() => {
    importInFlight = undefined;
  });
  return importInFlight;
}
