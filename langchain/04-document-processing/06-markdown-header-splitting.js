// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 6: CẮT MARKDOWN THEO HEADING
//
// 1. Tách văn bản theo dòng heading (#, ##, ###...).
// 2. Gắn các heading đang áp dụng vào metadata của mỗi chunk.
//
// Chunk dù bị cắt nhỏ vẫn biết mình thuộc mục nào
// -> LLM trả lời chính xác, có ngữ cảnh hơn.
//
// LangChain JS chưa có splitter này, nên tự viết.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

// Cắt markdown theo heading. Mỗi chunk có dạng:
// { pageContent: "nội dung", metadata: { "Header 1": "...", "Header 2": "..." } }
function splitMarkdownByHeaders(text, headersToSplitOn) {
  const activeHeaders = {}; // Các heading đang áp dụng cho nội dung hiện tại
  const chunks = [];
  let currentLines = [];

  // Đóng chunk hiện tại (nếu có nội dung) kèm snapshot các heading.
  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content)
      chunks.push({ pageContent: content, metadata: { ...activeHeaders } });
    currentLines = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const header = headersToSplitOn.find(([prefix]) =>
      line.startsWith(`${prefix} `),
    );

    if (header) {
      // Gặp heading mới -> đóng chunk cũ.
      flush();
      const [prefix, name] = header;
      // Xóa heading cùng cấp hoặc cấp thấp hơn.
      // Vd: gặp "## Chapter 2" -> xóa "## Chapter 1" và "### Section".
      for (const [key] of Object.entries(activeHeaders)) {
        const [existingPrefix] = headersToSplitOn.find(([, n]) => n === key);
        if (existingPrefix.length >= prefix.length) delete activeHeaders[key];
      }
      activeHeaders[name] = line.slice(prefix.length).trim();
    } else if (line) {
      currentLines.push(line);
    }
  }
  flush();
  return chunks;
}

// ===== KỊCH BẢN MINH HỌA =====
function main() {
  const markdownDocument = `# Title

## Chapter 1

Hi this is Jim

Hi this is Joe

### Section

Hi this is Lance

## Chapter 2

Hi this is Molly`;

  // Mỗi phần tử: [ký hiệu heading, tên key trong metadata].
  // Kỳ vọng chunk 1: "Hi this is Jim\nHi this is Joe",
  // metadata { "Header 1": "Title", "Header 2": "Chapter 1" }.
  const headersToSplitOn = [
    ["#", "Header 1"],
    ["##", "Header 2"],
    ["###", "Header 3"],
  ];

  const mdHeaderSplits = splitMarkdownByHeaders(
    markdownDocument,
    headersToSplitOn,
  );
  console.log("=== Chunk 1 ===");
  console.log(mdHeaderSplits[0]);
  console.log("\n=== Chunk 2 ===");
  console.log(mdHeaderSplits[1]);
}

main();
