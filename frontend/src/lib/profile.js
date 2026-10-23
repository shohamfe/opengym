// Profile helpers (build-plan shared contract). S.profile: null = not onboarded.
export const isFemale = S => S?.profile?.sex === 'female'

// Body diagram: explicit pick, else follow the profile, else the legacy S.body.
export const bodyOf = S => S?.bodyPick || (S?.profile ? (isFemale(S) ? 'female' : 'male') : (S?.body || 'male'))
