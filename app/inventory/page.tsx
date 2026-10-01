import { redirect } from "next/navigation";

// 盘点已并入「整理」页 —— 老链接还留着，直接转过去
export default function InventoryPage() {
  redirect("/reflow?tab=inventory");
}
