"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Bot, Home, ImageIcon, Images, List, Menu, Music2, Plus, Redo2, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { defaultConfig, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageVariationPrompt } from "@/lib/image-variation-prompt";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "../utils/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CANVAS_AGENT_PANEL_MOTION_MS, CanvasAssistantPanel } from "../components/canvas-assistant-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "../components/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { CanvasSurface } from "../components/canvas-surface";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "../components/asset-picker-modal";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { CanvasLocalAgentPanel } from "../components/canvas-local-agent-panel";
import { GenerationMonitorModal } from "@/components/generation/generation-monitor-modal";
import { useCanvasAgentStore } from "../stores/use-canvas-agent-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useGenerationMonitorStore } from "@/stores/use-generation-monitor-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "../utils/canvas-resource-references";
import type { CanvasAgentMode } from "../components/canvas-agent-chat-ui";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "../types";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

type ReverseWorkflowPlan = {
    index: number;
    title: string;
    content: string;
};

type ReverseWorkflowState = {
    node: CanvasNodeData;
    mode: ReversePromptMode;
    stage: "analysis" | "plans" | "prompts";
    analysis: string;
    plans: ReverseWorkflowPlan[];
    prompts: string[];
    loading: boolean;
    error?: string;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const READABLE_TEXT_FONT_SIZE = 16;
const LONG_PROMPT_NODE_SIZE = { width: 760, height: 540 };
const REVERSE_PROMPT_RESULT_NODE_SIZE = { width: 720, height: 520 };
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推出“这张图是如何被构建出来的”，生成一段可复用到其他产品上的 AI 生图提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 你是一名 Amazon 资深电商美工、产品摄影指导和商业视觉拆解师。
3. 重点反推参考图片的画面结构，而不是复刻参考图里的具体产品。请拆解并迁移：主体数量与相对位置、主体占画面比例、前后层次、镜头角度、焦段感、构图方式、背景类型、光线方向、阴影、反光、材质质感、色彩氛围、道具关系、商业用途和质量标准。
4. 输出必须写成“把用户上传的新产品作为唯一主体/核心主体，套用参考图的构图、光影、背景和商业视觉风格”的生图提示词，方便员工连接自己的产品参考图后生成相似结构的新图片。
5. 不要要求保留参考图产品的品牌、文字、logo、瓶型、包装、标签、颜色或卖点；这些都应由用户后续上传的新产品参考图决定。
6. 如果参考图是商品图，请反推出它的拍摄/设计方法，例如：白底主图、场景副图、A+ 详情图、近景材质图、套装陈列、功能氛围图、前景道具与背景虚化等。
7. 输出中文提示词，语义要具体可执行，适合当前 Fossil/OpenAI 兼容图片模型直接使用。
8. 输出必须是自包含提示词，不要写“和参考图一样”“如图所示”“参考上图”等依赖原图才能理解的表达。
9. 加入约束：不要额外文字、不要水印、不要复制参考图品牌、不要复制参考图包装文字、不要虚构新产品不存在的标签信息、不要改变用户新产品的外观。`;
const IMAGE_PROMPT_REVERSE_PRESET_V2 = `请基于参考图片做一次“商业视觉反推拆解”，输出必须是中文，目标是让员工把这个结构迁移到自己的产品图上，生成类似构图、类似质感、类似商业表达的新图片。

你的身份：
你是一名 Amazon 资深电商美工、产品摄影指导、商业视觉拆解师和 AI 生图提示词工程师。你需要像专业设计复盘一样，把图片到底是如何构建出来的讲清楚。

核心原则：
1. 参考图只用于分析构图、版式、图层、背景、光线、色彩、镜头和商业表达，不要要求复制参考图里的品牌、logo、包装文字、具体卖点或产品身份。
2. 最终提示词必须写成“以用户后续上传的新产品图作为唯一产品主体”，新产品图决定品牌、瓶型、包装比例、标签位置、颜色和真实外观。
3. 如果参考图是竞品图，只迁移画面方法，不迁移竞品品牌和具体包装内容。
4. 输出要足够细，不能只给一句泛泛的提示词。
5. 不要在开头寒暄，不要说“你好”，不要把参考图里的具体产品品类写成未来生成的硬性规定。可以识别参考图文字，但必须把它标注为“参考图可见文字/原图文案结构”，不能要求新图继续使用同一产品名、同一品牌名或同一文案。
6. 必须专门拆解文字信息：如果文字清晰可见，请列出参考图中可见的标题、副标题、图标下卖点标题和说明文字；同时说明字体风格、大小层级、大小写、对齐方式、字距、行距、颜色和位置。如果文字无法完全识别，请说明“部分文字不可读”，不要编造。
7. 最终必须输出 5 个可直接连线使用的提示词，并用固定标记包起来，格式必须是：
【可连线提示词1｜标题】
提示词正文
【可连线提示词2｜标题】
提示词正文
一直到【可连线提示词5｜标题】。
这些标记用于系统自动拆成 5 个独立文本节点，不要省略。

请严格按以下结构输出：

一、画面定位
说明这张图属于什么商业图类型，例如白底主图、场景副图、A+ 详情图、科技成分氛围图、功能卖点图、套装陈列图、材质近景图等；说明它想传达的档次、用途和消费者感受。

二、图片是如何构成的
分层拆解背景层、主体产品层、文字/信息区、装饰元素、道具、阴影、反光、前后景关系；明确主体数量、主体位置、主体占画面比例、留白比例、画面重心和层级关系。

三、文字与信息文案结构
逐项列出参考图可见文字，并说明这些文字分别属于主标题、副标题、功能卖点标题、功能说明、辅助标签还是图标说明。分析文案写法：是否使用数字、百分比、功能词、天然感词、科技感词、简短利益点；说明文字在新产品图里应该如何替换为新产品自己的文案。

四、视觉动线
说明用户视线从哪里进入，经过哪些标题、主体、装饰线条、功能信息，最后停在哪里；如果有流体、烟雾、光效、线条、色块或植物等元素，要说明它们怎样引导视线。

五、版面比例
说明整体画幅比例、主体区域比例、文字区比例、背景/留白比例、左右/上下分区方式，以及适合迁移到 1:1、4:5、3:4、16:9 等画幅时如何保持结构。

六、配色逻辑
拆解主色、辅助色、背景色、高光色、文字色的用途；说明色彩为什么显高级、干净、科技、天然、专业或高转化。

七、光线、材质与摄影感
说明主光方向、补光、边缘光、阴影、反光、景深、焦段感、镜头角度、产品材质表现、包装质感和真实摄影/3D 渲染感。

八、为什么看起来高级
用设计语言说明它高级在哪里，例如信息克制、主体突出、留白充足、字体层级清晰、背景有空间感、材质真实、光影干净、品牌感统一等。

九、可拆分的图层结构
用清单列出如果在 Photoshop 或 AI 工作流中制作，应拆成哪些图层：背景、渐变/色块、主体产品、装饰元素、卖点文字、阴影、反光、前景/后景等。

十、优点与不足
说明这张图哪些地方值得迁移，哪些地方不建议迁移到新产品上，例如文字过多、主体太小、品牌区不明显、背景抢主体、可读性不足等。

十一、核心构成公式
用一句公式总结这张图的可迁移方法，例如“单一产品主体 + 柔和浅色背景 + 右侧功能氛围元素 + 左侧简短卖点 + 干净商业灯光”。

十二、固定共性要求
列出迁移到新产品图时必须固定的要求：只使用新产品图作为唯一产品主体；保留新产品真实外观、品牌、瓶型/盒型、包装比例和标签位置；不要凭空改品牌、改包装、改产品类别、添加不存在的卖点。

十三、5 个可连线提示词
根据当前参考图本身独立思考，给出 5 个明显不同的中文提示词，不要套用固定方向或示例模板。每个提示词必须是独立完整的中文生图提示词，必须强调“以用户上传的新产品图作为唯一产品主体”，必须包含文字区域应该如何写；同时要求不要复制参考图原文案、品牌或具体产品名。每个提示词必须使用【可连线提示词N｜标题】标记开头。`;

const REVERSE_PROMPT_NODE_MARKER = "【可连线提示词";
type ReversePromptMode = "main" | "secondary";

function buildImagePromptReversePreset(mode: ReversePromptMode) {
    const modeRule =
        mode === "main"
            ? `本次反推用途：主图。
目标是生成符合 Amazon 展示要求的纯白底包装标签设计主图。白底、产品物理结构、商品数量、机位、构图和光影保持固定，五套差异必须只发生在包装可印刷表面的标签视觉系统中。`
            : `本次反推用途：副图。
允许迁移参考图真实可见的场景、氛围、信息表达和商业视觉关系，但不能复制参考产品内容。`;

    return `请基于用户连接的参考图片做“商业视觉反推拆解”，输出中文。目标是先真正看懂这张图片，再生成 5 条可以连接到用户新产品图的独立生图提示词。

${modeRule}

请严格遵守：
1. 参考图只用于理解画面结构、信息组织和视觉表达；参考产品的品牌、产品名、包装文字、卖点和具体身份不能复制。
2. 用户后续上传的新产品图决定最终产品的真实外观、品牌、包装、颜色、标签和比例。
3. 不要预先规定五个方向，不要列出风格清单，也不要把同一套构图换几个形容词。
4. 先根据当前图片建立“元素清单”和“不可变/可变化清单”，再让五条提示词各自重新设计完整画面，而不是共享一个目标画面骨架。
5. 五条提示词必须是最终生图指令，不是分析摘要；必须描述生成后画面会是什么样，包含产品关系、构图层次、文字区域和可见视觉元素。
6. 五条提示词要自然具体，差异必须来自图片证据和独立构图决策，不能靠重复“高级、干净、真实、专业”制造差异。
7. 参考图没有的元素不要补写；看不清的文字不要猜写。新图文字只使用用户产品真实可见的文字或明确提供的内容。

输出格式：
先输出参考图拆解和不可变/可变化判断，然后输出以下 5 个节点。每个节点正文是一整段可直接交给图片模型的中文指令，不要再套用固定字段：
【可连线提示词1｜标题】
生成一张...
直接写完整提示词正文。一直到【可连线提示词5｜标题】。五个标题和五个画面必须不同，不要输出空泛解释。`;
}

function isReversePromptRequest(prompt: string) {
    return prompt.includes("商业视觉反推拆解") && prompt.includes(REVERSE_PROMPT_NODE_MARKER);
}

function splitReversePromptOutput(content: string) {
    const text = sanitizeReversePromptOutput(content.trim());
    const markerPattern = /【可连线提示词\s*([1-5])\s*(?:[｜|]\s*([^】]+))?】/g;
    const matches = Array.from(text.matchAll(markerPattern));
    if (!matches.length) return null;

    const prompts = matches
        .map((match, index) => {
            const start = (match.index || 0) + match[0].length;
            const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
            const body = text
                .slice(start, end)
                .trim()
                .replace(/^提示词正文[:：]?\s*/i, "")
                .replace(/^提示词[:：]?\s*/i, "")
                .trim();
            return {
                index: Number(match[1]) || index + 1,
                title: (match[2] || `提示词 ${index + 1}`).trim(),
                content: body,
            };
        })
        .filter((item) => item.content);

    if (!prompts.length) return null;
    const analysis = text.slice(0, matches[0].index || 0).trim() || "反推分析已生成，下面是可直接连线使用的提示词。";
    return { analysis, prompts };
}

type ReversePromptSplitResult = NonNullable<ReturnType<typeof splitReversePromptOutput>>;

function splitReverseRoutePlans(content: string) {
    const text = sanitizeReversePromptOutput(content.trim());
    const jsonPlans = splitReverseRoutePlansFromJson(text);
    if (jsonPlans) return jsonPlans;

    const markerPattern = /【(?:路线规划|设计方案)\s*([1-5])\s*(?:[｜|]\s*([^】]+))?】/g;
    const matches = Array.from(text.matchAll(markerPattern));
    if (!matches.length) return null;

    const plans = matches
        .map((match, index) => {
            const start = (match.index || 0) + match[0].length;
            const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
            return {
                index: Number(match[1]) || index + 1,
                title: (match[2] || `独立路线 ${index + 1}`).trim(),
                content: text.slice(start, end).trim(),
            };
        })
        .filter((item) => item.content);

    return plans.length === 5 ? plans : null;
}

function splitReverseRoutePlansFromJson(text: string): ReverseWorkflowPlan[] | null {
    const parsed = parseLooseJson(text);
    const source = Array.isArray(parsed) ? parsed : isPlainRecord(parsed) && Array.isArray(parsed.plans) ? parsed.plans : null;
    if (!source || source.length !== 5) return null;

    const plans = source
        .map((item, index) => {
            if (!isPlainRecord(item)) return null;
            const title = stringField(item, "title") || stringField(item, "name") || `独立方案 ${index + 1}`;
            const creativeThesis = stringField(item, "creativeThesis") || stringField(item, "creative_thesis") || stringField(item, "设计命题");
            const visibleMechanism = stringField(item, "visibleMechanism") || stringField(item, "visible_mechanism") || stringField(item, "可见设计机制");
            const referenceEvidence = stringField(item, "referenceEvidence") || stringField(item, "reference_evidence") || stringField(item, "参考依据");
            const targetFrame = stringField(item, "targetFrame") || stringField(item, "target_frame") || stringField(item, "目标成片");
            const productRole = stringField(item, "productRole") || stringField(item, "product_role") || stringField(item, "产品角色");
            const textStrategy = stringField(item, "textStrategy") || stringField(item, "text_strategy") || stringField(item, "文字策略");
            const visualFingerprint = stringField(item, "visualFingerprint") || stringField(item, "visual_fingerprint") || stringField(item, "视觉指纹");
            const nonOverlap = stringField(item, "nonOverlap") || stringField(item, "non_overlap") || stringField(item, "排他边界");
            const designCommand = stringField(item, "designCommand") || stringField(item, "design_command") || stringField(item, "design命题") || stringField(item, "设计命题");
            const coreMechanism = stringField(item, "coreMechanism") || stringField(item, "core_mechanism") || stringField(item, "核心变化机制");
            const evidence = stringField(item, "evidence") || stringField(item, "参考证据");
            const productMigration = stringField(item, "productMigration") || stringField(item, "product_migration") || stringField(item, "产品迁移");
            const textHandling = stringField(item, "textHandling") || stringField(item, "text_handling") || stringField(item, "文字与信息处理");
            const fixedRules = stringField(item, "fixedRules") || stringField(item, "fixed_rules") || stringField(item, "固定保留项");
            const avoid = stringField(item, "avoid") || stringField(item, "不做什么");
            const difference = stringField(item, "difference") || stringField(item, "与其他方案的区别");
            const content = [
                ["设计命题", creativeThesis],
                ["可见设计机制", visibleMechanism],
                ["参考依据", referenceEvidence],
                ["目标成片", targetFrame],
                ["产品角色", productRole],
                ["文字策略", textStrategy],
                ["视觉指纹", visualFingerprint],
                ["排他边界", nonOverlap],
                ["设计命题", designCommand],
                ["核心变化机制", coreMechanism],
                ["参考证据", evidence],
                ["产品迁移", productMigration],
                ["文字与信息处理", textHandling],
                ["固定保留项", fixedRules],
                ["不做什么", avoid],
                ["与其他方案的区别", difference],
            ]
                .filter(([, value]) => value)
                .map(([label, value]) => `${label}：${value}`)
                .join("\n");
            return content ? { index: index + 1, title: title.trim(), content } : null;
        })
        .filter(Boolean) as ReverseWorkflowPlan[];

    return plans.length === 5 ? plans : null;
}

function parseLooseJson(text: string): unknown {
    const candidates = [
        text.trim(),
        ...(Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1]?.trim()).filter(Boolean) as string[]),
        jsonSlice(text, "[", "]"),
        jsonSlice(text, "{", "}"),
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // Keep trying less strict candidates.
        }
    }
    return null;
}

function jsonSlice(text: string, open: string, close: string) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("；").trim();
    if (isPlainRecord(value)) return Object.entries(value).map(([itemKey, itemValue]) => `${itemKey}：${typeof itemValue === "string" ? itemValue : JSON.stringify(itemValue)}`).join("；").trim();
    return "";
}

function sanitizeReversePromptOutput(content: string) {
    return content
        .replace(/\b(?:image|img)[-_ ]?\d+\.(?:png|jpe?g|webp)\b/gi, "参考图片")
        .replace(/\b(?:image|img)[-_ ]?\d+\b/gi, "参考图片");
}

function buildReversePromptAnalysisOnlyRequest(prompt: string) {
    const isMain = prompt.includes("本次反推用途：主图");
    const modeRule = isMain
        ? `本次用途是 Amazon 白底包装标签设计主图。必须把画面拆成三个层级：
1. 完全锁定层：纯白背景、产品物理轮廓、包装尺寸和结构、商品数量、机位、透视、构图、占画比例、接地阴影与灯光。
2. 固定信息层：用户产品真实品牌、产品名、规格、必要说明和包装上确实存在的文字事实；不得改写或虚构。
3. 可设计标签层：包装可印刷区域内的核心图形、图案组织、信息层级、字体组合关系、留白节奏、色彩关系、局部材质与印刷工艺表现。
重点分析参考图的标签为什么成立、哪些标签视觉语言可迁移、哪些竞品文字和品牌不能复制。商品外部的文字、信息卡、徽章、轨道、蓝图、道具和场景必须列为“不迁移”。`
        : "本次用途是副图反推：请完整识别参考图中真实存在的主体关系、氛围、场景、卖点表达、背景关系、信息组织、视觉动线和商业风格。";
    const variabilityRule = isMain
        ? `7. 明确完全不能变的内容：纯白背景、产品物理轮廓、包装尺寸与结构、商品数量、机位、构图、光影、真实品牌和文字事实；参考图的品牌、产品名、具体文案和卖点不能复制。
8. 明确标签内部可以设计的内容：在原有可印刷区域内，分析哪些核心图形、版式层级、字体组合关系、留白、色彩、纹理和印刷工艺可以变化。物理标签边界固定，但内部视觉系统不是固定不变。`
        : `7. 明确不能变的内容：后续上传的新产品真实外观、品牌、包装结构、标签位置、颜色和比例；参考图的品牌、产品名、具体文案和卖点不能复制。
8. 明确可以变化的内容：根据当前图片判断哪些视觉机制可以迁移或重新设计。允许提出参考图中没有直接出现、但与参考图商业目的和视觉语法相容的新图形、材质、信息组织或制作方式；这些属于创意变化，不得复制竞品事实，也不能凭空改变用户产品身份。`;

    return `请基于参考图片做一次“商业视觉拆解分析”，输出必须是中文。

${modeRule}

重要：这是反推流程第 1 步，只做拆解分析，不要输出任何【可连线提示词】标记，不要生成 5 个方案。

请像资深设计师复盘一样，把参考图拆清楚：
1. 这张图的最终画面是什么，不要只说“产品图”，要说明它如何组织产品、文字、图形、背景和视觉重心。
2. 按画面实际存在的层次拆解背景、主体、包装/配件关系、文字信息、装饰元素、阴影反光、前景和后景；没有的元素不要补。
3. 记录主体数量、相对位置、占画面比例、裁切方式、视线动线、镜头角度、光线方向和材质表现。
4. 逐项记录参考图中能读到的文字及其位置、大小、层级、对齐方式和作用；看不清的写“部分文字不可读”，绝不猜写。
5. 把“参考产品自身内容”和“可迁移的画面构成”分开：品牌、产品名、包装文字、卖点、规格属于前者；构图关系、信息组织和视觉元素属于后者。
6. 列出图片中确实存在的可迁移元素，并说明它们在画面中的作用。不要为了凑数量添加图片里没有的元素。
${variabilityRule}

输出必须是中文，内容越像给设计团队的拆解说明越好。`;
}

function buildReverseVisionMessages(prompt: string, imageDataUrl: string): AiTextMessage[] {
    return [
        {
            role: "user",
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageDataUrl } },
            ],
        },
    ];
}

function buildReversePromptRoutePlansRequest(analysis: string, sourcePrompt: string) {
    const compactAnalysis = compactReverseAnalysis(analysis, 5200);
    const isMain = sourcePrompt.includes("本次反推用途：主图");
    if (isMain) {
        return `你是一名 Amazon 包装视觉设计总监。请重新查看原参考图，并结合第一步分析，为用户新产品规划 5 套真实、可执行、彼此明显不同的纯白底包装标签设计方案。

完全锁定的共同底图：
1. 纯白背景 RGB 255,255,255，产品完整清晰并保持当前参考画面的商品数量、位置、机位、透视、构图、占画比例、接地阴影和灯光。
2. 保持用户新产品真实的物理轮廓、包装尺寸、容器/盒体结构、开合方式、材质边界和标签可印刷区域，不增加、删除、打开或拆分商品。
3. 商品外部不得出现文字、卖点、信息卡、徽章、图标、色块、边框、水印、轨道、蓝图、装饰线、道具或场景。
4. 用户产品真实品牌、产品名、规格和已有文字事实必须保留，不复制参考产品的品牌、原文案或具体产品信息，不虚构新卖点。

五套差异只允许发生在包装表面的可设计标签层。每套都必须根据当前参考图的视觉证据，自行推导一个不同的标签设计命题；不要套用预设风格清单。可以变化的是包装印刷区内的核心视觉母题、图形与文字的组织关系、信息层级、版面节奏、色彩关系、局部纹理以及可被摄影呈现的印刷工艺。不能改变背景、产品物理结构、拍摄画面或真实文字事实。

先在内部检查五套方案：
- 每套必须描述同一张固定白底商品画面中的一套确定标签成片，不写备选项。
- 任意两套至少在“核心标签母题、信息层级、图形分布、版面节奏、色彩关系、印刷/材质表现”中的两项存在实质区别。
- 不能只更换颜色、形容词或微小装饰；必须让人一眼看出五套标签的设计逻辑不同。
- 五套都要与当前参考图的产品定位和可迁移视觉资产有关，不能为了不同而随意编造与产品无关的图案。

只输出一个可被 JSON.parse 直接解析的合法 JSON 对象，不要 Markdown、代码块、开场白或总结。根对象只能包含 plans，plans 必须正好 5 项。每项只能包含字符串键：
title、creativeThesis、visibleMechanism、referenceEvidence、targetFrame、productRole、textStrategy、visualFingerprint、nonOverlap。

字段要求：
- title：一句能看出标签设计差异的短标题。
- creativeThesis：说明这套标签依靠什么视觉概念成立。
- visibleMechanism：写清包装印刷区内具体可见的图形、版式、色彩和工艺机制。
- referenceEvidence：引用原图中两到三项真实标签或包装视觉证据。
- targetFrame：描述固定白底商品画面中，标签完成设计后的可见成片。
- productRole：说明标签如何服务用户新产品的品类识别、品牌识别和购买理解。
- textStrategy：说明真实品牌、产品名、规格与已有文字如何重新建立层级，但不得改写或新增内容。
- visualFingerprint：用一句话概括最容易辨认的标签视觉特征。
- nonOverlap：指出这套标签不能退回哪一种与其他方案相似的图形或版式逻辑。

原参考图和视觉拆解分析（原图优先）：
${compactAnalysis}`;
    }

    const modeRule = "本次用途是副图：可以迁移参考图中真实存在的环境、氛围、信息表达和视觉动线，也可以在同一商业视觉语法下提出合理的新表达。";

    return `你是一名商业视觉创意总监。你正在把一张参考商业图片拆成五条可以真正产生不同成片的设计路线。本次请求同时附带第一步视觉拆解分析和原参考图；必须重新查看原图，不能只依据文字分析。

${modeRule}

先做一个内部判断：这张图真正依赖的设计资产是什么？例如某种包装与内物的关系、某种阅读顺序、某种材质对比、某种图形如何承担信息、某种视觉动线如何建立商业目的。不要先预设五种风格，再把图片硬套进去。

五条路线必须像五位设计师各自重新思考同一张图，而不是同一模板的五次改写。每条路线都要从原图中抓取至少两项具体事实作为依据，再提出一个会改变“画面为什么成立”的完整设计命题。这个命题必须改变主体关系、信息结构、材质与图形的协作方式、视觉叙事或观看顺序中的至少一项；单独改变产品位置、文字位置、留白、背景颜色、光线形容词、材质形容词或产品大小，都不算新路线。

五个方案必须满足：
1. 每个方案只设一个主导的、最终图片中肉眼可见的设计机制，并说明它如何改变画面的视觉叙事、信息组织、材质表达或产品呈现方式。
2. 五个机制必须互不相同。“产品放左/放右”“文字放上/放下”“换背景颜色”“换一个高级形容词”不能单独算作不同方案。
3. 不要使用预设风格清单。五个机制必须根据当前参考图的真实资产、商业目的、可变部分和缺失机会临场推导。
4. 每个方案描述一个明确成片，不写备选项。允许从参考图的商业目的和视觉语法推导新的图形、材质、信息组织或制作方式，但不能复制竞品品牌、包装、原文案或具体事实。
5. 五个方案要先在内部进行横向比较：任意两套的视觉中心、主体关系、信息架构、图形/材质干预和观看路径中，至少有两项存在实质区别。
6. 用户新产品的真实外观、品牌、包装结构、颜色、标签位置和比例，以及不复制竞品内容等要求，是五套方案共同遵守的底线，只在这里规定一次，不要在每个方案里重复。
7. 不要写最终生图提示词，不要虚构用户产品名称、规格、功效或包装文字。

只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要开场白，不要总结。JSON 必须能被 JSON.parse 直接解析。
根对象只能包含一个键：plans。
plans 必须是长度正好为 5 的数组。
plans 数组里的每个对象都只能包含这些字符串键：title、creativeThesis、visibleMechanism、referenceEvidence、targetFrame、productRole、textStrategy、visualFingerprint、nonOverlap。
不要把字段说明、字数说明或本段规则复制进 JSON 值里。JSON 值必须是你根据原图独立思考后写出的实际方案内容。
字段内容要求：
- title：短标题。
- creativeThesis：一句话说明这套方案让画面依靠什么成立，不写抽象风格词。
- visibleMechanism：说明最终图片里能直接看到的独有设计干预，必须能与另外四套一眼区分。
- referenceEvidence：只写支撑这条路线的两到三项原图事实，不复述整份分析。
- targetFrame：具体描述最终成片的主体关系、信息结构、图形或材质协作和观看顺序。
- productRole：说明用户新产品在这套画面中的独特角色，不重复共同真实性规则。
- textStrategy：只说明本方案独有的文字呈现方法，不重复“不复制竞品文案”等共同规则。
- visualFingerprint：用一句短句概括视觉中心、主体关系、信息架构、图形/材质干预和观看路径。
- nonOverlap：明确本方案不能退回哪一种与其他方案相似的表达。

五个 title、creativeThesis、visibleMechanism 和 visualFingerprint 不能同义改写，不能共享同一个目标画面骨架。

    原参考图和视觉拆解分析（图片优先）：
${compactAnalysis}`;
}

function compactReverseAnalysis(analysis: string, maxLength: number) {
    if (analysis.length <= maxLength) return analysis;
    const headLength = Math.floor(maxLength * 0.55);
    const tailLength = maxLength - headLength;
    return `${analysis.slice(0, headLength)}\n\n（中间部分已压缩；以下保留分析结尾的可变项、迁移判断和结论。）\n\n${analysis.slice(-tailLength)}`;
}

function buildReversePromptFinalBatchRequest(analysis: string, routePlans: ReverseWorkflowPlan[], sourcePrompt: string) {
    const compactAnalysis = compactReverseAnalysis(analysis, 4200);
    const compactRoutes = routePlans
        .map((plan) => `【设计方案${plan.index}｜${plan.title}】\n${plan.content}`)
        .join("\n\n");
    const isMain = sourcePrompt.includes("本次反推用途：主图");
    if (isMain) {
        return `请再次查看原参考图片，在同一次回答中把下面 5 套包装标签方案改写成 5 条可直接交给图片生成模型执行的 Amazon 白底包装主图中文提示词。

固定不变的画面底座：
- 纯白背景 RGB 255,255,255，只展示用户上传的新产品，保持商品数量、物理轮廓、包装尺寸和结构、位置、机位、透视、构图、占画比例、光线和接地阴影完全一致。
- 商品外部不出现任何文字、Logo、卖点、信息卡、徽章、图标、轨道、蓝图、装饰线、色块、边框、水印、道具、人物或生活场景。
- 不添加、删除、打开或拆分商品与包装，不改变容器、盒体、瓶盖、袋型或标签物理边界。

五条之间只执行方案规定的包装标签差异：
- 只在包装正面、侧面或原有标签可印刷区域内重做视觉设计。
- 保留用户产品真实品牌、产品名、规格、必要说明和已有文字事实；可以重建字号、层级、对齐、留白和组合关系，但不能改写、删除关键事实或虚构新文案。
- 每条必须写清独有的核心标签母题、图形如何分布、文字如何建立层级、色彩如何协作、局部纹理或印刷工艺如何呈现。
- 五套不能只是颜色或装饰细节不同，任意两套至少在核心母题、信息层级、版面结构、图形分布、色彩关系和工艺表现中的两项明显不同。
- 参考图只提供设计方法，不复制参考品牌、产品名、原文案和具体图形。

每条 260-420 个中文字，以“生成一张符合 Amazon 展示要求的纯白底包装主图”开头。先说明固定画面和真实产品，再用主要篇幅说明本方案独有的标签设计，最后重申所有变化仅限包装印刷区域。

按以下标记输出，除五个标记和正文外不要输出其他内容：
【可连线提示词1｜标题】至【可连线提示词5｜标题】

第一步分析：
${compactAnalysis}

五套包装标签设计方案：
${compactRoutes}`;
    }

    const modeRule = "这是副图任务：根据参考图中真实可见的场景、氛围、信息表达和构图机制生成不同画面，不把参考产品本身带入新图。";

    return `请再次查看本次请求中附带的原参考图片，并在同一次回答中为下面五套设计方案分别写出五条可直接交给图片生成模型执行的中文提示词。原图是事实依据，文字分析只是辅助。${modeRule}

这是一个“协同生成”任务。你必须同时看见五套方案并横向比较后再写，不能把五条写成同一画面骨架的五次改写。

先在内部完成但不要输出比较表：
1. 为每套方案提取一个肉眼可见的核心设计机制。
2. 比较五套最终成片的视觉中心、主体关系、信息架构、图形/材质干预和观看路径。
3. 任意两条至少在上述两项存在实质区别；仅改变产品位置、文字位置、形容词、颜色深浅、留白多少或镜头轻微角度不算区别。
4. 如果设计方案本身发生碰撞，先根据原图事实重新拉开机制，再写最终提示词。

共同底线只需在每条结尾用一到两句简洁表达，不要让它淹没独有设计：
- 以用户上传的新产品图为唯一产品主体，保留真实外观、品牌、包装结构、颜色、标签位置、比例和确实可读的文字。
- 不复制参考产品的品牌、产品名、文案、规格、功效或图形文字，不虚构用户产品不存在的信息。

每条提示词要求：
- 先用主要篇幅写本方案独有的可见设计机制、画面关系、信息组织、材质/图形协作和观看结果，再写共同底线。
- 描述一个确定成片，不写“如果、或者、可选择”等备选表达，不输出分析报告、模型、API 或文件名。
- 每条 300-520 个中文字，以“生成一张...”开头。
- 五条分别使用【可连线提示词1｜标题】到【可连线提示词5｜标题】标记；标记后直接写提示词正文。
- 除这五个标记和五条正文外，不输出开场白、解释、总结或比较过程。

第一步视觉拆解（保留了开头事实与结尾迁移判断）：
${compactAnalysis}

五套必须互相区分的设计方案：
${compactRoutes}`;
}

function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

function createSizedTextNode(position: Position, size: { width: number; height: number }, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const node = createCanvasNode(CanvasNodeType.Text, position, metadata);
    return {
        ...node,
        position: {
            x: position.x - size.width / 2,
            y: position.y - size.height / 2,
        },
        width: size.width,
        height: size.height,
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <CanvasWorkspacePage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function ConnectionCreateMenu({ pending, onCreate, onClose }: { pending: PendingConnectionCreate; onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button type="button" className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition" style={{ color: theme.node.text }} onClick={onClick} onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)} onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>{description}</span> : null}
            </span>
        </button>
    );
}

function CanvasWorkspacePage() {
    const { message, modal } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = params.id;
    const localAgentConnected = useCanvasAgentStore((state) => state.connected);
    const localAgentActivity = useCanvasAgentStore((state) => state.activity);
    const localAgentEnabled = useCanvasAgentStore((state) => state.enabled);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const addMonitorEntry = useGenerationMonitorStore((state) => state.addEntry);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [monitorOpen, setMonitorOpen] = useState(false);
    const [promptGeneratorOpen, setPromptGeneratorOpen] = useState(false);
    const [promptGeneratorInput, setPromptGeneratorInput] = useState("");
    const [promptGenerating, setPromptGenerating] = useState(false);
    const [reverseWorkflow, setReverseWorkflow] = useState<ReverseWorkflowState | null>(null);
    const [reverseWorkflowOpen, setReverseWorkflowOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [agentMode, setAgentMode] = useState<CanvasAgentMode>("online");
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const codexAutoConnect = ["new", "recent", "choose"].includes(searchParams.get("mode") || "");
    const codexCompactAgent = codexAutoConnect && searchParams.has("agentUrl");
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const agentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } }
                    : node,
            ),
        );
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            router.replace("/canvas");
            return;
        }

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, openProject, projectId, router]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (searchParams.has("agentUrl")) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous?.nodes === next.nodes && previous.connections === next.connections && previous.chatSessions === next.chatSessions && previous.activeChatId === next.activeChatId && previous.backgroundMode === next.backgroundMode && previous.showImageInfo === next.showImageInfo) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(
        () => () => {
            if (agentCloseTimerRef.current) clearTimeout(agentCloseTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProject?.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProject?.title, nodes, projectId, selectedNodeIds, viewport],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: currentProject?.title || "未命名画布", nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(before, safeOps.filter((op) => op.type !== "run_generation"));
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "";
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: currentProject?.title || "未命名画布" };
        },
        [currentProject?.title, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: currentProject?.title || "未命名画布" };
    }, [agentUndoSnapshot, currentProject?.title, projectId]);
    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...nextNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`EONS 画布 ${useCanvasStore.getState().projects.length + 1}`);
        router.push(`/canvas/${id}`);
    }, [createProject, router]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        router.push("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, router]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.find((item) => item.id === node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          width: child.width,
                          height: child.height,
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            const projectTitle = currentProject?.title || "未命名画布";
            const tags = ["画布", projectTitle].filter(Boolean);
            const metadata = { source: "canvas", projectId, projectTitle, nodeId: node.id, prompt: node.metadata?.prompt };
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags, source: projectTitle, data: { content }, metadata });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({ kind: "video", title: node.metadata?.prompt?.slice(0, 24) || "画布视频", coverUrl: "", tags, source: projectTitle, data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" }, metadata });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: node.metadata.content,
                tags,
                source: projectTitle,
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata,
            });
            message.success("已加入我的素材");
        },
        [addAsset, currentProject?.title, message, projectId],
    );

    const openReverseWorkflow = useCallback((node: CanvasNodeData, mode: ReversePromptMode) => {
        setReverseWorkflow((current) => {
            const sameSource =
                current?.node.id === node.id &&
                current.mode === mode &&
                current.node.metadata?.content === node.metadata?.content &&
                current.node.metadata?.storageKey === node.metadata?.storageKey;
            return sameSource ? current : { node, mode, stage: "analysis", analysis: "", plans: [], prompts: [], loading: false };
        });
        setReverseWorkflowOpen(true);
        setContextMenu(null);
    }, []);

    const runReverseWorkflowAnalysis = useCallback(async () => {
        if (!reverseWorkflow?.node.metadata?.content || reverseWorkflow.loading) return;
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            message.warning("请先完成文本模型配置");
            return;
        }
        setReverseWorkflow((current) => (current ? { ...current, loading: true, error: undefined } : current));
        try {
            const imageDataUrl = await imageToDataUrl({
                dataUrl: reverseWorkflow.node.metadata.content,
                storageKey: reverseWorkflow.node.metadata.storageKey,
            });
            if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
                throw new Error("参考图无法转换为可发送的图片数据，请重新上传图片");
            }
            const analysis = await requestImageQuestion(
                requestConfig,
                buildReverseVisionMessages(buildReversePromptAnalysisOnlyRequest(buildImagePromptReversePreset(reverseWorkflow.mode)), imageDataUrl),
                () => {},
                { temperature: 0.25, topP: 0.85, maxTokens: 3600, stream: false },
            );
            setReverseWorkflow((current) => (current ? { ...current, stage: "plans", analysis, loading: false } : current));
        } catch (error) {
            const details = error instanceof Error ? error.message : "参考图分析失败";
            setReverseWorkflow((current) => (current ? { ...current, loading: false, error: details } : current));
            message.error(details);
        }
    }, [effectiveConfig, isAiConfigReady, message, reverseWorkflow]);

    const runReverseWorkflowPlans = useCallback(async () => {
        if (!reverseWorkflow?.analysis || reverseWorkflow.loading) return;
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            message.warning("请先完成文本模型配置");
            return;
        }
        setReverseWorkflow((current) => (current ? { ...current, loading: true, error: undefined } : current));
        try {
            const response = await requestImageQuestion(
                requestConfig,
                [{ role: "user", content: buildReversePromptRoutePlansRequest(reverseWorkflow.analysis, buildImagePromptReversePreset(reverseWorkflow.mode)) }],
                () => {},
                { temperature: 0.85, topP: 0.95, maxTokens: 6500, stream: false },
            );
            const plans = splitReverseRoutePlans(response);
            if (!plans || plans.length !== 5) throw new Error(`模型返回了内容，但没有解析到五套完整设计方案。原始返回前 300 字：${response.slice(0, 300)}`);
            setReverseWorkflow((current) => (current ? { ...current, stage: "plans", plans, loading: false } : current));
        } catch (error) {
            const details = error instanceof Error ? error.message : "设计方案生成失败";
            setReverseWorkflow((current) => (current ? { ...current, loading: false, error: details } : current));
            message.error(details);
        }
    }, [effectiveConfig, isAiConfigReady, message, reverseWorkflow]);

    const runReverseWorkflowPrompts = useCallback(async () => {
        if (!reverseWorkflow?.analysis || reverseWorkflow.plans.length !== 5 || reverseWorkflow.loading) return;
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            message.warning("请先完成文本模型配置");
            return;
        }
        setReverseWorkflow((current) => (current ? { ...current, loading: true, prompts: [], error: undefined } : current));
        try {
            const generated = await requestImageQuestion(
                requestConfig,
                [{ role: "user", content: buildReversePromptFinalBatchRequest(reverseWorkflow.analysis, reverseWorkflow.plans, buildImagePromptReversePreset(reverseWorkflow.mode)) }],
                () => {},
                { temperature: 0.9, topP: 0.95, maxTokens: 5200, stream: false },
            );
            const split = splitReversePromptOutput(generated);
            if (!split || split.prompts.length !== 5) {
                throw new Error(`模型返回了内容，但没有解析到五条完整提示词。原始返回前 300 字：${generated.slice(0, 300)}`);
            }
            setReverseWorkflow((current) => (current ? { ...current, prompts: split.prompts.map((item) => item.content), loading: false } : current));
        } catch (error) {
            const details = error instanceof Error ? error.message : "完整提示词生成失败";
            setReverseWorkflow((current) => (current ? { ...current, loading: false, error: details } : current));
            message.error(details);
        }
    }, [effectiveConfig, isAiConfigReady, message, reverseWorkflow]);

    const createReverseWorkflowPromptNodes = useCallback(() => {
        if (!reverseWorkflow || reverseWorkflow.prompts.length !== 5) return;
        const source = reverseWorkflow.node;
        const gap = 120;
        const promptNodes = reverseWorkflow.prompts.map((content, index) => {
            const plan = reverseWorkflow.plans[index];
            const center = {
                x: source.position.x + source.width + gap + LONG_PROMPT_NODE_SIZE.width / 2,
                y: source.position.y + source.height / 2 - ((reverseWorkflow.prompts.length - 1) * (LONG_PROMPT_NODE_SIZE.height + 36)) / 2 + index * (LONG_PROMPT_NODE_SIZE.height + 36),
            };
            return {
                ...createSizedTextNode(center, LONG_PROMPT_NODE_SIZE, { content, prompt: content, status: NODE_STATUS_SUCCESS, fontSize: READABLE_TEXT_FONT_SIZE }),
                title: `可连线提示词 ${index + 1}｜${plan?.title || "设计方案"}`.slice(0, 48),
            };
        });
        setNodes((prev) => [...prev, ...promptNodes]);
        setConnections((prev) => [...prev, ...promptNodes.map((promptNode) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: promptNode.id }))]);
        setSelectedNodeIds(new Set(promptNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setDialogNodeId(promptNodes[0]?.id || null);
        setReverseWorkflow(null);
        setReverseWorkflowOpen(false);
        message.success("已创建 5 个独立提示词节点。请将自己的产品图连接到生图配置。");
    }, [message, reverseWorkflow]);

    const chooseImageReversePromptMode = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }
            modal.confirm({
                title: "选择反推用途",
                content: (
                    <div className="space-y-2 text-sm leading-relaxed">
                        <p>主图：白底、产品结构、构图和光影保持固定，生成 5 套明显不同的包装标签视觉方案；变化只发生在包装可印刷区域。</p>
                        <p>副图：根据参考图本身独立发散，生成 5 个差异明显的商业视觉方案，不套用固定方向。</p>
                    </div>
                ),
                okText: "主图",
                cancelText: "副图",
                maskClosable: false,
                onOk: () => openReverseWorkflow(node, "main"),
                onCancel: () => openReverseWorkflow(node, "secondary"),
            });
        },
        [message, modal, openReverseWorkflow],
    );

    const createGeneratedPromptNode = useCallback(
        (content: string) => {
            const text = content.trim();
            if (!text) return;
            const selectedImages = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type === CanvasNodeType.Image && node.metadata?.content);
            const anchor = selectedImages[0];
            const center = anchor ? { x: anchor.position.x + anchor.width + 120 + LONG_PROMPT_NODE_SIZE.width / 2, y: anchor.position.y + anchor.height / 2 } : getCanvasCenter();
            const node = {
                ...createSizedTextNode(center, LONG_PROMPT_NODE_SIZE, { content: text, prompt: text, status: NODE_STATUS_SUCCESS, fontSize: READABLE_TEXT_FONT_SIZE }),
                title: "生成提示词",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(node.id);
            setPromptGeneratorOpen(false);
            setPromptGeneratorInput("");
            message.success("提示词已生成");
        },
        [getCanvasCenter, message],
    );

    const generatePromptNode = useCallback(async () => {
        const need = promptGeneratorInput.trim();
        if (!need) {
            message.warning("请输入需求");
            return;
        }
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel };
        if (!useConfigStore.getState().isAiConfigReady(requestConfig, requestConfig.model)) {
            message.warning("请先完成文本模型配置");
            return;
        }

        setPromptGenerating(true);
        const startedAt = performance.now();
        let selectedImageCount = 0;
        try {
            const selectedImages = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && node.type === CanvasNodeType.Image && node.metadata?.content).slice(0, 4);
            selectedImageCount = selectedImages.length;
            const imageParts = await Promise.all(
                selectedImages.map(async (node) => {
                    const metadata = node.metadata;
                    return {
                        type: "image_url" as const,
                        image_url: { url: await imageToDataUrl({ dataUrl: metadata?.content || "", storageKey: metadata?.storageKey }) },
                    };
                }),
            );
            const text =
                "你是一名 Amazon 资深电商美工、产品摄影指导和高转化主图设计师。你的任务是把用户的简单中文需求改写成可直接用于 AI 图片生成模型的中文提示词。\n\n" +
                "只输出最终中文提示词正文，不要解释，不要编号，不要 Markdown，不要夹杂英文专业短语。\n\n" +
                "核心目标：生成高级、干净、真实、适合 Amazon / 独立站商品页的商业产品图，而不是艺术图、随手拼贴图或廉价合成图。\n\n" +
                "如果提供了参考图片：必须保留参考产品的品牌识别、包装比例、瓶型/盒型、主色、标签位置、配件类型和核心视觉层级；允许优化灯光、背景、角度、构图和质感；禁止把产品改成另一个品牌或另一套包装。\n\n" +
                "提示词必须包含：主体说明、产品保真要求、构图、镜头角度、光线、背景、材质、阴影、商业用途、质量等级和负面约束。\n\n" +
                "必须包含这些负面约束：不要额外文字、不要水印、不要扭曲 logo、不要虚构包装、不要畸形瓶身、不要不可读标签、不要杂乱道具、不要低清晰度、不要卡通风格。\n\n" +
                `用户需求：${need}`;
            const answer = await requestImageQuestion(requestConfig, [{ role: "user", content: imageParts.length ? [{ type: "text", text }, ...imageParts] : text }], () => {});
            createGeneratedPromptNode(answer || need);
            addMonitorEntry({
                scope: "canvas",
                action: "prompt",
                status: "success",
                model: requestConfig.model,
                count: 1,
                successCount: 1,
                failCount: 0,
                referenceCount: selectedImageCount,
                promptPreview: need.slice(0, 220),
                durationMs: performance.now() - startedAt,
                projectId,
                projectTitle: currentProject?.title,
                config: requestConfig,
            });
        } catch (error) {
            const errorDetails = error instanceof Error ? error.message : "提示词生成失败";
            message.error(errorDetails);
            addMonitorEntry({
                scope: "canvas",
                action: "prompt",
                status: "failed",
                model: requestConfig.model,
                count: 1,
                successCount: 0,
                failCount: 1,
                referenceCount: selectedImageCount,
                promptPreview: need.slice(0, 220),
                error: errorDetails,
                durationMs: performance.now() - startedAt,
                projectId,
                projectTitle: currentProject?.title,
                config: requestConfig,
            });
        } finally {
            setPromptGenerating(false);
        }
    }, [addMonitorEntry, createGeneratedPromptNode, currentProject?.title, effectiveConfig, message, projectId, promptGeneratorInput]);

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            const startedAt = performance.now();
            try {
                const maskReference = { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl, referenceDataUrl: payload.maskPreviewDataUrl } as ReferenceImage & { referenceDataUrl?: string };
                const image = await requestEdit(generationConfig, prompt, [source], maskReference, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
                addMonitorEntry({
                    scope: "canvas",
                    action: "mask-edit",
                    status: "success",
                    model: generationConfig.model,
                    count: 1,
                    successCount: 1,
                    failCount: 0,
                    referenceCount: 1,
                    promptPreview: userPrompt.slice(0, 220),
                    durationMs: performance.now() - startedAt,
                    projectId,
                    projectTitle: currentProject?.title,
                    nodeId: node.id,
                    config: generationConfig,
                });
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                addMonitorEntry({
                    scope: "canvas",
                    action: "mask-edit",
                    status: "failed",
                    model: generationConfig.model,
                    count: 1,
                    successCount: 0,
                    failCount: 1,
                    referenceCount: 1,
                    promptPreview: userPrompt.slice(0, 220),
                    error: errorDetails,
                    durationMs: performance.now() - startedAt,
                    projectId,
                    projectTitle: currentProject?.title,
                    nodeId: node.id,
                    config: generationConfig,
                });
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [addMonitorEntry, currentProject?.title, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }], undefined, { signal: controller.signal }).then(
                    (items) => items[0],
                );
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;

            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Audio, title: file.name, position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 }, width: spec.width, height: spec.height, metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const pasteAssistantImage = useCallback(
        (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            void createImageFileNode(file, position);
            message.success("已从剪切板添加图片");
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count - 1 }, () => nanoid()) : [];
                    const targetIds = count > 1 ? [rootId, ...childIds] : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: READABLE_TEXT_FONT_SIZE, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    const batchStartedAt = performance.now();
                    let hasSuccess = false;
                    let hasFailure = false;
                    let successCount = 0;
                    let failureCount = 0;
                    let lastErrorDetails = "";
                    for (const [targetIndex, targetId] of targetIds.entries()) {
                        if (controller.signal.aborted) break;
                        const variantPrompt = imageVariationPrompt(effectivePrompt, targetIndex, count, referenceImages.length > 0);
                        try {
                            const image = referenceImages.length
                                ? await requestEdit({ ...generationConfig, count: "1" }, variantPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0])
                                : await requestGeneration({ ...generationConfig, count: "1" }, variantPrompt, { signal: controller.signal }).then((items) => items[0]);
                            const uploaded = await uploadImage(image.dataUrl);
                            const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                            setNodes((prev) => {
                                const root = prev.find((node) => node.id === rootId);
                                return prev.map((node) => {
                                    if (node.id !== targetId && node.id !== rootId) return node;
                                    const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                    if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                        return {
                                            ...node,
                                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                            width: imageSize.width,
                                            height: imageSize.height,
                                            metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId },
                                        };
                                    if (node.id === targetId)
                                        return {
                                            ...node,
                                            position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                            width: imageSize.width,
                                            height: imageSize.height,
                                            metadata: { ...node.metadata, ...imageMetadata(uploaded) },
                                        };
                                    return node;
                                });
                            });
                            hasSuccess = true;
                            successCount += 1;
                            if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                        } catch (error) {
                            if (isGenerationCanceled(error)) break;
                            const errorDetails = error instanceof Error ? error.message : "生成失败";
                            hasFailure = true;
                            failureCount += 1;
                            lastErrorDetails = errorDetails;
                            setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                        } finally {
                            finishGenerationRequest(targetId, controller);
                        }
                    }
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    addMonitorEntry({
                        scope: "canvas",
                        action: referenceImages.length ? "edit" : "generate",
                        status: hasSuccess ? "success" : "failed",
                        model: generationConfig.model,
                        count,
                        successCount,
                        failCount: failureCount,
                        referenceCount: referenceImages.length,
                        promptPreview: effectivePrompt.slice(0, 220),
                        error: hasFailure ? lastErrorDetails || (hasSuccess ? "部分图片生成失败" : "全部图片生成失败") : undefined,
                        durationMs: performance.now() - batchStartedAt,
                        projectId,
                        projectTitle: currentProject?.title,
                        nodeId,
                        config: generationConfig,
                    });
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) => (isEmptyVideoNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode]));
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal }));
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 }, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) } } : node)));
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) => (isEmptyAudioNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode]));
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                const isReversePromptRun = isConfigNode && isReversePromptRequest(effectivePrompt);
                const outputTextConfig = isReversePromptRun ? REVERSE_PROMPT_RESULT_NODE_SIZE : textConfig;
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - outputTextConfig.height / 2 + (index - (textCount - 1) / 2) * (outputTextConfig.height + 36),
                        },
                        width: outputTextConfig.width,
                        height: outputTextConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: READABLE_TEXT_FONT_SIZE },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers =
                    isReversePromptRun && childIds.length === 1
                        ? await (async () => {
                              const targetNodeId = childIds[0];
                              try {
                                  let analysisStreamed = "";
                                  const analysis = await requestImageQuestion(
                                      generationConfig,
                                      buildNodeResponseMessages({ ...generationContext, prompt: buildReversePromptAnalysisOnlyRequest(effectivePrompt) }),
                                      (text) => {
                                          analysisStreamed = text;
                                          streamed = text;
                                          setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, title: "反推分析中", type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                                      },
                                      { signal: controller.signal, temperature: 0.3, topP: 0.85, maxTokens: 3000 },
                                  );
                                  if (controller.signal.aborted) return [{ nodeId: targetNodeId, content: analysis || analysisStreamed }];
                                  const analysisContent = analysis || analysisStreamed;
                                  const routePlans = await requestImageQuestion(
                                      generationConfig,
                                      buildNodeResponseMessages({ ...generationContext, prompt: buildReversePromptRoutePlansRequest(analysisContent, effectivePrompt) }),
                                      () => {},
                                      { signal: controller.signal, temperature: 0.9, topP: 0.98, maxTokens: 4200 },
                                  );
                                  if (controller.signal.aborted) return [{ nodeId: targetNodeId, content: analysisContent }];
                                  const routePlanItems = splitReverseRoutePlans(routePlans);
                                  if (!routePlanItems) throw new Error("视觉模型没有返回五条独立路线，请重试");
                                  if (controller.signal.aborted) return [{ nodeId: targetNodeId, content: analysisContent }];
                                  const generated = await requestImageQuestion(
                                      generationConfig,
                                      buildNodeResponseMessages({
                                          ...generationContext,
                                          prompt: buildReversePromptFinalBatchRequest(analysisContent, routePlanItems, effectivePrompt),
                                      }),
                                      () => {},
                                      { signal: controller.signal, temperature: 0.9, topP: 0.95, maxTokens: 5200 },
                                  );
                                  const split = splitReversePromptOutput(generated);
                                  if (!split || split.prompts.length !== 5) throw new Error("视觉模型没有返回五条完整提示词，请重试");
                                  const promptOutput = split.prompts.map((prompt, index) => `【可连线提示词${index + 1}｜${routePlanItems[index]?.title || prompt.title}】\n${prompt.content}`).join("\n\n");
                                  streamed = `${analysisContent}\n\n${promptOutput}`;
                                  return [{ nodeId: targetNodeId, content: streamed }];
                              } finally {
                                  finishGenerationRequest(targetNodeId, controller);
                              }
                          })()
                        : await Promise.all(
                              textTargetIds.map((targetNodeId) => {
                                  let localStreamed = "";
                                  return requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }), (text) => {
                                      localStreamed = text;
                                      streamed = text;
                                      if (isConfigNode) return;
                                      setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                                  }, { signal: controller.signal, ...(isReversePromptRun ? { temperature: 0.92, topP: 0.96 } : {}) })
                                      .then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }))
                                      .finally(() => finishGenerationRequest(targetNodeId, controller));
                              }),
                          );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                let reversePromptResult = isConfigNode && childIds.length === 1 && isReversePromptRequest(effectivePrompt) ? splitReversePromptOutput(answerByNodeId.get(childIds[0]) || streamed) : null;
                const parsedReversePromptResult = reversePromptResult;
                if (parsedReversePromptResult?.prompts.length === 5) {
                    const promptCount = Math.min(5, parsedReversePromptResult.prompts.length);
                    const promptNodes = parsedReversePromptResult.prompts.slice(0, 5).map((item, index) => {
                        const center = {
                            x: parentPosition.x + parentConfig.width + 96 + REVERSE_PROMPT_RESULT_NODE_SIZE.width + 96 + REVERSE_PROMPT_RESULT_NODE_SIZE.width / 2,
                            y: parentPosition.y + parentConfig.height / 2 - ((promptCount - 1) * (REVERSE_PROMPT_RESULT_NODE_SIZE.height + 40)) / 2 + index * (REVERSE_PROMPT_RESULT_NODE_SIZE.height + 40),
                        };
                        return {
                            ...createSizedTextNode(center, REVERSE_PROMPT_RESULT_NODE_SIZE, { content: item.content, prompt: item.content, status: NODE_STATUS_SUCCESS, fontSize: READABLE_TEXT_FONT_SIZE }),
                            title: `可连线提示词 ${item.index}｜${item.title}`.slice(0, 48),
                        };
                    });
                    setNodes((prev) => [
                        ...prev.map((node) =>
                            childIds.includes(node.id)
                                ? { ...node, title: "反推分析", width: REVERSE_PROMPT_RESULT_NODE_SIZE.width, height: REVERSE_PROMPT_RESULT_NODE_SIZE.height, metadata: { ...node.metadata, content: parsedReversePromptResult.analysis, status: NODE_STATUS_SUCCESS } }
                                : node.id === nodeId && isConfigNode
                                  ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                                  : node,
                        ),
                        ...promptNodes,
                    ]);
                    setConnections((prev) => [...prev, ...promptNodes.map((node) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: node.id }))]);
                    setSelectedNodeIds(new Set(promptNodes.map((node) => node.id)));
                    setSelectedConnectionId(null);
                    setDialogNodeId(promptNodes[0]?.id || childIds[0]);
                    message.success("反推分析和 5 个可连线提示词已生成");
                    return;
                }
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [addMonitorEntry, currentProject?.title, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...context, prompt }), (text) => {
                        streamed = text;
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                    }, { signal: controller.signal });
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal }));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal }).then((items) => items[0]) : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [...prev, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = (mode: CanvasAgentMode = agentMode) => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAgentMode(mode);
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    };
    const closeAgent = () => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    };

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => router.push("/")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={assistantOpen}
                    compactAgentStatus={codexCompactAgent ? { connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity } : undefined}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                />

                <CanvasSurface
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            renderPanel={(panelNode) =>
                                panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onGenerate={handleGenerateNode}
                                        onStop={confirmStopGeneration}
                                        onImageSettingsOpenChange={(open) => {
                                            setNodeImageSettingsOpen(open);
                                            if (open) setToolbarNodeId(null);
                                        }}
                                    />
                                )
                            }
                            renderNodeContent={(contentNode) => (
                                <CanvasConfigNodePanel
                                    node={contentNode}
                                    isRunning={runningNodeId === contentNode.id}
                                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                    onConfigChange={handleConfigNodeChange}
                                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                                    onStop={confirmStopGeneration}
                                    onGenerate={(nodeId) => {
                                        const target = nodesRef.current.find((item) => item.id === nodeId);
                                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                                    }}
                                />
                            )}
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                                keepNodeToolbar(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                                hideNodeToolbar();
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node) => void handleRetryNode(node)}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onContextMenu={(event, id) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                </CanvasSurface>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(16, (node.metadata?.fontSize || READABLE_TEXT_FONT_SIZE) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || READABLE_TEXT_FONT_SIZE) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={chooseImageReversePromptMode}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onGeneratePrompt={() => setPromptGeneratorOpen(true)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                    onOpenMonitor={() => setMonitorOpen(true)}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} /> : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} /> : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? (
                        <img
                            src={previewNode.metadata.content}
                            alt={previewNode.title || "图片"}
                            style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
                        />
                    ) : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
                <GenerationMonitorModal open={monitorOpen} onClose={() => setMonitorOpen(false)} />
                <Modal
                    title="反推提示词工作流"
                    open={reverseWorkflowOpen && Boolean(reverseWorkflow)}
                    width={1120}
                    centered
                    destroyOnClose={false}
                    maskClosable={false}
                    keyboard={false}
                    onCancel={() => {
                        if (reverseWorkflow?.loading) return;
                        setReverseWorkflowOpen(false);
                    }}
                    footer={null}
                >
                    {reverseWorkflow ? (
                        <div className="flex max-h-[76vh] flex-col gap-4 overflow-hidden">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="rounded-full bg-black px-3 py-1 text-white">1 分析参考图</span>
                                <span className={reverseWorkflow.stage !== "analysis" ? "rounded-full bg-black px-3 py-1 text-white" : "rounded-full bg-neutral-100 px-3 py-1 text-neutral-500"}>2 生成五套{reverseWorkflow.mode === "main" ? "标签" : "设计"}方案</span>
                                <span className={reverseWorkflow.prompts.length === 5 ? "rounded-full bg-black px-3 py-1 text-white" : "rounded-full bg-neutral-100 px-3 py-1 text-neutral-500"}>3 生成完整提示词</span>
                                <span className="ml-auto text-neutral-500">{reverseWorkflow.mode === "main" ? "Amazon 主图：固定画面，重做包装标签" : "副图模式：根据参考图动态发散"}</span>
                            </div>

                            {reverseWorkflow.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{reverseWorkflow.error}</div> : null}

                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                {reverseWorkflow.stage === "analysis" ? (
                                    <div className="space-y-4">
                                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 text-neutral-600">
                                            这一阶段只读取参考图并拆解视觉结构，不生成图片，也不会创建五条提示词。分析完成后，你可以先查看结果，再决定是否继续生成方案。
                                        </div>
                                        {reverseWorkflow.analysis ? <Input.TextArea value={reverseWorkflow.analysis} readOnly autoSize={{ minRows: 16, maxRows: 24 }} /> : null}
                                        <Button type="primary" loading={reverseWorkflow.loading} onClick={() => void runReverseWorkflowAnalysis()}>
                                            {reverseWorkflow.analysis ? "重新分析参考图" : "分析参考图"}
                                        </Button>
                                    </div>
                                ) : null}

                                {reverseWorkflow.stage === "plans" ? (
                                    <div className="space-y-4">
                                        <div>
                                            <div className="mb-2 text-base font-semibold">参考图拆解结果</div>
                                            <Input.TextArea value={reverseWorkflow.analysis} readOnly autoSize={{ minRows: 10, maxRows: 18 }} />
                                        </div>
                                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 text-neutral-600">
                                            {reverseWorkflow.mode === "main"
                                                ? "下一步生成五套包装标签方案。白底、产品物理结构、机位、构图和光影全部固定；五套差异只来自包装印刷区内的核心图形、信息层级、版式节奏、色彩关系和工艺表现。"
                                                : "下一步会先生成五套设计方案。每套方案必须有独立的核心变化机制，不能只改变产品左右位置、上下层级或背景颜色。"}
                                        </div>
                                        {reverseWorkflow.plans.length ? (
                                            <div className="grid gap-3 md:grid-cols-2">
                                                {reverseWorkflow.plans.map((plan) => (
                                                    <div key={plan.index} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                                                        <div className="mb-2 font-semibold">方案 {plan.index}：{plan.title}</div>
                                                        <div className="whitespace-pre-wrap text-sm leading-6 text-neutral-600">{plan.content}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        <div className="flex gap-2">
                                            <Button loading={reverseWorkflow.loading} onClick={() => void runReverseWorkflowPlans()}>
                                                {reverseWorkflow.plans.length ? "重新生成五套方案" : `生成五套${reverseWorkflow.mode === "main" ? "标签" : "设计"}方案`}
                                            </Button>
                                            {reverseWorkflow.plans.length === 5 ? <Button type="primary" onClick={() => { setReverseWorkflow((current) => (current ? { ...current, stage: "prompts" } : current)); void runReverseWorkflowPrompts(); }}>确认方案并生成提示词</Button> : null}
                                        </div>
                                    </div>
                                ) : null}

                                {reverseWorkflow.stage === "prompts" ? (
                                    <div className="space-y-4">
                                        <div className="grid gap-3 md:grid-cols-2">
                                            {reverseWorkflow.plans.map((plan) => (
                                                <div key={plan.index} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                                    <div className="mb-1 text-sm font-semibold">方案 {plan.index}：{plan.title}</div>
                                                    <div className="whitespace-pre-wrap text-xs leading-5 text-neutral-600">{plan.content}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                                            {reverseWorkflow.loading ? "正在同一次请求中协同生成并横向检查五条提示词……" : reverseWorkflow.prompts.length === 5 ? "五条提示词已在同一上下文中生成。确认后才会创建画布节点，不会调用图片生成接口。" : "确认上面的五套方案后，系统会在同一次请求中生成并比较五条完整提示词。"}
                                        </div>
                                        {reverseWorkflow.prompts.length ? (
                                            <div className="space-y-3">
                                                {reverseWorkflow.prompts.map((prompt, index) => (
                                                    <div key={index} className="rounded-xl border border-neutral-200 bg-white p-3">
                                                        <div className="mb-2 font-semibold">提示词 {index + 1}</div>
                                                        <Input.TextArea value={prompt} readOnly autoSize={{ minRows: 6, maxRows: 14 }} />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        <div className="flex gap-2">
                                            <Button loading={reverseWorkflow.loading} onClick={() => void runReverseWorkflowPrompts()}>
                                                {reverseWorkflow.prompts.length ? "重新生成五条提示词" : "生成五条完整提示词"}
                                            </Button>
                                            {reverseWorkflow.prompts.length === 5 ? <Button type="primary" onClick={createReverseWorkflowPromptNodes}>创建五个提示词节点</Button> : null}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </Modal>
                <Modal
                    title="生成提示词"
                    open={promptGeneratorOpen}
                    centered
                    okText="生成"
                    cancelText="取消"
                    confirmLoading={promptGenerating}
                    onOk={() => void generatePromptNode()}
                    onCancel={() => {
                        if (promptGenerating) return;
                        setPromptGeneratorOpen(false);
                    }}
                >
                    <Input.TextArea
                        autoFocus
                        rows={5}
                        value={promptGeneratorInput}
                        onChange={(event) => setPromptGeneratorInput(event.target.value)}
                        placeholder="例如：给这款除霉剂做一张高级感电商主图，突出清洁力和专业感"
                    />
                </Modal>
                {codexCompactAgent && !assistantMounted ? <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={Boolean(agentUndoSnapshot)} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} /> : null}
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onApplyOps={applyAgentOps}
                    canUndoOps={Boolean(agentUndoSnapshot)}
                    onUndoOps={undoAgentOps}
                    onPasteImage={pasteAssistantImage}
                    agentMode={agentMode}
                    onAgentModeChange={setAgentMode}
                    autoConnectLocal={codexAutoConnect}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                />
            ) : null}
        </main>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus?: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    <UserStatusActions
                        variant="canvas"
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                    />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "已连接到本地 Codex" : status.enabled ? status.activity || "连接中" : "正在连接本地 Codex";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-85"
            style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
            onClick={onClick}
            title="打开本地 Codex 面板"
        >
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[180px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return Math.max(1, Math.min(3, Math.floor(Math.abs(Number(count)) || 1)));
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    return {
        ...config,
        model: node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => (node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } } : node));
}

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
