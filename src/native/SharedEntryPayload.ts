import { NativeModules, Platform } from 'react-native';

type SharedEntryPayloadModule = {
  consume(token: string): Promise<string | null>;
};

const nativeModule = NativeModules.SharedEntryPayload as
  SharedEntryPayloadModule | undefined;

export async function consumeSharedEntryPayload(
  token: string,
): Promise<string | undefined> {
  if (Platform.OS !== 'ios' || nativeModule === undefined) return undefined;
  const normalizedToken = token.trim();
  if (!/^[0-9A-Fa-f-]{36}$/u.test(normalizedToken)) return undefined;
  return (await nativeModule.consume(normalizedToken)) ?? undefined;
}
