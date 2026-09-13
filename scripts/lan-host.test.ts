import { describe, expect, it } from "vitest";
import { resolveLanHost } from "./lan-host.ts";

describe("resolveLanHost", () => {
  it.each(["127.0.0.1", "localhost", "192.168.1.20", "10.0.0.2", "172.20.1.3", "fd12::1"])("accepts loopback and private LAN host %s", (host) => {
    expect(resolveLanHost(host)).toBe(host);
  });

  it.each(["0.0.0.0", "8.8.8.8", "example.com", "172.32.0.1"])("rejects public or wildcard host %s", (host) => {
    expect(() => resolveLanHost(host)).toThrow(/private LAN address/);
  });
});
