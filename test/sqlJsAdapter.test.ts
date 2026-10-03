import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { SqlJsAdapter } from '../src/extension/adapter/sqlJsAdapter';

/**
 * Integration tests for the sql.js adapter. These create a real SQLite
 * database in a temp directory, exercise every adapter method, and clean up
 * after themselves.
 *
 * The tests are self-contained: they spin up the WASM engine once and run
 * against a fresh file for each suite.
 */
describe('SqlJsAdapter', () => {
  let tmpDir: string;
  let dbFile: string;

  before(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-adapter-'));
  });

  after(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  /** A distinct path inside the suite temp dir. */
  function tempFile(name: string): string {
    return path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  }

  /** Count rows, asserting the adapter did not return an ErrorInfo. */
  async function rows(adapter: SqlJsAdapter, table: string): Promise<number> {
    const r = await adapter.rowCount(table);
    assert.equal(typeof r, 'number', `rowCount(${table}) returned an error`);
    return r as number;
  }

  async function freshAdapter(): Promise<SqlJsAdapter> {
    dbFile = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    await fs.promises.writeFile(dbFile, Buffer.alloc(0));
    const adapter = new SqlJsAdapter();
    const info = await adapter.open(dbFile);
    assert.ok(!('code' in info), 'open should succeed');
    return adapter;
  }

  async function createDatabaseWithSchema(): Promise<SqlJsAdapter> {
    const adapter = await freshAdapter();
    await adapter.executeStatements([
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, age INTEGER);',
      'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount REAL);',
      'CREATE VIEW user_orders AS SELECT u.name, COUNT(o.id) as cnt FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id;',
      'CREATE INDEX idx_users_email ON users(email);',
      "CREATE TRIGGER notify_insert AFTER INSERT ON users FOR EACH ROW BEGIN SELECT 1; END;"
    ]);
    await adapter.executeStatements([
      "INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30);",
      "INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25);",
      "INSERT INTO users (name, email, age) VALUES ('Carol', NULL, 35);",
      "INSERT INTO orders (user_id, amount) VALUES (1, 99.50);",
      "INSERT INTO orders (user_id, amount) VALUES (1, 25.00);",
      "INSERT INTO orders (user_id, amount) VALUES (2, 10.00);"
    ]);
    return adapter;
  }

  it('opens a new database and reports version', async () => {
    const adapter = await freshAdapter();
    const info = await adapter.getInfo();
    assert.equal('code' in info, false);
    assert.ok((info as { version: string }).version.length > 0);
    assert.ok((info as { pageSize: number }).pageSize > 0);
    await adapter.close();
  });

  it('opens a file that does not exist', async () => {
    const adapter = new SqlJsAdapter();
    const info = await adapter.open('/nonexistent/path/db.sqlite');
    assert.equal('code' in info, true);
    assert.equal((info as { code: string }).code, 'FILE_NOT_FOUND');
  });

  it('lists objects after creating schema', async () => {
    const adapter = await createDatabaseWithSchema();
    const objects = await adapter.getObjects(false);
    assert.equal('code' in objects, false);
    const objList = objects as { name: string; type: string }[];
    const tables = objList.filter((o) => o.type === 'table').map((o) => o.name);
    const views = objList.filter((o) => o.type === 'view').map((o) => o.name);
    const indexes = objList.filter((o) => o.type === 'index').map((o) => o.name);
    const triggers = objList.filter((o) => o.type === 'trigger').map((o) => o.name);
    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('orders'));
    assert.ok(views.includes('user_orders'));
    assert.ok(indexes.includes('idx_users_email'));
    assert.ok(triggers.includes('notify_insert'));
    await adapter.close();
  });

  it('reads schema with column info', async () => {
    const adapter = await createDatabaseWithSchema();
    const schema = await adapter.getSchema('users');
    assert.equal('code' in schema, false);
    const cols = (schema as { columns: { name: string; pk: boolean; notNull: boolean }[] }).columns;
    assert.equal(cols.length, 4);
    const id = cols.find((c) => c.name === 'id');
    assert.equal(id?.pk, true);
    const name = cols.find((c) => c.name === 'name');
    assert.equal(name?.notNull, true);
    assert.equal(name?.pk, false);
    await adapter.close();
  });

  it('queries data with pagination', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.query('SELECT * FROM users ORDER BY id', 0, 2);
    assert.equal('code' in result, false);
    const r = result as { totalRows: number; rows: unknown[][]; truncated: boolean };
    assert.equal(r.totalRows, 3);
    assert.equal(r.rows.length, 2);
    assert.equal(r.truncated, true);
    await adapter.close();
  });

  it('counts rows', async () => {
    const adapter = await createDatabaseWithSchema();
    const count = await rows(adapter, 'users');
    assert.equal(count, 3);
    await adapter.close();
  });

  it('commits edits inside a transaction', async () => {
    const adapter = await createDatabaseWithSchema();
    const edits = [
      {
        key: { table: 'users', keyColumns: ['id'], keyValues: [1] },
        edits: [{ column: 'name', value: 'Alice Updated', original: 'Alice' }]
      }
    ];
    const result = await adapter.commitEdits(edits);
    assert.equal('code' in result, false);
    assert.equal((result as { changes: number }).changes, 1);

    const check = await adapter.query('SELECT name FROM users WHERE id = 1', 0, 1);
    assert.equal('code' in check, false);
    const row = (check as { rows: unknown[][] }).rows[0];
    assert.equal(row?.[0], 'Alice Updated');
    await adapter.close();
  });

  it('inserts a row', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.insertRow('users', { name: 'Dave', age: 40 });
    assert.equal('code' in result, false);
    const key = (result as { key: { columns: string[]; values: unknown[] } }).key;
    assert.equal(key.columns[0], 'rowid');
    assert.ok((key.values[0] as number) > 3);

    const count = await rows(adapter, 'users');
    assert.equal(count, 4);
    await adapter.close();
  });

  it('insert enforces NOT NULL constraints', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.insertRow('users', { age: 40 });
    assert.equal('code' in result, true);
    assert.equal((result as { code: string }).code, 'SQL_ERROR');
    await adapter.close();
  });

  it('deletes rows', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.deleteRows([
      { table: 'users', keyColumns: ['id'], keyValues: [1] },
      { table: 'users', keyColumns: ['id'], keyValues: [2] }
    ]);
    assert.equal('code' in result, false);
    assert.equal((result as { changes: number }).changes, 2);

    const count = await rows(adapter, 'users');
    assert.equal(count, 1);
    await adapter.close();
  });

  it('duplicates a row', async () => {
    const adapter = await createDatabaseWithSchema();
    const before = await rows(adapter, 'users');
    const result = await adapter.duplicateRow('users', ['id'], [1]);
    assert.equal('code' in result, false);
    const after = await rows(adapter, 'users');
    assert.equal(after, before + 1);
    await adapter.close();
  });

  it('executes multiple statements in a transaction', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.executeStatements([
      "INSERT INTO users (name) VALUES ('Eve');",
      "INSERT INTO users (name) VALUES ('Frank');"
    ]);
    assert.equal('code' in result, false);
    const r = result as { statements: number; affectedRows: number };
    assert.equal(r.statements, 2);
    assert.equal(r.affectedRows, 2);
    await adapter.close();
  });

  it('rolls back on failure', async () => {
    const adapter = await createDatabaseWithSchema();
    const before = await rows(adapter, 'users');
    const result = await adapter.executeStatements([
      "INSERT INTO users (name) VALUES ('Good');",
      "INSERT INTO users (age) VALUES (99);", // fails: name is NOT NULL
      "INSERT INTO users (name) VALUES ('Bad');", // should not run
    ]);
    assert.equal('code' in result, true);
    const after = await rows(adapter, 'users');
    assert.equal(after, before, 'all statements should be rolled back');
    await adapter.close();
  });

  it('executes DDL', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.executeDdl([
      'ALTER TABLE users ADD COLUMN nickname TEXT;'
    ]);
    assert.equal('code' in result, false);

    const schema = await adapter.getSchema('users');
    assert.equal('code' in schema, false);
    const cols = (schema as { columns: { name: string }[] }).columns.map((c) => c.name);
    assert.ok(cols.includes('nickname'));
    await adapter.close();
  });

  it('deletes an object', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.deleteObject('idx_users_email', 'index');
    assert.equal('code' in result, false);

    const objects = await adapter.getObjects(false);
    assert.equal('code' in objects, false);
    const names = (objects as { name: string }[]).map((o) => o.name);
    assert.ok(!names.includes('idx_users_email'));
    await adapter.close();
  });

  it('refuses to delete system objects', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.deleteObject('sqlite_master', 'system');
    assert.equal('code' in result, true);
    assert.equal((result as { code: string }).code, 'PERMISSION');
    await adapter.close();
  });

  it('exports a table to CSV', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.export('csv', 'users');
    assert.equal('code' in result, false);
    const r = result as { filePath: string; sizeBytes: number };
    assert.ok(r.sizeBytes > 0);
    const content = fs.readFileSync(r.filePath, 'utf8');
    assert.ok(content.includes('name'));
    assert.ok(content.includes('Alice'));
    await adapter.close();
  });

  it('exports a table to JSON', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.export('json', 'users');
    assert.equal('code' in result, false);
    const r = result as { filePath: string };
    const content = JSON.parse(fs.readFileSync(r.filePath, 'utf8'));
    assert.equal(Array.isArray(content), true);
    assert.equal(content.length, 3);
    await adapter.close();
  });

  it('exports a table to SQL', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.export('sql', 'users');
    assert.equal('code' in result, false);
    const r = result as { filePath: string };
    const content = fs.readFileSync(r.filePath, 'utf8');
    assert.ok(content.includes('CREATE TABLE'));
    assert.ok(content.includes('INSERT INTO'));
    await adapter.close();
  });

  it('exports the whole database', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.exportDatabase('sql');
    assert.equal('code' in result, false);
    const r = result as { filePath: string; sizeBytes: number };
    assert.ok(r.sizeBytes > 0);
    const content = fs.readFileSync(r.filePath, 'utf8');
    assert.ok(content.includes('CREATE TABLE users'));
    assert.ok(content.includes('CREATE TABLE orders'));
    assert.ok(content.includes('CREATE VIEW'));
    await adapter.close();
  });

  it('importPreview reads CSV', async () => {
    const adapter = await createDatabaseWithSchema();
    const csvFile = path.join(tmpDir, 'import.csv');
    await fs.promises.writeFile(csvFile, 'name,email,age\nDave,dave@example.com,40\nEve,eve@example.com,30\n');
    const result = await adapter.importPreview(csvFile, 'csv');
    assert.equal('code' in result, false);
    const r = result as { headers: string[]; mappings: { source: string }[] };
    assert.deepEqual(r.headers, ['name', 'email', 'age']);
    assert.equal(r.mappings.length, 3);
    await adapter.close();
  });

  it('importPreview reads JSON', async () => {
    const adapter = await createDatabaseWithSchema();
    const jsonFile = path.join(tmpDir, 'import.json');
    await fs.promises.writeFile(jsonFile, JSON.stringify([{ name: 'Dave', age: 40 }, { name: 'Eve', age: 30 }]));
    const result = await adapter.importPreview(jsonFile, 'json');
    assert.equal('code' in result, false);
    const r = result as { headers: string[] };
    assert.deepEqual(r.headers, ['name', 'age']);
    await adapter.close();
  });

  it('imports CSV into an existing table', async () => {
    const adapter = await createDatabaseWithSchema();
    const before = await rows(adapter, 'users');
    const csvFile = path.join(tmpDir, 'import2.csv');
    await fs.promises.writeFile(csvFile, 'name,email,age\nDave,dave@example.com,40\n');
    const mappings = [
      { source: 'name', target: 'name', inferredType: 'TEXT' },
      { source: 'email', target: 'email', inferredType: 'TEXT' },
      { source: 'age', target: 'age', inferredType: 'INTEGER' }
    ];
    const result = await adapter.importCommit(csvFile, 'users', mappings, 'skip', false);
    assert.equal('code' in result, false);
    const r = result as { rows: number; skipped: number };
    assert.equal(r.rows, 1);
    const after = await rows(adapter, 'users');
    assert.equal(after, before + 1);
    await adapter.close();
  });

  it('imports and creates the table when it does not exist', async () => {
    const adapter = await createDatabaseWithSchema();
    const jsonFile = path.join(tmpDir, 'import3.json');
    await fs.promises.writeFile(jsonFile, JSON.stringify([{ id: 1, val: 'x' }, { id: 2, val: 'y' }]));
    const mappings = [
      { source: 'id', target: 'id', inferredType: 'INTEGER' },
      { source: 'val', target: 'val', inferredType: 'TEXT' }
    ];
    const result = await adapter.importCommit(jsonFile, 'newtable', mappings, 'skip', true);
    assert.equal('code' in result, false);
    const r = result as { rows: number };
    assert.equal(r.rows, 2);
    await adapter.close();
  });

  it('executeSql returns a result set', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.executeSql('SELECT * FROM users WHERE age > 26');
    assert.equal('code' in result, false);
    const r = result as { isQuery: boolean; rows: unknown[][] };
    assert.equal(r.isQuery, true);
    assert.equal(r.rows.length, 2);
    await adapter.close();
  });

  it('executeSql returns affectedRows for non-query', async () => {
    const adapter = await createDatabaseWithSchema();
    const result = await adapter.executeSql("UPDATE users SET name = 'X' WHERE id = 1");
    assert.equal('code' in result, false);
    const r = result as { isQuery: boolean; affectedRows: number };
    assert.equal(r.isQuery, false);
    assert.equal(r.affectedRows, 1);
    await adapter.close();
  });

  it('persistence: writes survive close+reopen', async () => {
    const adapter = await createDatabaseWithSchema();
    await adapter.executeStatements(["INSERT INTO users (name) VALUES ('Persisted');"]);
    await adapter.close();

    const adapter2 = new SqlJsAdapter();
    const info = await adapter2.open(dbFile);
    assert.equal('code' in info, false);
    const count = await adapter2.rowCount('users');
    assert.equal(count, 4);
    await adapter2.close();
  });

  it('isOpen returns true after open and false after close', async () => {
    const adapter = await freshAdapter();
    assert.equal(adapter.isOpen(), true);
    await adapter.close();
    assert.equal(adapter.isOpen(), false);
  });
});
