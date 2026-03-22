export const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('forge_cloud_token');
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  
  if (res.status === 401 && endpoint !== '/auth/login') {
    localStorage.removeItem('forge_cloud_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  
  if (!res.ok) {
    let msg = 'API Error';
    try {
      const errRes = await res.json();
      msg = errRes.error || msg;
    } catch (e) {}
    throw new Error(msg);
  }
  
  return res.json();
}

export const api = {
  login: async (data: any) => {
    const res = await fetch('/auth/login', { 
      method: 'POST', 
      body: JSON.stringify(data), 
      headers: { 'Content-Type': 'application/json' } 
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Login failed');
    return json;
  },
  
  getSummary: () => fetchWithAuth('/dashboard/summary'),
  getAgents: () => fetchWithAuth('/dashboard/agents'),
  getIssues: () => fetchWithAuth('/dashboard/issues'),
  getSprints: () => fetchWithAuth('/dashboard/sprints'),
  getBudget: () => fetchWithAuth('/dashboard/budget'),
}
