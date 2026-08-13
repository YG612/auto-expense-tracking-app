import { AppError, safeErrorMessage } from '../domain/errors/AppError';

describe('safe UI error boundary', () => {
  it('never exposes an unknown native or SQL error message', () => {
    const raw = new Error(
      'SQLITE_ERROR near C:\\Users\\person\\ledger.db: SELECT original_text',
    );
    const message = safeErrorMessage(
      raw,
      '保存失败，请重试。',
      'LEDGER-SAVE-UNEXPECTED',
    );

    expect(message).toBe(
      '保存失败，请重试。（错误码：LEDGER-SAVE-UNEXPECTED）',
    );
    expect(message).not.toContain('Users');
    expect(message).not.toContain('original_text');
  });

  it('shows only the reviewed message and stable code from AppError', () => {
    const error = new AppError(
      'LEDGER-WRITE-CONFLICT',
      '记录已在别处更新，请刷新后重试。',
      {
        category: 'CONFLICT',
        retryable: true,
        cause: new Error('private database detail'),
      },
    );

    const message = safeErrorMessage(error, 'fallback', 'FALLBACK');
    expect(message).toBe(
      '记录已在别处更新，请刷新后重试。（错误码：LEDGER-WRITE-CONFLICT）',
    );
    expect(message).not.toContain('private database detail');
  });
});
