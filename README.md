# הקניות שלנו – מדריך התקנה

אפליקציית רשימת קניות משותפת לשני אייפונים. רצה מאתר חינמי (GitHub Pages), שומרת נתונים ב-Firebase ורושמת כל קנייה ב-Google Sheets.

## מה יש בתיקייה
| קובץ | מה הוא עושה |
|---|---|
| `index.html`, `app.js` | האפליקציה עצמה |
| `config.js` | **כאן מדביקים את הגדרות Firebase** |
| `manifest.webmanifest`, `sw.js`, `icons/` | התקנה למסך הבית ועבודה בלי אינטרנט |
| `firestore.rules` | כללי אבטחה – מדביקים ב-Firebase Console |
| `apps-script.gs` | קוד לגיליון – מדביקים ב-Apps Script |

## 1. Firebase (כ-5 דקות)
1. נכנסים ל-https://console.firebase.google.com ← **Create a project** (אפשר לכבות Google Analytics).
2. **Build → Firestore Database → Create database** ← Production mode ← אזור `eur3` או `europe-west`.
3. בלשונית **Rules** מדביקים את התוכן של `firestore.rules`, מחליפים את שני המיילים במיילים שלכם (אותיות קטנות) ← **Publish**.
4. **Build → Authentication → Get started → Email/Password** ← Enable ← Save.
5. בלשונית **Users** ← **Add user** פעמיים: אחד לך ואחד לבת הזוג (אותם מיילים שבכללים, וסיסמה לבחירתכם).
6. ⚙️ **Project settings → General → Your apps** ← אייקון `</>` (Web) ← שם כלשהו ← **Register app**. מעתיקים את האובייקט `firebaseConfig` ומדביקים אותו ב-`config.js` במקום הערכים `PASTE`.

## 2. GitHub Pages (כ-5 דקות)
1. נכנסים ל-https://github.com ← **New repository** ← שם, למשל `shopping` ← Public ← Create.
2. **Add file → Upload files** ← גוררים את **כל התוכן** של התיקייה (כולל `icons`) ← Commit.
3. **Settings → Pages** ← Source: *Deploy from a branch* ← Branch: `main` / `(root)` ← Save.
4. אחרי דקה-שתיים האתר זמין בכתובת `https://<שם-המשתמש>.github.io/shopping/`.
5. חוזרים ל-Firebase: **Authentication → Settings → Authorized domains** ← **Add domain** ← `<שם-המשתמש>.github.io`.

## 3. Google Sheets (כ-5 דקות)
1. פותחים גיליון חדש ב-https://sheets.new.
2. **Extensions → Apps Script** ← מוחקים את מה שיש ומדביקים את `apps-script.gs` ← שמירה.
3. **Deploy → New deployment** ← סוג **Web app** ← Execute as: **Me** ← Who has access: **Anyone** ← Deploy ← מאשרים הרשאות (Advanced → Go to… אם מופיעה אזהרה).
4. מעתיקים את ה-**Web app URL** (מסתיים ב-`/exec`).
5. באפליקציה: ⚙️ הגדרות ← מדביקים את הכתובת (ואם רוצים גם את קישור הגיליון) ← **בדיקת חיבור** ← **שמירה**.

## 4. באייפון
פותחים את כתובת האתר ב**ספארי** ← כפתור השיתוף ← **הוספה למסך הבית** ← מתחברים עם המייל והסיסמה. אותו דבר באייפון של בת הזוג.

## עדכונים
כדי לעדכן קבצים מעלים אותם שוב ל-GitHub (Upload files ← מחליף). כדי שהאייפון יקבל גרסה חדשה מיד, מעלים את מספר הגרסה בשורה `CACHE = 'shopping-v1'` בקובץ `sw.js`.

## עלות
הכול בחינם: Firebase בתוכנית Spark, GitHub Pages ו-Google Sheets. התמונות נשמרות דחוסות בתוך Firestore, בלי שירות אחסון בתשלום.
