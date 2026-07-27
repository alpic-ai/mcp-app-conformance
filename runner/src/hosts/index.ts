import type { Host } from "../host";
import { ChatGPTBrowserHost } from "./chatgpt";
import { ClaudeBrowserHost } from "./claude";
import { CursorBrowserHost } from "./cursor";
import { GooseBrowserHost } from "./goose";
import { ManufactBrowserHost } from "./manufact";
import { MistralBrowserHost } from "./mistral";
import { AlpicPlaygroundBrowserHost } from "./playground";

export const HOSTS: Record<string, () => Host> = {
  chatgpt: () => new ChatGPTBrowserHost(),
  claude: () => new ClaudeBrowserHost(),
  cursor: () => new CursorBrowserHost(),
  goose: () => new GooseBrowserHost(),
  manufact: () => new ManufactBrowserHost(),
  mistral: () => new MistralBrowserHost(),
  playground: () => new AlpicPlaygroundBrowserHost(),
};
