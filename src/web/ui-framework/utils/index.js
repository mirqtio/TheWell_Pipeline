/**
 * Utilities
 * Common utility functions for the UI framework
 */

// Class name utilities
export const cn = (...classes) => {
  return classes.filter(Boolean).join(' ');
};

// Format utilities
export const formatDate = (date, options = {}) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  };
  
  return d.toLocaleDateString(undefined, defaultOptions);
};

export const formatTime = (date, options = {}) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const defaultOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };
  
  return d.toLocaleTimeString(undefined, defaultOptions);
};

export const formatDateTime = (date, options = {}) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  return `${formatDate(d, options.date)} ${formatTime(d, options.time)}`;
};

export const formatNumber = (num, options = {}) => {
  const defaultOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  };
  
  return new Intl.NumberFormat(undefined, defaultOptions).format(num);
};

export const formatCurrency = (amount, currency = 'USD', options = {}) => {
  const defaultOptions = {
    style: 'currency',
    currency,
    ...options,
  };
  
  return new Intl.NumberFormat(undefined, defaultOptions).format(amount);
};

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// String utilities
export const truncate = (str, length = 50, suffix = '...') => {
  if (!str || str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
};

export const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const slugify = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Object utilities
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
};

export const deepMerge = (target, source) => {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
};

export const isObject = (item) => {
  return item && typeof item === 'object' && !Array.isArray(item);
};

export const isEmpty = (value) => {
  if (value == null) return true;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return false;
  if (value instanceof Date) return false;
  if (value instanceof Error) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

// Array utilities
export const uniqueBy = (array, key) => {
  const seen = new Set();
  return array.filter(item => {
    const val = key ? item[key] : item;
    if (seen.has(val)) {
      return false;
    }
    seen.add(val);
    return true;
  });
};

export const groupBy = (array, key) => {
  return array.reduce((result, item) => {
    const group = typeof key === 'function' ? key(item) : item[key];
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {});
};

export const sortBy = (array, key, order = 'asc') => {
  return [...array].sort((a, b) => {
    const aVal = typeof key === 'function' ? key(a) : a[key];
    const bVal = typeof key === 'function' ? key(b) : b[key];
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
};

// DOM utilities
export const scrollToTop = (smooth = true) => {
  window.scrollTo({
    top: 0,
    behavior: smooth ? 'smooth' : 'auto',
  });
};

export const scrollToElement = (element, offset = 0, smooth = true) => {
  const el = typeof element === 'string' ? document.querySelector(element) : element;
  if (!el) return;
  
  const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({
    top,
    behavior: smooth ? 'smooth' : 'auto',
  });
};

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch (err) {
      document.body.removeChild(textArea);
      return false;
    }
  }
};

// Validation utilities
export const isEmail = (email) => {
  const re = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  return re.test(email);
};

export const isURL = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const isPhone = (phone) => {
  const re = /^[\d\s\-\+\(\)]+$/;
  return re.test(phone);
};

// Async utilities
export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};

export const debounce = (fn, delay = 300) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

export const throttle = (fn, interval = 300) => {
  let lastTime = 0;
  let timeoutId;
  
  return (...args) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastTime;
    
    if (timeSinceLastCall >= interval) {
      fn(...args);
      lastTime = now;
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fn(...args);
        lastTime = Date.now();
      }, interval - timeSinceLastCall);
    }
  };
};