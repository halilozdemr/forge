import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { RefreshCw, Calendar, Target } from 'lucide-react';
import { CompanyContext } from '../App';

export default function SprintsPage() {
  const { companyId } = useContext(CompanyContext);
  const [sprints, setSprints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (companyId) {
      api.getSprints(companyId).then(res => { setSprints(res.sprints); setLoading(false); }).catch(() => setLoading(false));
    }
  }, [companyId]);

  if (loading) return <div className="animate-pulse h-64 bg-slate-800 rounded-xl"></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Sprints</h1>
        <p className="text-slate-400">Your AI development cycles and their goals.</p>
      </div>

      <div className="space-y-4">
        {sprints.map(sprint => (
          <div key={sprint.sprintId} className={`bg-slate-800 border ${sprint.status === 'active' ? 'border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-slate-700/50'} rounded-xl p-6 transition-all hover:border-slate-600`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${sprint.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-700/50 text-slate-400'}`}>
                  <RefreshCw size={24} className={sprint.status === 'active' ? 'animate-[spin_4s_linear_infinite]' : ''} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    Sprint {sprint.number}
                    {sprint.status === 'active' && (
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-emerald-500 text-white shadow-sm">Active</span>
                    )}
                  </h3>
                  <div className="flex gap-4 text-xs text-slate-400 mt-1">
                    {sprint.startedAt && (
                      <span className="flex items-center gap-1"><Calendar size={12}/> Started: {new Date(sprint.startedAt).toLocaleDateString()}</span>
                    )}
                    {sprint.closedAt && (
                      <span className="flex items-center gap-1"><Calendar size={12}/> Closed: {new Date(sprint.closedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
              <span className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${
                sprint.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                sprint.status === 'planning' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                'bg-slate-500/10 text-slate-400 border-slate-500/20'
              }`}>
                {sprint.status}
              </span>
            </div>
            
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 flex gap-3">
              <Target className="text-indigo-400 shrink-0 mt-0.5" size={18} />
              <div>
                <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Sprint Goal</h4>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{sprint.goal || 'No specific goal defined.'}</p>
              </div>
            </div>
          </div>
        ))}
        {sprints.length === 0 && (
          <div className="py-16 text-center text-slate-500 bg-slate-800/30 rounded-2xl border border-dashed border-slate-700">
            <div className="text-4xl mb-3">🏃</div>
            <p className="text-lg text-slate-400 font-medium">No sprints found</p>
            <p className="text-sm mt-1">Sync your local Forge instance to begin tracking sprints.</p>
          </div>
        )}
      </div>
    </div>
  );
}
