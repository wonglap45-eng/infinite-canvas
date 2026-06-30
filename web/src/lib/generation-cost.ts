type GenerationCostAction = "generate" | "edit" | "mask-edit" | "prompt";

export function estimateGenerationCredits(params: { action: GenerationCostAction; count: number; referenceCount?: number; quality?: string; size?: string; prompt?: string }) {
    const count = Math.max(1, Math.floor(Math.abs(Number(params.count)) || 1));
    const referenceCount = Math.max(0, Math.floor(Math.abs(Number(params.referenceCount)) || 0));
    const actionWeight = params.action === "prompt" ? 0.25 : params.action === "generate" ? 1 : params.action === "mask-edit" ? 1.55 : 1.35;
    const referenceWeight = referenceCount * 0.2;
    const qualityWeight = params.quality === "high" ? 1.7 : params.quality === "medium" ? 1.25 : 1;
    const sizeWeight = params.size?.includes("3840") ? 2.4 : params.size?.includes("1536") || params.size?.includes("1792") || params.size?.includes("2048") ? 1.35 : 1;
    const promptWeight = (params.prompt?.trim().length || 0) > 1000 ? 0.15 : 0;
    return Math.max(0.1, Number(((actionWeight + referenceWeight + promptWeight) * qualityWeight * sizeWeight * count).toFixed(2)));
}
