import { App } from "./app"

const app = new App({
  moduleName: process.env.MOD_NAME || "",
  requestMbLimit: Number(process.env.REQ_MB_LIMIT || "1"),
  function: {
    handler: process.env.FUNC_HANDLER || "",
    timeout: Number(process.env.FUNC_TIMEOUT || "180"),
    port: Number(process.env.FUNC_PORT || "8080"),
    runtime: process.env.FUNC_RUNTIME || "",
    memoryLimit: process.env.FUNC_MEMORY_LIMIT || "",
  }
})

app.start()
