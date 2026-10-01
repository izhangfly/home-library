"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALES, LOCALE_COOKIE, type Locale } from "@/i18n/request";

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
  });
  // 所有页面的文案都变了，整棵树都要重新渲染
  revalidatePath("/", "layout");
}
