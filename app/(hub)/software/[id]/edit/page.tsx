import { SoftwareEditor } from "@/components/hub/software-editor";
export default async function Edit({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SoftwareEditor id={id} />;
}
