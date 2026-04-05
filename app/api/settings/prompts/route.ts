import { NextRequest, NextResponse } from 'next/server';
import { getBackendApiBase } from '@/lib/server/backend-api-base';

const EXTERNAL_API_BASE = getBackendApiBase();

export async function GET() {
  try {
    const response = await fetch(`${EXTERNAL_API_BASE}/settings/prompts`, {
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
    console.error('[API] Error fetching prompt settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prompt settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${EXTERNAL_API_BASE}/settings/prompts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`External API error: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error saving prompt settings:', error);
    return NextResponse.json(
      { error: 'Failed to save prompt settings' },
      { status: 500 }
    );
  }
}
