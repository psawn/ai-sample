// Tool gọi API thật (Open-Meteo) để lấy nhiệt độ hiện tại theo toạ độ - minh hoạ Tool có
// thể làm bất cứ việc gì bên trong, LLM chỉ cần biết name/description/schema.
require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { convertToOpenAIFunction } = require("@langchain/core/utils/function_calling");

// LLM phải tự suy ra latitude/longitude từ tên địa điểm (vd: "San Francisco" -> 37.77,
// -122.41) rồi mới gọi được Tool này.
const OpenMeteoInput = z.object({
  latitude: z.number().describe("Latitude of the location to fetch weather data for"),
  longitude: z.number().describe("Longitude of the location to fetch weather data for"),
});

// Hàm thực thi thật của Tool - đây là nơi mọi việc thật sự xảy ra (gọi API, tính toán).
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

  // API trả về nhiệt độ theo từng giờ trong ngày - cần tìm mốc giờ gần với hiện tại nhất.
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

// tool(fn, options) chỉ "gắn nhãn" cho fetchCurrentTemperature, không thay đổi cách nó
// chạy - .invoke(args) sau này sẽ gọi lại đúng fetchCurrentTemperature(args).
const getCurrentTemperature = tool(fetchCurrentTemperature, {
  name: "get_current_temperature",
  description: "Fetch current temperature for given coordinates.",
  schema: OpenMeteoInput,
});

async function main() {
  console.log("name:", getCurrentTemperature.name);
  console.log("description:", getCurrentTemperature.description);

  // convertToOpenAIFunction: xem schema function-calling thật sự được gửi cho LLM.
  console.log(
    "\nOpenAI function schema:",
    JSON.stringify(convertToOpenAIFunction(getCurrentTemperature), null, 2),
  );

  try {
    const result = await getCurrentTemperature.invoke({ latitude: 13, longitude: 14 });
    console.log("\nresult:", result);
  } catch (error) {
    console.log("\nexception on external access");
  }
}

// require.main === module kiểm tra file này có phải là file gốc đang được thực thi hay không.
// - Đúng (chạy trực tiếp `node file.js`): Gọi main().
// - Sai (file khác require() file này): Bỏ qua main() để chỉ xuất module ra ngoài.
if (require.main === module) {
  main();
}

module.exports = { getCurrentTemperature };
