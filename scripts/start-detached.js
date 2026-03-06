const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinary = require('electron');
const appRoot = path.resolve(__dirname, '..');

const child = spawn(electronBinary, [appRoot], {
  cwd: appRoot,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: process.env
});

child.unref();