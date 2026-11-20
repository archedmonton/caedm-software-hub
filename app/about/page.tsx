import { session } from "@/lib/auth";
import HubLayout from "@/app/(hub)/layout";
import AboutContent from "@/components/hub/about-content";
import { Brand } from "@/components/hub/brand";
import { HelpCenter } from "@/components/hub/help-center";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function AboutPage() {
  const context = await session();
  const content = <AboutContent />;
  if (context.access.effective_role) return <HubLayout>{content}</HubLayout>;
  // About contains application metadata only. Pending/unverified authenticated
  // accounts can read it without acquiring any workspace data or permissions.
  return (
    <>
      <header className="about-standalone-header">
        <Brand href="/about" />
        <HelpCenter />
      </header>
      <main className="about-standalone-main">
        <Link href="/pending-approval">← Back to account status</Link>
        {content}
      </main>
    </>
  );
}
