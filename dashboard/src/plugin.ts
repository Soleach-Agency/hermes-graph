import "./style.css";
import { createGraphPage } from "./createGraphPage";

declare global {
  interface Window {
    __HERMES_PLUGIN_SDK__?: {
      sdkVersion?: string;
      React: any;
      fetchJSON: <T>(path: string, init?: RequestInit) => Promise<T>;
      buildWsUrl?: (path: string, params?: Record<string, string>) => Promise<string>;
    };
    __HERMES_PLUGINS__?: {
      register: (name: string, component: unknown) => void;
    };
  }
}

const sdk = window.__HERMES_PLUGIN_SDK__;
const registry = window.__HERMES_PLUGINS__;

if (!sdk || !registry) {
  throw new Error("Hermes Graph requires the Hermes Dashboard Plugin SDK");
}

registry.register(
  "hermes-graph",
  createGraphPage(sdk.React, {
    fetchJSON: sdk.fetchJSON,
    buildWsUrl: sdk.buildWsUrl,
  }),
);
