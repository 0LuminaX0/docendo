import { adminEnabled } from "@/lib/server/admin";
import AdminLogin from "@/components/admin/AdminLogin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: admin sign-in", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminLogin enabled={adminEnabled()} />;
}
