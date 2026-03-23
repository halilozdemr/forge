import { client } from './client';
import { getCachedCompanyId } from './context';

export interface Sprint {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'completed';
  startDate?: string;
  endDate?: string;
}

export async function fetchSprints() {
  try {
    const companyId = getCachedCompanyId();
    const { sprints } = await client.get<{ sprints: Sprint[] }>(`/sprints?companyId=${companyId}`);
    return sprints;
  } catch (error) {
    console.error('Failed to fetch sprints:', error);
    return [];
  }
}

export async function createSprint(data: Partial<Sprint>) {
  return client.post('/sprints', { ...data, companyId: getCachedCompanyId() });
}

export async function updateSprint(id: string, data: Partial<Sprint>) {
  return client.put(`/sprints/${id}`, { ...data, companyId: getCachedCompanyId() });
}
