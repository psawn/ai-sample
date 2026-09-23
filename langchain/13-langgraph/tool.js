// =======================================================================
// LANGGRAPH - SEARCH TOOL: TÌM KIẾM DỮ LIỆU THẬT TỪ WIKIPEDIA
//
// Tool web_search dùng chung cho các bài trong thư mục này.
// Dùng Wikipedia API (MediaWiki): miễn phí, không cần API key.
// Cần dữ liệu thời gian thực (thời tiết, tin tức) thì thay bằng TavilySearchResults.
// =======================================================================

require("../_polyfill");

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// 1. Tìm tối đa 3 tiêu đề trang liên quan nhất tới từ khoá (query).
async function searchTitles(query) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    format: "json",
  });
  const response = await fetch(`${WIKI_API}?${params}`);
  if (!response.ok) {
    throw new Error(`Wikipedia search request failed: ${response.status}`);
  }
  const data = await response.json();
  return data.query.search.map((item) => item.title);
}

// 2. Lấy phần tóm tắt của trang theo tiêu đề, dạng plain text (đã bỏ HTML).
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
  if (!response.ok) {
    throw new Error(`Wikipedia summary request failed: ${response.status}`);
  }
  const data = await response.json();
  const pages = data.query.pages;
  // API trả về object có key là pageId, không biết trước -> lấy phần tử đầu bằng Object.values.
  return Object.values(pages)[0]?.extract ?? "";
}

// 3. Hàm chính: tìm các trang liên quan, gộp phần tóm tắt lại.
//    try/catch: lỗi mạng trả về thành message cho Model đọc, thay vì crash.
async function searchWikipedia(query) {
  try {
    const titles = await searchTitles(query);
    const summaries = [];
    for (const title of titles) {
      const extract = await getPageSummary(title);
      if (extract) {
        summaries.push(`Page: ${title}\nSummary: ${extract}`);
      }
    }
    return summaries.length === 0
      ? "No good Wikipedia Search Result was found"
      : summaries.join("\n\n");
  } catch (error) {
    // Dặn Model trả lời bằng kiến thức có sẵn, không gọi lại tool.
    return `Wikipedia search failed (${error.message}). Do not retry - answer using your general knowledge instead.`;
  }
}

// 4. Bọc searchWikipedia thành tool LangChain, để truyền vào bindTools() / createAgent.
const webSearch = tool(searchWikipedia, {
  name: "web_search",
  description: "Search Wikipedia and get page summaries.",
  schema: z.string().describe("query to search on Wikipedia"),
});

module.exports = { webSearch };