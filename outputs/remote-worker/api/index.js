import { createWorkerApp } from "../src/app.js";
import { normalizeVercelRequest } from "../src/vercel.js";

let app = null;

export default {
  fetch(request) {
    if (!app) app = createWorkerApp(process.env);
    return app.fetch(normalizeVercelRequest(request));
  },
};
