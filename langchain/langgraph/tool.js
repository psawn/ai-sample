// Search Tool - dùng cho Agent trong bài học này.
//
// Gọi thẳng Wikipedia API (MediaWiki), MIỄN PHÍ, KHÔNG cần đăng ký API key. Đây là search
// THẬT (không phải mock), phù hợp cho các câu hỏi kiến thức tổng quát như trong bài học.
//
// Lưu ý: Wikipedia không có dữ liệu thời gian thực (thời tiết, tin tức mới nhất) - nếu cần
// tra cứu loại đó, cân nhắc dùng TavilySearchResults (cần TAVILY_API_KEY, xem
// "@langchain/community/tools/tavily_search") - thay thế trực tiếp cho tool ở file này vì
// cùng interface Tool.
require("../_polyfill");

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
  if (!response.ok) {
    throw new Error(`Wikipedia search request failed: ${response.status}`);
  }
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
  if (!response.ok) {
    throw new Error(`Wikipedia summary request failed: ${response.status}`);
  }
  const data = await response.json();
  const pages = data.query.pages;
  // API trả về object keyed theo pageId, không biết trước key nên lấy giá trị đầu tiên.
  return Object.values(pages)[0]?.extract ?? "";
}

// Hàm thực thi thật của Tool - đây là nơi mọi việc thật sự xảy ra (gọi API, tổng hợp kết quả).
//
// Bọc try/catch quanh toàn bộ hàm: nếu Wikipedia lỗi tạm thời (vd rate limit "429 Too Many
// Requests"), trả về 1 câu message thay vì để lỗi văng ra ngoài làm crash cả chương trình -
// để Agent tự đọc message này và quyết định (nên trả lời bằng kiến thức có sẵn thay vì thử
// lại), giống cách 1 Tool bình thường báo lỗi cho model chứ không phải throw.
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
    return `Wikipedia search failed (${error.message}). Do not retry - answer using your general knowledge instead.`;
  }
}

// tool(): bọc searchWikipedia thành 1 Tool chuẩn LangChain, để llm.bindTools() gắn được
// vào model.
const webSearch = tool(searchWikipedia, {
  name: "web_search",
  description: "Search Wikipedia and get page summaries.",
  schema: z.string().describe("query to search on Wikipedia"),
});

module.exports = { webSearch };
