// shortcut: minimal stub of the shared contract (build-plan.md) so ai-import builds in this
// branch; dev-profile's real lib/profile.js replaces this file on merge.
export const isFemale = S => S?.profile?.sex === 'female'
export const bodyOf = S => S?.bodyPick || (S?.profile ? (isFemale(S) ? 'female' : 'male') : (S?.body || 'male'))
