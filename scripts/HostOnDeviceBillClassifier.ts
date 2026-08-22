import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { preprocessBillClassifierText } from '../src/classification/model/preprocessBillClassifierText';
import type {
  OnDeviceBillClassifierPort,
  OnDeviceBillClassifierStatus,
  OnDeviceCategoryPrediction,
  SupportedModelTransactionType,
} from '../src/classification/model/types';

type Manifest = {
  schemaVersion: number;
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  calibrationTemperature?: number;
  candidateStatus?: string;
  deployment?: {
    mode?: string;
    allowAutoCommit?: boolean;
    selectionReportSha256?: string;
    completionReceiptSha256?: string;
    activationSha256?: string;
  };
  thresholds: {
    unifiedConfidence?: number;
    unifiedMargin?: number;
  };
  categoryPolicies?: Record<
    string,
    {
      enabled: boolean;
      confidenceThreshold?: number;
      marginThreshold?: number;
    }
  >;
  models: { name: string; sizeBytes: number; sha256: string }[];
};

const SIMPLIFIED_LABELS = [
  'income',
  'expense.food',
  'expense.transport',
  'expense.shopping',
  'expense.housing',
  'expense.entertainment',
  'expense.healthcare',
  'expense.education',
  'expense.other_expense',
] as const;

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export class HostOnDeviceBillClassifier implements OnDeviceBillClassifierPort {
  private readonly projectRoot: string;
  private readonly modelDirectory: string;
  private readonly executable: string;
  private manifest?: Manifest;
  private failure?: string;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = resolve(projectRoot);
    this.modelDirectory = resolve(
      this.projectRoot,
      'models',
      'bill-classifier',
    );
    this.executable = resolve(
      this.projectRoot,
      'build',
      'bill-classifier-host',
      process.platform === 'win32' ? 'classifier-host.exe' : 'classifier-host',
    );
    try {
      this.manifest = this.loadVerifiedManifest();
    } catch (error) {
      this.failure =
        error instanceof Error ? error.message : 'MODEL_UNAVAILABLE';
    }
  }

  private loadVerifiedManifest(): Manifest {
    if (!existsSync(this.executable)) throw new Error('HOST_RUNTIME_MISSING');
    const manifest = JSON.parse(
      readFileSync(resolve(this.modelDirectory, 'manifest.json'), 'utf8'),
    ) as Manifest;
    if (
      ![1, 2].includes(manifest.schemaVersion) ||
      manifest.modelId !== 'qingji-bill-category-fasttext' ||
      !Array.isArray(manifest.models)
    ) {
      throw new Error('MODEL_MANIFEST_INVALID');
    }
    if (
      (manifest.schemaVersion === 2 &&
        (manifest.models.length !== 1 ||
          manifest.models[0]?.name !== 'category-v3.ftz')) ||
      (manifest.schemaVersion === 1 && manifest.models.length !== 15)
    ) {
      throw new Error('MODEL_ASSET_COUNT_INVALID');
    }
    if (manifest.schemaVersion === 2) {
      const policies = manifest.categoryPolicies;
      const selectionReport = resolve(
        this.modelDirectory,
        'selection_report.json',
      );
      const shadowActivation = resolve(
        this.modelDirectory,
        'shadow-activation.json',
      );
      const selectionCompletion = resolve(
        this.modelDirectory,
        'MODEL_SELECTION_COMPLETE.json',
      );
      if (
        policies === undefined ||
        manifest.candidateStatus !== undefined ||
        manifest.deployment?.mode !== 'SHADOW' ||
        manifest.deployment.allowAutoCommit !== false ||
        !/^[a-f0-9]{64}$/u.test(
          manifest.deployment.selectionReportSha256 ?? '',
        ) ||
        !/^[a-f0-9]{64}$/u.test(
          manifest.deployment.completionReceiptSha256 ?? '',
        ) ||
        !/^[a-f0-9]{64}$/u.test(manifest.deployment.activationSha256 ?? '') ||
        !existsSync(selectionReport) ||
        !existsSync(selectionCompletion) ||
        !existsSync(shadowActivation) ||
        sha256(selectionReport) !== manifest.deployment.selectionReportSha256 ||
        sha256(selectionCompletion) !==
          manifest.deployment.completionReceiptSha256 ||
        sha256(shadowActivation) !== manifest.deployment.activationSha256 ||
        JSON.stringify(Object.keys(policies).sort()) !==
          JSON.stringify([...SIMPLIFIED_LABELS].sort()) ||
        policies['expense.other_expense']?.enabled !== false ||
        SIMPLIFIED_LABELS.some(label => {
          const policy = policies[label];
          return (
            typeof policy?.enabled !== 'boolean' ||
            (policy.enabled &&
              (!finiteUnit(policy.confidenceThreshold) ||
                !finiteUnit(policy.marginThreshold)))
          );
        })
      ) {
        throw new Error('CATEGORY_POLICIES_INVALID');
      }
    }
    for (const spec of manifest.models) {
      if (
        !/^(?:category-v3|parent-(?:expense|income)|child-expense\.[a-z_]+)\.ftz$/u.test(
          spec.name,
        )
      ) {
        throw new Error('MODEL_NAME_INVALID');
      }
      const file = resolve(this.modelDirectory, spec.name);
      if (
        !existsSync(file) ||
        statSync(file).size !== spec.sizeBytes ||
        sha256(file) !== spec.sha256
      ) {
        throw new Error('MODEL_INTEGRITY_FAILED');
      }
    }
    return manifest;
  }

  async status(): Promise<OnDeviceBillClassifierStatus> {
    return this.manifest === undefined
      ? { available: false, loaded: false, reason: this.failure }
      : {
          available: true,
          loaded: true,
          modelId: this.manifest.modelId,
          modelVersion: this.manifest.modelVersion,
          taxonomyVersion: this.manifest.taxonomyVersion,
          deploymentMode:
            this.manifest.schemaVersion === 2 ? 'SHADOW' : 'LEGACY',
        };
  }

  async classify(
    text: string,
    type: SupportedModelTransactionType,
  ): Promise<OnDeviceCategoryPrediction> {
    const manifest = this.manifest;
    if (manifest === undefined)
      throw new Error(this.failure ?? 'MODEL_UNAVAILABLE');
    const normalized = preprocessBillClassifierText(text);
    if (normalized.length === 0) throw new Error('EMPTY_MODEL_TEXT');
    const confidence = manifest.thresholds.unifiedConfidence ?? 0.75;
    const margin = manifest.thresholds.unifiedMargin ?? 0.12;
    const temperature = manifest.calibrationTemperature ?? 1;
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(
        this.executable,
        [
          this.modelDirectory,
          type,
          String(confidence),
          String(margin),
          String(temperature),
        ],
        {
          cwd: this.projectRoot,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill(), 2_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => (stdout += chunk));
      child.stderr.on('data', chunk => (stderr += chunk));
      child.on('error', reject);
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolveOutput(stdout.trimEnd());
        else
          reject(new Error(`HOST_CLASSIFIER_FAILED_${code}: ${stderr.trim()}`));
      });
      child.stdin.end(normalized);
    });
    const fields = output.split('\t');
    if (fields.length !== 9) throw new Error('HOST_CLASSIFIER_INVALID_RESULT');
    const prediction: OnDeviceCategoryPrediction = {
      modelId: manifest.modelId,
      modelVersion: manifest.modelVersion,
      taxonomyVersion: manifest.taxonomyVersion,
      deploymentMode: manifest.schemaVersion === 2 ? 'SHADOW' : 'LEGACY',
      parentCategoryKey: fields[0] || undefined,
      subcategoryKey: fields[1] || undefined,
      top1Probability: Number(fields[2]),
      top2Probability: Number(fields[3]),
      calibratedConfidence: Number(fields[4]),
      calibratedTop2Probability: Number(fields[5]),
      abstained: fields[6] === '1',
      reason: (fields[7] || undefined) as OnDeviceCategoryPrediction['reason'],
      latencyMs: Number(fields[8]),
    };
    if (
      manifest.schemaVersion === 2 &&
      !prediction.abstained &&
      prediction.parentCategoryKey !== undefined
    ) {
      const policy = manifest.categoryPolicies?.[prediction.parentCategoryKey];
      if (policy?.enabled !== true) {
        prediction.abstained = true;
        prediction.reason = 'CATEGORY_DISABLED';
      } else if (
        prediction.calibratedConfidence < (policy.confidenceThreshold ?? 1) ||
        prediction.calibratedConfidence -
          (prediction.calibratedTop2Probability ?? 0) <
          (policy.marginThreshold ?? 1)
      ) {
        prediction.abstained = true;
        prediction.reason = 'CATEGORY_THRESHOLD';
      }
    }
    const probabilities = [
      prediction.top1Probability,
      prediction.top2Probability,
      prediction.calibratedConfidence,
      prediction.calibratedTop2Probability,
    ];
    if (
      probabilities.some(
        value =>
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1,
      ) ||
      !Number.isFinite(prediction.latencyMs) ||
      prediction.latencyMs < 0 ||
      (prediction.parentCategoryKey !== undefined &&
        !/^(?:income|(?:expense|income)\.[a-z0-9_.]+)$/u.test(
          prediction.parentCategoryKey,
        ))
    ) {
      throw new Error('HOST_CLASSIFIER_INVALID_RESULT');
    }
    return prediction;
  }

  async close(): Promise<void> {}
}

function finiteUnit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
  );
}

export const hostBillClassifier = new HostOnDeviceBillClassifier();
