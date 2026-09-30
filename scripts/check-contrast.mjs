// 화면 색 대비 계산 — css/style.css 의 :root 토큰(마지막 정의가 이김)으로 글자·바탕 쌍을 재고 4.5:1 미만이면 실패
// 실행: node scripts/check-contrast.mjs [css 경로]
import { readFileSync } from 'node:fs';
const css = readFileSync(process.argv[2] || new URL('../css/style.css', import.meta.url), 'utf8');
const tok = {};
for (const block of css.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) for (const m of block[2].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) tok[m[1]] = m[2];
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
// 반투명 흰 면(첫 화면 흐름 칸 rgba(255,255,255,.06))을 바탕 위에 겹친 색
const over = (bg, alpha) => '#' + rgb(bg).map(v => Math.round(v + (255 - v) * alpha).toString(16).padStart(2, '0')).join('');
const pairs = [
  ['text', 'bg'], ['text', 'surface'], ['muted', 'surface'], ['muted', 'bg'], ['primary', 'surface'], ['on-primary', 'primary'],
  ['on-ink', 'ink'], ['on-ink', 'ink-2'], ['on-ink-muted', 'ink'], ['on-ink-muted', 'ink-2'], ['on-accent', 'accent'],
  ['warn-text', 'warn-bg'], ['#ffffff', 'st-submitted'], ['#ffffff', 'st-answered'], ['#ffffff', 'st-completed'],
  ['on-ink-muted', over(tok.ink || '#000000', .06)], ['on-ink', over(tok['ink-2'] || '#000000', .12)]
];
let bad = 0;
for (const [f, b] of pairs) {
  const fc = f.startsWith('#') ? f : tok[f], bc = b.startsWith('#') ? b : tok[b];
  if (!fc || !bc) { console.log('  FAIL 토큰 없음: ' + f + ' / ' + b); bad++; continue; }
  const r = ratio(fc, bc);
  const okk = r >= 4.5;
  if (!okk) bad++;
  console.log((okk ? '  ok  ' : '  FAIL ') + (f + ' on ' + b).padEnd(34) + r.toFixed(2) + ':1');
}
console.log(bad ? `대비 부족 ${bad}쌍` : '모든 쌍 4.5:1 이상');
process.exit(bad ? 1 : 0);
