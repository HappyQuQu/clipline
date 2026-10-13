// Phase two integrations attach to these named slots. No recognition provider is bundled in phase one.
export const PHASE_ONE_CAPABILITIES = Object.freeze({
  transcription: false,
  visualRecognition: false,
  semanticSearch: false,
});
export const EXTENSION_SLOTS = Object.freeze(['clip-detail', 'timeline-track', 'task-type', 'settings-section', 'search-provider', 'library-filters', 'source-settings']);
export function createExtensionRegistry(capabilities = PHASE_ONE_CAPABILITIES) {
  const extensions = new Map();
  return {
    register(extension) {
      if (!extension.id || !EXTENSION_SLOTS.includes(extension.slot)) throw new Error('Invalid extension identity or slot');
      if (!extension.capability || capabilities[extension.capability] !== true) return false;
      extensions.set(extension.id, Object.freeze({ ...extension }));
      return true;
    },
    forSlot(slot) { return [...extensions.values()].filter(extension => extension.slot === slot); },
  };
}
export const extensionRegistry = createExtensionRegistry();
