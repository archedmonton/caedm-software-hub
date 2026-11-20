import { requireRecoveryOperator } from "@/lib/account-recovery";
import { RecoveryConsole } from "@/components/hub/recovery-console";
import { PageHeading } from "@/components/hub/common";
export default async function Page() {
  const { directory } = await requireRecoveryOperator();
  return (
    <div className="developer-page readable-workspace">
      <PageHeading
        eyebrow="SECURE ACCOUNT SUPPORT"
        title="Account recovery"
        description="Send a secure password reset email to a verified employee after confirming their identity."
      />
      <RecoveryConsole directory={directory} />
    </div>
  );
}
