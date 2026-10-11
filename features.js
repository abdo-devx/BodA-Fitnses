
/**
 * منصة BodA — ميزات إضافية (بتتحمل بعد script.js وبتستخدم نفس الـ state والدوال):
 *  1. مودال واتساب + رسالة تأكيد الاشتراك
 *  2. تايمر الراحة/التدريب جنب كل تمرينة (حد أقصى 5 دقايق)
 *  3. رسالة المتدرب بعد إنهاء يوم التمرين
 *  4. فيديو أداء المتدرب + ملاحظات ورد الكابتن (خصوصية: صاحب الفيديو والكابتن بس)
 *  5. التقرير الشهري (PDF عليه شعار BodA)
 *  6. حاسبة السعرات + إرسال بيانات المتدرب وتقرير InBody للكابتن على واتساب
 */
 
// ==================== أدوات عامة ====================
function makeOverlay(id, html) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'wk-celebrate';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
 
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}
 
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'wk-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 4000);
}
 
function fmtDate(ts) {
  return new Date(Number(ts) || Date.now()).toLocaleDateString('ar-EG');
}
 
function canUseMembers() {
  const u = state.currentUser;
  return !!u && (u.role === 'approved' || u.role === 'admin');
}
 
// ==================== 1. واتساب: رسالة تأكيد الاشتراك ====================
function showWhatsAppModal(opts) {
  const o = makeOverlay('waModal', `
    <div class="wk-celebrate-card wa-card" role="dialog" aria-modal="true">
      <div class="wk-celebrate-ico">💬</div>
      <h3>${escapeHtml(opts.title)}</h3>
      <p class="text-muted" style="margin-bottom: 10px;">راجع الرسالة وعدّل عليها لو حابب، وبعدين اضغط الزرار وهيفتح الواتساب على رقم المتدرب.</p>
      <textarea id="waText" rows="9" class="wa-text">${escapeHtml(opts.text)}</textarea>
      <div class="wa-actions">
        <button type="button" class="btn-gold" id="waSend"><i class="fa-brands fa-whatsapp"></i> فتح الواتساب وإرسال</button>
        <button type="button" class="btn-outline" onclick="closeOverlay('waModal')">إغلاق</button>
      </div>
    </div>`);
  o.querySelector('#waSend').onclick = () => {
    const txt = o.querySelector('#waText').value;
    window.open('https://wa.me/' + opts.phone + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  };
}
 
function buildSubscriptionMessage(u) {
  const end = Number(u.planEndsAt) || 0;
  const lines = [
    'أهلاً ' + (u.name || 'يا بطل') + ' 👋',
    'تم تأكيد اشتراكك معانا في ' + (u.plan || 'منصة BodA') + ' على منصة BodA ✅'
  ];
  if (end) lines.push('مدة الاشتراك: من ' + fmtDate(u.planStartedAt) + ' إلى ' + fmtDate(end));
  lines.push('تقدر تدخل على حسابك وتبدأ برنامجك دلوقتي: ' + location.origin + location.pathname);
  lines.push('أي استفسار أنا معاك 💪');
  lines.push('— كابتن عبد الرحيم');
  return lines.join('\n');
}
 
function openSubscriptionWhatsApp(u) {
  let phone = toWaNumber(u.phone);
  if (!phone) {
    phone = toWaNumber(prompt('رقم واتساب المتدرب مش متسجل. اكتبه هنا (01xxxxxxxxx):'));
    if (!phone) return;
  }
  showWhatsAppModal({
    title: 'رسالة تأكيد الاشتراك — ' + (u.name || ''),
    phone: phone,
    text: buildSubscriptionMessage(u)
  });
}
 
function sendSubscriptionMessage(uid) {
  const u = state.admin.users.find(x => x.id === uid);
  if (u) openSubscriptionWhatsApp(u);
}
 
// ==================== 2. تايمر الراحة / التدريب (حد أقصى 5 دقايق) ====================
const WK_TIMER_MAX = 300;
const WK_TIMER_OPTIONS = [30, 60, 90, 120, 180, 240, 300];
let wkTimer = { key: null, left: 0, mode: 'rest', iv: null, end: 0 };
let wkTimerPrefs = { mode: 'rest', secs: 90 };
 
function fmtClock(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
 
function fmtDur(s) {
  if (s < 60) return s + ' ث';
  const m = Math.floor(s / 60), r = s % 60;
  return r === 0 ? m + ' د' : m + ':' + String(r).padStart(2, '0') + ' د';
}
 
function exTimerHtml(key) {
  const running = wkTimer.key === key;
  const secs = running ? wkTimer.left : wkTimerPrefs.secs;
  const opts = WK_TIMER_OPTIONS.map(s =>
    '<option value="' + s + '"' + (s === wkTimerPrefs.secs ? ' selected' : '') + '>' + fmtDur(s) + '</option>').join('');
  const dis = running ? ' disabled' : '';
  return `
    <div class="wk-timer${running ? ' running' : ''}">
      <i class="fa-solid fa-stopwatch"></i>
      <div class="wk-timer-mode">
        <button type="button" class="${wkTimerPrefs.mode === 'rest' ? 'on' : ''}" onclick="setTimerMode('rest')"${dis}>راحة</button>
        <button type="button" class="${wkTimerPrefs.mode === 'train' ? 'on' : ''}" onclick="setTimerMode('train')"${dis}>تدريب</button>
      </div>
      <select onchange="setTimerSecs(this.value)" aria-label="مدة المؤقت (الحد الأقصى 5 دقايق)"${dis}>${opts}</select>
      <span class="wk-timer-time" id="wkt-${key}">${fmtClock(secs)}</span>
      <button type="button" class="wk-timer-go" onclick="toggleExTimer('${key}')">${running ? 'إيقاف' : 'ابدأ'}</button>
    </div>`;
}
 
function setTimerMode(mode) {
  wkTimerPrefs.mode = mode === 'train' ? 'train' : 'rest';
  refreshWorkoutPage();
}
 
function setTimerSecs(v) {
  wkTimerPrefs.secs = Math.min(WK_TIMER_MAX, Math.max(5, Number(v) || 90));
}
 
function stopExTimer() {
  if (wkTimer.iv) clearInterval(wkTimer.iv);
  wkTimer = { key: null, left: 0, mode: 'rest', iv: null, end: 0 };
}
 
function toggleExTimer(key) {
  if (wkTimer.key === key) {
    stopExTimer();
    refreshWorkoutPage();
    return;
  }
  stopExTimer();
  const secs = Math.min(WK_TIMER_MAX, Math.max(5, Number(wkTimerPrefs.secs) || 90));
  wkTimer = { key: key, mode: wkTimerPrefs.mode, left: secs, end: Date.now() + secs * 1000, iv: null };
  wkTimer.iv = setInterval(tickExTimer, 250);
  refreshWorkoutPage();
}
 
function tickExTimer() {
  if (!wkTimer.key) return;
  if (!document.getElementById('wkRoot')) { stopExTimer(); return; } // المتدرب سابك الصفحة
  const left = Math.max(0, Math.ceil((wkTimer.end - Date.now()) / 1000));
  wkTimer.left = left;
  const el = document.getElementById('wkt-' + wkTimer.key);
  if (el) el.textContent = fmtClock(left);
  if (left <= 0) {
    const mode = wkTimer.mode;
    stopExTimer();
    timerBeep();
    showToast(mode === 'train' ? 'خلص وقت التدريب ✅' : 'خلص وقت الراحة — كمّل المجموعة الجاية 💪');
    refreshWorkoutPage();
  }
}
 
function timerBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
  } catch (e) { /* ignore */ }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
 
// ==================== 3. رسالة المتدرب بعد إنهاء اليوم ====================
function openWorkoutNoteModal(i) {
  const d = WEEK_SCHEDULE[i];
  const plan = WORKOUT_PLAN[d.day];
  const title = plan.title.split(':')[1].trim();
  makeOverlay('wkNoteModal', `
    <div class="wk-celebrate-card wk-note-card" role="dialog" aria-modal="true">
      <div class="wk-celebrate-ico">📝</div>
      <h3>قولّي عن تمرين ${escapeHtml(d.label)} (${escapeHtml(title)})</h3>
      <p class="text-muted" style="margin-bottom: 12px;">اكتب التمرينة كانت عاملة إزاي ورأيك فيها: حسيت بإيه؟ في تمرينة كانت صعبة؟ فيه ألم أو إجهاد؟ الرسالة دي بتوصل للكابتن.</p>
      <textarea id="wkNoteText" rows="5" class="wa-text" placeholder="اكتب رأيك في تمرين النهاردة..."></textarea>
      <label class="wk-note-w">أقصى وزن استخدمته في تمرين اليوم (كجم) — اختياري، بيساعدنا نحسب تطور قوتك
        <input type="number" id="wkNoteWeight" min="0" step="0.5" inputmode="decimal" placeholder="مثال: 60">
      </label>
      <p id="wkNoteErr" class="wk-note-err"></p>
      <div class="wa-actions">
        <button type="button" class="btn-gold" id="wkNoteSend" onclick="submitWorkoutNote(${i})">إرسال وإنهاء اليوم</button>
        <button type="button" class="btn-outline" onclick="closeOverlay('wkNoteModal')">رجوع</button>
      </div>
    </div>`);
  setTimeout(() => { const t = document.getElementById('wkNoteText'); if (t) t.focus(); }, 50);
}
 
async function submitWorkoutNote(i) {
  const d = WEEK_SCHEDULE[i];
  if (!d || d.rest || !state.currentUser) return;
  const err = document.getElementById('wkNoteErr');
  const note = document.getElementById('wkNoteText').value.trim();
  if (note.length < 5) {
    err.textContent = 'لازم تكتب رأيك في التمرينة (5 حروف على الأقل) علشان تقدر تنهي اليوم.';
    return;
  }
  const weight = parseFloat(document.getElementById('wkNoteWeight').value);
  const btn = document.getElementById('wkNoteSend');
  btn.disabled = true;
  err.textContent = '';
 
  const plan = WORKOUT_PLAN[d.day];
  const now = new Date();
  const weekKey = workoutWeekKey();
  const log = {
    uid: state.currentUser.uid,
    name: state.currentUser.name || '',
    dayIndex: i,
    dayLabel: d.label,
    dayTitle: plan.title.split(':')[1].trim(),
    note: note,
    topWeight: isFinite(weight) && weight > 0 ? weight : null,
    exercises: plan.exercises.length,
    weekKey: weekKey,
    month: monthKeyOf(now),
    createdAt: Date.now(),
    date: now.toLocaleDateString('ar-EG')
  };
  try {
    if (!db) throw new Error('no-db');
    await db.collection('workoutLogs').doc(state.currentUser.uid + '_' + weekKey + '_' + i).set(log);
  } catch (e) {
    console.error(e);
    err.textContent = e && e.code === 'permission-denied'
      ? 'Firestore رفض الحفظ (permission-denied): لازم تضيف قواعد workoutLogs من ملف FIREBASE-RULES.md وتعمل Publish.'
      : 'حصلت مشكلة في إرسال رسالتك' + (e && e.code ? ' (' + e.code + ')' : '') + '. تأكد من الاتصال وجرّب تاني.';
    btn.disabled = false;
    return;
  }
 
  const p = loadWorkoutProgress();
  plan.exercises.forEach((_, k) => { p.ex[i + '-' + k] = true; });
  p.done[i] = true;
  saveWorkoutProgress(p);
  closeOverlay('wkNoteModal');
  refreshWorkoutPage();
 
  const days = workoutDoneDays(p);
  const weekDone = days === 6;
  const msg = weekDone ? WEEK_DONE_MESSAGE : DAY_DONE_MESSAGES[Math.floor(Math.random() * DAY_DONE_MESSAGES.length)];
  showWorkoutCelebration(weekDone ? 'خلّصت الأسبوع كله! 🏅' : 'خلّصت يوم ' + d.label + '! 🔥', msg, days);
}
 
// ==================== 4. فيديو الأداء ====================
function exerciseNames() {
  return Array.from(new Set(WORKOUT_PLAN.flatMap(d => d.exercises)));
}
 
function findVideo(id) {
  return ((state.admin && state.admin.videos) || []).concat(state.myVideos || []).find(v => v.id === id);
}
 
function renderVideoSection() {
  const head = '<h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800; margin-bottom: 6px;"><i class="fa-solid fa-video" style="color: var(--primary);"></i> فيديو أدائك للكابتن</h3>';
  if (!canUseMembers()) {
    return `<div class="glass-card" style="padding: 25px;">${head}<p class="text-muted">رفع فيديوهات الأداء متاح للمشتركين المفعّلين.</p></div>`;
  }
  const opts = exerciseNames().map(n => {
    const en = EXERCISE_GUIDE[n] && EXERCISE_GUIDE[n].en;
    return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + (en ? ' — ' + escapeHtml(en) : '') + '</option>';
  }).join('');
  return `
    <div class="glass-card" style="padding: 25px;" id="videoCard">
      ${head}
      <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 14px;">ارفع فيديو قصير (حد أقصى 60 ثانية و 50 ميجا) لأدائك في تمرينة معينة، والكابتن هيراجعه ويكتب لك ملاحظات وتعديلات. <strong>الفيديو خاص: بتشوفه إنت والكابتن بس.</strong></p>
      <form onsubmit="handleVideoUpload(event)">
        <div class="form-group">
          <label>التمرينة</label>
          <select id="vidExercise">${opts}</select>
        </div>
        <div class="form-group">
          <label>ملف الفيديو</label>
          <input type="file" id="vidFile" accept="video/*" required>
        </div>
        <div class="form-group">
          <label>ملاحظة للكابتن (اختياري)</label>
          <textarea id="vidNote" rows="2" placeholder="مثال: حاسس بشد في الكتف في آخر العدّة"></textarea>
        </div>
        <div class="vd-progress" id="vidProgress"><div><div id="vidBarFill"></div></div><span id="vidPct">0%</span></div>
        <button type="submit" id="vidBtn" class="btn-gold" style="width: 100%;"><i class="fa-solid fa-cloud-arrow-up"></i> رفع الفيديو</button>
      </form>
      <h4 style="margin: 22px 0 10px; color: #0f172a;">فيديوهاتك وردود الكابتن</h4>
      <div id="myVideos"><p class="text-muted">جاري تحميل فيديوهاتك...</p></div>
    </div>`;
}
 
function getVideoDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = d => { URL.revokeObjectURL(url); resolve(d); };
    v.onloadedmetadata = () => done(isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => done(0);
    setTimeout(() => done(0), 5000);
    v.src = url;
  });
}
 
async function handleVideoUpload(e) {
  e.preventDefault();
  const user = state.currentUser;
  if (!user || !canUseMembers()) { alert('رفع الفيديو للمشتركين المفعّلين فقط.'); return; }
  if (!storage || !db) {
    alert('رفع الفيديو محتاج تفعيل Firebase Storage. راجع ملف FIREBASE-RULES.md.');
    return;
  }
  const file = document.getElementById('vidFile').files[0];
  if (!file) { alert('اختار ملف الفيديو الأول.'); return; }
  if (!/^video\//.test(file.type)) { alert('الملف لازم يكون فيديو.'); return; }
  if (file.size > 50 * 1024 * 1024) { alert('حجم الفيديو أكبر من 50 ميجا. اختار فيديو أقصر أو بجودة أقل.'); return; }
 
  const btn = document.getElementById('vidBtn');
  btn.disabled = true;
  const duration = await getVideoDuration(file);
  if (duration > 61) {
    alert('الفيديو أطول من دقيقة. اختار فيديو قصير (حد أقصى 60 ثانية).');
    btn.disabled = false;
    return;
  }
 
  const exercise = document.getElementById('vidExercise').value;
  const note = document.getElementById('vidNote').value.trim();
  const id = db.collection('videos').doc().id;
  const ext = ((file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)) || 'mp4';
  const path = 'videos/' + user.uid + '/' + id + '.' + ext;
  const box = document.getElementById('vidProgress');
  const fill = document.getElementById('vidBarFill');
  const pct = document.getElementById('vidPct');
  box.style.display = 'flex';
 
  const resetUi = () => { btn.disabled = false; box.style.display = 'none'; fill.style.width = '0%'; pct.textContent = '0%'; };
  const task = storage.ref(path).put(file, { contentType: file.type || 'video/mp4' });
  // لو الرفع فضل على 0% يبقى Storage مش مفعّل أو القواعد مقفولة: نوقفه ونقول السبب بدل ما يفضل معلّق
  let started = false, timedOut = false;
  const watchdog = setTimeout(() => {
    if (!started) { timedOut = true; task.cancel(); }
  }, 20000);
  task.on('state_changed',
    snap => {
      if (snap.bytesTransferred > 0) started = true;
      const p = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
    },
    err => {
      clearTimeout(watchdog);
      console.error(err);
      const code = err && err.code ? err.code : '';
      let msg;
      if (timedOut || code === 'storage/retry-limit-exceeded' || code === 'storage/bucket-not-found' || code === 'storage/canceled') {
        msg = 'الرفع مابدأش (' + (code || 'timeout') + '). غالباً Firebase Storage مش مفعّل على المشروع أو الـ storageBucket غلط في firebase-config.js. فعّله من Firebase Console ← Storage (ممكن يطلب خطة Blaze) وراجع FIREBASE-RULES.md.';
      } else if (code === 'storage/unauthorized') {
        msg = 'Firebase رفض الرفع (storage/unauthorized): ضيف قواعد Storage من ملف FIREBASE-RULES.md واعمل Publish.';
      } else {
        msg = 'تعذّر رفع الفيديو' + (code ? ' (' + code + ')' : '') + '، جرّب تاني.';
      }
      alert(msg);
      resetUi();
    },
    async () => {
      clearTimeout(watchdog);
      try {
        await db.collection('videos').doc(id).set({
          uid: user.uid,
          name: user.name || '',
          exercise: exercise,
          note: note,
          path: path,
          size: file.size,
          duration: Math.round(duration) || null,
          reply: null,
          status: 'pending',
          createdAt: Date.now(),
          date: new Date().toLocaleDateString('ar-EG')
        });
      } catch (err) {
        console.error(err);
        try { await storage.ref(path).delete(); } catch (e2) { /* ignore */ }
        alert('حصلت مشكلة في حفظ بيانات الفيديو. راجع قواعد Firestore (FIREBASE-RULES.md).');
        resetUi();
        return;
      }
      document.getElementById('vidFile').value = '';
      document.getElementById('vidNote').value = '';
      resetUi();
      showToast('تم رفع الفيديو ✅ الكابتن هيراجعه ويرد عليك.');
      loadMyVideos();
    });
}
 
function videoStatusBadge(v) {
  return v.reply
    ? '<span class="badge approved">تم رد الكابتن</span>'
    : '<span class="badge pending">بانتظار مراجعة الكابتن</span>';
}
 
function replyHtml(r) {
  if (!r) return '';
  const av = r.avatar
    ? '<img src="' + escapeHtml(r.avatar) + '" alt="Coach Abdelrahim" class="vd-av">'
    : '<span class="vd-av vd-av-ph"><i class="fa-solid fa-user-tie"></i></span>';
  const part = (ico, label, txt) => txt
    ? '<div class="vd-part"><b><i class="fa-solid ' + ico + '"></i> ' + label + '</b><p>' + escapeHtml(txt).replace(/\n/g, '<br>') + '</p></div>'
    : '';
  return `
    <div class="vd-reply">
      <div class="vd-reply-head">${av}<div><b>Coach Abdelrahim</b><small>${fmtDate(r.at)}</small></div></div>
      ${part('fa-clipboard-check', 'ملاحظات الكابتن', r.notes)}
      ${part('fa-wrench', 'تعديلات مقترحة على الأداء', r.suggestions)}
      ${part('fa-comment-dots', 'رد الكابتن', r.message)}
    </div>`;
}
 
function myVideoHtml(v) {
  return `
    <div class="vd-item">
      <div class="vd-top">
        <div><h4><i class="fa-solid fa-dumbbell gold-text"></i> ${escapeHtml(v.exercise)}</h4><small class="text-muted">${escapeHtml(v.date || '')}</small></div>
        ${videoStatusBadge(v)}
      </div>
      ${v.note ? '<p class="vd-note">ملاحظتك: ' + escapeHtml(v.note) + '</p>' : ''}
      <div class="vd-actions">
        <button type="button" class="btn-outline vd-btn" onclick="playVideo('${v.id}')"><i class="fa-solid fa-play"></i> مشاهدة</button>
        <button type="button" class="vd-del" onclick="deleteMyVideo('${v.id}')"><i class="fa-solid fa-trash"></i> حذف</button>
      </div>
      ${replyHtml(v.reply)}
    </div>`;
}
 
async function loadMyVideos() {
  const box = document.getElementById('myVideos');
  if (!box || !db || !state.currentUser) return;
  try {
    const snap = await db.collection('videos').where('uid', '==', state.currentUser.uid).get();
    state.myVideos = snap.docs
      .map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    box.innerHTML = state.myVideos.length
      ? state.myVideos.map(myVideoHtml).join('')
      : '<p class="text-muted">لسه ماعندكش فيديوهات مرفوعة.</p>';
  } catch (err) {
    console.error(err);
    box.innerHTML = '<p class="text-muted">تعذّر تحميل الفيديوهات حالياً.</p>';
  }
}
 
async function playVideo(id) {
  const v = findVideo(id);
  if (!v) return;
  if (!storage) { alert('تشغيل الفيديو محتاج Firebase Storage.'); return; }
  makeOverlay('vidModal', `
    <div class="wk-celebrate-card vid-card" role="dialog" aria-modal="true">
      <h3>${escapeHtml(v.exercise)}${v.name ? ' — ' + escapeHtml(v.name) : ''}</h3>
      <div id="vidBox" class="vid-box">جاري تحميل الفيديو...</div>
      <button type="button" class="btn-outline" onclick="closeOverlay('vidModal')">إغلاق</button>
    </div>`);
  try {
    const url = await storage.ref(v.path).getDownloadURL();
    const box = document.getElementById('vidBox');
    if (box) box.innerHTML = '<video controls playsinline controlsList="nodownload" src="' + escapeHtml(url) + '"></video>';
  } catch (err) {
    console.error(err);
    const box = document.getElementById('vidBox');
    if (box) box.textContent = 'مش قادر أحمّل الفيديو (صلاحيات أو الملف اتحذف).';
  }
}
 
async function deleteMyVideo(id) {
  const v = findVideo(id);
  if (!v || !confirm('تحذف الفيديو ده نهائياً؟')) return;
  try {
    if (storage) { try { await storage.ref(v.path).delete(); } catch (e) { /* ممكن يكون اتحذف */ } }
    await db.collection('videos').doc(id).delete();
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في الحذف، جرّب تاني.');
    return;
  }
  loadMyVideos();
}
 
// ----- جانب الكابتن -----
function adminUserName(uid, fallback) {
  const u = (state.admin.users || []).find(x => x.id === uid);
  return (u && u.name) || fallback || 'متدرب';
}
 
function adminVideoCardHtml(v) {
  return `
    <div class="vd-item">
      <div class="vd-top">
        <div><h4>${escapeHtml(adminUserName(v.uid, v.name))}</h4><small class="text-muted">${escapeHtml(v.exercise)} • ${escapeHtml(v.date || '')}</small></div>
        ${videoStatusBadge(v)}
      </div>
      ${v.note ? '<p class="vd-note">ملاحظة المتدرب: ' + escapeHtml(v.note) + '</p>' : ''}
      <div class="vd-actions">
        <button type="button" class="btn-outline vd-btn" onclick="playVideo('${v.id}')"><i class="fa-solid fa-play"></i> مشاهدة</button>
        <button type="button" class="btn-gold vd-btn" onclick="openVideoReply('${v.id}')"><i class="fa-solid fa-pen"></i> ${v.reply ? 'تعديل الرد' : 'ملاحظات ورد'}</button>
      </div>
      ${replyHtml(v.reply)}
    </div>`;
}
 
function renderAdminVideosSection() {
  const list = (state.admin.videos || []).slice(0, 30);
  const pending = (state.admin.videos || []).filter(v => !v.reply).length;
  return `
    <div class="glass-card" style="padding: 25px; margin-bottom: 35px;">
      <h3 style="color: #0f172a; font-size: 1.3rem; font-weight: 800; margin-bottom: 6px;">
        <i class="fa-solid fa-video" style="color: var(--primary);"></i> فيديوهات أداء المتدربين
        <span class="badge pending" style="margin-inline-start: 8px;">${pending} بانتظار الرد</span>
      </h3>
      <p class="text-muted" style="font-size: 0.88rem; margin-bottom: 14px;">الفيديوهات خاصة: بتظهر ليك وللمتدرب صاحبها بس. (آخر 30 فيديو)</p>
      ${list.length === 0
        ? '<p class="text-muted">لا توجد فيديوهات مرفوعة بعد.</p>'
        : '<div class="vd-admin-grid">' + list.map(adminVideoCardHtml).join('') + '</div>'}
    </div>`;
}
 
function renderAdminLogsSection() {
  const logs = (state.admin.logs || []).slice(0, 30);
  return `
    <div class="glass-card" style="padding: 25px; margin-bottom: 35px;">
      <h3 style="color: #0f172a; font-size: 1.3rem; font-weight: 800; margin-bottom: 14px;">
        <i class="fa-solid fa-comments" style="color: var(--primary);"></i> رسائل المتدربين بعد التمرين
      </h3>
      ${logs.length === 0 ? '<p class="text-muted">لسه مفيش رسائل.</p>' : '<div class="lg-list">' + logs.map(l => `
        <div class="lg-item">
          <div class="lg-top">
            <b>${escapeHtml(l.name || adminUserName(l.uid))}</b>
            <span>${escapeHtml(l.dayLabel || '')} — ${escapeHtml(l.dayTitle || '')}</span>
            <small class="text-muted">${escapeHtml(l.date || '')}</small>
            ${l.topWeight ? '<span class="badge approved">أقصى وزن ' + escapeHtml(l.topWeight) + ' كجم</span>' : ''}
          </div>
          <p>${escapeHtml(l.note || '').replace(/\n/g, '<br>')}</p>
        </div>`).join('') + '</div>'}
    </div>`;
}
 
function openVideoReply(id) {
  const v = findVideo(id);
  if (!v) return;
  const r = v.reply || {};
  makeOverlay('vidReplyModal', `
    <div class="wk-celebrate-card wk-note-card" role="dialog" aria-modal="true">
      <h3>رد على فيديو ${escapeHtml(adminUserName(v.uid, v.name))} — ${escapeHtml(v.exercise)}</h3>
      <div class="form-group"><label>ملاحظات على الأداء</label><textarea id="vrNotes" rows="3" class="wa-text">${escapeHtml(r.notes || '')}</textarea></div>
      <div class="form-group"><label>تعديلات مقترحة</label><textarea id="vrSugg" rows="3" class="wa-text">${escapeHtml(r.suggestions || '')}</textarea></div>
      <div class="form-group"><label>رسالة / رد للمتدرب</label><textarea id="vrMsg" rows="3" class="wa-text">${escapeHtml(r.message || '')}</textarea></div>
      <p id="vrErr" class="wk-note-err"></p>
      <div class="wa-actions">
        <button type="button" class="btn-gold" onclick="saveVideoReply('${id}')">إرسال الرد</button>
        <button type="button" class="btn-outline" onclick="closeOverlay('vidReplyModal')">رجوع</button>
      </div>
    </div>`);
}
 
async function saveVideoReply(id) {
  const v = findVideo(id);
  if (!v) return;
  const notes = document.getElementById('vrNotes').value.trim();
  const suggestions = document.getElementById('vrSugg').value.trim();
  const message = document.getElementById('vrMsg').value.trim();
  if (!notes && !suggestions && !message) {
    document.getElementById('vrErr').textContent = 'اكتب ملاحظة أو تعديل أو رد على الأقل.';
    return;
  }
  const avatar = (state.adminProfile && state.adminProfile.avatar) || (state.profile && state.profile.avatar) || '';
  const reply = { notes: notes, suggestions: suggestions, message: message, at: Date.now(), avatar: avatar };
  try {
    await db.collection('videos').doc(id).update({ reply: reply, status: 'replied' });
  } catch (err) {
    console.error(err);
    document.getElementById('vrErr').textContent = 'حصلت مشكلة في إرسال الرد. راجع قواعد Firestore وجرّب تاني.';
    return;
  }
  v.reply = reply;
  closeOverlay('vidReplyModal');
  const u = state.admin.users.find(x => x.id === v.uid);
  handleRoute();
  if (u && u.phone) {
    showWhatsAppModal({
      title: 'إشعار المتدرب على واتساب',
      phone: toWaNumber(u.phone),
      text: 'أهلاً ' + (u.name || 'يا بطل') + ' 👋\nراجعت فيديو تمرين (' + v.exercise + ') ورديت عليك في صفحتك على BodA. ادخل شوف الملاحظات والتعديلات 💪\n— كابتن عبد الرحيم'
    });
  } else {
    showToast('تم إرسال الرد للمتدرب ✅');
  }
}
 
// ==================== 5. التقرير الشهري ====================
function monthKeyOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
 
function monthLabel(key) {
  const parts = key.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, 1);
  try { return d.toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' }); }
  catch (e) { return key; }
}
 
// التقرير بيتجهز في آخر 3 أيام من الشهر وأول 5 أيام من الشهر اللي بعده
function reportReadyMonth() {
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (now.getDate() >= dim - 2) return monthKeyOf(now);
  if (now.getDate() <= 5) return monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  return null;
}
 
function renderReportCard() {
  if (!canUseMembers()) return '';
  const now = new Date();
  const opts = [];
  for (let k = 0; k < 6; k++) {
    const key = monthKeyOf(new Date(now.getFullYear(), now.getMonth() - k, 1));
    opts.push('<option value="' + key + '">' + monthLabel(key) + '</option>');
  }
  const ready = reportReadyMonth();
  return `
    <div class="glass-card" style="padding: 25px;">
      <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800; margin-bottom: 6px;">
        <i class="fa-solid fa-file-pdf" style="color: var(--primary);"></i> تقريرك الشهري
      </h3>
      <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 14px;">حصصك المكتملة، نسبة التزامك، تطور قوتك، إنجازاتك، ملاحظات الكابتن وأهداف الشهر الجاي — وتنزّله PDF عليه شعار BodA.</p>
      ${ready ? '<div class="rp-ready"><span><i class="fa-solid fa-bell"></i> تقرير ' + monthLabel(ready) + ' جاهز!</span><button type="button" class="btn-gold" onclick="openMonthlyReport(\'' + ready + '\')">افتح التقرير</button></div>' : ''}
      <div class="rp-pick">
        <select id="rpMonth">${opts.join('')}</select>
        <button type="button" class="btn-outline" onclick="openMonthlyReport(document.getElementById('rpMonth').value)">عرض التقرير</button>
      </div>
    </div>`;
}
 
async function openMonthlyReport(monthKey) {
  const user = state.currentUser;
  if (!user || !db) { alert('سجّل دخولك الأول.'); return; }
  makeOverlay('reportOverlay', '<div class="rp-loading">جاري تجهيز التقرير...</div>');
  let logs = [];
  let videos = [];
  try {
    const snap = await db.collection('workoutLogs').where('uid', '==', user.uid).get();
    logs = snap.docs.map(d => d.data()).filter(l => l.month === monthKey)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch (err) {
    console.error(err);
    closeOverlay('reportOverlay');
    alert('تعذّر تحميل بيانات التقرير. راجع قواعد Firestore (FIREBASE-RULES.md).');
    return;
  }
  try {
    const vs = await db.collection('videos').where('uid', '==', user.uid).get();
    videos = vs.docs.map(d => d.data()).filter(v => monthKeyOf(new Date(v.createdAt || 0)) === monthKey);
  } catch (e) { videos = []; }
  const o = makeOverlay('reportOverlay', buildReportHtml(monthKey, logs, videos));
  o.classList.add('rp-overlay');
}
 
function buildReportHtml(monthKey, logs, videos) {
  const parts = monthKey.split('-').map(Number);
  const y = parts[0], m = parts[1];
  const now = new Date();
  const dim = new Date(y, m, 0).getDate();
  const elapsed = monthKeyOf(now) === monthKey ? now.getDate() : dim;
  const planned = Math.max(1, Math.round(elapsed / 7 * 6));
  const completed = logs.length;
  const adherence = Math.min(100, Math.round(completed / planned * 100));
  const p = state.profile || {};
 
  const perWeek = {};
  logs.forEach(l => { perWeek[l.weekKey] = (perWeek[l.weekKey] || 0) + 1; });
  const fullWeeks = Object.keys(perWeek).filter(k => perWeek[k] >= 6).length;
 
  // تطور القوة: أول وآخر وزن مسجّل لكل يوم تمرين
  const byDay = {};
  logs.forEach(l => { if (l.topWeight) (byDay[l.dayTitle] = byDay[l.dayTitle] || []).push(l); });
  const strength = Object.keys(byDay).map(k => {
    const arr = byDay[k];
    const first = arr[0].topWeight, last = arr[arr.length - 1].topWeight;
    return { day: k, first: first, last: last, n: arr.length, diff: arr.length > 1 ? Math.round((last - first) * 10) / 10 : null };
  });
 
  const ach = [];
  if (completed > 0) ach.push('أنهيت ' + completed + ' حصة تمرين هذا الشهر 💪');
  if (adherence >= 90) ach.push('التزام ممتاز: ' + adherence + '% من الخطة 🔥');
  if (fullWeeks > 0) ach.push('أكملت ' + fullWeeks + (fullWeeks === 1 ? ' أسبوع' : ' أسابيع') + ' كاملة (6 من 6) 🏅');
  strength.filter(s => s.diff > 0).forEach(s => ach.push('زوّدت وزن تمرين ' + s.day + ' بمقدار ' + s.diff + ' كجم 📈'));
  if (videos.length) ach.push('رفعت ' + videos.length + ' فيديو أداء للمراجعة 🎥');
  if (!ach.length) ach.push('بداية جديدة — أول حصة الشهر الجاي هتكون أول إنجاز ليك 🚀');
 
  const notes = [];
  if (p.coachFeedback) notes.push({ text: p.coachFeedback, tag: p.coachRating ? 'التقييم: ' + p.coachRating + ' / 5' : '' });
  videos.forEach(v => {
    if (v.reply) {
      const txt = [v.reply.notes, v.reply.suggestions, v.reply.message].filter(Boolean).join(' — ');
      if (txt) notes.push({ text: txt, tag: 'على فيديو ' + v.exercise });
    }
  });
 
  const nextPlanned = Math.round(new Date(y, m + 1, 0).getDate() / 7 * 6);
  const goals = [];
  goals.push('إتمام ' + Math.max(nextPlanned - 2, 1) + ' حصة على الأقل من أصل ' + nextPlanned + ' (التزام ' + (adherence >= 85 ? '90%' : '80%') + ' فأكثر)');
  goals.push(adherence < 70
    ? 'تثبيت مواعيد التمرين الأسبوعية وتحديد وقت ثابت لكل يوم'
    : 'زيادة وزن التمارين الأساسية بمقدار 2.5 كجم مع الحفاظ على التكنيك');
  const cw = Number(p.currentWeight), tw = Number(p.targetWeight);
  if (cw && tw) {
    const left = Math.round(Math.abs(cw - tw) * 10) / 10;
    goals.push(left === 0 ? 'الحفاظ على وزنك الحالي (' + cw + ' كجم)' : 'الاقتراب من وزنك المستهدف ' + tw + ' كجم (باقي ' + left + ' كجم)');
  }
  goals.push('رفع فيديو أداء لتمرينة واحدة على الأقل لمراجعة التكنيك');
  goals.push('تحديث الميزان أسبوعياً وتسجيل الحضور يومياً');
 
  const strengthHtml = strength.length
    ? '<table class="rp-table"><thead><tr><th>اليوم</th><th>أول وزن</th><th>آخر وزن</th><th>التطور</th></tr></thead><tbody>' +
      strength.map(s => '<tr><td>' + escapeHtml(s.day) + '</td><td>' + s.first + ' كجم</td><td>' + s.last + ' كجم</td><td>' +
        (s.diff === null ? '— (سجّل مرتين على الأقل)' : (s.diff > 0 ? '+' + s.diff : s.diff) + ' كجم') + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="rp-empty">لسه مفيش أوزان مسجلة. اكتب أقصى وزن استخدمته في رسالة نهاية كل تمرين علشان نحسب تطور قوتك.</p>';
 
  const notesHtml = notes.length
    ? notes.map(n => '<div class="rp-note">' + (n.tag ? '<small>' + escapeHtml(n.tag) + '</small>' : '') + '<p>' + escapeHtml(n.text) + '</p></div>').join('')
    : '<p class="rp-empty">مفيش ملاحظات من الكابتن لسه.</p>';
 
  return `
    <div class="rp-wrap">
      <div class="rp-actions">
        <button type="button" class="btn-gold" onclick="downloadReportPdf('${monthKey}')"><i class="fa-solid fa-file-arrow-down"></i> تحميل PDF</button>
        <button type="button" class="btn-outline" onclick="closeOverlay('reportOverlay')">إغلاق</button>
        <small>في نافذة الطباعة اختار «حفظ كـ PDF» (Save as PDF)</small>
      </div>
      <div class="rp-sheet">
        <div class="rp-head">
          <div class="rp-brand">
            <svg viewBox="0 0 64 36" aria-hidden="true"><rect x="1" y="11" width="6" height="14" rx="2"/><rect x="9" y="5" width="9" height="26" rx="2.5"/><rect x="18" y="16" width="28" height="4" rx="1"/><rect x="46" y="5" width="9" height="26" rx="2.5"/><rect x="57" y="11" width="6" height="14" rx="2"/></svg>
            <div><b>BodA</b><span>Build Your Self</span></div>
          </div>
          <div class="rp-title"><h2>التقرير الشهري</h2><span>${monthLabel(monthKey)}</span></div>
        </div>
        <div class="rp-who">
          <div><small>المتدرب</small><b>${escapeHtml(p.name || (state.currentUser && state.currentUser.name) || '')}</b></div>
          <div><small>الباقة</small><b>${escapeHtml(p.plan || (state.currentUser && state.currentUser.trial ? 'تجربة مجانية' : '—'))}</b></div>
          <div><small>الهدف</small><b>${escapeHtml(p.goal || '—')}</b></div>
        </div>
        <div class="rp-stats">
          <div><b>${completed} / ${planned}</b><span>حصص مكتملة</span></div>
          <div><b>${adherence}%</b><span>نسبة الالتزام بالخطة</span></div>
          <div><b>${fullWeeks}</b><span>أسابيع كاملة</span></div>
          <div><b>${videos.length}</b><span>فيديوهات أداء</span></div>
        </div>
        <div class="rp-bar"><div style="width: ${adherence}%"></div></div>
        <h3>تطور القوة</h3>${strengthHtml}
        <h3>الإنجازات الجديدة</h3><ul class="rp-list">${ach.map(a => '<li>' + escapeHtml(a) + '</li>').join('')}</ul>
        <h3>ملاحظات المدرب</h3>${notesHtml}
        <h3>أهداف الشهر القادم</h3><ol class="rp-list">${goals.map(g => '<li>' + escapeHtml(g) + '</li>').join('')}</ol>
        <div class="rp-foot">تم إنشاء التقرير بتاريخ ${fmtDate(Date.now())} — BodA | Build Your Self — Coach Abdelrahim</div>
      </div>
    </div>`;
}
 
function downloadReportPdf(monthKey) {
  const prev = document.title;
  document.title = 'BodA-Report-' + monthKey;
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
 
// ==================== 6. حاسبة السعرات + إرسال التقرير للكابتن ====================
function renderCalorieCalculator(profile) {
  const p = profile || {};
  const w = Number(p.currentWeight) || 75;
  const h = Number(p.height) || 175;
  const a = Number(p.age) || 25;
  const g = p.gender === 'f' ? 'f' : 'm';
  const act = String(p.activity || '1.725');
  const goal = String(p.calcGoal || '350');
  const sel = (cur, val) => (String(cur) === val ? ' selected' : '');
  return `
    <div class="glass-card" style="padding: 25px;">
      <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800; margin-bottom: 4px;">
        <i class="fa-solid fa-calculator" style="color: var(--primary);"></i> حاسبة السعرات والماكروز
      </h3>
      <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 16px;">اكتب وزنك وسنك وطولك واحسب سعراتك. الرقم النهائي ونظامك الغذائي بيتحددوا مع الكابتن.</p>
      <div class="kc-grid">
        <div class="form-group"><label>الوزن (كجم)</label><input type="number" id="kcW" value="${w}"></div>
        <div class="form-group"><label>الطول (سم)</label><input type="number" id="kcH" value="${h}"></div>
        <div class="form-group"><label>السن</label><input type="number" id="kcA" value="${a}"></div>
        <div class="form-group"><label>النوع</label>
          <select id="kcG"><option value="m"${sel(g, 'm')}>ذكر</option><option value="f"${sel(g, 'f')}>أنثى</option></select></div>
        <div class="form-group"><label>مستوى النشاط</label>
          <select id="kcAct">
            <option value="1.2"${sel(act, '1.2')}>قليل الحركة</option>
            <option value="1.375"${sel(act, '1.375')}>تمرين 1-3 أيام</option>
            <option value="1.55"${sel(act, '1.55')}>تمرين 3-5 أيام</option>
            <option value="1.725"${sel(act, '1.725')}>تمرين 6-7 أيام</option>
          </select></div>
        <div class="form-group"><label>هدفك</label>
          <select id="kcGoal">
            <option value="-400"${sel(goal, '-400')}>تنشيف وحرق دهون</option>
            <option value="0"${sel(goal, '0')}>ثبات الوزن</option>
            <option value="350"${sel(goal, '350')}>زيادة عضل (ضخامة)</option>
          </select></div>
      </div>
      <button onclick="calculateCalories()" class="btn-gold" style="width: 100%;"><i class="fa-solid fa-bolt"></i> احسب</button>
      <div id="kcResult" class="kc-result"></div>
 
      <details class="ib-box">
        <summary><i class="fa-solid fa-file-medical"></i> بيانات تقرير InBody (اختياري)</summary>
        <div class="kc-grid" style="margin-top: 12px;">
          <div class="form-group"><label>نسبة الدهون %</label><input type="number" id="ibFat" step="0.1" placeholder="مثال: 18.5"></div>
          <div class="form-group"><label>الكتلة العضلية الهيكلية (كجم)</label><input type="number" id="ibMuscle" step="0.1" placeholder="مثال: 34"></div>
          <div class="form-group"><label>دهون الأحشاء (مستوى)</label><input type="number" id="ibVisc" step="1" placeholder="مثال: 6"></div>
          <div class="form-group"><label>ماء الجسم (لتر)</label><input type="number" id="ibWater" step="0.1" placeholder="مثال: 42"></div>
          <div class="form-group"><label>معدل الحرق BMR (InBody)</label><input type="number" id="ibBmr" placeholder="مثال: 1750"></div>
        </div>
        <div class="form-group"><label>ملاحظات (إصابات، حساسية أكل، مواعيد…)</label><textarea id="ibNote" rows="2"></textarea></div>
        <small class="text-muted">بعد ما الواتساب يفتح، ابعت صورة أو PDF تقرير الـ InBody كمرفق في نفس المحادثة.</small>
      </details>
 
      <button onclick="sendNutritionToCoach()" class="btn-gold wa-send-btn"><i class="fa-brands fa-whatsapp"></i> ابعت بياناتي وتقرير الـ InBody للكابتن على واتساب</button>
    </div>`;
}
 
function calculateCalories() {
  const w = parseFloat(document.getElementById('kcW').value);
  const h = parseFloat(document.getElementById('kcH').value);
  const a = parseFloat(document.getElementById('kcA').value);
  const g = document.getElementById('kcG').value;
  const act = parseFloat(document.getElementById('kcAct').value);
  const goal = parseFloat(document.getElementById('kcGoal').value);
  const out = document.getElementById('kcResult');
  if (!w || !h || !a || w < 20 || w > 400 || h < 100 || h > 250 || a < 10 || a > 100) {
    out.innerHTML = "<span style='color: #dc2626;'>يرجى إدخال الوزن والطول والسن بشكل صحيح</span>";
    return null;
  }
  // معادلة Mifflin-St Jeor
  const bmr = 10 * w + 6.25 * h - 5 * a + (g === 'm' ? 5 : -161);
  const cal = Math.round(bmr * act + goal);
  const protein = Math.round(w * 2);
  const fat = Math.round(cal * 0.25 / 9);
  const carbs = Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
  out.innerHTML = `
    <div class="kc-big">${cal.toLocaleString('en')}</div>
    <div class="text-muted" style="margin-bottom: 12px;">سعرة حرارية / يوم</div>
    <div class="kc-macros">
      <div><b>${protein}</b><span>بروتين (جم)</span></div>
      <div><b>${carbs}</b><span>كارب (جم)</span></div>
      <div><b>${fat}</b><span>دهون (جم)</span></div>
    </div>`;
 
  const result = { w: w, h: h, a: a, g: g, bmr: Math.round(bmr), cal: cal, protein: protein, carbs: carbs, fat: fat };
  // نحفظ بيانات المتدرب في ملفه علشان الكابتن والصفحة يستخدموها
  if (db && state.currentUser && state.profile) {
    const upd = {
      currentWeight: w, height: h, age: a, gender: g,
      activity: String(act), calcGoal: String(goal),
      calories: cal, macros: { protein: protein, carbs: carbs, fat: fat }
    };
    db.collection('users').doc(state.currentUser.uid).set(upd, { merge: true })
      .then(() => Object.assign(state.profile, upd))
      .catch(e => console.warn(e));
  }
  return result;
}
 
function sendNutritionToCoach() {
  const r = calculateCalories();
  if (!r) return;
  const optText = id => { const s = document.getElementById(id); return s.options[s.selectedIndex].text; };
  const val = id => (document.getElementById(id).value || '').trim();
  const p = state.profile || {};
  const lines = [
    'مرحباً كابتن عبد الرحيم 👋',
    'أنا ' + ((state.currentUser && state.currentUser.name) || '') + '، وده تقريري لتحديد نظامي الغذائي:',
    '',
    '📌 بياناتي:',
    '• الوزن: ' + r.w + ' كجم',
    '• الطول: ' + r.h + ' سم',
    '• السن: ' + r.a + ' سنة',
    '• النوع: ' + (r.g === 'm' ? 'ذكر' : 'أنثى'),
    '• النشاط: ' + optText('kcAct'),
    '• الهدف: ' + optText('kcGoal')
  ];
  if (Number(p.targetWeight)) lines.push('• الوزن اللي عايز أوصله: ' + p.targetWeight + ' كجم');
  lines.push('', '🔥 حاسبة السعرات:',
    '• السعرات اليومية: ' + r.cal + ' سعرة',
    '• بروتين: ' + r.protein + ' جم | كارب: ' + r.carbs + ' جم | دهون: ' + r.fat + ' جم',
    '• BMR (حسب الحاسبة): ' + r.bmr + ' سعرة');
 
  const ib = [];
  if (val('ibFat')) ib.push('• نسبة الدهون: ' + val('ibFat') + '%');
  if (val('ibMuscle')) ib.push('• الكتلة العضلية الهيكلية: ' + val('ibMuscle') + ' كجم');
  if (val('ibVisc')) ib.push('• دهون الأحشاء (مستوى): ' + val('ibVisc'));
  if (val('ibWater')) ib.push('• ماء الجسم: ' + val('ibWater') + ' لتر');
  if (val('ibBmr')) ib.push('• BMR (InBody): ' + val('ibBmr') + ' سعرة');
  if (ib.length) lines.push('', '📊 تقرير InBody:', ...ib, '(هبعتلك صورة التقرير هنا في المحادثة)');
  if (val('ibNote')) lines.push('', '📝 ملاحظات: ' + val('ibNote'));
  lines.push('', 'ممكن نحدد نظامي الغذائي سوا؟ 🙏');
 
  window.open('https://wa.me/' + COACH_PHONE + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
}