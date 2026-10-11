# إعدادات Firebase للميزات الجديدة

الميزات الجديدة (رسالة بعد التمرين، فيديو الأداء، التقرير الشهري، انتهاء الباقة) محتاجة 3 حاجات في Firebase Console:

## 1) تفعيل Storage (لفيديوهات الأداء)
- Firebase Console ← **Storage** ← Get started.
- تأكد إن `storageBucket` موجود في `firebase-config.js`.

## 2) قواعد Firestore (أضف الأجزاء دي جوه `match /databases/{database}/documents`)

```
function isAdmin() {
  return request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}

// رسائل المتدرب بعد كل يوم تمرين (وبتتستخدم في التقرير الشهري)
match /workoutLogs/{id} {
  allow create, update: if request.auth != null && request.resource.data.uid == request.auth.uid;
  allow read: if request.auth != null && (resource.data.uid == request.auth.uid || isAdmin());
}

// فيديوهات الأداء: صاحب الفيديو والكابتن بس
match /videos/{id} {
  allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
  allow read: if request.auth != null && (resource.data.uid == request.auth.uid || isAdmin());
  allow update: if isAdmin();   // رد الكابتن
  allow delete: if request.auth != null && (resource.data.uid == request.auth.uid || isAdmin());
}
```

**مهم للأمان:** عدّل قاعدة `users/{uid}` بحيث المتدرب ما يقدرش يغيّر `status` و `plan` و `planEndsAt` بنفسه (الكابتن بس هو اللي يغيّرهم)، وإلا حد يقدر يفعّل اشتراكه من الكونسول.

## 3) قواعد Storage

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /videos/{uid}/{file} {
      allow read: if request.auth != null &&
        (request.auth.uid == uid ||
         firestore.exists(/databases/(default)/documents/admins/$(request.auth.uid)));
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.size < 50 * 1024 * 1024
        && request.resource.contentType.matches('video/.*');
      allow delete: if request.auth != null &&
        (request.auth.uid == uid ||
         firestore.exists(/databases/(default)/documents/admins/$(request.auth.uid)));
    }
  }
}
```

(أول مرة تنشر القواعد دي Firebase ممكن يطلب منك تدي Storage صلاحية قراءة Firestore — وافق.)

## ملاحظات
- **انتهاء الباقة:** كل اشتراك بيتحفظ له `planEndsAt` (30 يوم للشهر). بعد التاريخ ده المتدرب بيرجع تلقائياً لوضع "غير مفعّل"، وحالته في لوحة الكابتن بتتحول لـ "منتهي" أول ما تفتح اللوحة. المشتركين اللي اتفعّلوا قبل التحديث ملهمش تاريخ انتهاء، فيفضلوا مفعّلين لحد ما تلغي اشتراكهم أو تجدده من اللوحة (ساعتها بيتحسب لهم تاريخ).
- **التقرير الشهري PDF:** بيتولّد من المتصفح (زرار "تحميل PDF" ← "حفظ كـ PDF"). مفيش إرسال تلقائي بإيميل لأن ده محتاج سيرفر.
- **رسائل واتساب:** بتفتح محادثة جاهزة (wa.me) وإنت اللي بتدوس إرسال. مرفقات InBody بيبعتها المتدرب يدوي بعد ما المحادثة تتفتح.
