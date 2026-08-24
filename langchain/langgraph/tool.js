// Search Tool: Tìm kiếm dữ liệu thật từ Wikipedia API (MediaWiki) - Miễn phí, không cần API Key.
// Gợi ý: Nếu cần dữ liệu thời gian thực (thời tiết, tin tức), có thể thay thế bằng TavilySearchResults.

require("../_polyfill");

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// 1. Tìm tối đa 3 tiêu đề trang liên quan nhất tới từ khóa (query)
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

// 2. Lấy nội dung tóm tắt (dạng plain text, bỏ markup HTML) của trang theo tiêu đề
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
  // API trả về Object có key là pageId ngẫu nhiên -> Dùng Object.values để lấy phần tử đầu tiên
  return Object.values(pages)[0]?.extract ?? "";
}

// 3. Hàm xử lý chính: Tìm các trang liên quan và tổng hợp lại tóm tắt.
//    Bọc try/catch để bắt lỗi kết nối (nếu có) -> Báo lỗi cho Model xử lý thay vì làm crash ứng dụng.
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
    // Trả về thông báo để Model tự trả lời bằng kiến thức có sẵn thay vì thử lại
    return `Wikipedia search failed (${error.message}). Do not retry - answer using your general knowledge instead.`;
  }
}

// 4. Bọc hàm searchWikipedia thành Tool chuẩn LangChain để gộp được vào `model.bindTools()`
const webSearch = tool(searchWikipedia, {
  name: "web_search",
  description: "Search Wikipedia and get page summaries.",
  schema: z.string().describe("query to search on Wikipedia"),
});

module.exports = { webSearch };