import type { Scalar } from '@op-engineering/op-sqlite';

export type SqlValue = Scalar;
export type SqlRow = Record<string, SqlValue>;

export interface SqlResult<Row extends SqlRow = SqlRow> {
  insertId?: number;
  rowsAffected: number;
  rows: Row[];
}

export interface SqlExecutor {
  execute<Row extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<SqlResult<Row>>;
}

export interface DatabaseConnection extends SqlExecutor {
  transaction<Result>(
    operation: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result>;
  close(): void;
}
