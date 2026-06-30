"use client";

import { Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Tag } from "antd";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel = "复制",
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
}: {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
}) {
    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    <PromptCover item={item} />
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
                        <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{formatPromptDate(item.updatedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{item.prompt}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>
                    {actionLabel}
                </Button>
                {extraAction}
            </div>
        </Card>
    );
}

export function PromptCover({ item, className = "h-40" }: { item: Prompt; className?: string }) {
    const [failed, setFailed] = useState(false);
    const hasCover = Boolean(item.coverUrl?.trim()) && !failed;

    useEffect(() => {
        setFailed(false);
    }, [item.coverUrl]);

    if (hasCover) {
        return <img src={item.coverUrl} alt={item.title} className={`${className} w-full bg-stone-100 object-cover dark:bg-stone-900`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
    }

    return (
        <div className={`${className} flex w-full flex-col justify-between bg-stone-100 p-4 dark:bg-stone-900`}>
            <div className="text-xs font-medium text-stone-400 dark:text-stone-500">封面加载失败</div>
            <div>
                <div className="line-clamp-2 text-sm font-semibold text-stone-800 dark:text-stone-100">{item.title}</div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{item.prompt}</div>
            </div>
        </div>
    );
}
