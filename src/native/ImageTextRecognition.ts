import { NativeModules } from 'react-native';

type NativeImageTextRecognition = {
  recognizeBase64(content: string): Promise<ImageTextRecognitionResult>;
  recognizeUri(uri: string): Promise<ImageTextRecognitionResult>;
};

export type ImageTextRecognitionResult = {
  text: string;
  blockCount: number;
  engine: 'ANDROID_MLKIT_BUNDLED' | 'IOS_VISION';
};

function nativeRecognizer(): NativeImageTextRecognition {
  const module = NativeModules.ImageTextRecognition as
    NativeImageTextRecognition | undefined;
  if (module === undefined) {
    throw new Error('On-device image text recognition is unavailable.');
  }
  return module;
}

function validate(
  result: ImageTextRecognitionResult,
): ImageTextRecognitionResult {
  if (
    typeof result.text !== 'string' ||
    result.text.length > 20_000 ||
    !Number.isSafeInteger(result.blockCount) ||
    result.blockCount < 0 ||
    !['ANDROID_MLKIT_BUNDLED', 'IOS_VISION'].includes(result.engine)
  ) {
    throw new Error('Image text recognition returned an invalid result.');
  }
  return result;
}

export async function recognizeImageBase64(
  content: string,
): Promise<ImageTextRecognitionResult> {
  if (content.length === 0 || content.length > 30 * 1024 * 1024) {
    throw new Error('Selected image is invalid or too large.');
  }
  return validate(await nativeRecognizer().recognizeBase64(content));
}

export async function recognizeImageUri(
  uri: string,
): Promise<ImageTextRecognitionResult> {
  const normalized = uri.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 2_048 ||
    (!normalized.startsWith('content://') && !normalized.startsWith('file://'))
  ) {
    throw new Error('Shared image URI is invalid.');
  }
  return validate(await nativeRecognizer().recognizeUri(normalized));
}
