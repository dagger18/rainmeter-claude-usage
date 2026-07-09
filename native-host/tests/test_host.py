import json
import os
import struct
import subprocess
import sys
import pathlib

HOST = pathlib.Path(__file__).parent.parent / 'claude_usage_host.py'


def _send(proc, data):
    encoded = json.dumps(data).encode('utf-8')
    proc.stdin.write(struct.pack('<I', len(encoded)))
    proc.stdin.write(encoded)
    proc.stdin.flush()


def _recv(proc):
    raw = proc.stdout.read(4)
    assert raw, "No response from host"
    length = struct.unpack('<I', raw)[0]
    return json.loads(proc.stdout.read(length).decode('utf-8'))


def _start_host(skin_dir):
    return subprocess.Popen(
        [sys.executable, str(HOST), str(skin_dir)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )


def test_write_creates_json_file(tmp_path):
    proc = _start_host(tmp_path)
    data = {
        'session_pct': 42,
        'session_tokens': 1893240,
        'session_limit': 4517000,
        'session_reset_label': '2h 14m',
        'weekly_pct': 18,
        'weekly_tokens': 7848000,
        'weekly_limit': 43600000,
        'weekly_reset_label': '4d 7h',
        'last_updated': '14:32:01',
        'error': '',
    }
    _send(proc, {'action': 'write', 'data': data})
    response = _recv(proc)
    proc.terminate()

    assert response == {'ok': True}
    output = pathlib.Path(os.environ['APPDATA']) / 'Claude' / 'usage_data.json'
    assert output.exists()
    written = json.loads(output.read_text(encoding='utf-8'))
    assert written['session_pct'] == 42
    assert written['weekly_pct'] == 18
    assert written['session_reset_label'] == '2h 14m'
    assert written['last_updated'] == '14:32:01'
    assert written['error'] == ''


def test_check_sentinel_true_when_file_exists(tmp_path):
    sentinel = tmp_path / 'refresh_requested.txt'
    sentinel.write_text('1', encoding='utf-8')

    proc = _start_host(tmp_path)
    _send(proc, {'action': 'check_sentinel'})
    response = _recv(proc)
    proc.terminate()

    assert response == {'trigger': True}
    assert not sentinel.exists()


def test_check_sentinel_false_when_file_absent(tmp_path):
    proc = _start_host(tmp_path)
    _send(proc, {'action': 'check_sentinel'})
    response = _recv(proc)
    proc.terminate()

    assert response == {'trigger': False}


def test_unknown_action_returns_error(tmp_path):
    proc = _start_host(tmp_path)
    _send(proc, {'action': 'bogus'})
    response = _recv(proc)
    proc.terminate()

    assert 'error' in response


def test_multiple_messages_in_sequence(tmp_path):
    sentinel = tmp_path / 'refresh_requested.txt'
    proc = _start_host(tmp_path)

    _send(proc, {'action': 'check_sentinel'})
    r1 = _recv(proc)
    assert r1 == {'trigger': False}

    sentinel.write_text('1', encoding='utf-8')
    _send(proc, {'action': 'check_sentinel'})
    r2 = _recv(proc)
    assert r2 == {'trigger': True}

    _send(proc, {'action': 'check_sentinel'})
    r3 = _recv(proc)
    proc.terminate()
    assert r3 == {'trigger': False}
