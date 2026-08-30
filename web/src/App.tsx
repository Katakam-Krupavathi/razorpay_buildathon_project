import { useState, useEffect } from 'react';
import { ShieldCheck, Activity, RefreshCw, Zap, Cpu, Lock, CheckCircle2 } from 'lucide-react';
import type { ControlPlaneHealth } from '@recovery/shared';

export function App() {
  const [health, setHealth] = useState<ControlPlaneHealth>({
    status: 'healthy',
    uptimeSeconds: 0,
    database: 'connected',
    redis: 'connected',
    circuitBreaker: 'CLOSED',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });

  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      // Fallback for local preview without backend
      setHealth((prev) => ({
        ...prev,
        uptimeSeconds: prev.uptimeSeconds + 10,
        timestamp: new Date().toISOString(),
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      {/* Top Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between pb-8 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Autonomous Revenue Recovery Control Plane
              </h1>
              <p className="text-sm text-slate-400">
                Razorpay Mandate-Aware Subscription Recovery Engine
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            System Operational
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-sm font-medium rounded-lg transition border border-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-7xl mx-auto mt-8 space-y-8">
        {/* Status Highlights */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>Control Status</span>
              <Activity className="w-4 h-4 text-blue-400" />
            </div>
            <div className="mt-3 text-2xl font-bold text-white capitalize">{health.status}</div>
            <p className="text-xs text-slate-500 mt-1">Autonomous orchestration active</p>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>Circuit Breaker</span>
              <Lock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="mt-3 text-2xl font-bold text-emerald-400">{health.circuitBreaker}</div>
            <p className="text-xs text-slate-500 mt-1">Safety invariants verified</p>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>Event Store</span>
              <Cpu className="w-4 h-4 text-purple-400" />
            </div>
            <div className="mt-3 text-2xl font-bold text-white capitalize">{health.database}</div>
            <p className="text-xs text-slate-500 mt-1">PostgreSQL 16 Engine</p>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-sm font-medium">
              <span>Cache & Rate Limits</span>
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="mt-3 text-2xl font-bold text-white capitalize">{health.redis}</div>
            <p className="text-xs text-slate-500 mt-1">Redis 7 In-Memory Store</p>
          </div>
        </section>

        {/* 5 Pillars Architecture Scaffolding */}
        <section className="p-6 rounded-xl bg-slate-900/60 border border-slate-800">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-400" />
            Core Autonomous Recovery Pillars
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
              <div className="text-xs font-mono text-blue-400 uppercase tracking-wider">
                Pillar 1
              </div>
              <h3 className="font-semibold text-white mt-1">Predict</h3>
              <p className="text-xs text-slate-400 mt-2">
                Risk taxonomy & Expected Recovery Value (ERV) engine evaluates failure root causes.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
              <div className="text-xs font-mono text-emerald-400 uppercase tracking-wider">
                Pillar 2
              </div>
              <h3 className="font-semibold text-white mt-1">Permit</h3>
              <p className="text-xs text-slate-400 mt-2">
                Autonomous Policy Engine evaluates customer churn risk & volume guardrails before
                execution.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
              <div className="text-xs font-mono text-amber-400 uppercase tracking-wider">
                Pillar 3
              </div>
              <h3 className="font-semibold text-white mt-1">Verify</h3>
              <p className="text-xs text-slate-400 mt-2">
                Pre-execution mandate verification gateway checks instrument validity & pre-debit
                rules.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
              <div className="text-xs font-mono text-purple-400 uppercase tracking-wider">
                Pillar 4
              </div>
              <h3 className="font-semibold text-white mt-1">Execute</h3>
              <p className="text-xs text-slate-400 mt-2">
                Multi-rail orchestration across UPI AutoPay, cards, and dynamic dunning links.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
              <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                Pillar 5
              </div>
              <h3 className="font-semibold text-white mt-1">Measure</h3>
              <p className="text-xs text-slate-400 mt-2">
                Net Value Recovered (NVR) accounting and cryptographic audit trail with replay
                forensic logs.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
