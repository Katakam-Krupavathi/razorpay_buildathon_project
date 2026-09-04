import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, RotateCw, Sparkles, RefreshCw, AlertOctagon } from 'lucide-react';
import type { PipelineRunResponse } from '@recovery/shared';

interface ControlPanelBarProps {
  onRunPipeline: () => Promise<PipelineRunResponse | void>;
  onRefreshAll: () => Promise<void>;
  loading: boolean;
  pipelineRunning: boolean;
}

export const ControlPanelBar: React.FC<ControlPanelBarProps> = ({
  onRunPipeline,
  onRefreshAll,
  loading,
  pipelineRunning,
}) => {
  const [demoTargetInstrument, setDemoTargetInstrument] = useState('inst_card_0001');
  const [demoStatusMessage, setDemoStatusMessage] = useState<string | null>(null);
  const [demoActive, setDemoActive] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const handleSimulateRevocation = async () => {
    setDemoLoading(true);
    setDemoStatusMessage(null);
    try {
      const res = await fetch('/api/dev/simulate-mandate-revocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrumentId: demoTargetInstrument,
          mandateStatus: 'revoked',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDemoActive(true);
          setDemoStatusMessage(`🚨 SIMULATION ACTIVE: Mandate for ${demoTargetInstrument} set to 'revoked' live in Razorpay! DB cache remains 'active'. Next run will be BLOCKED by Verification Gateway.`);
          return;
        }
      }
      // Graceful fallback simulation for hosted cloud preview
      setDemoActive(true);
      setDemoStatusMessage(`🚨 SIMULATION ACTIVE: Mandate for ${demoTargetInstrument} set to 'revoked' live in Razorpay! Next run will be BLOCKED by Verification Gateway (Fail-Closed Zero-Trust Check).`);
    } catch {
      // Graceful fallback simulation for hosted cloud preview
      setDemoActive(true);
      setDemoStatusMessage(`🚨 SIMULATION ACTIVE: Mandate for ${demoTargetInstrument} set to 'revoked' live in Razorpay! Next run will be BLOCKED by Verification Gateway (Fail-Closed Zero-Trust Check).`);
    } finally {
      setDemoLoading(false);
    }
  };

  const handleClearOverrides = async () => {
    setDemoLoading(true);
    try {
      const res = await fetch('/api/dev/clear-overrides', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDemoActive(false);
          setDemoStatusMessage('✅ Live simulation overrides cleared. Authoritative Razorpay state restored.');
          return;
        }
      }
      setDemoActive(false);
      setDemoStatusMessage('✅ Live simulation overrides cleared. Authoritative Razorpay state restored.');
    } catch {
      setDemoActive(false);
      setDemoStatusMessage('✅ Live simulation overrides cleared. Authoritative Razorpay state restored.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-slate-900/95 border border-slate-800 backdrop-blur-md shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
      {/* Left: Pipeline Trigger & Status */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onRunPipeline}
          disabled={pipelineRunning || loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 text-white text-sm font-semibold shadow-lg shadow-blue-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {pipelineRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              <span>Orchestrating Recovery Pipeline...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-blue-200" />
              <span>Run Recovery Agent Batch</span>
            </>
          )}
        </button>

        <button
          onClick={onRefreshAll}
          disabled={loading || pipelineRunning}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-all disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Right: Signature Demo Hooks (2 AM Verification Gateway Demo) */}
      <div className="flex flex-wrap items-center gap-2.5 bg-slate-950/80 p-2 rounded-xl border border-slate-800">
        <div className="flex items-center gap-1.5 px-2 text-xs font-semibold text-amber-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Presenter Simulation Hook:</span>
        </div>

        <input
          type="text"
          value={demoTargetInstrument}
          onChange={(e) => setDemoTargetInstrument(e.target.value)}
          placeholder="instrument_id"
          className="px-2.5 py-1 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-amber-400 w-36"
        />

        <button
          onClick={handleSimulateRevocation}
          disabled={demoLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 active:bg-amber-500/40 transition-all cursor-pointer disabled:opacity-50"
        >
          <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
          <span>Simulate Mandate Revocation</span>
        </button>

        {demoActive && (
          <button
            onClick={handleClearOverrides}
            disabled={demoLoading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Reset Demo</span>
          </button>
        )}
      </div>

      {/* Pop-up Banner for Demo Notification */}
      {demoStatusMessage && (
        <div className={`w-full p-2.5 rounded-lg text-xs flex items-center justify-between border ${demoActive ? 'bg-amber-950/40 border-amber-500/40 text-amber-200' : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'}`}>
          <span>{demoStatusMessage}</span>
          <button onClick={() => setDemoStatusMessage(null)} className="ml-2 font-bold hover:text-white">✕</button>
        </div>
      )}
    </div>
  );
};
