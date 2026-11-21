# ইন্টারনেট থেকে আনুন — Worker সেটআপ

এই Worker এডমিন প্যানেলের "ইন্টারনেট থেকে আনুন" পেজের জন্য। এটা শুধু খোঁজে আর পেজের নিজের শিরোনাম, ছবি ও লেখা পড়ে আনে। কোনো লেখা নিজে বানায় না।
আপনার আগের নোটিফিকেশন Worker যেমন আছে তেমনই থাকবে। এটা আলাদা একটা Worker।

## ১. Worker বানান
1. dash.cloudflare.com → Workers & Pages → Create → Worker, নাম দিন `salah-import`।
2. Edit code-এ `import-worker.js` ফাইলের পুরো লেখা বসিয়ে Deploy করুন।
3. Settings → Triggers → Cron Triggers → `7 * * * *` যোগ করুন (প্রতি ঘণ্টায় একবার)।

## ২. Variables (Settings → Variables and Secrets)
সাধারণ variable:
- `PROJECT_ID` = `salah-time-fe99b`
- `ADMIN_UID` = এডমিনের uid (এডমিন প্যানেলের সেটিংসে আছে)

Secret (Type: Secret বেছে নিন, চ্যাটে বা কোডে কখনো দেবেন না):
- `GOOGLE_API_KEY`: console.cloud.google.com → APIs & Services → Credentials → Create API key।
  একই প্রজেক্টে **YouTube Data API v3** চালু করুন (ভিডিও খোঁজার জন্য, ফ্রি)।
- `GOOGLE_CX` (ঐচ্ছিক): programmablesearchengine.google.com-এ একটা সার্চ ইঞ্জিন বানিয়ে তার ID, আর **Custom Search API** চালু করুন।
  না দিলেও চলবে: তখন ওয়েব খোঁজায় বাংলা উইকিপিডিয়া আর Google News থেকে ফল আসবে।
- `FIREBASE_SA`: Firebase Console → Project settings → Service accounts → Generate new private key।
  যে JSON ফাইল নামবে তার পুরো লেখা এখানে বসান। এটা দিয়ে প্রতি ঘণ্টার কাজ Firestore-এ লেখে।

## ৩. এডমিন প্যানেলে
সেটিংস → "ইমপোর্ট Worker URL"-এ Worker-এর লিংক দিন (যেমন `https://salah-import.<আপনার-নাম>.workers.dev`)।

## প্রতি ঘণ্টায় যা হয়
- আজকের হাদিস (বুখারী, মুসলিম, তিরমিযী, আবু দাউদ; বাংলা) সরাসরি অ্যাপের "আজকের হাদিস"-এ বসে যায়।
- আজকের আয়াত (বাংলা অর্থসহ) হোম পেজে কার্ড হয়ে আসে।
- আপনার দেওয়া নিউজ ফিড থেকে খবর "ইনবক্স"-এ জমা হয়। আপনি দেখে অনুমোদন দিলে তবেই অ্যাপে যাবে।
এগুলো এডমিনের "ইন্টারনেট থেকে আনুন → সেটিংস" থেকে বন্ধ-চালু করা যায়।
