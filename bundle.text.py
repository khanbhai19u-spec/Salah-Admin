#!/usr/bin/env python3
"""
Salah Time — GitHub build + auto-update bundle
-----------------------------------------------
Flutter প্রজেক্টের রুট ফোল্ডারে (যেখানে pubspec.yaml আছে) এই ফাইল রেখে চালাও:

    python bundle.text.py

এটা যা করবে:
  1. .github/workflows/build.yml বানাবে (tag push করলে APK build + GitHub Release)
  2. lib/update_checker.dart বানাবে (Firestore config/app থেকে আপডেট ডায়ালগ)
  3. .gitignore এ key.properties ও *.jks যোগ করবে
  4. android/app/build.gradle(.kts) এ release signing বসাবে (ব্যাকআপ .bak সহ)
  5. AndroidManifest এ INTERNET permission না থাকলে যোগ করবে
  6. flutter pub add দিয়ে প্যাকেজ যোগ করবে (flutter থাকলে)

কোনো ফাইল আগে থেকে থাকলে ব্যাকআপ (.bak) রেখে বদলায়। দুবার চালালেও সমস্যা নেই।
"""
import os
import re
import shutil
import subprocess
import sys

# ------------------------------------------------------------------ files

WORKFLOW = r"""name: Build & Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '17' }
      - uses: subosito/flutter-action@v2
        with: { channel: stable, cache: true }
      - name: Signing key
        run: |
          echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > android/app/upload-keystore.jks
          cat > android/key.properties <<EOF
          storePassword=${{ secrets.KEYSTORE_PASSWORD }}
          keyPassword=${{ secrets.KEY_PASSWORD }}
          keyAlias=${{ secrets.KEY_ALIAS }}
          storeFile=upload-keystore.jks
          EOF
      - run: flutter pub get
      - name: Build APK
        run: |
          VER="${GITHUB_REF_NAME#v}"
          flutter build apk --release --build-name="$VER" --build-number="${{ github.run_number }}"
      - uses: softprops/action-gh-release@v2
        with:
          files: build/app/outputs/flutter-apk/app-release.apk
          generate_release_notes: true
"""

UPDATE_CHECKER = r"""import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

const _repo = '__REPO__';

List<int> _v(String s) =>
    s.split('+').first.split('.').map((e) => int.tryParse(e) ?? 0).toList();

int _cmp(String a, String b) {
  final x = _v(a), y = _v(b);
  for (var i = 0; i < 3; i++) {
    final p = i < x.length ? x[i] : 0, q = i < y.length ? y[i] : 0;
    if (p != q) return p.compareTo(q);
  }
  return 0;
}

/// হোম স্ক্রিনের initState এ:
/// WidgetsBinding.instance.addPostFrameCallback((_) => checkForUpdate(context));
Future<void> checkForUpdate(BuildContext context) async {
  try {
    final d = (await FirebaseFirestore.instance.doc('config/app').get()).data();
    if (d == null) return;
    final cur = (await PackageInfo.fromPlatform()).version;
    final latest = (d['version'] ?? '').toString();
    final minV = (d['minVersion'] ?? '').toString();
    final force = minV.isNotEmpty && _cmp(cur, minV) < 0;
    if (!force && (latest.isEmpty || _cmp(cur, latest) >= 0)) return;
    final link = (d['updateUrl'] ?? '').toString().trim();
    final url = link.isNotEmpty
        ? link
        : 'https://github.com/$_repo/releases/latest/download/app-release.apk';
    if (!context.mounted) return;
    await showDialog(
      context: context,
      barrierDismissible: !force,
      builder: (ctx) => PopScope(
        canPop: !force,
        child: AlertDialog(
          title: const Text('নতুন আপডেট'),
          content: Text('${d['changelog'] ?? ''}\n\nনতুন ভার্সন: $latest'),
          actions: [
            if (!force)
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('পরে'),
              ),
            FilledButton(
              onPressed: () => launchUrl(
                Uri.parse(url),
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('আপডেট করুন'),
            ),
          ],
        ),
      ),
    );
  } catch (_) {}
}
"""

GROOVY_HEADER = """def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

"""
GROOVY_SIGNING = """    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
"""

KTS_IMPORTS = "import java.io.FileInputStream\nimport java.util.Properties\n\n"
KTS_HEADER = """val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

"""
KTS_SIGNING = """    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = keystoreProperties["storeFile"]?.let { file(it as String) }
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }
"""

# ------------------------------------------------------------------ helpers


def say(msg):
    print(msg)


def backup(path):
    if os.path.exists(path) and not os.path.exists(path + ".bak"):
        shutil.copy2(path, path + ".bak")


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    backup(path)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    say("  ✔ " + path)


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def detect_repo():
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"], stderr=subprocess.DEVNULL
        ).decode().strip()
        m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?$", url)
        if m:
            return m.group(1)
    except Exception:
        pass
    return ""


def ask_repo():
    guess = detect_repo()
    if len(sys.argv) > 1:
        return sys.argv[1]
    hint = f" [{guess}]" if guess else " (যেমন mybayzid/Salah-Time-Bd-)"
    v = input("GitHub repo (username/repo)" + hint + ": ").strip() or guess
    if "/" not in v:
        v = (v or "YOUR_GITHUB_USERNAME") + "/Salah-Time-Bd-"
    return v


# ------------------------------------------------------------------ steps


def step_gitignore():
    p = ".gitignore"
    cur = read(p) if os.path.exists(p) else ""
    add = [l for l in ("android/key.properties", "*.jks", "*.keystore") if l not in cur]
    if add:
        backup(p)
        with open(p, "a", encoding="utf-8") as f:
            if cur and not cur.endswith("\n"):
                f.write("\n")
            f.write("\n".join(add) + "\n")
    say("  ✔ .gitignore")


def step_gradle():
    groovy = "android/app/build.gradle"
    kts = "android/app/build.gradle.kts"
    path = groovy if os.path.exists(groovy) else kts if os.path.exists(kts) else None
    if not path:
        say("  ✘ android/app/build.gradle পাওয়া যায়নি — signing হাতে বসাতে হবে")
        return
    src = read(path)
    if "key.properties" in src:
        say("  ✔ " + path + " (signing আগেই বসানো আছে)")
        return
    is_kts = path.endswith(".kts")
    header = KTS_HEADER if is_kts else GROOVY_HEADER
    signing = KTS_SIGNING if is_kts else GROOVY_SIGNING

    m = re.search(r"^android\s*\{[ \t]*\n", src, re.M)
    if not m:
        say("  ✘ " + path + " এ `android {` ব্লক পাওয়া যায়নি — হাতে বসাতে হবে")
        return
    out = src[: m.start()] + header + src[m.start() : m.end()] + signing + src[m.end() :]

    if is_kts:
        out = re.sub(
            r'signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)',
            'signingConfig = signingConfigs.getByName("release")',
            out,
        )
        if not out.startswith("import java.io.FileInputStream"):
            out = KTS_IMPORTS + out
    else:
        out = re.sub(
            r"signingConfig\s+signingConfigs\.debug",
            "signingConfig signingConfigs.release",
            out,
        )

    if "signingConfigs.release" not in out and 'getByName("release")' not in out:
        say("  ⚠ " + path + ": buildTypes.release এ signingConfig বদলাইনি — নিজে `release` বসাও")
    write(path, out)


def step_manifest():
    p = "android/app/src/main/AndroidManifest.xml"
    if not os.path.exists(p):
        return
    src = read(p)
    if "android.permission.INTERNET" in src:
        say("  ✔ INTERNET permission আছে")
        return
    out = re.sub(
        r"(\s*)<application",
        r'\1<uses-permission android:name="android.permission.INTERNET"/>\1<application',
        src,
        count=1,
    )
    write(p, out)


def step_pub():
    if not shutil.which("flutter"):
        say("  ⚠ flutter পাওয়া যায়নি — নিজে চালাও:")
        say("    flutter pub add cloud_firestore package_info_plus url_launcher")
        return
    subprocess.call(
        ["flutter", "pub", "add", "cloud_firestore", "package_info_plus", "url_launcher"]
    )


def main():
    if not os.path.exists("pubspec.yaml"):
        sys.exit("pubspec.yaml পাওয়া যায়নি — Flutter প্রজেক্টের রুট ফোল্ডারে চালাও।")
    repo = ask_repo()
    say("\nবানানো হচ্ছে…")
    write(".github/workflows/build.yml", WORKFLOW)
    write("lib/update_checker.dart", UPDATE_CHECKER.replace("__REPO__", repo))
    step_gitignore()
    step_gradle()
    step_manifest()
    step_pub()

    say(
        f"""
==================== বাকি কাজ (একবারই) ====================
১) কী বানাও (কম্পিউটারে):
     keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
     base64 -w0 upload-keystore.jks        (Windows: certutil -encode)
   ⚠ .jks ফাইলের ব্যাকআপ রাখো, কী কখনো বদলাবে না।

২) https://github.com/{repo}/settings/secrets/actions এ ৪টা Secret:
     KEYSTORE_BASE64   = base64 আউটপুট
     KEYSTORE_PASSWORD = কী-স্টোর পাসওয়ার্ড
     KEY_PASSWORD      = কী পাসওয়ার্ড
     KEY_ALIAS         = upload

৩) হোম স্ক্রিনের initState এ:
     import 'update_checker.dart';
     WidgetsBinding.instance.addPostFrameCallback((_) => checkForUpdate(context));

৪) নতুন ভার্সন ছাড়তে:
     git add . && git commit -m "release" && git push
     git tag v1.0.6 && git push origin v1.0.6
   → Actions APK বানিয়ে Release এ দেবে।
   → তারপর অ্যাডমিন প্যানেলে "সর্বশেষ ভার্সন" 1.0.6 ও changelog সেভ করো।

৫) Firestore Rules: config/{{d}} এ read সবার জন্য, write শুধু অ্যাডমিন UID।
==========================================================="""
    )


if __name__ == "__main__":
    main()
