// =======================================================================
// TOOL ROUTING - BƯỚC 3: TOOL TÌM KIẾM WIKIPEDIA
//
// Tool gọi thẳng MediaWiki API.
//
// Flow:
// 1. Tìm 3 trang liên quan nhất tới query.
// 2. Lấy đoạn tóm tắt mở đầu (intro) của từng trang.
// 3. Gộp lại thành 1 đoạn text trả cho LLM.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// Bước 1: tìm tối đa 3 tiêu đề trang liên quan tới query.
async function searchTitles(query) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    format: "json",
  });
  const response = await fetch(`${WIKI_API}?${params}`);
  const data = await response.json();
  return data.query.search.map((item) => item.title);
}

// Bước 2: lấy tóm tắt 1 trang theo tiêu đề.
// exintro: chỉ lấy phần mở đầu. explaintext: text thuần, bỏ markup.
async function getPageSummary(title) {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    exintro: "true",
    explaintext: "true",
    titles: title,
    format: "json",
  });
  const response = await fetch(`${WIKI_API}?${params}`);
  const data = await response.json();
  const pages = data.query.pages;
  // Key của pages là pageId, không biết trước -> lấy phần tử đầu tiên.
  return Object.values(pages)[0]?.extract ?? "";
}

// Hàm thực thi của Tool: chạy bước 1 + 2, gộp kết quả (bước 3).
async function fetchWikipediaSummaries(query) {
  const titles = await searchTitles(query);
  const summaries = [];
  for (const title of titles) {
    const extract = await getPageSummary(title);
    // Bỏ trang không có tóm tắt.
    if (extract) {
      summaries.push(`Page: ${title}\nSummary: ${extract}`);
    }
  }
  const result =
    summaries.length === 0
      ? "No good Wikipedia Search Result was found"
      : summaries.join("\n\n");
  console.log("kết quả fetchWikipediaSummaries:", result);
  return result;
}

// tool(fn, options): chỉ gắn name / description / schema cho fn, không đổi cách fn chạy.
// schema là z.string() -> input là 1 chuỗi query, không phải object.
const searchWikipedia = tool(fetchWikipediaSummaries, {
  name: "search_wikipedia",
  description: "Run Wikipedia search and get page summaries.",
  schema: z.string().describe("query to search on Wikipedia"),
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log("name:", searchWikipedia.name);
  console.log("description:", searchWikipedia.description);

  // Gọi thẳng Tool, không qua LLM, với từ khóa "langchain".
  try {
    const result = await searchWikipedia.invoke("langchain");
    console.log("\nresult:", result);
  } catch (error) {
    console.log("\nexception on external access");
  }
}

// Chỉ chạy main() khi chạy trực tiếp `node 03-wikipedia-tool.js`.
// File khác require() file này (05, 06, 07) -> không chạy main(), chỉ lấy Tool.
if (require.main === module) {
  main();
}

module.exports = { searchWikipedia };
