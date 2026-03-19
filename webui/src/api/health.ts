import { client } from './client';
import { healthStore, HealthStatus } from '../store/store';

export async function fetchHealth() {
  try {
    const data = await client.get<HealthStatus>('/health');
    healthStore.set(data);
  } catch (error) {
    console.error('Failed to fetch health:', error);
    healthStore.set({
      status: 'down',
      components: { db: false, redis: false, worker: false }
    });
  }
}

let healthInterval: number | null = null;

export function startHealthPolling(intervalMs = 10000) {
  if (healthInterval) return;
  
  fetchHealth();
  healthInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchHealth();
    }
  }, intervalMs);
}

export function stopHealthPolling() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
