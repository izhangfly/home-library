import { chromium } from 'playwright';
const B='https://library.example.com';
const OUT='/private/tmp/claude-501/-Users-ianzhang/c602163e-8a86-4080-8767-50a1e5c21767/scratchpad';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:1100}});
const pg=await ctx.newPage();
pg.on('console', m => { if (m.type()==='error') console.log('  [console error]', m.text().slice(0,140)); });
pg.on('response', r => { if (r.status()>=400) console.log('  [http]', r.status(), r.url().replace(B,'')); });

await pg.goto(B+'/shelves',{waitUntil:'networkidle'});
const pw=await pg.$('input[type=password]');
if(pw){ await pw.fill('101103YOUyou'); await pg.click('button[type=submit]'); await pg.waitForTimeout(2500); }

await pg.goto(B+'/scan',{waitUntil:'networkidle'});
await pg.waitForTimeout(2000);
await pg.screenshot({path:`${OUT}/scan-1-start.png`});

// 手动输入条码
const input = await pg.$('input[inputmode="numeric"], input[type="text"]');
if (!input) { console.log('找不到手动输入框'); await b.close(); process.exit(1); }
await input.fill('9787544253994');           // 百年孤独
for (const btn of await pg.$$('button')) {
  const txt=(await btn.innerText()).trim();
  if (/查询|提交|确定|搜索/.test(txt)) { await btn.click(); break; }
}
await pg.waitForTimeout(9000);
await pg.screenshot({path:`${OUT}/scan-2-result.png`, fullPage:true});
console.log('URL:', pg.url());
console.log('页面标题区:', (await pg.innerText('h1').catch(()=>'(无 h1)')).slice(0,60));
await b.close();
