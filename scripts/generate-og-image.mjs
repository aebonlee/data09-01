// OG 이미지(1200×630) 만들기 — sharp 는 리포 의존성에 넣지 않습니다(CLAUDE.md §4 표준 스크립트 방식).
//   임시 폴더에서 npm i sharp 한 뒤:  SHARP_DIR=<그 폴더>/node_modules/sharp node scripts/generate-og-image.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const sharp = require(process.env.SHARP_DIR || 'sharp')
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'og-image.png')
const F = 'Apple SD Gothic Neo, Noto Sans KR, sans-serif'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#1f3a5f"/>
<rect x="60" y="60" width="1080" height="510" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
<text x="110" y="165" font-family="${F}" font-size="30" fill="#c9d8ea">Forklift Field Tech Support · 지게차 현장 기술지원</text>
<text x="110" y="275" font-family="${F}" font-weight="700" font-size="76" fill="#ffffff">AI 기술지원</text>
<text x="110" y="355" font-family="${F}" font-weight="700" font-size="48" fill="#ffffff">AI Tech Support Platform</text>
<text x="110" y="445" font-family="${F}" font-size="32" fill="#e8f0fa">접수 · 매뉴얼 근거 AI 회신 · PS 담당자 연계 · 한국어 / English</text>
<text x="110" y="520" font-family="${F}" font-size="26" fill="#9fb6d1">hdx-ps.jobability.co.kr</text>
</svg>`
await sharp(Buffer.from(svg)).resize(1200, 630).png().toFile(OUT)
console.log('ok ' + OUT)
