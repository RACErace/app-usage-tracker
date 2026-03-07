const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinary = require('electron');
const appRoot = path.resolve(__dirname, '..');
const forwardedArgs = process.argv.slice(2);

const child = spawn(electronBinary, [appRoot, ...forwardedArgs], {
  cwd: appRoot,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: process.env
});

child.unref();