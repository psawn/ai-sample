require("dotenv").config();
const path = require("path");
const { getEncoding } = require("js-tiktoken");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");

// - Cắt theo số token (đơn vị LLM thực sự tính giới hạn context/chi phí) thay vì
//   theo số ký tự, để phản ánh đúng "sức chứa" thật của LLM hơn CharacterTextSplitter.
// - Tự cài thuật toán này bằng js-tiktoken (chạy local) thay vì dùng TokenTextSplitter
//   có sẵn của LangChain JS, vì mỗi lần gọi nó lại tải bộ mã hoá token qua mạng.
function splitTextByToken(text, encoding, { chunkSize, chunkOverlap }) {
  const tokenIds = encoding.encode(text);
  const chunks = [];
  let start = 0;
  while (start < tokenIds.length) {
    if (start > 0) start -= chunkOverlap;
    const end = Math.min(start + chunkSize, tokenIds.length);
    chunks.push(encoding.decode(tokenIds.slice(start, end)));
    start = end;
  }
  return chunks;
}

async function main() {
  const encoding = getEncoding("gpt2");

  console.log("=== Cắt chuỗi ngắn theo token ===");
  console.log(
    splitTextByToken("foo bar bazzyfoo", encoding, {
      chunkSize: 1,
      chunkOverlap: 0,
    }),
  );

  const pdfPath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );
  const pages = await new PDFLoader(pdfPath).load();

  const docs = pages.flatMap((page) =>
    splitTextByToken(page.pageContent, encoding, {
      chunkSize: 10,
      chunkOverlap: 0,
    }).map((pageContent) => ({ pageContent, metadata: page.metadata })),
  );
  console.log("\n=== Chunk đầu tiên sau khi cắt PDF theo token ===");
  console.log(docs[0]);
  console.log("\n=== Metadata trang đầu (được giữ nguyên cho chunk) ===");
  console.log(pages[0].metadata);
}

main();
