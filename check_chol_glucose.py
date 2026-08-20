import json
from pathlib import Path

files = list(Path('data/synthea_output').glob('*.json'))
print(f"Scanning {len(files)} files...")

target_codes = {'2093-3': 0, '2085-9': 0, '2339-0': 0, '2345-7': 0}

for i, f in enumerate(files):
    if i % 500 == 0:
        print(f"...processed {i} files so far")
    try:
        bundle = json.loads(f.read_text(encoding='utf-8'))
    except Exception:
        continue
    for e in bundle.get('entry', []):
        res = e.get('resource', {})
        if res.get('resourceType') != 'Observation':
            continue
        for coding in res.get('code', {}).get('coding', []):
            code = coding.get('code')
            if code in target_codes:
                target_codes[code] += 1
        for comp in res.get('component', []):
            for coding in comp.get('code', {}).get('coding', []):
                code = coding.get('code')
                if code in target_codes:
                    target_codes[code] += 1

print("DONE:", target_codes)
