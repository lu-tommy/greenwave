"use client";

import { useState } from "react";
import { demoCorridor } from "@/lib/data/corridors/demoCorridor";
import { applyOverrides, isPlanConsistent, resetAllOverrides, saveOverride } from "@/lib/storage/calibrationStorage";
import type { Intersection, SignalPlan } from "@/lib/types";

type FormState = SignalPlan & { confidence: number };

function toForm(intersection: Intersection): FormState {
  return { ...intersection.signalPlan, confidence: intersection.confidence };
}

export function CalibrationEditor() {
  const [corridor, setCorridor] = useState(() => applyOverrides(demoCorridor));
  const [forms, setForms] = useState<Record<string, FormState>>(() =>
    Object.fromEntries(corridor.intersections.map((i) => [i.id, toForm(i)])),
  );
  const [savedId, setSavedId] = useState<string | null>(null);

  function updateField(id: string, field: keyof FormState, value: number) {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function handleSave(id: string) {
    const form = forms[id];
    if (!isPlanConsistent(form)) return;
    saveOverride(corridor.id, id, form);
    setCorridor(applyOverrides(demoCorridor));
    setSavedId(id);
    setTimeout(() => setSavedId(null), 1500);
  }

  function handleResetAll() {
    resetAllOverrides(corridor.id);
    setCorridor(applyOverrides(demoCorridor));
    setForms(Object.fromEntries(demoCorridor.intersections.map((i) => [i.id, toForm(i)])));
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Signal Calibration</h1>
          <p className="text-xs text-foreground-dim">{corridor.name} · {corridor.dataSourceLabel}</p>
        </div>
        <button
          onClick={handleResetAll}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-foreground-dim hover:text-foreground"
        >
          Reset to demo defaults
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {corridor.intersections.map((intersection) => {
          const form = forms[intersection.id];
          const consistent = isPlanConsistent(form);
          return (
            <div key={intersection.id} className="rounded-xl border border-border-subtle bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">{intersection.name}</h2>
                <span className="font-mono text-xs text-foreground-dim">
                  {intersection.distanceAlongCorridorM.toFixed(0)} m
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="Cycle (s)" value={form.cycleSec} onChange={(v) => updateField(intersection.id, "cycleSec", v)} />
                <Field label="Green (s)" value={form.greenSec} onChange={(v) => updateField(intersection.id, "greenSec", v)} />
                <Field label="Yellow (s)" value={form.yellowSec} onChange={(v) => updateField(intersection.id, "yellowSec", v)} />
                <Field label="Red (s)" value={form.redSec} onChange={(v) => updateField(intersection.id, "redSec", v)} />
                <Field label="Offset (s)" value={form.offsetSec} onChange={(v) => updateField(intersection.id, "offsetSec", v)} />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <label className="flex flex-1 items-center gap-2">
                  <span className="text-[11px] text-foreground-dim">Confidence</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.confidence}
                    onChange={(e) => updateField(intersection.id, "confidence", Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-10 text-right font-mono text-xs text-foreground-muted">
                    {Math.round(form.confidence * 100)}%
                  </span>
                </label>
              </div>

              {!consistent && (
                <p className="mt-2 text-xs text-accent-red">Green + yellow + red must equal cycle length.</p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => handleSave(intersection.id)}
                  disabled={!consistent}
                  className="rounded-md bg-accent-green px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
                {savedId === intersection.id && <span className="text-xs text-accent-green">Saved</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-foreground-dim">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-sm text-foreground focus:border-accent-blue focus:outline-none"
      />
    </label>
  );
}
