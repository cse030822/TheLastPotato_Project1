import { defineConfig } from "vite";

// preview 하니스가 할당한 포트(PORT 환경변수)를 Vite가 그대로 사용하도록 한다.
// Vite는 기본적으로 PORT를 무시하므로, 명시적으로 읽어 server.port에 반영한다.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  server: {
    port,
  },
});
