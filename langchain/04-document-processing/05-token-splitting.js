// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 5: CẮT THEO TOKEN
//
// LLM tính giới hạn context và chi phí theo token, không phải ký tự.
// -> Cắt theo token phản ánh đúng "sức chứa" thật của LLM hơn cắt theo ký tự.
//
// Tự viết bằng js-tiktoken (chạy local), không dùng TokenTextSplitter
// của LangChain JS, vì nó tải bộ mã hóa token qua mạng mỗi lần gọi.
//
// Lưu ý: "gpt2" là tokenizer của OpenAI. Gemini dùng tokenizer khác,
// nên số token ở đây chỉ là ước lượng.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { getEncoding } = require("js-tiktoken");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");

// Cắt text thành các chunk, mỗi chunk tối đa chunkSize token.
// 1. Encode text thành mảng token id.
// 2. Cắt mảng theo cửa sổ chunkSize, lùi lại chunkOverlap token ở mỗi chunk mới.
// 3. Decode từng đoạn token về lại text.
// chunkOverlap phải nhỏ hơn chunkSize, nếu không vòng lặp không tiến -> lặp vô hạn.
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

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const encoding = getEncoding("gpt2");

  // 1. Chuỗi ngắn, mỗi chunk 1 token -> thấy rõ cách tokenizer tách chữ.
  // Vd: "bazzyfoo" không phải 1 từ phổ biến -> bị tách thành nhiều token.
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

  // 2. Cắt từng trang PDF theo token, giữ metadata gốc của trang cho mỗi chunk.
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
