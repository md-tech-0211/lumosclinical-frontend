import { LeadsResponse, LeadDetailResponse } from '@/types/lead';

// Use Next.js API routes to avoid CORS issues
const API_BASE_URL = '/api';

export async function fetchLeads(page: number = 1, perPage: number = 100): Promise<LeadsResponse> {
  try {
    console.log('[v0] Fetching leads, page:', page);
    const response = await fetch(
      `${API_BASE_URL}/leads?page=${page}&per_page=${perPage}&sort_by=Modified_Time&sort_order=desc`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[v0] Error fetching leads:', response.status, errorData);
      throw new Error(`Failed to fetch leads: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[v0] Leads fetched successfully:', data?.data?.length || 0, 'leads');
    return data;
  } catch (error) {
    console.error('[v0] Error fetching leads:', error);
    throw error;
  }
}

export async function fetchLeadById(id: string): Promise<LeadDetailResponse> {
  try {
    console.log('[v0] Fetching lead by ID:', id);
    const response = await fetch(`${API_BASE_URL}/leads/${id}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[v0] Error fetching lead:', response.status, errorData);
      throw new Error(`Failed to fetch lead: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[v0] Lead fetched successfully:', id);
    return data;
  } catch (error) {
    console.error('[v0] Error fetching lead by ID:', error);
    throw error;
  }
}

export async function reevaluateLead(id: string): Promise<LeadDetailResponse> {
  try {
    console.log('[v0] Reevaluating lead:', id);
    const response = await fetch(`${API_BASE_URL}/leads/${id}/reevaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[v0] Error reevaluating lead:', response.status, errorData);
      throw new Error(`Failed to reevaluate lead: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[v0] Lead reevaluated successfully:', id);
    return data;
  } catch (error) {
    console.error('[v0] Error reevaluating lead:', error);
    throw error;
  }
}

export async function fetchDeals(page: number = 1, perPage: number = 100): Promise<LeadsResponse> {
  try {
    const url = `${API_BASE_URL}/deals?page=${page}&per_page=${perPage}&sort_by=Modified_Time&sort_order=desc`;
    console.log('[v0] Fetching deals:', url);
    
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch deals: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[v0] Deals fetched:', data?.data?.length || 0, 'items');
    
    return data;
  } catch (error) {
    console.error('[v0] Deals error:', error);
    throw error;
  }
}

export async function fetchDealById(id: string): Promise<LeadDetailResponse> {
  try {
    console.log('[v0] Fetching deal by ID:', id);
    const response = await fetch(`${API_BASE_URL}/deals/${id}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[v0] Error fetching deal:', response.status, errorData);
      throw new Error(`Failed to fetch deal: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[v0] Deal fetched successfully:', id);
    return data;
  } catch (error) {
    console.error('[v0] Error fetching deal by ID:', error);
    throw error;
  }
}
