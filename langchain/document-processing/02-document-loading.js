require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  CheerioWebBaseLoader,
} = require("@langchain/community/document_loaders/web/cheerio");
const {
  NotionLoader,
} = require("@langchain/community/document_loaders/fs/notion");

// Document Loading cho RAG (Retrieval Augmented Generation):
// 1. Mỗi loader đọc dữ liệu từ 1 nguồn (PDF, YouTube, web, Notion...).
// 2. Trả về mảng Document gồm { pageContent, metadata }.
// 3. Document này được dùng ở bước embedding/truy vấn (RAG) sau này.

async function loadPdf() {
  console.log("=== PDFLoader ===");
  // PDFLoader: đọc file PDF, mặc định mỗi trang PDF -> 1 Document.
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

async function loadYoutube() {
  console.log("\n=== YoutubeLoader ===");
  // YoutubeLoader lấy transcript (phụ đề) có sẵn của video, không cần tự chuyển
  // giọng nói thành văn bản (speech-to-text).
  // Dùng import() động vì "youtubei.js" chỉ hỗ trợ ESM, không dùng được với require().
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

async function loadUrl() {
  console.log("\n=== CheerioWebBaseLoader ===");
  // CheerioWebBaseLoader: tải HTML của trang web rồi trích xuất phần text -> Document.
  const url =
    "https://github.com/basecamp/handbook/blob/master/titles-for-programmers.md";
  const loader = new CheerioWebBaseLoader(url);
  const docs = await loader.load();

  console.log(docs[0].pageContent.slice(0, 500));
}

async function loadNotion() {
  console.log("\n=== NotionLoader ===");
  // NotionLoader: đọc toàn bộ file .md trong thư mục export từ Notion,
  // mỗi file markdown -> 1 Document.
  const dirPath = path.join(__dirname, "../../docs/Notion_DB");
  const loader = new NotionLoader(dirPath);
  const docs = await loader.load();

  console.log(docs[0].pageContent.slice(0, 200));
  console.log(docs[0].metadata);
}

async function main() {
  await loadPdf();
  // await loadYoutube();
  // await loadUrl();
  // await loadNotion();
}

main();
