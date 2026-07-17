const KR_LABELS = {
  dow: "다우존스", sp500: "S&P500", nasdaq: "나스닥", russell2000: "러셀2000",
  kospi: "KOSPI", kosdaq: "KOSDAQ", dxy: "달러 인덱스(DXY)", wti: "WTI 유가",
  usdkrw: "원/달러 환율",
};

const PULSE_LABELS = {
  dow: "다우", sp500: "S&P500", nasdaq: "나스닥", russell2000: "러셀2000",
  kospi: "코스피", kosdaq: "코스닥", dxy: "달러인덱스", wti: "WTI", usdkrw: "원/달러",
};

let currentData = null;

function fmtPrice(n) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n === null || n === undefined) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function deltaClass(n) {
  if (n === null || n === undefined || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// analysis는 문자열이거나 {text, article_title, article_url} 객체일 수 있다 - 형태를 통일해서 꺼낸다.
function extractAnalysis(analysis) {
  if (!analysis) return { text: null, articleUrl: null };
  if (typeof analysis === "string") return { text: analysis, articleUrl: null };
  return { text: analysis.text || null, articleUrl: analysis.article_url || null };
}

// 분석 텍스트(및 있으면 근거 기사 링크)를 말풍선 HTML로 만든다.
function tooltipHtml(analysis) {
  const { text, articleUrl } = extractAnalysis(analysis);
  if (!text) return "";
  const link = articleUrl
    ? `<a class="tip-article-link" href="${articleUrl}" target="_blank" rel="noopener">기사 보기 →</a>`
    : "";
  return `<div class="tooltip-bubble"><div class="tooltip-inner">${escapeHtml(text)}${link}</div></div>`;
}

function hasTooltipText(analysis) {
  return !!extractAnalysis(analysis).text;
}

// label · value · delta 카드. opts.source가 있으면 값이 출처 링크가 되고,
// opts.tooltip이 있으면 호버 시 분석 말풍선(+기사 링크)이 뜬다.
function tile(label, value, pct, opts = {}) {
  const manual = opts.manual ? `<div class="manual-flag">수동 확인 필요</div>` : "";
  const pctHtml = pct !== null && pct !== undefined
    ? `<div class="delta ${deltaClass(pct)}">${fmtPct(pct)}</div>` : "";
  const extra = opts.extraLine ? `<div class="delta ${opts.extraClass || 'flat'}">${opts.extraLine}</div>` : "";
  const valueClass = opts.colorValueBy !== undefined ? `value ${deltaClass(opts.colorValueBy)}` : "value";
  const valueContent = opts.source
    ? `<a href="${opts.source}" target="_blank" rel="noopener">${value}</a>`
    : value;
  const tileClass = `tile tip-zone${hasTooltipText(opts.tooltip) ? " has-tip" : ""}`;
  return `<div class="${tileClass}">
    <div class="label">${label}</div>
    <div class="${valueClass}">${valueContent}</div>
    ${pctHtml}${extra}${manual}
    ${tooltipHtml(opts.tooltip)}
  </div>`;
}

// 타일이 아닌 임의의 블록(뱃지, 차트 등)에 호버 분석 말풍선을 붙인다.
function tipZone(innerHtml, tooltipText, wrapperClass = "") {
  const cls = `tip-zone${hasTooltipText(tooltipText) ? " has-tip" : ""} ${wrapperClass}`.trim();
  return `<div class="${cls}">${innerHtml}${tooltipHtml(tooltipText)}</div>`;
}

function analysisCard(title, text, sourceUrl) {
  const body = text
    ? `<p>${escapeHtml(text)}</p>`
    : `<p class="empty">아직 분석이 작성되지 않았습니다. Claude에게 "오늘자 팔로업 업데이트해줘"라고 요청하면 채워집니다.</p>`;
  const link = sourceUrl ? `<a class="source-link" href="${sourceUrl}" target="_blank" rel="noopener">기사 보기 →</a>` : "";
  return `<div class="card"><h3>${title}</h3>${body}${link}</div>`;
}

// ---------- 오늘의 시장 한눈에 보기 (Market Pulse) ----------

function renderMarketPulse(sections) {
  const ms = sections.market_structure;
  const vix = sections.vix;
  const fg = sections.fear_greed;

  const items = [
    { key: "dow", pct: ms.global_indices.dow.pct_change },
    { key: "sp500", pct: ms.global_indices.sp500.pct_change },
    { key: "nasdaq", pct: ms.global_indices.nasdaq.pct_change },
    { key: "russell2000", pct: ms.global_indices.russell2000.pct_change },
    { key: "kospi", pct: ms.domestic_indices.kospi.pct_change },
    { key: "kosdaq", pct: ms.domestic_indices.kosdaq.pct_change },
    { key: "dxy", pct: ms.dxy.pct_change },
    { key: "wti", pct: ms.wti.pct_change },
    { key: "usdkrw", pct: ms.usdkrw.pct_change },
  ].filter(it => it.pct !== null && it.pct !== undefined);

  if (!items.length) {
    document.getElementById("market-pulse").innerHTML = "";
    return;
  }

  const cells = items.map(it => {
    const grow = Math.max(Math.abs(it.pct), 0.15).toFixed(2);
    const dir = deltaClass(it.pct);
    const intensity = Math.min(Math.abs(it.pct) / 5, 1);
    let bg = "var(--card)";
    let fg2 = "var(--text-primary)";
    if (dir !== "flat") {
      const base = dir === "up" ? "var(--up)" : "var(--down)";
      bg = `color-mix(in srgb, ${base} ${Math.round(18 + intensity * 68)}%, var(--card))`;
      fg2 = intensity > 0.4 ? "#fff" : "var(--text-primary)";
    }
    return `<div class="pulse-cell" style="flex-grow:${grow}; background:${bg}; color:${fg2};">
      <div class="pulse-label">${PULSE_LABELS[it.key]}</div>
      <div class="pulse-value">${fmtPct(it.pct)}</div>
    </div>`;
  }).join("");

  const best = items.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = items.reduce((a, b) => (b.pct < a.pct ? b : a));

  const vixValueText = vix.value !== null && vix.value !== undefined ? vix.value.toFixed(1) : "-";
  const fgText = fg.score !== null && fg.score !== undefined ? `${fg.score} (${fg.rating})` : "-";

  const stats = `<div class="pulse-stats">
    <div class="pulse-stat"><span class="pulse-stat-label">최대 상승</span>
      <span class="pulse-stat-value up">${PULSE_LABELS[best.key]} ${fmtPct(best.pct)}</span></div>
    <div class="pulse-stat"><span class="pulse-stat-label">최대 하락</span>
      <span class="pulse-stat-value down">${PULSE_LABELS[worst.key]} ${fmtPct(worst.pct)}</span></div>
    <div class="pulse-stat"><span class="pulse-stat-label">VIX</span>
      <span class="pulse-stat-value ${vix.elevated ? 'up' : 'down'}">${vixValueText} ${vix.elevated ? '· 변동성 확대' : '· 안정'}</span></div>
    <div class="pulse-stat"><span class="pulse-stat-label">Fear &amp; Greed</span>
      <span class="pulse-stat-value flat">${fgText}</span></div>
  </div>`;

  const topIssues = ms.analysis.top_issues || [];
  const issuesHtml = topIssues.length
    ? `<div class="section-label">오늘 가장 주목해야 할 이슈 TOP 3</div>
       <div class="issue-strip">${topIssues.slice(0, 3).map((issue, i) => `
        <div class="issue-card">
          <div class="issue-rank">${i + 1}</div>
          <div class="issue-body">
            <div class="issue-title">${escapeHtml(issue.label)}</div>
            <div class="issue-desc">${escapeHtml(issue.summary)}</div>
            <a class="source-link" href="${issue.article_url}" target="_blank" rel="noopener">기사 보기 →</a>
          </div>
        </div>`).join("")}</div>`
    : "";

  document.getElementById("market-pulse").innerHTML =
    `${issuesHtml}
     <div class="section-label">오늘의 시장 한눈에 보기</div><div class="pulse-mosaic">${cells}</div>${stats}`;
}

// ---------- 다이버징 바 차트 (수급/섹터 공용) ----------

// item: { label, value(부호있는 숫자, 막대 길이·색상 기준), displayValue(표시 텍스트), tooltip }
// sectionSource가 주어지면 행 전체가 그 출처로 이동하는 링크가 된다(섹터별 출처는 다 동일하므로
// 항목마다 따로 걸지 않고, 박스 전체를 누르면 이동하는 방식으로 통일).
function divergingBarRow(item, maxAbs, sectionSource) {
  const dir = deltaClass(item.value);
  const widthPct = (Math.abs(item.value) / maxAbs) * 50;
  const side = item.value >= 0
    ? `left:50%; width:${widthPct}%; border-radius:0 5px 5px 0;`
    : `right:50%; width:${widthPct}%; border-radius:5px 0 0 5px;`;
  const inner = `
    <div class="flow-label">${escapeHtml(item.label)}</div>
    <div class="flow-track"><div class="flow-bar ${dir}" style="${side}"></div></div>
    <div class="flow-value ${dir}">${item.displayValue}</div>
  `;
  const row = sectionSource
    ? `<a class="flow-row" href="${sectionSource}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="flow-row">${inner}</div>`;
  return tipZone(row, item.tooltip);
}

function divergingBarList(items, sectionSource) {
  const maxAbs = Math.max(...items.map(it => Math.abs(it.value)), 0.01);
  return `<div class="flow-chart">${items.map(it => divergingBarRow(it, maxAbs, sectionSource)).join("")}</div>`;
}

function renderFlowChart(flow) {
  if (flow.status !== "ok") {
    return `<p class="empty">수동 확인 필요 (<a class="source-link" href="${flow.source}" target="_blank" rel="noopener">원본 보기</a>)</p>`;
  }
  const items = [
    { label: "외국인", value: Number(flow.foreign) },
    { label: "기관", value: Number(flow.institution) },
    { label: "개인", value: Number(flow.individual) },
  ].map(it => ({ ...it, displayValue: `${it.value >= 0 ? "+" : ""}${it.value.toLocaleString("ko-KR")}` }));
  return `${divergingBarList(items)}
    <div class="flow-meta">단위: 억원(순매수) · 기준일 ${flow.as_of} · <a class="source-link" href="${flow.source}" target="_blank" rel="noopener">출처</a></div>`;
}

// ---------- 섹션별 렌더링 ----------

function renderMarket(s) {
  renderMarketPulse(currentData.sections);

  const idx = s.global_indices;
  const rates = s.rates;
  const a = s.analysis;

  // 글로벌 시장
  let global = `<div class="tile-grid">`;
  for (const key of ["dow", "sp500", "nasdaq", "russell2000"]) {
    const v = idx[key];
    global += tile(KR_LABELS[key], fmtPrice(v.price), v.pct_change, {
      source: v.source, tooltip: a.index_cause && a.index_cause[key],
    });
  }
  global += `</div>`;

  const order = s.index_order;
  const orderNames = order.order_desc_by_pct.map(k => KR_LABELS[k]).join(" > ");
  global += `<div class="badge ${order.normal_order ? "normal" : "inverted"}">
    등락률 배열: ${orderNames} ${order.normal_order ? "(정배열)" : "(역배열)"}
  </div>`;
  global += newsCard("배열 분석", a.index_order_meaning);

  global += `<div class="tile-grid">`;
  if (rates.status === "ok") {
    global += tile("미국 10년물", `${rates.us10y.value.toFixed(3)}%`, null, {
      source: rates.us10y.source, tooltip: a.rate_spread_cause,
    });
    global += tile("미국 2년물", `${rates.us2y.value.toFixed(3)}%`, null, {
      source: rates.us2y.source, tooltip: a.rate_spread_cause,
    });
    global += tile("장단기 금리차(10y-2y)", `${rates.spread >= 0 ? "+" : ""}${rates.spread.toFixed(3)}%p`, null, {
      extraLine: rates.spread >= 0 ? "정상(우상향)" : "역전",
      extraClass: rates.spread >= 0 ? "down" : "up",
      tooltip: a.rate_spread_cause,
    });
  } else {
    global += tile("미국 10년물/2년물 금리차", "수동 확인 필요", null, { manual: true });
  }
  global += `</div>`;

  global += `<div class="tile-grid">`;
  global += tile(KR_LABELS.dxy, fmtPrice(s.dxy.price), s.dxy.pct_change, { source: s.dxy.source, tooltip: a.dxy_cause });
  global += tile(KR_LABELS.wti, fmtPrice(s.wti.price) + " $", s.wti.pct_change, { source: s.wti.source, tooltip: a.wti_cause });
  global += `</div>`;

  document.getElementById("market-global").innerHTML = global;

  // 국내 시장
  let domestic = `<div class="tile-grid">`;
  domestic += tile(KR_LABELS.kospi, fmtPrice(s.domestic_indices.kospi.price), s.domestic_indices.kospi.pct_change, {
    source: s.domestic_indices.kospi.source, tooltip: a.kr_market_style,
  });
  domestic += tile(KR_LABELS.kosdaq, fmtPrice(s.domestic_indices.kosdaq.price), s.domestic_indices.kosdaq.pct_change, {
    source: s.domestic_indices.kosdaq.source, tooltip: a.kr_market_style,
  });
  domestic += tile(KR_LABELS.usdkrw, fmtPrice(s.usdkrw.price) + " 원", s.usdkrw.pct_change, {
    source: s.usdkrw.source, tooltip: a.fx_cause,
  });
  domestic += `</div>`;

  domestic += `<div class="section-label">KOSPI 수급 동향 (외국인 · 기관 · 개인)</div>`;
  domestic += `<div class="card">${renderFlowChart(s.investor_flow_kospi)}</div>`;
  domestic += newsCard("수급 분석", a.investor_flow_note);

  document.getElementById("market-domestic").innerHTML = domestic;
}

function renderVix(s) {
  let html = `<div class="tile-grid">${tile("VIX", s.value !== null ? s.value.toFixed(2) : "-", null, {
    source: s.source,
    extraLine: s.elevated ? "변동성 확대 (≥20)" : "안정적 (<20)",
    extraClass: s.elevated ? "up" : "down",
  })}</div>`;
  html += newsCard("VIX 분석", s.analysis.cause);
  document.getElementById("vix-content").innerHTML = html;
}

function newsCard(title, analysis) {
  const { text, articleUrl } = extractAnalysis(analysis);
  return analysisCard(title, text, articleUrl);
}

const GLOBAL_SECTOR_SOURCE = "https://finance.yahoo.com/sectors/";

function renderSector(s) {
  const etfCauses = s.analysis.etf_causes || {};
  const sortedGlobal = Object.entries(s.global_sector_etfs)
    .map(([ticker, v]) => ({
      label: `${v.name_kr} (${ticker})`,
      value: v.pct_change ?? 0,
      displayValue: fmtPct(v.pct_change) ?? "-",
      tooltip: etfCauses[ticker],
    }))
    .sort((a, b) => b.value - a.value);
  // 상승 3 + 하락 3만 표시
  const globalItems = sortedGlobal.slice(0, 3).concat(sortedGlobal.slice(-3).reverse())
    .sort((a, b) => b.value - a.value);

  const kr = s.domestic_sector_groups;
  const krCauses = s.analysis.kr_sector_causes || {};
  const domesticHtml = kr.status === "ok"
    ? divergingBarList(
        [...kr.top_up.slice(0, 3), ...kr.top_down.slice(0, 3)]
          .map(it => ({
            label: it.name,
            value: it.pct_change,
            displayValue: fmtPct(it.pct_change),
            tooltip: krCauses[it.name],
          }))
          .sort((a, b) => b.value - a.value),
        kr.source
      )
    : `<p class="empty">수동 확인 필요 (<a class="source-link" href="${kr.source}" target="_blank" rel="noopener">원본 보기</a>)</p>`;

  let html = `<div class="section-label">섹터별 등락 TOP3 (상승·하락 각 3개, 박스 클릭 시 출처로 이동)</div>
    <div class="card-grid">
      <div class="card"><h3>글로벌 시장 · 섹터 ETF</h3>${divergingBarList(globalItems, GLOBAL_SECTOR_SOURCE)}</div>
      <div class="card"><h3>국내 시장 · 업종 등락</h3>${domesticHtml}</div>
    </div>`;

  html += `<div class="section-label">오늘의 주요 이슈</div><div class="card-grid">`;
  html += newsCard("글로벌 시장 이슈", s.analysis.us_market_news);
  html += newsCard("국내 시장 이슈", s.analysis.kr_market_news);
  html += `</div>`;

  document.getElementById("sector-content").innerHTML = html;
}

function fmtFwPct(v) {
  return v !== null && v !== undefined ? `${v}%` : "-";
}

function renderFedwatch(s) {
  let html = "";
  if (s.status === "ok" || s.status === "manual_entry") {
    html += `<div class="tile-grid">`;
    html += tile("인하 확률", fmtFwPct(s.today.ease_pct), null, { source: s.source });
    html += tile("동결 확률", fmtFwPct(s.today.no_change_pct), null, { source: s.source });
    html += tile("인상 확률", fmtFwPct(s.today.hike_pct), null, { source: s.source });
    html += `</div>`;
    if (s.meeting_date) {
      html += `<p style="font-size:12.5px;color:var(--text-muted);margin:0 0 16px;">대상 회의: ${escapeHtml(s.meeting_date)} · 박스의 숫자를 누르면 CME FedWatch로 이동합니다</p>`;
    }

    const hasHistory = (s.prev_day && Object.values(s.prev_day).some(v => v !== null && v !== undefined)) ||
                        (s.prev_week && Object.values(s.prev_week).some(v => v !== null && v !== undefined));
    if (hasHistory) {
      html += `<div class="section-label">오늘 · 전날 · 전주 비교</div>`;
      html += `<table class="data-table"><thead><tr><th>구분</th><th>오늘</th><th>전날</th><th>전주</th></tr></thead><tbody>`;
      for (const [label, key] of [["인하", "ease_pct"], ["동결", "no_change_pct"], ["인상", "hike_pct"]]) {
        html += `<tr><td>${label}</td>
          <td>${fmtFwPct(s.today[key])}</td>
          <td>${fmtFwPct(s.prev_day && s.prev_day[key])}</td>
          <td>${fmtFwPct(s.prev_week && s.prev_week[key])}</td></tr>`;
      }
      html += `</tbody></table>`;
    }

    if (s.comparison && (s.comparison.vs_prev_day || s.comparison.vs_prev_week)) {
      html += `<div class="card-grid">`;
      if (s.comparison.vs_prev_day) html += analysisCard("전날 대비", s.comparison.vs_prev_day);
      if (s.comparison.vs_prev_week) html += analysisCard("전주 대비", s.comparison.vs_prev_week);
      html += `</div>`;
    }
  } else {
    html += `<div class="tile-grid">${tile("FOMC 확률", "수동 확인 필요", null, { manual: true })}</div>`;
  }
  html += newsCard("FOMC 확률 분석", s.analysis.related_news);

  html += `<div class="section-label">관련 매크로 이슈 (금리 · 환율 · 유가 · 통화정책 · 거시경제)</div>`;
  if (s.macro_articles && s.macro_articles.length) {
    html += `<table class="data-table"><thead><tr><th>유형</th><th>기사 제목</th><th>핵심 내용 및 인사이트</th></tr></thead><tbody>`;
    for (const art of s.macro_articles) {
      html += `<tr><td>${escapeHtml(art.type || "-")}</td>
        <td><a class="source-link" href="${art.link}" target="_blank" rel="noopener">${escapeHtml(art.title)}</a></td>
        <td>${escapeHtml(art.insight || "")}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<p class="empty">아직 수집된 매크로 이슈가 없습니다.</p>`;
  }
  document.getElementById("fedwatch-content").innerHTML = html;
}

function renderFearGreed(s) {
  let html = `<div class="tile-grid">`;
  if (s.status === "ok") {
    const extreme = s.score <= 25 || s.score >= 75;
    html += tile("Fear & Greed Index", s.score.toFixed(1), null, {
      source: s.source,
      extraLine: `${s.rating}${extreme ? " (극단 구간)" : ""}`,
      extraClass: s.score >= 55 ? "up" : (s.score <= 45 ? "down" : "flat"),
    });
  } else {
    html += tile("Fear & Greed Index", "수동 확인 필요", null, { manual: true });
  }
  html += `</div>`;
  html += newsCard("심리 분석", s.analysis.extreme_cause);
  document.getElementById("feargreed-content").innerHTML = html;
}

function renderGdpnow(s) {
  let html = `<div class="tile-grid">`;
  if (s.status === "ok") {
    const diff = s.prev_value_pct !== null ? s.value_pct - s.prev_value_pct : null;
    html += tile("GDPNow 전망치", `${s.value_pct.toFixed(1)}%`, null, {
      source: s.source,
      extraLine: diff !== null ? `직전 대비 ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%p (${s.as_of})` : s.as_of,
      extraClass: diff === null ? "flat" : (diff >= 0 ? "up" : "down"),
    });
  } else {
    html += tile("GDPNow 전망치", "수동 확인 필요", null, { manual: true });
  }
  html += `</div>`;
  html += newsCard("GDPNow 분석", s.analysis.change_cause);
  document.getElementById("gdpnow-content").innerHTML = html;
}

function renderSynthesis(s) {
  document.getElementById("synthesis-content").innerHTML =
    analysisCard("오늘의 종합 해석", s.analysis, s.source);
}

function renderIbDeal(s) {
  let html = "";
  if (s.articles && s.articles.length) {
    html += `<table class="data-table"><thead><tr><th>유형</th><th>제목</th><th>핵심 내용</th></tr></thead><tbody>`;
    for (const art of s.articles) {
      html += `<tr><td>${art.type || "-"}</td>
        <td><a class="source-link" href="${art.link}" target="_blank" rel="noopener">${escapeHtml(art.title)}</a></td>
        <td>${escapeHtml(art.summary || "")}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<p class="empty">아직 수집된 IB 딜 뉴스가 없습니다.</p>`;
  }
  html += analysisCard("IB Deal 인사이트", s.analysis, s.source);
  document.getElementById("ibdeal-content").innerHTML = html;
}

// "26.07.16" -> "2026-07-16"
function formatKrDate(shortDate) {
  if (!shortDate) return null;
  const parts = shortDate.split(".");
  if (parts.length !== 3) return shortDate;
  return `20${parts[0]}-${parts[1]}-${parts[2]}`;
}

function renderAll(data) {
  currentData = data;
  const generatedAt = data.generated_at.replace("T", " ").replace(/\+09:00$/, " KST");
  document.getElementById("generated-at").textContent =
    `생성 시각: ${generatedAt} (새로고침마다 갱신)`;

  const flow = data.sections.market_structure?.investor_flow_kospi;
  const krAsOf = flow && flow.status === "ok" ? formatKrDate(flow.as_of) : null;
  document.getElementById("as-of-line").textContent = krAsOf
    ? `기준 시각: ${krAsOf} 15:30 KOSPI 마감 기준 (해외 지수·환율 등은 조회 시점 최근 체결가 기준)`
    : `기준 시각: ${data.date} (국내 수급 데이터 확인 필요)`;

  const s = data.sections;
  renderMarket(s.market_structure);
  renderVix(s.vix);
  renderSector(s.sector_flow);
  renderFedwatch(s.fedwatch);
  renderFearGreed(s.fear_greed);
  renderGdpnow(s.gdpnow);
  renderSynthesis(s.synthesis);
  renderIbDeal(s.ib_deal);
}

// ---------- 탭 전환 ----------

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".section-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.section}`).classList.add("active");
    });
  });
  document.querySelector(".tab-btn").classList.add("active");
  document.querySelector(".section-panel").classList.add("active");
}

// ---------- 데이터 로드 ----------

async function loadDate(dateStr) {
  document.getElementById("loading-msg").style.display = "block";
  try {
    const res = await fetch(`data/${dateStr}.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderAll(data);
    document.getElementById("loading-msg").style.display = "none";
  } catch (e) {
    document.getElementById("loading-msg").textContent = `데이터를 불러오지 못했습니다: ${e.message}`;
    document.getElementById("loading-msg").className = "error-msg";
  }
}

async function init() {
  setupTabs();
  try {
    const res = await fetch(`data/index.json?_=${Date.now()}`);
    const dates = await res.json();
    const select = document.getElementById("date-select");
    select.innerHTML = dates.map(d => `<option value="${d}">${d}</option>`).join("");
    select.addEventListener("change", () => loadDate(select.value));
    if (dates.length) {
      await loadDate(dates[0]);
    } else {
      document.getElementById("loading-msg").textContent = "저장된 데이터가 없습니다. python scripts/fetch_data.py 를 먼저 실행하세요.";
    }
  } catch (e) {
    document.getElementById("loading-msg").textContent = `date/index.json을 불러오지 못했습니다: ${e.message}`;
  }
}

init();
