require("../_polyfill");
require("dotenv").config();
const {
  RecursiveCharacterTextSplitter,
  CharacterTextSplitter,
} = require("@langchain/textsplitters");

const someText = `When writing documents, writers will use document structure to group content. \
This can convey to the reader, which idea's are related. For example, closely related ideas \
are in sentances. Similar ideas are in paragraphs. Paragraphs form a document. \n\n  \
Paragraphs are often delimited with a carriage return or two carriage returns. \
Carriage returns are the "backslash n" you see embedded in this string. \
Sentences have a period at the end, but also, have a space.\
and words are separated by space.`;

// RecursiveCharacterTextSplitter là lựa chọn khuyên dùng cho văn bản chung: nó ưu tiên
// tách theo cấu trúc (đoạn văn -> dòng -> từ -> ký tự) thay vì cắt cứng theo ký tự,
// nên chunk tạo ra mạch lạc hơn cho LLM đọc (cơ chế chi tiết xem comment bên dưới).

function show(title, chunks) {
  console.log(`\n=== ${title} ===`);
  // In dạng object { 1: chunk, 2: chunk, ... } thay vì mảng cho dễ nhìn từng chunk.
  console.log(Object.fromEntries(chunks.map((chunk, i) => [i + 1, chunk])));
  console.log(`Số chunk: ${chunks.length}`);
}

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

  // CharacterTextSplitter chỉ biết 1 separator (" ") nên không phân biệt được ranh giới
  // đoạn văn ("\n\n") với ranh giới từ (" ") -> có thể cắt ngang giữa 1 đoạn văn.
  show("CharacterTextSplitter", await cSplitter.splitText(someText));

  // Cơ chế:
  // 1. Chọn 1 separator ưu tiên cao nhất đang có trong text để tách thành các mảnh
  //    (vd ưu tiên "\n\n" trước).
  // 2. Mảnh nào < chunkSize thì gộp chung 1 chunk, gộp tới khi vượt chunkSize thì
  //    cắt sang chunk mới (giữ overlap) -- vẫn dùng separator đó, KHÔNG đổi separator.
  // 3. Chỉ mảnh nào tự nó đã >= chunkSize (vd 1 đoạn văn quá dài) mới bị tách tiếp
  //    bằng separator ưu tiên thấp hơn ("\n", rồi " ", rồi "").
  show("RecursiveCharacterTextSplitter", await rSplitter.splitText(someText));

  // Giảm chunkSize và thêm ". " (kết thúc câu) vào danh sách separator, để mỗi chunk
  // chứa trọn vẹn câu văn thay vì bị cắt giữa câu -> LLM đọc ngữ cảnh mạch lạc hơn.
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
