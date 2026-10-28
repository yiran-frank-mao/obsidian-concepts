import type { PopupPlacement } from "./menu-position";

/** Which interface “Choose concept to link from popup” opens. */
export type ConceptLinkChooser = "search" | "menu";

export interface Concept {
  id: string;
  name: string;
  aliases: string[];
  sourcePath: string;
  blockId: string;
  calloutType: string;
  recordPath: string;
  created: string;
  updated: string;
}

export interface CalloutLocation {
  title: string;
  type: string;
  startLine: number;
  endLine: number;
  blockId?: string;
  blockIdLine?: number;
}

export interface ConceptsSettings {
  databaseFolder: string;
  basePath: string;
  showCalloutButtons: boolean;
  trackMovedCallouts: boolean;
  updateVaultLinks: boolean;
  caseSensitive: boolean;
  popupPlacement: PopupPlacement;
  /** `search` opens the searchable list; `menu` opens the small popup. */
  conceptLinkChooser: ConceptLinkChooser;
}
