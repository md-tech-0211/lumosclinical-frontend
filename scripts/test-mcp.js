const BASE = 'https://zoho-mcp-server-production-aa12.up.railway.app';

async function test(label, url, opts) {
  console.log('\n' + label);
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Content-Type:', res.headers.get('content-type'));
    console.log('Body:', text.substring(0, 500));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

async function main() {
  await test('GET /', BASE + '/');
  await test('GET /sse', BASE + '/sse');
  await test('GET /mcp', BASE + '/mcp');
  await test('GET /health', BASE + '/health');

  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' }
    }
  });
  const hdrs = { 'Content-Type': 'application/json' };

  await test('POST /mcp', BASE + '/mcp', { method: 'POST', headers: hdrs, body: initBody });
  await test('POST /', BASE + '/', { method: 'POST', headers: hdrs, body: initBody });
  await test('POST /sse', BASE + '/sse', { method: 'POST', headers: hdrs, body: initBody });
}

main();
