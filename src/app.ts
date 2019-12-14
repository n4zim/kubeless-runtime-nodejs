import express from "express"
import morgan from "morgan"
import bodyParser from "body-parser"
import path from "path"
import vm from "vm"
import { readFileSync } from "fs"
import promClient from "prom-client"
import Module from "module"

interface AppParams {
  requestMbLimit: number
  moduleName: string
  function: {
    handler: string
    timeout: number
    port: number
    runtime: string
    memoryLimit: string
  }
}

interface AppPaths {
  root: string
  module: string
  libs: string
}

export class App {
  params: AppParams
  express: express.Express
  paths: AppPaths
  dependencies: any
  metrics: any

  constructor(params: AppParams) {
    this.params = params
    this.express = express()
    this.configureExpress()
    this.paths = this.getPaths()
    this.dependencies = this.getDependencies()
    this.metrics = this.prepareStatistics("method")
    this.configureExpressRoutes()
  }

  private configureExpress() {
    this.express.use(morgan("combined"))

    this.express.use(bodyParser.raw({
      type: (req: any) => !req.is("multipart/*"),
      limit: `${this.params.requestMbLimit}mb`,
    }))

    this.express.use(bodyParser.json({ limit: `${this.params.requestMbLimit}mb` }))
    this.express.use(bodyParser.urlencoded({ limit: `${this.params.requestMbLimit}mb`, extended: true }))
  }

  private getPaths(): AppPaths {
    const rootPath = path.join(__filename, "..", "..", "..", "kubeless")
    const modulePath = path.join(rootPath, `${this.params.moduleName}.js`)
    const libsPath = path.join(modulePath, "node_modules")
    return {
      root: rootPath,
      module: modulePath,
      libs: libsPath,
    }
  }

  private getDependencies() {
    try {
      const data = JSON.parse(readFileSync(path.join(this.paths.root, "package.json")) as any)
      const deps = data.dependencies
      return (deps && typeof deps === "object") ? Object.getOwnPropertyNames(deps) : []
    } catch(e) {
      return []
    }
  }

  private prepareStatistics(label: any) {
    return {
      timeHistogram: new promClient.Histogram({
        name: "function_duration_seconds",
        help: "Duration of user function in seconds",
        labelNames: [ label ],
      }),
      callsCounter: new promClient.Counter({
        name: "function_calls_total",
        help: "Number of calls to user function",
        labelNames: [ label ],
      }),
      errorsCounter: new promClient.Counter({
        name: "function_failures_total",
        help: "Number of exceptions in user function",
        labelNames: [ label ],
      }),
    }
  }

  private funcLabel(req: any) {
    return this.params.moduleName + "-" + req.method
  }

  private handleError(err: any, res: any, label: any, end: any) {
    this.metrics.errorsCounter.labels(label).inc()
    res.status(500).send("Internal Server Error")
    console.error(`Function failed to execute: ${err.stack}`)
    end()
  }

  private modFinalize(result: any, res: any, end: any) {
    if(!res.finished) switch(typeof result) {
      case "string":
        res.end(result)
        break
      case "object":
        res.json(result) // includes res.end(), null also handled
        break
      case "undefined":
        res.end()
        break
      default:
        res.end(JSON.stringify(result))
    }
    end()
  }

  private modExecute(handler: any, req: any, res: any, end: any) {
    let func = null
    switch(typeof handler) {
      case "function":
        func = handler
        break
      case "object":
        if(handler) func = handler[this.params.function.handler]
        break
    }
    if(func === null) {
      throw new Error(`Unable to load ${handler}`)
    }
    try {
      let data = req.body
      if(!req.is("multipart/*") && req.body.length > 0) {
        if(req.is("application/json")) {
          data = JSON.parse(req.body.toString("utf-8"))
        } else {
          data = req.body.toString("utf-8")
        }
      }
      const event = {
        "event-type": req.get("event-type"),
        "event-id": req.get("event-id"),
        "event-time": req.get("event-time"),
        "event-namespace": req.get("event-namespace"),
        data,
        "extensions": { request: req, response: res },
      }
      const context = {
        "function-name": this.params.function.handler,
        "timeout" : this.params.function.timeout,
        "runtime": this.params.function.runtime,
        "memory-limit": this.params.function.memoryLimit,
      }
      Promise.resolve(func(event, context))
        // Finalize
        .then(rval => this.modFinalize(rval, res, end))
        // Catch asynchronous errors
        .catch(err => this.handleError(err, res, this.funcLabel(req), end))
    } catch(err) {
      // Catch synchronous errors
      this.handleError(err, res, this.funcLabel(req), end)
    }
  }

  private modRequire(p: any, req: any, res: any, end: any) {
    if(p === "kubeless")  return (handler: any) => this.modExecute(handler, req, res, end)
    if(this.dependencies.includes(p)) return require(path.join(this.paths.libs, p))
    if(p.indexOf("./") === 0) return require(path.join(path.dirname(this.paths.module), p))
    return require(p)
  }

  private configureExpressRoutes() {
    this.express.get("/healthz", (req, res) => {
      res.status(200).send("OK")
    })

    this.express.get("/metrics", (req, res) => {
      res.status(200)
      res.type(promClient.register.contentType)
      res.send(promClient.register.metrics())
    })

    this.express.all("*", (req, res) => {
      res.header("Access-Control-Allow-Origin", "*")
      if(req.method === "OPTIONS") {
        // CORS preflight support (Allow any method or header requested)
        res.header("Access-Control-Allow-Methods", req.headers["access-control-request-method"])
        res.header("Access-Control-Allow-Headers", req.headers["access-control-request-headers"])
        res.end()
      } else {
        const label = this.funcLabel(req)
        const end = this.metrics.timeHistogram.labels(label).startTimer()
        this.metrics.callsCounter.labels(label).inc()

        const sandbox = Object.assign({}, global, {
          __filename: this.paths.module,
          __dirname: this.paths.root,
          module: new Module(this.paths.module, null as any),
          require: (p: any) => this.modRequire(p, req, res, end),
        })

        const script = new vm.Script(`\nrequire("kubeless")(require("${this.paths.module}"))\n`, {
          filename: this.paths.module,
          displayErrors: true,
        })

        try {
          script.runInNewContext(sandbox, { timeout : this.params.function.timeout * 1000 })
        } catch (err) {
          if(err.toString().match("Error: Script execution timed out")) {
            res.status(408).send(err)
            // We cannot stop the spawned process (https://github.com/nodejs/node/issues/3020)
            // we need to abruptly stop this process
            console.error("CRITICAL: Unable to stop spawned process. Exiting")
            process.exit(1)
          } else {
            this.handleError(err, res, this.funcLabel, end)
          }
        }
      }
    })
  }

  start() {
    this.express.listen(this.params.function.port)
  }
}
