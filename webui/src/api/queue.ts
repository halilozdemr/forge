import { client } from './client';

export interface Job {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'failed' | 'delayed' | 'waiting';
  progress: number;
  data: any;
  returnValue: any;
  failedReason?: string;
  processedOn?: number;
  finishedOn?: number;
  timestamp: number;
}

export async function fetchQueueJobs() {
  try {
    const { jobs } = await client.get<{ jobs: Job[] }>('/queue/jobs');
    return jobs;
  } catch (error) {
    console.error('Failed to fetch queue jobs:', error);
    return [];
  }
}

export async function fetchJobDetails(id: string) {
  try {
    return await client.get<Job>(`/queue/jobs/${id}`);
  } catch (error) {
    console.error(`Failed to fetch job ${id}:`, error);
    return null;
  }
}
