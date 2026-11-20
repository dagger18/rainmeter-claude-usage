import sys
import json
import struct
import os


def _read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) == 0:
        sys.exit(0)
    length = struct.unpack('<I', raw_len)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))


def _write_message(data):
    encoded = json.dumps(data).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    skin_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(os.environ['APPDATA'], 'Claude')
    output_file = os.path.join(output_dir, 'usage_data.json')
    sentinel_file = os.path.join(skin_dir, 'refresh_requested.txt')

    history_file = os.path.join(output_dir, 'usage_history.json')

    while True:
        msg = _read_message()
        action = msg.get('action')

        if action == 'write':
            data = msg.get('data', {})
            os.makedirs(output_dir, exist_ok=True)
            # Inject lifetime stats so reader.lua can display them without extra reads
            if os.path.exists(history_file):
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                    data['lifetime_avg_pct'] = history.get('lifetime_avg_pct', 0)
                    data['weeks_recorded'] = history.get('weeks_recorded', 0)
                except (json.JSONDecodeError, OSError):
                    pass
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            _write_message({'ok': True})

        elif action == 'record_week':
            pct = msg.get('pct', 0)
            week_end = msg.get('week_end', '')
            os.makedirs(output_dir, exist_ok=True)
            history = {'weeks': []}
            if os.path.exists(history_file):
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                except (json.JSONDecodeError, OSError):
                    history = {'weeks': []}
            history.setdefault('weeks', [])
            history['weeks'].append({'week_end': week_end, 'pct': pct})
            weeks = history['weeks']
            history['lifetime_avg_pct'] = round(sum(w['pct'] for w in weeks) / len(weeks))
            history['weeks_recorded'] = len(weeks)
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2)
            _write_message({'ok': True, 'lifetime_avg_pct': history['lifetime_avg_pct'], 'weeks_recorded': history['weeks_recorded']})

        elif action == 'write_continue':
            trigger_file = os.path.join(skin_dir, 'continue_trigger.txt')
            with open(trigger_file, 'w', encoding='utf-8') as f:
                f.write('1')
            _write_message({'ok': True})

        elif action == 'check_sentinel':
            if os.path.exists(sentinel_file):
                try:
                    os.remove(sentinel_file)
                except OSError:
                    pass
                _write_message({'trigger': True})
            else:
                _write_message({'trigger': False})

        else:
            _write_message({'error': f'Unknown action: {action}'})


if __name__ == '__main__':
    main()
