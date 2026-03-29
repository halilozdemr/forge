import { client } from './client';
import { getCachedCompanyId } from './context';

export interface BudgetUsage {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  month: string;
}

export interface BudgetPolicy {
  id: string;
  companyId: string;
  monthlyLimit: number;
  alertThreshold: number;
  createdAt: string;
}

export async function fetchBudgetUsage() {
  try {
    const companyId = getCachedCompanyId();
    const { usage } = await client.get<{ usage: BudgetUsage }>(`/budget/usage?companyId=${companyId}`);
    return usage;
  } catch (error) {
    console.error('Failed to fetch budget usage:', error);
    return null;
  }
}

export async function fetchBudgetPolicies() {
  try {
    const companyId = getCachedCompanyId();
    const { policies } = await client.get<{ policies: BudgetPolicy[] }>(`/budget/policies?companyId=${companyId}`);
    return policies;
  } catch (error) {
    console.error('Failed to fetch budget policies:', error);
    return [];
  }
}
