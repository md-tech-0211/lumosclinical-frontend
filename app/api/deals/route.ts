import { NextRequest, NextResponse } from 'next/server';

const EXTERNAL_API_BASE = 'http://54.91.147.151:8000/api/v1';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || '1';
    const perPage = searchParams.get('per_page') || '100';
    const sortBy = searchParams.get('sort_by') || 'Modified_Time';
    const sortOrder = searchParams.get('sort_order') || 'desc';

    const url = `${EXTERNAL_API_BASE}/deals/?page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
    console.log('[v0] Deals request URL:', url);

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    console.log('[v0] Deals response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[v0] Deals error:', response.status, errorText);
      // Return empty data structure instead of failing
      return NextResponse.json({
        data: [],
        info: { count: 0, page: parseInt(page), per_page: parseInt(perPage), more_records: false }
      });
    }

    const rawText = await response.text();
    console.log('[v0] Deals raw response length:', rawText.length);
    
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error('[v0] Deals JSON parse error');
      return NextResponse.json({
        data: [],
        info: { count: 0, page: parseInt(page), per_page: parseInt(perPage), more_records: false }
      });
    }

    const dataArray = data?.data || [];
    // The deals API doesn't return info, so we construct it from the data
    const info = data?.info && data.info.count != null ? data.info : {
      count: dataArray.length,
      page: parseInt(page),
      per_page: parseInt(perPage),
      more_records: dataArray.length >= parseInt(perPage),
    };

    console.log('[v0] Deals parsed - items:', dataArray.length, 'info:', info);
    
    return NextResponse.json({ data: dataArray, info });
  } catch (error) {
    console.error('[v0] Deals fetch error:', String(error));
    return NextResponse.json(
      { data: [], info: { count: 0, page: 1, per_page: 100, more_records: false } }
    );
  }
}
