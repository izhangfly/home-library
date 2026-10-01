import { chromium } from 'playwright';
const B='https://library.example.com';
const OUT='/private/tmp/claude-501/-Users-ianzhang/c602163e-8a86-4080-8767-50a1e5c21767/scratchpad';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:1100}});
const pg=await ctx.newPage();
await pg.goto(B+'/shelves',{waitUntil:'networkidle'});
const pw=await pg.$('input[type=password]');
if(pw){ await pw.fill('101103YOUyou'); await pg.click('button[type=submit]'); await pg.waitForTimeout(2500); }
for (const [path, name, wait] of [['/shelves','shelves',3500],['/map','map',2500],['/space','space',3000],['/reflow?tab=layout','layout',3500]]) {
  await pg.goto(B+path,{waitUntil:'networkidle'});
  await pg.waitForTimeout(wait);
  await pg.screenshot({path:`${OUT}/v3-${name}.png`, fullPage: name==='shelves'||name==='layout'});
  console.log(name, 'ok');
}
await b.close();
