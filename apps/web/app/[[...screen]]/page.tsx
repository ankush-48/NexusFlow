import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StaticDemoWorkspace, Workspace } from "../../components/workspace";
import { screens, type Screen } from "../../lib/model";

export default async function Page({
  params,
}: {
  params: Promise<{ screen?: string[] }>;
}) {
  if (!staticDemo) await connection();
  const { screen: segments = [] } = await params;
  const screen = (segments[0] ??
    (staticDemo || process.env.NEXUS_DEMO === "1" ? "projects" : "home")) as Screen;
  if (
    !screens.includes(screen) ||
    segments.length > (screen === "projects" ? 2 : 1)
  )
    notFound();
  if (staticDemo) {
    return (
      <Suspense fallback={<main className="workspace-loading">Loading NexusFlow…</main>}>
        <StaticDemoWorkspace screen={screen} />
      </Suspense>
    );
  }
  return (
    <Workspace
      screen={screen}
      projectId={segments[1]}
      demo={process.env.NEXUS_DEMO === "1"}
    />
  );
}
const staticDemo = process.env.NEXT_PUBLIC_NEXUS_STATIC === "1";

export const generateStaticParams = staticDemo
  ? () => [{ screen: [] }, ...screens.map((screen) => ({ screen: [screen] }))]
  : undefined;

