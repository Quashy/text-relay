import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareMessage } from '../src/client/shareClipboard.js';

test('share message contains the site homepage and the exact case-sensitive code', () => {
  assert.equal(
    shareMessage('Ab12', 'https://1.14.186.80'),
    '地址：https://1.14.186.80/\n访问码：Ab12',
  );
  assert.equal(
    shareMessage('000a', 'https://share.example.com/manage'),
    '地址：https://share.example.com/\n访问码：000a',
  );
  assert.equal(
    shareMessage('zZ09', 'http://localhost:3000'),
    '地址：http://localhost:3000/\n访问码：zZ09',
  );
});
