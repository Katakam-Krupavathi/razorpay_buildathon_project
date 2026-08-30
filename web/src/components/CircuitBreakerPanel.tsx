import React, { useState } from 'react';
import {
  Lock,
  AlertOctagon,
  ShieldCheck,
  RotateCcw,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import type { CircuitBreakerStatus } from '@recovery/shared';

interface CircuitBreakerPanelProps {
  cohorts: CircuitBreakerStatus[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
}

export const CircuitBreakerPanel: React.FC<CircuitBreakerPanelProps> = ({
  cohorts,
  loading: _loading,
  onRefresh,
}) => {
  const [resettingCohort, setResettingCohort] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleReset = async (cohortKey: string) => {
    setResettingCohort(cohortKey);
    setActionMessage(null);
    try {
      const res = await fetch('/api/circuit-breaker/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohortKey,
          resetBy: 'control_plane_admin',
          reason: 'Manual operator reset from Web UI Command Center',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Circuit breaker for '${cohortKey}' reset to CLOSED successfully.`);
        await onRefresh();
      } else {
        setActionMessage(`Reset failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error resetting breaker';
      setActionMessage(`Network error: ${msg}`);
    } finally {
      setResettingCohort(null);
    }
  };

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 backdrop-blur-sm overflow-hidden shadow-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Cohort Circuit Breakers & Safety Invariants
            </h2>
            <p className="text-xs text-slate-400">
              Rolling window ($N=20$) recovery success rate monitor with automated trips and human operator manual reset
            </p>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionMessage}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="font-bold hover:text-white">✕</button>
        </div>
      )}

      {/* Cohort Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cohorts.map((cohort) => {
          const isOpen = cohort.state === 'OPEN';
          const successRatePct = Math.round(cohort.currentSuccessRate * 100);
          const thresholdPct = 40; // 40% hard safety threshold

          return (
            <div
              key={cohort.cohortKey}
              className={`p-4 rounded-xl border transition-all ${
                isOpen
                  ? 'bg-rose-950/20 border-rose-500/40 shadow-lg shadow-rose-950/20'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Cohort Header */}
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-sm text-white capitalize">
                  {cohort.cohortKey.replace('rail:', '')} Cohort
                </span>
                {isOpen ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse">
                    <AlertOctagon className="w-3 h-3" />
                    TRIPPED (OPEN)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    <ShieldCheck className="w-3 h-3" />
                    OPERATIONAL (CLOSED)
                  </span>
                )}
              </div>

              {/* Success Rate Meter */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-400">Rolling Success Rate</span>
                  <span className={isOpen ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {successRatePct}%
                  </span>
                </div>

                {/* Progress bar with threshold marker */}
                <div className="relative w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isOpen ? 'bg-rose-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, successRatePct))}%` }}
                  />
                  {/* 40% Threshold Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10"
                    style={{ left: `${thresholdPct}%` }}
                    title="40% Safety Threshold"
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0%</span>
                  <span className="text-amber-400 font-bold">Safety Min: {thresholdPct}%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Sample Metrics */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs pt-3 border-t border-slate-800/80">
                <div>
                  <span className="text-slate-500 text-[11px]">Window Samples:</span>
                  <div className="font-mono text-slate-300 font-semibold">
                    {cohort.totalAttemptsInWindow} / 20 actions
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Failures in Window:</span>
                  <div className="font-mono text-rose-400 font-semibold">
                    {cohort.failedAttemptsInWindow} declines
                  </div>
                </div>
              </div>

              {/* Trip Reason / Reset Button */}
              {isOpen ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] text-rose-300/90 leading-tight">
                    {cohort.openReason || 'Success rate dropped below 40% safety threshold.'}
                  </p>
                  <button
                    onClick={() => handleReset(cohort.cohortKey)}
                    disabled={resettingCohort === cohort.cohortKey}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${resettingCohort === cohort.cohortKey ? 'animate-spin' : ''}`} />
                    <span>Authorize Operator Reset</span>
                  </button>
                </div>
              ) : (
                <div className="mt-4 text-[11px] text-slate-500 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-emerald-400" />
                  <span>Autonomous recovery actions actively permitted</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
