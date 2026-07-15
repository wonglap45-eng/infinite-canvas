import axios from "axios";

import { buildApiUrl, resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText, imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

type ReferenceImageWithMaskPreview = ReferenceImage & { referenceDataUrl?: string };

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };
type ChatCompletionChoice = {
    message?: { content?: string; tool_calls?: ResponseToolCall[] };
    delta?: { content?: string; tool_calls?: Array<{ id?: string; index?: number; type?: "function"; function?: { name?: string; arguments?: string } }> };
};
type ChatCompletionPayload = {
    choices?: ChatCompletionChoice[];
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatStreamState = { buffer: string; text: string; error?: string; toolCalls: ResponseToolCall[] };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
type RequestOptions = { signal?: AbortSignal };
type OpenRouterImageReference = { type: "image_url"; image_url: { url: string } };
type UrlImagePayload = {
    model: string;
    prompt: string;
    n?: number;
    size?: string;
    input_references?: OpenRouterImageReference[];
};
type AsyncImageJobStart = { jobId?: string; status?: string; error?: string };
type AsyncImageJobPoll = { status?: "pending" | "done" | "failed" | "missing"; responseStatus?: number; body?: ImageApiResponse; error?: string };
const ASYNC_IMAGE_POLL_RETRY_LIMIT = 5;

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function isUrlImageModel(model: string) {
    const value = model.trim().toLowerCase();
    return value.includes("gpt-image") || value.includes("dall-e") || value.includes("dalle");
}

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

async function normalizeGeneratedImagesToSize(images: Array<{ id: string; dataUrl: string }>, requestSize: string | undefined) {
    const dimensions = requestSize ? parseImageDimensions(requestSize) : null;
    if (!dimensions) return images;
    return Promise.all(
        images.map(async (image) => {
            try {
                const normalizedDataUrl = await fitImageToExactCanvas(await imageToDataUrl({ dataUrl: image.dataUrl }), dimensions.width, dimensions.height);
                return { ...image, dataUrl: normalizedDataUrl };
            } catch {
                return image;
            }
        }),
    );
}

async function fitImageToExactCanvas(dataUrl: string, width: number, height: number) {
    const source = await loadImageElement(dataUrl);
    const sourceWidth = source.naturalWidth || source.width || width;
    const sourceHeight = source.naturalHeight || source.height || height;
    if (sourceWidth === width && sourceHeight === height) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);
    const left = Math.round((width - drawWidth) / 2);
    const top = Math.round((height - drawHeight) / 2);
    context.drawImage(source, left, top, drawWidth, drawHeight);
    return canvas.toDataURL("image/png");
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(toFriendlyAiError(payload.msg || "请求失败"));
    }
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return toFriendlyAiError(responseData?.msg || responseData?.error?.message || "", error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return toFriendlyAiError(error instanceof Error ? error.message : "", undefined, fallback);
}

function isRecoverableImageParameterError(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
    return /参数|parameter|invalid|unsupported|not accept|bad request|接口路径|endpoint|404|400|422|没有返回图片|no image|empty image/.test(message);
}

function readFetchException(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return toFriendlyAiError(error instanceof Error ? error.message : "", undefined, fallback);
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 400) return "请求参数不被上游接口接受，请检查模型、尺寸、参考图和提示词";
    if (status === 401 || status === 403) return "鉴权失败，请联系管理员检查服务端密钥、套餐权限或模型权限";
    if (status === 404) return "接口路径或模型不存在，请检查 OPENAI_IMAGE_GENERATIONS_PATH、Base URL 和模型名";
    if (status === 408) return "上游接口响应超时，请稍后重试或减少参考图/生成张数";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status === 500 || status === 502 || status === 503 || status === 504) return "上游图片服务暂时异常，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function toFriendlyAiError(message?: string, status?: number, fallback = "请求失败") {
    const raw = (message || "").trim();
    const lower = raw.toLowerCase();
    const base = raw || readStatusError(status, fallback);
    if (/无权访问|无权限|unauthorized|forbidden|permission|not allowed|令牌无权/.test(lower) || /无权访问|无权限|令牌无权/.test(raw)) {
        return appendRaw("模型或密钥权限不足，请检查该 API Key 是否支持当前模型", raw);
    }
    if (/invalid api key|incorrect api key|api key|apikey|authentication|auth/i.test(raw)) {
        return appendRaw("API Key 鉴权失败，请联系管理员检查 Railway 环境变量", raw);
    }
    if (status === 404 || /404|not found|no route|unknown endpoint/i.test(raw)) {
        return appendRaw("接口路径或模型不存在，请检查图片接口路径、Base URL 和模型名", raw);
    }
    if (status === 400 || /bad request|invalid request|invalid parameter|unsupported|不支持/.test(lower) || /不支持|参数/.test(raw)) {
        return appendRaw("请求参数不被上游接口接受，请检查模型、尺寸、参考图和提示词", raw);
    }
    if (status === 429 || /rate limit|quota|insufficient|额度|限流/.test(lower) || /额度|限流/.test(raw)) {
        return appendRaw("请求被限流或额度不足，请稍后重试", raw);
    }
    if (status === 408 || /timeout|timed out|超时/.test(lower) || /超时/.test(raw)) {
        return appendRaw("上游接口响应超时，请稍后重试或减少参考图/生成张数", raw);
    }
    if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(raw)) {
        return appendRaw("网络请求失败，请刷新页面后重试；如果仍失败，请查看 Railway 日志或检查当前部署是否正在重启", raw);
    }
    if ([500, 502, 503, 504].includes(status || 0) || /server error|bad gateway|service unavailable|gateway timeout/i.test(raw)) {
        return appendRaw("上游图片服务暂时异常，请稍后重试", raw);
    }
    return base;
}

function appendRaw(friendly: string, raw: string) {
    return raw && raw !== friendly ? `${friendly}。原始信息：${raw}` : friendly;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return `/api/ai/openai${path}`;
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

async function postAsyncImageJson(config: AiConfig, path: string, payload: Record<string, unknown>, options?: RequestOptions) {
    let startResponse: Response;
    try {
        startResponse = await fetch(aiApiUrl(config, path), {
            method: "POST",
            headers: { ...aiHeaders(config, "application/json"), "x-eons-async": "1" },
            body: JSON.stringify(payload),
            signal: options?.signal,
        });
    } catch (error) {
        throw new Error(readFetchException(error, "图片任务启动失败"));
    }
    if (!startResponse.ok && startResponse.status !== 202) throw new Error(await readFetchError(startResponse, "请求失败"));
    const started = (await startResponse.json()) as AsyncImageJobStart;
    if (!started.jobId) throw new Error(started.error || "图片任务启动失败");
    return pollAsyncImageJob(config, started.jobId, options);
}

async function postAsyncImageForm(config: AiConfig, path: string, formData: FormData, options?: RequestOptions) {
    let startResponse: Response;
    try {
        startResponse = await fetch(aiApiUrl(config, path), {
            method: "POST",
            headers: { "x-eons-async": "1" },
            body: formData,
            signal: options?.signal,
        });
    } catch (error) {
        throw new Error(readFetchException(error, "图片任务启动失败"));
    }
    if (!startResponse.ok && startResponse.status !== 202) throw new Error(await readFetchError(startResponse, "请求失败"));
    const started = (await startResponse.json()) as AsyncImageJobStart;
    if (!started.jobId) throw new Error(started.error || "图片任务启动失败");
    return pollAsyncImageJob(config, started.jobId, options);
}

async function pollAsyncImageJob(config: AiConfig, jobId: string, options?: RequestOptions) {
    let failedPolls = 0;
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await delay(2000, options?.signal);
        let response: Response;
        try {
            response = await fetch(aiApiUrl(config, `/jobs/${encodeURIComponent(jobId)}`), { headers: aiHeaders(config, "application/json"), signal: options?.signal });
            failedPolls = 0;
        } catch (error) {
            failedPolls += 1;
            if (failedPolls <= ASYNC_IMAGE_POLL_RETRY_LIMIT) continue;
            throw new Error(readFetchException(error, "图片任务轮询失败"));
        }
        if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
        const job = (await response.json()) as AsyncImageJobPoll;
        if (job.status === "pending") continue;
        if (job.status === "failed" || job.status === "missing") throw new Error(toFriendlyAiError(job.error || "图片任务失败"));
        if (job.status === "done") {
            if (job.responseStatus && job.responseStatus >= 400) throw new Error(toFriendlyAiError(responseErrorMessage(job.body || {}), job.responseStatus));
            return job.body || {};
        }
        throw new Error("图片任务状态异常");
    }
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

async function toOpenRouterImageReferences(references: ReferenceImage[]): Promise<OpenRouterImageReference[]> {
    return Promise.all(
        references.map(async (image) => {
            const referenceDataUrl = (image as ReferenceImageWithMaskPreview).referenceDataUrl;
            return {
                type: "image_url",
                image_url: { url: referenceDataUrl || (await imageToDataUrl(image)) },
            };
        }),
    );
}

function loadImageElement(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("读取参考图失败"));
        image.src = dataUrl;
    });
}

async function buildMaskedSourceReference(source: ReferenceImage, mask: ReferenceImage): Promise<ReferenceImage | null> {
    try {
        const [sourceImage, maskImage] = await Promise.all([loadImageElement(await imageToDataUrl(source)), loadImageElement(await imageToDataUrl(mask))]);
        const width = sourceImage.naturalWidth || sourceImage.width || 1024;
        const height = sourceImage.naturalHeight || sourceImage.height || 1024;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return null;

        context.drawImage(sourceImage, 0, 0, width, height);

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskContext = maskCanvas.getContext("2d");
        if (!maskContext) return null;
        maskContext.drawImage(maskImage, 0, 0, width, height);
        const pixels = maskContext.getImageData(0, 0, width, height);
        const overlay = context.createImageData(width, height);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const red = pixels.data[index];
            const green = pixels.data[index + 1];
            const blue = pixels.data[index + 2];
            const alpha = pixels.data[index + 3];
            const selectedByOpenAiMask = alpha < 250;
            const selectedByPreviewMask = blue > red + 20 && blue > green + 20;
            if (!selectedByOpenAiMask && !selectedByPreviewMask) continue;
            overlay.data[index] = 37;
            overlay.data[index + 1] = 99;
            overlay.data[index + 2] = 235;
            overlay.data[index + 3] = 118;
        }
        context.putImageData(overlay, 0, 0);

        return {
            id: `${source.id}-masked-preview`,
            name: "masked-reference.png",
            type: "image/png",
            dataUrl: canvas.toDataURL("image/png"),
        };
    } catch {
        return null;
    }
}

async function requestUrlImagePayload(config: AiConfig, payload: UrlImagePayload, options?: RequestOptions) {
    return parseImagePayload(await postAsyncImageJson(config, "/images/generations", payload, options));
}

async function requestUrlImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage | undefined, requestSize: string | undefined, options?: RequestOptions) {
    const fullReferences = mask ? [...references, mask] : references;
    const basePayload: UrlImagePayload = {
        model: config.model,
        prompt: withSystemPrompt(config, prompt),
        n: 1,
        ...(requestSize ? { size: requestSize } : {}),
        input_references: await toOpenRouterImageReferences(fullReferences),
    };

    let lastRecoverableError: unknown;
    try {
        return await requestUrlImagePayload(config, basePayload, options);
    } catch (error) {
        if (!isRecoverableImageParameterError(error)) throw error;
        lastRecoverableError = error;
    }

    const sizeFreePayload = { ...basePayload };
    delete sizeFreePayload.size;
    delete sizeFreePayload.n;
    try {
        return await requestUrlImagePayload(config, sizeFreePayload, options);
    } catch (error) {
        lastRecoverableError = error;
        if (!mask || !isRecoverableImageParameterError(error)) throw error;
    }

    const markedReference = references[0] ? await buildMaskedSourceReference(references[0], mask) : null;
    if (!markedReference) throw lastRecoverableError;
    return requestUrlImagePayload(
        config,
        {
            model: config.model,
            prompt: withSystemPrompt(
                config,
                `${prompt}

参考图中蓝色半透明区域是用户涂抹的局部修改范围。请只修改蓝色区域，其他区域必须保持不变，尤其是主体、品牌、文字、构图、背景和光影。`,
            ),
            input_references: await toOpenRouterImageReferences([markedReference]),
        },
        options,
    );
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(toFriendlyAiError(payload.msg || "请求失败"));
    if (payload.error?.message) throw new Error(toFriendlyAiError(payload.error.message));
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(toFriendlyAiError(payload.error.message));
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return toFriendlyAiError(responseErrorMessage(JSON.parse(text)), response.status, fallback);
    } catch {
        return toFriendlyAiError(text.slice(0, 300), response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        consumeResponseStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function toChatMessages(messages: ResponseInputMessage[]) {
    return messages.map((message) => {
        if ("type" in message) {
            return {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: message.call_id,
                        type: "function",
                        function: { name: message.name, arguments: message.arguments || "{}" },
                    },
                ],
            };
        }
        if (message.role === "tool") {
            return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
        }
        return { role: message.role, content: message.content };
    });
}

function validateChatPayload(payload: ChatCompletionPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(toFriendlyAiError(payload.msg || "请求失败"));
    if (payload.error?.message) throw new Error(toFriendlyAiError(payload.error.message));
}

function mergeToolDelta(state: ChatStreamState, delta: ChatCompletionChoice["delta"]) {
    delta?.tool_calls?.forEach((call) => {
        const index = call.index || 0;
        const current =
            state.toolCalls[index] ||
            ({
                id: call.id || "",
                type: "function",
                function: { name: "", arguments: "" },
            } as ResponseToolCall);
        state.toolCalls[index] = {
            id: call.id || current.id,
            type: "function",
            function: {
                name: `${current.function.name}${call.function?.name || ""}`,
                arguments: `${current.function.arguments}${call.function?.arguments || ""}`,
            },
        };
    });
}

function consumeChatStreamBlock(block: string, state: ChatStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as ChatCompletionPayload;
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    event.choices?.forEach((choice) => {
        if (choice.delta?.content) {
            state.text += choice.delta.content;
            onDelta?.(state.text);
        }
        mergeToolDelta(state, choice.delta);
    });
}

function consumeChatStreamText(state: ChatStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        consumeChatStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestChatCompletionResponse(config: AiConfig, messages: ResponseInputMessage[], tools?: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const body: Record<string, unknown> = {
        model: config.model,
        messages: toChatMessages(withSystemMessage(config, messages)),
        stream: true,
        ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
    };
    const response = await fetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ChatCompletionPayload;
        validateChatPayload(payload);
        const message = payload.choices?.[0]?.message;
        return { content: message?.content || "", toolCalls: message?.tool_calls || [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeChatStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls.filter((call) => call.id && call.function.name) };
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        consumeGeminiStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice(match.index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(3, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await normalizeGeneratedImagesToSize(await requestGeminiImages(requestConfig, prompt, [], n, options), requestSize);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const usesUrlResponse = isUrlImageModel(requestConfig.model);
    try {
        const payload = {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, prompt),
            n: usesUrlResponse ? 1 : n,
            ...(!usesUrlResponse && quality ? { quality } : {}),
            ...(requestSize ? { size: requestSize } : {}),
            ...(!usesUrlResponse ? { response_format: "b64_json", output_format: IMAGE_OUTPUT_FORMAT } : {}),
        };
        const data = usesUrlResponse ? await postAsyncImageJson(requestConfig, "/images/generations", payload, options) : (await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/generations"), payload, { headers: aiHeaders(requestConfig, "application/json"), signal: options?.signal })).data;
        const images = parseImagePayload(data);
        return await normalizeGeneratedImagesToSize(images, requestSize);
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(3, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const maskReferencePrompt = mask ? buildMaskReferencePrompt(requestPrompt, references.length) : requestPrompt;
    const referencesWithMask = mask ? [...references, mask] : references;
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await normalizeGeneratedImagesToSize(await requestGeminiImages(requestConfig, maskReferencePrompt, referencesWithMask, n, options), requestSize);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const usesUrlResponse = isUrlImageModel(requestConfig.model);
    if (usesUrlResponse) {
        let multipartError: unknown;
        try {
            const images = parseImagePayload(await postAsyncImageForm(requestConfig, "/images/edits", await buildImageEditFormData(requestConfig, requestPrompt, references, mask, quality, requestSize, 1), options));
            return await normalizeGeneratedImagesToSize(images, requestSize);
        } catch (error) {
            multipartError = error;
            if (!isRecoverableImageParameterError(error)) {
                throw new Error(readAxiosError(error, "请求失败"));
            }
        }
        try {
            return await normalizeGeneratedImagesToSize(await requestUrlImageEdit(requestConfig, maskReferencePrompt, references, mask, requestSize, options), requestSize);
        } catch (error) {
            if (multipartError && !isRecoverableImageParameterError(error)) throw new Error(readAxiosError(error, "请求失败"));
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }

    const formData = await buildImageEditFormData(requestConfig, requestPrompt, references, mask, quality, requestSize, n);

    try {
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, { headers: aiHeaders(requestConfig), signal: options?.signal });
        const images = parseImagePayload(response.data);
        return await normalizeGeneratedImagesToSize(images, requestSize);
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

async function buildImageEditFormData(config: AiConfig, prompt: string, references: ReferenceImage[], mask: ReferenceImage | undefined, quality: string | undefined, requestSize: string | undefined, count: number) {
    const formData = new FormData();
    formData.set("model", config.model);
    formData.set("prompt", withSystemPrompt(config, prompt));
    formData.set("n", String(count));
    formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));
    return formData;
}

function buildMaskReferencePrompt(prompt: string, referenceCount: number) {
    const sourceLabel = imageReferenceLabel(0);
    const maskLabel = imageReferenceLabel(referenceCount);
    return `${prompt}

局部修改蒙版说明：
${sourceLabel} 是原始图片，${maskLabel} 是用户涂抹出来的局部修改蒙版。
请只修改蒙版标出的区域，其他区域必须尽量保持与原图一致，包括构图、背景、产品形状、品牌标识、包装比例、文字排版、光影和材质。
如果蒙版图片包含透明区域，请把透明区域理解为需要修改的区域；如果蒙版以深浅颜色显示，请把有明显遮罩痕迹的区域理解为需要修改的区域。
不要重绘整张图，不要替换品牌，不要改变未选中区域。`;
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer = (await requestChatCompletionResponse(requestConfig, messages, undefined, "auto", onDelta, options)).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            return await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options);
        }
        return await requestChatCompletionResponse(requestConfig, messages, tools, toolChoice, onDelta, options);
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(aiApiUrl(defaultGeminiConfig as AiConfig, "/models"));
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
