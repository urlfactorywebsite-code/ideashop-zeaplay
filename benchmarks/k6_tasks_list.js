import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
};

export default function () {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:6311';
  const token = __ENV.TOKEN || '';
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const res = http.get(`${baseUrl}/tasks`, { headers });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
