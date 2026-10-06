// A short recording of the real app: create a profile, feed, video, switch profiles.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ScreencastRecorder,launchBrowser,newSceneContext,clickAt,typeHuman,waitForVisibleImages} from './lib.mjs';
const base=process.env.GRETEL_SHOWCASE_URL || 'http://127.0.0.1:3111/app';
const root=path.resolve(process.env.SHOWCASE_CAPTURE_DIR || 'showcase/captures/simple');
const output=path.resolve(process.env.GIF_OUTPUT || 'docs/showcase/gretel-showcase-steps.gif');
fs.mkdirSync(root,{recursive:true}); fs.mkdirSync(path.dirname(output),{recursive:true});
const browser=await launchBrowser();
const context=await newSceneContext(browser,{width:1280,height:800,deviceScaleFactor:1});
// Hide Next's development indicator from the recording.
await context.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s);});});
await context.addInitScript(()=>{
 window.__arabicCaptureHits=[];window.__captureActive=false;
 const check=()=>{if(window.__captureActive && /[\u0600-\u06ff]/.test(document.body?.innerText||''))window.__arabicCaptureHits.push(Date.now());};
 document.addEventListener('DOMContentLoaded',()=>new MutationObserver(check).observe(document.body,{subtree:true,childList:true,characterData:true}));
});
const page=await context.newPage();
const segments=[];
const click=async locator=>clickAt(page,locator,{settle:300});
const record=async(name,action)=>{
 const recorder=new ScreencastRecorder(page); const dir=path.join(root,name);
 if(/[\u0600-\u06ff]/.test(await page.locator('body').innerText()))throw Error('Arabic text present before capture');
 await page.evaluate(()=>{window.__arabicCaptureHits=[];window.__captureActive=true;});
 await recorder.start(dir);
 try{await page.waitForTimeout(500);await action();await page.waitForTimeout(800);}finally{
  await recorder.stop();
  const hits=await page.evaluate(()=>{window.__captureActive=false;return window.__arabicCaptureHits;});
  if(hits.length)throw Error('Arabic text appeared during '+name+'; rejecting capture');
  fs.writeFileSync(path.join(dir,'raw.json'),JSON.stringify({frames:recorder.frames}));
  segments.push({dir,frames:recorder.frames});
  console.log('Recorded',name,recorder.frames.length,'frames');
 }
};
const feed=async()=>{
 await page.locator('.feed-build-container').waitFor({state:'hidden',timeout:300000});
 await page.locator('.video-grid .video-card .thumbnail-button').first().waitFor({timeout:300000});
 await waitForVisibleImages(page,{timeout:90000});
};
try{
 await page.goto(base);await feed();
 await record('01-create',async()=>{
  await click(page.locator('.profile-button'));
  await click(page.getByRole('button',{name:'Manage profiles',exact:true}));
  await click(page.locator('input[placeholder="e.g. Systems design"]'));
  await typeHuman(page,'Creative Coding',{perChar:55,jitter:0,settle:400});
  await click(page.locator('.wizard-next'));
  const input=page.locator('input[placeholder="Add a topic"]');
  for(const topic of ['creative coding','generative art']){
   await click(input);await typeHuman(page,topic,{perChar:40,jitter:0,settle:120});await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);await click(page.locator('.wizard-next'));
  await click(page.locator('input[placeholder="Search channel"]'));
  await typeHuman(page,'The Coding Train',{perChar:45,jitter:0,settle:150});
 });
 const option=page.locator('.channel-popup-item').filter({hasText:'The Coding Train'}).first();
 await option.waitFor({timeout:60000});
 await record('02-finish',async()=>{
  await click(option);await page.waitForTimeout(500);await click(page.locator('.wizard-next'));
 });
 console.log('Waiting for the real profile feed to finish building…');
 await page.locator('.profile-modal').waitFor({state:'hidden',timeout:300000});await feed();
 await record('03-feed',async()=>{
  await page.mouse.move(650,420);await page.waitForTimeout(1300);await page.mouse.wheel(0,330);await page.waitForTimeout(800);await page.mouse.wheel(0,-330);await page.waitForTimeout(500);
  await click(page.locator('.video-card .thumbnail-button').first());
  await page.locator('.watch-layout.open').waitFor({timeout:45000});
 });
 // Let the player load outside the GIF so the session stays short.
 await page.waitForTimeout(8000);
 await page.screenshot({path:path.join(root,'watch.png')});
 console.log('Watch view:',(await page.locator('.watch-layout').innerText()).slice(0,350));
 await record('04-video',async()=>{await page.mouse.move(780,690);await page.waitForTimeout(2800);});
 await record('05-profiles',async()=>{
  await click(page.getByRole('button',{name:'Home',exact:true}));await feed();
  await click(page.locator('.profile-button'));await page.waitForTimeout(600);
  await click(page.locator('.profile-popover button').filter({hasText:'Startups'}));await feed();await page.waitForTimeout(1800);
  await click(page.locator('.profile-button'));await page.waitForTimeout(600);
  await click(page.locator('.profile-popover button').filter({hasText:'Creative Coding'}));await feed();await page.waitForTimeout(1800);
 });
 await page.screenshot({path:path.join(root,'final.png')});
 const normalized=path.join(root,'gif-frames');fs.rmSync(normalized,{recursive:true,force:true});fs.mkdirSync(normalized,{recursive:true});
 let index=0;
 for(const {dir,frames} of segments){
  const start=frames[0].timestamp;const duration=(frames.at(-1).holdUntil-start)/1.15;
  let cursor=0;
  for(let t=0;t<duration;t+=1/12){
   while(cursor+1<frames.length && frames[cursor+1].timestamp-start<=t*1.15)cursor++;
   const source=path.join(dir,String(frames[cursor].index).padStart(5,'0')+'.png');
   const target=path.join(normalized,String(index++).padStart(5,'0')+'.png');
   fs.rmSync(target,{force:true});fs.symlinkSync(source,target);
  }
 }
 execFileSync('ffmpeg',['-y','-v','error','-framerate','12','-i',path.join(normalized,'%05d.png'),'-filter_complex','scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle','-loop','0',output],{stdio:'inherit'});
 console.log('GIF:',output,(fs.statSync(output).size/1048576).toFixed(2)+' MB');
}finally{await browser.close();}
