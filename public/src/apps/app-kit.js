(function () {
  'use strict';

  var BOOT = globalThis.CLOUDOS_BOOT || { app: 'unknown', instance: null, windowId: null };

  function bootConfig() {
    var live = globalThis.CLOUDOS_BOOT;
    return live && typeof live === 'object' ? live : BOOT;
  }

  function kernelRef() {
    try {
      if (globalThis.parent && globalThis.parent !== globalThis && globalThis.parent.subkernel) return globalThis.parent.subkernel;
    } catch (error) {
      /* cross-origin — not running under the shell */
    }
    return globalThis.subkernel || null;
  }

  function connect(appId, options) {
    var kernel = kernelRef();
    if (!kernel) {
      return Promise.reject(new Error('CloudOS kernel not found. Open this app from the CloudOS desktop.'));
    }
    var opts = options || {};
    var boot = bootConfig();
    var client = kernel.clientFor(appId || boot.app, {
      instance: opts.instance || boot.instance,
      windowId: opts.windowId || boot.windowId,
      attach: opts.attach !== false,
      boot: boot,
    });
    globalThis.cloudos = client;
    return Promise.resolve(client);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
    return (value / 1073741824).toFixed(2) + ' GB';
  }

  function relTime(at) {
    var value = Number(at) || 0;
    if (value < 1e12) value *= 1000;
    var delta = Date.now() - value;
    if (delta < 1500) return 'now';
    if (delta < 60000) return Math.floor(delta / 1000) + 's ago';
    if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago';
    if (delta < 86400000) return Math.floor(delta / 3600000) + 'h ago';
    return new Date(value).toLocaleDateString();
  }

  function clockTime(at) {
    return new Date(Number(at) || Date.now()).toLocaleTimeString();
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value == null || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(key, value);
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child == null) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function toast(message, kind) {
    var host = document.getElementById('toast-host');
    if (!host) {
      host = el('div', { id: 'toast-host', class: 'toast-host' });
      document.body.appendChild(host);
    }
    var item = el('div', { class: 'toast ' + (kind || ''), text: message });
    host.appendChild(item);
    setTimeout(function () {
      item.classList.add('out');
      setTimeout(function () {
        item.remove();
      }, 260);
    }, 2400);
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, ms || 120);
    };
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = el('input', { type: 'file', style: 'display:none' });
      if (accept) input.accept = accept;
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.remove();
        resolve(file || null);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  var BAR_GLYPH = { dark: '▪', xp: '▫' };

  function makeMenuBar(menus) {
    var bar = el('div', { class: 'menubar' });
    var openDropdown = null;
    function closeAll() {
      Array.prototype.forEach.call(bar.querySelectorAll('.menu-item.open'), function (item) {
        item.classList.remove('open');
      });
      openDropdown = null;
    }
    Object.keys(menus).forEach(function (label) {
      var item = el('div', { class: 'menu-item', text: label });
      var dropdown = el('div', { class: 'dropdown' });
      menus[label].forEach(function (entry) {
        if (entry.separator) {
          dropdown.appendChild(el('div', { class: 'dropdown-divider' }));
          return;
        }
        var row = el('div', { class: 'dropdown-item' }, [el('span', { text: entry.label })]);
        if (entry.accel) row.appendChild(el('span', { class: 'accel', text: entry.accel }));
        row.addEventListener('click', function (event) {
          event.stopPropagation();
          closeAll();
          entry.run();
        });
        dropdown.appendChild(row);
      });
      item.appendChild(dropdown);
      item.addEventListener('click', function (event) {
        event.stopPropagation();
        var wasOpen = item.classList.contains('open');
        closeAll();
        if (!wasOpen) {
          item.classList.add('open');
          openDropdown = item;
        }
      });
      item.addEventListener('mouseenter', function () {
        if (openDropdown && openDropdown !== item) {
          closeAll();
          item.classList.add('open');
          openDropdown = item;
        }
      });
      bar.appendChild(item);
    });
    document.addEventListener('click', closeAll);
    return { bar: bar, closeAll: closeAll };
  }

  function bindTheme(client) {
    function apply() {
      var theme = client.theme();
      document.body.classList.toggle('xp-mode', theme.mode === 'xp');
      document.documentElement.dataset.theme = theme.mode;
    }
    apply();
    return client.onTheme(apply);
  }

  function statusBar(client, initial) {
    var bar = el('div', { class: 'statusbar' });
    var left = el('span', { class: 'status-left', text: initial || '' });
    var right = el('span', { class: 'status-right' });
    bar.appendChild(left);
    bar.appendChild(right);
    return {
      bar: bar,
      set: function (text) {
        left.textContent = text || '';
      },
      right: function (text) {
        right.textContent = text || '';
      },
      flash: function (text) {
        left.textContent = text;
      },
    };
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  globalThis.CloudOS = {
    BOOT: BOOT,
    kernel: kernelRef,
    connect: connect,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    relTime: relTime,
    clockTime: clockTime,
    el: el,
    clear: clear,
    toast: toast,
    debounce: debounce,
    download: download,
    pickFile: pickFile,
    makeMenuBar: makeMenuBar,
    bindTheme: bindTheme,
    statusBar: statusBar,
    whenReady: whenReady,
  };
})();
