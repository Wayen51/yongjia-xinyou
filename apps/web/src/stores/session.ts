import { defineStore } from "pinia";
import { ref } from "vue";

function newSessionId() {
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 全局会话：一次访问一个 sessionId，贯穿 Agent 对话 / 演示天气 / 行程重规划 */
export const useSessionStore = defineStore("session", () => {
  const sessionId = ref<string>(newSessionId());
  const mockWeather = ref<"rain" | "normal">("normal");

  function reset() {
    sessionId.value = newSessionId();
    mockWeather.value = "normal";
  }

  function setMockRain(rain: boolean) {
    mockWeather.value = rain ? "rain" : "normal";
  }

  return { sessionId, mockWeather, reset, setMockRain };
});
