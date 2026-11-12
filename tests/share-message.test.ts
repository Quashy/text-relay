import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareMessage } from '../src/client/shareClipboard.js';

test('share message includes the exact title, site homepage and case-sensitive code on three lines', () => {
  assert.equal(
    shareMessage({ title: '项目说明：第一版', code: 'Ab12' }, 'https://1.14.186.80'),
    '标题：项目说明：第一版\n地址：https://1.14.186.80/\n访问码：Ab12',
  );
  assert.equal(
    shareMessage({ title: 'Title & detail', code: '000a' }, 'https://share.example.com/manage'),
    '标题：Title & detail\n地址：https://share.example.com/\n访问码：000a',
  );
  assert.equal(
    shareMessage({ title: '保留 标题空格', code: 'zZ09' }, 'http://localhost:3000'),
    '标题：保留 标题空格\n地址：http://localhost:3000/\n访问码：zZ09',
  );
});
