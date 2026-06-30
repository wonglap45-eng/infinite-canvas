import Link from "next/link";

export default function LicensePage() {
    return (
        <main className="min-h-full overflow-auto bg-background px-6 py-10 text-stone-950 dark:text-stone-100">
            <section className="mx-auto max-w-3xl">
                <Link href="/" className="text-sm text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white">
                    Back to EONS AI Image Studio
                </Link>
                <h1 className="mt-6 text-3xl font-semibold">License and Attribution</h1>
                <div className="mt-6 space-y-5 text-sm leading-7 text-stone-600 dark:text-stone-300">
                    <p>
                        EONS AI Image Studio is an internal deployment based on the upstream open source project <strong>infinite-canvas</strong>.
                    </p>
                    <p>
                        The upstream project is licensed under the <strong>GNU Affero General Public License v3.0</strong>. The full license text is retained in the repository <code>LICENSE</code> file, and attribution is retained in <code>ATTRIBUTION.md</code>.
                    </p>
                    <p>
                        Upstream repository:{" "}
                        <a className="underline underline-offset-4" href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">
                            https://github.com/basketikun/infinite-canvas
                        </a>
                    </p>
                    <p>
                        Internal branding changes are intended to keep ordinary employee workflows focused on the company workspace. They do not remove open source notices or present the software as fully self-developed.
                    </p>
                </div>
            </section>
        </main>
    );
}
