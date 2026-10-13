"""Build a source-only Glassport plugin ZIP from an explicit public file selection."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'plugin.json').read_text())
version = manifest['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('The plugin version must have three numeric components.')
selected = {
    'plugin.json', 'mcp.json', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md',
    'assets/launch/glassport-splattercore.png',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json',
    'tsconfig.json', '.gitignore',
    'docs/RUNBOOK.md', 'docs/PLUGIN.md', 'docs/PRIVACY.md', 'docs/TERMS.md',
    'docs/VERIFICATION.md', 'docs/device-setup-requirements.md',
    'scripts/build-mcp.mjs', 'scripts/verify-mcp.ts', 'scripts/isolated-service.mjs',
    'scripts/test.mjs', 'scripts/package-plugin.py',
    'scripts/start.sh', 'scripts/start.ts', 'scripts/stop.sh', 'scripts/stop.ts',
    'scripts/doctor.ts', 'scripts/ios.sh', 'scripts/ios.py',
    'scripts/native-bridge.py', 'scripts/native-network.py',
    'scripts/native-readiness.py', 'scripts/ios-requirements.txt',
    'scripts/ios-network-requirements.txt',
}
allowed_suffixes = {'.ts', '.js', '.mjs', '.html', '.css', '.md', '.yaml', '.svg', '.txt'}
for directory in ['apps', 'packages', 'skills/glassport', 'assets', 'LICENSES', 'tests']:
    selected.update(str(path.relative_to(ROOT)) for path in (ROOT / directory).rglob('*')
                    if path.is_file() and not path.is_symlink()
                    and 'fixtures' not in path.parts
                    and path.suffix in allowed_suffixes)
for path in selected:
    if not (ROOT / path).is_file() or (ROOT / path).is_symlink():
        raise SystemExit(f'The selected source file is missing or linked: {path}')
    if any(part in {'runtime', 'exports', 'private-evidence', 'node_modules', '.local', 'records', 'specs', 'handoff', '.specify'}
           for part in Path(path).parts):
        raise SystemExit(f'A private directory entered the public selection: {path}')
# This is a release gate for obvious disclosures, not a complete privacy audit.
disclosures = [
    '/' + r'Users/[^\s]+', '/' + r'Volumes/[^\s]+',
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    r'\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{12,}',
    r'\b[0-9a-f]{8}-[0-9a-f]{16}\b',
    r'\b[a-zA-Z0-9.-]+\.ts\.net\b',
]
for name in selected:
    text = (ROOT / name).read_text(errors='replace')
    if any(re.search(pattern, text) for pattern in disclosures):
        raise SystemExit(f'Potential private material in selected source: {name}')
interface = manifest['extensions']['com.openai']['interface']
for key in ['logo', 'composerIcon']:
    if interface[key].removeprefix('./') not in selected:
        raise SystemExit(f'The manifest references an unpackaged {key}.')
if len(interface['shortDescription']) > 30 or len(interface['longDescription']) > 4000:
    raise SystemExit('The public listing exceeds its subtitle or description limit.')
output = ROOT / '.release'
output.mkdir(exist_ok=True)
archive = output / f'glassport-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name in sorted(selected):
        info = zipfile.ZipInfo(name)
        info.external_attr = (0o100755 if (ROOT / name).stat().st_mode & 0o111 else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, (ROOT / name).read_bytes())
with zipfile.ZipFile(archive) as package:
    if package.testzip() is not None:
        raise SystemExit('The plugin ZIP failed its integrity check.')
    assert package.namelist() == sorted(selected)
receipt = {'package': archive.name, 'version': version, 'bytes': archive.stat().st_size,
           'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
           'files': sorted(selected), 'file_count': len(selected),
           'private_state_included': False, 'official_submission': False}
(output / 'package-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({key: value for key, value in receipt.items() if key != 'files'}, indent=2))
