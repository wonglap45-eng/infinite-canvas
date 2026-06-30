"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { CONFIG_STORE_KEY } from "@/stores/use-config-store";

function scrubStoredAiConfig() {
    const raw = localStorage.getItem(CONFIG_STORE_KEY);
    if (!raw) return;
    try {
        const data = JSON.parse(raw) as { state?: { config?: Record<string, unknown> } };
        const config = data.state?.config;
        if (!config) return;
        config.baseUrl = "";
        config.apiKey = "";
        config.apiFormat = "openai";
        if (Array.isArray(config.channels)) {
            config.channels = config.channels.map((channel) =>
                channel && typeof channel === "object"
                    ? {
                          ...(channel as Record<string, unknown>),
                          baseUrl: "",
                          apiKey: "",
                          apiFormat: "openai",
                      }
                    : channel,
            );
        }
        localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(data));
    } catch {
        localStorage.removeItem(CONFIG_STORE_KEY);
    }
}

function scrubCredentialQueryParams() {
    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams.has("apiKey") && !searchParams.has("apikey") && !searchParams.has("baseUrl") && !searchParams.has("baseurl")) return;
    searchParams.delete("apiKey");
    searchParams.delete("apikey");
    searchParams.delete("baseUrl");
    searchParams.delete("baseurl");
    window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        scrubStoredAiConfig();
        scrubCredentialQueryParams();
    }, []);

    return <>{children}</>;
}
