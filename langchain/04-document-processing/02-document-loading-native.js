// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 2B: ĐỌC PDF BẰNG pdf-parse (KHÔNG DÙNG PDFLoader)
//
// Bản thay thế PDFLoader ở 02-document-loading.js (@langchain/community đang bị sunset).
// Tự làm việc của loader:
// 1. pdf-parse đọc file PDF.
// 2. Callback pagerender tách text theo từng trang.
// 3. Mỗi trang -> 1 LangChain Document { pageContent, metadata }.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const { Document } = require("@langchain/core/documents");

// Ghép các mảnh text của 1 trang PDF thành chuỗi, giữ đúng xuống dòng.
async function renderPage(pageData) {
  const textContent = await pageData.getTextContent();

  let lastY;
  let text = "";

  // Mỗi item là 1 mảnh text trên trang. transform[5]: tọa độ Y.
  // Cùng Y -> cùng dòng, nối liền. Khác Y -> xuống dòng.
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }

    lastY = item.transform[5];
  }

  return text;
}

// Đọc PDF, đổi thành mảng Document (mỗi trang 1 Document).
async function loadPdf() {
  console.log("=== PDFLoader (native, pdf-parse) ===");

  const filePath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );

  const buffer = fs.readFileSync(filePath);
  const pageTexts = [];

  // pagerender: gọi 1 lần cho mỗi trang -> gom text từng trang vào pageTexts.
  // pdf() mặc định nối text mọi trang thành 1 chuỗi (data.text), mất ranh giới trang.
  const data = await pdf(buffer, {
    pagerender: async (pageData) => {
      const text = await renderPage(pageData);
      pageTexts.push(text);
      return text;
    },
  });

  // Mỗi trang -> 1 Document. Metadata giống format của PDFLoader.
  const pages = pageTexts.map(
    (text, i) =>
      new Document({
        pageContent: text,
        metadata: {
          source: filePath,
          pdf: {
            version: data.version,
            info: data.info,
            metadata: data.metadata,
            totalPages: data.numpages,
          },
          loc: {
            pageNumber: i + 1,
          },
        },
      }),
  );

  console.log("Số lượng trang PDF:", pages.length);
  console.log(pages[0].pageContent.slice(0, 500));
  console.log(pages[0].metadata);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await loadPdf();
}

main();
