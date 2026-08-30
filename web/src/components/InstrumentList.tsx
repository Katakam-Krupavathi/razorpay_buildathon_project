import React, { useState } from 'react';
import {
  Search,
  CreditCard,
  Building2,
  Smartphone,
  AlertTriangle,
  ExternalLink,
  Activity,
} from 'lucide-react';
import type { InstrumentListItem, InstrumentRail, SparklineDataPoint } from '@recovery/shared';

interface InstrumentListProps {
  instruments: InstrumentListItem[];
  loading: boolean;
  onSelectSubscription: (subscriptionId: string) => void;
}

export const InstrumentList: React.FC<InstrumentListProps> = ({
  instruments,
  loading,
  onSelectSubscription,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [railFilter, setRailFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

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

  const getMandateStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            Active
          </span>
        );
      case 'revoked':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            Revoked
          </span>
        );
      case 'paused':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            Paused
          </span>
        );
      case 'expired':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            Expired
          </span>
        );
      default:
        return <span className="text-xs text-slate-400 font-mono">{status}</span>;
    }
  };

  // Render SVG Sparkline Graph
  const renderSparkline = (points: SparklineDataPoint[], trajectory: string) => {
    if (!points || points.length === 0) {
      return <span className="text-slate-600 text-[10px]">No data</span>;
    }

    const width = 80;
    const height = 24;
    const padding = 2;

    const scores = points.map((p) => Math.max(0, Math.min(1, p.score)));
    const min = 0;
    const max = 1;

    const coords = scores.map((val, idx) => {
      const x = padding + (idx / Math.max(1, scores.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((val - min) / (max - min)) * (height - 2 * padding);
      return `${x},${y}`;
    });

    const strokeColor =
      trajectory === 'HEALTHY'
        ? '#10b981' // emerald
        : trajectory === 'DEGRADING'
        ? '#f59e0b' // amber
        : '#f43f5e'; // rose

    return (
      <div className="flex items-center gap-2">
        <svg width={width} height={height} className="overflow-visible">
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={coords.join(' ')}
          />
        </svg>
      </div>
    );
  };

  const filtered = instruments.filter((item) => {
    if (railFilter !== 'all' && item.rail !== railFilter) return false;
    if (statusFilter !== 'all' && item.mandateStatus !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.subscriptionId.toLowerCase().includes(q) ||
        item.instrumentId.toLowerCase().includes(q) ||
        item.customerId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 backdrop-blur-sm overflow-hidden shadow-xl">
      {/* Header & Controls */}
      <div className="p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Activity className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Payment Instruments & Health Trajectory Sparklines
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time mandate sync state, failure counts, days to expiry, and historical risk scoring trends
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search Sub / Inst..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-blue-500 w-44"
            />
          </div>

          <select
            value={railFilter}
            onChange={(e) => setRailFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Rails</option>
            <option value="card">Cards</option>
            <option value="upi_autopay">UPI Autopay</option>
            <option value="enach">eNACH</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Mandate Statuses</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Directory Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="py-3 px-4">Instrument ID</th>
              <th className="py-3 px-4">Subscription</th>
              <th className="py-3 px-3">Rail</th>
              <th className="py-3 px-3">Mandate Status</th>
              <th className="py-3 px-3">Monthly MRR</th>
              <th className="py-3 px-3 text-center">Failures</th>
              <th className="py-3 px-3">Expiry / Limits</th>
              <th className="py-3 px-4">Health Sparkline (0-100%)</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {loading && instruments.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-500">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    Loading instrument directory...
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-500">
                  No matching payment instruments found.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr
                  key={item.instrumentId}
                  className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                  onClick={() => onSelectSubscription(item.subscriptionId)}
                >
                  <td className="py-3 px-4 font-mono font-bold text-white group-hover:text-blue-400">
                    {item.instrumentId}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-400">
                    {item.subscriptionId}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 capitalize font-medium text-slate-300">
                      {getRailIcon(item.rail)}
                      <span>{item.rail.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {getMandateStatusBadge(item.mandateStatus)}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-200">
                    {formatRupees(item.monthlyAmountPaise)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {item.failureCount > 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        {item.failureCount}
                      </span>
                    ) : (
                      <span className="text-slate-500 font-mono">0</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {item.daysToExpiry !== null ? (
                      item.daysToExpiry <= 20 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          {item.daysToExpiry}d left
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs font-mono">
                          {item.daysToExpiry}d left
                        </span>
                      )
                    ) : (
                      <span className="text-slate-500 text-xs">Perpetual</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {renderSparkline(item.sparkline, item.trajectory)}
                      <span className="text-xs font-mono font-semibold text-slate-300">
                        {Math.round(item.healthScore * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSubscription(item.subscriptionId);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 transition-all cursor-pointer"
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
