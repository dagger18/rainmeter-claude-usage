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

    while True:
        msg = _read_message()
        action = msg.get('action')

        if action == 'write':
            data = msg.get('data', {})
            os.makedirs(output_dir, exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            _write_message({'ok': True})

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
