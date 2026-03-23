import { healthStore, HealthStatus } from '../store/store';

export async function fetchHealth() {
  try {
    const res = await fetch('/health', { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    const data: HealthStatus = await res.json();
    if (!data || !data.components) {
      throw new Error('Invalid health status data');
    }
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
