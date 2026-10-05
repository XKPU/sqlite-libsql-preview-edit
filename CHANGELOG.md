# SQLite/LibSQL/Turso Preview&Edit

## [Unreleased] - 2026-10-05

### Security

- Addressed dependency security alerts\
  处理依赖安全警报
  - Removed `linkify-it` (required ≥5.0.2)\
    已移除 `linkify-it`（要求 ≥5.0.2）
  - Removed `markdown-it` (required ≥14.3.1)\
    已移除 `markdown-it`（要求 ≥14.3.1）
  - Removed `xml2js` (required ≥0.5.0)\
    已移除 `xml2js`（要求 ≥0.5.0）
  - Bumped `vite` to 6.4.3 (required ≥6.4.3)\
    将 `vite` 升级至 6.4.3（要求 ≥6.4.3）
  - Bumped `esbuild` to 0.25.12 (required ≥0.25.0)\
    将 `esbuild` 升级至 0.25.12（要求 ≥0.25.0）
- Fixed the CodeQL alert "Shell command built from environment values" in `scripts/test-runner.js`\
  修复 CodeQL 警报“Shell command built from environment values”，命中于 `scripts/test-runner.js`
  - L19: `execSync(\`node ${JSON.stringify(tscPath)} -p ./tsconfig.test.json\`)`
  - L49: `execSync(\`node --test ${JSON.stringify(file)}\`)`
  - L61: `execSync(\`node ${JSON.stringify(path.join(__dirname, 'verify-message-router.js'))}\`)`

[Unreleased]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.3...HEAD