// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 3: RECURSIVE SPLITTER CHI TIẾT
//
// RecursiveCharacterTextSplitter: lựa chọn khuyên dùng cho văn bản chung.
// Tách theo cấu trúc: đoạn văn -> dòng -> từ -> ký tự,
// thay vì cắt cứng theo số ký tự -> chunk mạch lạc hơn cho LLM đọc.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const {
  RecursiveCharacterTextSplitter,
  CharacterTextSplitter,
} = require("@langchain/textsplitters");

// Văn bản mẫu có cả đoạn văn ("\n\n"), câu (". ") và từ (" ").
const someText = `When writing documents, writers will use document structure to group content. \
This can convey to the reader, which idea's are related. For example, closely related ideas \
are in sentances. Similar ideas are in paragraphs. Paragraphs form a document. \n\n  \
Paragraphs are often delimited with a carriage return or two carriage returns. \
Carriage returns are the "backslash n" you see embedded in this string. \
Sentences have a period at the end, but also, have a space.\
and words are separated by space.`;

// In từng chunk có đánh số { 1: chunk, 2: chunk, ... } và tổng số chunk.
function show(title, chunks) {
  console.log(`\n=== ${title} ===`);
  console.log(Object.fromEntries(chunks.map((chunk, i) => [i + 1, chunk])));
  console.log(`Số chunk: ${chunks.length}`);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const cSplitter = new CharacterTextSplitter({
    chunkSize: 450,
    chunkOverlap: 0,
    separator: " ",
  });
  const rSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 450,
    chunkOverlap: 0,
    separators: ["\n\n", "\n", " ", ""],
  });

  // 1. CharacterTextSplitter chỉ biết 1 separator (" ").
  // Không phân biệt ranh giới đoạn văn ("\n\n") với ranh giới từ
  // -> có thể cắt ngang giữa đoạn văn.
  show("CharacterTextSplitter", await cSplitter.splitText(someText));

  // 2. RecursiveCharacterTextSplitter, cơ chế:
  //    a. Tách text bằng separator ưu tiên cao nhất đang có (vd "\n\n").
  //    b. Gộp các mảnh nhỏ vào chung 1 chunk tới khi sắp vượt chunkSize.
  //    c. Mảnh nào tự nó đã vượt chunkSize mới bị tách tiếp
  //       bằng separator thấp hơn ("\n" -> " " -> "").
  show("RecursiveCharacterTextSplitter", await rSplitter.splitText(someText));

  // 3. Giảm chunkSize + thêm ". " (kết thúc câu) vào separators.
  // -> Ưu tiên cắt ở cuối câu, ít khi cắt giữa câu.
  // Lưu ý: ". " bị tách ra khỏi câu, dấu "." có thể nằm ở đầu chunk sau.
  const rSplitterBySentence = new RecursiveCharacterTextSplitter({
    chunkSize: 150,
    chunkOverlap: 0,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });
  show(
    "RecursiveCharacterTextSplitter (chunkSize nhỏ hơn + tách theo câu)",
    await rSplitterBySentence.splitText(someText),
  );
}

main();
