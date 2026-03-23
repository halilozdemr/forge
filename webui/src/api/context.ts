import { client } from './client';

interface AppContext {
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
}

let cached: AppContext | null = null;

export async function getAppContext(): Promise<AppContext> {
  if (cached) return cached;
  try {
    cached = await client.get<AppContext>('/context');
    return cached;
  } catch (error) {
    console.error('Failed to fetch app context:', error);
    return { companyId: null, companyName: null, projectId: null, projectName: null };
  }
}

export function getCachedCompanyId(): string {
  return cached?.companyId ?? '';
}

export function getCachedProjectId(): string {
  return cached?.projectId ?? '';
}
