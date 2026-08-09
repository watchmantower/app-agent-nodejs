import type { ErrorRequestHandler, Request } from "express";
import { ErrorCollector } from "../collector/errorCollector";
import { ErrorHandlerOptions } from "../types";
import { normalizeRoute } from "./express";

const DEFAULT_MAX_ERRORS = 100;
const DEFAULT_MAX_MESSAGE_LENGTH = 500;
const DEFAULT_MAX_STACK_LENGTH = 4000;

function truncate(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function getStatus(err: any, resStatusCode: number) {
  const status = Number(err?.status || err?.statusCode || resStatusCode || 500);
  if (!Number.isInteger(status) || status < 400 || status > 599) return 500;
  return status;
}

function getErrorName(err: any) {
  return truncate(err?.name || "Error", 120) || "Error";
}

function getErrorMessage(err: any, maxLength: number) {
  return truncate(err?.message || "Unhandled error", maxLength) || "Unhandled error";
}

export function createErrorHandler(
  collector: ErrorCollector,
  opts?: ErrorHandlerOptions & { maxRouteLength?: number }
): ErrorRequestHandler {
  const captureStack = opts?.captureStack ?? false;
  const maxErrors = opts?.maxErrors ?? DEFAULT_MAX_ERRORS;
  const maxMessageLength = opts?.maxErrorMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
  const maxStackLength = opts?.maxErrorStackLength ?? DEFAULT_MAX_STACK_LENGTH;
  const maxRouteLength = opts?.maxRouteLength ?? 160;

  return function appAgentErrorHandler(err, req: Request, res, next) {
    try {
      collector.record(
        {
          method: req.method,
          route: normalizeRoute(req, maxRouteLength),
          status: getStatus(err, res.statusCode),
          name: getErrorName(err),
          message: getErrorMessage(err, maxMessageLength),
          stack: captureStack ? truncate(err?.stack, maxStackLength) : null,
        },
        maxErrors
      );
    } catch {
      // The agent must never affect the host app.
    }

    next(err);
  };
}
