import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, CheckSquare, RefreshCw, DollarSign, LogOut } from 'lucide-react';
import React, { createContext, useState, useEffect } from 'react';
import { api } from './api';

export const CompanyContext = createContext<{ companyId: string | null }>({ companyId: null });

// Pages
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AgentsPage from './pages/Agents';
import IssuesPage from './pages/Issues';
import SprintsPage from './pages/Sprints';
import BudgetPage from './pages/Budget';

const SidebarLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navItems = [
    { name: 'Summary', path: '/', icon: <LayoutDashboard size={20} /> },
    { name: 'Agents', path: '/agents', icon: <Users size={20} /> },
    { name: 'Issues', path: '/issues', icon: <CheckSquare size={20} /> },
    { name: 'Sprints', path: '/sprints', icon: <RefreshCw size={20} /> },
    { name: 'Budget', path: '/budget', icon: <DollarSign size={20} /> },
  ];

  const handleLogout = () => {
    localStorage.removeItem('forge_cloud_token');
    window.location.href = '/login';
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-50 font-sans">
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col hide-scrollbar">
        <div className="p-6 text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>🔥</span> Forge Cloud
        </div>
        <nav className="flex-1 px-4 space-y-1 mt-2">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path} 
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive ? 'bg-blue-600 font-medium text-white shadow-md shadow-blue-500/20' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}
              >
                {item.icon}
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-700/50">
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-slate-400 hover:bg-slate-700/50 hover:text-red-400 transition-colors">
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8 relative">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const hasToken = !!localStorage.getItem('forge_cloud_token');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (hasToken) {
      api.getCompanies()
        .then(res => {
          if (res.companies && res.companies.length > 0) {
            setCompanyId(res.companies[0].id);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [hasToken]);

  if (!hasToken) return <Navigate to="/login" replace />;
  
  if (loading) {
    return <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading company...</div>;
  }

  if (!companyId) {
    return <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">No company found. Please run forge init.</div>;
  }

  return (
    <CompanyContext.Provider value={{ companyId }}>
      <SidebarLayout>{children}</SidebarLayout>
    </CompanyContext.Provider>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/agents" element={<ProtectedRoute><AgentsPage /></ProtectedRoute>} />
        <Route path="/issues" element={<ProtectedRoute><IssuesPage /></ProtectedRoute>} />
        <Route path="/sprints" element={<ProtectedRoute><SprintsPage /></ProtectedRoute>} />
        <Route path="/budget" element={<ProtectedRoute><BudgetPage /></ProtectedRoute>} />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
