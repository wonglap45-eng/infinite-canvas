"use client";

import { Button, Empty, Modal, Tag } from "antd";
import { AlertTriangle, CheckCircle2, Clock3, Info, Trash2, WalletCards } from "lucide-react";
import type { ReactNode } from "react";

import { formatDuration } from "@/lib/image-utils";
import { actionLabel, scopeLabel, summarizeGenerationEntries, useGenerationMonitorStore, type GenerationMonitorEntry } from "@/stores/use-generation-monitor-store";

export function GenerationMonitorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const entries = useGenerationMonitorStore((state) => state.entries);
    const clearEntries = useGenerationMonitorStore((state) => state.clearEntries);
    const removeEntry = useGenerationMonitorStore((state) => state.removeEntry);
    const summary = summarizeGenerationEntries(entries);

    return (
        <Modal title="错误日志与成本控制" open={open} onCancel={onClose} footer={null} width={920} destroyOnHidden>
            <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-4">
                    <SummaryCard title="今日请求" value={`${summary.todayCount}`} icon={<Clock3 className="size-4" />} />
                    <SummaryCard title="今日成功" value={`${summary.todaySuccess}`} icon={<CheckCircle2 className="size-4" />} tone="success" />
                    <SummaryCard title="今日失败" value={`${summary.todayFailed}`} icon={<AlertTriangle className="size-4" />} tone="danger" />
                    <SummaryCard title="今日估算点数" value={`${summary.todayCredits}`} icon={<WalletCards className="size-4" />} />
                </div>

                <CostRuleBox />

                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-base font-semibold">最近记录</div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">点数是内部估算值，用来提醒和控制误消耗；真实费用以第三方平台账单为准。</div>
                    </div>
                    <Button danger icon={<Trash2 className="size-4" />} disabled={!entries.length} onClick={clearEntries}>
                        清空记录
                    </Button>
                </div>

                {entries.length ? (
                    <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                        {entries.slice(0, 80).map((entry) => (
                            <MonitorRow key={entry.id} entry={entry} onRemove={() => removeEntry(entry.id)} />
                        ))}
                    </div>
                ) : (
                    <Empty description="暂无生成记录" />
                )}
            </div>
        </Modal>
    );
}

function CostRuleBox() {
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600 dark:border-stone-800 dark:bg-white/5 dark:text-stone-300">
            <div className="mb-2 flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                <Info className="size-4" />
                点数计算规则
            </div>
            <div className="leading-6">估算点数 =（操作基础值 + 参考图数量 x 0.2 + 长提示词加成）x 质量系数 x 尺寸系数 x 生成张数。</div>
            <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">
                操作基础值：提示词 0.25，文生图 1，图生图 1.35，局部编辑 1.55。高质量为 1.7 倍，中等质量为 1.25 倍；2K 附近尺寸为 1.35 倍，4K 为 2.4 倍。这个数字只用于内部控成本，不代表第三方平台实际价格。
            </div>
        </div>
    );
}

function SummaryCard({ title, value, icon, tone }: { title: string; value: string; icon: ReactNode; tone?: "success" | "danger" }) {
    const color = tone === "success" ? "text-emerald-600" : tone === "danger" ? "text-red-500" : "text-stone-950 dark:text-stone-100";
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-white/5">
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                {icon}
                {title}
            </div>
            <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
        </div>
    );
}

function MonitorRow({ entry, onRemove }: { entry: GenerationMonitorEntry; onRemove: () => void }) {
    return (
        <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={entry.status === "success" ? "green" : "red"}>{entry.status === "success" ? "成功" : "失败"}</Tag>
                        <Tag>{scopeLabel(entry.scope)}</Tag>
                        <Tag>{actionLabel(entry.action)}</Tag>
                        <span className="text-sm font-medium">{entry.model || "未记录模型"}</span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-sm text-stone-700 dark:text-stone-300">{entry.error || entry.promptPreview || "没有详细信息"}</div>
                    {entry.projectTitle ? <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">项目：{entry.projectTitle}</div> : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-right text-xs text-stone-500 dark:text-stone-400">
                    <div>
                        <div>{new Date(entry.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                        <div className="mt-1">
                            {entry.successCount}/{entry.count} 张 · {entry.referenceCount} 参考 · {entry.estimatedCredits} 点
                            {entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : ""}
                        </div>
                    </div>
                    <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} onClick={onRemove} aria-label="删除记录" />
                </div>
            </div>
        </div>
    );
}
