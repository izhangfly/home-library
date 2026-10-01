// 上传的封面存在 UPLOAD_DIR（不在 public/ 里，这样重新部署不会把用户数据冲掉），
// 所以要自己 serve。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { uploadDir } from "@/app/api/upload/route";
import { fail, route } from "@/lib/api";

type Ctx = { params: Promise<{ path: string[] }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { path: segments } = await params;

  const root = uploadDir();
  const target = path.resolve(root, ...segments);
  // 目录穿越防护：解析后必须仍在 UPLOAD_DIR 之内
  if (target !== root && !target.startsWith(root + path.sep)) {
    return fail("forbidden", 403);
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return fail("not_found", 404);
  }
  if (!info.isFile()) return fail("not_found", 404);

  const ext = path.extname(target).toLowerCase();
  const type =
    ext === ".webp" ? "image/webp"
    : ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : "application/octet-stream";

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(info.size),
      // 文件名是 uuid，内容不会变，可以长缓存
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
