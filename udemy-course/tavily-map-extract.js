// =======================================================================
// DEMO: TAVILY MAP + TAVILY EXTRACT
//
// Phân biệt 2 công cụ:
//   - TavilyMap    : Quét & thu thập danh sách URL từ trang gốc (CHƯA lấy nội dung).
//   - TavilyExtract: Cào nội dung sạch (Markdown) từ danh sách URL (đã lọc rác/HTML).
//
// Tại sao tách 2 bước thay vì dùng TavilyCrawl?
//   -> Giúp xem và lọc bớt URL rác trước, tránh tốn credit cào nội dung thừa.
//
// Luồng xử lý (Flow):
//   main()
//     ├─ Demo 1: Map               -> Quét lấy danh sách URL.
//     ├─ Demo 2: Extract 1 URL     -> Kiểm tra cấu trúc dữ liệu trả về.
//     └─ Demo 3: Extract nhiều URL -> Chia batch, cào song song.
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config(); // Load TAVILY_API_KEY từ file .env

const { RunnableLambda } = require("@langchain/core/runnables");
const { TavilyMap, TavilyExtract } = require("@langchain/tavily");
const {
  Colors,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logHeader,
} = require("./logger");

// ===== 1. CẤU HÌNH =====

const DEMO_URL = "https://python.langchain.com/docs/introduction/";

// Số URL cào mỗi lượt (Batch). API giới hạn tối đa 20 URL/request.
const BATCH_SIZE = 3;

// Instance dùng chung. Mặc định: basic (tiết kiệm credit), format "markdown".
// Chuyển extractDepth="advanced" nếu trang có bảng/cấu trúc phức tạp.
const tavilyExtract = withRetry(new TavilyExtract());

// ===== 2. MAIN =====

async function main() {
  const urls = await demoMap();
  if (urls.length === 0) return;

  await demoExtractOne(urls);
  await demoExtractBatches(urls.slice(0, 9)); // Tối đa 9 URL -> 3 batches x 3 URLs
}

// ===== 3. DEMO =====

/**
 * Demo 1: TavilyMap - Thu thập danh sách URL.
 *
 * Cấu hình kiểm soát phạm vi (tránh tốn credit):
 * - maxDepth     : Độ sâu quét link (1 = chỉ trang gốc, 2 = quét tiếp link con...).
 * - maxBreadth   : Số link tối đa lấy trên mỗi trang.
 * - limit        : Tổng số URL tối đa trả về.
 * - selectDomains: Regex lọc domain. Bắt buộc dùng để tránh tràn sang link ngoài.
 */
async function demoMap() {
  logHeader("DEMO 1: TAVILY MAP");

  const tavilyMap = withRetry(
    new TavilyMap({
      maxDepth: 3,
      maxBreadth: 15,
      limit: 50,
      // python.langchain.com đã redirect sang docs.langchain.com -> Lọc chính xác domain mới
      selectDomains: ["^docs\\.langchain\\.com$"],
    }),
  );

  logInfo(`🔍 Mapping: ${DEMO_URL} (có thể mất vài giây...)`, Colors.BLUE);
  let res;
  try {
    res = await tavilyMap.invoke({ url: DEMO_URL });
  } catch (e) {
    logError(`TavilyMap: ${e.message}`);
    return [];
  }

  // Cấu trúc res: { base_url, results: [url1, url2, ...], response_time }
  const urls = res.results;
  logSuccess(`Tìm được ${urls.length} URL (${res.response_time}s)`);
  urls.forEach((url, i) => logInfo(`  ${String(i + 1).padStart(2)}. ${url}`));

  return urls;
}

/**
 * Demo 2: TavilyExtract - Cào nội dung 1 URL (Kiểm tra format dữ liệu).
 */
async function demoExtractOne(urls) {
  logHeader("DEMO 2: TAVILY EXTRACT (1 URL)");

  const url = urls[Math.min(15, urls.length - 1)];
  logInfo(`📚 Extracting: ${url}`, Colors.BLUE);

  // Tham số urls luôn nhận đầu vào dạng MẢNG []
  let res;
  try {
    res = await tavilyExtract.invoke({ urls: [url] });
  } catch (e) {
    logError(`TavilyExtract: ${e.message}`);
    return;
  }

  // Cấu trúc res: { results: [{ url, raw_content }], failed_results: [{ url, error }] }
  for (const doc of res.results) {
    logInfo(`URL: ${doc.url}`, Colors.BOLD);
    logInfo(`Độ dài: ${doc.raw_content.length.toLocaleString()} ký tự`);
    console.log(`Preview:\n${doc.raw_content.slice(0, 500)}...`);
  }
}

/**
 * Demo 3: Extract nhiều URL - Chia batch & xử lý song song.
 *
 * Lý do chia batch & chạy song song:
 * - Tuân thủ giới hạn 20 URL/request của Tavily API.
 * - Cách ly lỗi: Một batch hỏng không ảnh hưởng đến các batch khác.
 * - Tối ưu thời gian: Gửi đồng thời các request thay vì chờ nối tiếp.
 */
async function demoExtractBatches(urls) {
  logHeader("DEMO 3: EXTRACT THEO BATCH");

  const batches = chunkUrls(urls, BATCH_SIZE);
  logInfo(`📦 ${urls.length} URL -> ${batches.length} batch`, Colors.YELLOW);

  // Chạy đồng thời tất cả batches
  const batchResults = await Promise.all(
    batches.map((batch, i) => extractBatch(batch, i + 1)),
  );

  // Làm phẳng mảng kết quả: [[doc1], [doc2]] -> [doc1, doc2]
  const allExtracted = batchResults.flat();
  logSuccess(`🎉 Hoàn tất! Tổng số trang lấy được: ${allExtracted.length}`);
}

/** Xử lý 1 batch đơn lẻ. Trả về [] nếu lỗi để không làm gãy Promise.all. */
async function extractBatch(urls, batchNum) {
  try {
    logInfo(`🔄 Batch ${batchNum}: ${urls.length} URL`, Colors.BLUE);
    const res = await tavilyExtract.invoke({ urls });

    // URL lỗi (404, bị block...) nằm ở failed_results, không bắn exception
    res.failed_results.forEach((f) =>
      logWarning(`Batch ${batchNum}: Bỏ qua ${f.url} - ${f.error}`),
    );
    logSuccess(`Batch ${batchNum}: Lấy được ${res.results.length} trang`);
    return res.results;
  } catch (e) {
    logError(`Batch ${batchNum} thất bại: ${e.message}`);
    return [];
  }
}

// ===== 4. HELPER =====

/**
 * Bọc SDK Tavily để tự động retry khi gặp sự cố mạng (vd: "fetch failed").
 *
 * *Lưu ý:* Tavily SDK trả về object { error } chứ không throw.
 * Ta phải chủ động throw Error để trigger cơ chế retry của LangChain.
 */
function withRetry(tool, maxAttempts = 3) {
  return RunnableLambda.from(async (input) => {
    const res = await tool.invoke(input);
    if (res.error) throw new Error(res.error);
    return res;
  }).withRetry({
    stopAfterAttempt: maxAttempts,
    onFailedAttempt: (e) =>
      logWarning(`${tool.name}: ${e.message}, thử lại...`),
  });
}

/** Chia mảng dữ liệu thành các nhóm nhỏ (Chunking). */
function chunkUrls(urls, size) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += size) {
    chunks.push(urls.slice(i, i + size));
  }
  return chunks;
}

main().catch(console.error);
