require("../_polyfill");
require("dotenv").config();

// LangChain JS chưa có sẵn splitter tách theo heading Markdown (khác bản Python),
// nên tự viết hàm nhỏ này:
// 1. Tách văn bản theo dòng heading (#, ##, ###...).
// 2. Gắn heading hiện tại vào metadata của mỗi chunk.
// 3. Nhờ vậy LLM biết chunk thuộc mục nào dù nội dung đã bị cắt nhỏ, giúp trả lời
//    chính xác và có ngữ cảnh hơn.
function splitMarkdownByHeaders(text, headersToSplitOn) {
  const activeHeaders = {};
  const chunks = [];
  let currentLines = [];

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
      flush();
      const [prefix, name] = header;
      // Xoá các heading cấp thấp hơn/ngang hàng khi gặp heading mới cùng cấp hoặc cao hơn.
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

function main() {
  const markdownDocument = `# Title

## Chapter 1

Hi this is Jim

Hi this is Joe

### Section

Hi this is Lance

## Chapter 2

Hi this is Molly`;

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
