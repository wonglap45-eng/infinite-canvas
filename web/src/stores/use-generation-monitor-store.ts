"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { estimateGenerationCredits } from "@/lib/generation-cost";
import type { AiConfig } from "@/stores/use-config-store";

export type GenerationMonitorScope = "canvas" | "image";
export type GenerationMonitorAction = "generate" | "edit" | "mask-edit" | "prompt";
export type GenerationMonitorStatus = "success" | "failed";

export type GenerationMonitorEntry = {
    id: string;
    createdAt: string;
    scope: GenerationMonitorScope;
    action: GenerationMonitorAction;
    status: GenerationMonitorStatus;
    model: string;
    count: number;
    successCount: number;
    failCount: number;
    referenceCount: number;
    estimatedCredits: number;
    promptPreview?: string;
    error?: string;
    durationMs?: number;
    projectId?: string;
    projectTitle?: string;
    nodeId?: string;
};

type AddEntryInput = Omit<GenerationMonitorEntry, "id" | "createdAt" | "estimatedCredits"> & {
    estimatedCredits?: number;
    config?: Pick<AiConfig, "quality" | "size">;
};

type GenerationMonitorStore = {
    entries: GenerationMonitorEntry[];
    addEntry: (entry: AddEntryInput) => void;
    removeEntry: (id: string) => void;
    clearEntries: () => void;
};

const STORE_KEY = "eons-ai-image-studio:generation_monitor";
const MAX_ENTRIES = 160;

export const useGenerationMonitorStore = create<GenerationMonitorStore>()(
    persist(
        (set) => ({
            entries: [],
            addEntry: (entry) =>
                set((state) => {
                    const next: GenerationMonitorEntry = {
                        ...entry,
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        createdAt: new Date().toISOString(),
                        estimatedCredits:
                            entry.estimatedCredits ??
                            estimateGenerationCredits({
                                action: entry.action,
                                count: entry.count,
                                referenceCount: entry.referenceCount,
                                quality: entry.config?.quality,
                                size: entry.config?.size,
                                prompt: entry.promptPreview,
                            }),
                    };
                    return { entries: [next, ...state.entries].slice(0, MAX_ENTRIES) };
                }),
            removeEntry: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
            clearEntries: () => set({ entries: [] }),
        }),
        {
            name: STORE_KEY,
            storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : window.localStorage)),
            partialize: (state) => ({ entries: state.entries }),
        },
    ),
);

export function summarizeGenerationEntries(entries: GenerationMonitorEntry[]) {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const today = entries.filter((entry) => entry.createdAt.startsWith(todayPrefix));
    return {
        todayCount: today.length,
        todaySuccess: today.filter((entry) => entry.status === "success").length,
        todayFailed: today.filter((entry) => entry.status === "failed").length,
        todayCredits: Number(today.reduce((total, entry) => total + entry.estimatedCredits, 0).toFixed(2)),
        totalCredits: Number(entries.reduce((total, entry) => total + entry.estimatedCredits, 0).toFixed(2)),
        recentErrors: entries.filter((entry) => entry.status === "failed").slice(0, 12),
    };
}

export function actionLabel(action: GenerationMonitorAction) {
    if (action === "generate") return "文生图";
    if (action === "edit") return "图生图";
    if (action === "mask-edit") return "局部编辑";
    return "提示词";
}

export function scopeLabel(scope: GenerationMonitorScope) {
    return scope === "canvas" ? "画布" : "生图页";
}

const memoryStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
};
