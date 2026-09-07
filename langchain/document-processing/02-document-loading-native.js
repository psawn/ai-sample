require("../_polyfill");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const { Document } = require("@langchain/core/documents");

// Bản thay thế 02-document-loading.js (PDFLoader của @langchain/community, đang bị
// sunset): dùng thẳng pdf-parse, tự tách text theo từng trang qua callback pagerender.
async function renderPage(pageData) {
  const textContent = await pageData.getTextContent();

  let lastY;
  let text = "";

  // Mỗi item là một mảnh text trên trang PDF.
  // Cùng tọa độ Y → cùng dòng, khác Y → xuống dòng.
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

async function loadPdf() {
  console.log("=== PDFLoader (native, pdf-parse) ===");

  const filePath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );

  const buffer = fs.readFileSync(filePath);
  const pageTexts = [];

  const data = await pdf(buffer, {
    pagerender: async (pageData) => {
      const text = await renderPage(pageData);
      pageTexts.push(text);
      return text;
    },
  });

  // Mỗi trang PDF được chuyển thành một LangChain Document.
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

async function main() {
  await loadPdf();
}

main();
