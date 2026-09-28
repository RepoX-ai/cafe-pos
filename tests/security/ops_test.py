import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('security_check', ROOT / 'deploy/security-check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.config = {'services': {
            'app': {'ports': [{'host_ip': '127.0.0.1'}], 'environment': {
                'AUTH_SECRET': 'a-unique-fixture-secret-for-config-validation-123',
                'NODE_ENV': 'production', 'APP_URL': 'https://example.test',
                'DATABASE_URL': 'postgres://cafe_pos_app:app-password@db/cafe_pos',
                'TRUSTED_CLIENT_IP_HEADER': 'x-real-ip',
            }},
            'db': {'ports': [], 'environment': {'POSTGRES_PASSWORD': 'owner-password'}},
        }}

    def test_safe_configuration(self):
        self.assertEqual(check.config_errors(self.config), [])

    def test_public_port_detected(self):
        self.config['services']['db']['ports'] = [{'host_ip': '0.0.0.0'}]
        self.assertTrue(any('loopback' in e for e in check.config_errors(self.config)))

    def test_bad_secrets_and_proxy_detected_without_echoing_secrets(self):
        env = self.config['services']['app']['environment']
        env.update(AUTH_SECRET='local-dev-only-auth-secret-min-32-chars-xx',
                   TRUSTED_CLIENT_IP_NONE='1', DATABASE_URL='postgres://postgres:owner-password@db/cafe_pos')
        errors = check.config_errors(self.config)
        self.assertGreaterEqual(len(errors), 4)
        self.assertNotIn('owner-password', str(errors))
        self.assertNotIn(env['AUTH_SECRET'], str(errors))


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.dest = self.root / 'backups'
        self.env = {**os.environ, 'APP_DIR': str(self.root), 'BACKUP_DIR': str(self.dest),
                    'PATH': f'{self.bin}:{os.environ["PATH"]}', 'ALLOW_LOCAL_ONLY_BACKUP': '1',
                    'RCLONE_REMOTE': '', 'KEEP_DAYS': '35', 'MOCK_UPLOAD_FAIL': '0',
                    'MOCK_DUMP_FAIL': '0', 'MOCK_CRYPT': 'crypt'}
        self.command('docker', '''#!/bin/bash
case " $* " in
  *" pg_dump "*) [[ "$MOCK_DUMP_FAIL" == 1 ]] && exit 1; printf 'fixture-dump' ;;
  *" pg_restore "*) cat >/dev/null ;;
  *" tar "*) printf 'fixture-media' | gzip ;;
  *) exit 2 ;;
esac
''')
        self.command('rclone', '''#!/bin/bash
if [[ "$1" == listremotes ]]; then printf 'safe: %s\n' "$MOCK_CRYPT"; exit 0; fi
[[ "$MOCK_UPLOAD_FAIL" != 1 ]]
''')

    def command(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o700)

    def run_backup(self):
        return subprocess.run(['bash', str(ROOT / 'deploy/backup.sh')], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_private_complete_backup_and_checksums(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.dest.stat().st_mode & 0o777, 0o700)
        files = [p for p in self.dest.iterdir() if not p.name.startswith('.')]
        self.assertEqual(len(files), 3)
        for path in files:
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        manifest = next(self.dest.glob('*.sha256'))
        subprocess.run(['sha256sum', '-c', manifest.name], cwd=self.dest, check=True, capture_output=True)

    def test_failed_dump_publishes_nothing(self):
        self.env['MOCK_DUMP_FAIL'] = '1'
        self.assertNotEqual(self.run_backup().returncode, 0)
        self.assertEqual(list(self.dest.glob('*.dump')), [])
        self.assertEqual(list(self.dest.glob('.partial-*')), [])

    def test_unencrypted_remote_rejected(self):
        self.env.update(RCLONE_REMOTE='safe:backups', MOCK_CRYPT='s3')
        self.assertNotEqual(self.run_backup().returncode, 0)

    def test_remote_required_without_explicit_local_override(self):
        self.env['ALLOW_LOCAL_ONLY_BACKUP'] = '0'
        self.assertNotEqual(self.run_backup().returncode, 0)

    def test_encrypted_remote_succeeds(self):
        self.env.update(RCLONE_REMOTE="safe:backups", ALLOW_LOCAL_ONLY_BACKUP="0")
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("encrypted off-site copy completed", result.stdout)

    def test_failed_upload_keeps_old_backups(self):
        self.dest.mkdir()
        old = self.dest / 'db-old.dump'
        old.write_text('old-good-backup')
        os.utime(old, (1, 1))
        self.env.update(RCLONE_REMOTE='safe:backups', MOCK_UPLOAD_FAIL='1')
        self.assertNotEqual(self.run_backup().returncode, 0)
        self.assertTrue(old.exists())
        self.assertEqual(len(list(self.dest.glob('*.sha256'))), 1)


if __name__ == '__main__':
    unittest.main()
