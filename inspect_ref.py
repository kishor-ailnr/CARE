import json
from pathlib import Path

files = list(Path('data/synthea_output').glob('*.json'))
bundle = json.loads(files[0].read_text())
entries = bundle.get('entry', [])

for e in entries:
    res = e.get('resource', {})
    if res.get('resourceType') == 'Patient':
        print('Patient id:', res.get('id'))
    if res.get('resourceType') == 'Encounter':
        print('Encounter id:', res.get('id'))
        print('Encounter subject.reference:', res.get('subject', {}).get('reference'))
        break
