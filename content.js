// content.js (hiển thị maxPages trong giao diện và cho phép chỉnh sửa)

let isCrawling = false;
let currentPage = 1;
let allJobs = [];
let maxPages = 5; // crawl tối đa 5 trang
let hasExported = false;
let resumeFromIndex = 0; // index of the card to resume from after a 404 recovery

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args) {
  console.log("[Indeed Crawler]", ...args);
}

function isPageNotFound() {
  const title = document.title.toLowerCase();
  const bodyText = (document.body?.innerText || '').toLowerCase().slice(0, 3000);
  const combined = title + ' ' + bodyText;

  // Multi-language "page not found" / 404 phrases for Indeed's international sites
  const notFoundPhrases = [
    // Universal
    '404',
    // English
    'page not found', 'not found', 'the page you requested cannot be found',
    'this page could not be found', "we can't find that page",
    // French (fr.indeed.com, ca.indeed.com)
    'page introuvable', 'page non trouvée', 'cette page est introuvable',
    // German (de.indeed.com, at.indeed.com, ch.indeed.com)
    'seite nicht gefunden', 'seite wurde nicht gefunden',
    // Spanish (es.indeed.com, mx.indeed.com, ar.indeed.com)
    'página no encontrada', 'no se encontró la página', 'no se ha encontrado la página',
    // Portuguese (br.indeed.com, pt.indeed.com)
    'página não encontrada', 'página não foi encontrada',
    // Italian (it.indeed.com)
    'pagina non trovata',
    // Dutch (nl.indeed.com, be.indeed.com)
    'pagina niet gevonden',
    // Japanese (jp.indeed.com)
    'ページが見つかりません', 'ページが見つかりませんでした',
    // Korean (kr.indeed.com)
    '페이지를 찾을 수 없습니다',
    // Chinese Simplified (cn.indeed.com)
    '页面未找到', '找不到页面', '未找到页面',
    // Chinese Traditional (hk.indeed.com, tw.indeed.com)
    '頁面未找到', '找不到頁面',
    // Arabic (sa.indeed.com, ae.indeed.com)
    'الصفحة غير موجودة', 'لم يتم العثور على الصفحة',
    // Hindi (in.indeed.com)
    'पेज नहीं मिला', 'पृष्ठ नहीं मिला',
    // Polish (pl.indeed.com)
    'nie znaleziono strony', 'strona nie została znaleziona',
    // Swedish (se.indeed.com)
    'sidan hittades inte',
    // Norwegian (no.indeed.com)
    'siden ble ikke funnet',
    // Danish (dk.indeed.com)
    'siden blev ikke fundet',
    // Finnish (fi.indeed.com)
    'sivua ei löytynyt', 'sivua ei löydy',
    // Czech (cz.indeed.com)
    'stránka nenalezena', 'stránka nebyla nalezena',
    // Hungarian (hu.indeed.com)
    'az oldal nem található',
    // Romanian (ro.indeed.com)
    'pagina nu a fost găsită',
    // Turkish (tr.indeed.com)
    'sayfa bulunamadı',
    // Indonesian (id.indeed.com)
    'halaman tidak ditemukan',
    // Thai (th.indeed.com)
    'ไม่พบหน้าเว็บ', 'ไม่พบหน้า',
    // Vietnamese (vn.indeed.com)
    'không tìm thấy trang', 'trang không tồn tại',
    // Russian (ru.indeed.com)
    'страница не найдена',
    // Ukrainian (ua.indeed.com)
    'сторінку не знайдено',
  ];

  // Check if any known 404 phrase appears in the title or body
  for (const phrase of notFoundPhrases) {
    if (combined.includes(phrase)) {
      return true;
    }
  }

  // Indeed-specific: check for error page DOM elements
  if (document.querySelector('.jobsearch-ErrorPage, .errorMessage, [data-testid="error-page"]')) {
    return true;
  }
  return false;
}

function createPanel() {
  if (document.querySelector("#indeed-crawler-panel")) return;

  const panel = document.createElement("div");
  panel.id = "indeed-crawler-panel";
  panel.innerHTML = `
    <div id="indeed-crawler-controls">
      <button id="indeed-start-btn">Bắt Đầu Thu Thập</button>
      <button id="indeed-stop-btn" disabled>Dừng Thu Thập</button>
      <button id="indeed-reset-btn">Xóa Dữ Liệu</button>
      <button id="indeed-csv-btn" disabled>Tải CSV</button>
      <label style="margin-left: 10px;">
        Số trang tối đa:
        <input type="number" id="max-pages-input" value="${maxPages}" min="1" style="width: 50px;"/>
      </label>
    </div>
    <div id="indeed-crawler-status">Chưa bắt đầu.</div>
    <div id="indeed-crawler-table-wrapper">
      <table id="indeed-crawler-table">
        <thead>
          <tr>
            <th>Company</th><th>Job Title</th><th>Link</th><th>Salary</th><th>Location</th><th>Page</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("indeed-start-btn").onclick = () => {
    const inputVal = parseInt(document.getElementById("max-pages-input").value);
    if (!isNaN(inputVal) && inputVal > 0) {
      maxPages = inputVal;
      chrome.storage.local.set({ maxPages });
    }
    startCrawl();
  };

  document.getElementById("indeed-stop-btn").onclick = () => {
    if (isCrawling) {
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
      updateStatus("Đã dừng thu thập.");
      updateButtonStates();
    }
  };

  document.getElementById("indeed-reset-btn").onclick = () => {
    chrome.storage.local.clear();
    allJobs = [];
    currentPage = 1;
    isCrawling = false;
    hasExported = false;
    document.querySelector("#indeed-crawler-table tbody").innerHTML = "";
    updateStatus("Đã xóa dữ liệu.");
    updateButtonStates();
  };

  document.getElementById("indeed-csv-btn").onclick = () => {
    if (!isCrawling && allJobs.length > 0) {
      exportCSV();
    }
  };
}

function updateButtonStates() {
  const startBtn = document.getElementById("indeed-start-btn");
  const stopBtn = document.getElementById("indeed-stop-btn");
  const csvBtn = document.getElementById("indeed-csv-btn");

  if (startBtn) startBtn.disabled = isCrawling;
  if (stopBtn) stopBtn.disabled = !isCrawling;
  if (csvBtn) csvBtn.disabled = isCrawling || allJobs.length === 0;
}

function updateStatus(text) {
  document.getElementById("indeed-crawler-status").textContent = text;
  log(text);
}

function appendToTable(job) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${job.company || "N/A"}</td>
    <td>${job.title || "N/A"}</td>
    <td><a href="${job.link}" target="_blank">Link</a></td>
    <td>${job.salary || "N/A"}</td>
    <td>${job.location || "N/A"}</td>
    <td>${job.page}</td>
  `;
  document.querySelector("#indeed-crawler-table tbody").appendChild(row);
}

async function startCrawl() {
  if (isCrawling) return;
  isCrawling = true;
  hasExported = false;
  resumeFromIndex = 0;
  chrome.storage.local.set({ isCrawling, maxPages, resumeFromIndex: 0, pendingJob: null });
  updateButtonStates();
  updateStatus("Bắt đầu crawl...");
  await crawlLoop();
}

async function crawlLoop(startIndex = 0) {
  log("Crawl loop bắt đầu tại trang", currentPage, "từ card index", startIndex);
  const success = await crawlPage(startIndex);
  if (!success && isCrawling) {
    updateStatus("Chuyển trang, sẽ tiếp tục sau reload...");
  }
}

async function waitForJobCards(timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const cards = document.querySelectorAll("div.job_seen_beacon");
      if (cards.length > 0) {
        clearInterval(interval);
        log("Đã tìm thấy", cards.length, "job cards");
        resolve(cards);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject("Timeout đợi job card");
      }
    }, 500);
  });
}

async function crawlPage(startIndex = 0) {
  try {
    updateStatus(`Đang crawl trang ${currentPage}...`);
    const jobCards = await waitForJobCards();

    for (let i = startIndex; i < jobCards.length; i++) {
      if (!isCrawling) return false;

      const card = jobCards[i];
      card.scrollIntoView({ behavior: 'smooth' });
      await wait(1000);

      // Get basic info from the listing card
      const titleEl = card.querySelector("h2.jobTitle a, h2.jobTitle span");
      const companyEl = card.querySelector('[data-testid="company-name"], span.companyName, span.css-1h7lukg');
      const locationEl = card.querySelector('[data-testid="text-location"], div.companyLocation');
      const titleLink = card.querySelector("h2.jobTitle a");

      // Build a partial job object with what we know before clicking
      const pendingJob = {
        title: titleEl?.innerText?.trim().replace(/\s*- job post\s*$/i, '') || "N/A",
        company: companyEl?.innerText?.trim() || "N/A",
        location: locationEl?.innerText?.trim() || "N/A",
        salary: "N/A",
        link: titleLink?.href || location.href,
        page: currentPage
      };

      // Save pending job + current index to storage BEFORE clicking the link.
      // If the click navigates to a 404, we can recover using this info.
      chrome.storage.local.set({ pendingJob, resumeFromIndex: i + 1 });

      // Click the card to open the side detail panel (stays on the same page)
      // Then try to read salary from the panel; if it fails (e.g. expired job),
      // we just skip salary and continue
      let salary = "N/A";
      if (titleLink) {
        try {
          titleLink.click();
          await wait(3000);

          // Try to read salary from the detail side panel
          const salaryEl = document.querySelector('#salaryInfoAndJobType span');
          if (salaryEl && salaryEl.innerText.trim()) {
            salary = salaryEl.innerText.trim();
          }
        } catch (e) {
          log("Không thể đọc salary từ side panel, bỏ qua:", e);
        }
      }

      const job = {
        ...pendingJob,
        salary: salary
      };

      allJobs.push(job);
      appendToTable(job);
      // Clear pendingJob after successful processing
      chrome.storage.local.set({ allJobs, pendingJob: null });
    }

    // Reset resumeFromIndex after finishing all cards on this page
    resumeFromIndex = 0;
    chrome.storage.local.set({ resumeFromIndex: 0 });

    if (currentPage >= maxPages) {
      updateStatus("Đã đạt giới hạn số trang.");
      if (!hasExported) {
        exportCSV();
        hasExported = true;
      }
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
      updateButtonStates();
      return false;
    }

    const nextBtn = document.querySelector("a[aria-label='Next'], a[aria-label='Next Page'], a[data-testid='pagination-page-next']");

    if (nextBtn && !nextBtn.hasAttribute("aria-disabled")) {
      currentPage++;
      chrome.storage.local.set({ currentPage, allJobs, isCrawling, maxPages });
      nextBtn.scrollIntoView();
      nextBtn.click();
      return false;
    } else {
      updateStatus("Hoàn tất crawl tất cả trang.");
      if (!hasExported) {
        exportCSV();
        hasExported = true;
      }
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
      updateButtonStates();
      return false;
    }
  } catch (err) {
    console.error("Lỗi crawl page:", err);
    updateStatus("Lỗi crawl: " + err);
    return false;
  }
}

function exportCSV() {
  log("Bắt đầu xuất file CSV với", allJobs.length, "job");
  const headers = ["CompanyName", "Job Title", "Link", "Salary", "Location", "Page"];
  const rows = allJobs.map(j =>
    [j.company, j.title, j.link, j.salary, j.location, j.page].map(v => {
      const val = (typeof v === 'string' || typeof v === 'number') ? v.toString() : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(",")
  );

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const jobCount = allJobs.length;
  const pageTitle = document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30);
  const filename = `${jobCount}_jobs_${pageTitle}.csv`;

  chrome.runtime.sendMessage({ action: "saveToCSV", url, filename });
}

// --- Initialization: detect 404 first, then create panel & resume ---
function initialize() {
  // Always create the panel on Indeed pages
  createPanel();

  chrome.storage.local.get(["allJobs", "currentPage", "isCrawling", "maxPages", "pendingJob", "resumeFromIndex"], data => {
    if (Array.isArray(data.allJobs)) {
      allJobs = data.allJobs;
      data.allJobs.forEach(appendToTable);
      updateStatus(`Khôi phục ${allJobs.length} công việc đã lưu.`);
    }
    if (typeof data.currentPage === "number") {
      currentPage = data.currentPage;
    }
    if (typeof data.maxPages === "number") {
      maxPages = data.maxPages;
      const input = document.getElementById("max-pages-input");
      if (input) input.value = maxPages;
    }
    if (typeof data.resumeFromIndex === "number") {
      resumeFromIndex = data.resumeFromIndex;
    }

    // If a "Page Not Found" is detected while crawling, handle the pending job
    if (isPageNotFound()) {
      if (data.isCrawling) {
        log("Phát hiện trang 404 trong khi đang crawl...");

        // Check if there's a pending job that caused this 404
        if (data.pendingJob) {
          const pending = data.pendingJob;
          const alreadyExists = allJobs.some(j => j.link === pending.link);

          if (alreadyExists) {
            log("Pending job đã có trong danh sách, bỏ qua:", pending.title);
            updateStatus(`Bỏ qua (đã thu thập): ${pending.title} – đang quay lại...`);
          } else {
            // Add it to the list with salary = "N/A" since we couldn't read it
            log("Thêm pending job vào danh sách:", pending.title);
            allJobs.push(pending);
            appendToTable(pending);
            updateStatus(`Đã thêm: ${pending.title} (không lấy được salary) – đang quay lại...`);
          }

          // Save updated list and clear pendingJob
          chrome.storage.local.set({ allJobs, pendingJob: null });
        } else {
          updateStatus("Trang không tìm thấy – đang quay lại...");
        }

        // Go back to the search results; resumeFromIndex is already set
        // so the crawl will skip past the card that caused the 404
        setTimeout(() => {
          history.back();
        }, 1000);
      } else {
        updateStatus("Trang không tìm thấy (404).");
        updateButtonStates();
      }
      return;
    }

    // Normal page: resume crawling if needed
    if (data.isCrawling) {
      isCrawling = true;
      updateButtonStates();

      const startIdx = resumeFromIndex || 0;
      // Clear resume index since we're about to use it
      if (startIdx > 0) {
        log("Tiếp tục crawl từ card index", startIdx, "(sau phục hồi 404)");
      }

      waitForJobCards(15000).then(() => {
        crawlLoop(startIdx);
      }).catch(err => {
        console.warn("Không thể tiếp tục vì không tìm thấy job cards:", err);
        updateStatus("Không thể tiếp tục vì không tìm thấy job cards.");
        isCrawling = false;
        chrome.storage.local.set({ isCrawling: false });
        updateButtonStates();
      });
    } else {
      updateButtonStates();
    }
  });
}

initialize();
