import { createWorkerApp } from "../outputs/remote-worker/src/app.js";
import { normalizeVercelRequest } from "../outputs/remote-worker/src/vercel.js";

let app = null;

export default {
  fetch(request) {
    if (!app) app = createWorkerApp(process.env);
    return app.fetch(normalizeVercelRequest(request));
  },
};
