// =======================================================================
// NODE: GRADE DOCUMENTS
// Lọc bỏ các chunk không liên quan đến câu hỏi.
// Đầu vào: question, documents -> Đầu ra: documents (đã lọc), webSearch
// =======================================================================

const { logStep, logDecision, logDetail } = require("../../flow-logger");
const { retrievalGrader } = require("../chains/retrieval-grader");

/**
 * Chấm từng chunk bằng retrievalGrader.
 * - Liên quan: giữ lại.
 * - Không liên quan: bỏ đi + bật webSearch = true.
 *
 * Trả về webSearch để decideToGenerate (graph.js) chọn nhánh:
 * true -> websearch tìm bù phần thiếu, false -> generate trả lời luôn.
 */
async function gradeDocuments(state) {
  const { question, documents } = state;
  logStep(
    "node",
    "GRADE DOCUMENTS",
    `Chấm ${documents.length} chunk có liên quan đến câu hỏi không`,
  );

  const filteredDocs = [];
  let webSearch = false;

  for (const [i, doc] of documents.entries()) {
    logDetail(`Chunk ${i + 1}/${documents.length} (${doc.metadata.source ?? "web"})`);
    const score = await retrievalGrader.invoke({
      question,
      document: doc.pageContent,
    });

    if (score.binaryScore.toLowerCase() === "yes") {
      logDecision("DOCUMENT RELEVANT -> giữ lại");
      filteredDocs.push(doc);
    } else {
      logDecision("DOCUMENT NOT RELEVANT -> bỏ, bật webSearch");
      webSearch = true;
    }
  }

  return { documents: filteredDocs, question, webSearch };
}

module.exports = { gradeDocuments };
