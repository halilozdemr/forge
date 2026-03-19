import { client } from './client';
import { CONFIG } from '../config';

const COMPANY_ID = CONFIG.COMPANY_ID;

export interface Sprint {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'completed';
  startDate?: string;
  endDate?: string;
}

export async function fetchSprints() {
  try {
    const { sprints } = await client.get<{ sprints: Sprint[] }>(`/sprints?companyId=${COMPANY_ID}`);
    return sprints;
  } catch (error) {
    console.error('Failed to fetch sprints:', error);
    return [];
  }
}

export async function createSprint(data: Partial<Sprint>) {
  return client.post('/sprints', { ...data, companyId: COMPANY_ID });
}

export async function updateSprint(id: string, data: Partial<Sprint>) {
  return client.put(`/sprints/${id}`, { ...data, companyId: COMPANY_ID });
}
