require("dotenv").config();
const {
  CharacterTextSplitter,
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");

// Document Splitting: cắt văn bản dài thành chunk nhỏ trước khi tạo embedding,
// do LLM chỉ đọc được giới hạn token trong 1 lần gọi (context window).

function show(title, chunks) {
  console.log(`\n=== ${title} ===`);
  // In dạng object { 1: chunk, 2: chunk, ... } thay vì mảng cho dễ nhìn từng chunk.
  console.log(Object.fromEntries(chunks.map((chunk, i) => [i + 1, chunk])));
}

async function main() {
  const chunkSize = 26;
  // chunkOverlap: số ký tự cuối của chunk trước được nối thêm vào đầu chunk sau,
  // giúp LLM không mất ngữ cảnh ở ranh giới 2 chunk. Đây là mức TỐI ĐA, 
  // số ký tự giữ lại thực tế có thể ít hơn (không phải luôn "lùi đúng 4 ký tự").
  const chunkOverlap = 4;
  const rSplitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  const cSplitter = new CharacterTextSplitter({ chunkSize, chunkOverlap });

  const text1 = "abcdefghijklmnopqrstuvwxyz";
  const text2 = "abcdefghijklmnopqrstuvwxyzabcdefg";
  const text3 = "a b c d e f g h i j k l m n o p q r s t u v w x y z";

  // Vừa đúng chunkSize -> không cần cắt, trả về nguyên 1 chunk.
  show("text1 (26 ký tự = chunkSize)", await rSplitter.splitText(text1));

  // Dài hơn chunkSize -> cắt thành nhiều chunk, có overlap giữa 2 chunk liền kề
  // (xem giải thích chunkOverlap ở trên).
  show(
    "text2 (dài hơn chunkSize -> có overlap)",
    await rSplitter.splitText(text2),
  );

  // RecursiveCharacterTextSplitter ưu tiên cắt tại khoảng trắng thay vì cắt cứng giữa ký tự.
  // Mỗi chữ giữ luôn dấu cách phía trước (vd " l" = 2 ký tự), dấu cách đó cũng bị tính
  // vào chunkOverlap -> overlap=4 chỉ giữ được 2 chữ ("l m"), không phải 4 chữ.
  show(
    "text3 với RecursiveCharacterTextSplitter",
    await rSplitter.splitText(text3),
  );

  // CharacterTextSplitter mặc định cắt theo "\n\n"; text3 không có "\n\n" nên
  // không cắt được gì, trả về nguyên cả chuỗi.
  show(
    'text3 với CharacterTextSplitter (separator mặc định "\\n\\n")',
    await cSplitter.splitText(text3),
  );

  // Chỉ định separator = " " để CharacterTextSplitter tách theo từ.
  const cSplitterWithSpace = new CharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separator: " ",
  });
  show(
    'text3 với CharacterTextSplitter (separator = " ")',
    await cSplitterWithSpace.splitText(text3),
  );
}

main();
