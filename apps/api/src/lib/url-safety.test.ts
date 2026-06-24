import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUrlSafe, isBlockedAddress } from './url-safety';

test('isBlockedAddress flags private / loopback / link-local ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fd00::1']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedAddress allows public addresses', () => {
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('assertUrlSafe rejects non-http(s) schemes without resolving', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x']) {
    const result = await assertUrlSafe(url, async () => [{ address: '93.184.216.34' }]);
    assert.equal(result.ok, false);
  }
});

test('assertUrlSafe rejects hosts that resolve to a blocked address', async () => {
  const result = await assertUrlSafe('http://localhost/job', async () => [{ address: '127.0.0.1' }]);
  assert.equal(result.ok, false);
});

test('assertUrlSafe accepts a public host', async () => {
  const result = await assertUrlSafe('https://boards.greenhouse.io/x', async () => [{ address: '93.184.216.34' }]);
  assert.equal(result.ok, true);
});

test('assertUrlSafe rejects an unparseable URL', async () => {
  const result = await assertUrlSafe('not a url', async () => []);
  assert.equal(result.ok, false);
});
