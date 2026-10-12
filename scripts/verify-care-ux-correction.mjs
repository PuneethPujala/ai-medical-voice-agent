import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9460) {
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
  const artifactDir = 'C:\\Users\\punee\\.gemini\\antigravity\\brain\\ba99a139-e87c-4677-87bb-6b62275bfe6b';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9460',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_care_ux',
      '--disable-gpu',
      '--window-size=1440,960',
      '--no-sandbox',
      'about:blank',
    ],
    { detached: false }
  );

  chromeProcess.on('exit', (c, s) => console.log('Chrome exited with code:', c, s));
  chromeProcess.stderr.on('data', (d) => console.log('Chrome stderr:', d.toString()));

  try {
    const wsUrl = await getWsUrl(9460);
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

    console.log('Navigating to http://localhost:3000/care...');
    await send('Page.navigate', { url: 'http://localhost:3000/care' });
    await wait(4000);

    // Open city selector and select Guntur (to verify user's exact case)
    console.log('Selecting Guntur region...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose a city or region'));
        if (btn) btn.click();
      })()`,
    });
    await wait(1000);

    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Guntur');
        if (btn) btn.click();
      })()`,
    });
    await wait(5000);

    // Evaluate DOM structure and data quality
    const domAudit = await send('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        const hasHashHospital = text.includes('#hospital');
        const hasGenericHospitalOnly = text.includes('Hospital') && !text.includes('General Hospital') && !text.includes('Care Hospital'); // check raw standalone
        const hasDummyPhone = text.includes('8000 000 000') || text.includes('0000000000');
        
        // Find legend
        const legendItems = Array.from(document.querySelectorAll('span, div')).map(e => e.textContent.trim());
        const hasDrivingRouteCar = legendItems.some(t => t.includes('Driving route · Car'));
        
        // Find why ranked #1 toggle
        const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Why ranked #1?'));
        
        // Facility cards count
        const cards = document.querySelectorAll('button[class*="group relative"]');
        
        return {
          hasHashHospital,
          hasDummyPhone,
          hasDrivingRouteCar,
          hasToggleBtn: !!toggleBtn,
          toggleBtnText: toggleBtn ? toggleBtn.textContent.trim() : null,
          facilityCardsCount: cards.length
        };
      })()`,
      returnByValue: true
    });
    console.log('DOM Audit Results:', domAudit.result.value);

    // Scroll to position map and facility list in view
    await send('Runtime.evaluate', {
      expression: `(() => {
        const mapCard = document.querySelector('.leaflet-container');
        if (mapCard) {
          const rect = mapCard.getBoundingClientRect();
          window.scrollTo(0, window.scrollY + rect.top - 80);
        }
      })()`,
    });
    await wait(1500);

    // 1. Desktop Screenshot: Initial State (Collapsed rationale, selected card below map, legend clear)
    console.log('Capturing Desktop Map & Facilities (Collapsed)...');
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    const file1 = path.join(artifactDir, 'verify-care-map-and-details-clean.png');
    fs.writeFileSync(file1, Buffer.from(shot1.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-map-and-details-clean.png'), Buffer.from(shot1.data, 'base64'));
    console.log('Saved:', file1);

    // 2. Click "Why ranked #1?" toggle to expand rationale
    console.log('Expanding Why ranked #1? rationale...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Why ranked #1?'));
        if (toggleBtn) toggleBtn.click();
      })()`,
    });
    await wait(1500);

    // 3. Desktop Screenshot: Expanded State
    console.log('Capturing Desktop Expanded Rationale State...');
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    const file2 = path.join(artifactDir, 'verify-care-rationale-expanded.png');
    fs.writeFileSync(file2, Buffer.from(shot2.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-rationale-expanded.png'), Buffer.from(shot2.data, 'base64'));
    console.log('Saved:', file2);

    // 4. Switch to Mobile Viewport (375x812)
    console.log('Switching to mobile viewport (375x812)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await send('Runtime.evaluate', {
      expression: `(() => {
        const mapCard = document.querySelector('.leaflet-container');
        if (mapCard) {
          mapCard.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      })()`,
    });
    await wait(2000);

    // 5. Mobile Screenshot: Map + Selected Card Stacking
    console.log('Capturing Mobile Map & Stacked Card...');
    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    const file3 = path.join(artifactDir, 'verify-care-mobile-stacked.png');
    fs.writeFileSync(file3, Buffer.from(shot3.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-mobile-stacked.png'), Buffer.from(shot3.data, 'base64'));
    console.log('Saved:', file3);

    // Scroll down to facilities list on mobile
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.scrollBy(0, 520);
      })()`,
    });
    await wait(1500);

    console.log('Capturing Mobile Facilities List...');
    const shot4 = await send('Page.captureScreenshot', { format: 'png' });
    const file4 = path.join(artifactDir, 'verify-care-mobile-facilities.png');
    fs.writeFileSync(file4, Buffer.from(shot4.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-mobile-facilities.png'), Buffer.from(shot4.data, 'base64'));
    console.log('Saved:', file4);

    ws.close();
    chromeProcess.kill();
    console.log('All verification captures completed successfully!');
  } catch (err) {
    console.error('Error during verification:', err);
    chromeProcess.kill();
    process.exit(1);
  }
}

run();
