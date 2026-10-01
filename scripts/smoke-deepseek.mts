// spec 阶段 8 的验收脚本：
//   先测一本冷门到 DeepSeek 大概率不认识的书 → 必须返回"信息不足"而不是编造
//   再测一本知名书 → 简介应简短、无剧透
// 跑法：npm run smoke:deepseek
import "dotenv/config";
import { generateAiSummary, type AiSummaryInput } from "../lib/deepseek";

const cases: { name: string; book: AiSummaryInput }[] = [
  {
    name: "冷门/虚构书目（期望 insufficient）",
    book: {
      title: "铜环与夜航班",
      authors: ["林未平"],
      publisher: "海西文艺出版社",
      pubDate: "2013",
    },
  },
  {
    name: "知名中文书（期望 ok，简短无剧透）",
    book: {
      title: "你一定爱读的极简欧洲史",
      authors: ["约翰·赫斯特"],
      publisher: "广西师范大学出版社",
      pubDate: "2019-9",
    },
  },
  {
    name: "知名英文书 / 英文界面（期望 ok，英文输出）",
    book: {
      title: "Crime and Punishment",
      authors: ["Fyodor Dostoyevsky"],
      publisher: "Penguin",
      locale: "en",
    },
  },
];

for (const c of cases) {
  const result = await generateAiSummary(c.book);
  console.log(`\n[${c.name}]`);
  console.log(`  status = ${result.status}${result.error ? `  error = ${result.error}` : ""}`);
  if (result.summary) {
    console.log(`  简介(${result.summary.length} 字): ${result.summary}`);
  }
}
