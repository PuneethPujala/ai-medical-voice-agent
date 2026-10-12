import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9465) {
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
      '--remote-debugging-port=9465',
      '--remote-allow-origins=*',
      '--user-data-dir=c:\\dev\\Capstone\\.tmp_chrome_verify_care_animated_list',
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
    const wsUrl = await getWsUrl(9465);
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

    // Evaluate DOM structure, AnimatedList presence, and Rationale
    const domAudit = await send('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText;
        const hasHashHospital = text.includes('#hospital');
        const hasDummyPhone = text.includes('8000 000 000') || text.includes('0000000000');
        
        // Find AnimatedList container
        const animatedListEl = document.querySelector('[data-animated]') || document.querySelector('[role="listbox"]');
        const items = document.querySelectorAll('[role="option"]');
        
        // Find Recommendation Rationale toggle
        const rationaleBtn = Array.from(document.querySelectorAll('button')).find(b => 
          b.textContent && (b.textContent.includes('Recommendation Rationale') || b.textContent.includes('Suitability Rationale'))
        );
        
        // Check for duplicate second list
        const pagination = Array.from(document.querySelectorAll('div, span')).some(e => e.textContent && e.textContent.includes('Showing 1–10 of'));
        
        return {
          hasHashHospital,
          hasDummyPhone,
          hasAnimatedList: !!animatedListEl,
          animatedItemsCount: items.length,
          hasRationaleBtn: !!rationaleBtn,
          rationaleBtnText: rationaleBtn ? rationaleBtn.textContent.trim() : null,
          hasDuplicateList: pagination
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

    // 1. Desktop Screenshot: Initial State with AnimatedList (Collapsed rationale)
    console.log('Capturing Desktop Map & AnimatedList (Collapsed)...');
    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    const file1 = path.join(artifactDir, 'verify-care-animated-list-clean.png');
    fs.writeFileSync(file1, Buffer.from(shot1.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-animated-list-clean.png'), Buffer.from(shot1.data, 'base64'));
    console.log('Saved:', file1);

    // 2. Click "Recommendation Rationale" toggle to expand clinical factors
    console.log('Expanding Recommendation Rationale factors...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const rationaleBtn = Array.from(document.querySelectorAll('button')).find(b => 
          b.textContent && (b.textContent.includes('Recommendation Rationale') || b.textContent.includes('Suitability Rationale'))
        );
        if (rationaleBtn) rationaleBtn.click();
      })()`,
    });
    await wait(1500);

    // 3. Desktop Screenshot: Expanded State (Showing structured 4 clinical factor tiles)
    console.log('Capturing Desktop Expanded Clinical Factors State...');
    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    const file2 = path.join(artifactDir, 'verify-care-clinical-factors-expanded.png');
    fs.writeFileSync(file2, Buffer.from(shot2.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-clinical-factors-expanded.png'), Buffer.from(shot2.data, 'base64'));
    console.log('Saved:', file2);

    // 4. Click #2 hospital in AnimatedList to test interaction & spring selection
    console.log('Selecting #2 hospital in AnimatedList...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const options = document.querySelectorAll('[role="option"]');
        if (options.length > 1) {
          options[1].click();
        }
      })()`,
    });
    await wait(2500);

    console.log('Capturing Desktop Selected #2 Hospital State...');
    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    const file3 = path.join(artifactDir, 'verify-care-animated-list-second-selected.png');
    fs.writeFileSync(file3, Buffer.from(shot3.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-animated-list-second-selected.png'), Buffer.from(shot3.data, 'base64'));
    console.log('Saved:', file3);

    // 5. Switch to Mobile Viewport (375x812)
    console.log('Switching to mobile viewport (375x812)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await send('Runtime.evaluate', {
      expression: `(() => {
        window.scrollTo(0, 480);
      })()`,
    });
    await wait(2000);

    console.log('Capturing Mobile Stacked View...');
    const shot4 = await send('Page.captureScreenshot', { format: 'png' });
    const file4 = path.join(artifactDir, 'verify-care-mobile-animated-list.png');
    fs.writeFileSync(file4, Buffer.from(shot4.data, 'base64'));
    fs.writeFileSync(path.join('c:\\dev\\Capstone', 'verify-care-mobile-animated-list.png'), Buffer.from(shot4.data, 'base64'));
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
