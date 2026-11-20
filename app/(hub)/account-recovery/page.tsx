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
        description="Help a verified employee choose a new password when email delivery is unavailable."
      />
      <RecoveryConsole directory={directory} />
    </div>
  );
}
