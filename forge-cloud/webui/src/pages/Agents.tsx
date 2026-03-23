import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { Settings } from 'lucide-react';
import { CompanyContext } from '../App';

export default function AgentsPage() {
  const { companyId } = useContext(CompanyContext);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (companyId) {
      api.getAgents(companyId).then(res => { setAgents(res.agents); setLoading(false); }).catch(() => setLoading(false));
    }
  }, [companyId]);

  if (loading) return <div className="animate-pulse h-32 bg-slate-800 rounded-xl"></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Agents</h1>
        <p className="text-slate-400">View your local AI agents' state synced to the cloud.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {agents.map(agent => (
          <div key={agent.agentId} className="bg-slate-800 border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col transition-all hover:border-slate-600">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-lg border border-blue-500/20">
                  {agent.name.charAt(0)}
                </div>
              </div>
              {agent.role}
            </div>
            
            <div className="flex gap-2 pt-4 border-t border-slate-700/50 mt-auto">
               <button className="flex-1 py-2 flex items-center justify-center gap-2 text-sm bg-slate-700/30 hover:bg-slate-700/80 text-white rounded-lg transition-colors" disabled>
                 <Settings size={14} /> Read-only Config
               </button>
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <div className="col-span-full py-16 text-center text-slate-500 bg-slate-800/30 rounded-2xl border border-dashed border-slate-700">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-lg text-slate-400 font-medium">No agents found</p>
            <p className="text-sm mt-1">Make sure your local Forge instance is syncing data.</p>
          </div>
        )}
      </div>
    </div>
  );
}
