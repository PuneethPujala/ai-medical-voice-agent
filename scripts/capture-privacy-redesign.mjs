import { spawn } from 'child_process';
import fs from 'fs';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9489) {
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
      '--remote-debugging-port=9489',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_privacy_pic3',
      '--disable-gpu',
      '--window-size=1440,1100',
      '--no-sandbox',
      'about:blank',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9489);
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

    // 1. Capture top of page showing navbar clearance and header
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(1000);

    const shotTop = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-privacy-desktop-top.png', Buffer.from(shotTop.data, 'base64'));
    console.log('Saved verify-privacy-desktop-top.png');

    // 2. Scroll to center the 3D instrument
    await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('h2');
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          window.scrollBy(0, -90);
        }
      })()`,
    });
    await wait(2000);

    const shotInstrument1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-privacy-instrument-initial.png', Buffer.from(shotInstrument1.data, 'base64'));
    console.log('Saved verify-privacy-instrument-initial.png');

    // 3. Click stage "03 Safety Arbiter"
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Safety Arbiter'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1500);

    const shotStage3 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-privacy-stage3-selected.png', Buffer.from(shotStage3.data, 'base64'));
    console.log('Saved verify-privacy-stage3-selected.png');

    // 4. Click stage "04 Cloud LLM"
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cloud LLM'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1500);

    const shotStage4 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-privacy-stage4-selected.png', Buffer.from(shotStage4.data, 'base64'));
    console.log('Saved verify-privacy-stage4-selected.png');

    // 5. Mobile 375px test
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(1000);

    await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('h2');
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          window.scrollBy(0, -70);
        }
      })()`,
    });
    await wait(1500);

    const shotMobile = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-privacy-mobile-375.png', Buffer.from(shotMobile.data, 'base64'));
    console.log('Saved verify-privacy-mobile-375.png');

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
