import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 오늘 시각 기준 새 캐시버스팅 버전 문자열 생성 (YYYYMMDD_HHmm) */
export function newCacheVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${date}_${time}`;
}

/**
 * 업로드 대상 CSS/JS 파일을 참조하는 HTML(매니페스트 전체 대상)의 `?time=` 값을 자동 갱신한다.
 *
 * 파일명(basename) 기준으로 `<link>`/`<script>`의 `?time=...`를 새 버전으로 치환 —
 * 사람이 손으로 안 바꿔도 되게, 업로드 파이프라인 안에서 자동 실행된다.
 *
 * 스캔 대상은 매니페스트 전체 HTML이다(allManifestFiles) — CSS/JS만 고치고 그걸 참조하는
 * HTML은 안 건드린 경우에도 참조가 실제로 다 갱신되도록 하기 위함(예: common.css만
 * 고쳐도 그걸 부르는 header.html/footer.html의 ?time=이 같이 갱신돼야 함).
 * allManifestFiles는 no-upload.txt로 걸러진 목록(loadDeployManifest 결과)이라 다른 사람이
 * 작업 중인 잠긴 파일은 여기 안 들어있으므로 자동으로 제외된다.
 *
 * 리턴: { touched: 실제로 갱신된 HTML 상대경로 목록, version: 새로 부여한 버전 문자열 }
 */
export function bumpCacheBusting(localRoot, allManifestFiles, changedRelPaths) {
  const assetSet = new Set(changedRelPaths.filter((f) => f.endsWith('.css') || f.endsWith('.js')));
  if (assetSet.size === 0) {
    return { touched: [], version: null };
  }

  const version = newCacheVersion();
  const htmlFiles = allManifestFiles.filter((f) => f.endsWith('.html'));
  const touched = [];

  for (const rel of htmlFiles) {
    const abs = join(localRoot, rel);
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    let changed = false;
    for (const assetRel of assetSet) {
      const filename = assetRel.split('/').pop();
      const re = new RegExp(`(${escapeRegex(filename)}\\?time=)[^"'\\s]*`, 'g');
      const next = content.replace(re, `$1${version}`);
      if (next !== content) {
        content = next;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(abs, content, 'utf8');
      touched.push(rel);
    }
  }

  return { touched, version };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
