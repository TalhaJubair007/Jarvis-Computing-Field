import test from 'node:test';
import assert from 'node:assert/strict';
import gateway, { parseArgs, validRepo, validBranch, configName, timingSafeEqual, handleText } from './cloudflare-gateway/worker.js';

test('argument parser preserves quoted workspace names', () => {
  assert.deepEqual(parseArgs('https://github.com/a/b.git main arch/arm64/configs/foo_defconfig "poco f7"'), [
    'https://github.com/a/b.git', 'main', 'arch/arm64/configs/foo_defconfig', 'poco f7'
  ]);
});
test('validates repository URLs, branches and defconfigs', () => {
  assert.equal(validRepo('https://github.com/example/kernel.git'), 'https://github.com/example/kernel.git');
  assert.throws(() => validRepo('https://user:pass@github.com/a/b.git'));
  assert.throws(() => validRepo('http://github.com/a/b'));
  assert.equal(validBranch('lineage-22.2'), 'lineage-22.2');
  assert.throws(() => validBranch('../main'));
  assert.equal(configName('vendor/device_defconfig'), 'vendor/device_defconfig');
  assert.throws(() => configName('../bad_defconfig'));
});
test('timing-safe webhook secret equality', () => {
  assert.equal(timingSafeEqual('secret-token', 'secret-token'), true);
  assert.equal(timingSafeEqual('secret-token', 'secret-wrong'), false);
  assert.equal(timingSafeEqual('', ''), false);
});
test('owner-only guard ignores other Telegram users', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await handleText({ TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_OWNER_ID: '123', JARVIS_WORKER_URL: 'https://jarvis.example', JARVIS_TELEGRAM_SECRET: 'secret' }, {
      from: { id: 999 }, chat: { id: 999, type: 'private' }, text: 'hello'
    });
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = original; }
});
test('kernel command dispatches only a fixed workflow with validated arguments', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/dispatches')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const env = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_OWNER_ID: '123', GITHUB_TOKEN: 'ghp_test', GITHUB_OWNER: 'owner', GITHUB_REPO: 'builder', GITHUB_REF: 'main' };
  try {
    await handleText(env, { from: { id: 123 }, chat: { id: 123, type: 'private' }, text: '/kernelrepo https://github.com/a/kernel.git main vendor/device_defconfig onyx' });
    const dispatch = calls.find(c => c.url.includes('/dispatches'));
    assert.ok(dispatch);
    assert.match(dispatch.url, /kernel-build\.yml\/dispatches$/);
    const body = JSON.parse(dispatch.options.body);
    assert.equal(body.inputs.repo_url, 'https://github.com/a/kernel.git');
    assert.equal(body.inputs.defconfig, 'vendor/device_defconfig');
    assert.equal(body.inputs.build_jobs, '2');
    assert.ok(calls.some(c => c.url.includes('/sendMessage')));
  } finally { globalThis.fetch = original; }
});
test('general AI shortcut routes to existing Jarvis Worker API', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/bot/chat')) return new Response(JSON.stringify({ answer: 'Jarvis says hello.' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await handleText({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_OWNER_ID: '123', JARVIS_WORKER_URL: 'https://jarvis.example', JARVIS_TELEGRAM_SECRET: 'shared' }, {
      from: { id: 123 }, chat: { id: 123, type: 'private' }, text: '/task coding Fix this compiler error'
    });
    const chat = calls.find(c => c.url.includes('/api/bot/chat'));
    assert.ok(chat);
    assert.equal(JSON.parse(chat.options.body).task, 'coding');
    assert.ok(calls.some(c => c.url.includes('/sendMessage')));
  } finally { globalThis.fetch = original; }
});
test('AOSP fails closed unless a suitable self-hosted runner is explicitly enabled', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await handleText({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_OWNER_ID: '123' }, {
      from: { id: 123 }, chat: { id: 123, type: 'private' }, text: '/aosp https://github.com/LineageOS/android.git lineage-22.2 aosp_onyx-userdebug'
    });
    assert.equal(calls.some(x => x.includes('/dispatches')), false);
    assert.ok(calls.some(x => x.includes('/sendMessage')));
  } finally { globalThis.fetch = original; }
});
test('webhook rejects a missing or incorrect secret before scheduling work', async () => {
  let scheduled = false;
  const request = new Request('https://gateway.example/telegram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 1 }) });
  const response = await gateway.fetch(request, { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_WEBHOOK_SECRET: 'correct', TELEGRAM_OWNER_ID: '123' }, { waitUntil() { scheduled = true; } });
  assert.equal(response.status, 401);
  assert.equal(scheduled, false);
});
test('webhook returns quickly and schedules authenticated Telegram processing', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let task;
  const req = new Request('https://gateway.example/telegram', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'secret' },
    body: JSON.stringify({ message: { from: { id: 999 }, chat: { id: 999, type: 'private' }, text: 'ignore me' } })
  });
  try {
    const res = await gateway.fetch(req, { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_WEBHOOK_SECRET: 'secret', TELEGRAM_OWNER_ID: '123' }, { waitUntil(p) { task = p; } });
    assert.equal(res.status, 200);
    await task;
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = original; }
});
