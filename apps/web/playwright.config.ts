import { defineConfig, devices } from '@playwright/test';

const target=process.env.NEXUS_E2E_URL || 'http://127.0.0.1:3000';
export default defineConfig({
  testDir:'../../tests/e2e',
  testMatch:process.env.NEXUS_LIVE_E2E==='1'?'live.spec.ts':'preview.spec.ts',
  workers:1,
  timeout:45000,
  expect:{timeout:12000},
  use:{baseURL:target,trace:'retain-on-failure',...(process.env.NEXUS_BROWSER_CHANNEL ? {channel:process.env.NEXUS_BROWSER_CHANNEL} : {})},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:process.env.NEXUS_E2E_URL?undefined:{
    command:'npm run dev -- --hostname 127.0.0.1 --port 3000',
    env:{NEXUS_DEMO:'1',NEXT_TELEMETRY_DISABLED:'1'},
    url:target,
    timeout:60000,
    reuseExistingServer:!process.env.CI,
  },
});
