import { useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';

type BenchmarkModule = {
  runBenchmarkIfRequested?: () => Promise<{ ran: boolean }>;
};

export function BillClassifierBenchmarkRunner() {
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    const benchmark = NativeModules.OnDeviceBillClassifier as
      BenchmarkModule | undefined;
    benchmark?.runBenchmarkIfRequested?.().catch(() => undefined);
  }, []);

  return null;
}
