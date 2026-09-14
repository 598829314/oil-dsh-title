#!/usr/bin/env python3
"""用合成案例评测独立命名模型；显式 --live 才会消耗账号额度。"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import statistics
import time
from codex_adapter import find_codex, generate_title
from oil_codex_title import DEFAULTS, validate_candidate
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='允许实际调用 Luna Fast')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/naming-evaluation.json')
    parser.add_argument('--workers', type=int, default=4, choices=range(1,9))
    args = parser.parse_args()
    cases = json.loads((ROOT / 'tests/fixtures/naming_cases.json').read_text())
    if not args.live:
        print(f'共 {len(cases)} 个合成案例；加 --live 才调用模型。')
        return
    binary = find_codex()
    def run(case):
        start = time.monotonic()
        try:
            candidate, usage = generate_title(binary, DEFAULTS, case['context'], ROOT)
            candidate = validate_candidate(candidate, case['context']['current_title'])
            expected = case['expected']
            errors = []
            if candidate['action'] != expected['action']: errors.append('动作不符')
            for word in expected['contains']:
                if word.casefold() not in candidate['title'].casefold(): errors.append('缺少对象：'+word)
            for word in expected['reject']:
                if word.casefold() in candidate['title'].casefold(): errors.append('错误主线：'+word)
            if candidate['title'] in case['context'].get('conflicting_titles',[]): errors.append('未区分冲突')
            return {'case': case['id'], **candidate, 'passed': not errors, 'errors':errors,
                    'seconds':round(time.monotonic()-start,2),'usage':usage}
        except Exception as exc:
            return {'case':case['id'],'passed':False,'errors':[str(exc)],'seconds':round(time.monotonic()-start,2)}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(run,cases))
    report = {'model':DEFAULTS['model'],'service_tier':DEFAULTS['service_tier'],
              'cases':len(rows),'passed':sum(r['passed'] for r in rows),
              'model_calls':sum(bool(r.get('usage')) for r in rows),
              'median_seconds':round(statistics.median(r['seconds'] for r in rows),2),
              'notice':'确定性问候过滤与 Luna 命名的合成案例单次检查，不代表普遍准确率，也不验证桌面显示。',
              'results':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='results'},ensure_ascii=False))
    for row in rows:
        print(json.dumps({k:v for k,v in row.items() if k!='usage'},ensure_ascii=False))
    return 0 if report['passed']==len(rows) else 1

if __name__=='__main__':
    raise SystemExit(main())
