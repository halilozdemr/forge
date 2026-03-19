import { client } from './client';
import { agentsStore, Agent } from '../store/store';
import { CONFIG } from '../config';

const COMPANY_ID = CONFIG.COMPANY_ID;

export async function fetchAgents() {
  try {
    const { agents } = await client.get<{ agents: Agent[] }>(`/agents?companyId=${COMPANY_ID}`);
    agentsStore.set(agents);
    return agents;
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return [];
  }
}

export async function hireAgent(data: Partial<Agent>) {
  return client.post('/agents', { ...data, companyId: COMPANY_ID });
}

export async function updateAgent(slug: string, data: Partial<Agent>) {
  return client.put(`/agents/${slug}`, { ...data, companyId: COMPANY_ID });
}

export async function fireAgent(slug: string) {
  return client.delete(`/agents/${slug}?companyId=${COMPANY_ID}`);
}
