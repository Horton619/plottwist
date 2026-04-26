// PlotTwist — renderer entry point
// Top-level state and layout switching land here in a follow-up session.
// For now this just wires the IPC bridge so the contract is established.

window.addEventListener('DOMContentLoaded', () => {
  if (!window.plottwist) {
    console.warn('preload bridge missing — window.plottwist is undefined')
    return
  }

  window.plottwist.onMenuEvent((ev) => {
    console.log('[menu]', ev)
  })
})
