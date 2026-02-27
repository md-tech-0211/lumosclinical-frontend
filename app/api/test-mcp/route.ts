import { NextResponse } from 'next/server';

const BASE = 'https://monday-mpc-server.vercel.app';

async function probe(label: string, url: string, opts?: RequestInit) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    return {
      label,
      status: res.status,
      contentType: res.headers.get('content-type'),
      body: text.substring(0, 500),
    };
  } catch (e: any) {
    return { label, error: e.message };
  }
}

export async function GET() {
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    },
  });
  const hdrs = { 'Content-Type': 'application/json' };

  const results = await Promise.all([
    probe('GET /', BASE + '/'),
    probe('GET /sse', BASE + '/sse'),
    probe('GET /mcp', BASE + '/mcp'),
    probe('GET /health', BASE + '/health'),
    probe('POST /mcp', BASE + '/mcp', { method: 'POST', headers: hdrs, body: initBody }),
    probe('POST /', BASE + '/', { method: 'POST', headers: hdrs, body: initBody }),
    probe('POST /sse', BASE + '/sse', { method: 'POST', headers: hdrs, body: initBody }),
  ]);

  return NextResponse.json(results, { status: 200 });
}
