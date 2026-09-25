// =======================================================================
// NODES: Gom các node lại 1 chỗ để graph.js import gọn trong 1 dòng.
// =======================================================================

const { generate } = require("./generate");
const { gradeDocuments } = require("./grade-documents");
const { retrieve } = require("./retrieve");
const { webSearch } = require("./web-search");

module.exports = { generate, gradeDocuments, retrieve, webSearch };
