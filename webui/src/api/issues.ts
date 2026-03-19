import { client } from './client';
import { issuesStore, Issue } from '../store/store';
import { CONFIG } from '../config';

const COMPANY_ID = CONFIG.COMPANY_ID;

export async function fetchIssues() {
  try {
    const { issues } = await client.get<{ issues: Issue[] }>(`/issues?companyId=${COMPANY_ID}`);
    issuesStore.set(issues);
    return issues;
  } catch (error) {
    console.error('Failed to fetch issues:', error);
    return [];
  }
}

export async function createIssue(data: Partial<Issue>) {
  return client.post('/issues', { ...data, companyId: COMPANY_ID });
}

export async function updateIssue(id: string, data: Partial<Issue>) {
  return client.put(`/issues/${id}`, { ...data, companyId: COMPANY_ID });
}
