import json
from pathlib import Path
from collections import Counter

files = list(Path('data/synthea_output').glob('*.json'))
code_counter = Counter()

for f in files[:200]:  # sample 200 files for speed
    bundle = json.loads(f.read_text(encoding='utf-8'))
    for e in bundle.get('entry', []):
        res = e.get('resource', {})
        if res.get('resourceType') != 'Observation':
            continue
        for coding in res.get('code', {}).get('coding', []):
            if coding.get('system', '').endswith('loinc.org'):
                code_counter[(coding.get('code'), coding.get('display'))] += 1
        for comp in res.get('component', []):
            for coding in comp.get('code', {}).get('coding', []):
                if coding.get('system', '').endswith('loinc.org'):
                    code_counter[(coding.get('code'), coding.get('display'))] += 1

for code, count in code_counter.most_common(30):
    print(count, code)
