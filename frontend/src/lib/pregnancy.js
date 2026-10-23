// shortcut: minimal stub of the shared contract (build-plan.md) so ai-import builds in this
// branch; dev-preg's real lib/pregnancy.js replaces this file on merge.
export const pregOf = (S, now = Date.now()) => null   // eslint-disable-line no-unused-vars
export const notConsistent = S => S?.profile?.exp !== 'regular'
export const labelOf = (id, S) => null                // eslint-disable-line no-unused-vars
export const gentle = S => !!pregOf(S) && S?.profile?.preg?.clear !== 'yes'
export const reasonOf = (id, S) => null               // eslint-disable-line no-unused-vars
