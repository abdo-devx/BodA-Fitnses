
 
/**
 * منصة BodA - Build Your Self
 * الكابتن: كابتن عبد الرحيم
 * إدارة الحالة والمحتوى المحمي ونظام التوجيه (Router)
 */
 
// --- 1. Firebase وأدوات مساعدة وحالة التطبيق ---
 
// الإعدادات بتتحط في firebase-config.js (راجع FIREBASE-SETUP.md)
const fbConfigured = typeof firebase !== 'undefined' &&
  !!window.FIREBASE_CONFIG && !!window.FIREBASE_CONFIG.apiKey &&
  !/^YOUR_/.test(window.FIREBASE_CONFIG.apiKey);
 
let auth = null;
let db = null;
let storage = null; // Firebase Storage (فيديوهات الأداء)
if (fbConfigured) {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  auth = firebase.auth();
  auth.languageCode = 'ar'; // إيميلات الاسترجاع بالعربي
  db = firebase.firestore();
  try {
    if (typeof firebase.storage === 'function') storage = firebase.storage();
    if (storage) { storage.setMaxUploadRetryTime(15000); storage.setMaxOperationRetryTime(15000); }
  } catch (e) { console.warn('Storage غير مفعّل', e); }
}
 
function requireFirebase() {
  if (fbConfigured) return true;
  alert('الموقع لسه ماتربطش بـ Firebase. راجع ملف FIREBASE-SETUP.md وضيف الإعدادات في firebase-config.js.');
  return false;
}
 
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
 
function authErrorMessage(err) {
  const map = {
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
    'auth/user-not-found': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/wrong-password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/email-already-in-use': 'البريد ده مسجل بالفعل. سجّل دخولك أو استخدم "نسيت كلمة المرور".',
    'auth/weak-password': 'كلمة المرور ضعيفة، استخدم 8 أحرف على الأقل.',
    'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني.',
    'auth/network-request-failed': 'مشكلة في الاتصال بالإنترنت.',
    'auth/unauthorized-domain': 'الدومين ده غير مضاف في Firebase (Authentication ← Settings ← Authorized domains).'
  };
  return map[err && err.code] || 'حصل خطأ غير متوقع، جرّب تاني.';
}
 
// تصغير الصور قبل تخزينها (الأفاتار والإيصالات)
function resizeImage(file, maxSize, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      cb(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => cb(e.target.result);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
 
const state = {
  currentUser: null,   // { uid, name, email, role: 'admin' | 'approved' | 'pending', plan }
  profile: null,       // وثيقة المتدرب من Firestore (users/{uid})
  admin: { users: [], payments: [], logs: [], videos: [] },
  suppressAuth: false
};
 
// معلومات التجربة المجانية من ملف المتدرب
function trialInfo(profile) {
  const end = Number(profile && profile.trialEndsAt) || 0;
  return {
    used: !!(profile && profile.trialStartedAt),
    active: end > Date.now(),
    end: end,
    daysLeft: Math.max(0, Math.ceil((end - Date.now()) / 864e5))
  };
}
 
// مدة الباقة بالشهور (من اسم الباقة أو كودها)
function planMonthsByName(planName) {
  const p = Object.values(PLANS).find(x => x.name === planName || x.code === planName);
  return p ? p.months : 1;
}
 
// حالة الاشتراك: الباقة بتنتهي تلقائياً بعد انتهاء مدتها (planEndsAt)
function subscriptionInfo(profile) {
  const end = Number(profile && profile.planEndsAt) || 0;
  const active = !!(profile && profile.status === 'active');
  const expired = active && end > 0 && end <= Date.now();
  return {
    paid: active && !expired,
    expired: expired || !!(profile && profile.status === 'expired'),
    end: end,
    daysLeft: end ? Math.max(0, Math.ceil((end - Date.now()) / DAY_MS)) : null
  };
}
 
// تحويل رقم مصري (01xxxxxxxxx) لصيغة واتساب الدولية (201xxxxxxxxx)
function toWaNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.charAt(0) === '0') d = '2' + d;
  return d;
}
 
// تحميل بيانات المستخدم المسجل: هل هو أدمن؟ وهل اشتراكه مفعّل؟
async function applyAuthUser(fbUser) {
  state.profile = null;
  if (!fbUser) {
    state.currentUser = null;
    return;
  }
  try {
    const [adminDoc, userDoc] = await Promise.all([
      db.collection('admins').doc(fbUser.uid).get(),
      db.collection('users').doc(fbUser.uid).get()
    ]);
    const profile = userDoc.exists ? userDoc.data() : null;
    const adminData = adminDoc.exists ? adminDoc.data() : null;
    const isAdmin = adminDoc.exists;
    state.profile = profile;
    state.adminProfile = adminData;
    const paid = subscriptionInfo(profile).paid;
    const onTrial = !isAdmin && !paid && trialInfo(profile).active;
    state.currentUser = {
      uid: fbUser.uid,
      name: isAdmin ? 'Coach Abdelrahim' : ((profile && profile.name) || 'متدرب BodA'),
      email: fbUser.email || '',
      trial: onTrial,
      role: isAdmin ? 'admin' : (paid || onTrial ? 'approved' : 'pending'),
      plan: (profile && profile.plan) || '',
      avatar: (adminData && adminData.avatar) || (profile && profile.avatar) || ''
    };
  } catch (err) {
    console.error(err);
    state.currentUser = { uid: fbUser.uid, name: 'متدرب BodA', email: fbUser.email || '', role: 'pending', plan: '' };
  }
}
 
// بعد الدخول/التسجيل: نرجع المستخدم للصفحة اللي كان رايحلها (زي الدفع)
function postAuthTarget() {
  const t = sessionStorage.getItem('afterAuth');
  sessionStorage.removeItem('afterAuth');
  if (state.currentUser && state.currentUser.role === 'admin') return '#/admin';
  return t || '#/dashboard';
}
 
// بيانات لوحة الكابتن (بتتحمل من Firestore)
async function loadAdminData() {
  const safe = p => p.catch(err => { console.warn(err); return null; });
  const [users, payments, logs, videos] = await Promise.all([
    db.collection('users').get(),
    db.collection('payments').get(),
    safe(db.collection('workoutLogs').get()),
    safe(db.collection('videos').get())
  ]);
  state.admin.users = users.docs.map(d => Object.assign({ id: d.id }, d.data()));
  state.admin.payments = payments.docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  state.admin.logs = logs ? logs.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(byNewest) : [];
  state.admin.videos = videos ? videos.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(byNewest) : [];
 
  // إلغاء الباقات اللي مدتها انتهت تلقائياً
  const now = Date.now();
  const expired = state.admin.users.filter(u => u.status === 'active' && Number(u.planEndsAt) > 0 && Number(u.planEndsAt) <= now);
  await Promise.all(expired.map(u =>
    db.collection('users').doc(u.id).update({ status: 'expired' })
      .then(() => { u.status = 'expired'; })
      .catch(err => console.warn(err))
  ));
}
 
// --- نظام التمرين: مصدر واحد لصفحة التمارين وقسم "أسبوعك مع BodA" ---
const WORKOUT_NOTE = 'الالتزام بـ 3 مجموعات لكل تمرينة، وتكرارات بين 6-8 عدّات للوصول إلى الفشل العضلي المحسوب.';
const WORKOUT_PLAN = [
  { title: "اليوم الأول: بنش + ظهر 1", exercises: ["دامبل عالي", "سحب عالي", "بار واطي", "سحب أرضي ضيق", "فراشة", "حبل ظهر"] },
  { title: "اليوم الثاني: دراع 1 (أكتاف وباي وتراي)", exercises: ["دامبل 90°", "رفرفة جانبي", "رفرفة كيبل", "كتف خلفي", "باي كرسي", "تراي خلفي", "باي ارتكاز", "تراي حبل"] },
  { title: "اليوم الثالث: رجل 1", exercises: ["Squat — سكوات", "خلفي", "أمامي", "Deadlift — ديدليفت", "سمانة", "ساعد"] },
  { title: "اليوم الرابع: بنش + ظهر 2", exercises: ["بار عالي", "T-Bar Row — تي بار", "دامبل واطي", "سحب عالي ضيق", "كيبل بنش", "One Arm Row — سحب يد واحدة"] },
  { title: "اليوم الخامس: دراع 2", exercises: ["كتف أمامي", "رفرفة دامبل", "كتف خلفي", "ترابيس", "باي خلفي", "تراي خلفي", "باي ارتكاز", "باي بار", "تراي كيبل"] },
  { title: "اليوم السادس: رجل 2", exercises: ["مكبس", "خلفي", "أمامي", "ضامة", "سمانة", "بطن"] }
];
// أيام الأسبوع من السبت للجمعة: 6 أيام تمرين (بنفس ترتيب WORKOUT_PLAN) + يوم راحة.
// لو عايز تغيّر اليوم اللي بيبدأ منه الجدول أو يوم الراحة، عدّل الترتيب هنا بس.
const WEEK_SCHEDULE = [
  { label: 'السبت', day: 0 }, { label: 'الأحد', day: 1 }, { label: 'الاثنين', day: 2 },
  { label: 'الثلاثاء', day: 3 }, { label: 'الأربعاء', day: 4 }, { label: 'الخميس', day: 5 },
  { label: 'الجمعة', rest: true }
];
// مدة التجربة المجانية بالأيام (عرض أول أسبوعين مجاناً)
const TRIAL_DAYS = 14;
const DAY_MS = 864e5; // يوم بالمللي ثانية
const COACH_PHONE = '201207908662'; // واتساب الكابتن (بصيغة دولية)
// الباقات المتاحة (مصدر واحد للسعر والاسم والكود). code = القيمة المخزنة في طلب الدفع.
const PLANS = {
  standard: { code: 'الأساسية', name: 'الباقة الأساسية (Standard)', price: 300, months: 1 },
  vip:      { code: 'VIP', name: 'باقة VIP الخاصة (Elite Coaching)', price: 450, months: 1 },
  promax:   { code: 'PROMAX', name: 'باقة 3 برو ماكس (3 Pro Max)', price: 750, months: 3 }
};
// موعد انتهاء عرض "أول أسبوعين مجاناً" (العدّاد في الصفحة الرئيسية). غيّره لتاريخك.
const PROMO_END = new Date('2026-11-01T20:00:00+03:00').getTime();
 
// --- 2. محرك التوجيه (Router) ---
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  const toggle = document.getElementById('menuToggle');
  if (toggle) {
    toggle.addEventListener('click', () => document.getElementById('navLinks').classList.toggle('show'));
  }
  handleRoute();
}
 
const ROUTES = {
  '#/': renderHomePage,
  '#/about': renderAboutPage,
  '#/team': renderTeamPage,
  '#/how-it-works': renderHowItWorksPage,
  '#/services': renderServicesPage,
  '#/success-stories': renderSuccessStoriesPage,
  '#/blog': renderBlogPage,
  '#/faq': renderFaqPage,
  '#/contact': renderContactPage,
  '#/login': renderLoginPage,
  '#/register': renderRegisterPage,
  '#/payment': renderPaymentPage,
  '#/dashboard': renderDashboardPage,
  '#/workouts': renderWorkoutsPage,
  '#/nutrition': renderNutritionPage,
  '#/recipes': renderRecipesPage,
  '#/fitness-rules': renderFitnessRulesPage,
  '#/tools': renderToolsPage,
  '#/plans': renderHomePage,
  '#/admin': renderAdminPage
};
 
// صفحات المحتوى الخاص بالمشتركين المفعّلين فقط
const MEMBERS_ONLY = ['#/workouts', '#/nutrition', '#/recipes', '#/fitness-rules'];
 
let routeToken = 0;
 
async function handleRoute() {
  const token = ++routeToken;
  const hash = window.location.hash || '#/';
  const app = document.getElementById('app');
  const user = state.currentUser;
  // لو التجربة خلصت أثناء وجود المستخدم على الموقع نرجّعه لوضع "غير مفعّل"
  if (user && user.role === 'approved') {
    const stillPaid = subscriptionInfo(state.profile).paid;
    const stillTrial = trialInfo(state.profile).active;
    if (!stillPaid && !stillTrial) {
      user.trial = false;
      user.role = 'pending'; // الباقة أو التجربة خلصت
    } else {
      user.trial = !stillPaid && stillTrial;
    }
  }
  updateNav();
 
  // الأدمن له كامل الصلاحيات في كل صفحات الموقع ما عدا صفحة المتدرب فقط
  if (hash === '#/dashboard' && user && user.role === 'admin') {
    window.location.hash = '#/admin';
    return;
  }
 
  // تفعيل التجربة المجانية (من أزرار "ابدأ مجاناً")
  if (hash === '#/free-trial') {
    await claimFreeTrial();
    return;
  }
 
  if (MEMBERS_ONLY.includes(hash) || hash === '#/dashboard') {
    if (!user) {
      window.location.hash = '#/login';
      return;
    }
    if (hash !== '#/dashboard' && user.role !== 'admin' && user.role !== 'approved') {
      alert('المحتوى ده للمشتركين المفعّلين فقط. أتمم الاشتراك وهيتفتح لك فورًا.');
      window.location.hash = '#/payment';
      return;
    }
  }
 
  // الدفع يحتاج حساب، وبعد التسجيل/الدخول نرجّعه لنفس الصفحة
  if (hash === '#/payment' && !user) {
    sessionStorage.setItem('afterAuth', '#/payment');
    alert('سجّل حسابك الأول (دقيقة واحدة) وبعدها تكمل الاشتراك.');
    window.location.hash = '#/register';
    return;
  }
 
  if (hash === '#/admin' && (!user || user.role !== 'admin')) {
    alert('عفوًا، هذه اللوحة مخصصة للكابتن فقط.');
    window.location.hash = '#/';
    return;
  }
 
  // صفحات محتاجة بيانات من Firestore قبل العرض
  if (hash === '#/admin') {
    app.innerHTML = '<p class="text-muted" style="text-align:center; padding: 60px 0;">جاري تحميل البيانات...</p>';
    try {
      await loadAdminData();
    } catch (err) {
      console.error(err);
      if (token === routeToken) {
        app.innerHTML = '<div class="glass-card" style="max-width:560px; margin:40px auto; text-align:center;"><h3 class="gold-text">تعذّر تحميل البيانات</h3><p class="text-muted">تأكد من قواعد Firestore وإن حسابك مضاف في مجموعة admins.</p></div>';
      }
      return;
    }
  }
  if (token !== routeToken) return; // اتفتحت صفحة تانية أثناء التحميل
 
  if (hash === '#/plans') sessionStorage.setItem('scrollTo', 'plans');
  const render = ROUTES[hash];
  app.innerHTML = render
    ? (render() || '')
    : `<div class="hero-section"><h2>الصفحة غير موجودة</h2><a href="#/" class="btn-gold">العودة للرئيسية</a></div>`;
 
  startPromoCountdown();
  if (hash === '#/dashboard' && typeof loadMyVideos === 'function') loadMyVideos();
  const links = document.getElementById('navLinks');
  if (links) links.classList.remove('show');
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
  window.scrollTo(0, 0);
  const scrollId = sessionStorage.getItem('scrollTo');
  if (scrollId) {
    sessionStorage.removeItem('scrollTo');
    const target = document.getElementById(scrollId);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}
 
function updateNav() {
  const container = document.getElementById('navActions');
  if (!state.currentUser) {
    container.innerHTML = `
      <a href="#/register" class="btn-gold"><i class="fa-regular fa-user"></i> ابدأ الآن</a>
      <a href="#/login" class="btn-outline"><i class="fa-regular fa-user"></i> تسجيل الدخول</a>
    `;
  } else if (state.currentUser.role === 'admin') {
    // للأدمن: إظهار لوحة الإدارة وزر الخروج فقط مع إتاحة كافة روابط الموقع
    container.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <a href="#/admin" class="btn-gold"><i class="fa-solid fa-crown"></i> الإدارة</a>
        <button onclick="logoutUser()" class="btn-outline" style="border-color: #dc2626; color: #dc2626; padding: 6px 12px; cursor: pointer;">خروج</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <a href="#/dashboard" class="btn-gold"><i class="fa-solid fa-user-shield"></i> لوحة المتدرب</a>
        <button onclick="logoutUser()" class="btn-outline" style="border-color: #dc2626; color: #dc2626; padding: 6px 12px; cursor: pointer;">خروج</button>
      </div>
    `;
  }
}
 
// دالة تسجيل الخروج للعودة لحالة الزائر وتجربة تسجيل الدخول
async function logoutUser() {
  if (auth) {
    try { await auth.signOut(); } catch (err) { console.error(err); }
  }
  sessionStorage.removeItem('afterAuth');
  state.currentUser = null;
  state.profile = null;
  state.admin = { users: [], payments: [], logs: [], videos: [] };
  window.location.hash = '#/login';
  updateNav();
  handleRoute();
}
 
// --- 3. قوالب الصفحات العامة (Public Pages) ---
function renderHomePage() {
  return `
    <!-- 1. الهيرو الرئيسي -->
    <section class="hero-dark">
      <img class="hero-photo" src="hero-man.jpg" alt="" aria-hidden="true">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-eyebrow"><span>أكثر من مجرد تدريب</span><i class="fa-solid fa-arrow-right-long"></i></div>
          <h1>
            جربت تبدأ ومكملتش؟<br>
            <span class="hl">السر مش في العزيمة.. السر في المنظومة الصح!</span>
          </h1>
          <p class="hero-sub">
            مش مطلوب منك تعزل نفسك عن الدنيا عشان تعمل فورمة. مع <strong>كابتن عبد الرحيم</strong>، بنفصّل جدول تمرينك وأكلك على ظروف يومك ووقتك، علشان الالتزام يبقى أسهل قرار تاخده كل يوم.
          </p>
 
          <div class="hero-pills">
            <span class="hero-pill"><i class="fa-solid fa-check"></i> بدون حرمان من أكل بيتك</span>
            <span class="hero-pill"><i class="fa-solid fa-check"></i> مبني على الزيادة التدريجية العلمية</span>
            <span class="hero-pill"><i class="fa-solid fa-check"></i> حلول مرنة لأصحاب الأوقات المزدحمة</span>
          </div>
 
          <div class="hero-buttons">
            <a href="#/payment" class="btn-gold hero-cta"><i class="fa-solid fa-bolt"></i> اصنع نسختك الأقوى الآن</a>
            <a href="#/how-it-works" class="btn-outline hero-cta-2"><i class="fa-regular fa-clipboard"></i> خطوات المتابعة بالتفصيل</a>
          </div>
          <p class="hero-note"><i class="fa-solid fa-lock"></i> تفعيل فوري لمنظومة التدريب بعد الاشتراك</p>
        </div>
      </div>
    </section>
 
    <!-- شريط العرض: أول أسبوعين مجاناً -->
    <section class="promo-bar">
      <div class="promo-in">
        <div class="promo-copy">
          <h3><i class="fa-solid fa-gift"></i> أول أسبوعين مجاناً لكل مشترك جديد!</h3>
          <p>جرّب المنظومة 14 يوم كاملين من غير ما تدفع، وادخل تحدي الـ 30 يوم مع الأبطال.</p>
        </div>
        <div class="countdown" id="promoCountdown" dir="ltr">
          <div><b id="cdD">00</b><span>يوم</span></div>
          <div><b id="cdH">00</b><span>ساعة</span></div>
          <div><b id="cdM">00</b><span>دقيقة</span></div>
          <div><b id="cdS">00</b><span>ثانية</span></div>
        </div>
        <a href="#/free-trial" class="promo-btn"><i class="fa-solid fa-bolt"></i> ابدأ مجاناً</a>
      </div>
    </section>
 
    <!-- 3. كروت الأبطال -->
    <section style="margin: 40px 0;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h3 class="section-title">
          <i class="fa-solid fa-dumbbell"></i> نماذج من أبطالنا اللي حولوا التردد إلى استمرارية <i class="fa-solid fa-dumbbell"></i>
        </h3>
        <p class="text-muted">النتيجة مش صدفة، دي معادلة علم وتطبيق مستمر</p>
      </div>
 
      <div class="grid-3 story-grid">
        <!-- كارت 1 -->
        <div class="glass-card" style="text-align: center; position: relative;">
          <div style="position: absolute; top: 12px; left: 12px; background: #fff1f2; border: 1px solid rgba(225, 29, 72, 0.2); padding: 3px 12px; border-radius: 20px; font-size: 0.75rem; color: var(--primary); font-weight: 700;">
            🎯 كسر ثبات الوزن
          </div>
          <div style="width: 75px; height: 75px; margin: 15px auto; background: #fff1f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--primary);">
            <i class="fa-solid fa-fire-flame-curved gold-text" style="font-size: 1.8rem;"></i>
          </div>
          <h4 style="font-size: 1.15rem; margin-bottom: 4px; color: #0f172a;">محمد ياسر . (خسارة 8 كجم دهون)</h4>
          <span class="badge approved" style="margin-bottom: 12px;">نحت دهون وحفاظ على العضل</span>
          <p class="text-muted" style="font-size: 0.9rem; line-height: 1.7;">"كنت بقالي سنة وزني ثابت وعصبيتي زايدة من قلة الأكل، كابتن عبد الرحيم ضبط لي كميات الكارب فنزلت دهون بدون هبوط وطاقتي في التمرين رجعت أحسن من الأول."</p>
          <a href="#/success-stories" class="read-more">اقرأ المزيد <i class="fa-solid fa-arrow-left"></i></a>
        </div>
 
        <!-- كارت 2 -->
        <div class="glass-card" style="text-align: center; position: relative; border: 2px solid var(--primary) !important;">
          <div style="position: absolute; top: 12px; left: 12px; background: var(--primary-gradient); color: #fff; padding: 3px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700;">
            💪 ضخامة وقوة
          </div>
          <div style="width: 75px; height: 75px; margin: 15px auto; background: #fff1f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--primary);">
            <i class="fa-solid fa-trophy gold-text" style="font-size: 1.8rem;"></i>
          </div>
          <h4 style="font-size: 1.15rem; margin-bottom: 4px; color: #0f172a;">محمد عبدالمقصود  (تطور كتلة عضلية صافية)</h4>
          <span class="badge approved" style="margin-bottom: 12px;">بناء قوام V-Shape</span>
          <p class="text-muted" style="font-size: 0.9rem; line-height: 1.7;">"مدرب جميل وفاهم فعلا شغله كويس
ومش مجرد مدرب ده اخ فعلا وفعلا كان في تطور ملحوظ لما تابعت معاه."</p>
          <a href="#/success-stories" class="read-more">اقرأ المزيد <i class="fa-solid fa-arrow-left"></i></a>
        </div>
 
        <!-- كارت 3 -->
        <div class="glass-card" style="text-align: center; position: relative;">
          <div style="position: absolute; top: 12px; left: 12px; background: #fff1f2; border: 1px solid rgba(225, 29, 72, 0.2); padding: 3px 12px; border-radius: 20px; font-size: 0.75rem; color: var(--primary); font-weight: 700;">
            ⏳ دوام ومسؤوليات
          </div>
          <div style="width: 75px; height: 75px; margin: 15px auto; background: #fff1f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--primary);">
            <i class="fa-solid fa-clock gold-text" style="font-size: 1.8rem;"></i>
          </div>
          <h4 style="font-size: 1.15rem; margin-bottom: 4px; color: #0f172a;">يوسف محمد  (شغل 10 ساعات يومياً)</h4>
          <span class="badge approved" style="margin-bottom: 12px;">لياقة وصحة واستمرارية</span>
          <p class="text-muted" style="font-size: 0.9rem; line-height: 1.7;">"جسمي كان من نوع سريع الحرق جدا وكنت بعاني من اللزيادة العضلية دا غير شغلي المرهق كمان كان بيخلي اني ابني عضلات دا شبه مستحيل لغاية ما اتمرنت مع اخويا وصديقي عبدالرحيم وفعلا هو طورني جدا وفرق كبير بس مش بمحرد كلام بس بالنظام الي كان بيمشيه على يومي بالظبط."</p>
          <a href="#/success-stories" class="read-more">اقرأ المزيد <i class="fa-solid fa-arrow-left"></i></a>
        </div>
      </div>
    </section>
 
    <!-- شريط الدعوة للاشتراك -->
    <section class="cta-banner">
      <a href="#/payment" class="cta-action">
        <span class="cta-text">
          <strong>ابدأ رحلتك الآن</strong>
          <small>لأن أفضل وقت لبدء التغيير هو الآن</small>
        </span>
        <span class="cta-arrow"><i class="fa-solid fa-chevron-left"></i></span>
      </a>
      <div class="cta-features">
        <div class="cta-feature"><i class="fa-solid fa-award"></i><h4>خبرة +4 سنوات</h4><p>خبرة واحترافية في كل خطة</p></div>
        <div class="cta-feature"><i class="fa-solid fa-shield-halved"></i><h4>متابعة مستمرة</h4><p>دعم ومتابعة طوال رحلتك</p></div>
        <div class="cta-feature"><i class="fa-solid fa-dumbbell"></i><h4>خطط مخصصة</h4><p>حسب هدفك وظروف يومك</p></div>
        <div class="cta-feature"><i class="fa-solid fa-users"></i><h4>+100 متدرب</h4><p>أشخاص بنفس طموحك وصلوا لهدفهم</p></div>
      </div>
    </section>
 
    <!-- 4. خانة الفيديو التعريفي -->
    <section class="glass-card" style="margin: 55px 0; padding: 35px 20px; text-align: center;">
      <h3 class="gold-text" style="font-size: 1.8rem; margin-bottom: 8px;">
        <i class="fa-solid fa-circle-play"></i> اعرف إزاي هنبني خطتك من الصفر
      </h3>
      <p class="text-muted" style="max-width: 620px; margin: 0 auto 25px; font-size: 0.95rem;">
        دقيقة واحدة مع كابتن عبد الرحيم تشرح لك المنظومة التي ستنقل جسمك لمستوى جديد تماماً وتوفر عليك شهور من التجربة العشوائية.
      </p>
 
      <div id="videoContainer" style="max-width: 820px; margin: 0 auto; background: #0f172a; border: 2px solid rgba(225, 29, 72, 0.3); border-radius: 16px; overflow: hidden; aspect-ratio: 16/9; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; box-shadow: 0 12px 35px rgba(0,0,0,0.15);">
        <i class="fa-solid fa-circle-play gold-text" style="font-size: 4rem; opacity: 0.9; margin-bottom: 12px; cursor: pointer;"></i>
        <h4 style="color: #fff; font-size: 1.25rem; font-weight: 700;">فيديو الشرح التوجيهي — Coach Abdelrahim</h4>
        <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 6px;">[ مساحة مخصصة لفيديو الكابتن — سيتم إدراجه في أي وقت برابط يوتيوب أو فيديو مباشر ]</p>
      </div>
    </section>
 
    <!-- فاعليات وتحديات BodA -->
    <section id="events" style="margin: 55px 0;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h3 class="section-title"><i class="fa-solid fa-trophy"></i> فاعليات وتحديات BodA</h3>
        <p class="text-muted" style="max-width: 640px; margin: 8px auto 0;">مش بس جدول تمارين.. إحنا مجتمع كامل بيشجعك تكمّل. تحديات ولايفات ومسابقات بجوايز.</p>
      </div>
      <div class="grid-3 ev-grid">
        <div class="glass-card ev-card">
          <span class="ev-tag">الأكثر طلباً</span>
          <div class="ev-ico"><i class="fa-solid fa-calendar-check"></i></div>
          <h4>تحدي الـ 30 يوم</h4>
          <p class="text-muted">تمرين يومي + التزام غذائي + متابعة. كل يوم مهمة صغيرة، وفي الآخر شكل جديد تماماً.</p>
          <div class="ev-meta"><span><i class="fa-regular fa-clock"></i> 30 يوم</span><span><i class="fa-solid fa-medal"></i> جوايز للأكثر التزاماً</span></div>
          <a href="#/payment" class="btn-gold ev-btn">انضم للتحدي</a>
        </div>
        <div class="glass-card ev-card">
          <span class="ev-tag live">لايف أسبوعي</span>
          <div class="ev-ico"><i class="fa-solid fa-video"></i></div>
          <h4>لايف أسئلة وأجوبة مع الكابتن</h4>
          <p class="text-muted">اسأل كابتن عبد الرحيم في التمرين والتغذية والمكملات مباشرة، مرة كل أسبوع.</p>
          <div class="ev-meta"><span><i class="fa-regular fa-calendar"></i> كل أسبوع</span><span><i class="fa-brands fa-whatsapp"></i> للمشتركين</span></div>
          <a href="#/payment" class="btn-outline ev-btn">اشترك وانضم</a>
        </div>
        <div class="glass-card ev-card">
          <span class="ev-tag">جوايز</span>
          <div class="ev-ico"><i class="fa-solid fa-award"></i></div>
          <h4>مسابقة التحول الشهرية</h4>
          <p class="text-muted">ارفع صور تقدمك واكسب جوائز: اشتراك مجاني ومكملات وتيشيرتات BodA.</p>
          <div class="ev-meta"><span><i class="fa-solid fa-gift"></i> فائزين كل شهر</span><span><i class="fa-regular fa-calendar"></i> آخر كل شهر</span></div>
          <a href="#/success-stories" class="btn-outline ev-btn">شوف قصص النجاح</a>
        </div>
        <div class="glass-card ev-card">
          <span class="ev-tag">جديد</span>
          <div class="ev-ico"><i class="fa-solid fa-person-running"></i></div>
          <h4>تحدي الخطوات 10K</h4>
          <p class="text-muted">10,000 خطوة يومياً لمدة أسبوعين. أسهل بداية لحرق الدهون وبناء عادة ثابتة.</p>
          <div class="ev-meta"><span><i class="fa-regular fa-clock"></i> 14 يوم</span><span><i class="fa-solid fa-shoe-prints"></i> مناسب للجميع</span></div>
          <a href="#/payment" class="btn-outline ev-btn">ابدأ التحدي</a>
        </div>
        <div class="glass-card ev-card">
          <span class="ev-tag">أونلاين</span>
          <div class="ev-ico"><i class="fa-solid fa-dumbbell"></i></div>
          <h4>ورشة التكنيك الصحيح</h4>
          <p class="text-muted">ورشة مباشرة لتصحيح حركات التمرين الأساسية لتجنب الإصابات وتحسين النتائج.</p>
          <div class="ev-meta"><span><i class="fa-regular fa-calendar"></i> شهرياً</span><span><i class="fa-regular fa-clock"></i> ساعتين</span></div>
          <a href="#/payment" class="btn-outline ev-btn">احجز مقعد</a>
        </div>
        <div class="glass-card ev-card">
          <span class="ev-tag">مجتمع</span>
          <div class="ev-ico"><i class="fa-brands fa-whatsapp"></i></div>
          <h4>جروب الأبطال</h4>
          <p class="text-muted">مجتمع خاص للمشتركين: تحفيز يومي ومشاركة وجبات وإجابات سريعة من الفريق.</p>
          <div class="ev-meta"><span><i class="fa-solid fa-comments"></i> نشط يومياً</span></div>
          <a href="#/payment" class="btn-outline ev-btn">اشترك وانضم</a>
        </div>
      </div>
    </section>
 
    <!-- نبذة عن التمارين (بدون تفاصيل — التفاصيل للمشتركين) -->
    <section id="training-types" style="margin: 55px 0;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h3 class="section-title"><i class="fa-solid fa-dumbbell"></i> برنامجك متنوع.. ومش هتزهق</h3>
        <p class="text-muted" style="max-width: 640px; margin: 8px auto 0;">بعد الاشتراك بتفتح لك مكتبة تمارين كاملة متظبطة على هدفك ومكانك.</p>
      </div>
      <div class="grid-3 ev-grid">
        <div class="glass-card ev-card">
          <div class="ev-ico"><i class="fa-solid fa-dumbbell"></i></div>
          <h4>تمارين الجيم</h4>
          <p class="text-muted">برامج حديد مقسمة حسب العضلات والمستوى، لبناء الكتلة العضلية وتشكيل الجسم.</p>
          <span class="lock-pill"><i class="fa-solid fa-lock"></i> تفتح بعد الاشتراك</span>
        </div>
        <div class="glass-card ev-card">
          <div class="ev-ico"><i class="fa-solid fa-person-running"></i></div>
          <h4>تمارين اللياقة والفتنس</h4>
          <p class="text-muted">كارديو ولياقة عامة لحرق الدهون وتحسين التحمل والنشاط اليومي.</p>
          <span class="lock-pill"><i class="fa-solid fa-lock"></i> تفتح بعد الاشتراك</span>
        </div>
        <div class="glass-card ev-card">
          <div class="ev-ico"><i class="fa-solid fa-house"></i></div>
          <h4>تمارين منزلية</h4>
          <p class="text-muted">مش قادر تروح الجيم؟ جدول تقدر تعمله في البيت بأقل الأدوات.</p>
          <span class="lock-pill"><i class="fa-solid fa-lock"></i> تفتح بعد الاشتراك</span>
        </div>
      </div>
    </section>
 
    <!-- عرض أول أسبوعين مجاناً -->
    <section class="free-box" id="free-trial">
      <span class="free-badge"><i class="fa-solid fa-gift"></i> عرض خاص لكل مشترك جديد</span>
      <h2>أول <span>أسبوعين</span> مجاناً!</h2>
      <p>ابدأ رحلتك وجرّب المنظومة كاملة 14 يوم من غير ما تدفع. لو عجبتك كمّل، ولو لأ مفيش التزام.</p>
      <div class="free-steps">
        <div><i class="fa-solid fa-user-plus"></i><b>1. سجّل</b><span>اعمل حسابك في دقيقة</span></div>
        <div><i class="fa-solid fa-bolt"></i><b>2. فعّل التجربة</b><span>بضغطة واحدة من غير دفع</span></div>
        <div><i class="fa-solid fa-calendar-check"></i><b>3. جرّب 14 يوم</b><span>جدول التمارين والأنظمة الغذائية</span></div>
        <div><i class="fa-solid fa-circle-check"></i><b>4. قرّر</b><span>اشترك لو عجبتك، ولو لأ مفيش التزام</span></div>
      </div>
      <a href="#/free-trial" class="btn-gold hero-cta"><i class="fa-solid fa-bolt"></i> ابدأ أسبوعينك المجانيين</a>
      <small>* التجربة المجانية مرة واحدة لكل حساب.</small>
    </section>
 
    <!-- 5. باقات الاشتراك -->
    <section id="plans" style="margin: 60px 0;">
      <div style="text-align: center; margin-bottom: 40px;">
        <h2 class="gradient-text" style="font-size: 2.3rem; font-weight: 900;">اختر مستوى المتابعة المناسب لهدفك</h2>
        <p class="text-muted">استثمارك يبدأ بخطة مدروسة.. بدون اشتراكات معقدة ولا شروط خفية</p>
      </div>
 
      <div class="grid-3 plans-grid" style="max-width: 1180px; margin: 0 auto; align-items: stretch;">
        <!-- باقة 300 جنيه (الأساسية) -->
        <div class="glass-card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="margin-bottom: 15px;">
              <h3 style="color: #0f172a; font-size: 1.5rem; font-weight: 800;">الباقة الأساسية (Standard)</h3>
              <p class="text-muted" style="font-size: 0.9rem;">مناسبة للمتدرب اللي عايز خطة علمية واضحة ويمشي عليها بتوجيه أسبوعي منظم.</p>
            </div>
            <div style="margin: 20px 0; padding: 15px; background: #f1f5f9; border-radius: 10px;">
              <span style="font-size: 2.3rem; font-weight: 900; color: #0f172a;">300</span>
              <span class="gold-text" style="font-weight: 700;">جنيه مصري / شهرياً</span>
            </div>
            <ul style="list-style: none; padding: 0; margin-bottom: 25px;">
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #1e293b;"><i class="fa-solid fa-check gold-text"></i> جدول تمرين 6 أيام مصمم لمستواك بالكامل</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #1e293b;"><i class="fa-solid fa-check gold-text"></i> نظام غذائي مخصص محسوب السعرات والجرامات</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #1e293b;"><i class="fa-solid fa-check gold-text"></i> فتح بنك وصفات الشوفان وبدائل الوجبات</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #1e293b;"><i class="fa-solid fa-check gold-text"></i> متابعة أسبوعية لتقييم الميزان والصور والقياسات</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #94a3b8;"><i class="fa-solid fa-xmark"></i> متابعة يومية وتصحيح التكنيك بالفيديو</li>
            </ul>
          </div>
          <a href="#/payment" onclick="localStorage.setItem('selectedPlan', 'standard')" class="btn-outline" style="width: 100%; text-align: center; padding: 12px;">اشترك في الباقة الأساسية (300 ج)</a>
        </div>
 
        <!-- باقة VIP بـ 450 جنيه -->
        <div class="glass-card" style="display: flex; flex-direction: column; justify-content: space-between; border: 2px solid var(--primary) !important; position: relative; box-shadow: 0 12px 30px rgba(225, 29, 72, 0.12) !important;">
          <div style="position: absolute; top: -14px; right: 20px; background: var(--primary-gradient); color: #ffffff; font-weight: 800; padding: 4px 16px; border-radius: 20px; font-size: 0.8rem; box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);">
            🔥 اهتمام لصيق ونخبة الأبطال
          </div>
          <div>
            <div style="margin-bottom: 15px; margin-top: 10px;">
              <h3 class="gold-text" style="font-size: 1.6rem; font-weight: 900;"><i class="fa-solid fa-crown"></i> باقة VIP الخاصة (Elite Coaching)</h3>
              <p class="text-muted" style="font-size: 0.9rem;">أعلى درجات المتابعة والاهتمام الشخصي.. الكابتن يتابع كل عدّة وتفصيلة في يومك.</p>
            </div>
            <div style="margin: 20px 0; padding: 15px; background: #fff1f2; border-radius: 10px; border: 1px solid rgba(225, 29, 72, 0.2);">
              <span style="font-size: 2.5rem; font-weight: 900;" class="gradient-text">450</span>
              <span class="gold-text" style="font-weight: 700;">جنيه مصري / شهرياً</span>
            </div>
            <ul style="list-style: none; padding: 0; margin-bottom: 25px;">
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>كل مميزات الباقة الأساسية كاملة</strong></li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>متابعة دورية شبه يومية</strong> واهتمام مكثف عبر واتساب</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>تحليل وتصحيح التكنيك بالفيديو:</strong> تصور تمارينك ونصحح لك الزوايا</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>مرونة وتعديل فوري للدايت:</strong> في السفر أو العزومات نحسب لك البدائل فوراً</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>أولوية الرد السريع المباشر</strong> من كابتن عبد الرحيم شخصياً</li>
            </ul>
          </div>
          <a href="#/payment" onclick="localStorage.setItem('selectedPlan', 'vip')" class="btn-gold" style="width: 100%; text-align: center; padding: 14px; font-size: 1.05rem;">
  <i class="fa-solid fa-crown"></i> انضم لباقة VIP الآن (450 ج)
</a>
        </div>
 
        ${renderProMaxCard()}
      </div>
    </section>
  `;
}
function renderProMaxCard() {
  return `
        <!-- باقة 3 برو ماكس: 3 شهور بمميزات VIP -->
        <div class="glass-card promax-card" style="display: flex; flex-direction: column; justify-content: space-between; position: relative;">
          <div class="promax-ribbon">💎 أوفر باقة — وفّر 600 جنيه</div>
          <div>
            <div style="margin-bottom: 15px; margin-top: 10px;">
              <h3 class="gold-text" style="font-size: 1.6rem; font-weight: 900;"><i class="fa-solid fa-gem"></i> باقة 3 برو ماكس</h3>
              <p class="text-muted" style="font-size: 0.9rem;">التزام 3 شهور كاملين بمميزات VIP بسعر أقل. الوقت ده كفاية تشوف جسمك بيتغيّر فعلاً.</p>
            </div>
            <div class="promax-price">
              <span style="font-size: 2.5rem; font-weight: 900;" class="gradient-text">750</span>
              <span class="gold-text" style="font-weight: 700;">جنيه مصري / 3 شهور</span>
              <small>يعني 250 جنيه بس في الشهر</small>
            </div>
            <ul style="list-style: none; padding: 0; margin-bottom: 25px;">
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>كل مميزات باقة VIP كاملة</strong></li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>متابعة شبه يومية</strong> واهتمام مكثف عبر واتساب</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>تصحيح التكنيك بالفيديو</strong> وتعديل فوري للدايت</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>أولوية الرد السريع</strong> من كابتن عبد الرحيم شخصياً</li>
              <li style="margin-bottom: 12px; font-size: 0.95rem; color: #0f172a;"><i class="fa-solid fa-check gold-text"></i> <strong>دفعة واحدة لمدة 3 شهور</strong> من غير تجديد كل شهر</li>
            </ul>
          </div>
          <a href="#/payment" onclick="localStorage.setItem('selectedPlan', 'promax')" class="btn-gold" style="width: 100%; text-align: center; padding: 14px; font-size: 1.05rem;">
            <i class="fa-solid fa-gem"></i> انضم لباقة 3 برو ماكس (750 ج)
          </a>
        </div>`;
}
 
function renderAboutPage() {
  return `
    <div class="glass-card" style="max-width: 850px; margin: 0 auto;">
      <h2 class="gold-text">من نحن؟</h2>
      <p style="font-size: 1.15rem; margin: 15px 0;">نحن نؤمن أن بناء الجسم لا يعتمد على التمرين العشوائي، بل على نظام متكامل يجمع بين التدريب، التغذية، والمتابعة الذهنية والاستمرارية.</p>
      <hr style="border-color: var(--border-primary); margin: 20px 0;">
      <div class="grid-2">
        <div>
          <h4 class="gold-text">رؤيتنا</h4>
          <p>تحويل الرياضة إلى أسلوب حياة مستدام لكل متدرب بدلاً من الحميات القاسية المؤقتة.</p>
        </div>
        <div>
          <h4 class="gold-text">منهجنا</h4>
          <p>التدريب الذكي والتطور التدريجي في الأوزان والأداء لضمان الحفاظ على المفاصل وبناء العضلات بكفاءة.</p>
        </div>
      </div>
    </div>
  `;
}
 
function renderTeamPage() {
  return `
    <div style="text-align: center; margin-bottom: 40px;">
      <h2 class="gradient-text">الكابتن والفريق التدريبي</h2>
      <p class="text-muted">نخبة متخصصة تتابع تفاصيل تدريبك وتغذيتك</p>
    </div>
    <div class="grid-2">
      <div class="glass-card" style="text-align: center;">
        <i class="fa-solid fa-medal gold-text" style="font-size: 3.5rem; margin-bottom: 15px;"></i>
        <h3 class="gold-text">Coach Abdelrahim</h3>
        <p style="font-weight: 700; margin-bottom: 10px;">المؤسس والمدرب الرئيسي</p>
        <p class="text-muted">خبرة +4 سنوات في إعداد الأجسام، تأهيل المتدربين، وتصميم البرامج التدريبية المقاومة للإصابات.</p>
      </div>
      <div class="glass-card" style="text-align: center;">
        <i class="fa-solid fa-heart-pulse gold-text" style="font-size: 3.5rem; margin-bottom: 15px;"></i>
        <h3 class="gold-text">فريق الدعم والمتابعة</h3>
        <p style="font-weight: 700; margin-bottom: 10px;">متابعة الأداء والتغذية</p>
        <p class="text-muted">فريق متكامل لتدقيق سجلات الأوزان وتحديث السعرات ومساعدة المتدربين يوميًا عبر الواتساب.</p>
      </div>
    </div>
  `;
}
 
function renderHowItWorksPage() {
  const steps = [
    "إنشاء الحساب على المنصة",
    "اختيار الباقة (300 جنيه الأساسية أو 450 جنيه VIP أو 750 جنيه لباقة 3 برو ماكس) وسداد قيمتها",
    "إرسال إثبات الدفع ورقم المعاملة",
    "مراجعة الإدارة وتفعيل الحساب فورًا",
    "ملء استمارة القياسات والهدف والمستوى",
    "استلام جدول التمرين التفصيلي (6 أيام)",
    "استلام الخطة الغذائية وبدائل الوجبات",
    "بدء المتابعة الأسبوعية وتسجيل الأوزان"
  ];
  return `
    <h2 class="gold-text" style="text-align: center; margin-bottom: 30px;">كيف تعمل المتابعة؟ (رحلة المتدرب)</h2>
    <div class="timeline">
      ${steps.map((step, idx) => `
        <div class="timeline-item glass-card">
          <div class="timeline-badge">${idx + 1}</div>
          <div>
            <h4>${step}</h4>
            <p class="text-muted">خطوة مدروسة تضمن وصولك لهدفك بأعلى درجات الالتزام والدقة.</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
 
function renderServicesPage() {
  return `
    <h2 class="gradient-text" style="text-align: center; margin-bottom: 30px;">خدمات منصة BodA</h2>
    <div class="grid-3">
      <div class="glass-card">
        <h3 class="gold-text">متابعة أونلاين شاملة</h3>
        <p>تواصل وتوجيه مباشر أسبوعياً لمتابعة النتيجة أولاً بأول.</p>
        <a href="#/register" onclick="subscribeCta(event)" class="btn-gold" style="margin-top: 15px;">اشترك الآن</a>
      </div>
      <div class="glass-card">
        <h3 class="gold-text">جدول تمارين 6 أيام</h3>
        <p>تقسيم احترافي لجميع العضلات مع تحديد المجموعات والتكرارات وفترات الراحة.</p>
        <a href="#/register" onclick="subscribeCta(event)" class="btn-gold" style="margin-top: 15px;">اشترك الآن</a>
      </div>
      <div class="glass-card">
        <h3 class="gold-text">نظام غذائي مرن</h3>
        <p>سعرات محسوبة وفق وزنك ونشاطك اليومي مع وصفات عملية للشوفان والبروتين.</p>
        <a href="#/register" onclick="subscribeCta(event)" class="btn-gold" style="margin-top: 15px;">اشترك الآن</a>
      </div>
    </div>
  `;
}
 
function renderSuccessStoriesPage() {
  return `
    <h2 class="gold-text" style="text-align: center; margin-bottom: 10px;">قصص وتجارب المتدربين</h2>
    <p style="text-align: center; color: var(--text-muted); margin-bottom: 40px;">نتائج حقيقية بفضل الاستمرارية والالتزام بالمنظومة</p>
    <div class="grid-2">
      <div class="glass-card">
        <h4 class="gold-text">محمد هاني (تنشيف ونحت عضلات)</h4>
        <p>"التزامي بنظام كابتن عبد الرحيم ساعدني في خسارة 9 كيلو دهون مع الحفاظ على الكتلة العضلية بدون حرمان أو تعب مفرط."</p>
      </div>
      <div class="glass-card">
        <h4 class="gold-text">عمر سامي (ضخامة نظيفة)</h4>
        <p>"جدول تمرين الدراع والظهر فارق جداً في قوتي بالأوزان، المتابعة الأسبوعية خلتني استمر ومكسلش زي المرات اللي فاتت."</p>
      </div>
    </div>
  `;
}
 
function renderBlogPage() {
  return `
    <h2 class="gold-text" style="text-align: center; margin-bottom: 30px;">مدونة اللياقة البدنية</h2>
    <div class="glass-card" style="max-width: 800px; margin: 0 auto 20px;">
      <span class="badge" style="background: var(--primary); color: #fff;">مقال خاص</span>
      <h3 style="margin: 10px 0;">الموز وفول السوداني أم مكمل الطاقة (Pre-Workout)؟</h3>
      <p>مقارنة شاملة بين الاعتماد على الطاقة الطبيعية ومكملات الباور الصناعية. كابتن عبد الرحيم يوصي دائماً بوجبة غنية بالكارب المعقد قبل التمرين بساعتين كخيار أول للمبتدئين والمتوسطين.</p>
    </div>
  `;
}
 
function renderFaqPage() {
  return `
    <h2 class="gold-text" style="text-align: center; margin-bottom: 30px;">الأسئلة الشائعة</h2>
    <div style="max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 15px;">
      <div class="glass-card">
        <h4>متى يتم تفعيل حسابي بعد الدفع؟</h4>
        <p class="text-muted">فور تحويل الرسوم وإدخال رقم المعاملة، يقوم الكابتن أو فريق المراجعة بتأكيد الدفع خلال وقت وجيز وفتح جميع البرامج فوراً.</p>
      </div>
      <div class="glass-card">
        <h4>هل البرنامج مناسب للمبتدئين في الجيم؟</h4>
        <p class="text-muted">نعم، التمارين مشروحة بأسماء الحركات المعتمدة ومصنفة لتناسب جميع المستويات مع إمكانية التعديل حسب المتاح في صالتك الرياضية.</p>
      </div>
    </div>
  `;
}
 
function renderContactPage() {
  return `
    <div class="glass-card" style="max-width: 650px; margin: 0 auto;">
      <h2 class="gold-text" style="text-align: center; margin-bottom: 10px;">تواصل مع الكابتن مباشرة</h2>
      <p class="text-muted" style="text-align: center; margin-bottom: 25px;">اختر المنصة المناسبة لك للتواصل والمتابعة اليومية</p>
      
      <!-- أزرار منصات التواصل الاجتماعي -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 30px;">
        <a href="https://wa.me/201207908662" target="_blank" class="btn-outline" style="text-align: center; border-color: #25D366; color: #25D366;">
          <i class="fa-brands fa-whatsapp" style="font-size: 1.3rem; display: block; margin-bottom: 5px;"></i> واتساب
        </a>
        <a href="https://instagram.com/abdalrahem701" target="_blank" class="btn-outline" style="text-align: center; border-color: #E1306C; color: #E1306C;">
          <i class="fa-brands fa-instagram" style="font-size: 1.3rem; display: block; margin-bottom: 5px;"></i> إنستجرام
        </a>
        <a href="https://www.facebook.com/share/1FEXErFAzi/" target="_blank" class="btn-outline" style="text-align: center; border-color: #1877F2; color: #1877F2;">
          <i class="fa-brands fa-facebook" style="font-size: 1.3rem; display: block; margin-bottom: 5px;"></i> فيسبوك
        </a>
      </div>
 
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin-bottom: 25px;">
 
      <h3 class="gold-text" style="font-size: 1.1rem; margin-bottom: 15px;">أو اترك رسالة سريعة للكابتن:</h3>
      <form onsubmit="handleContactSubmit(event)">
        <div class="form-group">
          <label>الاسم</label>
          <input type="text" id="contactName" required placeholder="أدخل اسمك">
        </div>
        <div class="form-group">
          <label>رقم الواتساب</label>
          <input type="tel" id="contactPhone" required placeholder="01xxxxxxxxx">
        </div>
        <div class="form-group">
          <label>رسالتك أو استفسارك</label>
          <textarea rows="4" id="contactMsg" required placeholder="اكتب سؤالك بخصوص التمرين أو التغذية..."></textarea>
        </div>
        <button type="submit" class="btn-gold" style="width: 100%;">إرسال الرسالة</button>
      </form>
    </div>
  `;
}
 
// --- 4. تسجيل الدخول وبوابة الدفع (Auth & Subscription) ---
 
function renderLoginPage() {
  return `
    <div class="glass-card" style="max-width: 450px; margin: 40px auto;">
      <h2 class="gold-text" style="text-align: center; margin-bottom: 20px;">تسجيل الدخول</h2>
      <form onsubmit="handleLoginSubmit(event)">
        <div class="form-group">
          <label>البريد الإلكتروني</label>
          <input type="email" id="loginEmail" required placeholder="name@example.com">
        </div>
        <div class="form-group">
          <label>كلمة المرور</label>
          <input type="password" id="loginPassword" required placeholder="••••••••">
        </div>
        <button type="submit" class="btn-gold" style="width: 100%;">دخول للمنصة</button>
        <p style="text-align: center; margin-top: 12px; font-size: 0.9rem;">
          <a href="#" onclick="event.preventDefault(); handleForgotPassword();" class="gold-text">نسيت كلمة المرور؟</a>
        </p>
      </form>
      <p style="text-align: center; margin-top: 15px; font-size: 0.9rem;">
        ليس لديك حساب؟ <a href="#/register" class="gold-text">إنشاء حساب جديد</a>
      </p>
    </div>
  `;
}
 
// معالجة الدخول: تفرقة الكابتن عن العميل العادي
async function handleLoginSubmit(e) {
  e.preventDefault();
  if (!requireFirebase()) return;
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged هيحمّل البيانات ويوجّهك للصفحة المناسبة
  } catch (err) {
    alert(authErrorMessage(err));
  }
}
 
// نسيت كلمة المرور: Firebase يبعت إيميل فيه رابط تغيير كلمة المرور
async function handleForgotPassword() {
  if (!requireFirebase()) return;
  const field = document.getElementById('loginEmail');
  let email = field ? field.value.trim() : '';
  if (!email) email = (prompt('اكتب بريدك الإلكتروني وهنبعتلك رابط تغيير كلمة المرور:') || '').trim();
  if (!email) return;
  try {
    await auth.sendPasswordResetEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      alert(authErrorMessage(err));
      return;
    }
  }
  // نفس الرسالة سواء البريد موجود أو لأ (عشان ما نكشفش مين مسجل)
  alert('لو البريد ده مسجل عندنا، هيوصلك رابط تغيير كلمة المرور خلال دقائق. راجع مجلد Spam كمان.');
}
 
// ==================== 1. صفحة إنشاء حساب جديد ====================
function renderRegisterPage() {
  return `
    <div class="glass-card" style="max-width: 580px; margin: 40px auto; padding: 35px;">
      <div style="text-align: center; margin-bottom: 25px;">
        <span style="background: #fff1f2; color: var(--primary); font-size: 0.85rem; font-weight: 800; padding: 6px 16px; border-radius: 20px; display: inline-block; margin-bottom: 10px;">
          انطلاقة جديدة 🔥
        </span>
        <h2 style="color: #0f172a; font-size: 1.8rem; font-weight: 900;">انضم إلى أبطال BodA</h2>
        <p class="text-muted" style="font-size: 0.95rem;">سجل بياناتك للبدء في تصميم برنامجك التدريبي والغذائي الخاص</p>
      </div>
 
      <form onsubmit="handleRegistrationStep1(event)">
        <!-- الاسم بالكامل -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 6px;">الاسم بالكامل</label>
          <input type="text" id="regFullName" required placeholder="مثال: خالد سلامة " style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
        </div>
 
        <!-- اسم المستخدم -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 6px;">اسم المستخدم (Username)</label>
          <input type="text" id="regUsername" required placeholder="abdo_fit" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
        </div>
 
        <!-- البريد الإلكتروني -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 6px;">البريد الإلكتروني</label>
          <input type="email" id="regEmail" required placeholder="name@example.com" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
        </div>
 
        <!-- كلمة المرور -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 6px;">كلمة المرور</label>
          <input type="password" id="regPassword" required placeholder="••••••••" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
        </div>
 
        <!-- صورة شخصية اختيارية -->
        <div class="form-group" style="margin-bottom: 24px;">
          <label style="display: block; font-weight: 700; color: #334155; margin-bottom: 6px;">الصورة الشخصية (اختياري)</label>
          <input type="file" id="regAvatar" accept="image/*" style="width: 100%; padding: 10px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
        </div>
 
        <button type="submit" class="btn-gold" style="width: 100%; padding: 14px; font-size: 1.1rem; border-radius: 10px; font-weight: 800;">
          Create Account & Start Journey 🚀
        </button>
      </form>
 
      <p style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: #64748b;">
        لديك حساب بالفعل؟ <a href="#/login" style="color: var(--primary); font-weight: 700;">تسجيل الدخول</a>
      </p>
    </div>
  `;
}
 
// معالجة الخطوة الأولى وحفظ البيانات
async function handleRegistrationStep1(e) {
  e.preventDefault();
  if (!requireFirebase()) return;
  const fullName = document.getElementById('regFullName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const avatarInput = document.getElementById('regAvatar');
  const btn = e.target && e.target.querySelector ? e.target.querySelector('button[type="submit"]') : null;
 
  if (password.length < 8) {
    alert('كلمة المرور لازم تكون 8 أحرف على الأقل.');
    return;
  }
  if (btn) btn.disabled = true;
 
  const avatarUrl = await new Promise(resolve => {
    if (avatarInput && avatarInput.files && avatarInput.files[0]) resizeImage(avatarInput.files[0], 250, resolve);
    else resolve(null);
  });
 
  state.suppressAuth = true; // نمنع المستمع من تحميل بيانات قبل ما نكتب الملف
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const profile = {
      name: fullName,
      username: username,
      email: email,
      avatar: avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
      profileCompletion: 20,
      goal: '',
      experience: '',
      trainingDays: 4,
      location: '',
      equipments: [],
      trainingStyle: '',
      startDate: new Date().toISOString(),
      daysTotal: 30,
      coachRating: 5,
      coachFeedback: 'مرحباً بك في الفريق! أتمم بيانات برنامجك لنبدأ فوراً.',
      checkIns: 0,
      currentWeight: 80,
      targetWeight: 75,
      status: 'pending',
      plan: '',
      price: 0
    };
    await db.collection('users').doc(cred.user.uid).set(profile);
    state.profile = profile;
    state.currentUser = { uid: cred.user.uid, name: fullName, email: email, role: 'pending', plan: '' };
    state.suppressAuth = false;
    updateNav();
    showWelcomeScreen(fullName);
  } catch (err) {
    state.suppressAuth = false;
    console.error(err);
    alert(authErrorMessage(err));
    if (auth.currentUser) {
      try { await applyAuthUser(auth.currentUser); } catch (e2) { /* ignore */ }
      updateNav();
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
 
// ==================== 2. شاشة الترحيب الحماسية والتحفيزية ====================
function showWelcomeScreen(name) {
  document.getElementById('app').innerHTML = renderWelcomeHtml(name);
}
 
function renderWelcomeHtml(name) {
  name = escapeHtml(name);
  return `
    <div class="glass-card" style="max-width: 650px; margin: 50px auto; padding: 45px; text-align: center; animation: fadeIn 0.5s ease-in-out;">
      <div style="font-size: 3.5rem; margin-bottom: 10px;">🔥</div>
      <h1 style="color: #0f172a; font-size: 2.2rem; font-weight: 900; letter-spacing: -0.5px; text-transform: uppercase;">
        WELCOME, ${name}
      </h1>
      <p style="font-size: 1.25rem; font-weight: 700; color: var(--primary); margin-bottom: 8px;">
        Your journey starts today.
      </p>
      <p style="color: #64748b; font-size: 1rem; margin-bottom: 30px;">
        Let's build your customized plan with Coach Abdelrahim.
      </p>
 
      <!-- كارت اكتمال البروفايل (20%) -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; margin-bottom: 30px; text-align: right;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: 800; color: #0f172a; font-size: 0.95rem;">YOUR PROFILE</span>
          <span style="font-weight: 900; color: var(--primary); font-size: 1.1rem;">20% COMPLETE</span>
        </div>
        <div style="width: 100%; height: 10px; background: #e2e8f0; border-radius: 10px; overflow: hidden;">
          <div style="width: 20%; height: 100%; background: var(--primary-gradient); border-radius: 10px;"></div>
        </div>
        <p style="color: #64748b; font-size: 0.85rem; margin-top: 10px;">
          أجب عن بضعة أسئلة بسيطة (الهدف، المعدات، المستوى) لإكمال ملفك وفتح الداشبورد المخصصة لك بالكامل.
        </p>
      </div>
 
      <button onclick="renderOnboardingStep()" class="btn-gold" style="width: 100%; padding: 15px; font-size: 1.15rem; font-weight: 800; border-radius: 10px;">
        Let's Build Your Plan ➔
      </button>
    </div>
  `;
}
// ==================== 3. استبيان تخصيص الخطة (Onboarding) ====================
function renderOnboardingStep() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="glass-card" style="max-width: 780px; margin: 30px auto; padding: 35px;">
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
        <h2 style="color: #0f172a; font-size: 1.6rem; font-weight: 900;">
          <i class="fa-solid fa-bullseye" style="color: var(--primary);"></i> تخصيص خطتك التدريبية
        </h2>
        <span style="background: #fff1f2; color: var(--primary); font-weight: 800; padding: 4px 14px; border-radius: 12px; font-size: 0.85rem;">الخطوة الأخيرة (80%)</span>
      </div>
 
      <form onsubmit="handleOnboardingSubmit(event)">
        
        <!-- 1. الهدف من التدريب -->
        <div style="margin-bottom: 25px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">1. ما هو هدفك الأساسي؟ 🎯</label>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;">
            ${['بناء عضلات (Hypertrophy)', 'زيادة القوة البدنية', 'خسارة دهون وتنشيف', 'تحسين اللياقة العامة', 'تحسين الأداء الرياضي', 'الالتزام بنظام صحي'].map((g, i) => `
              <label style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: #f8fafc; font-size: 0.9rem; font-weight: 700;">
                <input type="radio" name="userGoal" value="${g}" ${i===0?'checked':''}>${g}
              </label>
            `).join('')}
          </div>
        </div>
 
        <!-- 2. مستوى الخبرة -->
        <div style="margin-bottom: 25px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">2. مستوى خبرتك في الجيم 🏋️</label>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
            ${['مبتدئ (أقل من 6 شهور)', 'متوسط (من سنة لـ سنتين)', 'متقدم (أكثر من 3 سنوات)'].map((exp, i) => `
              <label style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; background: #f8fafc; font-size: 0.9rem; font-weight: 700;">
                <input type="radio" name="userExp" value="${exp}" ${i===0?'checked':''}>
                <div style="margin-top: 4px;">${exp}</div>
              </label>
            `).join('')}
          </div>
        </div>
 
        <!-- 3. عدد أيام التمرين -->
        <div style="margin-bottom: 25px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">3. كم يوم متاح للتمرين أسبوعياً؟ 🗓️</label>
          <div style="display: flex; gap: 10px; justify-content: space-between; flex-wrap: wrap;">
            ${[2, 3, 4, 5, 6].map((days, i) => `
              <label style="flex: 1; min-width: 60px; border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; background: #f8fafc; font-weight: 800;">
                <input type="radio" name="userDays" value="${days}" ${days===4?'checked':''}>
                <div>${days} أيام</div>
              </label>
            `).join('')}
          </div>
        </div>
 
        <!-- 4. مكان التدريب -->
        <div style="margin-bottom: 25px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">4. أين ستتدرب؟ 📍</label>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
            <label style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; background: #f8fafc; font-weight: 700;">
              <input type="radio" name="userLocation" value="Gym" checked> 🏋️ الجيم (Gym)
            </label>
            <label style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; background: #f8fafc; font-weight: 700;">
              <input type="radio" name="userLocation" value="Home"> 🏠 المنزل (Home)
            </label>
            <label style="border: 1px solid #cbd5e1; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; background: #f8fafc; font-weight: 700;">
              <input type="radio" name="userLocation" value="Mixed"> 🌐 ميكس (Gym & Home)
            </label>
          </div>
        </div>
 
        <!-- 5. المعدات المتاحة -->
        <div style="margin-bottom: 25px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">5. المعدات المتاحة لديك ⚙️ (يمكنك اختيار أكثر من واحدة)</label>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
            ${['Full Gym (جيم متكامل)', 'Dumbbells', 'Barbell', 'Machines', 'Resistance Bands', 'Bodyweight (وزن الجسم)'].map(eq => `
              <label style="border: 1px solid #cbd5e1; padding: 10px; border-radius: 8px; cursor: pointer; background: #f8fafc; font-size: 0.85rem; font-weight: 700;">
                <input type="checkbox" name="userEquip" value="${eq}"> ${eq}
              </label>
            `).join('')}
          </div>
        </div>
 
        <!-- 6. أسلوب التدريب المفضل -->
        <div style="margin-bottom: 30px;">
          <label style="display: block; font-weight: 800; color: #0f172a; margin-bottom: 10px;">6. أسلوب التدريب المفضل لك ⚡</label>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
            ${['Hypertrophy (ضخامة عضلية)', 'Strength (أوزان وقوة)', 'Cardio & HIIT', 'Functional Training', 'Mixed'].map((st, i) => `
              <label style="border: 1px solid #cbd5e1; padding: 10px; border-radius: 8px; cursor: pointer; background: #f8fafc; font-size: 0.85rem; font-weight: 700;">
                <input type="radio" name="userStyle" value="${st}" ${i===0?'checked':''}>${st}
              </label>
            `).join('')}
          </div>
        </div>
 
        <button type="submit" class="btn-gold" style="width: 100%; padding: 16px; font-size: 1.15rem; font-weight: 800; border-radius: 12px;">
          <i class="fa-solid fa-unlock-keyhole"></i> فتح لوحة المتابعة الكاملة (100% Complete)
        </button>
      </form>
    </div>
  `;
}
 
// حفظ اختيارات الاستبيان وفتح الداشبورد
async function handleOnboardingSubmit(e) {
  e.preventDefault();
  if (!state.currentUser || !state.profile) {
    window.location.hash = '#/login';
    return;
  }
  const equip = Array.from(document.querySelectorAll('input[name="userEquip"]:checked')).map(el => el.value);
  const updates = {
    goal: document.querySelector('input[name="userGoal"]:checked')?.value || 'بناء عضلات',
    experience: document.querySelector('input[name="userExp"]:checked')?.value || 'مبتدئ',
    trainingDays: Number(document.querySelector('input[name="userDays"]:checked')?.value) || 4,
    location: document.querySelector('input[name="userLocation"]:checked')?.value || 'Gym',
    equipments: equip.length > 0 ? equip : ['Full Gym'],
    trainingStyle: document.querySelector('input[name="userStyle"]:checked')?.value || 'Hypertrophy',
    profileCompletion: 100
  };
  try {
    await db.collection('users').doc(state.currentUser.uid).update(updates);
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في حفظ بياناتك، جرّب تاني.');
    return;
  }
  Object.assign(state.profile, updates);
  alert('عاش يا بطل! تم تجهيز ملفك بنسبة 100%.');
  window.location.hash = postAuthTarget();
}
 
// ==================== 4. الداشبورد الشاملة للمتدرب ====================
function renderDashboardPage() {
  const profile = Object.assign({
    name: 'عبد الرحيم',
    username: 'abdo_fit',
    goal: 'بناء عضلات (Hypertrophy)',
    trainingDays: 4,
    location: 'Gym',
    coachRating: 5.0,
    coachFeedback: 'التزامك رائع الأسبوع ده، زوّد وزن تمرين الـ Bench Press المرة الجاية 2.5 كجم!',
    checkIns: 12,
    currentWeight: 82.5,
    targetWeight: 76.0,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80'
  }, state.profile || {});
 
  // تمارين الأسبوع بتتفتح للمشترك المفعّل فقط (زي صفحة التمارين)
  const weekLocked = !(state.currentUser && (state.currentUser.role === 'approved' || state.currentUser.role === 'admin'));
 
  // بانر حالة الاشتراك: تجربة شغالة / تجربة انتهت / غير مفعّل
  const trial = trialInfo(profile);
  const sub = subscriptionInfo(state.profile || {});
  let statusBanner = '';
  if (state.currentUser && state.currentUser.trial) {
    statusBanner = `
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span><i class="fa-solid fa-gift"></i> تجربتك المجانية شغالة — باقي <strong>${trial.daysLeft}</strong> يوم. كل البرامج مفتوحة لك.</span>
          <a href="#/payment" class="btn-gold" style="padding: 8px 18px; font-size: 0.9rem;">اشترك علشان تكمّل</a>
        </div>`;
  } else if (state.currentUser && state.currentUser.role === 'pending') {
    statusBanner = `
        <div style="background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span><i class="fa-solid fa-circle-info"></i> ${sub.expired ? 'اشتراكك انتهى' + (sub.end ? ' بتاريخ ' + new Date(sub.end).toLocaleDateString('ar-EG') : '') + '. جدّد اشتراكك علشان تكمّل وتفتح كل البرامج.' : trial.used
            ? 'تجربتك المجانية خلصت. اشترك علشان تكمّل وتفتح كل البرامج.'
            : 'اشتراكك لسه مش مفعّل. ابدأ تجربتك المجانية 14 يوم، أو أتمم الاشتراك وهتتفتح لك كل البرامج.'}</span>
          <span style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${trial.used ? '' : '<a href="#/free-trial" class="btn-gold" style="padding: 8px 18px; font-size: 0.9rem;"><i class="fa-solid fa-gift"></i> ابدأ التجربة المجانية</a>'}
            <a href="#/payment" class="${trial.used ? 'btn-gold' : 'btn-outline'}" style="padding: 8px 18px; font-size: 0.9rem;">إتمام الاشتراك</a>
          </span>
        </div>`;
  }
 
  // لو حسابه لسه 20% ولم يكمل الاستبيان يتم تحويله للـ Onboarding
  if (profile.profileCompletion && profile.profileCompletion < 100) {
    return renderWelcomeHtml(profile.name);
  }
 
  return `
    <div style="max-width: 1200px; margin: 30px auto; padding: 15px;">
      ${statusBanner}${subscriptionBanner(sub)}
      
      <!-- ترويسة الداشبورد والترحيب بالبطل -->
      <div class="glass-card" style="padding: 25px; margin-bottom: 25px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px;">
        <div style="display: flex; align-items: center; gap: 18px;">
          <div style="position: relative; display: inline-block; cursor: pointer;" onclick="triggerAvatarUpload()" title="اضغط لتغيير الصورة الشخصية">
            <img id="dashboardUserAvatar" src="${escapeHtml(profile.avatar)}" alt="Avatar" style="width: 85px; height: 85px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary); display: block;">
            <div style="position: absolute; bottom: 0; right: 0; background: var(--primary); color: #ffffff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">
              <i class="fa-solid fa-camera"></i>
            </div>
          </div>
          <input type="file" id="dashboardAvatarInput" accept="image/*" style="display: none;" onchange="handleDashboardAvatarChange(event)">
          <div>
            <h2 style="color: #0f172a; font-size: 1.6rem; font-weight: 900; margin-bottom: 4px;">Welcome back, ${escapeHtml(profile.name)}! 🔥</h2>
            <div style="display: flex; gap: 10px; font-size: 0.85rem; color: #64748b; flex-wrap: wrap;">
              <span><i class="fa-solid fa-bullseye" style="color: var(--primary);"></i> ${escapeHtml(profile.goal)}</span>
              <span>•</span>
              <span><i class="fa-solid fa-calendar-days"></i> ${profile.trainingDays} أيام أسبوعياً</span>
              <span>•</span>
              <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(profile.location)}</span>
            </div>
          </div>
        </div>
 
        <button onclick="traineeDailyCheckIn()" class="btn-gold" style="padding: 12px 24px; font-size: 1rem; border-radius: 10px;">
          <i class="fa-solid fa-dumbbell"></i> تسجيل حضور اليوم (${profile.checkIns} يوم 🔥)
        </button>
      </div>
 
      <!-- تبويبات الداشبورد (Navigation Tabs) -->
      <div class="dash-grid" style="display: grid; grid-template-columns: 2fr 1fr; gap: 25px; align-items: start;">
        
        <!-- العمود الأيمن (التمارين والبرنامج) -->
        <div style="display: flex; flex-direction: column; gap: 25px;">
          
          <!-- 1. فاعلية: تحدي الـ 30 يوم -->
          ${renderChallengeCard(profile)}
 
          <!-- 2. أسبوعك مع BodA (اضغط على اليوم لتظهر تمارينه) -->
          ${renderWeekWithBoda(weekLocked)}
 
          <!-- 3. Nutrition (النظام الغذائي) -->
          <div class="glass-card" style="padding: 25px;">
            <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800; margin-bottom: 15px;">
              <i class="fa-solid fa-utensils" style="color: #10b981;"></i> Nutrition & Daily Macros <a href="#/nutrition" class="gold-text" style="font-size: 0.8rem; font-weight: 700;">(حدّد نظامك مع الكابتن ←)</a>
            </h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center;">
              <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <span style="font-size: 0.8rem; color: #64748b;">البروتين</span>
                <h4 style="color: var(--primary); font-size: 1.2rem; font-weight: 800;">${profile.macros ? profile.macros.protein + ' جم' : '—'}</h4>
              </div>
              <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <span style="font-size: 0.8rem; color: #64748b;">الكاربوهيدرات</span>
                <h4 style="color: #0f172a; font-size: 1.2rem; font-weight: 800;">${profile.macros ? profile.macros.carbs + ' جم' : '—'}</h4>
              </div>
              <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <span style="font-size: 0.8rem; color: #64748b;">الدهون الصحية</span>
                <h4 style="color: #0f172a; font-size: 1.2rem; font-weight: 800;">${profile.macros ? profile.macros.fat + ' جم' : '—'}</h4>
              </div>
            </div>
          </div>
 
          <!-- حاسبة السعرات (للمشتركين) -->
          ${renderCalorieCalculator(profile)}
 
          <!-- فيديو الأداء -->
          ${renderVideoSection()}
 
          <!-- التقرير الشهري -->
          ${renderReportCard()}
 
 
        </div>
 
        <!-- العمود الأيسر (ملاحظات المدرب + التطور + الشات) -->
        <div style="display: flex; flex-direction: column; gap: 25px;">
          
          <!-- Coach Notes & Rating -->
          <div class="glass-card" style="padding: 24px; border: 2px solid rgba(225,29,72,0.2) !important;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h3 style="color: #0f172a; font-size: 1.15rem; font-weight: 800;">
                <i class="fa-solid fa-award" style="color: var(--primary);"></i> Coach Notes
              </h3>
              <span style="background: #fff1f2; color: var(--primary); padding: 4px 10px; border-radius: 15px; font-weight: 900;">
                ⭐ ${profile.coachRating || 5.0} / 5
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              ${profile.coachFeedbackAvatar
                ? `<img src="${escapeHtml(profile.coachFeedbackAvatar)}" alt="Coach Abdelrahim" style="width: 46px; height: 46px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary);">`
                : '<span style="width: 46px; height: 46px; border-radius: 50%; background: #fff1f2; color: var(--primary); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-user-tie"></i></span>'}
              <div><strong style="color: #0f172a;">Coach Abdelrahim</strong><br><small class="text-muted">${profile.coachFeedbackAt ? new Date(Number(profile.coachFeedbackAt)).toLocaleDateString('ar-EG') : 'رسالة من الكابتن'}</small></div>
            </div>
            <div style="background: #f8fafc; border-right: 4px solid var(--primary); padding: 14px; border-radius: 8px; font-size: 0.92rem; color: #1e293b; line-height: 1.6;">
              "${escapeHtml(profile.coachFeedback)}"
            </div>
          </div>
 
          <!-- Progress & Weight Tracker -->
          <div class="glass-card" style="padding: 24px;">
            <h3 style="color: #0f172a; font-size: 1.15rem; font-weight: 800; margin-bottom: 15px;">
              <i class="fa-solid fa-chart-line" style="color: #f59e0b;"></i> Progress Tracker
            </h3>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <div>
                <span style="font-size: 0.8rem; color: #64748b;">الوزن الحالي</span>
                <h4 style="font-size: 1.4rem; color: #0f172a; font-weight: 900;">${profile.currentWeight} كجم</h4>
              </div>
              <div style="font-size: 1.5rem; color: #cbd5e1;">➔</div>
              <div>
                <span style="font-size: 0.8rem; color: #64748b;">الهدف</span>
                <h4 style="font-size: 1.4rem; color: #10b981; font-weight: 900;">${profile.targetWeight} كجم</h4>
              </div>
            </div>
            <button onclick="updateTargetWeight()" class="btn-outline" style="width: 100%; padding: 8px; font-size: 0.85rem; margin-bottom: 8px;">
              <i class="fa-solid fa-bullseye"></i> تحديد الوزن اللي عايز توصله
            </button>
            <button onclick="updateTraineeWeight()" class="btn-outline" style="width: 100%; padding: 8px; font-size: 0.85rem;">
              <i class="fa-solid fa-weight-scale"></i> تحديث ميزان الأسبوع
            </button>
          </div>
 
          <!-- Direct Messages & Coach Chat -->
          <div class="glass-card" style="padding: 24px; text-align: center;">
            <i class="fa-brands fa-whatsapp" style="font-size: 2.2rem; color: #25D366; margin-bottom: 10px;"></i>
            <h3 style="color: #0f172a; font-size: 1.15rem; font-weight: 800; margin-bottom: 6px;">Messages with Coach</h3>
            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 15px;">إرسال فيديوهات الأداء واستفسارات الأوزان مباشرة للكابتن عبد الرحيم</p>
            <a href="https://wa.me/201207908662" target="_blank" class="btn-gold" style="width: 100%; display: block; padding: 10px; font-size: 0.9rem; text-decoration: none;">
              فتح المحادثة الفورية
            </a>
          </div>
 
        </div>
 
      </div>
 
    </div>
  `;
}
 
// دالة تغيير الباقة في صفحة الدفع وتحديث السعر والكروت فورياً
function onPaymentPlanChange(plan) {
  if (!PLANS[plan]) plan = 'standard';
  localStorage.setItem('selectedPlan', plan);
  const cards = { standard: 'planCardStandard', vip: 'planCardVip', promax: 'planCardPromax' };
  Object.keys(cards).forEach(key => {
    const el = document.getElementById(cards[key]);
    if (!el) return;
    const on = key === plan;
    el.style.border = on ? '2px solid var(--primary)' : '2px solid #e2e8f0';
    el.style.background = on ? '#fff1f2' : '#ffffff';
    el.style.boxShadow = on ? '0 4px 12px rgba(225,29,72,0.15)' : 'none';
  });
  const info = PLANS[plan];
  const priceDisplay = document.getElementById('payPlanPriceDisplay');
  if (priceDisplay) priceDisplay.textContent = String(info.price);
  const nameDisplay = document.getElementById('payPlanNameDisplay');
  if (nameDisplay) nameDisplay.textContent = info.name;
  const periodDisplay = document.getElementById('payPlanPeriodDisplay');
  if (periodDisplay) periodDisplay.textContent = info.months === 3 ? '(دفعة واحدة لمدة 3 شهور)' : '/ شهرياً';
}
 
function renderPaymentPage() {
  const selectedPlan = localStorage.getItem('selectedPlan') || 'standard';
  const selKey = PLANS[selectedPlan] ? selectedPlan : 'standard';
  const isStd = selKey === 'standard';
  const isVip = selKey === 'vip';
  const isPro = selKey === 'promax';
  const planName = PLANS[selKey].name;
  const planPrice = String(PLANS[selKey].price);
 
  return `
    <div class="glass-card" style="max-width: 650px; margin: 30px auto; padding: 30px;">
      <h2 style="color: #0f172a; text-align: center; margin-bottom: 6px;">تأكيد الاشتراك وتفعيل الحساب</h2>
      <p class="text-muted" style="text-align: center; margin-bottom: 22px;">اختر الباقة المناسبة لهدفك وظروفك</p>
 
      <!-- اختيار الباقة بين الأساسية و VIP -->
      <div style="margin-bottom: 22px;">
        <div class="pay-plans" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
          
          <!-- كارت الباقة الأساسية -->
          <label id="planCardStandard" style="border: 2px solid ${isStd ? 'var(--primary)' : '#e2e8f0'}; background: ${isStd ? '#fff1f2' : '#ffffff'}; border-radius: 12px; padding: 16px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s; box-shadow: ${isStd ? '0 4px 12px rgba(225,29,72,0.15)' : 'none'};">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 800; color: #0f172a; font-size: 1rem;">الباقة الأساسية</span>
                <input type="radio" name="selectedPlan" value="standard" ${isStd ? 'checked' : ''} onchange="onPaymentPlanChange('standard')">
              </div>
              <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 12px;">جدول 6 أيام + دايت مخصص + متابعة أسبوعية</p>
            </div>
            <div style="font-weight: 900; font-size: 1.35rem; color: var(--primary);">
              300 <span style="font-size: 0.85rem; font-weight: 700; color: #475569;">ج.م / شهر</span>
            </div>
          </label>
 
          <!-- كارت باقة VIP -->
          <label id="planCardVip" style="border: 2px solid ${isVip ? 'var(--primary)' : '#e2e8f0'}; background: ${isVip ? '#fff1f2' : '#ffffff'}; border-radius: 12px; padding: 16px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s; position: relative; box-shadow: ${isVip ? '0 4px 12px rgba(225,29,72,0.15)' : 'none'};">
            <span style="position: absolute; top: -10px; left: 10px; background: var(--primary-gradient); color: #fff; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 10px;">🔥 الأكثر طلباً</span>
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 800; color: #0f172a; font-size: 1rem;"><i class="fa-solid fa-crown" style="color: var(--primary);"></i> باقة VIP</span>
                <input type="radio" name="selectedPlan" value="vip" ${isVip ? 'checked' : ''} onchange="onPaymentPlanChange('vip')">
              </div>
              <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 12px;">متابعة يومية واتساب + تصحيح تكنيك بالفيديو</p>
            </div>
            <div style="font-weight: 900; font-size: 1.35rem; color: var(--primary);">
              450 <span style="font-size: 0.85rem; font-weight: 700; color: #475569;">ج.م / شهر</span>
            </div>
          </label>
 
          <!-- كارت باقة 3 برو ماكس -->
          <label id="planCardPromax" style="border: 2px solid ${isPro ? 'var(--primary)' : '#e2e8f0'}; background: ${isPro ? '#fff1f2' : '#ffffff'}; border-radius: 12px; padding: 16px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s; position: relative; box-shadow: ${isPro ? '0 4px 12px rgba(225,29,72,0.15)' : 'none'};">
            <span style="position: absolute; top: -10px; left: 10px; background: var(--primary-gradient); color: #fff; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 10px;">💎 الأوفر</span>
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 800; color: #0f172a; font-size: 1rem;"><i class="fa-solid fa-gem" style="color: var(--primary);"></i> 3 برو ماكس</span>
                <input type="radio" name="selectedPlan" value="promax" ${isPro ? 'checked' : ''} onchange="onPaymentPlanChange('promax')">
              </div>
              <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 12px;">3 شهور بمميزات VIP كاملة بسعر أوفر</p>
            </div>
            <div style="font-weight: 900; font-size: 1.35rem; color: var(--primary);">
              750 <span style="font-size: 0.85rem; font-weight: 700; color: #475569;">ج.م / 3 شهور</span>
            </div>
          </label>
 
 
        </div>
      </div>
      
      <!-- ملخص السعر -->
      <div style="background: #fff1f2; border: 1px solid rgba(225, 29, 72, 0.25); border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 22px;">
        <span style="font-size: 0.9rem; color: #475569; display: block; margin-bottom: 4px;">المبلغ المطلوب تحويله لـ <strong id="payPlanNameDisplay" style="color: var(--primary);">${planName}</strong>:</span>
        <span id="payPlanPriceDisplay" style="font-size: 2.3rem; font-weight: 900; color: var(--primary);">${planPrice}</span>
        <span style="font-weight: 700; color: #0f172a;"> جنيه مصري <span id="payPlanPeriodDisplay" style="color: #64748b; font-weight: 600; font-size: 0.9rem;">${PLANS[selKey].months === 3 ? '(دفعة واحدة لمدة 3 شهور)' : '/ شهرياً'}</span></span>
      </div>
 
      <!-- بيانات الدفع -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
        <h4 style="color: #0f172a; margin-bottom: 8px; font-size: 1rem;"><i class="fa-solid fa-mobile-screen-button" style="color: var(--primary);"></i> طرق الدفع المتاحة:</h4>
        <p style="font-size: 0.95rem; color: #334155; margin-bottom: 5px;">• فودافون كاش / إنستاباي: <strong>01227321558</strong></p>
        <p style="font-size: 0.85rem; color: #64748b;">(ارفع صورة إشعار التحويل بالأسفل لتأكيد حسابك)</p>
      </div>
 
      <form onsubmit="handlePaymentSubmit(event)">
        <div class="form-group">
          <label>اسم المشترك الثلاثي</label>
          <input type="text" id="payName" required placeholder="أدخل اسمك بالكامل">
        </div>
 
        <div class="form-group">
          <label>رقم الواتساب المسجل به التحويل</label>
          <input type="tel" id="payPhone" required placeholder="01xxxxxxxxx">
        </div>
 
        <div class="form-group">
          <label>طريقة التحويل</label>
          <select id="payMethod">
            <option value="InstaPay">إنستاباي</option>
            <option value="فودافون كاش">فودافون كاش</option>
            <option value="محفظة أخرى">محفظة أخرى</option>
          </select>
        </div>
 
        <div class="form-group">
          <label>الرقم المرجعي للعملية (اختياري)</label>
          <input type="text" id="payRef" placeholder="رقم العملية من إشعار التحويل">
        </div>
 
        <!-- خانة رفع سكرين شوت التحويل -->
        <div class="form-group">
          <label><i class="fa-solid fa-receipt" style="color: var(--primary);"></i> إرفاق إشعار / سكرين شوت التحويل</label>
          <input type="file" id="payReceipt" accept="image/*" required onchange="previewReceipt(event)" style="padding: 8px; border: 1px dashed var(--primary); background: #fff1f2; cursor: pointer;">
          <small style="color: #64748b; display: block; margin-top: 5px;">الامتدادات المقبولة: JPG, PNG, WEBP</small>
        </div>
 
        <!-- مساحة لمعاينة الصورة التي يختارها العميل -->
        <div id="receiptPreviewBox" style="display: none; text-align: center; margin-bottom: 20px; padding: 10px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0;">
          <p style="font-size: 0.85rem; color: #334155; margin-bottom: 8px;">معاينة الإيصال:</p>
          <img id="receiptPreviewImg" src="" alt="إيصال الدفع" style="max-height: 180px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
        </div>
 
        <button type="submit" class="btn-gold" style="width: 100%; padding: 14px; font-size: 1.1rem; margin-top: 10px;">
          تأكيد الاشتراك وإرسال الإيصال
        </button>
      </form>
    </div>
  `;
}
 
// دالة معاينة الإيصال
function previewReceipt(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('receiptPreviewImg').src = e.target.result;
      document.getElementById('receiptPreviewBox').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}
 
 
// دالة معالجة إرسال الطلب وحفظه
function handlePaymentSubmit(event, planName, planPrice) {
  if (event && event.preventDefault) event.preventDefault();
  if (!requireFirebase()) return;
  if (!state.currentUser) {
    window.location.hash = '#/login';
    return;
  }
 
  // تحديد الباقة المختارة بأمان تام
  const selectedPlanRadio = document.querySelector('input[name="selectedPlan"]:checked');
  const planKey = selectedPlanRadio ? selectedPlanRadio.value : (localStorage.getItem('selectedPlan') || 'standard');
  const sel = PLANS[planKey] || PLANS.standard;
  const finalPlanName = sel.name;
  const finalPlanPrice = sel.price;
  const finalPlanCode = sel.code;
 
  const name = document.getElementById('payName').value.trim();
  const phone = document.getElementById('payPhone').value.trim();
  const method = document.getElementById('payMethod').value;
  const ref = document.getElementById('payRef').value.trim();
  const receiptInput = document.getElementById('payReceipt');
 
  if (!/^01[0-9]{9}$/.test(phone)) {
    alert('رقم الواتساب لازم يكون 11 رقم ويبدأ بـ 01.');
    return;
  }
  if (!receiptInput.files || receiptInput.files.length === 0) {
    alert('يرجى إرفاق سكرين شوت الإيصال لتأكيد العملية.');
    return;
  }
 
  resizeImage(receiptInput.files[0], 900, async receipt => {
    try {
      await db.collection('payments').add({
        uid: state.currentUser.uid,
        email: state.currentUser.email || '',
        trainee: name,
        phone: phone,
        method: method,
        ref: ref,
        plan: finalPlanCode,
        price: Number(finalPlanPrice),
        receipt: receipt,
        status: 'pending',
        date: new Date().toLocaleDateString('ar-EG'),
        createdAt: Date.now()
      });
    } catch (err) {
      console.error("Payment submission error:", err);
      let errMsg = err.message || err.code || 'خطأ غير معروف';
      if (err.code === 'permission-denied' || errMsg.includes('permission')) {
        errMsg = 'تم رفض العملية من Firebase بسبب قواعد الحماية (Firestore Rules). يرجى مراجعة تبويب Rules في Firebase Console.';
      }
      alert('حصلت مشكلة في إرسال الطلب: ' + errMsg);
      return;
    }
 
    const msg = 'مرحباً كابتن عبد الرحيم 👋\n' +
      'تم الاشتراك في: ' + finalPlanName + '\n' +
      'الاسم: ' + name + '\n' +
      'رقم الواتساب: ' + phone + '\n' +
      'طريقة الدفع: ' + method + (ref ? '\nالرقم المرجعي: ' + ref : '') + '\n' +
      'تم رفع الإيصال على المنصة.';
 
    document.getElementById('app').innerHTML = `
      <div class="glass-card" style="max-width: 560px; margin: 40px auto; text-align: center; padding: 36px;">
        <div style="font-size: 3rem; margin-bottom: 10px;">✅</div>
        <h2 style="color: #0f172a; margin-bottom: 8px;">تم استلام طلبك يا ${escapeHtml(name)}!</h2>
        <p class="text-muted" style="margin-bottom: 22px;">هيتم تفعيل حسابك فور مراجعة الإيصال. تقدر تسرّع الموضوع بإرسال رسالة للكابتن على واتساب.</p>
        <a href="https://wa.me/201207908662?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" class="btn-gold" style="width: 100%; padding: 14px;">
          <i class="fa-brands fa-whatsapp"></i> أرسل التأكيد للكابتن على واتساب
        </a>
        <p style="margin-top: 16px;"><a href="#/dashboard" class="gold-text">الذهاب للوحة المتدرب</a></p>
      </div>
    `;
  });
}
 
 
 
// --- 5. المحتوى الخاص والمحمي (Protected Trainee Portal) ---
 
// ==================== صفحة بروفايل ومتابعة المتدرب ====================
 
// دالة فتح نافذة اختيار الصورة عند الضغط عليها
function triggerAvatarUpload() {
  const input = document.getElementById('dashboardAvatarInput');
  if (input) input.click();
}
 
// دالة تغيير صورة البروفايل للمتدرب
async function handleDashboardAvatarChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
 
  if (!state.currentUser) {
    alert('يجب تسجيل الدخول لتغيير الصورة.');
    return;
  }
 
  // تصغير الصورة لتقليل حجمها قبل التخزين في Firestore
  resizeImage(file, 250, async (newAvatarUrl) => {
    try {
      if (db) {
        await db.collection('users').doc(state.currentUser.uid).set({
          avatar: newAvatarUrl
        }, { merge: true });
      }
      if (!state.profile) state.profile = {};
      state.profile.avatar = newAvatarUrl;
 
      // تحديث الصورة في الواجهة مباشرة
      const avatarImg = document.getElementById('dashboardUserAvatar');
      if (avatarImg) {
        avatarImg.src = newAvatarUrl;
      }
 
      alert('تم تحديث صورتك الشخصية بنجاح! 🔥');
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ الصورة الجديدة، يرجى المحاولة مرة أخرى.');
    }
  });
}
// دالة تسجيل الحضور اليومي
async function traineeDailyCheckIn() {
  if (!state.currentUser || !state.profile) {
    alert('الميزة دي متاحة لحسابات المتدربين فقط.');
    return;
  }
  const todayStr = new Date().toDateString();
  if (state.profile.lastCheckIn === todayStr) {
    alert('لقد سجلت حضورك بالفعل اليوم، ركز في التمرين والاستشفاء!');
    return;
  }
  const updates = { checkIns: (state.profile.checkIns || 0) + 1, lastCheckIn: todayStr };
  try {
    await db.collection('users').doc(state.currentUser.uid).update(updates);
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في تسجيل الحضور، جرّب تاني.');
    return;
  }
  Object.assign(state.profile, updates);
  alert('عاش يا وحش! 💥 تم تسجيل حضور تمرين النهاردة. استمرارك وصل لـ ' + updates.checkIns + ' يوم تمرين!');
  handleRoute();
}
 
// دالة تحديث الوزن
async function updateTraineeWeight() {
  if (!state.currentUser || !state.profile) {
    alert('الميزة دي متاحة لحسابات المتدربين فقط.');
    return;
  }
  const input = prompt('أدخل وزنك الحالي بالكيلوجرام (على الريق الصبح):');
  if (input === null) return;
  const w = parseFloat(input);
  if (!isFinite(w) || w < 20 || w > 400) {
    alert('أدخل وزن صحيح بالكيلوجرام.');
    return;
  }
  try {
    await db.collection('users').doc(state.currentUser.uid).update({ currentWeight: w });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في حفظ الوزن، جرّب تاني.');
    return;
  }
  state.profile.currentWeight = w;
  alert('تم تسجيل وزنك الجديد (' + w + ' كجم). الكابتن هيتابع التطور في التقييم الجاي!');
  handleRoute();
}
 
// تحديد الوزن اللي المتدرب عايز يوصله
async function updateTargetWeight() {
  if (!state.currentUser || !state.profile) {
    alert('الميزة دي متاحة لحسابات المتدربين فقط.');
    return;
  }
  const input = prompt('اكتب الوزن اللي عايز توصله (بالكيلوجرام):', state.profile.targetWeight || '');
  if (input === null) return;
  const w = parseFloat(input);
  if (!isFinite(w) || w < 20 || w > 400) {
    alert('أدخل وزن صحيح بالكيلوجرام.');
    return;
  }
  try {
    await db.collection('users').doc(state.currentUser.uid).update({ targetWeight: w });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في حفظ الهدف، جرّب تاني.');
    return;
  }
  state.profile.targetWeight = w;
  alert('تم تحديد هدفك: ' + w + ' كجم 🎯 الكابتن هيظبط خطتك عليه.');
  handleRoute();
}
 
// ==================== صفحة التمارين التفاعلية ====================
const WORKOUT_SETS_LABEL = '3 مجموعات × 6-8 تكرار';
 
const WORKOUT_DAY_INTRO = [
  'ابدأ الأسبوع بقوة! الصدر والضهر أساس القوام الرياضي، وكل عدّة بتقرّبك من الـ V-Shape.',
  'يوم الدراعات والأكتاف. هنا بنرسم الشكل، ركّز على الإحساس مش على الوزن.',
  'يوم الرجل، اللي بيفرّق بين المتدرب والبطل. ماتهربش منه، وجسمك هيشكرك.',
  'بنش وضهر تاني. نفس القوة، وزن أتقل شوية والتكنيك ثابت.',
  'دراع تاني ويوم الأكتاف. اتحكم في كل عدّة وسيب الغش برّه.',
  'آخر يوم تمرين في الأسبوع. اختمه بقوة وهتستمتع براحة الجمعة عن جدارة.'
];
 
// شرح كل تمرينة: الخطوات + نصيحة بودا (الاسم لازم يطابق الاسم في WORKOUT_PLAN)
const EXERCISE_GUIDE = {
  'دامبل عالي': { en: 'Incline Dumbbell Press', how: ['اظبط البنش على زاوية 30-45° وثبّت ضهرك وكتافك لورا.', 'انزل بالدامبلز ببطء لحد جنب أعلى الصدر والكوعين بزاوية 45° مش مفتوحين.', 'ادفع لفوق وعصّر الصدر من غير ما تخبّط الدامبلز.'], tip: 'النزلة 3 ثواني والطلعة بقوة. الصدر العلوي بيتبني بالتحكم مش بالوزن.' },
  'سحب عالي': { en: 'Lat Pulldown', how: ['امسك البار أوسع من كتفك شوية واتكّي لورا بميل بسيط.', 'اسحب البار لحد أعلى الصدر وكوعك رايح لتحت وورا.', 'ارجع لفوق ببطء لحد ما تحس بمط في الضهر.'], tip: 'فكّر إنك بتسحب بكوعك مش بإيدك، وماتهزّش جسمك.' },
  'بار واطي': { en: 'Decline Barbell Press', how: ['ثبّت رجليك كويس على البنش المنحني وامسك البار أوسع من الكتف شوية.', 'انزل بالبار لأسفل الصدر ببطء.', 'ادفع لفوق في خط مستقيم وعصّر الصدر.'], tip: 'تمرين تقيل، خلّي حد يسبوتك. السلامة أهم من الرقم.' },
  'سحب أرضي ضيق': { en: 'Close-Grip Seated Cable Row', how: ['اقعد وصدرك مفتوح وضهرك مفرود وركبك مثنية شوية.', 'اسحب المقبض لحد بطنك وقرّب لوحي الكتف من بعض.', 'ارجع بتحكم وفرد دراعك من غير ما تدوّر ضهرك.'], tip: 'اتخيّل إنك بتعصر برتقالة بين لوحي كتفك في آخر الحركة.' },
  'فراشة': { en: 'Pec Deck Fly', how: ['اظبط الكرسي بحيث الإيدين على مستوى الصدر وضهرك لازق.', 'ضم الدراعين قدامك بكوع مثني شوية وعصّر الصدر ثانية.', 'افتح ببطء لحد ما تحس بمط من غير ما كتافك تروح لقدام.'], tip: 'ده تمرين عزل. وزن خفيف وإحساس عالي أحسن من وزن تقيل بغش.' },
  'حبل ظهر': { en: 'Rope Straight-Arm Pulldown', how: ['قف قدام الكيبل العالي ماسك الحبل ودراعك شبه مفرودة.', 'اسحب الحبل لتحت لحد فخادك وهو قريب من جسمك.', 'ارجع لفوق ببطء وحس بالضهر بيتمدد.'], tip: 'الحركة من الكتف، والكوع ثابت تقريبًا. ده اللي بيدّيك عرض الضهر.' },
 
  'دامبل 90°': { en: 'Seated Dumbbell Shoulder Press', how: ['اقعد بضهر مسنود وامسك الدامبلز والكوع بزاوية 90° جنب الودن.', 'ادفع لفوق لحد ما الدامبلز يقربوا من بعض من غير ما يخبطوا.', 'انزل ببطء لحد 90° مش أكتر.'], tip: 'ماتقوّسش ضهرك واشدّ بطنك. الكتف القوي بيتبني بالثبات.' },
  'رفرفة جانبي': { en: 'Lateral Raise', how: ['امسك دامبلز خفيف وكوعك مثني شوية.', 'ارفع الدراعين للجنب لحد مستوى الكتف.', 'انزل في 3 ثواني من غير ما تتأرجح.'], tip: 'ارفع بالكوع قبل الإيد، والوزن خفيف. أخوك بودا شايفك لو بتغش 😉' },
  'رفرفة كيبل': { en: 'Cable Lateral Raise', how: ['اقف جنب الكيبل وامسك المقبض بالإيد البعيدة.', 'ارفع دراعك للجنب لحد مستوى الكتف.', 'انزل ببطء مع شد مستمر في الكيبل.'], tip: 'الكيبل بيدّيك شد طول الحركة، استفيد منه ومتسيبوش يرتاح.' },
  'كتف خلفي': { en: 'Rear Delt Fly', how: ['اميل بجذعك لقدام وضهرك مفرود، أو استخدم الماكينة العكسية.', 'افتح دراعك للجنب بكوع مثني شوية لحد مستوى الكتف.', 'ارجع ببطء من غير ما ترفع كتافك لودانك.'], tip: 'عضلة صغيرة، أداء نضيف ووزن خفيف هو السر. وبتحسّن وقفة جسمك كمان.' },
  'باي كرسي': { en: 'Seated Dumbbell Curl', how: ['اقعد بضهر مسنود ودامبل في كل إيد.', 'اطلع بالدامبل لكتفك والكوع ثابت جنب جسمك.', 'انزل ببطء لحد ما دراعك تتفرد تقريبًا.'], tip: 'القعدة بتمنعك من الغش بالجسم، فخلّي الباي هو اللي يشتغل لوحده.' },
  'تراي خلفي': { en: 'Overhead Triceps Extension', how: ['امسك دامبل بالإيدين وارفعه فوق راسك.', 'انزل بالدامبل ورا راسك بحني الكوع، والكوع بيشاور لفوق.', 'اطلع لفوق بقوة التراي وافرد دراعك.'], tip: 'ثبّت الكوع جنب ودنك وماتفتحوش للجنب.' },
  'باي ارتكاز': { en: 'Concentration Curl', how: ['اقعد وسند كوعك على فخدك من جوه.', 'اطلع بالدامبل لحد الكتف وعصّر الباي فوق.', 'انزل في 3 ثواني.'], tip: 'تمرين إحساس: أبطأ حركة وأقوى عصرة. الوزن الخفيف هنا بيبني أحسن.' },
  'تراي حبل': { en: 'Rope Triceps Pushdown', how: ['قف قدام الكيبل العالي وامسك الحبل والكوع لازق في جنبك.', 'انزل بالحبل لتحت وافرد الدراع وافتح الحبل في الآخر.', 'ارجع لفوق ببطء لحد ما الكوع يوصل 90°.'], tip: 'الكوع مايتحركش أبدًا. لو اتحرك يبقى الوزن تقيل عليك.' },
 
  'Squat — سكوات': { en: 'Squat', how: ['قف والرجلين بعرض الكتف ومشط الرجل مفتوح شوية والبار على الترابيس.', 'انزل لحد ما فخدك توازي الأرض، وضهرك مفرود وركبك في اتجاه مشط رجلك.', 'ادفع الأرض بكعبك وقف.'], tip: 'ملك التمارين. خد نفس واشدّ بطنك قبل كل عدّة، وماتخليش ركبك تدخل لجوه.' },
  'خلفي': { en: 'Leg Curl', how: ['اظبط الماكينة وخلّي الركبة عند محور الحركة.', 'اسحب بكعب رجلك ناحية الفخد الخلفي.', 'ارجع ببطء من غير ما ترفع وركك.'], tip: 'اخلّي النزلة 3 ثواني. الفخد الخلفي بيتبني في الرجعة قد الطلعة.' },
  'أمامي': { en: 'Leg Extension', how: ['اقعد وضهرك لازق واظبط الوسادة على أسفل رجلك.', 'افرد رجلك وعصّر الفخد الأمامي.', 'انزل ببطء من غير ما الوزن يخبّط.'], tip: 'ماتقفلش الركبة بعنف في الآخر. عصرة هادية أحسن لمفصلك.' },
  'Deadlift — ديدليفت': { en: 'Deadlift', how: ['قف والبار فوق منتصف قدمك وامسكه بعرض الكتف، وضهرك مفرود وصدرك مرفوع.', 'ادفع الأرض برجلك واطلع بالبار قريب من رجلك لحد ما تقف معدول.', 'انزل بالبار بنفس المسار والوركين رايحين لورا.'], tip: 'ماتدوّرش ضهرك أبدًا. ابدأ بوزن خفيف وثبّت التكنيك، الأمان قبل الرقم.' },
  'سمانة': { en: 'Calf Raise', how: ['قف على حافة خطوة أو ماكينة السمانة وسيب الكعب ينزل.', 'اطلع على مشط رجلك لأقصى ارتفاع وسيب ثانية.', 'انزل ببطء لحد ما تحس بمط.'], tip: 'السمانة عنيدة: مدى حركة كامل وبطء مش سرعة.' },
  'ساعد': { en: 'Wrist Curl', how: ['اسند ساعدك على فخدك وكفك لفوق وماسك بار أو دامبل.', 'اطلع بالرسغ لفوق وعصّر.', 'انزل ببطء لحد ما الأصابع تتفتح شوية.'], tip: 'ساعد قوي = قبضة قوية في السحب والديدليفت.' },
 
  'بار عالي': { en: 'Incline Barbell Press', how: ['اظبط البنش 30-45° وامسك البار أوسع من الكتف شوية.', 'انزل بالبار لأعلى الصدر ببطء.', 'ادفع لفوق في خط مستقيم.'], tip: 'ماتنزلش البار على رقبتك، ولو بتشيل تقيل خلّي حد يسبوتك.' },
  'T-Bar Row — تي بار': { en: 'T-Bar Row', how: ['قف على الماكينة وصدرك مسنود (أو انحنِ بضهر مفرود).', 'اسحب لحد صدرك وكوعك جنبك وقرّب لوحي الكتف.', 'انزل ببطء وافرد دراعك.'], tip: 'سُمك الضهر بييجي من هنا. ماتشدّش بضهرك السفلي، التحكم أهم.' },
  'دامبل واطي': { en: 'Decline Dumbbell Press', how: ['اظبط البنش منحني وامسك دامبلز فوق صدرك.', 'انزل ببطء لحد جنب أسفل الصدر.', 'ادفع لفوق وعصّر الصدر.'], tip: 'ركّز على التحكم والتوازن بين الدراعين.' },
  'سحب عالي ضيق': { en: 'Close-Grip Lat Pulldown', how: ['امسك المقبض الضيق (V-bar) واتكّي لورا شوية.', 'اسحب لحد أعلى الصدر وكوعك قريب من جسمك.', 'ارجع ببطء.'], tip: 'المقبض الضيق بيركّز على وسط وسُمك الضهر.' },
  'كيبل بنش': { en: 'Cable Chest Press', how: ['اقف بين الكيبلين وامسك المقبضين بكوع مثني.', 'ادفع قدامك وضم الإيدين وعصّر الصدر.', 'ارجع بتحكم لحد ما تحس بمط.'], tip: 'سر الكيبل هو الشد المستمر، ماتسيبوش يرتاح في أي نقطة.' },
  'One Arm Row — سحب يد واحدة': { en: 'One Arm Dumbbell Row', how: ['سند ركبة وإيد على البنش وضهرك موازي للأرض.', 'اسحب الدامبل ناحية وركك وكوعك رايح لورا.', 'انزل ببطء ومدّ الضهر.'], tip: 'ماتلفّش جذعك. اشتغل بالضهر مش بالعزم.' },
 
  'كتف أمامي': { en: 'Front Raise', how: ['امسك دامبل أو بلاطة قدام فخدك.', 'ارفعه لقدام لمستوى الكتف بدراع شبه مفرود.', 'انزل في 3 ثواني.'], tip: 'ماتتمايلش بجسمك. الكتف الأمامي بيشتغل أصلًا في البنش فمايحتاجش وزن تقيل.' },
  'رفرفة دامبل': { en: 'Dumbbell Lateral Raise', how: ['قف ودامبلز بجنبك وكوعك مثني شوية.', 'ارفع للجنب لمستوى الكتف كإنك بتصب مية من كوباية.', 'انزل ببطء.'], tip: 'اتحكم في النزلة، دي نص الشغل.' },
  'ترابيس': { en: 'Shrugs', how: ['امسك دامبلز أو بار وإيديك مفرودة جنبك.', 'ارفع كتافك لودانك وعصّر ثانية.', 'انزل ببطء.'], tip: 'ماتلفّش كتافك. حركة لفوق ولتحت بس.' },
  'باي خلفي': { en: 'Reverse Curl', how: ['امسك البار أو الدامبلز وكفك لتحت بعرض الكتف.', 'اطلع بالبار لكتفك والكوع ثابت.', 'انزل ببطء من غير تأرجح.'], tip: 'الوزن خفيف هنا. ده بيقوّي الساعد والعضلة العميقة تحت الباي.' },
  'باي بار': { en: 'Barbell Curl', how: ['قف ماسك البار بعرض الكتف وكفك لفوق.', 'اطلع بالبار لكتفك والكوع جنبك.', 'انزل ببطء من غير تأرجح.'], tip: 'لو بتتأرجح بجسمك يبقى الوزن تقيل. اشدّ بطنك وركّز.' },
  'تراي كيبل': { en: 'Cable Triceps Extension', how: ['اقف قدام الكيبل وامسك المقبض (أو الحبل).', 'افرد دراعك لتحت والكوع ثابت.', 'ارجع ببطء.'], tip: 'نفس مبدأ تراي حبل: ثبات الكوع هو الأساس.' },
 
  'مكبس': { en: 'Leg Press', how: ['اقعد وضهرك مسنود ورجليك بعرض الكتف على المنصة.', 'انزل لحد ما ركبتك تقرب من 90° من غير ما وركك يرتفع.', 'ادفع لفوق من غير ما تقفل الركبة بعنف.'], tip: 'اضغط بكعبك مش بأصابعك، وماتنزلش بعمق يرفع ضهرك من الكرسي.' },
  'ضامة': { en: 'Hip Adduction', how: ['اقعد واظبط الوسادات على الفخد الداخلي.', 'ضم رجليك ناحية بعض وعصّر ثانية.', 'افتح ببطء.'], tip: 'الفخد الداخلي حساس: ابدأ بوزن خفيف وبلاش حركات مفاجئة.' },
  'بطن': { en: 'Crunch', how: ['نام على ضهرك والركب مثنية، أو استخدم ماكينة البطن.', 'ارفع كتافك وضهرك العلوي ناحية الركب وعصّر البطن.', 'انزل ببطء من غير ما تشدّ رقبتك.'], tip: 'ماتشدّش راسك بإيدك. الدايت بيظهّر البطن قد التمرين.' }
};
 
const DEFAULT_EXERCISE_GUIDE = {
  en: '',
  how: ['اظبط الوضعية وثبّت جسمك.', 'نفّذ الحركة بتحكم وبمدى كامل.', 'ارجع ببطء وحس بالعضلة.'],
  tip: 'الأداء النضيف أهم من الوزن التقيل.'
};
 
const DAY_DONE_MESSAGES = [
  'عاش يا وحش! 💪 يوم كمان في جيبك. اللي بيكمّل بيكسب.',
  'برافو يا بطل! 🔥 كل عدّة النهاردة هتبان في المراية قريب.',
  'خلّصت يومك بنجاح! 🏆 الاستمرارية هي سر القوام، وإنت ماشي صح.',
  'أخوك بودا فخور بيك! 👏 خد وجبتك، اشرب مية، وارتاح كويس.',
  'يوم تمام التمام! 💥 العضلة بتكبر وإنت بتتغذى وبترتاح، ماتنساش.',
  'إنت بتبني نسختك الأقوى يوم بيوم. كمّل! 🚀'
];
 
const WEEK_DONE_MESSAGE = 'أسطورة! 🏅 خلّصت الأسبوع كله 6 من 6. ده التزام الأبطال، ارتاح النهاردة واستعد لأسبوع أقوى.';
 
let workoutSel = 0;
 
// مفتاح بداية الأسبوع (السبت) علشان التقدم يتصفّر كل أسبوع
function workoutWeekKey() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - todayWeekIndex());
  return start.getFullYear() + '-' + (start.getMonth() + 1) + '-' + start.getDate();
}
 
function workoutStorageKey() {
  return 'bodaWorkout:' + (state.currentUser ? state.currentUser.uid : 'guest');
}
 
function loadWorkoutProgress() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(workoutStorageKey()) || 'null'); } catch (e) { data = null; }
  const wk = workoutWeekKey();
  if (!data || data.week !== wk || typeof data.ex !== 'object' || typeof data.done !== 'object') {
    data = { week: wk, ex: {}, done: {} };
  }
  return data;
}
 
function saveWorkoutProgress(p) {
  try { localStorage.setItem(workoutStorageKey(), JSON.stringify(p)); } catch (e) { /* ignore */ }
}
 
function workoutDoneDays(p) {
  return WEEK_SCHEDULE.reduce((n, d, i) => n + (!d.rest && p.done[i] ? 1 : 0), 0);
}
 
function workoutTabsHtml(p) {
  const today = todayWeekIndex();
  return WEEK_SCHEDULE.map((d, i) => {
    const plan = d.rest ? null : WORKOUT_PLAN[d.day];
    const short = plan ? plan.title.split(':')[1].trim() : 'راحة واسترجاع';
    const done = !d.rest && p.done[i];
    return `
      <button type="button" class="week-day wk-tab${i === workoutSel ? ' active' : ''}${d.rest ? ' rest' : ''}${done ? ' done' : ''}" onclick="selectWorkoutDay(${i})">
        ${i === today ? '<em class="week-today">اليوم</em>' : ''}
        ${done ? '<span class="wk-tab-done"><i class="fa-solid fa-check"></i></span>' : ''}
        <b>${d.label}</b>
        <i class="fa-solid ${weekDayIcon(plan)}"></i>
        <span>${short}</span>
      </button>`;
  }).join('');
}
 
function workoutPanelHtml(p) {
  const i = workoutSel;
  const d = WEEK_SCHEDULE[i];
  if (d.rest) {
    return `
      <div class="wk-rest">
        <div class="wk-rest-ico"><i class="fa-solid fa-bed"></i></div>
        <h3>${d.label} — يوم راحة واسترجاع 😴</h3>
        <p>العضلة بتكبر وإنت بترتاح مش وإنت في الجيم. نام كويس، اشرب مية، وحافظ على أكلك. أخوك بودا بيقولك: الراحة جزء من التمرين.</p>
      </div>`;
  }
  const plan = WORKOUT_PLAN[d.day];
  const title = plan.title.split(':')[1].trim();
  const total = plan.exercises.length;
  const doneCount = plan.exercises.filter((_, k) => p.ex[i + '-' + k]).length;
  const dayDone = !!p.done[i];
  const pct = Math.round(doneCount / total * 100);
  const btnClass = dayDone ? 'done' : (doneCount === total ? 'ready' : '');
  const btnLabel = dayDone
    ? '<i class="fa-solid fa-circle-check"></i> تم إنجاز ' + d.label
    : '<i class="fa-solid fa-flag-checkered"></i> خلّصت يوم ' + d.label;
 
  const list = plan.exercises.map((name, k) => {
    const g = EXERCISE_GUIDE[name] || DEFAULT_EXERCISE_GUIDE;
    const checked = !!p.ex[i + '-' + k];
    return `
      <div class="wk-ex${checked ? ' checked' : ''}">
        <button type="button" class="wk-check" onclick="toggleExercise(${i}, ${k})" aria-pressed="${checked}" aria-label="تم إنجاز ${escapeHtml(name)}" title="${checked ? 'ألغِ العلامة' : 'علّم إنك خلّصت التمرينة'}">
          <i class="fa-solid fa-check"></i> تم
        </button>
        <div class="wk-ex-body">
          <div class="wk-ex-top">
            <span class="wk-num">${k + 1}</span>
            <div class="wk-ex-title">
              <h4>${escapeHtml(name)}</h4>
              ${g.en ? '<small>' + escapeHtml(g.en) + '</small>' : ''}
            </div>
            <span class="wk-sets"><i class="fa-solid fa-repeat"></i> ${WORKOUT_SETS_LABEL}</span>
          </div>
          <ol class="wk-how">${g.how.map(h => '<li>' + escapeHtml(h) + '</li>').join('')}</ol>
          <div class="wk-tip"><i class="fa-solid fa-fire"></i> <b>نصيحة من أخوك بودا:</b> ${escapeHtml(g.tip)}</div>
          ${exTimerHtml(i + '-' + k)}
        </div>
      </div>`;
  }).join('');
 
  return `
    <div class="wk-head">
      <div class="wk-head-info">
        <span class="wk-day-label">${d.label}</span>
        <h3>تمرين ${title}</h3>
        <p>${WORKOUT_DAY_INTRO[d.day]}</p>
      </div>
      <button type="button" class="wk-finish ${btnClass}" onclick="finishWorkoutDay(${i})">${btnLabel}</button>
    </div>
    <div class="wk-progress">
      <div class="wk-bar"><div style="width: ${pct}%"></div></div>
      <span>${doneCount} / ${total} تمارين</span>
    </div>
    <div class="wk-list">${list}</div>
    <p class="text-muted wk-foot"><i class="fa-solid fa-circle-info"></i> ${WORKOUT_NOTE}</p>`;
}
 
function workoutRootHtml() {
  const p = loadWorkoutProgress();
  const days = workoutDoneDays(p);
  return `
    <div class="wk-week">
      <div class="wk-week-top">
        <b><i class="fa-solid fa-bolt"></i> تقدمك الأسبوع ده</b>
        <span>${days} / 6 أيام</span>
      </div>
      <div class="wk-bar"><div style="width: ${Math.round(days / 6 * 100)}%"></div></div>
    </div>
    <div class="week-grid wk-tabs">${workoutTabsHtml(p)}</div>
    <div class="wk-panel" id="wkPanel">${workoutPanelHtml(p)}</div>`;
}
 
function refreshWorkoutPage() {
  const root = document.getElementById('wkRoot');
  if (root) root.innerHTML = workoutRootHtml();
}
 
function renderWorkoutsPage() {
  workoutSel = todayWeekIndex();
  return `
    <div class="wk-page">
      <div style="margin-bottom: 22px;">
        <h2 class="gold-text">برنامجك التدريبي الأسبوعي 💪</h2>
        <p class="text-muted">اختار اليوم، اتبع الشرح، وعلّم على كل تمرينة تخلّصها. وفي الآخر اضغط زرار إنجاز اليوم.</p>
      </div>
      <div id="wkRoot">${workoutRootHtml()}</div>
    </div>`;
}
 
function selectWorkoutDay(i) {
  workoutSel = i;
  refreshWorkoutPage();
}
 
function toggleExercise(i, k) {
  const p = loadWorkoutProgress();
  const key = i + '-' + k;
  if (p.ex[key]) {
    delete p.ex[key];
    delete p.done[i]; // لو شال علامة تمرينة، اليوم يرجع غير مكتمل
  } else {
    p.ex[key] = true;
  }
  saveWorkoutProgress(p);
  refreshWorkoutPage();
}
 
function finishWorkoutDay(i) {
  const d = WEEK_SCHEDULE[i];
  if (!d || d.rest) return;
  const plan = WORKOUT_PLAN[d.day];
  const total = plan.exercises.length;
  const p = loadWorkoutProgress();
 
  if (p.done[i]) {
    if (!confirm('تلغي علامة إنجاز يوم ' + d.label + '؟')) return;
    delete p.done[i];
    saveWorkoutProgress(p);
    refreshWorkoutPage();
    return;
  }
 
  const doneCount = plan.exercises.filter((_, k) => p.ex[i + '-' + k]).length;
  if (doneCount < total && !confirm('لسه فيه ' + (total - doneCount) + ' تمارين مش متعلّم عليها. خلّصت يوم ' + d.label + ' فعلاً؟')) return;
 
  // لازم المتدرب يكتب رأيه في التمرينة قبل ما اليوم يتسجّل (features.js)
  openWorkoutNoteModal(i);
}
 
function showWorkoutCelebration(title, msg, days) {
  const old = document.getElementById('wkCelebrate');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'wkCelebrate';
  overlay.className = 'wk-celebrate';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="wk-celebrate-card" role="dialog" aria-live="assertive">
      <div class="wk-celebrate-ico">🏆</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(msg)}</p>
      <div class="wk-celebrate-count">${days} / 6 أيام الأسبوع ده</div>
      <button type="button" class="btn-gold" onclick="document.getElementById('wkCelebrate').remove()">كمّل يا بطل 💪</button>
    </div>`;
  document.body.appendChild(overlay);
}
 
function renderNutritionPage() {
  const profile = state.profile || {};
  return `
    <h2 class="gold-text" style="margin-bottom: 8px;">الأنظمة الغذائية</h2>
    <p class="text-muted" style="margin-bottom: 22px;">نظامك الغذائي بيتحدد مع الكابتن عبد الرحيم بشكل شخصي — مش جدول عام للكل.</p>
 
    <div class="glass-card nut-how">
      <h3 class="gold-text"><i class="fa-solid fa-list-check"></i> إزاي بيتحدد نظامك الغذائي؟</h3>
      <div class="nut-steps">
        <div><b>1</b><span>اكتب وزنك وسنك وطولك في الحاسبة تحت</span></div>
        <div><b>2</b><span>احسب سعراتك اليومية والماكروز</span></div>
        <div><b>3</b><span>(اختياري) أضف بيانات تقرير الـ InBody</span></div>
        <div><b>4</b><span>ابعت التقرير كله للكابتن على واتساب من هنا، وهيحدد معاك نظامك</span></div>
      </div>
    </div>
 
    <div style="margin: 24px 0;">${renderCalorieCalculator(profile)}</div>
 
    <h3 class="gold-text" style="margin: 30px 0 6px;">نماذج عامة للاسترشاد فقط</h3>
    <p class="text-muted" style="margin-bottom: 14px;">أمثلة توضح الفكرة. نظامك الفعلي بيتحدد مع الكابتن بعد ما يستلم بياناتك.</p>
    <div class="grid-2">
      <div class="glass-card">
        <h3 class="gold-text">نظام التضخيم (بناء العضلات)</h3>
        <p class="text-muted">فائض سعرات 300-500 سعرة فوق معدل الثبات.</p>
        <ul style="margin-top: 15px; padding-right: 20px;">
          <li>وجبة قبل التمرين: كارب معقد + مصدر بروتين سريع.</li>
          <li>وجبة بعد التمرين: صدور دجاج / تونة + أرز أبيض مسلوق.</li>
          <li>الغداء المتكامل: لحم أو سمك + بطاطا مشوية وسلطة خضراء.</li>
          <li>سناك الضخامة: مشروب الشوفان والحليب وزبدة الفول.</li>
          <li>قبل النوم: جبن قريش (كازين بطيء الامتصاص) + مكسرات.</li>
        </ul>
      </div>
      <div class="glass-card">
        <h3 class="gold-text">نظام التنشيف (حرق الدهون)</h3>
        <p class="text-muted">عجز سعرات مع الحفاظ على البروتين 2 جرام لكل كيلو.</p>
        <ul style="margin-top: 15px; padding-right: 20px;">
          <li>وجبة قبل التمرين: موزة + قهوة سادة بدون سكر.</li>
          <li>وجبة بعد التمرين: بروتين صافي + كمية معتدلة من الشوفان أو الأرز.</li>
          <li>الغداء: سلطة خضراء غنية بالألياف + صدور دجاج مشوية.</li>
          <li>قبل النوم: بيض مسلوق + خيار وخضار ورقي.</li>
        </ul>
      </div>
    </div>
  `;
}
 
function renderRecipesPage() {
  return `
    <h2 class="gold-text" style="margin-bottom: 25px;">مطبخ الأبطال: وصفات الشوفان</h2>
    <div class="grid-3">
      <div class="glass-card">
        <h3 class="gold-text">شيك الشوفان للضخامة (800+ سعرة)</h3>
        <p>100 جم شوفان مطحون + كوب حليب + ملعقة كبيرة زبدة فول سوداني + موزة + سكوب واي بروتين (اختياري).</p>
      </div>
      <div class="glass-card">
        <h3 class="gold-text">شيك الشوفان للتنشيف (خفيف وشبع)</h3>
        <p>40 جم شوفان + ماء أو حليب خالي الدسم + رشة قرفة + سكر دايت + ملعقة صغيرة بذور الشيا.</p>
      </div>
      <div class="glass-card">
        <h3 class="gold-text">بانكيك الطاقة الصباحي</h3>
        <p>شوفان مطحون + 3 بياض بيض وبيضة كاملة + فانيليا. يطهى في مقلاة تيفال بدون زيت مضاف.</p>
      </div>
    </div>
  `;
}
 
function renderFitnessRulesPage() {
  const rules = [
    "الاستمرارية تتفوق على الشدة العشوائية دائماً.",
    "الزيادة التدريجية في الأحمال (Progressive Overload) هي مفتاح الضخامة.",
    "عضلاتك تنمو أثناء النوم والراحة، وليس داخل الجيم.",
    "شرب الماء الكافي (3-4 لتر يومياً) أساسي لمرونة المفاصل وتخليق البروتين.",
    "لا تضحي بصحة الأداء الحركي من أجل التباهي بوزن ثقيل (Ego Lifting)."
  ];
  return `
    <h2 class="gold-text" style="margin-bottom: 25px;">قواعد اللياقة والاستمرارية (من الكابتن)</h2>
    <div style="display: flex; flex-direction: column; gap: 15px; max-width: 800px;">
      ${rules.map((rule, idx) => `
        <div class="glass-card">
          <h4 class="gold-text">القاعدة رقم ${idx + 1}</h4>
          <p>${rule}</p>
        </div>
      `).join('')}
    </div>
  `;
}
 
// --- 6. أدوات اللياقة: حاسبة ومؤقت راحة (Fitness Tools) ---
 
function renderToolsPage() {
  return `
    <h2 class="gold-text" style="text-align: center; margin-bottom: 30px;">أدوات وحاسبات اللياقة الذكية</h2>
    <div class="grid-2">
      <!-- حاسبة كتلة الجسم والسعرات -->
      <div class="glass-card">
        <h3 class="gold-text"><i class="fa-solid fa-calculator"></i> حاسبة BMI ومؤشر الكتلة</h3>
        <div class="form-group" style="margin-top: 15px;">
          <label>الوزن (كجم)</label>
          <input type="number" id="calcWeight" placeholder="75">
        </div>
        <div class="form-group">
          <label>الطول (سم)</label>
          <input type="number" id="calcHeight" placeholder="175">
        </div>
        <button onclick="calculateBMI()" class="btn-gold" style="width: 100%;">احسب النتيجة</button>
        <div id="bmiResult" style="margin-top: 15px; font-weight: 700;"></div>
      </div>
 
      <!-- مؤقت الراحة بين المجموعات -->
      <div class="glass-card" style="text-align: center;">
        <h3 class="gold-text"><i class="fa-solid fa-stopwatch"></i> مؤقت الراحة بين المجموعات</h3>
        <div id="timerDisplay" style="font-size: 3.5rem; font-weight: 900; margin: 20px 0; color: #0f172a;">01:30</div>
        <div style="display: flex; justify-content: center; gap: 10px;">
          <button onclick="startTimer(60)" class="btn-outline">60 ثانية</button>
          <button onclick="startTimer(90)" class="btn-outline">90 ثانية</button>
          <button onclick="startTimer(120)" class="btn-outline">120 ثانية</button>
        </div>
      </div>
    </div>
  `;
}
 
function calculateBMI() {
  const w = parseFloat(document.getElementById('calcWeight').value);
  const h = parseFloat(document.getElementById('calcHeight').value) / 100;
  const res = document.getElementById('bmiResult');
  if (!w || !h) {
    res.innerHTML = "<span style='color: #dc2626;'>يرجى إدخال الوزن والطول بشكل صحيح</span>";
    return;
  }
  const bmi = (w / (h * h)).toFixed(1);
  let msg = "";
  if (bmi < 18.5) msg = "نقص في الوزن (تحتاج لبرنامج ضخامة)";
  else if (bmi < 25) msg = "وزن مثالي متناسق";
  else if (bmi < 30) msg = "زيادة طفيفة في الوزن (تنشيف خفيف)";
  else msg = "سمنة - بحاجة لخطة عجز سعرات منتظمة";
 
  res.innerHTML = `مؤشر كتلة جسمك: <span class="gold-text">${bmi}</span> — ${msg}`;
}
 
let timerInterval;
function startTimer(seconds) {
  clearInterval(timerInterval);
  let timeLeft = seconds;
  const display = document.getElementById('timerDisplay');
  
  function update() {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    display.textContent = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      display.textContent = "انتهى الوقت!";
    }
    timeLeft--;
  }
  update();
  timerInterval = setInterval(update, 1000);
}
 
// --- 7. لوحة تحكم الكابتن / الأدمن (Admin Dashboard) ---
 
// لوحة إدارة الكابتن - مراجعة طلبات الدفع
// ==================== لوحة تحكم وإدارة الكابتن الشاملة ====================
 
// دالة فتح نافذة اختيار صورة الكابتن (الأدمن)
function triggerAdminAvatarUpload() {
  const input = document.getElementById('adminAvatarInput');
  if (input) input.click();
}
 
// دالة تغيير صورة الكابتن (الأدمن)
async function handleAdminAvatarChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
 
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    alert('هذه الميزة مخصصة لحساب الكابتن فقط.');
    return;
  }
 
  resizeImage(file, 250, async (newAvatarUrl) => {
    try {
      if (db) {
        await Promise.all([
          db.collection('admins').doc(state.currentUser.uid).set({ avatar: newAvatarUrl }, { merge: true }),
          db.collection('users').doc(state.currentUser.uid).set({ avatar: newAvatarUrl }, { merge: true })
        ]);
      }
      if (!state.profile) state.profile = {};
      state.profile.avatar = newAvatarUrl;
      if (!state.adminProfile) state.adminProfile = {};
      state.adminProfile.avatar = newAvatarUrl;
      state.currentUser.avatar = newAvatarUrl;
 
      const avatarImg = document.getElementById('adminUserAvatar');
      if (avatarImg) {
        avatarImg.src = newAvatarUrl;
      }
 
      alert('تم تحديث صورة الكابتن بنجاح! 👑');
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ صورة الكابتن، يرجى المحاولة مرة أخرى.');
    }
  });
}
 
// دالة تكبير وعرض صورة المتدرب للكابتن
function viewClientPhoto(imgUrl, clientName) {
  if (!imgUrl) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:3000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;cursor:pointer;';
  overlay.onclick = () => overlay.remove();
  const img = document.createElement('img');
  img.src = imgUrl;
  img.alt = clientName || 'صورة المتدرب';
  img.style.cssText = 'max-width:320px;max-height:320px;border-radius:50%;object-fit:cover;border:4px solid var(--primary);background:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.5);';
  const nameP = document.createElement('p');
  nameP.textContent = clientName || 'المتدرب';
  nameP.style.cssText = 'color:#fff;font-size:1.2rem;font-weight:700;margin-top:14px;';
  const hintP = document.createElement('span');
  hintP.textContent = 'اضغط في أي مكان للإغلاق';
  hintP.style.cssText = 'color:#94a3b8;font-size:0.85rem;margin-top:6px;';
  overlay.appendChild(img);
  overlay.appendChild(nameP);
  overlay.appendChild(hintP);
  document.body.appendChild(overlay);
}
 
function renderAdminPage() {
  // جلب طلبات الدفع
  let payments = state.admin.payments;
 
  // جلب صورة الأدمن الحالية
  const adminAvatar = (state.adminProfile && state.adminProfile.avatar) ||
                      (state.profile && state.profile.avatar) ||
                      (state.currentUser && state.currentUser.avatar) ||
                      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80';
 
  // جلب قائمة المشتركين الفعليين مع صورهم
  let trainees = state.admin.users.filter(u => u.plan).map(u => ({
    id: u.id,
    name: u.name,
    avatar: u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
    phone: u.phone || '',
    plan: u.plan,
    price: u.price || 0,
    joinDate: u.joinDate || '',
    endsAt: Number(u.planEndsAt) || 0,
    status: u.status === 'active' ? 'active' : (u.status === 'expired' ? 'expired' : 'cancelled')
  }));
 
  // المتدربين على التجربة المجانية حالياً
  const trialUsers = state.admin.users
    .filter(u => u.status !== 'active' && Number(u.trialEndsAt) > Date.now())
    .sort((a, b) => Number(a.trialEndsAt) - Number(b.trialEndsAt));
 
  // إحصائيات سريعة للكابتن
  const activeTraineesCount = trainees.filter(t => t.status === 'active').length;
  const pendingCount = payments.filter(p => p.status === 'pending').length;
  const totalRevenue = trainees.filter(t => t.status === 'active').reduce((sum, t) => sum + (Number(t.price) || 0), 0);
 
  return `
    <div style="max-width: 1200px; margin: 30px auto; padding: 20px;">
      
      <!-- ترويسة اللوحة مع صورة الكابتن -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; flex-wrap: wrap; gap: 20px;">
        <div style="display: flex; align-items: center; gap: 20px;">
          <!-- صورة الكابتن مع إمكانية التغيير -->
          <div style="position: relative; display: inline-block; cursor: pointer;" onclick="triggerAdminAvatarUpload()" title="اضغط لتغيير صورتك الشخصية (الكابتن)">
            <img id="adminUserAvatar" src="${escapeHtml(adminAvatar)}" alt="Coach Avatar" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary); display: block; box-shadow: 0 4px 12px rgba(225,29,72,0.2);">
            <div style="position: absolute; bottom: 0; right: 0; background: var(--primary); color: #ffffff; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
              <i class="fa-solid fa-camera"></i>
            </div>
          </div>
          <input type="file" id="adminAvatarInput" accept="image/*" style="display: none;" onchange="handleAdminAvatarChange(event)">
          <div>
            <h2 style="color: #0f172a; font-size: 1.9rem; font-weight: 900; margin-bottom: 4px;">
              <i class="fa-solid fa-crown" style="color: var(--primary);"></i> لوحة تحكم الكابتن — Coach Abdelrahim
            </h2>
            <p class="text-muted">متابعة المتدربين، التحكم في الاشتراكات، وإدارة الإيرادات والتحويلات</p>
          </div>
        </div>
      </div>
 
      <!-- 1. كروت الإحصائيات الذكية -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 35px;">
        <div class="glass-card" style="padding: 20px; display: flex; align-items: center; gap: 18px;">
          <div style="width: 55px; height: 55px; background: #fff1f2; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: var(--primary);">
            <i class="fa-solid fa-users"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #64748b; font-weight: 700;">المتدربين النشطين</span>
            <h3 style="font-size: 1.8rem; font-weight: 900; color: #0f172a;">${activeTraineesCount} <span style="font-size: 0.9rem; font-weight: 600; color: #64748b;">أبطال</span></h3>
          </div>
        </div>
 
        <div class="glass-card" style="padding: 20px; display: flex; align-items: center; gap: 18px;">
          <div style="width: 55px; height: 55px; background: #ecfdf5; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: #10b981;">
            <i class="fa-solid fa-wallet"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #64748b; font-weight: 700;">الدخل الشهري المتوقع</span>
            <h3 style="font-size: 1.8rem; font-weight: 900; color: #10b981;">${totalRevenue} <span style="font-size: 0.9rem; font-weight: 600; color: #64748b;">ج.م</span></h3>
          </div>
        </div>
 
        <div class="glass-card" style="padding: 20px; display: flex; align-items: center; gap: 18px;">
          <div style="width: 55px; height: 55px; background: #fffbeb; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: #f59e0b;">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #64748b; font-weight: 700;">طلبات بانتظار المراجعة</span>
            <h3 style="font-size: 1.8rem; font-weight: 900; color: #f59e0b;">${pendingCount} <span style="font-size: 0.9rem; font-weight: 600; color: #64748b;">طلبات</span></h3>
          </div>
        </div>
      </div>
 
      <!-- على التجربة المجانية -->
      <div class="glass-card" style="padding: 25px; margin-bottom: 35px; overflow-x: auto;">
        <h3 style="color: #0f172a; font-size: 1.3rem; font-weight: 800; margin-bottom: 14px;">
          <i class="fa-solid fa-gift" style="color: var(--primary);"></i> على التجربة المجانية حالياً (${trialUsers.length})
        </h3>
        ${trialUsers.length === 0 ? '<p class="text-muted">لا يوجد متدربين على التجربة حالياً.</p>' : `
        <table style="width: 100%; border-collapse: collapse; text-align: center;">
          <thead>
            <tr style="border-bottom: 2px solid #e2e8f0; color: #0f172a; font-size: 0.95rem; font-weight: 800;">
              <th style="padding: 10px;">الاسم</th>
              <th style="padding: 10px;">البريد</th>
              <th style="padding: 10px;">بدأت</th>
              <th style="padding: 10px;">تنتهي</th>
              <th style="padding: 10px;">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            ${trialUsers.map(u => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px; font-weight: 800; color: #0f172a;">${escapeHtml(u.name)}</td>
                <td style="padding: 12px; direction: ltr; color: #475569;">${escapeHtml(u.email)}</td>
                <td style="padding: 12px; color: #64748b; font-size: 0.9rem;">${new Date(Number(u.trialStartedAt)).toLocaleDateString('ar-EG')}</td>
                <td style="padding: 12px; color: #64748b; font-size: 0.9rem;">${new Date(Number(u.trialEndsAt)).toLocaleDateString('ar-EG')}</td>
                <td style="padding: 12px;"><span class="badge approved">${Math.max(0, Math.ceil((Number(u.trialEndsAt) - Date.now()) / 864e5))} يوم</span></td>
              </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
 
      <!-- 2. جدول المتدربين وإلغاء الاشتراك (الميزة المطلوبة) -->
      <div class="glass-card" style="padding: 25px; margin-bottom: 35px; overflow-x: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="color: #0f172a; font-size: 1.3rem; font-weight: 800;">
            <i class="fa-solid fa-id-badge" style="color: var(--primary);"></i> قائمة المشتركين الفعليين وإدارة الاشتراكات
          </h3>
        </div>
 
        <table style="width: 100%; border-collapse: collapse; text-align: center;">
          <thead>
            <tr style="border-bottom: 2px solid #e2e8f0; color: #0f172a; font-size: 0.95rem; font-weight: 800;">
              <th style="padding: 12px;">الصورة</th>
              <th style="padding: 12px;">اسم المشترك</th>
              <th style="padding: 12px;">رقم الهاتف</th>
              <th style="padding: 12px;">الباقة المشترك بها</th>
              <th style="padding: 12px;">تاريخ البدء</th>
              <th style="padding: 12px;">حالة الحساب</th>
              <th style="padding: 12px;">الإجراء (إلغاء / تفعيل)</th>
            </tr>
          </thead>
          <tbody>
            ${trainees.length === 0 ? `
              <tr><td colspan="7" style="padding: 25px; color: #64748b;">لا يوجد متدربين مسجلين بعد.</td></tr>
            ` : trainees.map(t => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px;">
                  <img src="${escapeHtml(t.avatar)}" alt="${escapeHtml(t.name)}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary); display: inline-block; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.08);" onclick="viewClientPhoto('${escapeHtml(t.avatar)}', '${escapeHtml(t.name)}')" title="اضغط لتكبير الصورة">
                </td>
                <td style="padding: 15px; font-weight: 800; color: #0f172a;">${escapeHtml(t.name)}</td>
                <td style="padding: 15px; direction: ltr; font-weight: 600; color: #475569;">${escapeHtml(t.phone)}</td>
                <td style="padding: 15px;"><span class="badge approved">${escapeHtml(t.plan)}</span></td>
                <td style="padding: 15px; color: #64748b; font-size: 0.9rem;">${escapeHtml(t.joinDate)}${t.endsAt ? '<br><small>ينتهي: ' + new Date(t.endsAt).toLocaleDateString('ar-EG') + '</small>' : ''}</td>
                <td style="padding: 15px;">
                  ${t.status === 'active' 
                    ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> نشط</span>' 
                    : '<span style="background: #fee2e2; color: #b91c1c; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700;"><i class="fa-solid fa-ban"></i> ' + (t.status === 'expired' ? 'منتهي' : 'ملغي') + '</span>'}
                </td>
                <td style="padding: 15px;">
                  <div style="display: flex; gap: 8px; justify-content: center;">
                    ${t.status === 'active' ? `
                      <button onclick="toggleTraineeStatus('${t.id}', 'cancelled')" style="background: #fff; border: 1px solid #ef4444; color: #ef4444; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 0.82rem; cursor: pointer;">
                        إلغاء الاشتراك
                      </button>
                    ` : `
                      <button onclick="toggleTraineeStatus('${t.id}', 'active')" class="btn-gold" style="padding: 6px 12px; border-radius: 6px; font-size: 0.82rem; cursor: pointer;">
                        إعادة التفعيل
                      </button>
                    `}
                    <a href="https://wa.me/2${escapeHtml(t.phone)}" target="_blank" style="background: #25D366; color: #fff; padding: 6px 10px; border-radius: 6px; text-decoration: none; font-size: 0.85rem;" title="محادثة واتساب">
                      <i class="fa-brands fa-whatsapp"></i>
                    </a>
                    <button onclick="sendSubscriptionMessage('${t.id}')" style="background: #25D366; border: none; color: #fff; padding: 6px 10px; border-radius: 6px; font-weight: 700; font-size: 0.82rem; cursor: pointer;" title="إرسال رسالة تأكيد الاشتراك على واتساب">
                      📩 تأكيد
                    </button>
                    <button onclick="giveTraineeFeedback('${t.id}')" style="background: #fff; border: 1px solid var(--primary); color: var(--primary); padding: 6px 10px; border-radius: 6px; font-weight: 700; font-size: 0.82rem; cursor: pointer;" title="تقييم المتدرب">
  ⭐ تقييم
</button>
                    <button onclick="deleteTrainee('${t.id}')" style="background: transparent; border: 1px solid #cbd5e1; color: #64748b; padding: 6px 10px; border-radius: 6px; cursor: pointer;" title="حذف نهائي">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
 
      ${renderAdminVideosSection()}
 
      ${renderAdminLogsSection()}
 
      <!-- 3. جدول مراجعة طلبات الدفع والإيصالات -->
      <div class="glass-card" style="padding: 25px; overflow-x: auto;">
        <h3 style="color: #0f172a; font-size: 1.3rem; font-weight: 800; margin-bottom: 20px;">
          <i class="fa-solid fa-receipt" style="color: var(--primary);"></i> طلبات الدفع المسجلة
        </h3>
 
        <table style="width: 100%; border-collapse: collapse; text-align: center;">
          <thead>
            <tr style="border-bottom: 2px solid #e2e8f0; color: var(--primary); font-size: 0.95rem; font-weight: 800;">
              <th style="padding: 12px;">كود الفاتورة</th>
              <th style="padding: 12px;">المتدرب</th>
              <th style="padding: 12px;">طريقة الدفع</th>
              <th style="padding: 12px;">الرقم المرجعي</th>
              <th style="padding: 12px;">الحالة</th>
              <th style="padding: 12px;">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(item => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px; font-weight: 700; color: #475569;">${item.id}</td>
                <td style="padding: 15px; font-weight: 800; color: #0f172a;">
                  ${(() => {
                    const uDoc = state.admin.users.find(u => u.id === item.uid);
                    const av = (uDoc && uDoc.avatar) || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80';
                    return `
                      <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <img src="${escapeHtml(av)}" alt="${escapeHtml(item.trainee)}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--primary); cursor: pointer;" onclick="viewClientPhoto('${escapeHtml(av)}', '${escapeHtml(item.trainee)}')" title="اضغط لتكبير الصورة">
                        <span>${escapeHtml(item.trainee)}</span>
                      </div>
                    `;
                  })()}
                </td>
                <td style="padding: 15px; color: #334155;">${escapeHtml(item.method)}</td>
                <td style="padding: 15px;">
                  <span style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #0f172a; padding: 5px 12px; border-radius: 8px; font-family: monospace; font-size: 0.95rem; font-weight: 800;">
                    ${escapeHtml(item.ref || '—')}</span>
                  ${item.receipt ? `<button onclick="viewReceipt('${item.id}')" style="background: #fff; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; margin-top: 6px;"><i class="fa-solid fa-image"></i> عرض الإيصال</button>` : ''}
                </td>
                <td style="padding: 15px;">
                  ${item.status === 'pending' ? '<span class="badge pending" style="background: #fef3c7; color: #b45309; padding: 5px 12px; border-radius: 20px; font-weight: 700;">قيد المراجعة</span>' : ''}
                  ${item.status === 'approved' ? '<span class="badge approved" style="background: #dcfce7; color: #15803d; padding: 5px 12px; border-radius: 20px; font-weight: 700;">مقبول ومفعل</span>' : ''}
                  ${item.status === 'rejected' ? '<span class="badge" style="background: #fee2e2; color: #b91c1c; padding: 5px 12px; border-radius: 20px; font-weight: 700;">مرفوض</span>' : ''}
                </td>
                <td style="padding: 15px;">
                  ${item.status === 'pending' ? `
                    <div style="display: flex; gap: 8px; justify-content: center;">
                      <button onclick="updatePaymentStatus('${item.id}', 'approved')" class="btn-gold" style="padding: 6px 14px; font-size: 0.85rem; border-radius: 6px; cursor: pointer;">
                        <i class="fa-solid fa-check"></i> قبول
                      </button>
                      <button onclick="updatePaymentStatus('${item.id}', 'rejected')" style="background: #fff; border: 1px solid #ef4444; color: #ef4444; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                        <i class="fa-solid fa-xmark"></i> رفض
                      </button>
                    </div>
                  ` : `
                    <span style="color: ${item.status === 'approved' ? '#15803d' : '#b91c1c'}; font-size: 0.88rem; font-weight: 700;">
                      ${item.status === 'approved' ? '✓ تم التفعيل وإضافته للأعضاء' : '✗ تم رفض الطلب'}
                    </span>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
 
    </div>
  `;
}
 
// دالة إعطاء تقييم وملاحظات للمتدرب من الكابتن
async function giveTraineeFeedback(uid) {
  const target = state.admin.users.find(u => u.id === uid);
  if (!target) return;
  const rating = parseFloat(prompt('أدخل تقييمك للمتدرب (' + target.name + ') من 5 (مثال: 4.9):', '4.8'));
  if (!isFinite(rating) || rating < 0 || rating > 5) {
    alert('التقييم لازم يكون رقم من 0 إلى 5.');
    return;
  }
  const feedback = prompt('أكتب توجيهك وملاحظتك للمتدرب:', 'استمر على نفس القوة، زود جرامات الكارب أيام تمرين الأرجل!');
  if (!feedback) return;
  // صورة الكابتن بتظهر للمتدرب جنب اسمك في التقييم
  const coachAvatar = (state.adminProfile && state.adminProfile.avatar) ||
                      (state.profile && state.profile.avatar) ||
                      (state.currentUser && state.currentUser.avatar) || '';
  try {
    await db.collection('users').doc(uid).update({
      coachRating: rating,
      coachFeedback: feedback,
      coachFeedbackAvatar: coachAvatar,
      coachFeedbackAt: Date.now()
    });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة، جرّب تاني.');
    return;
  }
  alert('تم إرسال التقييم والملاحظات لصفحة المتدرب بنجاح!');
  handleRoute();
}
 
// دالة إلغاء أو إعادة تفعيل اشتراك متدرب
async function toggleTraineeStatus(uid, newStatus) {
  const target = state.admin.users.find(u => u.id === uid);
  if (!target) return;
  const upd = { status: newStatus };
  if (newStatus === 'active') {
    // إعادة التفعيل/التجديد: مدة جديدة حسب الباقة
    const now = Date.now();
    upd.planStartedAt = now;
    upd.planEndsAt = now + planMonthsByName(target.plan) * 30 * DAY_MS;
  }
  try {
    await db.collection('users').doc(uid).update(upd);
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة، جرّب تاني.');
    return;
  }
  alert(newStatus === 'cancelled' ? 'تم إلغاء اشتراك (' + target.name + ') بنجاح.' : 'تمت إعادة تفعيل اشتراك (' + target.name + ')!');
  handleRoute();
}
 
// دالة حذف متدرب نهائياً
async function deleteTrainee(uid) {
  const target = state.admin.users.find(u => u.id === uid);
  if (!target) return;
  if (!confirm('هيتشال (' + target.name + ') من قائمة المشتركين (حسابه هيفضل موجود كمتدرب غير مفعّل). متأكد؟')) return;
  try {
    await db.collection('users').doc(uid).update({ plan: '', price: 0, status: 'pending', planEndsAt: 0 });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة، جرّب تاني.');
    return;
  }
  handleRoute();
}
 
// دالة قبول أو رفض الدفع وإضافته للمشتركين تلقائياً عند القبول
async function updatePaymentStatus(txnId, newStatus) {
  const target = state.admin.payments.find(p => p.id === txnId);
  if (!target) return;
  let approvedUser = null;
  try {
    if (newStatus === 'approved') {
      if (!target.uid) throw new Error('payment has no uid');
      const planInfo = Object.values(PLANS).find(p => p.code === target.plan) || PLANS.standard;
      const userDoc = state.admin.users.find(u => u.id === target.uid) || {};
      const now = Date.now();
      // لو لسه مشترك، التجديد بيمتد من تاريخ انتهاء اشتراكه الحالي
      const stillActive = userDoc.status === 'active' && Number(userDoc.planEndsAt) > now;
      const startFrom = stillActive ? Number(userDoc.planEndsAt) : now;
      const upd = {
        status: 'active',
        plan: planInfo.name,
        price: target.price || planInfo.price,
        phone: target.phone || '',
        joinDate: stillActive && userDoc.joinDate ? userDoc.joinDate : new Date().toLocaleDateString('ar-EG'),
        planStartedAt: stillActive && userDoc.planStartedAt ? userDoc.planStartedAt : now,
        planEndsAt: startFrom + planInfo.months * 30 * DAY_MS
      };
      await db.collection('users').doc(target.uid).update(upd);
      approvedUser = Object.assign({ name: target.trainee }, userDoc, upd);
    }
    await db.collection('payments').doc(txnId).update({ status: newStatus });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة أثناء تحديث الطلب. تأكد من الاتصال وجرّب تاني.');
    return;
  }
  handleRoute();
  if (approvedUser) {
    // رسالة واتساب للمتدرب بتأكيد الاشتراك
    approvedUser.name = approvedUser.name || target.trainee;
    openSubscriptionWhatsApp(approvedUser);
  } else {
    alert('تم رفض الطلب (' + target.trainee + ').');
  }
}
 
// دالة لتحديث الشاشة فوراً
// دالة تحديث الحالة (قبول أو رفض)
// إرسال رسالة التواصل للكابتن على واتساب
function handleContactSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('contactName').value.trim();
  const phone = document.getElementById('contactPhone').value.trim();
  const msg = document.getElementById('contactMsg').value.trim();
  const body = 'مرحباً كابتن عبد الرحيم 👋\nالاسم: ' + name + '\nرقم الواتساب: ' + phone + '\nالرسالة: ' + msg;
  window.open('https://wa.me/201207908662?text=' + encodeURIComponent(body), '_blank', 'noopener');
}
 
// عرض صورة إيصال الدفع للكابتن
function viewReceipt(id) {
  const p = state.admin.payments.find(x => x.id === id);
  if (!p || !p.receipt) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer;';
  overlay.onclick = () => overlay.remove();
  const img = document.createElement('img');
  img.src = p.receipt;
  img.alt = 'إيصال الدفع';
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:12px;background:#fff;';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}
 
// زرار "اشترك الآن": الزائر يسجّل حساب، والمسجّل يروح يختار باقة
function goToPlans() {
  if ((window.location.hash || '#/') === '#/plans') {
    const el = document.getElementById('plans');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  window.location.hash = '#/plans';
}
 
function subscribeCta(event) {
  if (event) event.preventDefault();
  const user = state.currentUser;
  if (!user) {
    // زائر: يعمل حساب وبعدها يرجع يختار الباقة
    sessionStorage.setItem('afterAuth', '#/plans');
    window.location.hash = '#/register';
    return;
  }
  if (user.role === 'admin') {
    window.location.hash = '#/admin';
    return;
  }
  if (user.role === 'approved') {
    alert('أنت مشترك معانا بالفعل ✅ تقدر تدخل على لوحة المتدرب وتكمل تمرينك.');
    window.location.hash = '#/dashboard';
    return;
  }
  alert('أنت مسجّل معانا بالفعل ✅\nاختار إحدى الباقات واشترك علشان تنضم للأبطال 💪');
  goToPlans();
}
 
// ==================== تفعيل التجربة المجانية (14 يوم) ====================
async function claimFreeTrial() {
  const user = state.currentUser;
  if (!user) {
    // بعد التسجيل/الدخول يرجع هنا ويتفعّل تلقائياً
    sessionStorage.setItem('afterAuth', '#/free-trial');
    alert('سجّل حسابك الأول (دقيقة واحدة) وبعدها تبدأ أسبوعينك المجانيين 🎁');
    window.location.hash = '#/register';
    return;
  }
  if (user.role === 'admin') { window.location.hash = '#/admin'; return; }
  if (user.trial) { window.location.hash = '#/dashboard'; return; }
  if (user.role === 'approved') {
    alert('اشتراكك مفعّل بالفعل ✅');
    window.location.hash = '#/dashboard';
    return;
  }
  if (trialInfo(state.profile).used) {
    alert('التجربة المجانية اتستخدمت قبل كده على الحساب ده. اشترك علشان تكمّل 💪');
    window.location.hash = '#/payment';
    return;
  }
  if (!requireFirebase()) return;
  const now = Date.now();
  const end = now + TRIAL_DAYS * 864e5;
  try {
    await db.collection('users').doc(user.uid).set({ trialStartedAt: now, trialEndsAt: end }, { merge: true });
  } catch (err) {
    console.error(err);
    alert('حصلت مشكلة في تفعيل التجربة، جرّب تاني. لو المشكلة فضلت راجع قواعد Firestore.');
    window.location.hash = '#/dashboard';
    return;
  }
  state.profile = Object.assign({}, state.profile, { trialStartedAt: now, trialEndsAt: end });
  user.role = 'approved';
  user.trial = true;
  updateNav();
  alert('🎉 اتفعّلت تجربتك المجانية لمدة ' + TRIAL_DAYS + ' يوم! دلوقتي تقدر تشوف جدولك وتمارينك.');
  window.location.hash = '#/dashboard';
}
 
// ==================== فاعلية: تحدي الـ 30 يوم (بدل كارت صدر + باي) ====================
function renderChallengeCard(profile) {
  const total = 30;
  const done = Math.min(total, Number(profile.checkIns) || 0);
  const pct = Math.round(done / total * 100);
  const dots = Array.from({ length: total }, (_, n) => `<span class="ch-dot${n < done ? ' on' : ''}">${n + 1}</span>`).join('');
  const msg = done >= total
    ? 'خلّصت التحدي كله! 🏆 كلّم الكابتن علشان تاخد جايزتك.'
    : (done === 0 ? 'ابدأ أول يوم النهاردة وسجّل حضورك.' : 'باقي ' + (total - done) + ' يوم وتخلّص التحدي. كمّل يا بطل 💪');
  const joinMsg = encodeURIComponent('أنا عايز أنضم لجروب الأبطال وتحدي الـ 30 يوم 💪');
  return `
    <div class="glass-card challenge-card" style="padding: 25px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
        <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800;">
          <i class="fa-solid fa-trophy" style="color: var(--primary);"></i> فاعلية: تحدي الـ 30 يوم
        </h3>
        <span class="badge approved">${done} / ${total} يوم</span>
      </div>
      <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 12px;">تمرين يومي + التزام غذائي + متابعة. سجّل حضورك كل يوم، وفيه جوايز للأكثر التزاماً.</p>
      <div class="wk-progress"><div class="wk-bar"><div style="width: ${pct}%"></div></div><span>${pct}%</span></div>
      <div class="ch-dots">${dots}</div>
      <p class="ch-msg">${msg}</p>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button onclick="traineeDailyCheckIn()" class="btn-gold"><i class="fa-solid fa-dumbbell"></i> سجّل حضور اليوم</button>
        <a href="https://wa.me/${COACH_PHONE}?text=${joinMsg}" target="_blank" rel="noopener" class="btn-outline"><i class="fa-brands fa-whatsapp"></i> جروب الأبطال</a>
      </div>
    </div>`;
}
 
// تنبيه قرب انتهاء الاشتراك (آخر 5 أيام)
function subscriptionBanner(sub) {
  if (!sub.paid || sub.daysLeft === null || sub.daysLeft > 5) return '';
  return `
        <div style="background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span><i class="fa-solid fa-hourglass-half"></i> اشتراكك هيخلص بعد <strong>${sub.daysLeft}</strong> يوم (${new Date(sub.end).toLocaleDateString('ar-EG')}). جدّد علشان ما تتوقفش.</span>
          <a href="#/payment" class="btn-gold" style="padding: 8px 18px; font-size: 0.9rem;">تجديد الاشتراك</a>
        </div>`;
}
 
// ==================== أسبوعك مع BodA ====================
function weekDayIcon(plan) {
  if (!plan) return 'fa-bed';
  if (plan.title.includes('رجل')) return 'fa-person-running';
  if (plan.title.includes('دراع')) return 'fa-hand-fist';
  return 'fa-dumbbell';
}
 
// ترتيب اليوم الحالي داخل WEEK_SCHEDULE (السبت = 0 ... الجمعة = 6)
function todayWeekIndex() {
  return (new Date().getDay() + 1) % 7;
}
 
function weekDetailHtml(i, locked) {
  const d = WEEK_SCHEDULE[i];
  if (!d) return '';
  if (locked) {
    const used = trialInfo(state.profile).used;
    return `<div class="week-lock"><i class="fa-solid fa-lock"></i> تمارين اليوم بتتفتح بعد تفعيل اشتراكك. ${used ? '' : '<a href="#/free-trial" class="gold-text">ابدأ تجربتك المجانية</a> أو '}<a href="#/payment" class="gold-text">أتمم الاشتراك</a></div>`;
  }
  if (d.rest) {
    return `<div class="week-detail-in"><h4><i class="fa-solid fa-bed gold-text"></i> ${d.label} — يوم راحة واسترجاع</h4><p class="text-muted">العضلة بتكبر وانت بترتاح. نام كويس، اشرب مية، وحافظ على أكلك.</p></div>`;
  }
  const plan = WORKOUT_PLAN[d.day];
  return `
    <div class="week-detail-in">
      <h4><i class="fa-solid ${weekDayIcon(plan)} gold-text"></i> ${d.label} — ${plan.title}</h4>
      <ol class="week-ex">${plan.exercises.map(ex => `<li>${ex}</li>`).join('')}</ol>
      <p class="text-muted week-note"><i class="fa-solid fa-circle-info"></i> ${WORKOUT_NOTE}</p>
      <a href="#/workouts" class="btn-gold" style="margin-top: 12px; padding: 8px 18px; font-size: 0.9rem;"><i class="fa-solid fa-play"></i> ابدأ التمرين التفاعلي</a>
    </div>`;
}
 
function showWeekDay(i) {
  const card = document.getElementById('weekCard');
  if (!card) return;
  card.querySelectorAll('.week-day').forEach(b => b.classList.toggle('active', Number(b.dataset.week) === i));
  document.getElementById('weekDetail').innerHTML = weekDetailHtml(i, card.dataset.locked === '1');
}
 
function renderWeekWithBoda(locked) {
  const today = todayWeekIndex();
  const cards = WEEK_SCHEDULE.map((d, i) => {
    const plan = d.rest ? null : WORKOUT_PLAN[d.day];
    const short = plan ? plan.title.split(':')[1].trim() : 'راحة واسترجاع';
    return `
      <button type="button" class="week-day${i === today ? ' active' : ''}${d.rest ? ' rest' : ''}" data-week="${i}" onclick="showWeekDay(${i})">
        ${i === today ? '<em class="week-today">اليوم</em>' : ''}
        <b>${d.label}</b>
        <i class="fa-solid ${weekDayIcon(plan)}"></i>
        <span>${short}</span>
      </button>`;
  }).join('');
  return `
    <div class="glass-card week-card" id="weekCard" data-locked="${locked ? 1 : 0}" style="padding: 25px;">
      <h3 style="color: #0f172a; font-size: 1.25rem; font-weight: 800; margin-bottom: 4px;">
        <i class="fa-solid fa-calendar-week" style="color: var(--primary);"></i> أسبوعك مع BodA
      </h3>
      <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 16px;">اضغط على أي يوم وشوف تمارينه.</p>
      <div class="week-grid">${cards}</div>
      <div class="week-detail" id="weekDetail" aria-live="polite">${weekDetailHtml(today, locked)}</div>
    </div>`;
}
 
// ==================== حاسبة السعرات (داخل صفحة المشترك) ====================
// renderCalorieCalculator و calculateCalories موجودين في features.js
 
 
 
// ==================== عدّاد العرض (الصفحة الرئيسية) ====================
let promoTimer;
function startPromoCountdown() {
  clearInterval(promoTimer);
  const box = document.getElementById('promoCountdown');
  if (!box) return;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v).padStart(2, '0');
  };
  const tick = () => {
    const d = PROMO_END - Date.now();
    if (d <= 0) { box.style.display = 'none'; clearInterval(promoTimer); return; }
    set('cdD', Math.floor(d / 864e5));
    set('cdH', Math.floor(d % 864e5 / 36e5));
    set('cdM', Math.floor(d % 36e5 / 6e4));
    set('cdS', Math.floor(d % 6e4 / 1e3));
  };
  tick();
  promoTimer = setInterval(tick, 1000);
}
 
// بدء تشغيل التطبيق
if (!fbConfigured) {
  // بدون Firebase: الصفحات العامة تشتغل، والدخول/الدفع يطلعوا رسالة إعداد
  initRouter();
} else {
  let firstAuthEvent = true;
  auth.onAuthStateChanged(async fbUser => {
    if (state.suppressAuth) return;
    await applyAuthUser(fbUser);
    const wasFirst = firstAuthEvent;
    firstAuthEvent = false;
    if (wasFirst) initRouter();
    const hash = window.location.hash || '#/';
    if (state.currentUser && state.currentUser.role === 'admin' && hash === '#/dashboard') {
      window.location.hash = '#/admin';
    } else if (state.currentUser && hash === '#/login') {
      window.location.hash = postAuthTarget();
    } else if (!wasFirst) {
      handleRoute();
    }
  });
}