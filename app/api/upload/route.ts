// 封面上传 —— 手动录入时"拍个封面"的落地点（F1）
//
// iPhone 拍出来的原图动辄 3-5MB，直接存会把磁盘和流量都吃掉，
// 所以统一用 sharp 压到宽 600px 的 webp，一张大概 30-60KB。
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fail, ok, readForm, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || "./data/uploads");
}

export const POST = route(async (req: Request) => {
  rateLimit(req, "upload");
  const form = await readForm(req);
  const file = form.get("file");

  if (!(file instanceof File)) return fail("missing_file", 400);
  if (file.size > MAX_BYTES) return fail("file_too_large", 413);
  // iOS 有时不给 HEIC 正确的 MIME，所以类型为空也放行，交给 sharp 判断
  if (file.type && !ALLOWED.includes(file.type)) return fail("unsupported_type", 415);

  const buffer = Buffer.from(await file.arrayBuffer());

  let output: Buffer;
  try {
    output = await sharp(buffer)
      .rotate() // 按 EXIF 摆正，否则竖着拍的封面会躺下
      .resize({ width: 600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return fail("not_an_image", 415);
  }

  const name = `${randomUUID()}.webp`;
  const dir = path.join(uploadDir(), "covers");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), output);

  return ok({ url: `/uploads/covers/${name}`, bytes: output.length });
});
