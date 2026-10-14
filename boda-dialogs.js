/* =====================================================
   BodA — نظام الرسائل المخصص
   الدوال المتاحة (global):
     bodaToast(opts | text)      إشعار صغير غير حاجب
     bodaNotify(text, opts?)     بديل alert(): يختار Toast أو Modal حسب طول الرسالة ونوعها
     bodaAlert(opts)             نافذة معلومات بزرار واحد  -> Promise<true>
     bodaConfirm(opts)           نافذة تأكيد               -> Promise<boolean>
     bodaPrompt(opts)            نافذة إدخال               -> Promise<string|number|null>
     bodaAchievement(opts)       نافذة إنجاز               -> Promise<true>
   كل النصوص بتتعرض بـ textContent (مفيش innerHTML) فمفيش خطر XSS.
   ===================================================== */
(function () {
  'use strict';
  if (window.Boda) return;

  var SCRIPT_SRC = document.currentScript && document.currentScript.src;
  function asset(p) { try { return SCRIPT_SRC ? new URL(p, SCRIPT_SRC).href : p; } catch (e) { return p; } }
  var HEAD_ICON = asset('assets/icons/boda-b.png');

  var TYPES = {
    success:     { icon: 'fa-circle-check',         label: 'تم بنجاح' },
    error:       { icon: 'fa-circle-xmark',         label: 'حصلت مشكلة' },
    warning:     { icon: 'fa-triangle-exclamation', label: 'تنبيه' },
    info:        { icon: 'fa-circle-info',          label: 'معلومة' },
    question:    { icon: 'fa-circle-question',      label: 'تأكيد' },
    danger:      { icon: 'fa-triangle-exclamation', label: 'هل أنت متأكد؟' },
    workout:     { icon: 'fa-dumbbell',             label: 'تأكيد التمرين' },
    weight:      { icon: 'fa-weight-scale',         label: 'تحديث الوزن' },
    achievement: { icon: 'fa-trophy',               label: 'إنجاز جديد' }
  };

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === false || v == null) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function icon(name) { return h('i', { class: 'fa-solid ' + name, 'aria-hidden': 'true' }); }
  var uid = 0;
  function nextId(p) { uid += 1; return 'boda-' + p + '-' + uid; }
  function str(v, d) { return (v == null || v === '') ? (d || '') : String(v); }

  /* لوحة المفاتيح على الموبايل: نتابع الـ visual viewport علشان الرسالة ما تتغطاش */
  function syncViewport() {
    var vv = window.visualViewport;
    var root = document.documentElement;
    if (!vv) return;
    root.style.setProperty('--boda-vh', vv.height + 'px');
    root.style.setProperty('--boda-vtop', vv.offsetTop + 'px');
  }
  function watchViewport(on) {
    var vv = window.visualViewport;
    if (!vv) return;
    if (on) {
      vv.addEventListener('resize', syncViewport);
      vv.addEventListener('scroll', syncViewport);
      syncViewport();
    } else {
      vv.removeEventListener('resize', syncViewport);
      vv.removeEventListener('scroll', syncViewport);
      document.documentElement.style.removeProperty('--boda-vh');
      document.documentElement.style.removeProperty('--boda-vtop');
    }
  }

  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* =====================================================
     Modal engine (رسالة واحدة في الوقت، الباقي في طابور)
     ===================================================== */
  var queue = [];
  var active = false;

  function show(opts) {
    return new Promise(function (resolve) {
      queue.push({ opts: opts, resolve: resolve });
      if (!active) openNext();
    });
  }

  function openNext() {
    var item = queue.shift();
    if (!item) { active = false; return; }
    active = true;

    var opts = item.opts;
    var type = TYPES[opts.type] ? opts.type : 'info';
    var variant = opts.variant || (type === 'danger' ? 'danger' : (type === 'achievement' ? 'achievement' : ''));
    var prevFocus = document.activeElement;
    var closed = false;

    var titleId = nextId('t');
    var descId = nextId('d');

    var overlay = h('div', { class: 'boda-ui boda-overlay' + (variant ? ' boda-v-' + variant : '') });
    var dialog = h('div', {
      class: 'boda-dialog',
      role: opts.role || 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': opts.message ? descId : false,
      tabindex: '-1'
    });

    /* Header: أيقونة BodA + الاسم + الشعار */
    var head = h('div', { class: 'boda-head' }, [
      h('img', { class: 'boda-head-icon', src: HEAD_ICON, alt: '', width: '34', height: '34' }),
      h('div', { class: 'boda-head-text' }, [
        h('span', { class: 'boda-head-name', text: 'BodA' }),
        h('span', { class: 'boda-head-sub', text: 'Build Your Self' })
      ])
    ]);

    /* Body */
    var body = h('div', { class: 'boda-body' });
    body.appendChild(h('div', { class: 'boda-ico t-' + type }, [icon(opts.icon || TYPES[type].icon)]));
    body.appendChild(h('h2', { class: 'boda-title', id: titleId, text: str(opts.title, TYPES[type].label) }));
    if (opts.message) body.appendChild(h('p', { class: 'boda-msg', id: descId, text: String(opts.message) }));
    if (opts.subMessage) body.appendChild(h('p', { class: 'boda-sub', text: String(opts.subMessage) }));
    if (opts.content) body.appendChild(opts.content);

    var ctx = {
      close: close,
      overlay: overlay,
      dialog: dialog,
      buttons: []
    };

    /* Footer */
    var foot = h('div', { class: 'boda-foot' });
    (opts.buttons || []).forEach(function (b) {
      var btn = h('button', {
        type: 'button',
        class: 'boda-btn ' + (b.primary ? 'boda-btn-primary' : 'boda-btn-secondary'),
        text: b.text
      });
      btn.addEventListener('click', function () {
        if (b.onClick && b.onClick(ctx) === false) return;
        close(b.value);
      });
      ctx.buttons.push(btn);
      foot.appendChild(btn);
    });

    dialog.appendChild(head);
    dialog.appendChild(body);
    dialog.appendChild(foot);
    if (variant === 'achievement' && !reduceMotion()) dialog.appendChild(makeConfetti());
    overlay.appendChild(dialog);

    /* منع التفاعل مع باقي الصفحة (inert) + قفل التمرير */
    var inerted = [];
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.classList && (el.classList.contains('boda-toasts'))) return;
      if (/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName)) return;
      if (!el.inert) { el.inert = true; inerted.push(el); }
    });
    document.documentElement.classList.add('boda-lock');
    watchViewport(true);
    document.body.appendChild(overlay);

    /* التركيز الأولي */
    var focusEl = null;
    if (opts.focus) focusEl = opts.focus(ctx);
    if (!focusEl && typeof opts.defaultButton === 'number') focusEl = ctx.buttons[opts.defaultButton];
    if (!focusEl) focusEl = ctx.buttons[0];
    (focusEl || dialog).focus({ preventScroll: true });

    /* مفاتيح: Esc + Focus trap */
    function onKey(e) {
      if (e.key === 'Escape' && opts.cancellable !== false) {
        e.preventDefault();
        e.stopPropagation();
        close(opts.cancelValue);
      } else if (e.key === 'Tab') {
        var items = Array.prototype.filter.call(dialog.querySelectorAll(FOCUSABLE), function (n) { return n.offsetParent !== null; });
        if (!items.length) { e.preventDefault(); dialog.focus(); return; }
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      } else if (e.key === 'Enter' && opts.onEnter && e.target && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        opts.onEnter(ctx);
      }
    }
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay && opts.backdropCancel !== false && opts.cancellable !== false) close(opts.cancelValue);
    });

    function close(value) {
      if (closed) return;
      closed = true;
      item.resolve(value);                    // القرار بيوصل فورًا، والحركة بتكمل بعدها
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.add('is-leaving');
      var done = false;
      function cleanup() {
        if (done) return;
        done = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        inerted.forEach(function (el) { el.inert = false; });
        document.documentElement.classList.remove('boda-lock');
        watchViewport(false);
        if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
          try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        openNext();
      }
      if (reduceMotion()) cleanup();
      else setTimeout(cleanup, 230);
    }
  }

  function makeConfetti() {
    var wrap = h('div', { class: 'boda-confetti', 'aria-hidden': 'true' });
    var colors = ['#DC143C', '#f5c542', '#ffffff', '#ff5a78'];
    for (var i = 0; i < 26; i++) {
      var p = h('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 120) + 'px');
      p.style.setProperty('--dy', (260 + Math.random() * 160) + 'px');
      p.style.setProperty('--rot', ((Math.random() - 0.5) * 900) + 'deg');
      wrap.appendChild(p);
    }
    return wrap;
  }

  /* =====================================================
     Public: Alert / Confirm / Achievement
     ===================================================== */
  function bodaAlert(opts) {
    opts = typeof opts === 'string' ? { message: opts } : (opts || {});
    return show({
      type: opts.type || 'info',
      icon: opts.icon,
      title: opts.title,
      message: opts.message,
      role: opts.type === 'error' ? 'alertdialog' : 'dialog',
      cancellable: true,
      cancelValue: true,
      buttons: [{ text: str(opts.confirmText, 'تمام'), primary: true, value: true }]
    });
  }

  function bodaConfirm(opts) {
    opts = opts || {};
    var type = opts.type || 'question';
    var danger = type === 'danger';
    return show({
      type: type,
      icon: opts.icon,
      title: opts.title,
      message: opts.message,
      role: 'alertdialog',
      cancellable: true,
      cancelValue: false,
      /* الإجراء الخطير: الافتراضي هو الإلغاء */
      defaultButton: danger ? 1 : 0,
      buttons: [
        { text: str(opts.confirmText, 'تأكيد'), primary: true, value: true },
        { text: str(opts.cancelText, 'إلغاء'), primary: false, value: false }
      ]
    }).then(function (v) { return v === true; });
  }

  function bodaAchievement(opts) {
    opts = opts || {};
    return show({
      type: 'achievement',
      icon: opts.icon,
      title: str(opts.title, 'إنجاز جديد يا بطل!'),
      message: opts.message,
      subMessage: opts.subMessage,
      role: 'dialog',
      cancellable: true,
      cancelValue: true,
      buttons: [{ text: str(opts.buttonText, 'واصل رحلتك 🔥'), primary: true, value: true }]
    });
  }

  /* =====================================================
     Public: Prompt (مع تحقق)
     opts: title, message, label, placeholder, inputType ('text'|'number'|'email'|'textarea'),
           unit, min, max, defaultValue, required, validate(value)->string|falsy,
           confirmText, cancelText, type, icon
     بترجع: القيمة (رقم لو inputType=number) أو null لو المستخدم لغى.
     ===================================================== */
  var AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
                    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  function normalizeNumber(raw) {
    return String(raw).trim()
      .replace(/[٠-٩۰-۹]/g, function (d) { return AR_DIGITS[d]; })
      .replace(/[٫،,]/g, '.')
      .replace(/\s+/g, '');
  }

  function bodaPrompt(opts) {
    opts = opts || {};
    var kind = opts.inputType || 'text';
    var numeric = kind === 'number';
    var multiline = kind === 'textarea';
    var unit = opts.unit ? String(opts.unit) : '';
    var required = opts.required !== false;

    var inputId = nextId('in');
    var errId = nextId('err');
    var input;
    if (multiline) {
      input = h('textarea', { class: 'boda-input', id: inputId, rows: '3' });
    } else {
      input = h('input', {
        class: 'boda-input' + (unit ? ' has-unit' : '') + (numeric ? ' is-num' : ''),
        id: inputId,
        type: kind === 'email' ? 'email' : 'text',
        inputmode: numeric ? 'decimal' : (kind === 'email' ? 'email' : (kind === 'tel' ? 'tel' : false)),
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        dir: (numeric || kind === 'email' || kind === 'tel') ? 'ltr' : false,
        enterkeyhint: 'done'
      });
    }
    if (opts.placeholder) input.setAttribute('placeholder', String(opts.placeholder));
    if (opts.defaultValue != null && opts.defaultValue !== '') input.value = String(opts.defaultValue);
    input.setAttribute('aria-describedby', errId);

    var err = h('p', { class: 'boda-field-error', id: errId, role: 'alert' });
    var field = h('div', { class: 'boda-field' }, [
      opts.label ? h('label', { class: 'boda-label', for: inputId, text: String(opts.label) }) : null,
      h('div', { class: 'boda-input-wrap' }, [input, unit ? h('span', { class: 'boda-unit', text: unit }) : null]),
      err
    ]);

    function setError(msg) {
      err.textContent = msg || '';
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        input.classList.remove('shake');
        void input.offsetWidth;
        if (!reduceMotion()) input.classList.add('shake');
        try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      } else {
        input.removeAttribute('aria-invalid');
      }
    }

    /* بيرجّع { value } لو سليم أو { error } لو فيه مشكلة */
    function check() {
      var raw = input.value == null ? '' : String(input.value).trim();
      if (!raw) return required ? { error: str(opts.requiredMessage, 'الحقل ده مطلوب.') } : { value: '' };
      var value = raw;
      if (numeric) {
        var n = normalizeNumber(raw);
        if (!/^\d+(\.\d+)?$/.test(n)) return { error: 'اكتب رقم صحيح بالأرقام فقط (مثال: 75 أو 75.5).' };
        value = parseFloat(n);
        if (!isFinite(value)) return { error: 'اكتب رقم صحيح.' };
        var hasMin = typeof opts.min === 'number', hasMax = typeof opts.max === 'number';
        if ((hasMin && value < opts.min) || (hasMax && value > opts.max)) {
          var u = unit ? ' ' + unit : '';
          if (hasMin && hasMax) return { error: 'القيمة لازم تكون بين ' + opts.min + ' و ' + opts.max + u + '.' };
          return { error: hasMin ? 'القيمة لازم تكون ' + opts.min + u + ' أو أكتر.' : 'القيمة لازم تكون ' + opts.max + u + ' أو أقل.' };
        }
      } else if (kind === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { error: 'اكتب بريد إلكتروني صحيح (مثال: name@example.com).' };
      }
      if (typeof opts.validate === 'function') {
        var custom = opts.validate(value);
        if (custom) return { error: String(custom) };
      }
      return { value: value };
    }

    input.addEventListener('input', function () { if (err.textContent) setError(''); });

    function submit(ctx) {
      var r = check();
      if (r.error) { setError(r.error); return false; }   // false = ما تقفلش الرسالة
      ctx.close(r.value);
      return true;
    }

    return show({
      type: opts.type || (numeric && /وزن|كجم|كيلو/.test(String(opts.title || '') + unit) ? 'weight' : 'question'),
      icon: opts.icon,
      title: opts.title,
      message: opts.message,
      content: field,
      role: 'dialog',
      cancellable: true,
      cancelValue: null,
      backdropCancel: false,                  // علشان ما نضيّعش اللي المستخدم كتبه بلمسة غلط
      focus: function () { return input; },
      onEnter: submit,
      buttons: [
        { text: str(opts.confirmText, 'حفظ'), primary: true, value: undefined, onClick: submit },
        { text: str(opts.cancelText, 'إلغاء'), primary: false, value: null }
      ]
    });
  }

  /* =====================================================
     Toasts
     ===================================================== */
  var toastBox = null;
  var recent = {};

  function ensureToastBox() {
    if (toastBox && document.body.contains(toastBox)) return toastBox;
    toastBox = h('div', { class: 'boda-ui boda-toasts', role: 'region', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'الإشعارات' });
    document.body.appendChild(toastBox);
    return toastBox;
  }

  function bodaToast(opts) {
    opts = typeof opts === 'string' ? { message: opts } : (opts || {});
    var type = (opts.type && TYPES[opts.type] && /^(success|error|warning|info)$/.test(opts.type)) ? opts.type : 'info';
    var title = opts.title;
    var message = opts.message;
    var duration = opts.duration || (type === 'error' ? 6500 : 4200);

    var key = type + '|' + str(title) + '|' + str(message);
    var now = Date.now();
    if (recent[key] && now - recent[key] < 1200) return;      // نمنع تكرار نفس الإشعار
    recent[key] = now;

    var box = ensureToastBox();
    while (box.children.length >= 4) box.removeChild(box.firstChild);

    var el = h('div', { class: 'boda-toast t-' + type, role: type === 'error' ? 'alert' : 'status' });
    var main = h('div', { class: 'boda-toast-main' });
    if (title) main.appendChild(h('div', { class: 'boda-toast-title', text: String(title) }));
    if (message) main.appendChild(h('div', title ? { class: 'boda-toast-msg', text: String(message) } : { class: 'boda-toast-title', text: String(message) }));

    var closeBtn = h('button', { type: 'button', class: 'boda-toast-close', 'aria-label': 'إغلاق الإشعار' }, [icon('fa-xmark')]);
    var bar = h('div', { class: 'boda-toast-bar', 'aria-hidden': 'true' }, [h('span')]);
    bar.firstChild.style.setProperty('--boda-dur', duration + 'ms');
    bar.firstChild.style.animationDuration = duration + 'ms';

    el.appendChild(h('div', { class: 'boda-toast-ico', 'aria-hidden': 'true' }, [icon(opts.icon || TYPES[type].icon)]));
    el.appendChild(main);
    el.appendChild(closeBtn);
    el.appendChild(bar);
    box.appendChild(el);

    var remaining = duration, startedAt = Date.now(), timer = null, gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.classList.add('is-leaving');
      if (reduceMotion()) { if (el.parentNode) el.parentNode.removeChild(el); }
      else setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 230);
    }
    function start() { startedAt = Date.now(); clearTimeout(timer); timer = setTimeout(dismiss, remaining); el.classList.remove('is-paused'); }
    function pause() { if (gone) return; remaining -= Date.now() - startedAt; clearTimeout(timer); el.classList.add('is-paused'); }
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', start);
    closeBtn.addEventListener('click', dismiss);
    start();
    return { dismiss: dismiss };
  }

  /* =====================================================
     bodaNotify: بديل مباشر لـ alert(msg)
     - رسالة قصيرة  -> Toast (النوع بيتحدد من نص الرسالة)
     - رسالة طويلة أو فيها سطور -> نافذة
     ===================================================== */
  var RX_ERROR = /مشكلة|تعذّر|تعذر|خطأ|فشل|رفض|مش قادر|غلط|permission|error/i;
  var RX_SUCCESS = /^تم|(^|\s)تم(ت)?\s|عاش|🎉|✅|اتفعّلت|اتفعلت|تمت/;
  var RX_WARN = /لازم|يجب|يرجى|أدخل|ادخل|اكتب|اختار|عفوًا|عفوا|سجّل|سجل حسابك|فقط|بالفعل|اتستخدمت|مش متاح/;

  function classify(msg) {
    if (RX_ERROR.test(msg)) return 'error';
    if (RX_SUCCESS.test(msg)) return 'success';
    if (RX_WARN.test(msg)) return 'warning';
    return 'info';
  }

  function bodaNotify(message, opts) {
    opts = opts || {};
    var text = str(message);
    var type = opts.type || classify(text);
    if (opts.modal || text.length > 110 || text.indexOf('\n') !== -1) {
      return bodaAlert({ type: type, title: opts.title, message: text });
    }
    bodaToast({ type: type, title: opts.title, message: text, duration: opts.duration });
    return Promise.resolve(true);
  }

  /* شبكة أمان: أي alert() فاضل في الكود (أو في مكتبة) هيطلع بشكل BodA بدل مربع المتصفح */
  window.alert = function (msg) { bodaNotify(str(msg)); };

  window.bodaAlert = bodaAlert;
  window.bodaConfirm = bodaConfirm;
  window.bodaPrompt = bodaPrompt;
  window.bodaToast = bodaToast;
  window.bodaNotify = bodaNotify;
  window.bodaAchievement = bodaAchievement;
  window.Boda = { alert: bodaAlert, confirm: bodaConfirm, prompt: bodaPrompt, toast: bodaToast, notify: bodaNotify, achievement: bodaAchievement };
})();
