import { AssistedRecoveryForm } from "@/components/hub/assisted-recovery-form";
export const metadata = {
  title: "Secure account recovery | CAEDM Software Hub",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <AssistedRecoveryForm />;
}
