import type { AiConfig } from "@/stores/use-config-store";
import { estimateGenerationCredits } from "@/lib/generation-cost";

export const MAX_IMAGE_GENERATION_COUNT = 3;

export type PreflightItem = {
    label: string;
    value?: string;
    level?: "info" | "warning" | "danger";
};

export function normalizeImageGenerationCount(value: unknown, fallback = 1) {
    return Math.max(1, Math.min(MAX_IMAGE_GENERATION_COUNT, Math.floor(Math.abs(Number(value)) || fallback)));
}

export function shouldConfirmImageGeneration(params: { count: number; prompt: string; quality?: string; size?: string; referenceCount?: number }) {
    const size = params.size || "";
    const quality = params.quality || "";
    const prompt = params.prompt.trim();
    return params.count > 1 || quality === "high" || size.includes("3840") || prompt.length < 80 || needsProductReference(prompt, params.referenceCount || 0) || !hasProductPreservationRules(prompt);
}

export function imageGenerationPreflightItems(config: Pick<AiConfig, "model" | "quality" | "size">, params: { count: number; prompt: string; referenceCount: number }): PreflightItem[] {
    const prompt = params.prompt.trim();
    const estimatedCredits = estimateGenerationCredits({ action: params.referenceCount ? "edit" : "generate", count: params.count, referenceCount: params.referenceCount, quality: config.quality, size: config.size, prompt: params.prompt });
    const items: PreflightItem[] = [
        { label: "模型", value: config.model || "未选择", level: config.model ? "info" : "danger" },
        { label: "数量", value: `${params.count} 张`, level: params.count > 1 ? "warning" : "info" },
        { label: "参考图", value: `${params.referenceCount} 张`, level: params.referenceCount ? "info" : "warning" },
        { label: "质量", value: config.quality || "自动", level: config.quality === "high" ? "warning" : "info" },
        { label: "尺寸", value: config.size || "自动", level: (config.size || "").includes("3840") ? "warning" : "info" },
        { label: "估算消耗", value: `${estimatedCredits} 点`, level: estimatedCredits >= 6 ? "warning" : "info" },
    ];

    if (prompt.length < 80) {
        items.push({ label: "风险", value: "提示词偏短，容易出随机图或低质量图。建议使用“亚马逊工作流”模板补全约束。", level: "danger" });
    }
    if (needsProductReference(prompt, params.referenceCount)) {
        items.push({ label: "风险", value: "提示词要求保留参考产品，但当前没有参考图，模型可能凭空生成新包装。", level: "danger" });
    }
    if (!hasProductPreservationRules(prompt)) {
        items.push({ label: "建议", value: "缺少保留品牌、包装比例、标签位置、主色等约束，商品图容易跑偏。", level: "warning" });
    }
    if (!hasNegativeRules(prompt)) {
        items.push({ label: "建议", value: "建议加入不要水印、不要额外文字、不要扭曲 logo、不要虚构包装等反向约束。", level: "warning" });
    }
    if (params.count > 1) {
        items.push({ label: "建议", value: "多张生成会分别请求模型，并只追加“保持原始提示词不变、结果彼此有区别”的中性要求。", level: "warning" });
    }

    return items;
}

function needsProductReference(prompt: string, referenceCount: number) {
    if (referenceCount > 0) return false;
    return /参考|原产品|同一产品|保留|包装|品牌|标签|亚马逊|商品图/.test(prompt);
}

function hasProductPreservationRules(prompt: string) {
    const rules = ["品牌", "包装", "标签", "主色", "比例", "瓶型", "盒型", "配件"];
    return rules.filter((rule) => prompt.includes(rule)).length >= 3;
}

function hasNegativeRules(prompt: string) {
    return /不要|禁止|避免|不能/.test(prompt) && /水印|额外文字|扭曲|虚构|变形|杂乱|logo/i.test(prompt);
}
