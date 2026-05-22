#!/usr/bin/env node
/**
 * Build the OTA manifest by querying GitHub Releases API for each Tuga app.
 *
 * Output:  public/api/manifest.json
 *
 * Format:
 *   {
 *     "version": 1,
 *     "generated_at": "ISO 8601 UTC",
 *     "ecosystem": "miktuga/tuga",
 *     "apps": [
 *       {
 *         "package": "com.miktuga.store",
 *         "name": "Tuga Store",
 *         "repo": "MikTuga/tugastore",
 *         "versionName": "0.2.1",
 *         "versionCode": 3,
 *         "minSdk": 22,
 *         "tag": "v0.2.1",
 *         "url": "https://github.com/.../releases/download/v0.2.1/tugastore-release.apk",
 *         "sha256": "...",          // computed if APK is downloaded; null otherwise
 *         "size": 4995229,
 *         "releasedAt": "ISO 8601",
 *         "changelog": "..."        // truncated to ~400 chars from release notes
 *       },
 *       ...
 *     ]
 *   }
 *
 * Sign the output with `sign-manifest.js` before publishing.
 *
 * Auth: optionally set GITHUB_TOKEN env var for higher rate limits (5000/hr vs 60/hr).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APPS = [
  { repo: 'MikTuga/tugastore',    package: 'com.miktuga.store',    name: 'Tuga Store',    apkPattern: /tugastore.*\.apk$/i,    central: true },
  { repo: 'MikTuga/tugasettings', package: 'com.miktuga.settings', name: 'Tuga Settings', apkPattern: /tugasettings.*\.apk$/i, central: true },
  { repo: 'MikTuga/tugaobd',      package: 'com.miktuga.obd',      name: 'Tuga OBD',      apkPattern: /tugaobd.*\.apk$/i,      central: false },
  { repo: 'MikTuga/tugagps',      package: 'com.miktuga.gps',      name: 'Tuga GPS',      apkPattern: /tugagps.*\.apk$/i,      central: false },
  { repo: 'MikTuga/tugamedia',    package: 'com.miktuga.media',    name: 'Tuga Media',    apkPattern: /tugamedia.*\.apk$/i,    central: false },
  { repo: 'MikTuga/tugasync',     package: 'com.miktuga.sync',     name: 'Tuga Sync',     apkPattern: /tugasync.*\.apk$/i,     central: false },
];

const TOKEN = process.env.GITHUB_TOKEN;
const COMPUTE_HASHES = process.argv.includes('--with-hashes');
const OUT_PATH = path.resolve(__dirname, '..', 'public', 'api', 'manifest.json');

async function gh(url) {
  const headers = { 'User-Agent': 'miktuga-manifest-generator', Accept: 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}\n${await res.text()}`);
  return res.json();
}

async function fetchLatestRelease(repo) {
  try {
    return await gh(`https://api.github.com/repos/${repo}/releases/latest`);
  } catch (e) {
    if (String(e).includes('404')) {
      console.warn(`  [skip] ${repo}: no releases yet`);
      return null;
    }
    throw e;
  }
}

function parseSemver(tag) {
  const m = tag.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { versionName: `${m[1]}.${m[2]}.${m[3]}`, raw: tag };
}

async function downloadAndHash(url, label) {
  console.log(`  [hash] downloading ${label}...`);
  const res = await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256: sha, size: buf.length };
}

(async () => {
  console.log(`Fetching latest releases for ${APPS.length} apps...`);
  if (!TOKEN) console.warn('  ⚠ no GITHUB_TOKEN set — limited to 60 requests/hour');

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    ecosystem: 'miktuga/tuga',
    apps: [],
  };

  for (const app of APPS) {
    console.log(`  ${app.repo}`);
    const release = await fetchLatestRelease(app.repo);
    if (!release) continue;

    const apkAsset = (release.assets || []).find(a => app.apkPattern.test(a.name));
    if (!apkAsset) {
      console.warn(`    [skip] no APK matching ${app.apkPattern} in release ${release.tag_name}`);
      continue;
    }

    const ver = parseSemver(release.tag_name);
    if (!ver) {
      console.warn(`    [skip] cannot parse tag ${release.tag_name} as semver`);
      continue;
    }

    let hashInfo = { sha256: null, size: apkAsset.size };
    if (COMPUTE_HASHES) {
      hashInfo = await downloadAndHash(apkAsset.browser_download_url, `${app.name} v${ver.versionName}`);
    }

    const changelog = (release.body || '')
      .replace(/\r\n/g, '\n')
      .trim()
      .slice(0, 400);

    out.apps.push({
      package: app.package,
      name: app.name,
      repo: app.repo,
      central: app.central,
      versionName: ver.versionName,
      tag: release.tag_name,
      minSdk: 22,
      url: apkAsset.browser_download_url,
      sha256: hashInfo.sha256,
      size: hashInfo.size,
      releasedAt: release.published_at,
      changelog,
    });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('');
  console.log(`✓ Wrote ${OUT_PATH} (${out.apps.length} apps)`);
  console.log(`  Next: node scripts/sign-manifest.js`);
})().catch(err => {
  console.error('✗ Manifest generation failed:', err);
  process.exit(1);
});
