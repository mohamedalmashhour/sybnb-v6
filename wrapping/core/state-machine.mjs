// Tiny explicit state machine shared by the stays and rides capsules. A transition is allowed only
// when it is listed; everything else is refused, so a booking or trip can never jump states.

export function createMachine(name, transitions) {
  const table = Object.freeze(Object.fromEntries(Object.entries(transitions).map(([from, to]) => [from, Object.freeze([...to])])))
  return Object.freeze({
    name,
    states: Object.freeze([...new Set([...Object.keys(table), ...Object.values(table).flat()])]),
    can: (from, to) => (table[from] || []).includes(to),
    next: (from) => table[from] || [],
    isFinal: (state) => !(table[state] && table[state].length),
    assert(from, to) {
      if (!(table[from] || []).includes(to)) {
        const err = new Error(`${name}: cannot move from ${from} to ${to}`)
        err.code = 'INVALID_TRANSITION'
        throw err
      }
      return to
    },
  })
}
