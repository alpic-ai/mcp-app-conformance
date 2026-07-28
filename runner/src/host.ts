import type { CapabilityResult, HostImplementation, SuitePoll, TestMeta } from "../../shared/protocol";

export interface SetupOptions {
  appName: string;
  profileDir: string;
  recordVideoDir?: string;
}

export interface SuiteBridge {
  listTests(): Promise<TestMeta[]>;
  hostInfo(): Promise<HostImplementation | null>;
  start(filter?: { manual?: boolean; id?: string }): Promise<void>;
  poll(): Promise<SuitePoll>;
  resolve(result: CapabilityResult): Promise<void>;
}

export interface Host {
  readonly name: string;
  setup(opts: SetupOptions): Promise<SuiteBridge>;
  teardown(): Promise<void>;
  clickTrigger?(req: { commitDraftedMessage?: boolean }): Promise<CapabilityResult>;
  confirmDialog?(dialog: "download" | "sampling"): Promise<CapabilityResult>;
  checkLinkOpen?(url: string): Promise<CapabilityResult>;
  conversationContains?(marker: string, timeoutMs: number): Promise<CapabilityResult>;
  toggleTheme?(to: "light" | "dark"): Promise<CapabilityResult>;
  readModelToolList?(): Promise<CapabilityResult>;
  inspectFrame?(): Promise<CapabilityResult>;
  readConsole?(pattern: string, timeoutMs: number): Promise<CapabilityResult>;
  resetBetweenTests?(): Promise<void>;
}
