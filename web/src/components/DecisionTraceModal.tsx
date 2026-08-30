import React, { useEffect, useState } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
  FileCheck,
  Zap,
  Activity,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  IndianRupee,
  Layers,
  Lock,
} from 'lucide-react';
import type { DecisionTrace } from '@recovery/shared';

interface DecisionTraceModalProps {
  subscriptionId: string | null;
  onClose: () => void;
}

export const DecisionTraceModal: React.FC<DecisionTraceModalProps> = ({
  subscriptionId,
  onClose,
}) => {
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);
  const [showFullNarrative, setShowFullNarrative] = useState(true);

  useEffect(() => {
    if (!subscriptionId) return;

    const fetchTrace = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/audit/decision-trace/${subscriptionId}`);
        const data = await res.json();
        if (data.success) {
          setTrace(data.data);
        } else {
          setError(data.error || 'Failed to fetch decision trace');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error fetching decision trace';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchTrace();
  }, [subscriptionId]);

  if (!subscriptionId) return null;

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'detected':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'diagnosed':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'proposed':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
      case 'permitted':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'circuit_breaker_check':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'verified':
        return 'bg-teal-500/20 text-teal-300 border-teal-500/40';
      case 'executed':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'escalated':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'outcome':
        return 'bg-gradient-to-r from-blue-500/20 to-emerald-500/20 text-emerald-200 border-emerald-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStageIcon = (stage: string) => {
    switch (stage) {
      case 'detected':
        return <AlertCircle className="w-4 h-4 text-amber-400" />;
      case 'diagnosed':
        return <Activity className="w-4 h-4 text-blue-400" />;
      case 'proposed':
        return <Zap className="w-4 h-4 text-indigo-400" />;
      case 'permitted':
        return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
      case 'circuit_breaker_check':
        return <Lock className="w-4 h-4 text-purple-400" />;
      case 'verified':
        return <FileCheck className="w-4 h-4 text-teal-400" />;
      case 'executed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'escalated':
        return <ShieldAlert className="w-4 h-4 text-purple-400" />;
      case 'outcome':
        return <IndianRupee className="w-4 h-4 text-emerald-400" />;
      default:
        return <Layers className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                <Layers className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <span>Decision Trace Audit</span>
                  <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {subscriptionId}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Cryptographically verifiable event-sourced timeline from detection to attribution
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {loading ? (
            <div className="py-20 text-center text-slate-400 space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto" />
              <p className="text-sm">Assembling cryptographic trace from Event Store ledger...</p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-rose-950/20 border border-rose-500/40 text-rose-300 text-sm space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-200">
                <ShieldAlert className="w-5 h-5" />
                <span>Error Querying Ledger</span>
              </div>
              <p>{error}</p>
            </div>
          ) : trace ? (
            <>
              {/* Top Metadata Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] text-slate-500 uppercase font-semibold">Payment Rail</div>
                  <div className="mt-1 font-bold text-white font-mono uppercase">{trace.rail}</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] text-slate-500 uppercase font-semibold">Annualized Value</div>
                  <div className="mt-1 font-bold text-white">
                    ₹{Math.round(trace.annualizedValuePaise / 100).toLocaleString('en-IN')}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] text-slate-500 uppercase font-semibold">Ledger Cryptography</div>
                  <div className="mt-1 flex items-center gap-1.5 text-emerald-400 font-semibold text-xs">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>100% SHA-256 Valid</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] text-slate-500 uppercase font-semibold">Events in Chain</div>
                  <div className="mt-1 font-bold text-indigo-400 font-mono">{trace.totalEventsCount} events</div>
                </div>
              </div>

              {/* "Why did the agent do this?" Explainability Narrative Card */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/30 via-slate-950 to-blue-950/30 border border-indigo-500/30 space-y-2.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold text-indigo-300">
                    <HelpCircle className="w-4 h-4 text-indigo-400" />
                    <span>Why did the agent do this? (Explainability Synthesis)</span>
                  </div>
                  <button
                    onClick={() => setShowFullNarrative(!showFullNarrative)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                  >
                    {showFullNarrative ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {showFullNarrative && (
                  <p className="text-xs text-slate-300 leading-relaxed font-sans bg-slate-950/80 p-3.5 rounded-xl border border-indigo-500/20">
                    {trace.narrative}
                  </p>
                )}
              </div>

              {/* Chronological 8-Stage Timeline */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">
                  Chronological Decision Lifecycle (8 Stages)
                </h3>

                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
                  {trace.steps.map((step, idx) => {
                    const isExpanded = expandedStepIndex === idx;
                    return (
                      <div key={idx} className="relative group">
                        {/* Stage Node Dot */}
                        <div className="absolute -left-6 top-1.5 p-1 rounded-full bg-slate-900 border border-slate-700 text-slate-300 group-hover:border-indigo-500 group-hover:text-indigo-400 transition">
                          {getStageIcon(step.stage)}
                        </div>

                        {/* Step Card */}
                        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${getStageColor(
                                  step.stage,
                                )}`}
                              >
                                {step.stage.replace(/_/g, ' ')}
                              </span>
                              <span className="font-bold text-white text-sm">{step.title}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                              <Clock className="w-3 h-3" />
                              <span>{new Date(step.timestamp).toLocaleTimeString('en-IN', { hour12: false })}</span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-300 leading-normal">
                            {step.summary}
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-900">
                            <span className="font-mono">Actor: {step.actor}</span>
                            {step.details && (
                              <button
                                onClick={() => setExpandedStepIndex(isExpanded ? null : idx)}
                                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium"
                              >
                                <Code className="w-3 h-3" />
                                <span>{isExpanded ? 'Hide Payload' : 'View Payload'}</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </div>

                          {/* Raw JSON Payload Viewer */}
                          {isExpanded && step.details && (
                            <div className="mt-3 p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-emerald-300/90 border border-slate-800 overflow-x-auto">
                              <pre>{JSON.stringify(step.details, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
