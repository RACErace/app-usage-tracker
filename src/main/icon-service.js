const fs = require('fs/promises');
const path = require('path');
const { app, nativeImage } = require('electron');

const ICON_FETCH_TIMEOUT_MS = 6000;
const NULL_CACHE_TTL_MS = 5 * 60 * 1000;
const PREFERRED_ICON_SIZE = 64;

function sanitizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function toDataUrl(image) {
  if (!image || image.isEmpty()) {
    return null;
  }

  return image.resize({ width: 64, height: 64 }).toDataURL();
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function fileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlAttribute(value) {
  return sanitizeText(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractHtmlAttribute(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  if (!match) {
    return '';
  }

  return decodeHtmlAttribute(match[1] || match[2] || match[3] || '');
}

function getIconLinkScore(relValue) {
  const rel = sanitizeText(relValue).toLowerCase();
  if (!rel) {
    return -1;
  }

  if (rel.includes('apple-touch-icon')) {
    return 5;
  }

  if (rel.includes('shortcut icon')) {
    return 4;
  }

  if (rel.split(/\s+/).includes('icon')) {
    return 3;
  }

  if (rel.includes('mask-icon')) {
    return 2;
  }

  return -1;
}

function isSvgIconHref(href) {
  return /\.svg(?:$|[?#])/i.test(sanitizeText(href));
}

function parseIconSizes(sizesValue) {
  const rawValue = sanitizeText(sizesValue).toLowerCase();
  if (!rawValue) {
    return [];
  }

  if (rawValue.includes('any')) {
    return ['any'];
  }

  const parsedSizes = [];
  for (const part of rawValue.split(/\s+/)) {
    const match = part.match(/^(\d+)x(\d+)$/);
    if (!match) {
      continue;
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) {
      continue;
    }

    parsedSizes.push(Math.min(width, height));
  }

  return parsedSizes;
}

function getSizeFitness(size) {
  if (size === 'any') {
    return { tier: 4, distance: 0, sizeValue: PREFERRED_ICON_SIZE };
  }

  const numericSize = Number(size) || 0;
  if (!numericSize) {
    return { tier: 0, distance: Number.MAX_SAFE_INTEGER, sizeValue: 0 };
  }

  if (numericSize === PREFERRED_ICON_SIZE) {
    return { tier: 3, distance: 0, sizeValue: numericSize };
  }

  if (numericSize > PREFERRED_ICON_SIZE) {
    return { tier: 2, distance: numericSize - PREFERRED_ICON_SIZE, sizeValue: numericSize };
  }

  return { tier: 1, distance: PREFERRED_ICON_SIZE - numericSize, sizeValue: numericSize };
}

function getBestIconSizeMetrics(sizesValue, href) {
  if (isSvgIconHref(href)) {
    return { tier: 4, distance: 0, sizeValue: PREFERRED_ICON_SIZE };
  }

  const sizes = parseIconSizes(sizesValue);
  if (!sizes.length) {
    return { tier: 0, distance: Number.MAX_SAFE_INTEGER, sizeValue: 0 };
  }

  return sizes
    .map((size) => getSizeFitness(size))
    .sort((left, right) => {
      if (left.tier !== right.tier) {
        return right.tier - left.tier;
      }

      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return right.sizeValue - left.sizeValue;
    })[0];
}

function resolveHtmlIconCandidates(html, pageUrl) {
  const sourceHtml = sanitizeText(html);
  if (!sourceHtml) {
    return [];
  }

  let baseUrl;
  try {
    baseUrl = new URL(pageUrl);
  } catch {
    return [];
  }

  const linkTags = sourceHtml.match(/<link\b[^>]*>/gi) || [];
  const iconLinks = linkTags
    .map((tag) => {
      const rel = extractHtmlAttribute(tag, 'rel');
      const href = extractHtmlAttribute(tag, 'href');
      const sizes = extractHtmlAttribute(tag, 'sizes');
      return {
        relScore: getIconLinkScore(rel),
        sizeMetrics: getBestIconSizeMetrics(sizes, href),
        href
      };
    })
    .filter((item) => item.relScore >= 0 && item.href);

  const sortedLinks = iconLinks.sort((left, right) => {
    if (left.sizeMetrics.tier !== right.sizeMetrics.tier) {
      return right.sizeMetrics.tier - left.sizeMetrics.tier;
    }

    if (left.sizeMetrics.distance !== right.sizeMetrics.distance) {
      return left.sizeMetrics.distance - right.sizeMetrics.distance;
    }

    if (left.relScore !== right.relScore) {
      return right.relScore - left.relScore;
    }

    return right.sizeMetrics.sizeValue - left.sizeMetrics.sizeValue;
  });
  const resolved = [];

  for (const item of sortedLinks) {
    try {
      resolved.push(new URL(item.href, baseUrl).toString());
    } catch {
      // ignore malformed href
    }
  }

  return [...new Set(resolved)];
}

class UsageIconService {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
    this.missCache = new Map();
    this.cacheDir = path.join(app.getPath('userData'), 'icon-cache');
    this.indexFilePath = path.join(this.cacheDir, 'index.json');
    this.diskIndex = {};
    this.initialized = false;
    this.initializing = null;
  }

  async resolveItems(items) {
    const entries = await Promise.all(
      (Array.isArray(items) ? items : []).map(async (item) => [item.key, await this.resolveItemIcon(item)])
    );

    return Object.fromEntries(entries.filter(([key]) => key));
  }

  async resolveItemIcon(item) {
    if (!item || !item.key) {
      return null;
    }

    return this.getCached(`item:${item.key}`, async () => {
      const isWebsiteItem = item.kind === 'site' || item.kind === 'page';
      if (isWebsiteItem) {
        return this.resolveWebsiteIcon(item);
      }

      if (item.host || item.url) {
        const websiteIcon = await this.resolveWebsiteIcon(item);
        if (websiteIcon) {
          return websiteIcon;
        }
      }

      if (item.executablePath) {
        const appIcon = await this.resolveExecutableIcon(item.executablePath);
        if (appIcon) {
          return appIcon;
        }
      }

      return null;
    });
  }

  async resolveExecutableIcon(executablePath) {
    if (!executablePath) {
      return null;
    }

    return this.getCached(`exe:${executablePath}`, async () => {
      if (!(await fileExists(executablePath))) {
        return null;
      }

      try {
        const icon = await app.getFileIcon(executablePath, { size: 'normal' });
        return toDataUrl(icon);
      } catch {
        return null;
      }
    });
  }

  async resolveWebsiteIcon(item) {
    const candidates = await this.getWebsiteCandidates(item);
    for (const candidate of candidates) {
      const icon = await this.getCached(`url:${candidate}`, () => this.fetchImageDataUrl(candidate));
      if (icon) {
        return icon;
      }
    }

    return null;
  }

  async getWebsiteCandidates(item) {
    const htmlCandidates = [];
    const directCandidates = [];
    const fallbackCandidates = [];

    if (item.url) {
      try {
        const url = new URL(item.url);
        htmlCandidates.push(...(await this.getHtmlIconCandidates(url.toString())));
        htmlCandidates.push(...(await this.getHtmlIconCandidates(url.origin)));
        directCandidates.push(new URL('/favicon.ico', url.origin).toString());
        fallbackCandidates.push(`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url.origin)}`);
      } catch {
        // ignore
      }
    }

    if (item.host) {
      const normalizedHost = sanitizeText(item.host);
      if (normalizedHost) {
        htmlCandidates.push(...(await this.getHtmlIconCandidates(`https://${normalizedHost}/`)));
        directCandidates.push(`https://${normalizedHost}/favicon.ico`);
        fallbackCandidates.push(`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(normalizedHost)}`);
      }
    }

    return [...new Set([...htmlCandidates, ...directCandidates, ...fallbackCandidates])];
  }

  async getHtmlIconCandidates(pageUrl) {
    if (!pageUrl) {
      return [];
    }

    const html = await this.getCached(`html:${pageUrl}`, () => this.fetchHtml(pageUrl));
    if (!html) {
      return [];
    }

    return resolveHtmlIconCandidates(html, pageUrl);
  }

  async fetchImageDataUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

    try {
      let referer = '';
      let origin = '';
      try {
        const targetUrl = new URL(url);
        origin = targetUrl.origin;
        referer = `${targetUrl.origin}/`;
      } catch {
        // ignore
      }

      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...(origin ? { Origin: origin } : {}),
          ...(referer ? { Referer: referer } : {})
        }
      });

      if (!response.ok) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        return `data:${contentType};base64,${buffer.toString('base64')}`;
      }

      const image = nativeImage.createFromBuffer(buffer);
      return toDataUrl(image);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchHtml(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

    try {
      let referer = '';
      let origin = '';
      try {
        const targetUrl = new URL(url);
        origin = targetUrl.origin;
        referer = `${targetUrl.origin}/`;
      } catch {
        // ignore
      }

      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          ...(origin ? { Origin: origin } : {}),
          ...(referer ? { Referer: referer } : {})
        }
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        return null;
      }

      const html = await response.text();
      return sanitizeText(html) || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getCached(cacheKey, producer) {
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const missExpiresAt = this.missCache.get(cacheKey);
    if (missExpiresAt && missExpiresAt > Date.now()) {
      return null;
    }

    if (missExpiresAt) {
      this.missCache.delete(cacheKey);
    }

    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey);
    }

    const promise = this.readDiskCache(cacheKey)
      .then((cachedValue) => {
        if (cachedValue !== undefined) {
          this.cache.set(cacheKey, cachedValue);
          this.pending.delete(cacheKey);
          return cachedValue;
        }

        return Promise.resolve(producer())
          .then(async (result) => {
            this.pending.delete(cacheKey);
            if (result) {
              this.cache.set(cacheKey, result);
              this.missCache.delete(cacheKey);
              await this.writeDiskCache(cacheKey, result);
              return result;
            }

            this.missCache.set(cacheKey, Date.now() + NULL_CACHE_TTL_MS);
            return null;
          });
      })
      .catch(() => {
        this.pending.delete(cacheKey);
        this.missCache.set(cacheKey, Date.now() + NULL_CACHE_TTL_MS);
        return null;
      });

    this.pending.set(cacheKey, promise);
    return promise;
  }

  async ensureInitialized() {
    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = (async () => {
      await fs.mkdir(this.cacheDir, { recursive: true });
      try {
        const raw = await fs.readFile(this.indexFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.diskIndex = parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        this.diskIndex = {};
      }

      this.initialized = true;
      this.initializing = null;
    })();

    await this.initializing;
  }

  async readDiskCache(cacheKey) {
    await this.ensureInitialized();
    const fileName = this.diskIndex[cacheKey];
    if (!fileName) {
      return undefined;
    }

    const filePath = path.join(this.cacheDir, fileName);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      delete this.diskIndex[cacheKey];
      await this.saveIndex();
      return undefined;
    }
  }

  async writeDiskCache(cacheKey, dataUrl) {
    await this.ensureInitialized();
    const fileName = `${hashString(cacheKey)}.txt`;
    const filePath = path.join(this.cacheDir, fileName);
    await fs.writeFile(filePath, dataUrl, 'utf8');
    this.diskIndex[cacheKey] = fileName;
    await this.saveIndex();
  }

  async saveIndex() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.indexFilePath, JSON.stringify(this.diskIndex, null, 2), 'utf8');
  }
}

module.exports = {
  UsageIconService
};