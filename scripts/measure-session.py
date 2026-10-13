"""Record owned Glassport process resources for the physical mixed-session test."""
import datetime
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
receipt_name = sys.argv[1] if len(sys.argv) > 1 else 'mixed-session-resources.json'
if pathlib.Path(receipt_name).name != receipt_name or not receipt_name.endswith('.json'):
    raise SystemExit('The resource receipt must be a JSON filename in records/.')
receipt_path = ROOT / 'records' / receipt_name
started = time.monotonic()
receipt = {'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'status': 'RUNNING', 'duration_target_seconds': 1200, 'samples': [],
           'scope': 'Owned process resource sampling only; correlate actual browser activity separately.'}

for index in range(5):
    if index:
        time.sleep(max(0, started + index * 300 - time.monotonic()))
    server_pid = int((ROOT / 'runtime/server.pid').read_text().strip())
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,%cpu=,rss='], text=True)
    processes = [line.split() for line in rows.splitlines()]
    owned = {server_pid}
    for _ in range(4):
        owned.update(int(row[0]) for row in processes if int(row[1]) in owned)
    sample = {'sampled_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'elapsed_seconds': round(time.monotonic() - started, 3),
              'processes': [{'pid': int(row[0]), 'parent_pid': int(row[1]),
                             'cpu_percent': float(row[2]), 'rss_kib': int(row[3])}
                            for row in processes if int(row[0]) in owned],
              'log_bytes': {str(p.relative_to(ROOT)): p.stat().st_size
                            for p in (ROOT / 'runtime').glob('*.log')}}
    receipt['samples'].append(sample)
    receipt['status'] = 'RESOURCE_SAMPLING_COMPLETE' if index == 4 else 'RUNNING'
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Resource sample {index + 1}/5 saved.', flush=True)
