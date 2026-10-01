import { redirect } from "next/navigation";

// 标签管理已并入「设置」—— 分类由中图法自动完成，标签只是个补充，
// 不值得单独占一个一级菜单
export default function TagsPage() {
  redirect("/settings#tags");
}
