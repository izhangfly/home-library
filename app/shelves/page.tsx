import { isAdmin } from "@/lib/auth";
import { AdminGate } from "@/components/AdminGate";
import { ShelvesAdmin } from "@/components/ShelvesAdmin";

export const dynamic = "force-dynamic";

export default async function ShelvesPage() {
  const admin = await isAdmin();

  return (
    <AdminGate admin={admin}>
      <ShelvesAdmin />
    </AdminGate>
  );
}
