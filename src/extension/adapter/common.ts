// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { bytesToHex, ErrorInfo, isNull, SqlValue } from '../../shared/protocol';

/* ------------------------------------------------------------------------ */
/* Shared adapter utilities — CSV parsing, type inference, value helpers    */
/* ------------------------------------------------------------------------ */

/** Normalise a raw engine value into the SqlValue contract. */
export function normalizeValue(v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) {
    // A view may cover a SLICE of a larger buffer (`byteOffset`/`byteLength`);
    // wrapping the whole buffer silently appends bytes that are not part of
    // the value, corrupting BLOBs on round-trip.
    const view = v as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return String(v);
}

/** Convert a JSON-deserialized value into a SqlValue. */
export function convertJsonValue(v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) {
    // Same slice rule as `normalizeValue`.
    const view = v as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return JSON.stringify(v);
}

/** Infer a SQLite type from a JSON value. */
export function inferType(v: unknown): string {
  if (v === null || v === undefined) return 'TEXT';
  if (typeof v === 'boolean') return 'INTEGER';
  if (typeof v === 'number') return Number.isInteger(v) ? 'INTEGER' : 'REAL';
  if (typeof v === 'string') return 'TEXT';
  return 'TEXT';
}

/** Infer a SQLite type from a CSV column (1-based header row already removed). */
export function inferTypeFromColumn(rows: string[][], colIndex: number): string {
  const values = rows.slice(1).map((r) => r[colIndex] ?? '');
  if (values.length === 0 || values.every((v) => v === '')) return 'TEXT';
  let allNumeric = true;
  let allInteger = true;
  for (const v of values) {
    if (v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      allNumeric = false;
      break;
    }
    if (!Number.isInteger(n)) allInteger = false;
  }
  if (allNumeric) return allInteger ? 'INTEGER' : 'REAL';
  return 'TEXT';
}

/** Parse a CSV string into an array of string arrays. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      // skip
    } else if (c === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Convert an array of row objects to a CSV string. */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys((rows[0] as Record<string, unknown>) ?? {});
  const lines: string[] = [columns.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push(
      columns.map((c) => escapeCsv(csvStringify((r as Record<string, SqlValue>)[c] ?? null))).join(',')
    );
  }
  return lines.join('\n') + '\n';
}

/** Stringify a SqlValue for CSV output. */
export function csvStringify(v: SqlValue): string {
  if (isNull(v)) return '';
  // A BLOB renders as `X'hex'`; the literal contains a single quote, so it must
  // always go through `escapeCsv` (which the caller applies) — but an
  // unquoted `X'…'` that happens to contain no comma/newline would round-trip
  // as the literal text "X'…'" rather than re-import as a BLOB. Quoting it
  // unconditionally keeps the value recognisable on re-import.
  if (v instanceof Uint8Array) return `X'${bytesToHex(v)}'`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Escape a CSV field. BLOB literals (`X'…'`) are always quoted so the
 * hex-literal survives a round-trip even when it contains no comma. */
export function escapeCsv(s: string): string {
  if (/^X'[0-9a-f]*'$/i.test(s) || /[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Type guard: true when the value is an ErrorInfo. */
export function isErrorInfo<T extends object | ErrorInfo>(v: T): v is T & ErrorInfo {
  return typeof (v as ErrorInfo).code === 'string';
}
