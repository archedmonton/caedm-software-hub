import { AuthForm } from "@/components/hub/auth-form";
import { configured } from "@/lib/env";
export default function Page() {
  return <AuthForm mode="forgot" ready={configured()} />;
}
