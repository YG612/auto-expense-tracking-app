import type { SqlRow, SqlValue } from '../types';

export type PersistedValues = Record<string, SqlValue>;

export function optionalValue(value: SqlValue | undefined): SqlValue {
  return value ?? null;
}

export function booleanValue(value: boolean): number {
  return value ? 1 : 0;
}

export function requiredString(row: SqlRow, key: string): string {
  const value = row[key];

  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string.`);
  }

  return value;
}

export function optionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string or null.`);
  }

  return value;
}

export function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key];

  if (typeof value !== 'number') {
    throw new Error(`Expected ${key} to be a number.`);
  }

  return value;
}

export function optionalNumber(row: SqlRow, key: string): number | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number') {
    throw new Error(`Expected ${key} to be a number or null.`);
  }

  return value;
}

export function requiredBoolean(row: SqlRow, key: string): boolean {
  const value = requiredNumber(row, key);

  if (value !== 0 && value !== 1) {
    throw new Error(`Expected ${key} to be 0 or 1.`);
  }

  return value === 1;
}

export function stringArray(row: SqlRow, key: string): string[] {
  const serialized = requiredString(row, key);
  const parsed: unknown = JSON.parse(serialized);

  if (
    !Array.isArray(parsed) ||
    !parsed.every(value => typeof value === 'string')
  ) {
    throw new Error(`Expected ${key} to contain a JSON string array.`);
  }

  return parsed;
}
