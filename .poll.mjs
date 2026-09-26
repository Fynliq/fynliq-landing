import puppeteer from 'puppeteer-core';
const deadline = Date.now() + 9 * 60 * 1000;
while (Date.now() < deadline) {
  const b = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:'new', args:['--no-sandbox'] });
  try {
    const p = await b.newPage();
    await p.goto('https://www.fynliq.com/gradi/start', {waitUntil:'networkidle2', timeout:60000});
    await new Promise(r=>setTimeout(r,2000));
    const steps = await p.$$eval('ol li button', els=>els.length).catch(()=>0);
    const h1 = await p.$eval('h1', e=>e.textContent.trim()).catch(()=>'');
    if (steps === 6) { console.log('DEPLOYE : ' + h1); await b.close(); process.exit(0); }
    console.log(new Date().toISOString().slice(11,19) + ' pas encore (' + steps + ' etapes)');
  } catch (e) { console.log('erreur transitoire: ' + e.message.slice(0,60)); }
  await b.close();
  await new Promise(r=>setTimeout(r,30000));
}
console.log('TOUJOURS PAS DEPLOYE apres 9 minutes');
process.exit(1);
