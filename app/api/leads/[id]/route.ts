import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://54.91.147.151:8000/api/v1';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    console.log('[v0] Fetching lead detail for ID:', id);

    const response = await fetch(`${API_BASE_URL}/leads/${id}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[v0] API error:', response.status, response.statusText);
      return NextResponse.json(
        { error: `Failed to fetch lead: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[v0] Error in lead detail API route:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
