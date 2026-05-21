/**
 * デザインシステムのコンポーネントで色 hex リテラルの直書きを検出する。
 *
 * 色はテーマの semantic カラー（theme.colors.*）経由で参照すること。
 * これによりカラーテーマの「色だけ差し替え」を機械的に担保する（issue #50）。
 *
 * Biome 2.4 の GritQL プラグインはディレクトリスコープができないため、
 * lefthook の pre-commit から src/ui/components 配下に対してこのスクリプトを実行する。
 *
 * 使い方: node scripts/check-no-color-literals.mjs [file ...]
 *   ファイル未指定時は src/ui/components 全体を走査する。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS_DIR = join(import.meta.dirname, '..', 'src', 'ui', 'components');
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

function listComponentFiles() {
  return readdirSync(COMPONENTS_DIR, { recursive: true })
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .map((entry) => join(COMPONENTS_DIR, entry));
}

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : listComponentFiles();

const violations = [];
for (const file of targets) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // 行コメントを除いたコード部分のみを検査する
    const code = line.replace(/\/\/.*$/, '');
    if (HEX_COLOR.test(code)) {
      violations.push(`  ${file}:${index + 1}  ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('✗ デザインシステムのコンポーネントで色リテラルの直書きが見つかりました。');
  console.error('  色は theme.colors.* 経由で参照してください（issue #50）。');
  console.error(violations.join('\n'));
  process.exit(1);
}
