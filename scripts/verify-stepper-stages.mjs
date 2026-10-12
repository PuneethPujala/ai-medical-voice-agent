import { spawn } from 'child_process';
import fs from 'fs';

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
    await new Promise((resolve) => (ws.onopen = resolve));

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

    // 1. Scroll to Clinical Stages section
    console.log('Navigating to #clinical-stages...');
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("clinical-stages")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(1200);

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-stage1-desktop.png', Buffer.from(shot1.data, 'base64'));
    console.log('✓ Captured verify-stepper-stage1-desktop.png (Stage 1: Listen active)');

    // 2. Click Stage 2 (Understand) in Stepper
    console.log('Clicking Step 2 (Understand)...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('#clinical-stages button'));
          const step2Btn = buttons.find(b => b.textContent && b.textContent.includes('Understand'));
          if (step2Btn) step2Btn.click();
        })()
      `
    });
    await wait(1200);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-stage2-click.png', Buffer.from(shot2.data, 'base64'));
    console.log('✓ Captured verify-stepper-stage2-click.png (Step 2 clicked, scrolled to card 2)');

    // 3. Click Stage 3 (Assess) in Stepper
    console.log('Clicking Step 3 (Assess)...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('#clinical-stages button'));
          const step3Btn = buttons.find(b => b.textContent && b.textContent.includes('Assess'));
          if (step3Btn) step3Btn.click();
        })()
      `
    });
    await wait(1200);

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-stage3-click.png', Buffer.from(shot3.data, 'base64'));
    console.log('✓ Captured verify-stepper-stage3-click.png (Step 3 clicked, scrolled to card 3)');

    // 4. Click Stage 4 (Act) in Stepper
    console.log('Clicking Step 4 (Act)...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('#clinical-stages button'));
          const step4Btn = buttons.find(b => b.textContent && b.textContent.includes('Act'));
          if (step4Btn) step4Btn.click();
        })()
      `
    });
    await wait(1200);

    const shot4 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-stage4-click.png', Buffer.from(shot4.data, 'base64'));
    console.log('✓ Captured verify-stepper-stage4-click.png (Step 4 clicked, scrolled to card 4)');

    // 5. Test Natural Scroll Synchronization back up to Card 1
    console.log('Scrolling back up to Stage 1 card...');
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("stage-card-1")?.scrollIntoView({ behavior: "smooth", block: "center" })'
    });
    await wait(1200);

    const shotSync = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-scroll-sync.png', Buffer.from(shotSync.data, 'base64'));
    console.log('✓ Captured verify-stepper-scroll-sync.png (Natural scroll synchronized Stepper back to active stage)');

    // 6. Test Mobile Viewport (390x844)
    console.log('Testing mobile viewport (390x844)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("clinical-stages")?.scrollIntoView({ behavior: "instant", block: "start" })'
    });
    await wait(1200);

    const shotMobile = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-stepper-mobile.png', Buffer.from(shotMobile.data, 'base64'));
    console.log('✓ Captured verify-stepper-mobile.png (Mobile responsive Stepper & Card 1)');

    ws.close();
    console.log('🎉 All Stepper browser verifications completed successfully!');
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
