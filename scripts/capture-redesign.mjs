import { spawn } from 'child_process';
import fs from 'fs';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9488) {
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
      '--remote-debugging-port=9488',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_pic2',
      '--disable-gpu',
      '--window-size=1440,1100',
      '--no-sandbox',
      'about:blank',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9488);
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
    await send('Page.navigate', { url: 'http://localhost:3000/care' });
    await wait(3500);

    // Click "Choose a city or region" button
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose a city or region'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1000);

    // Click "Guntur"
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Guntur'));
        if (btn) btn.click();
      })()`,
    });
    await wait(3500);

    async function captureAt(width, height, filename) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await wait(800);
      await send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.getElementById("care-map-section");
          if (el) {
            const rect = el.getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + rect.top - 110, behavior: "instant" });
          }
        })()`,
      });
      await wait(1500);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`c:\\dev\\Capstone\\${filename}`, Buffer.from(shot.data, 'base64'));
      console.log(`Saved ${filename} successfully!`);
    }

    await captureAt(1440, 900, 'verify-care-redesign-1440.png');
    await captureAt(1280, 800, 'verify-care-redesign-1280.png');

    // Click item #2 (Sri Sai Krishna)
    await send('Runtime.evaluate', {
      expression: `(() => {
        const item2 = Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent && el.textContent.includes('Sri Sai Krishna'));
        if (item2) item2.click();
      })()`,
    });
    await wait(2000);

    // Expand the rationale factors
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && (b.textContent.includes('Factors') || b.textContent.includes('Match Rationale')));
        if (btn) btn.click();
      })()`,
    });
    await wait(1500);

    const shotSelected2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('c:\\dev\\Capstone\\verify-care-redesign-selected2.png', Buffer.from(shotSelected2.data, 'base64'));
    console.log('Saved verify-care-redesign-selected2.png successfully!');

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
