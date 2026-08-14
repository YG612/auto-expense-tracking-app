import { NativeModules } from 'react-native';

import {
  recognizeImageBase64,
  recognizeImageUri,
} from '../native/ImageTextRecognition';

describe('ImageTextRecognition TypeScript boundary', () => {
  afterEach(() => delete NativeModules.ImageTextRecognition);

  it('accepts bounded user-selected images and validates local results', async () => {
    const recognizeBase64 = jest.fn(async () => ({
      text: '微信支付\n12.30元',
      blockCount: 2,
      engine: 'ANDROID_MLKIT_BUNDLED' as const,
    }));
    const recognizeUri = jest.fn(async () => ({
      text: '午饭 12.30',
      blockCount: 1,
      engine: 'ANDROID_MLKIT_BUNDLED' as const,
    }));
    NativeModules.ImageTextRecognition = { recognizeBase64, recognizeUri };

    await expect(recognizeImageBase64('YWJj')).resolves.toMatchObject({
      blockCount: 2,
    });
    await expect(
      recognizeImageUri('content://shared/payment.png'),
    ).resolves.toMatchObject({ text: '午饭 12.30' });
  });

  it('rejects untrusted URI schemes and malformed native results', async () => {
    await expect(
      recognizeImageUri('https://example.com/image'),
    ).rejects.toThrow('URI is invalid');
    NativeModules.ImageTextRecognition = {
      recognizeBase64: async () => ({
        text: 'x',
        blockCount: -1,
        engine: 'WEB',
      }),
      recognizeUri: async () => ({ text: 'x', blockCount: -1, engine: 'WEB' }),
    };
    await expect(recognizeImageBase64('YWJj')).rejects.toThrow(
      'invalid result',
    );
  });
});
