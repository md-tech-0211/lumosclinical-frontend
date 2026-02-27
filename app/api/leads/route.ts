import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://54.91.147.151:8000/api/v1';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = searchParams.get('page') || '1';
    const perPage = searchParams.get('per_page') || '100';
    const sortBy = searchParams.get('sort_by') || 'Modified_Time';
    const sortOrder = searchParams.get('sort_order') || 'desc';

    const url = `${API_BASE_URL}/leads?page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
    
    console.log('[v0] Leads request:', url);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    console.log('[v0] Leads response:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[v0] Leads error:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to fetch leads: ${response.statusText}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[v0] Leads loaded:', data?.data?.length || 0, 'items, info:', JSON.stringify(data?.info));

    return NextResponse.json(data);
  } catch (error) {
    console.error('[v0] Leads error:', String(error));
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
