import React from 'react';
import {
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  Zap,
  RotateCcw,
  UserCheck,
  PauseCircle,
  IndianRupee,
} from 'lucide-react';
import type { AttributionScorecard } from '@recovery/shared';

interface ScorecardBannerProps {
  scorecard: AttributionScorecard | null;
  loading: boolean;
}

export const ScorecardBanner: React.FC<ScorecardBannerProps> = ({ scorecard, loading }) => {
  const formatRupees = (paise: number = 0) => {
    const rupees = Math.round(paise / 100);
    return `₹${rupees.toLocaleString('en-IN')}`;
  };

  const recoveryRate = scorecard?.recoveryRatePercent ? `${scorecard.recoveryRatePercent.toFixed(1)}%` : '0.0%';
  const scanned = scorecard?.totalSubscriptionsCount ?? 0;
  const arr = formatRupees(scorecard?.totalMonitoredARRPaise);
  const atRisk = formatRupees(scorecard?.totalAtRiskMRRPaise);
  const totalRecovered = formatRupees(scorecard?.totalRecoveredMRRPaise);
  const netSaved = formatRupees(scorecard?.netValueRecoveredPaise);
  const proactive = formatRupees(scorecard?.proactiveRecoveredMRRPaise);
  const reactive = formatRupees(scorecard?.reactiveRecoveredMRRPaise);
  const escalated = `${scorecard?.escalatedSubscriptionsCount ?? 0} Subscriptions`;
  const untouched = formatRupees(scorecard?.untouchedMRRPaise);

  return (
    <section className="space-y-4">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Monitored ARR */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-sm shadow-lg shadow-black/20 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monitored Revenue</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-white tracking-tight">
            {loading ? <span className="animate-pulse text-slate-600">Loading...</span> : arr}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>{scanned} Active Subscriptions</span>
            <span className="font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">100% Hash-Chained</span>
          </div>
        </div>

        {/* At-Risk MRR */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-sm shadow-lg shadow-black/20 hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Monthly Revenue at Risk</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-amber-400 tracking-tight">
            {loading ? <span className="animate-pulse text-slate-600">Loading...</span> : atRisk}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Detected via AI Trajectory Scorer
          </p>
        </div>

        {/* Total Recovered MRR */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 backdrop-blur-sm shadow-lg shadow-emerald-950/20 hover:border-emerald-500/50 transition-all relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Recovered MRR</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-emerald-300 tracking-tight flex items-baseline gap-2">
            {loading ? <span className="animate-pulse text-slate-600">Loading...</span> : totalRecovered}
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">
              {recoveryRate} rate
            </span>
          </div>
          <p className="mt-1 text-xs text-emerald-400/80">
            Automated + Proactive Interventions
          </p>
        </div>

        {/* Net Attributed Revenue Saved */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-950/40 via-slate-900 to-indigo-950/40 border border-blue-500/30 backdrop-blur-sm shadow-lg shadow-blue-950/30 hover:border-blue-500/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-300">Counterfactual Net Saved</span>
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-400/30">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-blue-200 tracking-tight">
            {loading ? <span className="animate-pulse text-slate-600">Loading...</span> : netSaved}
          </div>
          <p className="mt-1 text-xs text-blue-300/80">
            Net of Baseline Churn Discounts
          </p>
        </div>
      </div>

      {/* Secondary Granular Rollup Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
          <div className="p-1 rounded bg-teal-500/10 text-teal-400">
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Proactive Pre-Expiry Saves</div>
            <div className="font-bold text-teal-300 text-sm">{proactive}</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
          <div className="p-1 rounded bg-indigo-500/10 text-indigo-400">
            <RotateCcw className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Reactive Smart Retries</div>
            <div className="font-bold text-indigo-300 text-sm">{reactive}</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
          <div className="p-1 rounded bg-purple-500/10 text-purple-400">
            <UserCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Escalated to Ops Queue</div>
            <div className="font-bold text-purple-300 text-sm">{escalated}</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
          <div className="p-1 rounded bg-slate-700/20 text-slate-400">
            <PauseCircle className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-slate-400 text-[11px]">Untouched / Grace Holds</div>
            <div className="font-bold text-slate-300 text-sm">{untouched}</div>
          </div>
        </div>
      </div>
    </section>
  );
};
