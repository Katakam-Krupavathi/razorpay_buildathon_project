import React, { useState } from 'react';
import {
  TrendingUp,
  ArrowUpDown,
  Search,
  ExternalLink,
  CreditCard,
  Building2,
  Smartphone,
} from 'lucide-react';
import type { OpportunityQueueItem, InstrumentRail, TrajectoryType } from '@recovery/shared';

interface OpportunityQueueProps {
  opportunities: OpportunityQueueItem[];
  loading: boolean;
  onSelectSubscription: (subscriptionId: string) => void;
}

export const OpportunityQueue: React.FC<OpportunityQueueProps> = ({
  opportunities,
  loading,
  onSelectSubscription,
}) => {
  const [railFilter, setRailFilter] = useState<string>('all');
  const [trajectoryFilter, setTrajectoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'erv' | 'amount' | 'health'>('erv');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const formatRupees = (paise: number = 0) => {
    return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
  };

  const getRailIcon = (rail: InstrumentRail) => {
    switch (rail) {
      case 'card':
        return <CreditCard className="w-3.5 h-3.5 text-blue-400" />;
      case 'upi_autopay':
        return <Smartphone className="w-3.5 h-3.5 text-emerald-400" />;
      case 'enach':
        return <Building2 className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <CreditCard className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getTrajectoryBadge = (trajectory: TrajectoryType, score: number) => {
    const scorePct = `${Math.round(score * 100)}%`;
    switch (trajectory) {
      case 'HEALTHY':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Healthy ({scorePct})
          </span>
        );
      case 'DEGRADING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Degrading ({scorePct})
          </span>
        );
      case 'TERMINAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Terminal ({scorePct})
          </span>
        );
      default:
        return <span className="text-xs text-slate-400 font-mono">{scorePct}</span>;
    }
  };

  const getActionBadge = (action: string) => {
    let color = 'bg-slate-800 text-slate-300 border-slate-700';
    if (action.includes('retry') || action === 'retry') {
      color = 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
    } else if (action.includes('nudge') || action === 'proactive_nudge') {
      color = 'bg-teal-500/10 text-teal-300 border-teal-500/30';
    } else if (action.includes('pause') || action === 'grace_period') {
      color = 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    } else if (action.includes('escalate') || action === 'escalate_ops') {
      color = 'bg-purple-500/10 text-purple-300 border-purple-500/30';
    }
    return (
      <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${color}`}>
        {action.replace(/_/g, ' ')}
      </span>
    );
  };

  // Filter & Search
  const filtered = opportunities.filter((item) => {
    if (railFilter !== 'all' && item.rail !== railFilter) return false;
    if (trajectoryFilter !== 'all' && item.trajectory !== trajectoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.subscriptionId.toLowerCase().includes(q) ||
        item.instrumentId.toLowerCase().includes(q) ||
        item.rootCause.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'erv') {
      comparison = b.expectedRecoveryValuePaise - a.expectedRecoveryValuePaise;
    } else if (sortBy === 'amount') {
      comparison = b.monthlyAmountPaise - a.monthlyAmountPaise;
    } else if (sortBy === 'health') {
      comparison = a.healthScore - b.healthScore;
    }
    return sortDirection === 'desc' ? comparison : -comparison;
  });

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 backdrop-blur-sm overflow-hidden shadow-xl">
      {/* Header & Controls */}
      <div className="p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Top Recovery Opportunities (Opportunity Queue)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Ranked dynamically by Expected Recovery Value (ERV) = At-Risk Amount × Recovery Probability
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search Sub / Inst..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500 w-44"
            />
          </div>

          {/* Rail Filter */}
          <select
            value={railFilter}
            onChange={(e) => setRailFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Payment Rails</option>
            <option value="card">Cards</option>
            <option value="upi_autopay">UPI Autopay</option>
            <option value="enach">eNACH</option>
          </select>

          {/* Trajectory Filter */}
          <select
            value={trajectoryFilter}
            onChange={(e) => setTrajectoryFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Trajectories</option>
            <option value="DEGRADING">Degrading</option>
            <option value="TERMINAL">Terminal</option>
            <option value="HEALTHY">Healthy</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="py-3 px-4 w-12 text-center">Rank</th>
              <th className="py-3 px-4">Subscription & Instrument</th>
              <th className="py-3 px-3">Rail</th>
              <th className="py-3 px-3">Health Trajectory</th>
              <th className="py-3 px-3">Root Cause Diagnosis</th>
              <th className="py-3 px-4 cursor-pointer hover:text-white" onClick={() => { setSortBy('amount'); setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc'); }}>
                <div className="flex items-center gap-1">
                  <span>At-Risk / Mo</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-4 cursor-pointer hover:text-white" onClick={() => { setSortBy('erv'); setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc'); }}>
                <div className="flex items-center gap-1 text-emerald-400">
                  <span>Expected Recovery (ERV)</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="py-3 px-3">AI Action</th>
              <th className="py-3 px-4 text-right">Audit Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {loading && opportunities.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-500">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    Loading opportunity queue...
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-500">
                  No matching recovery opportunities found.
                </td>
              </tr>
            ) : (
              filtered.map((item, idx) => (
                <tr
                  key={item.instrumentId}
                  className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                  onClick={() => onSelectSubscription(item.subscriptionId)}
                >
                  <td className="py-3 px-4 text-center font-mono text-slate-500 font-bold group-hover:text-indigo-400">
                    #{idx + 1}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-white font-mono">{item.subscriptionId}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{item.instrumentId}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 capitalize font-medium text-slate-300">
                      {getRailIcon(item.rail)}
                      <span>{item.rail.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {getTrajectoryBadge(item.trajectory, item.healthScore)}
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {item.rootCause}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-200">
                    {formatRupees(item.monthlyAmountPaise)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-bold text-emerald-400 text-sm">
                      {formatRupees(item.expectedRecoveryValuePaise)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {Math.round(item.recoveryProbability * 100)}% recovery prob
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {getActionBadge(item.recommendedAction)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSubscription(item.subscriptionId);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 transition-all cursor-pointer"
                    >
                      <span>Trace</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
