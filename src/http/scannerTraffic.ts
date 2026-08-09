import type { Request } from "express";

export type ScannerTrafficCategory =
  | "wordpress_probe"
  | "php_probe"
  | "secret_file_probe"
  | "vcs_probe"
  | "database_admin_probe"
  | "backup_probe"
  | "generic_scanner_probe";

export type ScannerTrafficClassification = {
  category: ScannerTrafficCategory;
  path: string;
};

export type ScannerTrafficOptionsInternal = {
  enabled?: boolean;
  patterns?: Array<string | RegExp>;
};

type ScannerRule = {
  category: ScannerTrafficCategory;
  pattern: RegExp;
};

const DEFAULT_SCANNER_RULES: ScannerRule[] = [
  { category: "wordpress_probe", pattern: /^\/wp(?:-|\/|$)/i },
  { category: "wordpress_probe", pattern: /^\/xmlrpc\.php$/i },
  { category: "wordpress_probe", pattern: /^\/wlwmanifest\.xml$/i },
  { category: "php_probe", pattern: /\.php(?:\/|$|\?)/i },
  { category: "database_admin_probe", pattern: /^\/(?:phpmyadmin|pma|myadmin|mysql|adminer)(?:\/|\.php|$)/i },
  { category: "secret_file_probe", pattern: /^\/\.(?:env|aws|npmrc|htpasswd)(?:\.|\/|$)/i },
  { category: "secret_file_probe", pattern: /^\/(?:env|config|configuration|settings)(?:\.|\/).*/i },
  { category: "vcs_probe", pattern: /^\/\.(?:git|svn|hg)(?:\/|$)/i },
  { category: "backup_probe", pattern: /\.(?:bak|backup|old|orig|save|swp|sql|zip|tar|gz|rar|7z)(?:$|\?)/i },
  { category: "generic_scanner_probe", pattern: /^\/(?:vendor|cgi-bin|boaform|shell|manager|solr|actuator)(?:\/|$)/i },
];

function getRequestPath(req: Request): string {
  const path = req.path || req.url || "/";
  return path.split("?")[0] || "/";
}

function matchesPattern(pattern: string | RegExp, path: string): boolean {
  if (typeof pattern === "string") return path === pattern || path.startsWith(pattern);
  return pattern.test(path);
}

export function classifyScannerTraffic(
  req: Request,
  options?: ScannerTrafficOptionsInternal
): ScannerTrafficClassification | null {
  if (options?.enabled === false) return null;

  const path = getRequestPath(req);

  if ((options?.patterns || []).some((pattern) => matchesPattern(pattern, path))) {
    return { category: "generic_scanner_probe", path };
  }

  const foundRule = DEFAULT_SCANNER_RULES.find((rule) => rule.pattern.test(path));
  if (!foundRule) return null;

  return {
    category: foundRule.category,
    path,
  };
}
