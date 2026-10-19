export function waitForEvent(socket, event, timeoutMs = 5000) {
  let cancel;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off(event, receive); };
    const receive = value => { cleanup(); resolve(value); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Expected signaling event not received')); }, timeoutMs);
    cancel = () => { cleanup(); reject(new Error('Signaling observation cancelled')); };
    socket.once(event, receive);
  });
  // A preceding ack can fail before its correlated delivery is awaited.
  promise.catch(() => {});
  return { promise, cancel };
}

export function connectSocket(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off('connect', connected); socket.off('connect_error', failed); };
    const connected = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Socket.IO connection failed')); };
    const timer = setTimeout(failed, timeoutMs);
    socket.once('connect', connected);
    socket.once('connect_error', failed);
    socket.connect();
  });
}

export function nearestRank(sorted, q) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
}
