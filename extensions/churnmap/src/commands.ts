/** Every command Churnmap contributes, keyed by its short name. Keep in sync with package.json. */
export const COMMANDS = {
  build: 'churnmap.build',
  open: 'churnmap.open',
  showHotspots: 'churnmap.showHotspots',
  setWindow: 'churnmap.setWindow',
  toggleTreemap: 'churnmap.toggleTreemap',
  exportPostcard: 'churnmap.exportPostcard',
  ignoreHotspot: 'churnmap.ignoreHotspot',
  unignore: 'churnmap.unignore',
  openFile: 'churnmap.openFile',
  clearCache: 'churnmap.clearCache',
  showInCity: 'churnmap.showInCity',
  copyHotspotsMarkdown: 'churnmap.copyHotspotsMarkdown',
  showChangedHotspots: 'churnmap.showChangedHotspots',
  selectRepository: 'churnmap.selectRepository',
  openTalkLink: 'churnmap.openTalkLink',
  createAIPrompt: 'churnmap.createAIPrompt',
  exportForAgents: 'churnmap.exportForAgents',
  addToAgent: 'churnmap.addToAgent',
  createAIPromptTop: 'churnmap.createAIPromptTop',
  rankCodeOnly: 'churnmap.rankCodeOnly',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];
