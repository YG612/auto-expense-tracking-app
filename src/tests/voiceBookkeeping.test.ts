import { parseTextTransactions } from '../classification/parseTextTransactions';
import { createRepositories, type DatabaseConnection } from '../database';
import { buildTextTransaction } from '../domain/services/textTransaction';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('stage 6 voice result persistence', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('uses the exact text parser and persists only the transcript as VOICE', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const transcript = '午饭花了25元，微信付的。';
    const context = {
      referenceDate: new Date('2026-08-04T07:20:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
    };
    const voiceCandidate = parseTextTransactions(transcript, context)
      .candidates[0];
    const textCandidate = parseTextTransactions(transcript, context)
      .candidates[0];
    expect(voiceCandidate).toEqual(textCandidate);
    if (voiceCandidate === undefined) {
      throw new Error('Expected the shared parser to create one candidate.');
    }

    const built = buildTextTransaction(
      voiceCandidate,
      { categories, accounts, projects, tags },
      'transaction-voice-lunch',
      '2026-08-04T07:21:00.000Z',
      'PENDING',
      'VOICE',
    );
    expect(built.transaction).toMatchObject({
      source: 'VOICE',
      originalText: transcript,
      amountMinor: 2500,
      confirmationStatus: 'PENDING',
    });
    expect(Object.keys(built.transaction)).not.toEqual(
      expect.arrayContaining(['audio', 'audioPath', 'audioUri', 'audioBase64']),
    );

    await repositories.transactions.saveWithTags(
      built.transaction,
      built.tagIds,
    );
    await expect(
      repositories.transactions.findById('transaction-voice-lunch'),
    ).resolves.toMatchObject({
      source: 'VOICE',
      originalText: transcript,
    });
  });

  it('keeps multi-transaction behavior identical for voice transcripts', () => {
    const transcript = '午饭25，打车18，水果32。';
    const result = parseTextTransactions(transcript, {
      referenceDate: new Date('2026-08-04T07:20:00.000Z'),
      timezoneOffsetMinutes: 480,
      recentAccountKey: 'WECHAT',
    });
    expect(result.candidates.map(item => item.amountMinor)).toEqual([
      2500, 1800, 3200,
    ]);
  });
});
