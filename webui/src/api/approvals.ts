import { client } from './client';
import { getCachedCompanyId } from './context';

export interface ApprovalItem {
  id: string;
  type: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  reviewedAt: string | null;
  metadata: Record<string, unknown>;
  description: string;
}

export async function fetchApprovalInbox(status = 'pending'): Promise<ApprovalItem[]> {
  const companyId = getCachedCompanyId();
  const { approvals } = await client.get<{ approvals: ApprovalItem[] }>(
    `/approvals/inbox?companyId=${companyId}&status=${status}`,
  );
  return approvals;
}

export async function approveApproval(id: string): Promise<void> {
  await client.post(`/approvals/${id}/approve`, {});
}

export async function rejectApproval(id: string, reason?: string): Promise<void> {
  await client.post(`/approvals/${id}/reject`, { reason });
}
