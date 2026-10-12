import { spawn } from 'child_process';
import fs from 'fs';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9491) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const data = await res.json();
        const page = data.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (_) {}
    await wait(300);
  }
  throw new Error('Chrome remote debugging did not respond');
}

async function run() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9491',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_privacy_sculptural',
      '--disable-gpu',
      '--window-size=1440,1100',
      '--no-sandbox',
      'about:blank',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9491);
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    let id = 1;
    function send(method, params = {}) {
      return new Promise((r, j) => {
        const cur = id++;
        const h = (e) => {
          const m = JSON.parse(e.data);
          if (m.id === cur) {
            ws.removeEventListener('message', h);
            m.error ? j(m.error) : r(m.result);
          }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: cur, method, params }));
      });
    }

    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:3000/privacy' });
    await wait(4000);

    // 1. Capture Desktop 1440px side-by-side view
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(1000);

    // 1. Capture Desktop 1440px natural top view (proving zero navbar overlap at scrollTo(0,0))
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, 0);` });
    await wait(1000);

    const shotTop = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-sculptural-top-clearance.png', Buffer.from(shotTop.data, 'base64'));
    console.log('Saved verify-sculptural-top-clearance.png');

    // 2. Scroll to position the sculptural instrument centered in viewport
    await send('Runtime.evaluate', {
      expression: `(() => {
        const h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent && h.textContent.includes('Interactive Clinical Data Lifecycle'));
        if (h2) {
          h2.scrollIntoView({ behavior: 'instant', block: 'start' });
          window.scrollBy(0, -90);
        } else {
          window.scrollBy(0, 220);
        }
      })()`,
    });
    await wait(2200);

    const shotDesktop = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-sculptural-desktop.png', Buffer.from(shotDesktop.data, 'base64'));
    console.log('Saved verify-sculptural-desktop.png');

    // 3. Click stage "04 Cloud LLM"
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cloud LLM'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1800);

    const shotStage4 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-sculptural-stage4.png', Buffer.from(shotStage4.data, 'base64'));
    console.log('Saved verify-sculptural-stage4.png');

    // 3. Mobile 375px test
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(1000);

    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ingest'));
        if (btn) btn.click();
        const h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent && h.textContent.includes('Interactive Clinical Data Lifecycle'));
        if (h2) {
          h2.scrollIntoView({ behavior: 'instant', block: 'start' });
          window.scrollBy(0, -70);
        }
      })()`,
    });
    await wait(2200);

    const shotMobile = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-sculptural-mobile.png', Buffer.from(shotMobile.data, 'base64'));
    console.log('Saved verify-sculptural-mobile.png');

    ws.close();
  } finally {
    try {
      chromeProcess.kill();
    } catch (_) {}
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
