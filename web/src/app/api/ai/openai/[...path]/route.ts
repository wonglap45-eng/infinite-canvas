import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const HOP_HEADERS = new Set(["connection", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "content-encoding"]);
const PLACEHOLDER_KEY_VALUES = new Set(["", "change-me", "your-api-key", "your_api_key", "your-third-party-api-key"]);

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

type UpstreamKind = "default" | "image" | "text" | "vision" | "video" | "audio";

type UpstreamTarget = {
    kind: UpstreamKind;
    apiKey: string;
    baseUrl: string;
};

type RequestPayloadInfo = {
    model: string;
    hasImageInput: boolean;
    jsonBody?: Record<string, unknown>;
};

type AiJob =
    | { status: "pending"; createdAt: number }
    | { status: "done"; createdAt: number; responseStatus: number; contentType: string; body: string }
    | { status: "failed"; createdAt: number; error: string };

const aiJobs = new Map<string, AiJob>();
const AI_JOB_TTL_MS = 20 * 60 * 1000;

function normalizeBaseUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_OPENAI_BASE_URL;
    const lowerBaseUrl = normalized.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalized : `${normalized}/v1`;
}

function envValue(name: string) {
    return (process.env[name] || "").trim();
}

function envModels(name: string) {
    return envValue(name)
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function modelMatchesEnv(model: string, name: string) {
    const normalized = model.trim().toLowerCase();
    if (!normalized) return false;
    return envModels(name).includes(normalized);
}

function kindApiKey(kind: UpstreamKind) {
    const raw = kind === "default" ? envValue("OPENAI_API_KEY") : kind === "vision" ? envValue("OPENAI_VISION_API_KEY") || envValue("OPENAI_TEXT_API_KEY") || envValue("OPENAI_API_KEY") : envValue(`OPENAI_${kind.toUpperCase()}_API_KEY`);
    if (/[^\x20-\x7e]/.test(raw)) return "";
    return PLACEHOLDER_KEY_VALUES.has(raw) ? "" : raw;
}

function kindBaseUrl(kind: UpstreamKind) {
    return normalizeBaseUrl(kind === "default" ? envValue("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL : kind === "vision" ? envValue("OPENAI_VISION_BASE_URL") || envValue("OPENAI_TEXT_BASE_URL") || envValue("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL : envValue(`OPENAI_${kind.toUpperCase()}_BASE_URL`) || envValue("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL);
}

function kindTarget(kind: UpstreamKind): UpstreamTarget {
    return { kind, apiKey: kindApiKey(kind), baseUrl: kindBaseUrl(kind) };
}

function pathKind(path: string[]): UpstreamKind {
    const first = path[0]?.toLowerCase() || "";
    if (first === "images") return "image";
    if (first === "videos") return "video";
    if (first === "audio") return "audio";
    if (first === "responses" || first === "chat") return "text";
    return "default";
}

function visionModel() {
    return envValue("OPENAI_VISION_MODEL") || envModels("OPENAI_VISION_MODELS")[0] || "";
}

function resolveUpstreamTarget(path: string[], model: string, hasImageInput = false): UpstreamTarget {
    if (hasImageInput && visionModel()) return kindTarget("vision");
    const modelRoutes: Array<{ kind: UpstreamKind; env: string }> = [
        { kind: "image", env: "OPENAI_IMAGE_MODELS" },
        { kind: "text", env: "OPENAI_TEXT_MODELS" },
        { kind: "vision", env: "OPENAI_VISION_MODELS" },
        { kind: "video", env: "OPENAI_VIDEO_MODELS" },
        { kind: "audio", env: "OPENAI_AUDIO_MODELS" },
    ];
    for (const route of modelRoutes) {
        if (modelMatchesEnv(model, route.env)) return kindTarget(route.kind);
    }

    const inferredKind = pathKind(path);
    const inferredTarget = kindTarget(inferredKind);
    if (inferredTarget.apiKey) return inferredTarget;
    return kindTarget("default");
}

function isImageInputValue(value: unknown): boolean {
    if (!value) return false;
    if (Array.isArray(value)) return value.some(isImageInputValue);
    if (typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.type === "image_url" || record.type === "input_image" || isImageInputValue(record.content) || isImageInputValue(record.messages) || isImageInputValue(record.input);
}

async function requestPayloadInfo(request: NextRequest): Promise<RequestPayloadInfo> {
    if (request.method === "GET" || request.method === "HEAD") return { model: "", hasImageInput: false };
    const contentType = request.headers.get("content-type") || "";
    try {
        if (contentType.includes("application/json")) {
            const payload = (await request.clone().json()) as Record<string, unknown>;
            return { model: typeof payload.model === "string" ? payload.model : "", hasImageInput: isImageInputValue(payload), jsonBody: payload };
        }
        if (contentType.includes("multipart/form-data")) {
            const model = (await request.clone().formData()).get("model");
            return { model: typeof model === "string" ? model : "", hasImageInput: false };
        }
    } catch {
        return { model: "", hasImageInput: false };
    }
    return { model: "", hasImageInput: false };
}

function upstreamBaseUrl(target: UpstreamTarget) {
    const baseUrl = target.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = baseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? baseUrl : `${baseUrl}/v1`;
}

function endpointOverride(path: string[], target: UpstreamTarget) {
    const joined = `/${path.join("/")}`;
    if (target.kind === "image" && joined === "/images/generations") return envValue("OPENAI_IMAGE_GENERATIONS_PATH") || (target.baseUrl.includes("openrouter.ai") ? "/images" : joined);
    if (target.kind === "image" && joined === "/images/edits") return envValue("OPENAI_IMAGE_EDITS_PATH") || joined;
    if (target.kind === "vision" && joined === "/chat/completions") return envValue("OPENAI_VISION_CHAT_PATH") || joined;
    if (target.kind === "vision" && joined === "/responses") return envValue("OPENAI_VISION_RESPONSES_PATH") || joined;
    if (target.kind === "text" && joined === "/chat/completions") return envValue("OPENAI_TEXT_CHAT_PATH") || joined;
    if (target.kind === "text" && joined === "/responses") return envValue("OPENAI_TEXT_RESPONSES_PATH") || joined;
    return joined;
}

function cleanupJobs() {
    const cutoff = Date.now() - AI_JOB_TTL_MS;
    aiJobs.forEach((job, id) => {
        if (job.createdAt < cutoff) aiJobs.delete(id);
    });
}

function isAsyncImageRequest(request: NextRequest, path: string[]) {
    return request.method === "POST" && request.headers.get("x-eons-async") === "1" && path[0] === "images";
}

function jobResponse(jobId: string) {
    const job = aiJobs.get(jobId);
    if (!job) return NextResponse.json({ status: "missing", error: "Generation job expired or was not found." }, { status: 404 });
    if (job.status !== "done") return NextResponse.json(job);
    const contentType = job.contentType || "application/json";
    if (contentType.includes("application/json")) {
        try {
            return NextResponse.json({ status: "done", responseStatus: job.responseStatus, body: JSON.parse(job.body) });
        } catch {
            return NextResponse.json({ status: "done", responseStatus: job.responseStatus, body: job.body });
        }
    }
    return NextResponse.json({ status: "done", responseStatus: job.responseStatus, body: job.body });
}

function copyRequestHeaders(request: NextRequest, target: UpstreamTarget, body?: Uint8Array) {
    const headers = new Headers();
    request.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (HOP_HEADERS.has(lowerKey) || lowerKey === "authorization" || lowerKey === "cookie" || lowerKey === "accept-encoding") return;
        headers.set(key, value);
    });
    headers.set("authorization", `Bearer ${target.apiKey}`);
    headers.set("accept-encoding", "identity");
    if (body) headers.set("content-length", String(body.byteLength));
    return headers;
}

function copyResponseHeaders(response: Response) {
    const headers = new Headers();
    response.headers.forEach((value, key) => {
        if (!HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    });
    return headers;
}

async function proxyOpenAI(request: NextRequest, context: RouteContext) {
    if (!isAuthenticatedRequest(request)) {
        return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
    }

    try {
        const startedAt = Date.now();
        const { path } = await context.params;
        if (path[0] === "jobs" && path[1]) {
            cleanupJobs();
            return jobResponse(path[1]);
        }

        const payloadInfo = await requestPayloadInfo(request);
        const targetModel = payloadInfo.hasImageInput && visionModel() && payloadInfo.jsonBody ? visionModel() : payloadInfo.model;
        const target = resolveUpstreamTarget(path, targetModel, payloadInfo.hasImageInput);
        if (payloadInfo.hasImageInput && envValue("OPENAI_REJECT_IMAGE_TEXT_WITHOUT_VISION").toLowerCase() === "true" && !visionModel() && target.kind === "text") {
            return NextResponse.json(
                {
                    error: {
                        code: "missing_vision_model",
                        message: "当前反推图片需要视觉理解模型，但 Railway 尚未配置 OPENAI_VISION_MODEL / OPENAI_VISION_API_KEY。当前文本模型只能处理文字，不能可靠读取图片内容。",
                    },
                },
                { status: 400 },
            );
        }
        const model = targetModel;
        if (!target.apiKey) {
            return NextResponse.json(
                {
                    error: {
                        code: "missing_openai_api_key",
                        message: `Server is missing ${target.kind === "default" ? "OPENAI_API_KEY" : `OPENAI_${target.kind.toUpperCase()}_API_KEY`}. Configure the matching API key in Railway Variables.`,
                    },
                },
                { status: 500 },
            );
        }

        const upstreamUrl = new URL(`${upstreamBaseUrl(target)}${endpointOverride(path, target)}`);
        upstreamUrl.search = request.nextUrl.search;
        if (payloadInfo.hasImageInput && payloadInfo.jsonBody && model) payloadInfo.jsonBody.model = model;
        const body = request.method === "GET" || request.method === "HEAD" ? undefined : payloadInfo.jsonBody ? new TextEncoder().encode(JSON.stringify(payloadInfo.jsonBody)) : new Uint8Array(await request.arrayBuffer());
        if (isAsyncImageRequest(request, path)) {
            cleanupJobs();
            const jobId = nanoid();
            aiJobs.set(jobId, { status: "pending", createdAt: Date.now() });
            void fetch(upstreamUrl, {
                method: request.method,
                headers: copyRequestHeaders(request, target, body),
                body,
            })
                .then(async (response) => {
                    const text = await response.text();
                    aiJobs.set(jobId, {
                        status: "done",
                        createdAt: Date.now(),
                        responseStatus: response.status,
                        contentType: response.headers.get("content-type") || "",
                        body: text,
                    });
                    console.log("AI async image job completed", {
                        path: request.nextUrl.pathname,
                        model,
                        route: target.kind,
                        status: response.status,
                        durationMs: Date.now() - startedAt,
                        contentType: response.headers.get("content-type"),
                    });
                })
                .catch((error) => {
                    aiJobs.set(jobId, { status: "failed", createdAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
                    console.error("AI async image job failed", { path: request.nextUrl.pathname, model, message: error instanceof Error ? error.message : String(error) });
                });
            return NextResponse.json({ status: "pending", jobId }, { status: 202 });
        }

        const response = await fetch(upstreamUrl, {
            method: request.method,
            headers: copyRequestHeaders(request, target, body),
            body,
        });
        console.log("AI proxy upstream response", {
            path: request.nextUrl.pathname,
            model,
            route: target.kind,
            status: response.status,
            durationMs: Date.now() - startedAt,
            contentType: response.headers.get("content-type"),
        });

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: copyResponseHeaders(response),
        });
    } catch (error) {
        console.error("AI proxy request failed", {
            path: request.nextUrl.pathname,
            message: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json(
            {
                error: {
                    code: "ai_proxy_request_failed",
                    message: "AI proxy request failed. Check OPENAI_BASE_URL and Railway logs.",
                },
            },
            { status: 500 },
        );
    }
}

export const GET = proxyOpenAI;
export const POST = proxyOpenAI;
export const PUT = proxyOpenAI;
export const PATCH = proxyOpenAI;
export const DELETE = proxyOpenAI;
