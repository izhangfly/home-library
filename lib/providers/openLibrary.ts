// OpenLibrary —— 英文/俄文的主力源，无需登录、无配额。
// 中文书覆盖率实测极低（spec §3.1 的判断成立），所以只当交叉校对用。
import {
  fetchWithTimeout,
  ProviderError,
  type BookCandidate,
  type MetadataProvider,
} from "./types";

interface OlBook {
  title?: string;
  subtitle?: string;
  authors?: { name?: string; url?: string }[];
  publishers?: { name?: string }[];
  publish_date?: string;
  number_of_pages?: number;
  cover?: { small?: string; medium?: string; large?: string };
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
  classifications?: { dewey_decimal_class?: string[]; lc_classifications?: string[] };
  subjects?: { name?: string }[];
  url?: string;
  notes?: string;
}

export const openLibraryProvider: MetadataProvider = {
  id: "openLibrary",

  isEnabled() {
    return process.env.OPENLIBRARY_ENABLED !== "false";
  },

  async byIsbn(isbn13: string, isbn10?: string): Promise<BookCandidate[]> {
    const keys = [`ISBN:${isbn13}`, isbn10 ? `ISBN:${isbn10}` : null].filter(Boolean).join(",");
    const url = `https://openlibrary.org/api/books?bibkeys=${keys}&format=json&jscmd=data`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new ProviderError(`http_${res.status}`);

    const data = (await res.json()) as Record<string, OlBook>;
    const out: BookCandidate[] = [];

    for (const book of Object.values(data)) {
      if (!book?.title) continue;
      out.push({
        source: "openLibrary",
        isbn13,
        isbn10: book.identifiers?.isbn_10?.[0] ?? isbn10,
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors?.map((a) => a.name).filter((n): n is string => !!n),
        publisher: book.publishers?.[0]?.name,
        pubDate: book.publish_date,
        pageCount: book.number_of_pages,
        summary: book.notes,
        coverUrl: book.cover?.large ?? book.cover?.medium ?? book.cover?.small,
        externalUrl: book.url,
        subjects: book.subjects?.map((s) => s.name).filter((n): n is string => !!n).slice(0, 12),
        // 唯一能拿到权威 DDC 的地方。实测命中率不高（8 本里 1 本），
        // 但只要有就比推断的可信，所以优先用。
        ddc: book.classifications?.dewey_decimal_class?.[0],
      });
    }
    return out;
  },

  async search(query: string): Promise<BookCandidate[]> {
    const url =
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}` +
      `&limit=10&fields=title,subtitle,author_name,publisher,first_publish_year,` +
      `number_of_pages_median,isbn,cover_i,subject,key`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new ProviderError(`http_${res.status}`);

    const data = (await res.json()) as {
      docs?: {
        title?: string;
        subtitle?: string;
        author_name?: string[];
        publisher?: string[];
        first_publish_year?: number;
        number_of_pages_median?: number;
        isbn?: string[];
        cover_i?: number;
        subject?: string[];
        key?: string;
      }[];
    };

    return (data.docs ?? [])
      .filter((d) => d.title)
      .map((d) => ({
        source: "openLibrary" as const,
        title: d.title,
        subtitle: d.subtitle,
        authors: d.author_name,
        publisher: d.publisher?.[0],
        pubDate: d.first_publish_year ? String(d.first_publish_year) : undefined,
        pageCount: d.number_of_pages_median,
        isbn13: d.isbn?.find((i) => i.length === 13),
        isbn10: d.isbn?.find((i) => i.length === 10),
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
        subjects: d.subject?.slice(0, 12),
        externalUrl: d.key ? `https://openlibrary.org${d.key}` : undefined,
      }));
  },
};
