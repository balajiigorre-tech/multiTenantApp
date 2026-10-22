import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser(); // verified on the server from the session cookie
  if (!user) redirect("/login");
  return <Dashboard user={{ name: user.name, email: user.email }} />;
}
