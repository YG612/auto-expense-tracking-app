import type {
  DatabaseConnection,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../types';
import type { PersistedValues } from './mappingHelpers';

export interface EntityDefinition<Entity extends { id: string }> {
  tableName: string;
  columns: readonly string[];
  defaultOrderBy: string;
  toValues(entity: Entity): PersistedValues;
  fromRow(row: SqlRow): Entity;
}

function assertIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]*$/u.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}

export class BaseRepository<Entity extends { id: string }> {
  constructor(
    protected readonly database: DatabaseConnection,
    protected readonly definition: EntityDefinition<Entity>,
  ) {
    assertIdentifier(definition.tableName);
    definition.columns.forEach(assertIdentifier);
  }

  async create(entity: Entity): Promise<void> {
    return this.database.transaction(transaction =>
      this.insert(entity, transaction),
    );
  }

  protected async insert(entity: Entity, executor: SqlExecutor): Promise<void> {
    const values = this.definition.toValues(entity);
    const columns = this.definition.columns;
    const placeholders = columns.map(() => '?').join(', ');
    const params = columns.map(column => values[column]);

    await executor.execute(
      `INSERT INTO ${this.definition.tableName} (${columns.join(', ')})
       VALUES (${placeholders})`,
      params,
    );
  }

  async update(entity: Entity): Promise<boolean> {
    return this.database.transaction(transaction =>
      this.updateEntity(entity, transaction),
    );
  }

  protected async updateEntity(
    entity: Entity,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const values = this.definition.toValues(entity);
    const columns = this.definition.columns.filter(column => column !== 'id');
    const assignments = columns.map(column => `${column} = ?`).join(', ');
    const params = [...columns.map(column => values[column]), entity.id];

    const result = await executor.execute(
      `UPDATE ${this.definition.tableName}
       SET ${assignments}
       WHERE id = ?`,
      params,
    );

    return result.rowsAffected === 1;
  }

  protected async deleteById(
    id: string,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const result = await executor.execute(
      `DELETE FROM ${this.definition.tableName} WHERE id = ?`,
      [id],
    );

    return result.rowsAffected === 1;
  }

  async findById(id: string): Promise<Entity | undefined> {
    const rows = await this.select('id = ?', [id], undefined, 1);
    return rows[0];
  }

  async listAll(): Promise<Entity[]> {
    return this.select();
  }

  protected async select(
    where?: string,
    params: readonly SqlValue[] = [],
    orderBy: string = this.definition.defaultOrderBy,
    limit?: number,
    executor?: SqlExecutor,
  ): Promise<Entity[]> {
    const whereClause = where === undefined ? '' : ` WHERE ${where}`;
    const orderClause = orderBy.length === 0 ? '' : ` ORDER BY ${orderBy}`;
    const limitClause = limit === undefined ? '' : ` LIMIT ${limit}`;
    const query = `SELECT ${this.definition.columns.join(', ')}
      FROM ${this.definition.tableName}${whereClause}${orderClause}${limitClause}`;
    const runQuery = async (sqlExecutor: SqlExecutor): Promise<Entity[]> => {
      const result = await sqlExecutor.execute(query, params);
      return result.rows.map(row => this.definition.fromRow(row));
    };

    if (executor !== undefined) {
      return runQuery(executor);
    }

    return runQuery(this.database);
  }
}
