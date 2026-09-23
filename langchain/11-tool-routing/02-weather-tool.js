// =======================================================================
// TOOL ROUTING - BƯỚC 2: TOOL GỌI API THẬT (OPEN-METEO - THỜI TIẾT)
//
// Tool gọi API Open-Meteo, lấy nhiệt độ hiện tại theo tọa độ.
// Bên trong Tool làm gì cũng được (gọi API, tính toán...).
// LLM chỉ cần biết name / description / schema.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { convertToOpenAIFunction } = require("@langchain/core/utils/function_calling");

// Schema tham số: Tool nhận tọa độ, không nhận tên địa điểm.
// LLM phải tự đổi tên -> tọa độ trước khi gọi.
// Vd: "San Francisco" -> latitude 37.77, longitude -122.41.
const OpenMeteoInput = z.object({
  latitude: z.number().describe("Latitude of the location to fetch weather data for"),
  longitude: z.number().describe("Longitude of the location to fetch weather data for"),
});

// Hàm thực thi của Tool: gọi API, trả nhiệt độ dạng text.
async function fetchCurrentTemperature({ latitude, longitude }) {
  const BASE_URL = "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "temperature_2m",
    forecast_days: "1",
  });

  const response = await fetch(`${BASE_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`API Request failed with status code: ${response.status}`);
  }
  const results = await response.json();

  // API trả nhiệt độ theo từng giờ trong ngày -> lấy mốc giờ gần hiện tại nhất.
  const currentUtcTime = new Date();
  const timeList = results.hourly.time.map((t) => new Date(t));
  const temperatureList = results.hourly.temperature_2m;

  let closestIndex = 0;
  let smallestDiff = Infinity;
  timeList.forEach((time, i) => {
    const diff = Math.abs(time - currentUtcTime);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = i;
    }
  });

  const result = `The current temperature is ${temperatureList[closestIndex]}°C`;
  console.log("kết quả fetchCurrentTemperature:", result);
  return result;
}

// tool(fn, options): chỉ gắn name / description / schema cho fn, không đổi cách fn chạy.
// .invoke(args) -> gọi fetchCurrentTemperature(args).
const getCurrentTemperature = tool(fetchCurrentTemperature, {
  name: "get_current_temperature",
  description: "Fetch current temperature for given coordinates.",
  schema: OpenMeteoInput,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log("name:", getCurrentTemperature.name);
  console.log("description:", getCurrentTemperature.description);

  // convertToOpenAIFunction: xem Tool dưới dạng function schema, đúng format gửi cho LLM.
  console.log(
    "\nOpenAI function schema:",
    JSON.stringify(convertToOpenAIFunction(getCurrentTemperature), null, 2),
  );

  // Gọi thẳng Tool, không qua LLM, với 1 tọa độ bất kỳ.
  try {
    const result = await getCurrentTemperature.invoke({ latitude: 13, longitude: 14 });
    console.log("\nresult:", result);
  } catch (error) {
    console.log("\nexception on external access");
  }
}

// Chỉ chạy main() khi chạy trực tiếp `node 02-weather-tool.js`.
// File khác require() file này (05, 06, 07) -> không chạy main(), chỉ lấy Tool.
if (require.main === module) {
  main();
}

module.exports = { getCurrentTemperature };
