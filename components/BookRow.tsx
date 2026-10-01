import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CompletenessBar } from "./ui";
import { coverSrc } from "@/lib/cover";
import { CallNumber } from "./CallNumber";
import { DirectoryPath } from "./DirectoryPath";
import { tagChipStyle } from "@/lib/contrast";

export interface BookRowData {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  completeness: number;
  callNumber: string | null;
  ddc: string | null;
  clc: string | null;
  clcSource: string | null;
  tags: { tag: { id: string; name: string; color: string } }[];
  placement: {
    level: { levelIndex: number; bookcase: { name: string; room: string | null } };
  } | null;
}

/** 书目列表里反复出现的一行：封面缩略、标题、作者、位置、完整度 */
export async function BookRow({
  book,
  missing,
}: {
  book: BookRowData;
  missing?: string[];
}) {
  const t = await getTranslations();

  return (
    <li>
      <Link
        href={`/books/${book.id}`}
        className="card-flat flex items-center gap-3 p-3 transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-border)]"
      >
        <Cover url={book.coverUrl} title={book.title} />

        <div className="min-w-0 flex-1">
          <p className="truncate font-black">{book.title}</p>
          <p className="hint truncate">
            {book.authors.length ? book.authors.join(" / ") : t("common.unknown")}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <CallNumber callNumber={book.callNumber} clc={book.clc} />
            {book.tags.slice(0, 3).map(({ tag }) => (
              <span
                key={tag.id}
                className="chip"
                style={tagChipStyle(tag.color)}
              >
                {tag.name}
              </span>
            ))}
            <DirectoryPath
              info={{
                room: book.placement?.level.bookcase.room,
                bookcaseName: book.placement?.level.bookcase.name,
                levelIndex: book.placement?.level.levelIndex,
                clc: book.clc,
              }}
            />
          </div>

          {missing && missing.length > 0 && (
            <div className="mt-2">
              <CompletenessBar value={book.completeness} />
              <p className="hint mt-1 truncate">
                {t("book.missingFields")}: {missing.join(", ")}
              </p>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

export function Cover({ url, title }: { url: string | null; title: string }) {
  const src = coverSrc(url);
  if (!src) {
    return (
      <div
        className="flex h-16 w-12 shrink-0 items-center justify-center rounded-sm border-2 border-border bg-surface-3 text-center text-2xs font-black text-text-muted"
        aria-hidden="true"
      >
        {title.slice(0, 2)}
      </div>
    );
  }
  return (
    // 走 /api/cover 代理，所以都是同源图片；用原生 img 省掉 next/image 的域名白名单维护
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-16 w-12 shrink-0 rounded-sm border-2 border-border bg-surface-3 object-cover"
    />
  );
}
