// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BƯỚC 5: TAGGING + EXTRACTION TRÊN DỮ LIỆU THẬT
//
// Áp dụng Tagging + Extraction (file 03, 04) lên 1 bài blog thật,
// thay vì vài câu ví dụ ngắn.
//
// Flow:
// 1. Tải nội dung bài blog.
// 2. Tagging: tóm tắt + ngôn ngữ + từ khóa của bài.
// 3. Extraction: trích danh sách paper được nhắc tới. So sánh prompt chung chung vs chặt chẽ.
// 4. Bài quá dài -> chia nhỏ, trích từng đoạn rồi gộp kết quả.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

// Node 18 chưa có global "File", mà undici (thư viện fetch) cần.
// Thiếu -> CheerioWebBaseLoader lỗi "File is not defined". Lấy tạm từ node:buffer.
if (typeof File === "undefined") {
  global.File = require("node:buffer").File;
}

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { RunnableLambda } = require("@langchain/core/runnables");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  CheerioWebBaseLoader,
} = require("@langchain/community/document_loaders/web/cheerio");
const { zodToFunctionTool } = require("./util-zod-to-tool");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Lấy args của tool_call đầu tiên. Dùng chung cho bước 2 và 3 (chi tiết: 03-tagging.js).
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

// ===== BƯỚC 1: TẢI NỘI DUNG BÀI BLOG =====

// CheerioWebBaseLoader: tải trang web, bỏ HTML, chỉ giữ chữ.
async function loadBlogPost() {
  const loader = new CheerioWebBaseLoader(
    "https://lilianweng.github.io/posts/2023-06-23-agent/",
  );
  const [doc] = await loader.load();

  // Bước 2, 3 chỉ dùng 10000 ký tự đầu cho nhanh. Bước 4 dùng cả bài (doc).
  const pageContent = doc.pageContent.slice(0, 10000);

  console.log("\n=== 1. Nội dung bài blog (1000 ký tự đầu) ===");
  console.log(pageContent.slice(0, 1000));

  return { doc, pageContent };
}

// ===== BƯỚC 2: TAGGING TỔNG QUAN BÀI VIẾT (OVERVIEW) =====

// Gắn nhãn tổng quan cho bài: tóm tắt, ngôn ngữ, từ khóa.
async function overviewTaggingDemo(pageContent) {
  const overviewSchema = z.object({
    summary: z.string().describe("Provide a concise summary of the content."),
    language: z
      .string()
      .describe("Provide the language that the content is written in."),
    keywords: z.string().describe("Provide keywords related to the content."),
  });

  const overviewTool = zodToFunctionTool(
    "Overview",
    "Overview of a section of text.",
    overviewSchema,
  );

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Think carefully, and then tag the text as instructed"],
    ["human", "{input}"],
  ]);
  // Ép model luôn gọi tool "Overview" (các option tool_choice: 03-tagging.js).
  const taggingModel = model.withConfig({
    tools: [overviewTool],
    tool_choice: "Overview",
  });
  const taggingChain = prompt.pipe(taggingModel).pipe(extractFirstToolArgs);

  const result = await taggingChain.invoke({ input: pageContent });
  console.log("\n=== 2. Overview tagging (summary/language/keywords) ===");
  console.log(result);
}

// ===== BƯỚC 3: TRÍCH DANH SÁCH PAPER TRONG BÀI =====

// So sánh 2 prompt (chung chung vs chặt chẽ). Trả chain chặt chẽ để dùng ở bước 4.
async function paperExtractionDemo(pageContent) {
  // 1 paper: tên + tác giả (có thể không có).
  const paperSchema = z.object({
    title: z.string(),
    author: z.string().optional(),
  });
  const infoSchema = z.object({
    papers: z
      .array(paperSchema)
      .describe("List of papers mentioned in the text"),
  });

  const infoTool = zodToFunctionTool(
    "Info",
    "Information to extract",
    infoSchema,
  );
  // Ép model luôn gọi tool "Info".
  const extractionModel = model.withConfig({
    tools: [infoTool],
    tool_choice: "Info",
  });

  // 3a. Prompt chung chung -> model có thể lấy nhầm tiêu đề bài viết làm "paper".
  const genericPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Extract the relevant information, if not explicitly provided do not guess. Extract partial info",
    ],
    ["human", "{input}"],
  ]);
  const genericExtractionChain = genericPrompt
    .pipe(extractionModel)
    .pipe(extractFirstToolArgs)
    .pipe(RunnableLambda.from((args) => args.papers));

  const genericResult = await genericExtractionChain.invoke({
    input: pageContent,
  });
  console.log("\n=== 3a. Trích paper - prompt chung chung ===");
  console.log(genericResult);

  // 3b. Prompt chặt chẽ: không lấy tên bài viết, không bịa,
  // không có paper thì trả mảng rỗng.
  const strictTemplate = `A article will be passed to you. Extract from it all papers that are mentioned by this article follow by its author.

Do not extract the name of the article itself. If no papers are mentioned that's fine - you don't need to extract any! Just return an empty list.

Do not make up or guess ANY extra information. Only extract what exactly is in the text.`;

  const strictPrompt = ChatPromptTemplate.fromMessages([
    ["system", strictTemplate],
    ["human", "{input}"],
  ]);
  const extractionChain = strictPrompt
    .pipe(extractionModel)
    .pipe(extractFirstToolArgs)
    .pipe(RunnableLambda.from((args) => args.papers));

  const strictResult = await extractionChain.invoke({ input: pageContent });
  console.log("\n=== 3b. Trích paper - prompt chặt chẽ hơn ===");
  console.log(strictResult);

  // 3c. Text không nhắc paper nào -> kỳ vọng mảng rỗng, không bịa.
  const emptyResult = await extractionChain.invoke({ input: "hi" });
  console.log("\n=== 3c. Trích paper - văn bản không có paper nào ===");
  console.log(emptyResult);

  return extractionChain;
}

// ===== BƯỚC 4: EXTRACTION TRÊN TOÀN BỘ BÀI (CHIA NHỎ BẰNG SPLITTER) =====

// Cả bài quá dài cho 1 lần gọi model. Cách xử lý:
// 1. Chia bài thành nhiều đoạn nhỏ (splits).
// 2. Chạy extraction riêng cho từng đoạn.
// 3. Gộp kết quả (mảng của mảng) thành 1 mảng phẳng bằng .flat().
async function fullDocumentExtractionDemo(doc, extractionChain) {
  const textSplitter = new RecursiveCharacterTextSplitter({ chunkOverlap: 0 });
  const splits = await textSplitter.splitText(doc.pageContent);

  console.log("\n=== 4a. Số đoạn sau khi chia nhỏ (splits) ===");
  console.log("Số đoạn:", splits.length);
  console.log("Đoạn đầu tiên (splits[0]):", splits[0]);

  // prep: text dài -> mảng input, mỗi đoạn thành { input: chunk }.
  const prep = RunnableLambda.from(async (pageContent) => {
    const chunks = await textSplitter.splitText(pageContent);
    return chunks.map((chunk) => ({ input: chunk }));
  });

  console.log("\n=== 4b. prep.invoke('hi') (input ngắn -> vẫn ra 1 chunk) ===");
  console.log(await prep.invoke("hi"));

  // Chain:
  // 1. prep: chia nhỏ.
  // 2. extractionChain.map(): chạy extractionChain song song trên từng đoạn.
  // 3. .flat(): gộp kết quả. Vd: [[1,2], [3], [4,5]] -> [1,2,3,4,5].
  //
  // Lưu ý: mỗi đoạn = 1 lần gọi model -> tốn API call, nên mặc định tắt.
  const chain = prep
    .pipe(extractionChain.map())
    .pipe(RunnableLambda.from((results) => results.flat()));

  console.log(
    "\n=== 4c. Trích paper trên toàn bộ bài viết (bỏ comment để chạy) ===",
  );
  // const fullResult = await chain.invoke(doc.pageContent);
  // console.log(fullResult);
  console.log("(đang tắt - xem comment trong code để bật)");
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Bước 1: tải bài blog.
  const { doc, pageContent } = await loadBlogPost();

  // Bước 2: tagging tổng quan.
  await overviewTaggingDemo(pageContent);

  // Bước 3: trích danh sách paper, lấy lại chain chặt chẽ cho bước 4.
  const extractionChain = await paperExtractionDemo(pageContent);

  // Bước 4: trích paper trên toàn bộ bài (chia nhỏ).
  await fullDocumentExtractionDemo(doc, extractionChain);
}

main();
