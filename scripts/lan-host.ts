import { isIP } from "node:net";

export function resolveLanHost(value = process.env.AITUBER_LAN_HOST ?? "127.0.0.1"): string {
  const host = value.trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return host;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return host;
  throw new Error("AITUBER_LAN_HOST must be localhost or a private LAN address; wildcard and public addresses are not allowed");
}

function isPrivateIpv4(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return first === 10 || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
}

function isPrivateIpv6(host: string): boolean {
  return isIP(host) === 6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb"));
}
