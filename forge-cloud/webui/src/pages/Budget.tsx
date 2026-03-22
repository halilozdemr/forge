import { useState, useEffect } from 'react';
import { api } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function BudgetPage() {
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBudget().then(res => { setBudget(res); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="animate-pulse h-64 bg-slate-800 rounded-xl"></div>;

  const chartData = [
    {
      name: budget?.month || 'Current',
      cost: budget?.totalUsd || 0,
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Budget Tracking</h1>
        <p className="text-slate-400">Monitor your AI API consumption running on your local machine.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 border border-slate-700/50 bg-slate-800 rounded-xl p-6 shadow-sm relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-40 h-40 bg-rose-500/10 rounded-bl-full -mr-10 -mt-10 transition-transform group-hover:scale-110"></div>
           <h3 className="text-slate-400 font-medium mb-2">Total Usage ({budget?.month})</h3>
           <div className="text-5xl font-bold text-white tracking-tight mb-2">
             ${(budget?.totalUsd || 0).toFixed(2)}
           </div>
           <p className="text-sm text-slate-500 flex items-center gap-1">
             Last synced: {budget?.lastUpdated ? new Date(budget.lastUpdated).toLocaleString() : 'Never'}
           </p>
        </div>
        
        <div className="col-span-1 lg:col-span-2 border border-slate-700/50 bg-slate-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-slate-200 font-medium mb-6">Monthly Expenditure</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
                <Tooltip 
                  cursor={{ fill: '#334155', opacity: 0.4 }}
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', borderRadius: '8px' }}
                  itemStyle={{ color: '#f8fafc', fontWeight: 'bold' }}
                />
                <Bar dataKey="cost" name="Cost USD" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
