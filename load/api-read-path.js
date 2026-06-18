// k6 load test for the JobOps API read path (Phase 5 · S).
//
// Targets the public liveness/readiness probes — GET /api/health and
// /api/health/ready — which need no auth (requireSharedApiKey only gates mutating
// methods; the health routes don't call requireAuth). This exercises the Express
// stack, rate limiter, and (for /ready) the real DB ping under concurrency.
//
// Run:
//   k6 run load/api-read-path.js                        # local (default BASE_URL)
//   BASE_URL=https://jobops-api.azurewebsites.net k6 run load/api-read-path.js
//   PROFILE=smoke k6 run load/api-read-path.js          # 1 VU, 10s (quick check)
//
// See load/README.md for installing k6 and reading the results.

import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const PROFILE = __ENV.PROFILE || 'load';

// A quick single-VU smoke vs. a short ramped load. Both are deliberately modest —
// this is a portfolio-scale B1 instance, not a stress test.
const profiles = {
  smoke: {
    vus: 1,
    duration: '10s',
  },
  load: {
    stages: [
      { duration: '20s', target: 10 }, // ramp up
      { duration: '30s', target: 10 }, // steady
      { duration: '10s', target: 0 }, // ramp down
    ],
  },
};

export const options = {
  ...profiles[PROFILE],
  thresholds: {
    // <1% of requests may fail, and 95% must complete under 800ms.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  group('liveness', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, {
      'health 200': (r) => r.status === 200,
      'health ok:true': (r) => r.json('ok') === true,
    });
  });

  group('readiness', () => {
    // 200 (ready) or 503 (db unreachable) are both valid, well-formed responses.
    // Widen the per-request expected-status classifier so a 503 does NOT inflate
    // http_req_failed (k6's default treats >=400 as failed); liveness stays strict.
    const res = http.get(`${BASE_URL}/api/health/ready`, {
      responseCallback: http.expectedStatuses(200, 503),
    });
    // A 5xx/timeout outside those, or a missing status field, is a real failure.
    check(res, {
      'ready 200 or 503': (r) => r.status === 200 || r.status === 503,
      'ready has status field': (r) => typeof r.json('status') === 'string',
    });
  });

  sleep(1);
}
