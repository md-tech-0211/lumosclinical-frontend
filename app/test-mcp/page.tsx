'use client';

import { useState } from 'react';

export default function TestMCP() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    try {
      const res = await fetch('/api/test-mcp');
      const data = await res.json();
      setResults(data);
    } catch (e: any) {
      setResults({ error: e.message });
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto h-full min-h-0 max-w-4xl overflow-y-auto p-8 font-mono text-sm [scrollbar-gutter:stable]">
      <h1 className="text-2xl font-bold mb-4">MCP Server Connectivity Test</h1>
      <button
        onClick={runTest}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded mb-6 disabled:opacity-50"
      >
        {loading ? 'Testing...' : 'Run Test'}
      </button>
      {results && (
        <pre className="bg-gray-900 text-green-400 p-4 rounded overflow-auto whitespace-pre-wrap">
          {JSON.stringify(results, null, 2)}
        </pre>
      )}
    </div>
  );
}
