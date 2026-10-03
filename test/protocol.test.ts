import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  splitStatements,
  quoteIdent,
  quoteLiteral,
  valueToString,
  bytesToHex,
  isNull,
  rowEditKey,
  valueToNumber
} from '../src/shared/protocol';

describe('splitStatements', () => {
  it('splits on top-level semicolons', () => {
    assert.deepEqual(splitStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
  });

  it('does not split inside single-quoted strings', () => {
    assert.deepEqual(splitStatements("SELECT 'a;b'; SELECT 2;"), ["SELECT 'a;b'", 'SELECT 2']);
  });

  it('does not split inside double-quoted strings', () => {
    assert.deepEqual(splitStatements('SELECT "a;b"; SELECT 2;'), ['SELECT "a;b"', 'SELECT 2']);
  });

  it('does not split inside backtick-quoted identifiers', () => {
    assert.deepEqual(splitStatements('SELECT `a;b` FROM t;'), ['SELECT `a;b` FROM t']);
  });

  it('does not split inside -- line comments', () => {
    assert.deepEqual(splitStatements('SELECT 1 -- this; is a comment\nFROM t;'), [
      'SELECT 1 -- this; is a comment\nFROM t'
    ]);
  });

  it('does not split inside /* block comments */', () => {
    assert.deepEqual(splitStatements('SELECT /* this; is a comment */ 1;'), [
      'SELECT /* this; is a comment */ 1'
    ]);
  });

  it('handles escaped single quotes', () => {
    assert.deepEqual(splitStatements("SELECT 'it''s'; SELECT 2;"), ["SELECT 'it''s'", 'SELECT 2']);
  });

  it('ignores trailing whitespace and empty statements', () => {
    assert.deepEqual(splitStatements('   ; ; SELECT 1;'), ['SELECT 1']);
  });

  it('handles unterminated strings gracefully', () => {
    const result = splitStatements("SELECT 'unterminated");
    assert.equal(result.length, 1);
  });
});

describe('quoteIdent', () => {
  it('does not quote simple identifiers', () => {
    assert.equal(quoteIdent('my_table'), 'my_table');
  });

  it('quotes identifiers with spaces', () => {
    assert.equal(quoteIdent('my table'), '"my table"');
  });

  it('quotes identifiers with special characters', () => {
    assert.equal(quoteIdent('my-table'), '"my-table"');
  });

  it('escapes embedded double quotes', () => {
    assert.equal(quoteIdent('a"b'), '"a""b"');
  });
});

describe('quoteLiteral', () => {
  it('returns NULL for null', () => {
    assert.equal(quoteLiteral(null), 'NULL');
  });

  it('returns 1 or 0 for booleans', () => {
    assert.equal(quoteLiteral(true), '1');
    assert.equal(quoteLiteral(false), '0');
  });

  it('returns numeric literals', () => {
    assert.equal(quoteLiteral(42), '42');
    assert.equal(quoteLiteral(3.14), '3.14');
  });

  it('quotes strings and escapes embedded quotes', () => {
    assert.equal(quoteLiteral("hello"), "'hello'");
    assert.equal(quoteLiteral("it's"), "'it''s'");
  });

  it('encodes Uint8Array as hex blob', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    assert.equal(quoteLiteral(bytes), "X'deadbeef'");
  });
});

describe('valueToString', () => {
  it('uses nullDisplay for null', () => {
    assert.equal(valueToString(null, '∅'), '∅');
  });

  it('truncates long strings with ellipsis', () => {
    assert.equal(valueToString('abcdefghij', 'NULL', 5), 'abcde…');
  });

  it('returns booleans as text', () => {
    assert.equal(valueToString(true), 'true');
    assert.equal(valueToString(false), 'false');
  });

  it('encodes Uint8Array as hex blob literal', () => {
    const bytes = new Uint8Array([0xab, 0xcd]);
    assert.equal(valueToString(bytes), "X'abcd'");
  });
});

describe('rowEditKey', () => {
  // This function used to exist as three byte-identical private copies, so
  // these tests pin the shared behaviour that all three call sites relied on.
  it('is stable for the same row', () => {
    assert.equal(rowEditKey('t', ['id'], [1]), rowEditKey('t', ['id'], [1]));
  });

  it('distinguishes different tables and keys', () => {
    assert.notEqual(rowEditKey('a', ['id'], [1]), rowEditKey('b', ['id'], [1]));
    assert.notEqual(rowEditKey('t', ['id'], [1]), rowEditKey('t', ['id'], [2]));
    assert.notEqual(rowEditKey('t', ['id'], [1]), rowEditKey('t', ['other'], [1]));
  });

  it('joins composite keys in order', () => {
    assert.equal(rowEditKey('t', ['a', 'b'], [1, 2]), 't|a,b|1,2');
  });

  it('renders null the same way every time', () => {
    assert.equal(rowEditKey('t', ['id'], [null]), rowEditKey('t', ['id'], [null]));
  });
});

describe('bytesToHex', () => {
  it('converts bytes to lowercase hex', () => {
    assert.equal(bytesToHex(new Uint8Array([0, 1, 15, 255])), '00010fff');
  });
});

describe('isNull', () => {
  it('returns true for null', () => {
    assert.equal(isNull(null), true);
  });

  it('returns false for empty string', () => {
    assert.equal(isNull(''), false);
  });
});

describe('valueToNumber', () => {
  it('converts numeric strings', () => {
    assert.equal(valueToNumber('42'), 42);
  });

  it('returns null for non-numeric strings', () => {
    assert.equal(valueToNumber('abc'), null);
  });

  it('returns null for null', () => {
    assert.equal(valueToNumber(null), null);
  });
});
