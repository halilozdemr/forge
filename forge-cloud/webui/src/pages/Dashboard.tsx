import { useState, useEffect } from 'react';
import { api } from '../api';
import { Users, CheckSquare, RefreshCw, DollarSign, Activity } from 'lucide-react';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSummary()
       .then(res => { setData(res); setLoading(false); })
       .catch(err => { console.error(err); setLoading(false); });
  }, []);

  if (loading) return <div className="animate-pulse flex space-x-4"><div className="flex-1 space-y-6 py-1"><div className="h-2 bg-slate-700 rounded"></div><div className="space-y-3"><div className="grid grid-cols-3 gap-4"><div className="h-2 bg-slate-700 rounded col-span-1"></div></div></div></div></div>;
  if (!data) return <div className="text-red-400">Failed to load payload</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Overview</h1>
        <p className="text-slate-400">A top-level summary of your local Forge instance across all modules.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Agents Card */}
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-slate-400 font-medium">Agents</h3>
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg"><Users size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">{data.agents.total}</div>
          <div className="flex gap-3 text-sm mt-4">
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              {data.agents.running} running
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-500"></span>
              {data.agents.idle} idle
            </span>
          </div>
        </div>

        {/* Issues Card */}
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-slate-400 font-medium">Issues</h3>
            <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg"><CheckSquare size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">{data.issues.open + data.issues.inProgress + data.issues.done}</div>
          <div className="flex gap-3 text-sm mt-4">
            <span className="flex items-center gap-1 text-orange-400">
              {data.issues.inProgress} active
            </span>
            <span className="flex items-center gap-1 text-blue-400">
              {data.issues.open} open
            </span>
          </div>
        </div>

        {/* Sprint Card */}
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-slate-400 font-medium">Active Sprint</h3>
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg"><RefreshCw size={20} /></div>
          </div>
          {data.activeSprint ? (
            <>
              <div className="text-3xl font-bold text-white mb-2">Sprint {data.activeSprint.number}</div>
              <p className="text-sm text-slate-400 line-clamp-2">{data.activeSprint.goal}</p>
            </>
          ) : (
            <div className="text-slate-500 pt-2">No active sprint</div>
          )}
        </div>

        {/* Budget Card */}
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-6 shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-slate-400 font-medium">Budget ({data.budget.month})</h3>
            <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg"><DollarSign size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">${data.budget.totalUsd.toFixed(2)}</div>
          <div className="text-sm text-slate-400 mt-4 flex items-center gap-1">
            <Activity size={14} className="text-rose-400" /> API usage this month
          </div>
        </div>
      </div>
    </div>
  );
}
