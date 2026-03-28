const CATEGORY_DEFINITIONS = Object.freeze([
  { id: 'work', label: '工作' },
  { id: 'entertainment', label: '娱乐' },
  { id: 'study', label: '学习' },
  { id: 'communication', label: '沟通' }
]);

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.replace(/\s+/g, ' ').trim() || fallback;
}

function createRuleId(prefix = 'rule') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCategoryId(value) {
  const normalized = sanitizeText(value).toLowerCase();
  return CATEGORY_DEFINITIONS.some((item) => item.id === normalized) ? normalized : '';
}

function getCategoryLabel(categoryId) {
  const normalized = normalizeCategoryId(categoryId);
  return CATEGORY_DEFINITIONS.find((item) => item.id === normalized)?.label || '';
}

function splitMatcherText(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitMatcherText(item));
  }

  const normalized = sanitizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[\n,，；;]+/)
    .map((item) => sanitizeText(item))
    .filter(Boolean);
}

function normalizeMatcherList(value) {
  const result = [];
  const seen = new Set();

  for (const item of splitMatcherText(value)) {
    const normalized = sanitizeText(item);
    const comparableKey = normalized.toLowerCase();
    if (!normalized || seen.has(comparableKey)) {
      continue;
    }

    seen.add(comparableKey);
    result.push(normalized);
  }

  return result;
}

function normalizeCustomServiceRule(rule) {
  return {
    id: sanitizeText(rule?.id) || createRuleId('service'),
    serviceName: sanitizeText(rule?.serviceName),
    appMatchers: normalizeMatcherList(rule?.appMatchers),
    domains: normalizeMatcherList(rule?.domains)
  };
}

function normalizeCategoryRule(rule) {
  return {
    id: sanitizeText(rule?.id) || createRuleId('category'),
    categoryId: normalizeCategoryId(rule?.categoryId),
    appMatchers: normalizeMatcherList(rule?.appMatchers),
    domains: normalizeMatcherList(rule?.domains)
  };
}

function normalizeRuleCollection(items, normalizeItem) {
  if (!Array.isArray(items)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();

  for (const item of items) {
    const normalized = normalizeItem(item);
    let nextId = normalized.id;

    while (seenIds.has(nextId)) {
      nextId = createRuleId(nextId.split('-')[0] || 'rule');
    }

    seenIds.add(nextId);
    result.push({
      ...normalized,
      id: nextId
    });
  }

  return result;
}

function normalizeCustomServiceRules(items) {
  return normalizeRuleCollection(items, normalizeCustomServiceRule);
}

function normalizeCategoryRules(items) {
  return normalizeRuleCollection(items, normalizeCategoryRule);
}

function cloneRule(rule) {
  return {
    ...rule,
    appMatchers: [...(Array.isArray(rule?.appMatchers) ? rule.appMatchers : [])],
    domains: [...(Array.isArray(rule?.domains) ? rule.domains : [])]
  };
}

function cloneRuleList(items) {
  return (Array.isArray(items) ? items : []).map((item) => cloneRule(item));
}

function getAvailableCategories() {
  return CATEGORY_DEFINITIONS.map((item) => ({ ...item }));
}

module.exports = {
  CATEGORY_DEFINITIONS,
  cloneRuleList,
  createRuleId,
  getAvailableCategories,
  getCategoryLabel,
  normalizeCategoryId,
  normalizeCategoryRule,
  normalizeCategoryRules,
  normalizeCustomServiceRule,
  normalizeCustomServiceRules,
  normalizeMatcherList,
  sanitizeText,
  splitMatcherText
};
