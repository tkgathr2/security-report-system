/**
 * 幽霊依存（phantom dependency）の検出テスト。
 *
 * 2026-07-25 の事故: adminCsvImport.ts が `encoding-japanese` を直接 import
 * しているのに package.json の dependencies に無く、別パッケージ（mailparser）が
 * 間接的に連れてきていたおかげで偶然動いていた。依存整理でそれが消えた瞬間に
 * 本番が MODULE_NOT_FOUND でクラッシュループした。
 *
 * `npx tsc --noEmit` は @types だけ入っていれば通るため、この種の欠落を
 * 検出できない。src の import を package.json と直接突き合わせる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { builtinModules } from 'module';

const SRC = join(__dirname);
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

/** テスト以外の .ts を再帰的に集める（テストは本番の起動経路から読まれない） */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(p, acc);
    else if (entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** import 文・require から外部パッケージ名（スコープ込み）を抜き出す */
function extractExternalPackages(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const spec = m[1];
      // 相対パス・node: 組み込みは対象外
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      found.push(pkg);
    }
  }
  return found;
}

describe('幽霊依存の検出', () => {
  it('src が import する外部パッケージは全て dependencies に宣言されている', () => {
    const deps = new Set(Object.keys(PKG.dependencies ?? {}));
    const builtin = new Set(builtinModules);
    const files = collectSourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);

    const missing = new Map<string, string[]>();
    for (const file of files) {
      for (const pkg of extractExternalPackages(readFileSync(file, 'utf-8'))) {
        if (builtin.has(pkg) || deps.has(pkg)) continue;
        const rel = file.replace(SRC, 'src');
        if (!missing.has(pkg)) missing.set(pkg, []);
        const list = missing.get(pkg)!;
        if (!list.includes(rel)) list.push(rel);
      }
    }

    const detail = [...missing.entries()]
      .map(([pkg, files]) => `${pkg}（${files.join(', ')}）`)
      .join(' / ');
    // devDependencies にしか無い・どこにも無いパッケージは本番で MODULE_NOT_FOUND になる
    expect(detail, `dependencies に無い外部import: ${detail}`).toBe('');
  });

  it('CSV取込が使う encoding-japanese が dependencies にある（2026-07-25 の事故の回帰）', () => {
    expect(Object.keys(PKG.dependencies ?? {})).toContain('encoding-japanese');
  });
});
