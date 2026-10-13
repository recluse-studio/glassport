#!/usr/bin/env python3
"""Check specification structure and references, never product completion."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'specs/001-ipad-control-research'
PRODUCT = ROOT / 'specs/002-browser-ipad-control'
errors = []
checks = []


def require(condition, description):
    checks.append({'check': description, 'passed': bool(condition)})
    if not condition:
        errors.append(description)


def definitions(path, prefix, count):
    content = path.read_text()
    found = re.findall(r'^- \*\*(' + prefix + r'-\d{3})\*\*:', content, re.M)
    expected = [f'{prefix}-{number:03}' for number in range(1, count + 1)]
    require(found == expected, f'{path.relative_to(ROOT)}: unique sequential {prefix} definitions')
    return set(found)


rs = definitions(RESEARCH / 'spec.md', 'RS', 30)
gp = definitions(PRODUCT / 'spec.md', 'GP', 45)
rc = definitions(RESEARCH / 'spec.md', 'RC', 7)
pc = definitions(PRODUCT / 'spec.md', 'PC', 8)
for directory in (RESEARCH, PRODUCT):
    content = (directory / 'spec.md').read_text()
    for heading in ['User Scenarios & Testing', 'Requirements', 'Success Criteria', 'Assumptions']:
        require(f'## {heading}' in content, f'{directory.name}: {heading} section exists')
    require('NEEDS CLARIFICATION' not in content and '$ARGUMENTS' not in content,
            f'{directory.name}: no unresolved scaffold placeholders')
    require((directory / 'checklists/requirements.md').is_file(),
            f'{directory.name}: requirements quality checklist exists')
    checklist = (directory / 'checklists/requirements.md').read_text()
    require('- [ ]' not in checklist, f'{directory.name}: quality review has no unresolved items')

acceptance = (PRODUCT / 'acceptance.md').read_text()
cases = re.findall(r'^\| (AT-\d{2}) \|', acceptance, re.M)
require(cases == [f'AT-{i:02}' for i in range(1, 19)], '18 unique ordered acceptance cases')
mapped_gp = set()
for row in acceptance.splitlines():
    if re.match(r'^\| AT-\d{2} \|', row):
        mapped_gp.update(re.findall(r'GP-\d{3}', row))
require(gp == mapped_gp, 'every GP requirement maps to an acceptance row without unknown IDs')
protocol = (RESEARCH / 'protocol.md').read_text()
questions = re.findall(r'^\| (Q\d{2}) \|', protocol, re.M)
require(questions == [f'Q{i:02}' for i in range(1, 15)], '14 unique ordered research questions')
mapped_rs = set()
for row in protocol.splitlines():
    if re.match(r'^\| Q\d{2} \|', row):
        mapped_rs.update(re.findall(r'RS-\d{3}', row))
require(rs == mapped_rs, 'every RS requirement maps to a research question without unknown IDs')
for directory, prefix, count in [(RESEARCH, 'R', 13), (PRODUCT, 'I', 32)]:
    content = (directory / 'work-packages.md').read_text()
    found = re.findall(r'^- \[ \] (' + prefix + r'\d{2})\b', content, re.M)
    require(found == [f'{prefix}{i:02}' for i in range(1, count + 1)],
            f'{directory.name}: {count} unique unexecuted work packages')

# Check current authored document links only; future output paths are ordinary code spans.
paths = [ROOT / 'README.md', ROOT / 'AGENTS.md']
paths += list((ROOT / 'docs').glob('*.md'))
paths += list((ROOT / 'handoff').glob('*.md'))
paths += [p for p in (ROOT / 'specs').rglob('*.md')
          if not {'source-snapshots', 'upstream', 'native-route-sources'}.intersection(p.relative_to(ROOT).parts)]
for path in paths:
    content = path.read_text()
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', content):
        if '://' in target or target.startswith('#'):
            continue
        local = target.split('#', 1)[0]
        require((path.parent / local).exists(), f'{path.relative_to(ROOT)}: link resolves: {local}')
    for prefix, allowed in [('RS', rs), ('GP', gp), ('RC', rc), ('PC', pc)]:
        refs = set(re.findall(r'\b' + prefix + r'-\d{3}\b', content))
        require(refs <= allowed, f'{path.relative_to(ROOT)}: all {prefix} references defined')

metadata = json.loads((ROOT / '.specify/integration.json').read_text())
require(metadata.get('default_integration') == 'codex', 'Codex is the selected Spec Kit integration')
feature = json.loads((ROOT / '.specify/feature.json').read_text())
require(feature.get('feature_directory') in {
    'specs/001-ipad-control-research', 'specs/002-browser-ipad-control'
}, 'active Spec Kit feature is valid')
result = {'scope': 'specification documents only; no runtime/device proof',
          'passed': not errors, 'checks': len(checks), 'errors': errors,
          'requirements': {'research': len(rs), 'product': len(gp)},
          'research_questions': len(questions), 'acceptance_cases': len(cases),
          'work_packages': 45}
print(json.dumps(result, indent=2))
raise SystemExit(1 if errors else 0)
