"use client";

import { Button, Dropdown } from "antd";
import { Sparkles } from "lucide-react";

import { buildTemplatePrompt, ecommercePromptTemplates } from "@/lib/ecommerce-prompt-templates";

type EcommercePromptTemplateMenuProps = {
    currentPrompt?: string;
    onSelect: (prompt: string) => void;
    buttonClassName?: string;
    showText?: boolean;
};

export function EcommercePromptTemplateMenu({ currentPrompt, onSelect, buttonClassName, showText = false }: EcommercePromptTemplateMenuProps) {
    const button = (
        <Button className={buttonClassName} size="small" icon={<Sparkles className="size-3.5" />} title="亚马逊工作流" aria-label="亚马逊工作流">
            {showText ? "亚马逊工作流" : null}
        </Button>
    );

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: ecommercePromptTemplates.map((template) => ({
                    key: template.key,
                    label: (
                        <span className="block min-w-60">
                            <span className="block text-sm font-medium">{template.label}</span>
                            <span className="block text-xs opacity-60">{template.description}</span>
                        </span>
                    ),
                    onClick: () => onSelect(buildTemplatePrompt(template, currentPrompt)),
                })),
            }}
        >
            {button}
        </Dropdown>
    );
}
