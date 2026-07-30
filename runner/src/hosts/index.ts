import type { Host } from "../host.js";
import { ChatGPTBrowserHost } from "./chatgpt.js";
import { ClaudeBrowserHost } from "./claude.js";
import { CursorBrowserHost } from "./cursor.js";
import { GooseBrowserHost } from "./goose.js";
import { ManufactBrowserHost } from "./manufact.js";
import { MistralBrowserHost } from "./mistral.js";
import { AlpicPlaygroundBrowserHost } from "./playground.js";

export const HOSTS: Record<string, () => Host> = {
  chatgpt: () => new ChatGPTBrowserHost(),
  claude: () => new ClaudeBrowserHost(),
  cursor: () => new CursorBrowserHost(),
  goose: () => new GooseBrowserHost(),
  manufact: () => new ManufactBrowserHost(),
  mistral: () => new MistralBrowserHost(),
  playground: () => new AlpicPlaygroundBrowserHost(),
};
