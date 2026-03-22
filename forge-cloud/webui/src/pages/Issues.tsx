import { useState, useEffect, useContext } from 'react';
import { api } from '../api';
import { Circle, CheckCircle2, CircleDashed } from 'lucide-react';
import { CompanyContext } from '../App';

export default function IssuesPage() {
  const { companyId } = useContext(CompanyContext);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (companyId) {
      api.getIssues(companyId).then(res => { setIssues(res.issues); setLoading(false); }).catch(() => setLoading(false));
    }
  }, [companyId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 className="text-green-500" size={18} />;
      case 'in_progress': return <CircleDashed className="text-orange-400 animate-[spin_3s_linear_infinite]" size={18} />;
      default: return <Circle className="text-slate-400" size={18} />;
    }
  };

  if (loading) return <div className="animate-pulse h-64 bg-slate-800 rounded-xl"></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Issues</h1>
        <p className="text-slate-400">All synchronized tasks and features from your local instance.</p>
      </div>

      <div className="bg-slate-800 border border-slate-700/50 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/50 text-xs uppercase text-slate-400 border-b border-slate-700/80">
              <tr>
                <th className="px-6 py-4 font-semibold">Title</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Priority</th>
                <th className="px-6 py-4 font-semibold">Assigned</th>
                <th className="px-6 py-4 font-semibold text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {issues.map(issue => (
                <tr key={issue.issueId} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4 font-medium text-white max-w-md truncate">
                    {issue.title}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 capitalize">
                      {getStatusIcon(issue.status)}
                      <span className={issue.status === 'done' ? 'text-slate-400' : 'text-slate-200'}>
                        {issue.status.replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                      issue.priority === 'high' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                      'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {issue.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {issue.assignedAgentSlug ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">
                         @{issue.assignedAgentSlug}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-xs text-slate-500">
                    {new Date(issue.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    No issues synced yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
