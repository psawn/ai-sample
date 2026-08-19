// Tool tìm kiếm Wikipedia: gọi thẳng MediaWiki API, lấy 3 trang liên quan nhất rồi tóm tắt
// phần mở đầu (intro) của mỗi trang.
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

// Bước 2: lấy đoạn tóm tắt (intro, không có markup) của 1 trang theo tiêu đề.
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
  // API trả về object keyed theo pageId, không biết trước key nên lấy giá trị đầu tiên.
  return Object.values(pages)[0]?.extract ?? "";
}

// Hàm thực thi thật của Tool - đây là nơi mọi việc thật sự xảy ra (gọi API, tổng hợp kết quả).
async function fetchWikipediaSummaries(query) {
  const titles = await searchTitles(query);
  const summaries = [];
  for (const title of titles) {
    const extract = await getPageSummary(title);
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

// tool(fn, options) chỉ "gắn nhãn" cho fetchWikipediaSummaries, không thay đổi cách nó
// chạy - .invoke(args) sau này sẽ gọi lại đúng fetchWikipediaSummaries(args).
const searchWikipedia = tool(fetchWikipediaSummaries, {
  name: "search_wikipedia",
  description: "Run Wikipedia search and get page summaries.",
  schema: z.string().describe("query to search on Wikipedia"),
});

async function main() {
  console.log("name:", searchWikipedia.name);
  console.log("description:", searchWikipedia.description);

  try {
    const result = await searchWikipedia.invoke("langchain");
    console.log("\nresult:", result);
  } catch (error) {
    console.log("\nexception on external access");
  }
}

// require.main === module kiểm tra file này có phải là file gốc đang được thực thi hay không.
// - Đúng (chạy trực tiếp `node file.js`): Gọi main().
// - Sai (file khác require() file này): Bỏ qua main() để chỉ xuất module ra ngoài.
if (require.main === module) {
  main();
}

module.exports = { searchWikipedia };
