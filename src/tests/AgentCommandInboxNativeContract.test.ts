import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AgentCommandInbox Android security contract', () => {
  it('gates the native inbox to a debuggable Internal application ID', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../android/app/src/main/java/com/qingjiai/agent/AgentCommandInboxModule.kt',
      ),
      'utf8',
    );
    expect(source).toContain('BuildConfig.DEBUG');
    expect(source).toContain(
      'BuildConfig.APPLICATION_ID.endsWith(".internal")',
    );
  });

  it('stores commands in no-backup storage with strict bounds', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../android/app/src/main/java/com/qingjiai/agent/AgentCommandInboxStore.kt',
      ),
      'utf8',
    );
    expect(source).toContain('context.noBackupFilesDir');
    expect(source).toContain('MAX_FILE_BYTES = 16_384L');
    expect(source).toContain('MAX_TEXT_LENGTH = 500');
    expect(source).toContain('MAX_COMMANDS = 20');
    expect(source).toContain(
      'RESULTS_DIRECTORY_NAME = "agent-command-results"',
    );
    expect(source).toContain('MAX_RESULTS = 100');
    expect(source).toContain('output.fd.sync()');
    expect(source.indexOf('Os.rename(')).toBeLessThan(
      source.indexOf('File(directory, "$key.json").delete()'),
    );
    expect(source).toContain('errorCode = "AGENT-COMMAND-INVALID"');
    expect(source).toContain('rejectInvalid(file)');
  });
});
