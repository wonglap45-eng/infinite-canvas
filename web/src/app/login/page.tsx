"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Input } from "antd";
import { LockKeyhole, UserRound } from "lucide-react";

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginShell />}>
            <LoginForm />
        </Suspense>
    );
}

function LoginShell() {
    return <main className="grid min-h-screen place-items-center bg-stone-50 px-6 text-sm text-stone-500 dark:bg-stone-950">正在加载...</main>;
}

function LoginForm() {
    const searchParams = useSearchParams();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setLoading(true);
        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(data.error || "登录失败");
            window.location.href = searchParams.get("next") || "/";
        } catch (error) {
            setError(error instanceof Error ? error.message : "登录失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="grid min-h-screen place-items-center bg-stone-50 px-6 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <form onSubmit={submit} className="w-full max-w-[400px] rounded-lg border border-stone-200 bg-white p-7 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="mb-7">
                    <div className="mb-4 grid size-11 place-items-center rounded-lg bg-stone-950 text-base font-semibold text-white dark:bg-white dark:text-stone-950">E</div>
                    <h1 className="text-2xl font-semibold tracking-tight">EONS AI Image Studio</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">公司内部 AI 图片工作台，请使用管理员分配的账号登录。</p>
                </div>

                <label className="mb-4 block">
                    <span className="mb-1.5 block text-sm font-medium">用户名</span>
                    <Input size="large" prefix={<UserRound className="mr-1 size-4 text-stone-400" />} value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
                </label>

                <label className="mb-5 block">
                    <span className="mb-1.5 block text-sm font-medium">密码</span>
                    <Input.Password size="large" prefix={<LockKeyhole className="mr-1 size-4 text-stone-400" />} value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
                </label>

                {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}

                <Button type="primary" htmlType="submit" loading={loading} block size="large">
                    登录
                </Button>
            </form>
        </main>
    );
}
