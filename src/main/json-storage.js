const fs = require('fs/promises');
const path = require('path');

function getBackupFilePath(filePath) {
  return `${filePath}.bak`;
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('') + `-${process.pid}`;
}

function getCorruptFilePath(filePath, date = new Date()) {
  return `${filePath}.corrupt-${formatTimestamp(date)}`;
}

function buildTempFilePath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function cleanupTempFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeFileAtomic(filePath, content, { keepBackup = true, encoding = 'utf8' } = {}) {
  const tempFilePath = buildTempFilePath(filePath);
  const backupFilePath = getBackupFilePath(filePath);
  let backupError = null;

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(tempFilePath, content, encoding);
    await fs.rename(tempFilePath, filePath);

    if (keepBackup) {
      try {
        await fs.copyFile(filePath, backupFilePath);
      } catch (error) {
        backupError = error;
      }
    }
  } finally {
    await cleanupTempFile(tempFilePath).catch(() => {});
  }

  return {
    filePath,
    backupFilePath,
    backupSynchronized: keepBackup ? !backupError : false,
    backupError
  };
}

async function writeJsonFileAtomic(filePath, value, options = {}) {
  return writeFileAtomic(filePath, JSON.stringify(value, null, 2), options);
}

async function quarantineFile(filePath) {
  if (!(await pathExists(filePath))) {
    return '';
  }

  const corruptFilePath = getCorruptFilePath(filePath);
  try {
    await fs.rename(filePath, corruptFilePath);
    return corruptFilePath;
  } catch {
    try {
      await fs.copyFile(filePath, corruptFilePath);
      await fs.unlink(filePath).catch(() => {});
      return corruptFilePath;
    } catch {
      return '';
    }
  }
}

async function readValidatedJsonFile(filePath, validate) {
  const rawContent = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(rawContent);

  if (typeof validate === 'function' && !validate(parsed)) {
    const error = new Error(`Invalid JSON structure in ${filePath}`);
    error.code = 'EINVALIDJSON';
    throw error;
  }

  return parsed;
}

function resolveDefaultValue(defaultValue) {
  return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
}

async function loadJsonFileWithRecovery(filePath, { validate, defaultValue } = {}) {
  const backupFilePath = getBackupFilePath(filePath);
  let primaryError = null;

  try {
    const value = await readValidatedJsonFile(filePath, validate);
    return {
      value,
      source: 'primary',
      recoveredFromBackup: false,
      restoredPrimary: false,
      corruptedPrimaryPath: '',
      primaryError: null,
      backupError: null,
      restoreError: null
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    const value = await readValidatedJsonFile(backupFilePath, validate);
    const corruptedPrimaryPath = await quarantineFile(filePath);
    let restoreError = null;
    let restoredPrimary = false;

    try {
      await writeJsonFileAtomic(filePath, value, { keepBackup: false });
      restoredPrimary = true;
    } catch (error) {
      restoreError = error;
    }

    return {
      value,
      source: 'backup',
      recoveredFromBackup: true,
      restoredPrimary,
      corruptedPrimaryPath,
      primaryError,
      backupError: null,
      restoreError
    };
  } catch (backupError) {
    return {
      value: resolveDefaultValue(defaultValue),
      source: 'default',
      recoveredFromBackup: false,
      restoredPrimary: false,
      corruptedPrimaryPath: await quarantineFile(filePath),
      primaryError,
      backupError,
      restoreError: null
    };
  }
}

module.exports = {
  getBackupFilePath,
  loadJsonFileWithRecovery,
  writeFileAtomic,
  writeJsonFileAtomic
};
