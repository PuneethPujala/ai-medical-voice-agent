import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'assert';

// Mock Lucide icons
const mockIcon = (name: string) => (props: any) => React.createElement('svg', { 'data-icon': name, ...props });

// We can test the dropdown HTML generation and state logic across paths
const ROUTES = [
  { path: '/consult', label: 'Voice Consultation' },
  { path: '/profile', label: 'Patient Profile & History' },
  { path: '/dashboard', label: 'SOAP Charts & History' },
  { path: '/care', label: 'Hospital Routing' },
  { path: '/privacy', label: 'Privacy & Technical Safeguards' },
];

console.log('Testing Dropdown Parity across all clinical routes...');

// Read the files directly and verify identical structural classes
import fs from 'fs';
import path from 'path';

const basePath = 'c:/dev/Capstone-privacy';
const landingNav = fs.readFileSync(path.join(basePath, 'app/_components/LandingFloatingNavbar.tsx'), 'utf8');
const navbar = fs.readFileSync(path.join(basePath, 'app/_components/Navbar.tsx'), 'utf8');

// 1. Check trigger buttons have matching IDs and accessible attributes
assert(landingNav.includes('id="clinical-account-trigger"'), 'LandingFloatingNavbar must have clinical-account-trigger');
assert(navbar.includes('id="clinical-account-trigger"'), 'Navbar must have clinical-account-trigger');

// 2. Check dropdown menus have matching IDs
assert(landingNav.includes('id="clinical-account-menu"'), 'LandingFloatingNavbar must have clinical-account-menu');
assert(navbar.includes('id="clinical-account-menu"'), 'Navbar must have clinical-account-menu');

// 3. Check section headers match
assert(landingNav.includes('Clinical workspace'), 'LandingFloatingNavbar must have Clinical workspace header');
assert(navbar.includes('Clinical workspace'), 'Navbar must have Clinical workspace header');
assert(landingNav.includes('Care and security'), 'LandingFloatingNavbar must have Care and security header');
assert(navbar.includes('Care and security'), 'Navbar must have Care and security header');

// 4. Verify all 5 routes have dynamic active styling in both
for (const route of ROUTES) {
  const activeClassCheck = `pathname === "${route.path}"`;
  assert(landingNav.includes(activeClassCheck), `LandingFloatingNavbar must check ${activeClassCheck}`);
  assert(navbar.includes(activeClassCheck), `Navbar must check ${activeClassCheck}`);

  const activePillCheck = `pathname === "${route.path}"\n                              ? "bg-slate-950 text-white font-bold shadow-xs"\n                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-100"`;
  // Check for presence of active pill class pattern
  assert(
    landingNav.includes(`pathname === "${route.path}" ? "bg-slate-950 text-white font-bold shadow-xs"`) ||
    landingNav.includes(`pathname === "${route.path}"\n                              ? "bg-slate-950 text-white font-bold shadow-xs"`),
    `LandingFloatingNavbar missing active pill for ${route.path}`
  );

  // Check white dot indicator pattern
  const dotPattern = `{pathname === "${route.path}" && (\n                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />\n                          )}`;
  assert(
    landingNav.includes(dotPattern) ||
    landingNav.includes(`pathname === "${route.path}" && (\r\n                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />\r\n                          )`),
    `LandingFloatingNavbar missing active dot indicator for ${route.path}`
  );
}

// 5. Verify Sign Out button
assert(landingNav.includes('signOut({ redirectUrl: "/" })'), 'LandingFloatingNavbar must have Sign Out');
assert(navbar.includes('signOut({ redirectUrl: "/" })'), 'Navbar must have Sign Out');

console.log('✅ ALL DROPDOWN PARITY ASSERTIONS PASSED!');
