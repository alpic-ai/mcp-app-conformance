import type { Host } from "../host";
import { ChatGPTBrowserHost } from "./chatgpt";
import { ClaudeBrowserHost } from "./claude";
import { AlpicPlaygroundBrowserHost } from "./playground";

export const HOSTS: Record<string, () => Host> = {
  chatgpt: () => new ChatGPTBrowserHost(),
  claude: () => new ClaudeBrowserHost(),
  playground: () => new AlpicPlaygroundBrowserHost(),
};
