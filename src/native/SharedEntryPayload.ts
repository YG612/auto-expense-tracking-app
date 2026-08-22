import { NativeModules, Platform } from 'react-native';

type SharedEntryPayloadModule = {
  consume(token: string): Promise<string | null>;
  clear(): Promise<void>;
};

function nativeModule(): SharedEntryPayloadModule | undefined {
  return NativeModules.SharedEntryPayload as
    SharedEntryPayloadModule | undefined;
}

export async function consumeSharedEntryPayload(
  token: string,
): Promise<string | undefined> {
  const module = nativeModule();
  if (Platform.OS !== 'ios' || module === undefined) return undefined;
  const normalizedToken = token.trim();
  if (!/^[0-9A-Fa-f-]{36}$/u.test(normalizedToken)) return undefined;
  return (await module.consume(normalizedToken)) ?? undefined;
}

export async function clearSharedEntryPayloads(): Promise<void> {
  await nativeModule()?.clear();
}
