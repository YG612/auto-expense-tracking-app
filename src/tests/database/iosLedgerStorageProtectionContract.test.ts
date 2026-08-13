import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

describe('iOS ledger storage protection native contract', () => {
  it('derives the actual path from pinned OP-SQLite instead of recreating it', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    const opSqliteIos = read(
      'node_modules/@op-engineering/op-sqlite/ios/OPSQLite.mm',
    );
    const opSqliteHost = read(
      'node_modules/@op-engineering/op-sqlite/cpp/DBHostObject.cpp',
    );
    const connection = read('src/database/OpSqliteConnection.ts');

    expect(packageJson.dependencies['@op-engineering/op-sqlite']).toBe(
      '17.1.2',
    );
    expect(opSqliteIos).toContain('NSLibraryDirectory');
    expect(opSqliteHost).toContain('function_map["getDbPath"]');
    expect(connection).toContain('return this.database.getDbPath();');
  });

  it('protects only the exact database and SQLite sidecars', () => {
    const swift = read('ios/QingJiAI/LedgerStorageProtection.swift');

    expect(swift).toContain('static let databaseName = "qingji_ai.sqlite"');
    expect(swift).toContain(
      'static let sidecarSuffixes = ["", "-wal", "-shm"]',
    );
    expect(swift).toContain(
      'FileProtectionType.completeUntilFirstUserAuthentication',
    );
    expect(swift).toContain('resourceValues.isExcludedFromBackup = true');
    expect(swift).toContain('for suffix in Contract.sidecarSuffixes');
    expect(swift).toContain('for: .libraryDirectory');
    expect(swift).toContain(
      'attributes[.type] as? FileAttributeType == FileAttributeType.typeRegular',
    );
    expect(swift).not.toMatch(/setResourceValues\([^)]*libraryURL/);
  });

  it('includes both native bridge files in the iOS Sources build phase', () => {
    const bridge = read('ios/QingJiAI/LedgerStorageProtectionBridge.m');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(bridge).toContain(
      'RCT_EXTERN_MODULE(LedgerStorageProtection, NSObject)',
    );
    expect(bridge).toContain('applyProtection:(NSString *)databasePath');
    expect(project).toContain('LedgerStorageProtection.swift in Sources');
    expect(project).toContain('LedgerStorageProtectionBridge.m in Sources');
  });
});
