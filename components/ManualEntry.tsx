"use client";

// 手动录入 —— 查不到就别卡住用户（spec F1 USER STORY 2）
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookForm } from "./BookForm";
import { ShelvingPicker } from "./ShelvingPicker";
import { PageHeader } from "./ui";
import type { TagOption } from "./TagPicker";

export function ManualEntry({ tags }: { tags: TagOption[] }) {
  const t = useTranslations();
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);

  if (saved) {
    return (
      <>
        <PageHeader title={t("scan.savedTitle")} subtitle={saved.title} />
        <div className="card p-4">
          <h2 className="mb-3 text-md">{t("capacity.chooseLevel")}</h2>
          <ShelvingPicker
            bookId={saved.id}
            onPlaced={() => setSaved(null)}
            onSkip={() => setSaved(null)}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSaved(null)} className="btn btn-primary">
            {t("common.add")}
          </button>
          <Link href={`/books/${saved.id}`} className="btn btn-ghost">
            {t("common.edit")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("book.addTitle")} />
      <div className="card p-4">
        <BookForm tags={tags} onSaved={setSaved} />
      </div>
    </>
  );
}
