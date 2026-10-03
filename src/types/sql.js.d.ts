declare module 'sql.js' {
  export interface SqlJsValue {
    asString(): string;
    asNumber(): number;
    asBoolean(): boolean;
    asBlob(): Uint8Array;
    get(): SqlJsValue | number | string | boolean | Uint8Array;
  }

  export interface SqlJsStatement {
    bind(values?: (string | number | boolean | Uint8Array | null)[] | null): boolean;
    step(): boolean;
    reset(): void;
    free(): boolean;
    getColumnNames(): string[];
    getAsObject(): Record<string, unknown>;
    get(): (string | number | boolean | Uint8Array | null)[];
    getParameterNames(): string[];
    bindByName(names: Record<string, string | number | boolean | Uint8Array | null>): boolean;
    run(values?: (string | number | boolean | Uint8Array | null)[] | null): boolean;
  }

  export interface SqlJsExecResult {
    columns: string[];
    values: (string | number | boolean | Uint8Array | null)[][];
  }

  export class Database {
    constructor(data?: Uint8Array | Buffer | string | null);
    exec(sql: string, params?: (string | number | boolean | Uint8Array | null)[] | null): SqlJsExecResult[];
    prepare(sql: string): SqlJsStatement;
    run(sql: string, params?: (string | number | boolean | Uint8Array | null)[] | null): void;
    close(): void;
    export(): Uint8Array;
    getRowsModified(): number;
    each(sql: string, params: unknown, callback: (row: Record<string, unknown>) => void): void;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface SqlJsModule {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsModule>;
}
