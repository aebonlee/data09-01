#!/usr/bin/env python3
"""
매뉴얼 PDF → 페이지별 텍스트 JSON (도구의 「매뉴얼 근거 검색」에 불러오는 파일)

  python3 scripts/manual_to_json.py <PDF 파일 또는 폴더> [...] [-o 출력폴더] [--models "15BRP-X; 18BRP-X"]

- 도구 화면에서 PDF 를 바로 불러와도 되지만(브라우저 안에서 pdf.js 로 추출), PDF 가 크거나
  브라우저가 느리면 이 스크립트로 미리 뽑은 JSON 을 불러오는 편이 빠릅니다.
- 출력 기본 위치는 docs/source/manual/json/ 입니다. 이 폴더와 *.manual.json 은 .gitignore 에 있어
  리포에 올라가지 않습니다. 매뉴얼은 회사 저작물이라 공개 리포에 넣지 않습니다.
- 텍스트 추출은 poppler 의 pdftotext 가 있으면 그것을, 없으면 pypdf 를 씁니다.
    macOS: brew install poppler   /  또는  pip install pypdf
- 형식은 js/manual.js 의 색인 형식과 같습니다:
    { format: 'data09-01.manual-index', version: 1, file, title, models, created,
      pages: [{ n, label, text }] }
  label(인쇄된 쪽 표기, 예 6-17)과 목차는 도구가 불러올 때 다시 계산하므로 여기서는 참고용입니다.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

FORMAT = 'data09-01.manual-index'
LABEL_RE = re.compile(r'^(?:\d{1,2}|[A-Z])-\d{1,3}(?:-\d{1,2})?$')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'docs', 'source', 'manual', 'json')


def page_label(text):
    for line in reversed(text.split('\n')):
        s = line.strip()
        if LABEL_RE.match(s):
            return s
    return ''


def guess_models(file_name):
    """js/manual.js guessModels 와 같은 규칙. '15182023BRP-X OM' → 15BRP-X; 18BRP-X; 20BRP-X; 23BRP-X"""
    base = os.path.splitext(os.path.basename(file_name))[0]
    m = re.match(r'^((?:\d{2})+)\s*([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)?)', base, re.I)
    if m:
        fam = m.group(2).upper()
        return '; '.join(d + fam for d in re.findall(r'\d{2}', m.group(1)))
    f = re.search(r'([A-Z]{2,}[A-Z0-9]*-[A-Z0-9]+)', base, re.I)
    return f.group(1).upper() if f else ''


def extract_pdftotext(path):
    # -layout: 목차의 제목과 쪽 표기가 한 줄에 남도록(도구의 pdf.js 추출과 같은 모양). 쪽 사이는 폼피드(\f)
    out = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', path, '-'], capture_output=True, check=True).stdout
    pages = out.decode('utf-8', 'replace').split('\f')
    if pages and pages[-1].strip() == '':
        pages = pages[:-1]
    return pages


def extract_pypdf(path):
    from pypdf import PdfReader  # 필요할 때만 불러옵니다
    return [(p.extract_text() or '') for p in PdfReader(path).pages]


def extract(path):
    if shutil.which('pdftotext'):
        return extract_pdftotext(path), 'pdftotext'
    try:
        return extract_pypdf(path), 'pypdf'
    except ImportError:
        sys.exit('pdftotext 도 pypdf 도 없습니다. brew install poppler 또는 pip install pypdf 로 설치해 주세요.')


def clean(text):
    lines = [re.sub(r'[ \t]+', ' ', l).rstrip() for l in text.replace('\r', '').split('\n')]
    return '\n'.join(l for l in lines if l.strip())


def convert(path, out_dir, models=None):
    pages, tool = extract(path)
    name = os.path.basename(path)
    base = os.path.splitext(name)[0]
    data = {
        'format': FORMAT, 'version': 1, 'file': name, 'title': base.replace('_', ' ').strip(),
        'models': models if models is not None else guess_models(name),
        'created': datetime.date.today().isoformat(), 'extractor': tool,
        'pages': [{'n': i + 1, 'label': page_label(clean(t)), 'text': clean(t)} for i, t in enumerate(pages)],
    }
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, base + '.manual.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    labeled = sum(1 for p in data['pages'] if p['label'])
    empty = sum(1 for p in data['pages'] if not p['text'].strip())
    print(f'{name}: {len(pages)}쪽 (쪽 표기 {labeled}, 글자 없는 쪽 {empty}) → {os.path.relpath(dest, ROOT)} [{tool}]')
    if empty > len(pages) * 0.5:
        print('  ⚠ 절반 넘는 쪽에 글자가 없습니다. 스캔 PDF 라면 OCR 이 먼저 필요합니다.')
    return dest


def main():
    ap = argparse.ArgumentParser(description='매뉴얼 PDF → 페이지별 텍스트 JSON')
    ap.add_argument('inputs', nargs='+', help='PDF 파일 또는 PDF 가 든 폴더')
    ap.add_argument('-o', '--out', default=DEFAULT_OUT, help='출력 폴더 (기본 docs/source/manual/json)')
    ap.add_argument('--models', default=None, help='적용 모델(여러 개면 ; 로). 비우면 파일 이름에서 짐작')
    a = ap.parse_args()
    files = []
    for p in a.inputs:
        if os.path.isdir(p):
            files += sorted(os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith('.pdf'))
        elif p.lower().endswith('.pdf') and os.path.exists(p):
            files.append(p)
        else:
            print(f'건너뜀: {p}')
    if not files:
        sys.exit('PDF 를 찾지 못했습니다.')
    for f in files:
        convert(f, a.out, a.models)


if __name__ == '__main__':
    main()
