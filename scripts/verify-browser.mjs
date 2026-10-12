import { execSync, spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9333) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const data = await res.json();
        const page = data.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (_) {}
    await wait(300);
  }
  throw new Error('Chrome remote debugging did not respond with a page target');
}

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9333',
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_profile',
      '--disable-gpu',
      '--window-size=1440,950',
      '--no-sandbox',
      'http://localhost:3000',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9333);
    console.log('Connected to Chrome CDP:', wsUrl);

    const WebSocket = globalThis.WebSocket;
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve) => ws.onopen = resolve);

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const currentId = id++;
        const handler = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === currentId) {
            ws.removeEventListener('message', handler);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: currentId, method, params }));
      });
    }

    await send('Page.enable');
    await send('DOM.enable');
    await wait(2500); // Wait for page hydration & initial render

    // 1. Capture Hero Section (y=0)
    await send('Runtime.evaluate', { expression: 'window.scrollTo({ top: 0, behavior: "instant" })' });
    await wait(800);
    const heroShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-01-hero.png', Buffer.from(heroShot.data, 'base64'));
    console.log('✓ Captured verify-01-hero.png');

    // 2. Scroll to Product Demonstration
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("product-demo")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(800);
    const demoShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-02-product-demo.png', Buffer.from(demoShot.data, 'base64'));
    console.log('✓ Captured verify-02-product-demo.png');

    // 3. Scroll to Four Clinical Stages (Scroll Stack Stage 1)
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("clinical-stages")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(800);
    const stackShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-03-scroll-stack.png', Buffer.from(stackShot.data, 'base64'));
    console.log('✓ Captured verify-03-scroll-stack.png');

    // 4. Scroll to Capabilities Stories
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("capabilities")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(800);
    const capShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-04-capabilities.png', Buffer.from(capShot.data, 'base64'));
    console.log('✓ Captured verify-04-capabilities.png');

    // 5. Scroll to Care Network Preview
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("care")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(800);
    const careShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-05-care-network.png', Buffer.from(careShot.data, 'base64'));
    console.log('✓ Captured verify-05-care-network.png');

    // 6. Scroll to FAQ & Closing CTA
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("faq")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(800);
    const faqShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-06-faq-cta.png', Buffer.from(faqShot.data, 'base64'));
    console.log('✓ Captured verify-06-faq-cta.png');

    // 7. Scroll to Footer
    await send('Runtime.evaluate', { expression: 'window.scrollTo({ top: 999999, behavior: "instant" })' });
    await wait(800);
    const footerShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-07-footer.png', Buffer.from(footerShot.data, 'base64'));
    console.log('✓ Captured verify-07-footer.png');

    // 8. Test Care Route navigation (/care) - verify Care tab selected
    await send('Page.navigate', { url: 'http://localhost:3000/care' });
    await wait(2000);
    const careNavShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-08-care-route.png', Buffer.from(careNavShot.data, 'base64'));
    console.log('✓ Captured verify-08-care-route.png');

    // 9. Test Unmapped Route navigation (/profile) - verify NO tab selected
    await send('Page.navigate', { url: 'http://localhost:3000/profile' });
    await wait(2000);
    const profileNavShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-10-profile-route.png', Buffer.from(profileNavShot.data, 'base64'));
    console.log('✓ Captured verify-10-profile-route.png');

    // 10. Test Mobile Layout (390x844) on Home
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send('Page.navigate', { url: 'http://localhost:3000/' });
    await wait(2000);
    const mobileShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-09-mobile.png', Buffer.from(mobileShot.data, 'base64'));
    console.log('✓ Captured verify-09-mobile.png');

    ws.close();
    console.log('All verification captures completed successfully!');
  } finally {
    try {
      chromeProcess.kill();
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
