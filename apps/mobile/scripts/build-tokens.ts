/**
 * DADS デザイントークン変換スクリプト
 *
 * `@digital-go-jp/design-tokens`（CSS / Web 前提のエクスポート）を
 * React Native 用の theme トークンに変換し、
 * `src/ui/theme/tokens.generated.ts` を出力する。
 *
 * 実行: `pnpm --filter @envsense/mobile tokens`
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dadsTokens from '@digital-go-jp/design-tokens';
import dadsPkg from '@digital-go-jp/design-tokens/package.json';

// --- DADS トークンツリー -----------------------------------------------------

type TokenLeaf = { $value: unknown; $type?: string };
type TokenNode = TokenLeaf | { [key: string]: TokenNode };

const isLeaf = (node: TokenNode): node is TokenLeaf => '$value' in node;

/** DADS の PascalCase キーを camelCase 化する（先頭 1 文字を小文字に） */
const camel = (key: string): string => key.charAt(0).toLowerCase() + key.slice(1);

/** トークンツリーを再帰走査し、葉ノードを transform で変換する */
function mapTree(node: TokenNode, transform: (leaf: TokenLeaf) => unknown): unknown {
  if (isLeaf(node)) return transform(node);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    out[camel(key)] = mapTree(child, transform);
  }
  return out;
}

// --- 値の変換 ---------------------------------------------------------------

/** "1rem" / "0.5rem" → px 数値（1rem = 16px） */
const remToPx = (value: string): number => Math.round(Number.parseFloat(value) * 16);

const asString = (leaf: TokenLeaf): string => String(leaf.$value);
const asNumber = (leaf: TokenLeaf): number => Number(leaf.$value);

/** RN の boxShadow 配列要素 */
type RnShadow = {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadDistance: number;
  color: string;
};

/**
 * CSS の box-shadow 文字列を RN の boxShadow 配列へ変換する。
 * 例: "0 2px 8px 1px rgba(0,0,0,0.1), 0 1px 5px 0 rgba(0,0,0,0.3)"
 */
function parseBoxShadow(css: string): RnShadow[] {
  // rgba(...) 内のカンマで誤分割しないよう、括弧の外のカンマだけで層を分割する
  const layers: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of css) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(buffer);
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim() !== '') layers.push(buffer);

  return layers.map((layer) => {
    const [offsetX, offsetY, blurRadius, spreadDistance, ...color] = layer.trim().split(/\s+/);
    return {
      offsetX: Math.round(Number.parseFloat(offsetX)),
      offsetY: Math.round(Number.parseFloat(offsetY)),
      blurRadius: Math.round(Number.parseFloat(blurRadius)),
      spreadDistance: Math.round(Number.parseFloat(spreadDistance)),
      color: color.join(' '),
    };
  });
}

/**
 * DADS のフォントファミリ → RN 登録フォント名のマッピング。
 * CSS フォントスタックは RN では使えないため、ウェイトごとに実体名を指定する。
 * Sans = Noto Sans JP（`@expo-google-fonts/noto-sans-jp`、#44 で導入）。
 */
const fontFamily = {
  sans: { '400': 'NotoSansJP_400Regular', '700': 'NotoSansJP_700Bold' },
  mono: { '400': 'NotoSansMono_400Regular', '700': 'NotoSansMono_700Bold' },
};

// --- 変換の実行 -------------------------------------------------------------

const dads = dadsTokens as unknown as Record<string, Record<string, TokenNode>>;

const tokens = {
  color: {
    primitive: mapTree(dads.Color.Primitive, asString),
    neutral: mapTree(dads.Color.Neutral, asString),
    semantic: mapTree(dads.Color.Semantic, asString),
  },
  fontSize: mapTree(dads.FontSize, (leaf) => remToPx(asString(leaf))),
  fontWeight: mapTree(dads.FontWeight, asString),
  lineHeight: mapTree(dads.LineHeight, asNumber),
  borderRadius: mapTree(dads.BorderRadius, (leaf) => remToPx(asString(leaf))),
  elevation: mapTree(dads.Elevation, (leaf) => parseBoxShadow(asString(leaf))),
  fontFamily,
};

// --- 出力 -------------------------------------------------------------------

const header = [
  '/**',
  ' * AUTO-GENERATED FILE — DO NOT EDIT.',
  ' *',
  ` * Source : @digital-go-jp/design-tokens@${dadsPkg.version}`,
  ' * Script : scripts/build-tokens.ts',
  ' * Update : pnpm --filter @envsense/mobile tokens',
  ' */',
].join('\n');

const outDir = join(process.cwd(), 'src', 'ui', 'theme');
const outFile = join(outDir, 'tokens.generated.ts');

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  `${header}\n\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`,
);

// リポジトリの Biome 規約に整形を揃える（再生成時の差分を安定させる）
execSync(`pnpm exec biome format --write "${outFile}"`, { stdio: 'inherit' });

console.log(`✓ generated ${outFile}`);
