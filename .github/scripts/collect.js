/**
 * AICUT 신규 기업 자동 수집 스크립트
 * GitHub Actions에서 매일 오전 9시 실행
 * 사람인/잡코리아 크롤링 → Firebase Firestore 저장
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── Firebase 초기화 ──
const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore(app);
const COL = 'companies';

// ── 수집 소스 정의 ──
const SOURCES = [
  {
    name: '사람인',
    urls: [
      'https://www.saramin.co.kr/zf_user/search?searchword=영상편집&recruitPage=1',
      'https://www.saramin.co.kr/zf_user/search?searchword=숏폼편집&recruitPage=1',
      'https://www.saramin.co.kr/zf_user/search?searchword=영상제작&recruitPage=1',
    ],
    parse: ($) => {
      const items = [];
      $('.item_recruit').each((_, el) => {
        const company = $(el).find('.corp_name a').text().trim();
        const title   = $(el).find('.job_tit a').attr('title')?.trim() || $(el).find('.job_tit a').text().trim();
        const href    = $(el).find('.job_tit a').attr('href') || '';
        const link    = href.startsWith('http') ? href : 'https://www.saramin.co.kr' + href;
        if (company && title) items.push({ company, summary: title, link, postType: '채용' });
      });
      return items;
    },
  },
  {
    name: '잡코리아',
    urls: [
      'https://www.jobkorea.co.kr/Search/?stext=영상편집&tabType=recruit',
      'https://www.jobkorea.co.kr/Search/?stext=숏폼편집&tabType=recruit',
    ],
    parse: ($) => {
      const items = [];
      $('.list-item, .recruit-info').each((_, el) => {
        const company = $(el).find('.coName a, .corp-name a').first().text().trim();
        const title   = $(el).find('.title a, .job-title a').first().text().trim();
        const href    = $(el).find('.title a, .job-title a').first().attr('href') || '';
        const link    = href.startsWith('http') ? href : 'https://www.jobkorea.co.kr' + href;
        if (company && title) items.push({ company, summary: title, link, postType: '채용' });
      });
      return items;
    },
  },
];

// ── 영상 관련 키워드 필터 ──
const VIDEO_KW = ['영상편집','영상제작','영상편집자','숏폼','릴스','쇼츠','콘텐츠제작','유튜브편집','동영상편집','영상','video','content','edit','shorts','reels'];
const isVideo = (t='') => VIDEO_KW.some(k => t.toLowerCase().includes(k.toLowerCase()));

// ── HTTP 요청 (User-Agent 설정으로 봇 차단 우회) ──
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 메인 실행 ──
async function main() {
  console.log(`\n🚀 AICUT 신규 기업 수집 시작 — ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n`);

  // 1. 기존 Firebase 기업 목록 로드
  console.log('📂 Firebase 기존 DB 로드 중...');
  const snapshot = await db.collection(COL).get();
  const existing = new Set();
  snapshot.forEach(doc => {
    const d = doc.data();
    if (d.company) existing.add(d.company.trim().toLowerCase());
  });
  const prevCount = existing.size;
  console.log(`   기존 기업 수: ${prevCount}개\n`);

  // 2. 각 소스에서 수집
  const collected = [];

  for (const src of SOURCES) {
    console.log(`🔍 [${src.name}] 수집 시작`);
    for (const url of src.urls) {
      try {
        const html = await fetchPage(url);
        const $    = cheerio.load(html);
        const items = src.parse($);
        console.log(`   ${url.split('=')[1] || url}: ${items.length}개 공고 감지`);

        for (const item of items) {
          if (!item.company || item.company.length < 2) continue;
          if (!isVideo(item.summary)) continue;
          const key = item.company.trim().toLowerCase();
          if (existing.has(key)) { console.log(`   ↳ 중복 제외: ${item.company}`); continue; }
          if (collected.find(c => c.company.toLowerCase() === key)) continue;

          existing.add(key);
          collected.push({
            company:     item.company,
            link:        item.link || '',
            summary:     item.summary || '',
            postType:    item.postType || '채용',
            industry:    '미분류',
            contact:     '',
            email:       '',
            phone:       '',
            stage:       '미접촉',
            memo:        `[자동수집] ${new Date().toLocaleDateString('ko-KR')} ${src.name}`,
            date:        new Date().toLocaleDateString('ko-KR'),
            region:      '',
            size:        '',
            budget:      0,
            website:     '',
            nextAction:  '',
            mailDate:    '',
            crawlStatus: 'wait',
            needScore:   0,
            needLevel:   '',
            budgetText:  '',
            approachMsg: '',
            timeline:    [],
            source:      src.name,
            collectedAt: new Date().toISOString(),
          });
          console.log(`   ✅ 신규 추가: ${item.company} — ${item.summary.slice(0, 40)}`);
          if (collected.length >= 10) break;
        }
      } catch (e) {
        console.error(`   ❌ 오류 (${url}): ${e.message}`);
      }
      if (collected.length >= 10) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (collected.length >= 10) break;
  }

  // 3. Firebase에 저장
  if (collected.length === 0) {
    console.log('\n⚠️  새로운 기업을 찾지 못했습니다.');
    process.exit(0);
  }

  console.log(`\n💾 Firebase에 ${collected.length}개 저장 중...`);
  const batch = db.batch();
  const baseId = prevCount;
  collected.forEach((item, i) => {
    const id = String(baseId + i);
    const ref = db.collection(COL).doc(id);
    batch.set(ref, { ...item, id: baseId + i });
  });
  await batch.commit();

  console.log(`\n✅ 완료!`);
  console.log(`   기존: ${prevCount}개`);
  console.log(`   추가: ${collected.length}개`);
  console.log(`   합계: ${prevCount + collected.length}개`);
  console.log('\n추가된 기업:');
  collected.forEach((c, i) => console.log(`  ${i+1}. ${c.company} (${c.source})`));
}

main().catch(e => {
  console.error('❌ 치명적 오류:', e);
  process.exit(1);
});
