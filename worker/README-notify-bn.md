# নোটিফিকেশন Worker — সেটআপ ও সমস্যা সমাধান

এডমিন প্যানেল থেকে "সবাইকে পাঠান" চাপলে এই Worker Firebase Cloud Messaging দিয়ে সব ফোনে নোটিফিকেশন পাঠায়।
অ্যাপ চালু হলেই নিজে থেকে "all" নামের গ্রুপে যুক্ত হয়, Worker সেই গ্রুপে পাঠায়।

## বসানো / পুরনোটা বদলানো
1. dash.cloudflare.com → Workers & Pages → আপনার নোটিফিকেশন Worker → Edit code।
2. `notify-worker.js`-এর পুরো লেখা বসিয়ে Deploy করুন।
3. Settings → Variables and Secrets:
   - সাধারণ variable: `PROJECT_ID` = `salah-time-fe99b`, `ADMIN_UID` = এডমিনের uid
   - Secret: `FIREBASE_SA` = Firebase Console → Project settings → Service accounts → Generate new private key, নামানো JSON-এর পুরো লেখা।
4. console.cloud.google.com → এই প্রজেক্ট → APIs & Services → "Firebase Cloud Messaging API" চালু (Enabled) আছে কিনা দেখুন।

## নোটিফিকেশন না এলে
1. এডমিন → নোটিফিকেশন → "Worker পরীক্ষা" চাপুন। কোথায় সমস্যা, সরাসরি লিখে দেখাবে।
2. অ্যাপ → সেটিংস → আজান ডায়াগনস্টিক → "টোকেন কপি" করে এডমিনের ঘরে দিন, "শুধু এই ফোনে পাঠান" চাপুন।
3. Worker ঠিক থাকলেও ফোনে না এলে ফোনেই সমস্যা:
   - নোটিফিকেশনের অনুমতি বন্ধ
   - ব্যাটারি সেভার অ্যাপ বন্ধ করে রাখছে (Xiaomi, Oppo, Vivo, Realme)
   - ফোনে Google Play Services নেই বা পুরনো
