// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 2: DOCUMENT LOADER
//
// Bước đầu tiên của RAG: nạp dữ liệu.
// 1. Mỗi loader đọc dữ liệu từ 1 nguồn (PDF, YouTube, web, Notion...).
// 2. Trả mảng Document { pageContent, metadata }.
// 3. Document dùng tiếp ở các bước: split -> embed -> truy vấn.
//
// Bỏ comment trong main() để thử từng loader.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  CheerioWebBaseLoader,
} = require("@langchain/community/document_loaders/web/cheerio");
const {
  NotionLoader,
} = require("@langchain/community/document_loaders/fs/notion");

// PDFLoader: đọc file PDF, mỗi trang -> 1 Document.
// Bản tự viết bằng pdf-parse: 02-document-loading-native.js.
async function loadPdf() {
  console.log("=== PDFLoader ===");
  const filePath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );
  const loader = new PDFLoader(filePath);
  const pages = await loader.load();

  console.log("Số lượng trang PDF:", pages.length);
  console.log(pages[0].pageContent.slice(0, 500));
  console.log(pages[0].metadata);
}

// YoutubeLoader: lấy transcript (phụ đề) có sẵn của video.
// Không cần tự chuyển giọng nói thành văn bản (speech-to-text).
// Video không có phụ đề -> không lấy được.
async function loadYoutube() {
  console.log("\n=== YoutubeLoader ===");
  // Dùng import() động vì "youtubei.js" chỉ hỗ trợ ESM, không require() được.
  const { YoutubeLoader } =
    await import("@langchain/community/document_loaders/web/youtube");
  const url = "https://www.youtube.com/watch?v=jGwO_UgTS7I";
  const loader = YoutubeLoader.createFromUrl(url, {
    language: "en",
    addVideoInfo: true,
  });
  const docs = await loader.load();

  console.log(docs[0].pageContent.slice(0, 500));
}

// CheerioWebBaseLoader: tải HTML trang web, bỏ tag, giữ text -> Document.
async function loadUrl() {
  console.log("\n=== CheerioWebBaseLoader ===");
  const url =
    "https://github.com/basecamp/handbook/blob/master/titles-for-programmers.md";
  const loader = new CheerioWebBaseLoader(url);
  const docs = await loader.load();

  console.log(docs[0].pageContent.slice(0, 500));
}

// NotionLoader: đọc các file .md export từ Notion, mỗi file -> 1 Document.
async function loadNotion() {
  console.log("\n=== NotionLoader ===");
  const dirPath = path.join(__dirname, "../../docs/Notion_DB");
  const loader = new NotionLoader(dirPath);
  const docs = await loader.load();

  console.log(docs[0].pageContent.slice(0, 200));
  console.log(docs[0].metadata);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await loadPdf();
  // await loadYoutube();
  // await loadUrl();
  // await loadNotion();
}

main();
