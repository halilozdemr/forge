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
  
  getCompanies: () => fetchWithAuth('/v1/companies'),
  
  getSummary: (companyId: string) => fetchWithAuth(`/v1/status?companyId=${companyId}`),
  getAgents: (companyId: string) => fetchWithAuth(`/v1/agents?companyId=${companyId}`),
  getIssues: (companyId: string) => fetchWithAuth(`/v1/issues?companyId=${companyId}`),
  getSprints: (companyId: string) => fetchWithAuth(`/v1/sprints?companyId=${companyId}`),
  getBudget: (companyId: string) => fetchWithAuth(`/v1/budget/usage?companyId=${companyId}`),
}
