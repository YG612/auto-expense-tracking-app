import {
  open,
  type DB,
  type QueryResult,
  type Transaction as OpSqliteTransaction,
} from '@op-engineering/op-sqlite';

import type {
  DatabaseConnection,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlValue,
} from './types';

type OpenDatabaseOptions = {
  name: string;
  location?: string;
};

function toSqlResult<Row extends SqlRow>(result: QueryResult): SqlResult<Row> {
  return {
    insertId: result.insertId,
    rowsAffected: result.rowsAffected,
    rows: result.rows as Row[],
  };
}

class OpSqliteExecutor implements SqlExecutor {
  constructor(
    private readonly executor: Pick<OpSqliteTransaction, 'execute'>,
  ) {}

  async execute<Row extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<SqlResult<Row>> {
    const result = await this.executor.execute(
      sql,
      params === undefined ? undefined : [...params],
    );

    return toSqlResult<Row>(result);
  }
}

export class OpSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: DB) {}

  async execute<Row extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<SqlResult<Row>> {
    const result = await this.database.execute(
      sql,
      params === undefined ? undefined : [...params],
    );

    return toSqlResult<Row>(result);
  }

  async transaction<Result>(
    operation: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result> {
    let operationResult: Result | undefined;
    let didComplete = false;

    await this.database.transaction(async transaction => {
      operationResult = await operation(new OpSqliteExecutor(transaction));
      didComplete = true;
    });

    if (!didComplete) {
      throw new Error('Database transaction completed without a result.');
    }

    return operationResult as Result;
  }

  close(): void {
    this.database.close();
  }
}

export function openOpSqliteConnection(
  options: OpenDatabaseOptions,
): DatabaseConnection {
  return new OpSqliteConnection(open(options));
}
