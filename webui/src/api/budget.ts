import { client } from './client';
import { CONFIG } from '../config';

const COMPANY_ID = CONFIG.COMPANY_ID;

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
    const { usage } = await client.get<{ usage: BudgetUsage }>(`/budget/usage?companyId=${COMPANY_ID}`);
    return usage;
  } catch (error) {
    console.error('Failed to fetch budget usage:', error);
    return null;
  }
}

export async function fetchBudgetPolicies() {
  try {
    const { policies } = await client.get<{ policies: BudgetPolicy[] }>(`/budget/policies?companyId=${COMPANY_ID}`);
    return policies;
  } catch (error) {
    console.error('Failed to fetch budget policies:', error);
    return [];
  }
}

export async function createBudgetPolicy(data: Partial<BudgetPolicy>) {
  return client.post('/budget/policies', { ...data, companyId: COMPANY_ID });
}
