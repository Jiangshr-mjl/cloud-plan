import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
await mkdir('public/ui-review-preview',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const screens={daily:'.daily-workspace',list:'.projects-list',quadrants:'.priority-matrix',timeline:'.project-timeline',habits:'.habit-card',history:'.records-panel',settings:'.settings-grid',welcome:'.unlock-card'};
for(const [screen,selector] of Object.entries(screens)){
 const context=await browser.newContext({viewport:{width:1440,height:1080},reducedMotion:'reduce'});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:5174/?screen='+screen);
 await page.locator(selector).first().waitFor();
 await page.waitForTimeout(1200);
 await page.screenshot({path:'public/ui-review-preview/'+screen+'.png',fullPage:true});
 console.log(screen);await context.close();
}
await browser.close();
