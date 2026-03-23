import { client } from './client';
import { issuesStore, Issue } from '../store/store';
import { getCachedCompanyId, getCachedProjectId } from './context';

export async function fetchIssues() {
  try {
    const companyId = getCachedCompanyId();
    const { issues } = await client.get<{ issues: Issue[] }>(`/issues?companyId=${companyId}`);
    issuesStore.set(issues);
    return issues;
  } catch (error) {
    console.error('Failed to fetch issues:', error);
    return [];
  }
}

export async function createIssue(data: Partial<Issue>) {
  return client.post('/issues', { ...data, companyId: getCachedCompanyId(), projectId: getCachedProjectId() });
}

export async function updateIssue(id: string, data: Partial<Issue>) {
  return client.put(`/issues/${id}`, { ...data, companyId: getCachedCompanyId() });
}
