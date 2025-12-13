import { ethers } from 'ethers';
import { config } from '../config';

let wsProvider: ethers.WebSocketProvider | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 5000;

const reconnectCallbacks: Set<() => void> = new Set();

function getWsUrl(): string {
  return config.rpc.wsUrl;
}

/**
 * Get the shared WebSocket provider for event listening.
 * Creates a new provider if one doesn't exist.
 * Handles disconnection and automatic reconnection.
 */
export function getWsProvider(): ethers.WebSocketProvider {
  if (!wsProvider) {
    const wsUrl = getWsUrl();
    console.log(`[WsProvider] Connecting to ${wsUrl.replace(/\/v2\/.*/, '/v2/***')}`);

    wsProvider = new ethers.WebSocketProvider(wsUrl);
    reconnectAttempts = 0;

    // Handle WebSocket events via addEventListener to avoid overwriting ethers' internal handlers
    // Using addEventListener instead of onopen/onclose/onerror ensures ethers can keep its own handlers
    const rawWs = wsProvider.websocket as unknown as {
      addEventListener: (
        type: string,
        listener: (event: { code?: number; reason?: string }) => void
      ) => void;
    };

    rawWs.addEventListener('open', () => {
      console.log('[WsProvider] WebSocket connected');
      reconnectAttempts = 0;
    });

    rawWs.addEventListener('close', (event: { code?: number; reason?: string }) => {
      console.warn(`[WsProvider] WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
      wsProvider = null;
      scheduleReconnect();
    });

    rawWs.addEventListener('error', (event) => {
      console.error('[WsProvider] WebSocket error:', event);
    });
  }
  return wsProvider;
}

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return;

  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`[WsProvider] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
    return;
  }

  // Exponential backoff: 5s, 10s, 20s, 40s... up to 60s max
  const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1), 60000);
  console.log(`[WsProvider] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      getWsProvider(); // Reconnect

      // Wait a bit for the connection to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Notify all registered callbacks to re-setup listeners
      console.log(`[WsProvider] Notifying ${reconnectCallbacks.size} watchers to re-setup listeners...`);
      for (const callback of reconnectCallbacks) {
        try {
          callback();
        } catch (err) {
          console.error('[WsProvider] Error in reconnect callback:', err);
        }
      }
    } catch (err) {
      console.error('[WsProvider] Reconnection failed:', err);
      scheduleReconnect(); // Retry
    }
  }, delay);
}

/**
 * Register a callback to be called on reconnection (to re-setup event listeners)
 */
export function onReconnect(callback: () => void): void {
  reconnectCallbacks.add(callback);
}

/**
 * Remove a reconnect callback
 */
export function removeReconnectCallback(callback: () => void): void {
  reconnectCallbacks.delete(callback);
}

/**
 * Get statistics about the WebSocket provider
 */
export function getWsProviderStats(): {
  isConnected: boolean;
  reconnectAttempts: number;
  registeredCallbacks: number;
} {
  return {
    isConnected: wsProvider !== null,
    reconnectAttempts,
    registeredCallbacks: reconnectCallbacks.size,
  };
}

/**
 * Manually close the WebSocket provider
 */
export function closeWsProvider(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsProvider) {
    wsProvider.destroy();
    wsProvider = null;
  }
  reconnectCallbacks.clear();
  console.log('[WsProvider] Closed');
}
