import { client } from './client';
import { agentsStore, Agent } from '../store/store';
import { getCachedCompanyId } from './context';

export async function fetchAgents() {
  try {
    const companyId = getCachedCompanyId();
    const { agents } = await client.get<{ agents: Agent[] }>(`/agents?companyId=${companyId}`);
    agentsStore.set(agents);
    return agents;
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return [];
  }
}

export async function hireAgent(data: Partial<Agent>) {
  return client.post('/agents', { ...data, companyId: getCachedCompanyId() });
}

export async function updateAgent(slug: string, data: Partial<Agent>) {
  return client.put(`/agents/${slug}`, { ...data, companyId: getCachedCompanyId() });
}

export async function fireAgent(slug: string) {
  return client.delete(`/agents/${slug}?companyId=${getCachedCompanyId()}`);
}
