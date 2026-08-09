import * as http from "http";
import * as https from "https";
import { IncomingMessage } from "http";

export async function sendIngest(
  endpoint: string,
  token: string,
  payload: any,
  timeoutMs = 2000
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const data = Buffer.from(JSON.stringify(payload));
      const url = new URL(endpoint);
      const transport = url.protocol === "http:" ? http : https;
      const port = url.port || (url.protocol === "http:" ? 80 : 443);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        resolve();
        return;
      }

      const req = transport.request(
        {
          method: "POST",
          hostname: url.hostname,
          port,
          path: `${url.pathname}${url.search}`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length,
            "Authorization": `Bearer ${token}`,
          },
          timeout: timeoutMs,
        },
        (res: IncomingMessage) => {
          // Do not keep the host app waiting regardless of 2xx/4xx/5xx responses.
          res.resume();
          resolve();
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve();
      });
      req.on("error", () => resolve());

      req.write(data);
      req.end();
    } catch {
      resolve();
    }
  });
}
