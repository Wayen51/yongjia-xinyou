import { config } from "./config.ts";
import { getSessionWeather } from "../db/db.ts";

const YONGJIA_LOCATION_ID = "101210806"; // 和风天气·温州永嘉

type QWeatherNow = {
  code: string;
  now?: {
    temp: string;
    text: string;
    windDir: string;
    windScale: string;
    humidity: string;
  };
};

type QWeatherHourly = {
  code: string;
  hourly?: Array<{
    fxTime: string;
    temp: string;
    text: string;
    pop?: string; // 降水概率
  }>;
};

async function fetchLiveWeather(locationId: string) {
  const key = config.weatherApiKey;
  const base = "https://devapi.qweather.com/v7";
  const [nowRes, hourlyRes] = await Promise.all([
    fetch(`${base}/weather/now?location=${locationId}&key=${key}`),
    fetch(`${base}/weather/24h?location=${locationId}&key=${key}`),
  ]);
  const now = (await nowRes.json()) as QWeatherNow;
  const hourly = (await hourlyRes.json()) as QWeatherHourly;
  if (now.code !== "200") throw new Error(`QWEATHER_${now.code}`);

  const forecast = (hourly.hourly || [])
    .filter((_, i) => i % 3 === 0) // 每3小时取一个点
    .slice(0, 4)
    .map((h) => ({
      time: h.fxTime.slice(11, 16),
      weather: h.text,
      temp: Number(h.temp),
      precipProb: Number(h.pop || 0),
    }));

  const current = now.now!;
  return {
    location: "永嘉县",
    mock: false,
    current: {
      temp: Number(current.temp),
      weather: current.text,
      wind: `${current.windDir} ${current.windScale}级`,
      humidity: Number(current.humidity),
    },
    forecast: forecast.length ? forecast : [
      { time: "现在", weather: current.text, temp: Number(current.temp), precipProb: 0 },
    ],
    summary: `永嘉当前${current.text}，${current.temp}°C，${current.windDir}${current.windScale}级`,
  };
}

export async function queryWeather(sessionId: string, location = "永嘉县") {
  // 演示控制台强制暴雨
  const mock = getSessionWeather(sessionId);
  if (mock === "rain") {
    return {
      location,
      mock: true,
      forecast: [
        { time: "09:00", weather: "多云", temp: 24, precipProb: 20 },
        { time: "14:00", weather: "暴雨", temp: 21, precipProb: 95 },
        { time: "15:00", weather: "暴雨", temp: 20, precipProb: 90 },
        { time: "18:00", weather: "中雨", temp: 21, precipProb: 70 },
      ],
      summary: "14:00-18:00 鹤盛镇中到大雨，伴有短时强降水",
    };
  }

  // 有API key则调用真实天气
  if (config.weatherApiKey) {
    try {
      return await fetchLiveWeather(YONGJIA_LOCATION_ID);
    } catch (err) {
      console.warn("[weather] live fetch failed, fallback to mock:", err);
    }
  }

  // 默认mock晴天
  return {
    location,
    mock: true,
    forecast: [
      { time: "09:00", weather: "晴", temp: 26, precipProb: 5 },
      { time: "14:00", weather: "多云", temp: 28, precipProb: 10 },
      { time: "18:00", weather: "晴", temp: 24, precipProb: 8 },
    ],
    summary: "今日永嘉晴到多云，适宜出行",
  };
}
