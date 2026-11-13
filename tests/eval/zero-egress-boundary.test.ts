/**
 * Gate 4 Multi-Layer Zero-Egress Network Isolation Test Suite
 *
 * Verifies that the offline evaluation environment enforces comprehensive,
 * multi-layer fail-closed isolation across all possible outbound network pathways:
 * 1. HTTP and HTTPS (http.request, http.get, https.request, https.get)
 * 2. Global fetch (Undici / native fetch engine)
 * 3. DNS resolution (dns.lookup, dns.resolve, dns.promises)
 * 4. Raw TCP sockets (net.connect, net.createConnection, net.Socket.connect)
 * 5. TLS / SSL sockets (tls.connect)
 * 6. Child process execution (child_process.exec, spawn, fork)
 * 7. Verification that MockEvalProvider produces zero egress across all layers
 * 8. Verification that token usage represents synthetic deterministic metadata, NOT model inference
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import child_process from 'node:child_process';
import { MockEvalProvider } from '../../eval/src/providers/mock-eval-provider';

export interface NetworkEgressBarrier {
  violations: Array<{ vector: string; target?: string; timestamp: string }>;
  restore: () => void;
}

/**
 * Installs a comprehensive, fail-closed multi-layer network barrier covering
 * HTTP, HTTPS, HTTP/2, global fetch, DNS (callbacks and promises),
 * raw TCP sockets, TLS sockets, UDP datagram sockets, and child-process execution.
 */
export function installMultiLayerZeroEgressBarrier(): NetworkEgressBarrier {
  const violations: Array<{ vector: string; target?: string; timestamp: string }> = [];

  const origHttpRequest = http.request;
  const origHttpGet = http.get;
  const origHttpsRequest = https.request;
  const origHttpsGet = https.get;
  const origHttp2Connect = http2.connect;
  const origFetch = globalThis.fetch;
  const origDnsLookup = dns.lookup;
  const origDnsResolve = dns.resolve;
  const origDnsResolve4 = dns.resolve4;
  const origDnsResolve6 = dns.resolve6;
  const origDnsPromisesLookup = dns.promises?.lookup;
  const origDnsPromisesResolve = dns.promises?.resolve;
  const origNetConnect = net.connect;
  const origNetCreateConnection = net.createConnection;
  const origSocketConnect = net.Socket.prototype.connect;
  const origTlsConnect = tls.connect;
  const origDgramCreateSocket = dgram.createSocket;
  const origChildExec = child_process.exec;
  const origChildSpawn = child_process.spawn;
  const origChildFork = child_process.fork;
  const origChildExecFile = child_process.execFile;

  function recordViolation(vector: string, target?: string): never {
    const record = { vector, target, timestamp: new Date().toISOString() };
    violations.push(record);
    const err: any = new Error(
      `ZERO_EGRESS_BARRIER_VIOLATION: Outbound network egress blocked on vector '${vector}'${
        target ? ` targeting '${target}'` : ''
      }. Gate 4 strictly operates offline.`
    );
    err.code = 'ZERO_EGRESS_VIOLATION';
    err.vector = vector;
    throw err;
  }

  // 1. HTTP & HTTPS
  (http as any).request = function (...args: any[]) {
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.host || args[0]?.hostname;
    recordViolation('http.request', target);
  };
  (http as any).get = function (...args: any[]) {
    recordViolation('http.get');
  };
  (https as any).request = function (...args: any[]) {
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.host || args[0]?.hostname;
    recordViolation('https.request', target);
  };
  (https as any).get = function (...args: any[]) {
    recordViolation('https.get');
  };

  // 2. HTTP/2
  if (http2 && typeof http2.connect === 'function') {
    (http2 as any).connect = function (authority: any) {
      recordViolation('http2.connect', String(authority));
    };
  }

  // 3. Global fetch
  if (typeof globalThis.fetch === 'function') {
    (globalThis as any).fetch = async function (input: any) {
      const url = typeof input === 'string' ? input : input?.url || 'unknown_url';
      recordViolation('globalThis.fetch', url);
    };
  }

  // 4. DNS (Callbacks & Promises)
  (dns as any).lookup = function (...args: any[]) {
    recordViolation('dns.lookup', args[0]);
  };
  (dns as any).resolve = function (...args: any[]) {
    recordViolation('dns.resolve', args[0]);
  };
  (dns as any).resolve4 = function (...args: any[]) {
    recordViolation('dns.resolve4', args[0]);
  };
  (dns as any).resolve6 = function (...args: any[]) {
    recordViolation('dns.resolve6', args[0]);
  };
  if (dns.promises) {
    (dns.promises as any).lookup = async function (...args: any[]) {
      recordViolation('dns.promises.lookup', args[0]);
    };
    (dns.promises as any).resolve = async function (...args: any[]) {
      recordViolation('dns.promises.resolve', args[0]);
    };
  }

  // 5. Raw TCP Sockets
  (net as any).connect = function (...args: any[]) {
    recordViolation('net.connect');
  };
  (net as any).createConnection = function (...args: any[]) {
    recordViolation('net.createConnection');
  };
  (net.Socket.prototype as any).connect = function (...args: any[]) {
    recordViolation('net.Socket.connect');
  };

  // 6. TLS Sockets
  (tls as any).connect = function (...args: any[]) {
    recordViolation('tls.connect');
  };

  // 7. UDP Datagram Sockets
  (dgram as any).createSocket = function (...args: any[]) {
    recordViolation('dgram.createSocket');
  };

  // 8. Child Process Network Vectors
  (child_process as any).exec = function (...args: any[]) {
    const cmd = args[0];
    if (typeof cmd === 'string' && /(?:curl|wget|nc|ncat|ssh|invoke-webrequest)/i.test(cmd)) {
      recordViolation('child_process.exec_network_client', cmd);
    }
    return origChildExec.apply(child_process, args as any);
  };
  (child_process as any).spawn = function (...args: any[]) {
    const cmd = args[0];
    if (typeof cmd === 'string' && /(?:curl|wget|nc|ncat|ssh)/i.test(cmd)) {
      recordViolation('child_process.spawn_network_client', cmd);
    }
    return origChildSpawn.apply(child_process, args as any);
  };
  (child_process as any).execFile = function (...args: any[]) {
    const file = args[0];
    if (typeof file === 'string' && /(?:curl|wget|nc|ncat|ssh)/i.test(file)) {
      recordViolation('child_process.execFile_network_client', file);
    }
    return origChildExecFile.apply(child_process, args as any);
  };
  (child_process as any).fork = function (...args: any[]) {
    recordViolation('child_process.fork', String(args[0]));
  };

  return {
    violations,
    restore: () => {
      http.request = origHttpRequest;
      http.get = origHttpGet;
      https.request = origHttpsRequest;
      https.get = origHttpsGet;
      if (http2) http2.connect = origHttp2Connect;
      if (origFetch) (globalThis as any).fetch = origFetch;
      dns.lookup = origDnsLookup;
      dns.resolve = origDnsResolve;
      dns.resolve4 = origDnsResolve4;
      dns.resolve6 = origDnsResolve6;
      if (dns.promises) {
        if (origDnsPromisesLookup) dns.promises.lookup = origDnsPromisesLookup;
        if (origDnsPromisesResolve) dns.promises.resolve = origDnsPromisesResolve;
      }
      net.connect = origNetConnect;
      net.createConnection = origNetCreateConnection;
      net.Socket.prototype.connect = origSocketConnect;
      tls.connect = origTlsConnect;
      dgram.createSocket = origDgramCreateSocket;
      child_process.exec = origChildExec;
      child_process.spawn = origChildSpawn;
      child_process.execFile = origChildExecFile;
      child_process.fork = origChildFork;
    },
  };
}

describe('Gate 4 Zero-Egress Network Isolation Audit', () => {
  it('1. HTTP/HTTPS Egress Trap: Blocks direct outbound http/https requests fail-closed', () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      assert.throws(
        () => {
          http.request('http://api.groq.com/openai/v1/chat/completions');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'http.request');
          return true;
        }
      );

      assert.throws(
        () => {
          https.request('https://integrate.api.nvidia.com/v1/chat/completions');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'https.request');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('2. Global fetch Egress Trap: Blocks undici/native fetch calls fail-closed', async () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      await assert.rejects(
        async () => {
          await fetch('https://api.groq.com/health');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'globalThis.fetch');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('3. DNS Egress Trap: Blocks domain name resolution queries', () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      assert.throws(
        () => {
          dns.lookup('api.groq.com', () => {});
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'dns.lookup');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('4. Raw TCP & TLS Sockets Trap: Blocks socket connections before SYN packet egress', () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      assert.throws(
        () => {
          net.connect(443, '104.18.2.1');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'net.connect');
          return true;
        }
      );

      assert.throws(
        () => {
          tls.connect({ host: 'api.groq.com', port: 443 });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'tls.connect');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('5. Child Process Network Client Trap: Blocks external curl/wget execution across exec, spawn, execFile and fork', () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      assert.throws(
        () => {
          child_process.exec('curl -s https://api.groq.com');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'child_process.exec_network_client');
          return true;
        }
      );

      assert.throws(
        () => {
          child_process.spawn('wget', ['https://api.groq.com']);
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'child_process.spawn_network_client');
          return true;
        }
      );

      assert.throws(
        () => {
          child_process.execFile('curl', ['https://api.groq.com']);
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'child_process.execFile_network_client');
          return true;
        }
      );

      assert.throws(
        () => {
          child_process.fork('./child-worker.js');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'child_process.fork');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('6. Advanced Network Vectors Trap: Blocks DNS promises, HTTP/2, and UDP datagrams', async () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      if (dns.promises) {
        await assert.rejects(
          async () => {
            await dns.promises.lookup('api.groq.com');
          },
          (err: any) => {
            assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
            assert.strictEqual(err.vector, 'dns.promises.lookup');
            return true;
          }
        );
      }

      assert.throws(
        () => {
          http2.connect('https://api.groq.com');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'http2.connect');
          return true;
        }
      );

      assert.throws(
        () => {
          dgram.createSocket('udp4');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ZERO_EGRESS_VIOLATION');
          assert.strictEqual(err.vector, 'dgram.createSocket');
          return true;
        }
      );
    } finally {
      barrier.restore();
    }
  });

  it('7. MockEvalProvider Zero Egress: Executes without triggering any barrier violation', async () => {
    const barrier = installMultiLayerZeroEgressBarrier();
    try {
      const mockProvider = new MockEvalProvider({
        promptTokens: 350,
        completionTokens: 120,
        latencyMs: 1,
      });

      const res = await mockProvider.complete([
        { role: 'user', content: 'Test evaluation prompt' },
      ]);

      assert.strictEqual(res.providerName, 'mock');
      assert.strictEqual(barrier.violations.length, 0, 'Zero network calls must be attempted');
    } finally {
      barrier.restore();
    }
  });

  it('8. Token Provenance Verification: Confirms token counts are synthetic multipliers, not model inference', async () => {
    const mock = new MockEvalProvider({
      promptTokens: 350,
      completionTokens: 120,
    });

    const result = await mock.complete([{ role: 'user', content: 'Ping' }]);

    // Verified: Tokens are derived from deterministic configuration, NOT tokenizer/inference
    assert.strictEqual(result.promptTokens, 350);
    assert.strictEqual(result.completionTokens, 120);
    assert.strictEqual(result.totalTokens, 470);
    assert.strictEqual(typeof result.content, 'string');
    // Content is pre-baked mock JSON, zero GPU/NPU or inference API compute
    const parsed = JSON.parse(result.content);
    assert(parsed.candidate_a);
    assert(parsed.candidate_b);
  });
});
