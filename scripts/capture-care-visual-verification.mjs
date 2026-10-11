import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9468) {
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

async function capture() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9468',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_care_visual',
      '--disable-gpu',
      '--window-size=1440,1100',
      '--no-sandbox',
      'about:blank',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9468);
    const WebSocket = globalThis.WebSocket;
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
    await send('DOM.enable');

    console.log('Navigating to care page...');
    await send('Page.navigate', { url: 'http://localhost:3000/care' });
    await wait(3500);

    // 1. Open city selector and select 'Bengaluru'
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose a city or region'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1000);

    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Bengaluru');
        if (btn) btn.click();
      })()`,
    });
    await wait(3500);

    // 2. Capture Map + Destination Card + Active Route HUD
    const shotMapSection = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-01-map-active-route.png'), Buffer.from(shotMapSection.data, 'base64'));
    console.log('Saved verify-01-map-active-route.png');

    // 3. Click the first marker on the map to open the Leaflet popup
    await send('Runtime.evaluate', {
      expression: `(() => {
        const marker = document.querySelector('.custom-hospital-marker');
        if (marker) marker.click();
      })()`,
    });
    await wait(1000);

    const shotPopup = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-02-leaflet-popup.png'), Buffer.from(shotPopup.data, 'base64'));
    console.log('Saved verify-02-leaflet-popup.png');

    // 4. Scroll down slightly so content scrolls under sticky navbar
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, 350)`,
    });
    await wait(1000);

    const shotNavbarScroll = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-03-navbar-scroll-blur.png'), Buffer.from(shotNavbarScroll.data, 'base64'));
    console.log('Saved verify-03-navbar-scroll-blur.png');

    // 5. Scroll down to Hospital Results Cards
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, 750)`,
    });
    await wait(1000);

    const shotCards = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-04-facility-cards.png'), Buffer.from(shotCards.data, 'base64'));
    console.log('Saved verify-04-facility-cards.png');

    // 6. Click the second card (Al-Ameen Hospital) in the list to expand it and view details
    await send('Runtime.evaluate', {
      expression: `(() => {
        const cards = Array.from(document.querySelectorAll('div')).filter(el => 
          el.className && typeof el.className === 'string' && el.className.includes('p-4') && el.className.includes('rounded-2xl') && el.className.includes('border') && el.textContent.includes('Al-Ameen Hospital')
        );
        const target = cards[0];
        if (target) target.click();
      })()`,
    });
    await wait(2000);

    const shotExpanded = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-05-expanded-facility.png'), Buffer.from(shotExpanded.data, 'base64'));
    console.log('Saved verify-05-expanded-facility.png');

    ws.close();
  } finally {
    try {
      chromeProcess.kill();
    } catch (_) {}
  }
}

capture().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
