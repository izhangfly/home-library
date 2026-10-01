// 条码解析 —— spec §3.4
//
// 家里的纸质品有三类条码，必须分开处理，否则杂志一律扫不出来：
//   978 / 979(非 9790) 开头的 EAN-13  → 图书 ISBN
//   977 开头的 EAN-13                 → 期刊 ISSN（后面常跟 2 位或 5 位附加码 = 期号）
//   9790 开头的 EAN-13                → ISMN（乐谱），当前不查元数据，按手动录入走

export type BarcodeKind = "isbn" | "issn" | "ismn" | "unknown";

export interface ParsedBarcode {
  kind: BarcodeKind;
  raw: string;
  /** 归一化后的 13 位 ISBN（kind === "isbn" 时有值） */
  isbn13?: string;
  /** 由 ISBN-13 反推的 ISBN-10，仅 978 前缀可推 */
  isbn10?: string;
  /** 带校验位的 8 位 ISSN，如 "0269-3577"（kind === "issn" 时有值） */
  issn?: string;
  /** 附加码：2 位或 5 位，期刊上一般是期号 */
  addon?: string;
  valid: boolean;
  /** 校验失败时的说明，前端可以直接展示 */
  reason?: string;
}

/** 去掉连字符、空格、前后缀，统一大写 X */
export function normalize(input: string): string {
  return input.replace(/[\s\-–—_]/g, "").toUpperCase();
}

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function isbn10CheckChar(first9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const rem = (11 - (sum % 11)) % 11;
  return rem === 10 ? "X" : String(rem);
}

export function isValidIsbn10(code: string): boolean {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  return isbn10CheckChar(code.slice(0, 9)) === code[9];
}

/** ISBN-10 → ISBN-13（加 978 前缀重算校验位） */
export function isbn10To13(isbn10: string): string {
  const core = "978" + isbn10.slice(0, 9);
  return core + ean13CheckDigit(core);
}

/** ISBN-13 → ISBN-10，只有 978 前缀可以反推 */
export function isbn13To10(isbn13: string): string | undefined {
  if (!isbn13.startsWith("978")) return undefined;
  const core = isbn13.slice(3, 12);
  return core + isbn10CheckChar(core);
}

function issnCheckChar(first7: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(first7[i]) * (8 - i);
  const rem = (11 - (sum % 11)) % 11;
  return rem === 10 ? "X" : String(rem);
}

/**
 * 977 开头的 EAN-13 里嵌的是 ISSN 的前 7 位：
 *   977 + ISSN[1..7] + 2 位变体码 + EAN 校验位
 * ISSN 自己的校验位不在条码里，需要重新算出来。
 */
export function issnFromEan(ean: string): string {
  const core = ean.slice(3, 10);
  return `${core.slice(0, 4)}-${core.slice(4)}${issnCheckChar(core)}`;
}

export function isValidIssn(issn: string): boolean {
  const core = normalize(issn);
  if (!/^\d{7}[\dX]$/.test(core)) return false;
  return issnCheckChar(core.slice(0, 7)) === core[7];
}

/**
 * 解析扫描器吐出来的原始串。
 * 扫描库可能把主码和附加码连在一起返回（13+2 或 13+5 位），这里一并拆开。
 */
export function parseBarcode(input: string): ParsedBarcode {
  const raw = input.trim();
  const code = normalize(raw);

  // 直接给了 ISBN-10（书背面印的老式号码，手输时常见）
  if (/^\d{9}[\dX]$/.test(code)) {
    if (!isValidIsbn10(code)) {
      return { kind: "isbn", raw, valid: false, reason: "isbn10_checksum" };
    }
    const isbn13 = isbn10To13(code);
    return { kind: "isbn", raw, isbn13, isbn10: code, valid: true };
  }

  const m = code.match(/^(\d{13})(\d{2}|\d{5})?$/);
  if (!m) {
    return { kind: "unknown", raw, valid: false, reason: "not_a_barcode" };
  }

  const ean = m[1];
  const addon = m[2];

  if (!isValidEan13(ean)) {
    return { kind: "unknown", raw, valid: false, reason: "ean13_checksum" };
  }

  if (ean.startsWith("977")) {
    // 期刊 —— 不要当成 ISBN 去查，会 100% 查不到
    return { kind: "issn", raw, issn: issnFromEan(ean), addon, valid: true };
  }

  if (ean.startsWith("9790")) {
    return { kind: "ismn", raw, addon, valid: true };
  }

  if (ean.startsWith("978") || ean.startsWith("979")) {
    return {
      kind: "isbn",
      raw,
      isbn13: ean,
      isbn10: isbn13To10(ean),
      addon,
      valid: true,
    };
  }

  // 合法 EAN-13 但不是出版物（比如书上贴的价格标签）
  return { kind: "unknown", raw, valid: false, reason: "not_a_publication" };
}

/** 中国大陆 ISBN 前缀，用来决定先查中文源还是先查英文源 */
export function isLikelyChinese(isbn13?: string | null): boolean {
  return !!isbn13 && (isbn13.startsWith("9787") || isbn13.startsWith("9797"));
}
