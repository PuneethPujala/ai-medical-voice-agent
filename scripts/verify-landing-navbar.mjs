import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWsUrl(port = 9448) {
  for (let i = 0; i < 40; i++) {
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

const ARTIFACT_DIR = 'C:\\Users\\punee\\.gemini\\antigravity\\brain\\e4bcd54c-f150-4834-80a3-214c3da9ac27';

async function captureViewport(send, width, height, filename) {
  console.log(`Capturing viewport: ${width}x${height} -> ${filename}`);
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 768,
  });
  await wait(600);

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });

  const buffer = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(filename, buffer);
  try {
    const artifactPath = path.join(ARTIFACT_DIR, path.basename(filename));
    fs.writeFileSync(artifactPath, buffer);
  } catch (e) {
    console.warn(`Could not copy to artifact dir: ${e.message}`);
  }
  console.log(`Saved screenshot: ${filename}`);
}

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tmpProfile = path.join(os.tmpdir(), 'chrome_navbar_test_' + Date.now());

  const chromeProcess = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9448',
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${tmpProfile}`,
      '--disable-gpu',
      '--window-size=1440,950',
      '--no-sandbox',
      'http://127.0.0.1:3005',
    ],
    { detached: false }
  );

  try {
    const wsUrl = await getWsUrl(9448);
    const WebSocket = globalThis.WebSocket;
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      if (ws.readyState === 1) return resolve();
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let id = 1;
    const pending = new Map();
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const reqId = id++;
        pending.set(reqId, (msg) => {
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        });
        ws.send(JSON.stringify({ id: reqId, method, params }));
      });
    }

    const consoleErrors = [];
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb(msg);
      } else if (msg.method === 'Console.messageAdded' && msg.params.message.level === 'error') {
        consoleErrors.push(msg.params.message);
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');

    console.log('Navigating to http://127.0.0.1:3005...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3005' });
    await wait(3000);

    // 1. Desktop Navbar Evaluation
    console.log('\n--- 1. Evaluating Desktop Navbar (1440px) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 950,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await wait(500);

    const desktopNavEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const header = document.querySelector('header');
        if (!header) return { error: 'No header element found' };

        const pillContainer = header.querySelector('.rounded-full.bg-white\\/95') || header.querySelector('.rounded-full');
        const brandText = header.querySelector('a[href="/"]')?.innerText.replace(/\\s+/g, ' ').trim();
        const navLinks = Array.from(header.querySelectorAll('nav[aria-label="Primary Navigation"] a')).map(a => ({
          href: a.getAttribute('href'),
          text: a.innerText.replace(/\\s+/g, ' ').trim(),
          classes: a.className
        }));
        
        const homeLink = navLinks.find(l => l.href === '/');
        const isHomeActive = homeLink?.classes.includes('bg-slate-950') && homeLink?.classes.includes('text-white');

        const profileBtn = header.querySelector('#clinical-profile-trigger');
        const profileText = profileBtn ? profileBtn.innerText.replace(/\\s+/g, ' ').trim() : null;
        const rect = pillContainer ? pillContainer.getBoundingClientRect() : header.getBoundingClientRect();

        return {
          headerFound: true,
          pillFound: !!pillContainer,
          brandText,
          navLinks,
          isHomeActive,
          profileText,
          pillRect: { top: rect.top, height: rect.height, width: rect.width },
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        };
      })()`,
      returnByValue: true,
    });

    console.log('Desktop Navbar Data:', JSON.stringify(desktopNavEval.result.value, null, 2));
    await captureViewport(send, 1440, 950, 'landing-navbar-desktop-1440.png');

    // 1b. Test Profile Dropdown Click
    console.log('\n--- 1b. Testing Desktop Profile Dropdown Toggle ---');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const profileBtn = document.querySelector('#clinical-profile-trigger');
        if (profileBtn) profileBtn.click();
      })()`,
    });
    await wait(500);

    const profileDropdownEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const menu = document.querySelector('#clinical-profile-menu');
        return {
          dropdownOpen: !!menu,
          menuText: menu ? menu.innerText.replace(/\\s+/g, ' ').trim().slice(0, 100) : null
        };
      })()`,
      returnByValue: true,
    });
    console.log('Profile Dropdown Data:', JSON.stringify(profileDropdownEval.result.value, null, 2));
    await captureViewport(send, 1440, 950, 'landing-navbar-profile-dropdown.png');

    // Close profile dropdown
    await send('Runtime.evaluate', {
      expression: `(() => {
        const profileBtn = document.querySelector('#clinical-profile-trigger');
        if (profileBtn) profileBtn.click();
      })()`,
    });
    await wait(300);

    // 1c. Footer Wordmark Spacing Verification
    console.log('\n--- 1c. Evaluating Footer Wordmark Spacing (1440px) ---');
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, document.body.scrollHeight);`,
    });
    await wait(1000);

    const footerSpacingEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const legalRow = document.querySelector('#footer-nav-legal');
        const wordmarkStage = document.querySelector('#monumental-wordmark-stage');
        const wordmarkText = document.querySelector('#monumental-wordmark-text');
        
        const legalRect = legalRow ? legalRow.getBoundingClientRect() : null;
        const stageRect = wordmarkStage ? wordmarkStage.getBoundingClientRect() : null;
        const textRect = wordmarkText ? wordmarkText.getBoundingClientRect() : null;

        const gapFromLegalToText = (textRect && legalRect) ? Math.round(textRect.top - legalRect.bottom) : null;

        return {
          stageHeight: stageRect ? Math.round(stageRect.height) : null,
          textHeight: textRect ? Math.round(textRect.height) : null,
          gapFromLegalToText,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        };
      })()`,
      returnByValue: true,
    });
    console.log('Footer Wordmark Spacing Data:', JSON.stringify(footerSpacingEval.result.value, null, 2));
    await captureViewport(send, 1440, 950, 'footer-wordmark-tightened.png');

    // Scroll back to top before mobile navbar evaluation
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, 0);`,
    });
    await wait(500);

    // 2. Mobile Navbar Evaluation
    console.log('\n--- 2. Evaluating Mobile Navbar (375px) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(600);

    const mobileNavEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const header = document.querySelector('header');
        const menuBtn = header?.querySelector('button[aria-label="Toggle navigation menu"]');
        const consultBtn = header?.querySelector('a[href="/consult"]');
        return {
          headerFound: !!header,
          hasMenuButton: !!menuBtn,
          consultBtnText: consultBtn ? consultBtn.innerText.replace(/\\s+/g, ' ').trim() : null,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        };
      })()`,
      returnByValue: true,
    });

    console.log('Mobile Navbar Data:', JSON.stringify(mobileNavEval.result.value, null, 2));
    await captureViewport(send, 375, 812, 'landing-navbar-mobile-375.png');

    // 3. Test Mobile Drawer Opening
    console.log('\n--- 3. Testing Mobile Drawer Toggle ---');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const menuBtn = document.querySelector('header button[aria-label="Toggle navigation menu"]');
        if (menuBtn) menuBtn.click();
      })()`,
    });
    await wait(600);

    const drawerEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const drawer = document.querySelector('.fixed.inset-0');
        const drawerLinks = drawer ? Array.from(drawer.querySelectorAll('nav a')).map(a => a.innerText.replace(/\\s+/g, ' ').trim()) : [];
        return {
          drawerOpen: !!drawer,
          drawerLinks
        };
      })()`,
      returnByValue: true,
    });
    console.log('Mobile Drawer Data:', JSON.stringify(drawerEval.result.value, null, 2));
    await captureViewport(send, 375, 812, 'landing-navbar-mobile-drawer.png');

    // Close drawer
    await send('Runtime.evaluate', {
      expression: `(() => {
        const menuBtn = document.querySelector('header button[aria-label="Toggle navigation menu"]');
        if (menuBtn) menuBtn.click();
      })()`,
    });
    await wait(400);

    // 4. Verify functional pages remain untouched
    console.log('\n--- 4. Checking /consult and /care pages ---');
    await send('Page.navigate', { url: 'http://127.0.0.1:3005/consult' });
    await wait(2500);
    const consultEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const nav = document.querySelector('header') || document.querySelector('nav');
        return {
          pathname: window.location.pathname,
          navFound: !!nav,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        };
      })()`,
      returnByValue: true,
    });
    console.log('/consult Page Data:', JSON.stringify(consultEval.result.value, null, 2));
    await captureViewport(send, 1440, 950, 'functional-consult-page-verification.png');

    await send('Page.navigate', { url: 'http://127.0.0.1:3005/care' });
    await wait(2500);
    const careEval = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          pathname: window.location.pathname,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        };
      })()`,
      returnByValue: true,
    });
    console.log('/care Page Data:', JSON.stringify(careEval.result.value, null, 2));
    await captureViewport(send, 1440, 950, 'functional-care-page-verification.png');

    console.log(`\nFinal Console Error Count: ${consoleErrors.length}`);

    ws.close();
    chromeProcess.kill();
    await wait(400);
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch (_) {}

    console.log('\nNavbar verification complete.');
  } catch (err) {
    console.error('Navbar verification failed:', err);
    chromeProcess.kill();
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch (_) {}
    process.exit(1);
  }
}

main();
