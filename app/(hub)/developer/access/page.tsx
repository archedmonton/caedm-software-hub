import DeveloperPage from "../page";
export default function AccessPage() {
  return <DeveloperPage searchParams={Promise.resolve({ tab: "access" })} />;
}
