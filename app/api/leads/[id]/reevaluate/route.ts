import { NextRequest, NextResponse } from 'next/server';

const EXTERNAL_API_BASE = 'http://54.91.147.151:8000/api/v1';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log('[API] Reevaluating lead:', id);
    
    const response = await fetch(`${EXTERNAL_API_BASE}/leads/${id}/reevaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`External API error: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error reevaluating lead:', error);
    return NextResponse.json(
      { error: 'Failed to reevaluate lead' },
      { status: 500 }
    );
  }
}
